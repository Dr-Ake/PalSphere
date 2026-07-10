[CmdletBinding()]
param(
    [string] $RepositoryRoot
)

Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'

if ([string]::IsNullOrWhiteSpace($RepositoryRoot)) {
    $RepositoryRoot = [IO.Path]::GetFullPath((Join-Path $PSScriptRoot '..'))
}
else {
    $RepositoryRoot = [IO.Path]::GetFullPath($RepositoryRoot)
}

$required = @(
    '.gitignore', '.gitattributes', 'LICENSE', 'README.md', 'SECURITY.md',
    'Install PalSphere.bat', 'Launch PalSphere.bat', 'Uninstall PalSphere.bat',
    'manager\server-manager.js', 'manager\public\index.html',
    'scripts\Install-PalSphere.ps1', 'scripts\Initialize-PalSphereConfig.js'
)
foreach ($relative in $required) {
    if (-not (Test-Path -LiteralPath (Join-Path $RepositoryRoot $relative))) {
        throw "Required release file is missing: $relative"
    }
}

$parseFailures = @()
foreach ($file in Get-ChildItem -Path (Join-Path $RepositoryRoot 'scripts'), (Join-Path $RepositoryRoot 'manager') -Recurse -File -Filter '*.ps1') {
    $tokens = $null
    $errors = $null
    [Management.Automation.Language.Parser]::ParseFile($file.FullName, [ref] $tokens, [ref] $errors) | Out-Null
    if ($errors) { $parseFailures += $errors | ForEach-Object { "$($file.FullName): $($_.Message)" } }
}
if ($parseFailures) { throw ($parseFailures -join [Environment]::NewLine) }

$nodeCandidates = @(
    (Join-Path $RepositoryRoot '.runtime\node\node.exe'),
    (Get-Command node.exe -ErrorAction SilentlyContinue | Select-Object -ExpandProperty Source -ErrorAction SilentlyContinue)
) | Where-Object { $_ -and (Test-Path -LiteralPath $_) }
$node = $nodeCandidates | Select-Object -First 1
if (-not $node) { throw 'Node.js 20 or later is required to validate a release.' }

Push-Location $RepositoryRoot
try {
    & $node --test 'manager/tests/*.test.js'
    if ($LASTEXITCODE -ne 0) { throw 'Automated tests failed.' }
    foreach ($script in @('manager/server-manager.js', 'manager/public/app.js', 'manager/lib/watchdog.js', 'scripts/Initialize-PalSphereConfig.js')) {
        & $node --check $script
        if ($LASTEXITCODE -ne 0) { throw "Node.js syntax check failed: $script" }
    }
    & powershell.exe -NoLogo -NoProfile -ExecutionPolicy Bypass -File '.\scripts\Install-PalSphere.ps1' -DryRun -NonInteractive
    if ($LASTEXITCODE -ne 0) { throw 'Installer dry run failed.' }

    $insideGit = $false
    if (Get-Command git.exe -ErrorAction SilentlyContinue) {
        $savedPreference = $ErrorActionPreference
        $ErrorActionPreference = 'Continue'
        $gitResult = & git rev-parse --is-inside-work-tree 2>$null
        $gitExitCode = $LASTEXITCODE
        $ErrorActionPreference = $savedPreference
        $insideGit = $gitExitCode -eq 0 -and $gitResult -eq 'true'
    }
    if ($insideGit) {
        $candidates = @(git ls-files --cached --others --exclude-standard)
        $forbiddenPaths = $candidates | Where-Object {
            $_ -match '^(server|_steamcmd|_prerequisites|\.runtime)/' -or
            $_ -match '^manager/(backups|config-history|logs)/' -or
            $_ -in @('PalSphere Server Info - Private.txt', 'SERVER INFO - KEEP PRIVATE.txt', 'manager/manager-settings.json')
        }
        if ($forbiddenPaths) { throw "Private or downloaded files would be published: $($forbiddenPaths -join ', ')" }

        $secretFiles = @()
        foreach ($relative in $candidates) {
            $path = Join-Path $RepositoryRoot $relative
            if (-not (Test-Path -LiteralPath $path -PathType Leaf)) { continue }
            if ([IO.Path]::GetExtension($path) -notin @('.js', '.json', '.md', '.ps1', '.bat', '.cmd', '.ini', '.yml', '.yaml', '.txt')) { continue }
            $content = Get-Content -LiteralPath $path -Raw
            if ($content -match 'C:\\Users\\[^<\s]+' -or $content -match 'AdminPassword\s*=\s*"[^"]+"' -or $content -match 'ServerPassword\s*=\s*"[^"]+"') {
                $secretFiles += $relative
            }
        }
        if ($secretFiles) { throw "Possible machine-specific path or credential in publishable files: $($secretFiles -join ', ')" }
        git diff --check
        if ($LASTEXITCODE -ne 0) { throw 'Git whitespace validation failed.' }
        Write-Host "Git publish set: $($candidates.Count) safe files." -ForegroundColor Green
    }
    else {
        Write-Host 'Git is not initialized; source tests passed, but the publish-set audit was skipped.' -ForegroundColor Yellow
    }
}
finally {
    Pop-Location
}

Write-Host 'PalSphere release validation passed.' -ForegroundColor Green
