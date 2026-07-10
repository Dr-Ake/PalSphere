param(
    [Parameter(Mandatory = $true)]
    [string] $InstallRoot
)

$ErrorActionPreference = 'Stop'
$ruleName = 'PalSphere - Palworld Game Server (UDP 8211)'
$legacyRuleName = 'Palworld Dedicated Server - UDP 8211'
$serverExe = Join-Path $InstallRoot 'server\Pal\Binaries\Win64\PalServer-Win64-Shipping-Cmd.exe'

if (-not (Test-Path -LiteralPath $serverExe)) {
    throw "Palworld server executable not found: $serverExe"
}

Get-NetFirewallRule -DisplayName $ruleName -ErrorAction SilentlyContinue | Remove-NetFirewallRule
Get-NetFirewallRule -DisplayName $legacyRuleName -ErrorAction SilentlyContinue | Remove-NetFirewallRule

New-NetFirewallRule `
    -DisplayName $ruleName `
    -Description 'Program-scoped inbound traffic for Palworld players. PalSphere management remains local-only.' `
    -Direction Inbound `
    -Action Allow `
    -Enabled True `
    -Profile Private,Public `
    -Protocol UDP `
    -LocalPort 8211 `
    -Program $serverExe | Out-Null

Write-Host 'Windows Firewall: program-scoped inbound UDP 8211 is enabled.' -ForegroundColor Green
