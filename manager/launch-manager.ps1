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
        $response = Invoke-WebRequest -UseBasicParsing -Uri $healthUrl -TimeoutSec 1
        return $response.StatusCode -eq 200
    }
    catch {
        return $false
    }
}

if (-not (Test-ManagerHealth)) {
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
