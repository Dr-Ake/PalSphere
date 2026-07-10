[CmdletBinding()]
param(
    [string] $InstallRoot,
    [switch] $KeepDownloadedFiles,
    [switch] $NonInteractive
)

Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'

if ([string]::IsNullOrWhiteSpace($InstallRoot)) {
    $InstallRoot = [IO.Path]::GetFullPath((Join-Path $PSScriptRoot '..'))
}
else {
    $InstallRoot = [IO.Path]::GetFullPath($InstallRoot)
}

function Test-IsAdministrator {
    $identity = [Security.Principal.WindowsIdentity]::GetCurrent()
    $principal = [Security.Principal.WindowsPrincipal] $identity
    return $principal.IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)
}

function Remove-SafeGeneratedPath([string] $Path) {
    if (-not (Test-Path -LiteralPath $Path)) { return }
    $fullPath = [IO.Path]::GetFullPath($Path)
    $fullRoot = $InstallRoot.TrimEnd([IO.Path]::DirectorySeparatorChar) + [IO.Path]::DirectorySeparatorChar
    if (-not $fullPath.StartsWith($fullRoot, [StringComparison]::OrdinalIgnoreCase) -or $fullPath -eq $InstallRoot) {
        throw "Refusing to remove unsafe path: $fullPath"
    }
    Remove-Item -LiteralPath $fullPath -Recurse -Force
}

if (-not (Test-IsAdministrator)) { throw 'Run Uninstall PalSphere.bat and approve the Windows administrator prompt.' }

try {
    $status = Invoke-RestMethod -Uri 'http://127.0.0.1:8219/api/status' -TimeoutSec 2
    if ($status.running) { throw 'Use Save & Stop in PalSphere before uninstalling.' }
    Invoke-RestMethod -Method Post -Uri 'http://127.0.0.1:8219/api/manager/quit' -TimeoutSec 3 | Out-Null
    Start-Sleep -Seconds 1
}
catch {
    if ($_.Exception.Message -match 'Save & Stop') { throw }
}

if (Get-Process -Name 'PalServer', 'PalServer-Win64-Shipping-Cmd' -ErrorAction SilentlyContinue) {
    throw 'A Palworld server process is still running. Stop it before uninstalling.'
}

if (-not $KeepDownloadedFiles -and -not $NonInteractive) {
    $answer = Read-Host 'Remove downloaded runtimes and Palworld server files after making a world backup? [y/N]'
    if ($answer -notmatch '^(?i)y(es)?$') { $KeepDownloadedFiles = $true }
}

if (-not $KeepDownloadedFiles) {
    $backupSources = @(
        (Join-Path $InstallRoot 'server\Pal\Saved'),
        (Join-Path $InstallRoot 'manager\backups'),
        (Join-Path $InstallRoot 'manager\manager-settings.json'),
        (Join-Path $InstallRoot 'PalSphere Server Info - Private.txt')
    ) | Where-Object { Test-Path -LiteralPath $_ }
    if ($backupSources.Count -gt 0) {
        $stamp = Get-Date -Format 'yyyyMMdd-HHmmss'
        $backupArchive = Join-Path $InstallRoot "PalSphere Uninstall Backup - $stamp.zip"
        Compress-Archive -LiteralPath $backupSources -DestinationPath $backupArchive -CompressionLevel Optimal
        Write-Host "World and private settings backup created: $backupArchive" -ForegroundColor Green
    }
}

& (Join-Path $InstallRoot 'scripts\Register-PalSphereStartup.ps1') -InstallRoot $InstallRoot -Remove
foreach ($ruleName in @('PalSphere - Palworld Game Server (UDP)', 'PalSphere - Palworld Game Server (UDP 8211)', 'Palworld Dedicated Server - UDP 8211')) {
    Get-NetFirewallRule -DisplayName $ruleName -ErrorAction SilentlyContinue | Remove-NetFirewallRule
}

if (-not $KeepDownloadedFiles) {
    foreach ($path in @(
        (Join-Path $InstallRoot '.runtime'),
        (Join-Path $InstallRoot '_steamcmd'),
        (Join-Path $InstallRoot '_prerequisites'),
        (Join-Path $InstallRoot 'server'),
        (Join-Path $InstallRoot 'manager\backups'),
        (Join-Path $InstallRoot 'manager\config-history'),
        (Join-Path $InstallRoot 'manager\logs')
    )) {
        Remove-SafeGeneratedPath -Path $path
    }
    foreach ($file in @(
        (Join-Path $InstallRoot 'manager\manager-settings.json'),
        (Join-Path $InstallRoot 'PalSphere.install.json'),
        (Join-Path $InstallRoot 'PalSphere Server Info - Private.txt')
    )) {
        if (Test-Path -LiteralPath $file) { Remove-Item -LiteralPath $file -Force }
    }
}

Write-Host ''
Write-Host 'PalSphere startup and firewall integration were removed.' -ForegroundColor Green
if ($KeepDownloadedFiles) {
    Write-Host 'Downloaded server files and worlds were kept. Run Install PalSphere.bat to enable PalSphere again.'
}
else {
    Write-Host 'Generated runtimes and server files were removed. The PalSphere source folder was kept.'
}
