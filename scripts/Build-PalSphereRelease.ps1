[CmdletBinding()]
param()

Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'
$root = [IO.Path]::GetFullPath((Join-Path $PSScriptRoot '..'))

Push-Location $root
try {
    & powershell.exe -NoLogo -NoProfile -ExecutionPolicy Bypass -File '.\scripts\Test-PalSphereRelease.ps1'
    if ($LASTEXITCODE -ne 0) { throw 'Release validation failed.' }

    if ((git rev-parse --is-inside-work-tree 2>$null) -ne 'true') { throw 'Initialize Git before building a release archive.' }
    $files = @(git ls-files --cached --others --exclude-standard)
    if (-not $files.Count) { throw 'No publishable Git files were found.' }

    $version = (Get-Content -LiteralPath (Join-Path $root 'package.json') -Raw | ConvertFrom-Json).version
    $releaseRoot = Join-Path $root '_release'
    $stage = Join-Path $releaseRoot "PalSphere-$version"
    $archive = Join-Path $releaseRoot "PalSphere-$version.zip"
    $safeParent = [IO.Path]::GetFullPath($releaseRoot).TrimEnd('\') + '\'
    if (-not ([IO.Path]::GetFullPath($stage)).StartsWith($safeParent, [StringComparison]::OrdinalIgnoreCase)) { throw 'Unsafe release staging path.' }

    if (Test-Path -LiteralPath $stage) { Remove-Item -LiteralPath $stage -Recurse -Force }
    if (Test-Path -LiteralPath $archive) { Remove-Item -LiteralPath $archive -Force }
    New-Item -ItemType Directory -Path $stage -Force | Out-Null

    foreach ($relative in $files) {
        $source = Join-Path $root $relative
        if (-not (Test-Path -LiteralPath $source -PathType Leaf)) { continue }
        $destination = Join-Path $stage $relative
        New-Item -ItemType Directory -Path (Split-Path -Parent $destination) -Force | Out-Null
        Copy-Item -LiteralPath $source -Destination $destination
    }

    Compress-Archive -LiteralPath $stage -DestinationPath $archive -CompressionLevel Optimal
    $sizeMb = [Math]::Round((Get-Item -LiteralPath $archive).Length / 1MB, 2)
    Write-Host "Release archive created: $archive ($sizeMb MB)" -ForegroundColor Green
}
finally {
    Pop-Location
}
