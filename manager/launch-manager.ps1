param(
    [switch] $NoBrowser
)

$ErrorActionPreference = 'Stop'

$managerUrl = 'http://127.0.0.1:8219/'
$healthUrl = 'http://127.0.0.1:8219/api/health'
$serverScript = Join-Path $PSScriptRoot 'server-manager.js'
$installRoot = Split-Path -Parent $PSScriptRoot
$portableNode = Join-Path $installRoot '.runtime\node\node.exe'

function Test-ManagerHealth {
    try {
        $response = Invoke-RestMethod -Uri $healthUrl -TimeoutSec 1
        if ($response.ok -ne $true) {
            return $false
        }

        if (-not [string]::IsNullOrWhiteSpace([string] $response.installRoot)) {
            $runningRoot = [IO.Path]::GetFullPath([string] $response.installRoot).TrimEnd('\')
            $expectedRoot = [IO.Path]::GetFullPath($installRoot).TrimEnd('\')
            return [string]::Equals($runningRoot, $expectedRoot, [StringComparison]::OrdinalIgnoreCase)
        }

        # Compatibility with managers launched before installRoot was added to the health response.
        $listener = Get-NetTCPConnection -State Listen -LocalPort 8219 -ErrorAction SilentlyContinue | Select-Object -First 1
        $process = if ($listener) { Get-CimInstance Win32_Process -Filter ("ProcessId={0}" -f $listener.OwningProcess) -ErrorAction SilentlyContinue }
        if ($null -eq $process -or $process.CommandLine -notmatch '(?i)"([^\"]*\\manager\\server-manager\.js)"') {
            return $false
        }
        $runningScript = [IO.Path]::GetFullPath($Matches[1])
        return [string]::Equals($runningScript, [IO.Path]::GetFullPath($serverScript), [StringComparison]::OrdinalIgnoreCase)
    }
    catch {
        return $false
    }
}

function Stop-OrphanedManager {
    try {
        $listener = Get-NetTCPConnection -State Listen -LocalPort 8219 -ErrorAction SilentlyContinue | Select-Object -First 1
        if ($null -eq $listener) { return }

        $process = Get-CimInstance Win32_Process -Filter ("ProcessId={0}" -f $listener.OwningProcess) -ErrorAction Stop
        if ($null -eq $process -or $process.CommandLine -notmatch '(?i)"([^\"]*\\manager\\server-manager\.js)"') { return }

        $runningScript = $Matches[1]
        if (Test-Path -LiteralPath $runningScript) {
            throw "Another PalSphere installation is already using port 8219: $runningScript. Close that studio before opening this one."
        }

        $palworldRunning = Get-Process -Name 'PalServer', 'PalServer-Win64-Shipping-Cmd' -ErrorAction SilentlyContinue
        if ($palworldRunning) {
            throw 'PalSphere is still running from a folder that was moved or renamed, and the Palworld server is online. Stop Palworld before relaunching PalSphere from its new folder.'
        }

        try {
            Invoke-RestMethod -Method Post -Uri 'http://127.0.0.1:8219/api/manager/quit' -ContentType 'application/json' -Body '{}' -TimeoutSec 5 | Out-Null
        }
        catch {
            Stop-Process -Id $listener.OwningProcess -Force -ErrorAction Stop
        }

        $deadline = (Get-Date).AddSeconds(3)
        while ((Get-Date) -lt $deadline) {
            $remaining = Get-NetTCPConnection -State Listen -LocalPort 8219 -ErrorAction SilentlyContinue
            if (-not $remaining) { return }
            Start-Sleep -Milliseconds 200
        }

        $remaining = Get-NetTCPConnection -State Listen -LocalPort 8219 -ErrorAction SilentlyContinue |
            Where-Object OwningProcess -eq $listener.OwningProcess
        if ($remaining) {
            Stop-Process -Id $listener.OwningProcess -Force -ErrorAction Stop
            Start-Sleep -Milliseconds 300
        }

        if (Get-NetTCPConnection -State Listen -LocalPort 8219 -ErrorAction SilentlyContinue) {
            throw 'The obsolete PalSphere manager did not release port 8219.'
        }
    }
    catch {
        if ($_.Exception.Message -like 'No MSFT_NetTCPConnection objects found*') { return }
        throw
    }
}

if (-not (Test-ManagerHealth)) {
    Stop-OrphanedManager
    if (Test-Path -LiteralPath $portableNode) {
        $node = $portableNode
    }
    else {
        $node = (Get-Command node.exe -ErrorAction Stop).Source
    }
    Start-Process `
        -FilePath $node `
        -ArgumentList ('"{0}"' -f $serverScript) `
        -WorkingDirectory $PSScriptRoot `
        -WindowStyle Hidden | Out-Null

    $deadline = (Get-Date).AddSeconds(20)
    while ((Get-Date) -lt $deadline -and -not (Test-ManagerHealth)) {
        Start-Sleep -Milliseconds 400
    }
}

if (-not (Test-ManagerHealth)) {
    Add-Type -AssemblyName PresentationFramework
    [System.Windows.MessageBox]::Show(
        "PalSphere could not start. Check manager\logs\activity.jsonl for details.",
        'PalSphere Server Studio',
        'OK',
        'Error'
    ) | Out-Null
    exit 1
}

if (-not $NoBrowser) {
    Start-Process $managerUrl
}
