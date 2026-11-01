[CmdletBinding()]
param()

$ErrorActionPreference = 'Stop'
$repoRoot = [IO.Path]::GetFullPath((Join-Path $PSScriptRoot '..'))
$manifestPath = Join-Path $repoRoot 'com.pronto.ppro\CSXS\manifest.xml'
[xml]$manifest = Get-Content -LiteralPath $manifestPath -Raw
$version = [string]$manifest.ExtensionManifest.ExtensionBundleVersion

if ($version -notmatch '^\d+\.\d+\.\d+$') {
    throw "Manifest contains an invalid semantic version: $version"
}

$packageJson = Get-Content -LiteralPath (Join-Path $repoRoot 'package.json') -Raw | ConvertFrom-Json
if ([string]$packageJson.version -ne $version) {
    throw "Version mismatch: manifest is $version but package.json is $($packageJson.version)."
}

& node (Join-Path $repoRoot 'com.pronto.ppro\tests\run-tests.cjs')
if ($LASTEXITCODE -ne 0) { throw 'Tests failed; package was not created.' }

& powershell -NoLogo -NoProfile -ExecutionPolicy Bypass -File (Join-Path $repoRoot 'com.pronto.ppro\hotkey-daemon.ps1') -ValidateOnly
if ($LASTEXITCODE -ne 0) { throw 'Hotkey helper validation failed; package was not created.' }

$distDir = Join-Path $repoRoot 'dist'
$stageDir = Join-Path $distDir "PRONTO-$version-windows"
$archivePath = Join-Path $distDir "PRONTO-$version-windows.zip"

if (Test-Path -LiteralPath $stageDir) { Remove-Item -LiteralPath $stageDir -Recurse -Force }
if (Test-Path -LiteralPath $archivePath) { Remove-Item -LiteralPath $archivePath -Force }
New-Item -ItemType Directory -Path $stageDir -Force | Out-Null

Copy-Item -LiteralPath (Join-Path $repoRoot 'com.pronto.ppro') -Destination $stageDir -Recurse
foreach ($file in @('Install PRONTO.bat', 'Uninstall PRONTO.bat', 'README.md', 'CHANGELOG.md', 'SUPPORT.md')) {
    Copy-Item -LiteralPath (Join-Path $repoRoot $file) -Destination $stageDir
}

Compress-Archive -Path (Join-Path $stageDir '*') -DestinationPath $archivePath -CompressionLevel Optimal
Remove-Item -LiteralPath $stageDir -Recurse -Force
Write-Host "Created release archive: $archivePath" -ForegroundColor Green
