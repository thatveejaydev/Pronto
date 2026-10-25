# Run from the extracted BinSearch folder. No administrator privileges needed.
[CmdletBinding()]
param()
$ErrorActionPreference = 'Stop'
$destination = Join-Path $env:APPDATA 'Adobe\CEP\extensions\local.binsearch.panel'
if (Test-Path -LiteralPath $destination) {
    $backupRoot = Join-Path $env:APPDATA 'Adobe\BinSearchBackups'
    New-Item -ItemType Directory -Path $backupRoot -Force | Out-Null
    $backup = Join-Path $backupRoot ('BinSearch-' + (Get-Date -Format 'yyyyMMdd-HHmmss-fff'))
    Copy-Item -LiteralPath $destination -Destination $backup -Recurse
    Write-Host "Previous installation backed up to $backup"
}
New-Item -ItemType Directory -Path $destination -Force | Out-Null
foreach ($name in @('CSXS', 'icons', 'index.html', 'style.css', 'search.js', 'preview.js', 'panel.js', 'host.jsx', 'launcher.html', 'launcher.js', 'preview-settings.js', 'shortcut.js', 'hotkey.ps1')) {
    if ($name -eq 'CSXS') {
        New-Item -ItemType Directory -Path (Join-Path $destination 'CSXS') -Force | Out-Null
        Copy-Item -LiteralPath (Join-Path $PSScriptRoot 'CSXS\manifest.xml') -Destination (Join-Path $destination 'CSXS\manifest.xml') -Force
    } elseif ($name -eq 'icons') {
        New-Item -ItemType Directory -Path (Join-Path $destination 'icons') -Force | Out-Null
        foreach ($icon in @('media.svg', 'bin.svg', 'sequence.svg', 'image.svg', 'video.svg', 'audio.svg', 'graphic.svg')) {
            Copy-Item -LiteralPath (Join-Path $PSScriptRoot ('icons\' + $icon)) -Destination (Join-Path $destination ('icons\' + $icon)) -Force
        }
    } else {
        Copy-Item -LiteralPath (Join-Path $PSScriptRoot $name) -Destination (Join-Path $destination $name) -Force
    }
}
$key = 'HKCU:\Software\Adobe\CSXS.12'
New-Item -Path $key -Force | Out-Null
New-ItemProperty -Path $key -Name PlayerDebugMode -PropertyType String -Value '1' -Force | Out-Null
Write-Host "Installed to $destination"
Write-Host 'Unsigned CEP development extensions are now enabled for CEP 12 in this user account.'
Write-Host 'Restart Premiere Pro. Open Window > Extensions > PRONTO Launcher, then click Search project.'
