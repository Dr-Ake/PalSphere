[CmdletBinding()]
param(
    [string] $InstallRoot,
    [string] $ServerName,
    [string] $ServerPassword,
    [ValidateRange(1, 65535)]
    [int] $GamePort = 8211,
    [switch] $NonInteractive,
    [switch] $SkipPrerequisites,
    [switch] $DryRun
)

Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'
$ProgressPreference = 'SilentlyContinue'
[Net.ServicePointManager]::SecurityProtocol = [Net.ServicePointManager]::SecurityProtocol -bor [Net.SecurityProtocolType]::Tls12

$PalSphereVersion = '1.4.0'
$SteamCmdUrl = 'https://steamcdn-a.akamaihd.net/client/installer/steamcmd.zip'
$NodeIndexUrl = 'https://nodejs.org/dist/index.json'
$VcRuntimeUrl = 'https://aka.ms/vc14/vc_redist.x64.exe'
$DirectXUrl = 'https://download.microsoft.com/download/1/7/1/1718CCC4-6315-4D8E-9543-8E28A4E18C4C/dxwebsetup.exe'

if ([string]::IsNullOrWhiteSpace($InstallRoot)) {
    $InstallRoot = [IO.Path]::GetFullPath((Join-Path $PSScriptRoot '..'))
}
else {
    $InstallRoot = [IO.Path]::GetFullPath($InstallRoot)
}

$ManagerScript = Join-Path $InstallRoot 'manager\server-manager.js'
$ConfigInitializer = Join-Path $InstallRoot 'scripts\Initialize-PalSphereConfig.js'
if (-not (Test-Path -LiteralPath $ManagerScript) -or -not (Test-Path -LiteralPath $ConfigInitializer)) {
    throw 'Run this installer from a complete PalSphere source checkout or release archive.'
}

function Write-Step([string] $Message) {
    Write-Host "`n==> $Message" -ForegroundColor Cyan
}

function Test-IsAdministrator {
    $identity = [Security.Principal.WindowsIdentity]::GetCurrent()
    $principal = [Security.Principal.WindowsPrincipal] $identity
    return $principal.IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)
}

function Assert-SafeChildPath([string] $Path, [string] $Parent) {
    $fullPath = [IO.Path]::GetFullPath($Path)
    $fullParent = [IO.Path]::GetFullPath($Parent).TrimEnd([IO.Path]::DirectorySeparatorChar) + [IO.Path]::DirectorySeparatorChar
    if (-not $fullPath.StartsWith($fullParent, [StringComparison]::OrdinalIgnoreCase)) {
        throw "Refusing filesystem operation outside $Parent"
    }
}

function Remove-SafeTree([string] $Path, [string] $Parent) {
    if (-not (Test-Path -LiteralPath $Path)) { return }
    Assert-SafeChildPath -Path $Path -Parent $Parent
    Remove-Item -LiteralPath $Path -Recurse -Force
}

function Invoke-VerifiedDownload([string] $Uri, [string] $Destination) {
    New-Item -ItemType Directory -Path (Split-Path -Parent $Destination) -Force | Out-Null
    $partial = "$Destination.download"
    for ($attempt = 1; $attempt -le 3; $attempt++) {
        try {
            Invoke-WebRequest -UseBasicParsing -Uri $Uri -OutFile $partial -MaximumRedirection 8 -TimeoutSec 120
            Move-Item -LiteralPath $partial -Destination $Destination -Force
            return
        }
        catch {
            Remove-Item -LiteralPath $partial -Force -ErrorAction SilentlyContinue
            if ($attempt -eq 3) { throw }
            Start-Sleep -Seconds (2 * $attempt)
        }
    }
}

function Stop-PalSphereForMaintenance {
    try {
        $status = Invoke-RestMethod -Uri 'http://127.0.0.1:8219/api/status' -TimeoutSec 2
        if ($status.running) {
            throw 'The Palworld server is running. Use Save & Stop in PalSphere before installing or repairing.'
        }
        Invoke-RestMethod -Method Post -Uri 'http://127.0.0.1:8219/api/manager/quit' -TimeoutSec 3 | Out-Null
        $deadline = (Get-Date).AddSeconds(10)
        do {
            Start-Sleep -Milliseconds 250
            try { Invoke-RestMethod -Uri 'http://127.0.0.1:8219/api/health' -TimeoutSec 1 | Out-Null; $online = $true }
            catch { $online = $false }
        } while ($online -and (Get-Date) -lt $deadline)
        if ($online) { throw 'PalSphere did not close for maintenance.' }
    }
    catch {
        if ($_.Exception.Message -match 'running|did not close') { throw }
    }

    $serverProcess = Get-Process -Name 'PalServer', 'PalServer-Win64-Shipping-Cmd' -ErrorAction SilentlyContinue
    if ($serverProcess) { throw 'A Palworld server process is running. Stop it before installing or repairing.' }
}

