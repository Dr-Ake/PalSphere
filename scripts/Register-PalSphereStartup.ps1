param(
    [Parameter(Mandatory = $true)]
    [string] $InstallRoot,
    [switch] $Remove
)

$ErrorActionPreference = 'Stop'
$taskName = 'PalSphere Server Studio'

if ($Remove) {
    Unregister-ScheduledTask -TaskName $taskName -Confirm:$false -ErrorAction SilentlyContinue
    Write-Host 'PalSphere automatic startup is disabled.' -ForegroundColor Yellow
    exit 0
}

$launcher = Join-Path $InstallRoot 'manager\launch-manager.ps1'
if (-not (Test-Path -LiteralPath $launcher)) {
    throw "PalSphere launcher not found: $launcher"
}

$powerShell = (Get-Command powershell.exe -ErrorAction Stop).Source
$userId = [System.Security.Principal.WindowsIdentity]::GetCurrent().Name
$arguments = '-NoLogo -NoProfile -WindowStyle Hidden -ExecutionPolicy Bypass -File "{0}" -NoBrowser' -f $launcher
$action = New-ScheduledTaskAction -Execute $powerShell -Argument $arguments -WorkingDirectory $InstallRoot
$trigger = New-ScheduledTaskTrigger -AtLogOn -User $userId
$principal = New-ScheduledTaskPrincipal -UserId $userId -LogonType Interactive -RunLevel Limited
$settings = New-ScheduledTaskSettingsSet `
    -AllowStartIfOnBatteries `
    -DontStopIfGoingOnBatteries `
    -StartWhenAvailable `
    -ExecutionTimeLimit ([TimeSpan]::Zero)

$task = New-ScheduledTask `
    -Action $action `
    -Trigger $trigger `
    -Principal $principal `
    -Settings $settings `
    -Description 'Starts the local PalSphere watchdog quietly when this Windows user signs in.'

Register-ScheduledTask -TaskName $taskName -InputObject $task -Force | Out-Null
Write-Host 'Windows startup: PalSphere will start quietly when this user signs in.' -ForegroundColor Green
