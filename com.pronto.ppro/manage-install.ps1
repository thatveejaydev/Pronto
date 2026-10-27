[CmdletBinding()]
param([ValidateSet('Install','Uninstall')][string]$Action = 'Install')
$ErrorActionPreference = 'Stop'
try {
    if (Get-Process -Name 'Adobe Premiere Pro' -ErrorAction SilentlyContinue) { throw 'Close Premiere Pro, then run this file again.' }
    if (-not $env:APPDATA) { throw 'Windows could not find your AppData folder.' }
    $extensions = [IO.Path]::GetFullPath((Join-Path $env:APPDATA 'Adobe\CEP\extensions'))
    $backupRoot = [IO.Path]::GetFullPath((Join-Path $env:APPDATA 'Adobe\ProntoBackups'))
    $destination = Join-Path $extensions 'com.pronto.ppro'
    function Assert-PlainTree([string]$Path) {
        $entry = Get-Item -LiteralPath $Path -Force
        if ($entry.Attributes -band [IO.FileAttributes]::ReparsePoint) { throw "Linked folders are not supported: $Path" }
        if ($entry.PSIsContainer) {
            foreach ($child in Get-ChildItem -LiteralPath $Path -Force) { Assert-PlainTree $child.FullName }
        }
    }
    function Assert-DirectChild([string]$Path, [string]$Parent) {
        if ([IO.Path]::GetDirectoryName([IO.Path]::GetFullPath($Path)) -ne [IO.Path]::GetFullPath($Parent)) { throw "Unexpected destination: $Path" }
    }
    function Is-Pronto([string]$Path) {
        $manifest = Join-Path $Path 'CSXS\manifest.xml'
        if (-not (Test-Path -LiteralPath $manifest -PathType Leaf)) { return $false }
        try {
            [xml]$xml = Get-Content -LiteralPath $manifest -Raw
            return $xml.ExtensionManifest.ExtensionBundleId -eq 'local.binsearch'
        } catch { return $false }
    }
    # Only these known installation names are candidates; never touch unrelated extensions.
    $existing = @()
    foreach ($name in @('com.pronto.ppro','Pronto','BinSearch','local.binsearch.panel')) {
        $path = Join-Path $extensions $name
        Assert-DirectChild $path $extensions
        if (Test-Path -LiteralPath $path) {
            Assert-PlainTree $path
            if (Is-Pronto $path) { $existing += $path }
            elseif ($name -eq 'com.pronto.ppro') { throw 'The destination belongs to another extension. Nothing was changed.' }
        }
    }
    if ($Action -eq 'Uninstall' -and $existing.Count -eq 0) { Write-Host 'PRONTO is not installed.'; exit 0 }
    $stamp = Get-Date -Format 'yyyyMMdd-HHmmss-fff'
    $backup = Join-Path $backupRoot ($Action + '-' + $stamp + '-' + [guid]::NewGuid().ToString('N').Substring(0,8))
    if (Test-Path -LiteralPath $backupRoot) { Assert-PlainTree $backupRoot }
    New-Item -ItemType Directory -Path $backup -Force | Out-Null
    $stage = Join-Path $backup 'new-package'
    if ($Action -eq 'Install') {
        if ([IO.Path]::GetFullPath($PSScriptRoot) -eq $destination -or $existing -contains [IO.Path]::GetFullPath($PSScriptRoot)) { throw 'Run the installer from the extracted download, outside the Adobe extensions folder.' }
        if (-not (Is-Pronto $PSScriptRoot)) { throw 'The plugin package is missing or invalid. Extract the full download first.' }
        $files = @('CSXS\manifest.xml','index.html','launcher.html','style.css','host.jsx','panel.js','launcher.js','search.js','shortcut.js','hotkey.ps1','preview.js','preview-settings.js','icons\media.svg','icons\bin.svg','icons\sequence.svg','icons\image.svg','icons\video.svg','icons\audio.svg','icons\graphic.svg')
        foreach ($file in $files) {
            $source = Join-Path $PSScriptRoot $file
            if (-not (Test-Path -LiteralPath $source -PathType Leaf)) { throw "Missing package file: $file. Extract the full download again." }
            Assert-PlainTree $source
        }
        foreach ($file in $files) {
            $target = Join-Path $stage $file
            New-Item -ItemType Directory -Path ([IO.Path]::GetDirectoryName($target)) -Force | Out-Null
            Copy-Item -LiteralPath (Join-Path $PSScriptRoot $file) -Destination $target
            if ((Get-FileHash -LiteralPath (Join-Path $PSScriptRoot $file)).Hash -ne (Get-FileHash -LiteralPath $target).Hash) { throw "Could not verify copied file: $file" }
        }
        # Required for this unsigned development extension; affects the current Windows user only.
        $key = 'HKCU:\Software\Adobe\CSXS.12'
        New-Item -Path $key -Force | Out-Null
        New-ItemProperty -Path $key -Name PlayerDebugMode -PropertyType String -Value '1' -Force | Out-Null
        New-Item -ItemType Directory -Path $extensions -Force | Out-Null
    }
    $moved = @()
    try {
        foreach ($path in $existing) {
            Assert-DirectChild $path $extensions
            $saved = Join-Path $backup ([IO.Path]::GetFileName($path))
            Assert-DirectChild $saved $backup
            Move-Item -LiteralPath $path -Destination $saved
            $moved += @{ Original = $path; Saved = $saved }
        }
        if ($Action -eq 'Install') {
            Assert-DirectChild $stage $backup
            Assert-DirectChild $destination $extensions
            Move-Item -LiteralPath $stage -Destination $destination
        }
    } catch {
        foreach ($entry in $moved) {
            if (-not (Test-Path -LiteralPath $entry.Original)) { Move-Item -LiteralPath $entry.Saved -Destination $entry.Original }
        }
        throw
    }
    if ($Action -eq 'Install') {
        Write-Host "PRONTO installed successfully: $destination"
        Write-Host 'Start Premiere, then open Window > Extensions > PRONTO Launcher.'
    } else {
        Write-Host 'PRONTO uninstalled successfully.'
        Write-Host 'Your projects, media, and saved shortcut preferences were not removed.'
        Write-Host 'The shared Adobe development-extension setting was left unchanged.'
    }
    if ($moved.Count) { Write-Host "Previous plugin files are recoverable here: $backup" }
    exit 0
} catch {
    Write-Host ('PRONTO: ' + $_.Exception.Message) -ForegroundColor Red
    exit 1
}