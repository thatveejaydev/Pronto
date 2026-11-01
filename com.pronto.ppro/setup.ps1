[CmdletBinding()]
param(
    [ValidateSet('Install', 'Uninstall')]
    [string]$Action = 'Install'
)
$ErrorActionPreference = 'Stop'
$stagingDir = $null

try {
    if (Get-Process -Name 'Adobe Premiere Pro' -ErrorAction SilentlyContinue) {
        throw 'Please close Adobe Premiere Pro before running this installer.'
    }
    if (-not $env:APPDATA) {
        throw 'Could not resolve the %APPDATA% directory on this system.'
    }

    $cepExtensionsRoot = [IO.Path]::GetFullPath((Join-Path $env:APPDATA 'Adobe\CEP\extensions'))
    $targetInstallDir  = Join-Path $cepExtensionsRoot 'com.pronto.ppro'

    function Assert-NoReparsePoints([string]$TargetPath) {
        $item = Get-Item -LiteralPath $TargetPath -Force
        if ($item.Attributes -band [IO.FileAttributes]::ReparsePoint) {
            throw "Symlinks or junctions are not supported: $TargetPath"
        }
        if ($item.PSIsContainer) {
            foreach ($sub in Get-ChildItem -LiteralPath $TargetPath -Force) {
                Assert-NoReparsePoints $sub.FullName
            }
        }
    }

    function Test-IsProntoBundle([string]$BundleDir) {
        $manifestFile = Join-Path $BundleDir 'CSXS\manifest.xml'
        if (-not (Test-Path -LiteralPath $manifestFile -PathType Leaf)) { return $false }
        try {
            [xml]$doc = Get-Content -LiteralPath $manifestFile -Raw
            $id = $doc.ExtensionManifest.ExtensionBundleId
            return ($id -eq 'com.pronto.ppro' -or $id -eq 'local.binsearch')
        } catch {
            return $false
        }
    }

    $existingFound = @()
    foreach ($candidateName in @('com.pronto.ppro', 'Pronto', 'BinSearch', 'local.binsearch.panel')) {
        $candidatePath = Join-Path $cepExtensionsRoot $candidateName
        if (Test-Path -LiteralPath $candidatePath) {
            Assert-NoReparsePoints $candidatePath
            if (Test-IsProntoBundle $candidatePath) {
                $existingFound += $candidatePath
            } elseif ($candidateName -eq 'com.pronto.ppro') {
                throw "Destination folder '$candidatePath' belongs to a different extension. Aborting safely."
            }
        }
    }

    if ($Action -eq 'Uninstall' -and $existingFound.Count -eq 0) {
        Write-Host 'PRONTO is not currently installed.' -ForegroundColor Yellow
        exit 0
    }

    if ($Action -eq 'Install') {
        $sourceRoot = [IO.Path]::GetFullPath($PSScriptRoot)
        if ($sourceRoot -eq $targetInstallDir -or ($existingFound -contains $sourceRoot)) {
            throw 'Run the installer from the extracted folder outside the Adobe CEP extensions directory.'
        }
        foreach ($oldDir in $existingFound) {
            if ($sourceRoot.StartsWith($oldDir + '\', [StringComparison]::OrdinalIgnoreCase)) {
                throw 'Run the installer from outside the installed PRONTO folder.'
            }
        }
        if (-not (Test-IsProntoBundle $sourceRoot)) {
            throw 'Package manifest is missing or invalid. Please extract the complete PRONTO folder.'
        }

        $manifestFiles = @(
            'CSXS\manifest.xml',
            'palette.html',
            'launcher.html',
            'hotkey-daemon.ps1',
            'host\engine.jsx',
            'client\theme.css',
            'client\keybinding.js',
            'client\matcher.js',
            'client\audio-player.js',
            'client\palette.js',
            'client\launcher.js',
            'assets\video.svg',
            'assets\audio.svg',
            'assets\image.svg',
            'assets\graphic.svg',
            'assets\sequence.svg',
            'assets\bin.svg',
            'assets\media.svg'
        )

        foreach ($relPath in $manifestFiles) {
            $srcFile = Join-Path $sourceRoot $relPath
            if (-not (Test-Path -LiteralPath $srcFile -PathType Leaf)) {
                throw "Missing required package file: $relPath"
            }
            Assert-NoReparsePoints $srcFile
        }

        New-Item -ItemType Directory -Path $cepExtensionsRoot -Force | Out-Null
        Assert-NoReparsePoints $cepExtensionsRoot
        $stagingDir = [IO.Path]::GetFullPath((Join-Path $cepExtensionsRoot ('pronto-staging-' + [guid]::NewGuid().ToString('N'))))
        New-Item -ItemType Directory -Path $stagingDir | Out-Null

        foreach ($relPath in $manifestFiles) {
            $srcFile = Join-Path $sourceRoot $relPath
            $dstFile = Join-Path $stagingDir $relPath
            New-Item -ItemType Directory -Path ([IO.Path]::GetDirectoryName($dstFile)) -Force | Out-Null
            Copy-Item -LiteralPath $srcFile -Destination $dstFile
            $srcHash = (Get-FileHash -LiteralPath $srcFile -Algorithm SHA256).Hash
            $dstHash = (Get-FileHash -LiteralPath $dstFile -Algorithm SHA256).Hash
            if ($srcHash -ne $dstHash) {
                throw "File integrity verification failed for: $relPath"
            }
        }

        foreach ($csxsVer in @('CSXS.11', 'CSXS.12')) {
            $regPath = "HKCU:\Software\Adobe\$csxsVer"
            New-Item -Path $regPath -Force | Out-Null
            New-ItemProperty -Path $regPath -Name 'PlayerDebugMode' -PropertyType String -Value '1' -Force | Out-Null
        }
        New-Item -ItemType Directory -Path $cepExtensionsRoot -Force | Out-Null
    }

    foreach ($oldDir in $existingFound) {
        $resolvedOldDir = [IO.Path]::GetFullPath($oldDir)
        if ([IO.Path]::GetDirectoryName($resolvedOldDir) -ne $cepExtensionsRoot -or -not (Test-IsProntoBundle $resolvedOldDir)) {
            throw "Refusing to remove an unverified installation: $resolvedOldDir"
        }
        Assert-NoReparsePoints $resolvedOldDir
        Remove-Item -LiteralPath $resolvedOldDir -Recurse -Force
    }
    if ($Action -eq 'Install') {
        Move-Item -LiteralPath $stagingDir -Destination $targetInstallDir
    }

    if ($Action -eq 'Install') {
        Write-Host "PRONTO installed successfully to: $targetInstallDir" -ForegroundColor Green
        Write-Host 'Launch Premiere Pro and open: Window > Extensions > PRONTO Launcher' -ForegroundColor Cyan
    } else {
        Write-Host 'PRONTO uninstalled successfully.' -ForegroundColor Green
        Write-Host 'Your Premiere projects, media, and saved shortcuts were preserved.'
    }
    exit 0
} catch {
    Write-Host ('PRONTO Setup Error: ' + $_.Exception.Message) -ForegroundColor Red
    exit 1
} finally {
    if ($stagingDir -and (Test-Path -LiteralPath $stagingDir)) {
        $resolvedStage = [IO.Path]::GetFullPath($stagingDir)
        if ([IO.Path]::GetDirectoryName($resolvedStage) -eq $cepExtensionsRoot -and [IO.Path]::GetFileName($resolvedStage) -match '^pronto-staging-[a-f0-9]{32}$') {
            Assert-NoReparsePoints $resolvedStage
            Remove-Item -LiteralPath $resolvedStage -Recurse -Force
        }
    }
}
