[CmdletBinding()]
param(
    [Parameter(Mandatory = $true)]
    [string]$ArchivePath,

    [Parameter(Mandatory = $true)]
    [string]$DestinationPath,

    [long]$MaximumExpandedBytes = 2147483648,

    [int]$MaximumFileCount = 20000
)

$ErrorActionPreference = 'Stop'
Add-Type -AssemblyName System.IO.Compression.FileSystem

$destinationRoot = [System.IO.Path]::GetFullPath($DestinationPath).TrimEnd([System.IO.Path]::DirectorySeparatorChar) + [System.IO.Path]::DirectorySeparatorChar
$archive = [System.IO.Compression.ZipFile]::OpenRead([System.IO.Path]::GetFullPath($ArchivePath))
try {
    [long]$expandedBytes = 0
    [int]$fileCount = 0
    foreach ($entry in $archive.Entries) {
        $entryName = $entry.FullName.Replace('/', [System.IO.Path]::DirectorySeparatorChar)
        $target = [System.IO.Path]::GetFullPath((Join-Path $DestinationPath $entryName))
        if (-not $target.StartsWith($destinationRoot, [System.StringComparison]::OrdinalIgnoreCase)) {
            throw "The ZIP contains an unsafe path: $($entry.FullName)"
        }
        if (-not [string]::IsNullOrEmpty($entry.Name)) {
            $fileCount += 1
            $expandedBytes += $entry.Length
        }
        if ($fileCount -gt $MaximumFileCount) {
            throw "The mod contains more than $MaximumFileCount files."
        }
        if ($expandedBytes -gt $MaximumExpandedBytes) {
            throw 'The expanded mod is larger than 2 GB.'
        }
    }
}
finally {
    $archive.Dispose()
}

Expand-Archive -LiteralPath $ArchivePath -DestinationPath $DestinationPath -Force