function Install-PortableNode {
    $runtimeRoot = Join-Path $InstallRoot '.runtime'
    $nodeRoot = Join-Path $runtimeRoot 'node'
    $nodeExe = Join-Path $nodeRoot 'node.exe'
    if (Test-Path -LiteralPath $nodeExe) {
        $version = (& $nodeExe --version).Trim()
        if ($LASTEXITCODE -eq 0 -and [int]($version.TrimStart('v').Split('.')[0]) -ge 20) {
            Write-Host "Portable Node.js $version is ready."
            return $nodeExe
        }
    }

    Write-Step 'Downloading the latest Node.js LTS portable runtime'
    $releases = Invoke-RestMethod -Uri $NodeIndexUrl -TimeoutSec 30
    $release = $releases | Where-Object { $_.lts -and ($_.files -contains 'win-x64-zip') } | Select-Object -First 1
    if (-not $release) { throw 'Node.js did not publish a usable Windows x64 LTS archive.' }

    $archiveName = "node-$($release.version)-win-x64.zip"
    $releaseBase = "https://nodejs.org/dist/$($release.version)"
    $cacheRoot = Join-Path $runtimeRoot 'cache'
    $archivePath = Join-Path $cacheRoot $archiveName
    $sumsPath = Join-Path $cacheRoot "SHASUMS256-$($release.version).txt"
    Invoke-VerifiedDownload -Uri "$releaseBase/$archiveName" -Destination $archivePath
    Invoke-VerifiedDownload -Uri "$releaseBase/SHASUMS256.txt" -Destination $sumsPath

    $sumMatch = [regex]::Match((Get-Content -LiteralPath $sumsPath -Raw), "(?mi)^([a-f0-9]{64})\s+$([regex]::Escape($archiveName))$")
    if (-not $sumMatch.Success) { throw 'Could not find the Node.js archive checksum in the official release manifest.' }
    $actualHash = (Get-FileHash -LiteralPath $archivePath -Algorithm SHA256).Hash.ToLowerInvariant()
    if ($actualHash -ne $sumMatch.Groups[1].Value.ToLowerInvariant()) { throw 'Node.js archive checksum verification failed.' }

    $stage = Join-Path $runtimeRoot 'node-stage'
    Remove-SafeTree -Path $stage -Parent $runtimeRoot
    Remove-SafeTree -Path $nodeRoot -Parent $runtimeRoot
    Expand-Archive -LiteralPath $archivePath -DestinationPath $stage -Force
    $extracted = Get-ChildItem -LiteralPath $stage -Directory | Where-Object { $_.Name -like 'node-*-win-x64' } | Select-Object -First 1
    if (-not $extracted) { throw 'The Node.js archive layout was not recognized.' }
    New-Item -ItemType Directory -Path $nodeRoot -Force | Out-Null
    Copy-Item -Path (Join-Path $extracted.FullName '*') -Destination $nodeRoot -Recurse -Force
    Remove-SafeTree -Path $stage -Parent $runtimeRoot
    if (-not (Test-Path -LiteralPath $nodeExe)) { throw 'Portable Node.js installation did not produce node.exe.' }
    Write-Host "Portable Node.js $($release.version) installed." -ForegroundColor Green
    return $nodeExe
}

function Install-Prerequisites {
    if ($SkipPrerequisites) {
        Write-Host 'Microsoft prerequisite installation was skipped by request.' -ForegroundColor Yellow
        return
    }
    $prereqRoot = Join-Path $InstallRoot '_prerequisites'
    New-Item -ItemType Directory -Path $prereqRoot -Force | Out-Null

    Write-Step 'Installing the Microsoft Visual C++ runtime'
    $vcPath = Join-Path $prereqRoot 'vc_redist.x64.exe'
    Invoke-VerifiedDownload -Uri $VcRuntimeUrl -Destination $vcPath
    $vc = Start-Process -FilePath $vcPath -ArgumentList '/install', '/quiet', '/norestart' -Wait -PassThru -WindowStyle Hidden
    if ($vc.ExitCode -notin @(0, 1638, 3010)) { throw "Visual C++ runtime installation failed with exit code $($vc.ExitCode)." }

    Write-Step 'Installing the Microsoft DirectX legacy runtime components'
    $directXMarker = Join-Path $prereqRoot 'directx.installed'
    if (-not (Test-Path -LiteralPath $directXMarker)) {
        $directXPath = Join-Path $prereqRoot 'dxwebsetup.exe'
        Invoke-VerifiedDownload -Uri $DirectXUrl -Destination $directXPath
        $directX = Start-Process -FilePath $directXPath -ArgumentList '/Q' -Wait -PassThru
        if ($directX.ExitCode -notin @(0, 3010)) { throw "DirectX runtime installation failed with exit code $($directX.ExitCode)." }
        Set-Content -LiteralPath $directXMarker -Value (Get-Date).ToString('o') -Encoding ascii
    }
}

function Install-PalworldServer {
    $steamRoot = Join-Path $InstallRoot '_steamcmd'
    $steamExe = Join-Path $steamRoot 'steamcmd.exe'
    if (-not (Test-Path -LiteralPath $steamExe)) {
        Write-Step 'Downloading SteamCMD from Valve'
        New-Item -ItemType Directory -Path $steamRoot -Force | Out-Null
        $steamZip = Join-Path $steamRoot 'steamcmd.zip'
        Invoke-VerifiedDownload -Uri $SteamCmdUrl -Destination $steamZip
        Expand-Archive -LiteralPath $steamZip -DestinationPath $steamRoot -Force
        Remove-Item -LiteralPath $steamZip -Force
    }
    if (-not (Test-Path -LiteralPath $steamExe)) { throw 'SteamCMD installation did not produce steamcmd.exe.' }

    Write-Step 'Downloading and validating Palworld Dedicated Server (about 6 GB)'
    $serverRoot = Join-Path $InstallRoot 'server'
    New-Item -ItemType Directory -Path $serverRoot -Force | Out-Null
    & $steamExe '+force_install_dir' $serverRoot '+login' 'anonymous' '+app_update' '2394010' 'validate' '+quit'
    if ($LASTEXITCODE -ne 0) { throw "SteamCMD failed with exit code $LASTEXITCODE." }
    if (-not (Test-Path -LiteralPath (Join-Path $serverRoot 'PalServer.exe'))) { throw 'Palworld Dedicated Server did not install correctly.' }
}

Write-Host ''
Write-Host '  PalSphere Server Studio - Install or Repair' -ForegroundColor Green
Write-Host "  Version $PalSphereVersion" -ForegroundColor DarkGray
Write-Host "  Installation: $InstallRoot" -ForegroundColor DarkGray

if ($DryRun) {
    Write-Step 'Dry-run validation'
    Write-Host 'Would download portable Node.js LTS from nodejs.org.'
    Write-Host 'Would download SteamCMD from Valve and app 2394010 from Steam.'
    Write-Host 'Would install Microsoft Visual C++ and DirectX runtimes.'
    Write-Host 'Would create a fresh private Palworld configuration only when none exists.'
    Write-Host "Would allow program-scoped inbound game UDP and configure the default game port as $GamePort."
    Write-Host 'Dry run passed.' -ForegroundColor Green
    exit 0
}

if (-not [Environment]::Is64BitOperatingSystem) { throw 'PalSphere requires 64-bit Windows.' }
if (-not (Test-IsAdministrator)) { throw 'Run Install PalSphere.bat and approve the Windows administrator prompt.' }

$configPath = Join-Path $InstallRoot 'server\Pal\Saved\Config\WindowsServer\PalWorldSettings.ini'
$firstInstall = -not (Test-Path -LiteralPath $configPath)
if ($firstInstall) {
    if ([string]::IsNullOrWhiteSpace($ServerName)) {
        $defaultName = "$env:USERNAME's Palworld Server"
        if ($NonInteractive) { $ServerName = $defaultName }
        else {
            $answer = Read-Host "Server name [$defaultName]"
            $ServerName = if ([string]::IsNullOrWhiteSpace($answer)) { $defaultName } else { $answer.Trim() }
        }
    }
    if ([string]::IsNullOrWhiteSpace($ServerPassword)) {
        if (-not $NonInteractive) { $ServerPassword = (Read-Host 'Join password [leave blank to generate a secure one]').Trim() }
        if ([string]::IsNullOrWhiteSpace($ServerPassword)) { $ServerPassword = ([Guid]::NewGuid().ToString('N')).Substring(0, 16) }
    }
}

Stop-PalSphereForMaintenance

$requiredFreeGb = if (Test-Path -LiteralPath (Join-Path $InstallRoot 'server')) { 4 } else { 12 }
$driveName = ([IO.Path]::GetPathRoot($InstallRoot)).TrimEnd('\').TrimEnd(':')
$drive = Get-PSDrive -Name $driveName -ErrorAction SilentlyContinue
if ($drive -and $drive.Free -lt ($requiredFreeGb * 1GB)) { throw "At least $requiredFreeGb GB of free disk space is required." }

$nodeExe = Install-PortableNode
Install-Prerequisites
Install-PalworldServer

if ($firstInstall) {
    Write-Step 'Creating a fresh private Palworld server configuration'
    $env:PALSPHERE_SERVER_NAME = $ServerName
    $env:PALSPHERE_SERVER_PASSWORD = $ServerPassword
    $env:PALSPHERE_ADMIN_PASSWORD = [Guid]::NewGuid().ToString('N')
    $env:PALSPHERE_GAME_PORT = [string] $GamePort
    try {
        & $nodeExe $ConfigInitializer
        if ($LASTEXITCODE -ne 0) { throw "Configuration initialization failed with exit code $LASTEXITCODE." }
    }
    finally {
        Remove-Item Env:PALSPHERE_SERVER_NAME -ErrorAction SilentlyContinue
        Remove-Item Env:PALSPHERE_SERVER_PASSWORD -ErrorAction SilentlyContinue
        Remove-Item Env:PALSPHERE_ADMIN_PASSWORD -ErrorAction SilentlyContinue
        Remove-Item Env:PALSPHERE_GAME_PORT -ErrorAction SilentlyContinue
    }
}
else {
    Write-Host 'Existing world, configuration, passwords, and saves were preserved.' -ForegroundColor Green
}

$configuredGamePort = $GamePort
if (Test-Path -LiteralPath $configPath) {
    $portMatch = [regex]::Match((Get-Content -LiteralPath $configPath -Raw), '(?:^|,)PublicPort=(\d+)')
    if ($portMatch.Success) { $configuredGamePort = [int] $portMatch.Groups[1].Value }
}

$managerSettings = Join-Path $InstallRoot 'manager\manager-settings.json'
if (-not (Test-Path -LiteralPath $managerSettings)) {
    Copy-Item -LiteralPath (Join-Path $InstallRoot 'manager\manager-settings.example.json') -Destination $managerSettings
}

Write-Step 'Configuring Windows Firewall and automatic watchdog startup'
& (Join-Path $InstallRoot 'scripts\Configure-PalSphereFirewall.ps1') -InstallRoot $InstallRoot
& (Join-Path $InstallRoot 'scripts\Register-PalSphereStartup.ps1') -InstallRoot $InstallRoot

$manifestPath = Join-Path $InstallRoot 'server\steamapps\appmanifest_2394010.acf'
$buildId = 'Unknown'
if (Test-Path -LiteralPath $manifestPath) {
    $buildMatch = [regex]::Match((Get-Content -LiteralPath $manifestPath -Raw), '"buildid"\s+"(\d+)"')
    if ($buildMatch.Success) { $buildId = $buildMatch.Groups[1].Value }
}
$nodeVersion = (& $nodeExe --version).Trim()
@{
    palSphereVersion = $PalSphereVersion
    installedAt = (Get-Date).ToUniversalTime().ToString('o')
    nodeVersion = $nodeVersion
    palworldBuildId = $buildId
} | ConvertTo-Json | Set-Content -LiteralPath (Join-Path $InstallRoot 'PalSphere.install.json') -Encoding utf8

Write-Step 'Starting PalSphere Server Studio'
& powershell.exe -NoLogo -NoProfile -ExecutionPolicy Bypass -File (Join-Path $InstallRoot 'manager\launch-manager.ps1')

Write-Host ''
Write-Host 'PalSphere is installed and ready.' -ForegroundColor Green
if ($firstInstall) {
    Write-Host 'Your generated join and administrator passwords are in:' -ForegroundColor Yellow
    Write-Host "  $(Join-Path $InstallRoot 'PalSphere Server Info - Private.txt')" -ForegroundColor Yellow
}
Write-Host "Router: forward UDP $configuredGamePort to the LAN address shown by PalSphere and reserve that address."
