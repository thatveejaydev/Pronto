[CmdletBinding()]
param(
    [string]$ToolPath = $env:PRONTO_ZXP_SIGN_CMD,
    [string]$CertificatePath = $env:PRONTO_ZXP_CERTIFICATE,
    [string]$CertificatePassword = $env:PRONTO_ZXP_CERT_PASSWORD,
    [string]$TimestampUrl = $(if ($env:PRONTO_ZXP_TIMESTAMP_URL) { $env:PRONTO_ZXP_TIMESTAMP_URL } else { 'http://timestamp.digicert.com' })
)

$ErrorActionPreference = 'Stop'
$repoRoot = [IO.Path]::GetFullPath((Join-Path $PSScriptRoot '..'))
$extensionDir = Join-Path $repoRoot 'com.pronto.ppro'
$manifestPath = Join-Path $extensionDir 'CSXS\manifest.xml'
[xml]$manifest = Get-Content -LiteralPath $manifestPath -Raw
$version = [string]$manifest.ExtensionManifest.ExtensionBundleVersion

if ($version -notmatch '^\d+\.\d+\.\d+$') {
    throw "Manifest contains an invalid semantic version: $version"
}
$packageJson = Get-Content -LiteralPath (Join-Path $repoRoot 'package.json') -Raw | ConvertFrom-Json
if ([string]$packageJson.version -ne $version) {
    throw "Version mismatch: manifest is $version but package.json is $($packageJson.version)."
}

if (-not $ToolPath) {
    $bundledTool = Join-Path $repoRoot '.tools\Adobe-CEP-Resources\ZXPSignCMD\4.1.3\x64\ZXPSignCmd.exe'
    if (Test-Path -LiteralPath $bundledTool -PathType Leaf) { $ToolPath = $bundledTool }
}
if (-not $ToolPath) {
    $command = Get-Command 'ZXPSignCmd.exe' -ErrorAction SilentlyContinue
    if (-not $command) { $command = Get-Command 'ZXPSignCmd' -ErrorAction SilentlyContinue }
    if ($command) { $ToolPath = $command.Source }
}
if (-not $ToolPath -or -not (Test-Path -LiteralPath $ToolPath -PathType Leaf)) {
    throw 'ZXPSignCmd was not found. Set PRONTO_ZXP_SIGN_CMD to the full path of ZXPSignCmd.exe.'
}
if (-not $CertificatePath) {
    $localCertificate = Join-Path $repoRoot '.tools\signing\pronto-signing.p12'
    if (Test-Path -LiteralPath $localCertificate -PathType Leaf) { $CertificatePath = $localCertificate }
}
if (-not $CertificatePath -or -not (Test-Path -LiteralPath $CertificatePath -PathType Leaf)) {
    throw 'Signing certificate was not found. Set PRONTO_ZXP_CERTIFICATE to a .p12 certificate path.'
}
if (-not $CertificatePassword) {
    $passwordPath = Join-Path $repoRoot '.tools\signing\pronto-signing-password.dpapi'
    if (Test-Path -LiteralPath $passwordPath -PathType Leaf) {
        [void][Reflection.Assembly]::LoadWithPartialName('System.Security')
        $encryptedPassword = ([IO.File]::ReadAllText($passwordPath)).Trim()
        if ($encryptedPassword.Length % 2 -ne 0 -or $encryptedPassword -notmatch '^[a-fA-F0-9]+$') {
            throw 'The encrypted certificate password file is invalid.'
        }
        $protectedBytes = New-Object byte[] ($encryptedPassword.Length / 2)
        for ($i = 0; $i -lt $protectedBytes.Length; $i++) {
            $protectedBytes[$i] = [Convert]::ToByte($encryptedPassword.Substring($i * 2, 2), 16)
        }
        $passwordBytes = [Security.Cryptography.ProtectedData]::Unprotect($protectedBytes, $null, [Security.Cryptography.DataProtectionScope]::CurrentUser)
        $CertificatePassword = [Text.Encoding]::Unicode.GetString($passwordBytes)
        [Array]::Clear($passwordBytes, 0, $passwordBytes.Length)
        [Array]::Clear($protectedBytes, 0, $protectedBytes.Length)
    }
}
if (-not $CertificatePassword) {
    throw 'Set PRONTO_ZXP_CERT_PASSWORD or run npm run certificate:create first.'
}

$resolvedTool = (Resolve-Path -LiteralPath $ToolPath).Path
$resolvedCertificate = (Resolve-Path -LiteralPath $CertificatePath).Path
$distDir = Join-Path $repoRoot 'dist'
$outputPath = Join-Path $distDir "PRONTO-$version.zxp"
New-Item -ItemType Directory -Path $distDir -Force | Out-Null
if (Test-Path -LiteralPath $outputPath) { Remove-Item -LiteralPath $outputPath -Force }

& node (Join-Path $extensionDir 'tests\run-tests.cjs')
if ($LASTEXITCODE -ne 0) { throw 'Tests failed; ZXP was not signed.' }
& powershell -NoLogo -NoProfile -ExecutionPolicy Bypass -File (Join-Path $extensionDir 'hotkey-daemon.ps1') -ValidateOnly
if ($LASTEXITCODE -ne 0) { throw 'Hotkey helper validation failed; ZXP was not signed.' }

$signArgs = @('-sign', $extensionDir, $outputPath, $resolvedCertificate, $CertificatePassword)
if ($TimestampUrl) { $signArgs += @('-tsa', $TimestampUrl) }
& $resolvedTool @signArgs
if ($LASTEXITCODE -ne 0 -or -not (Test-Path -LiteralPath $outputPath -PathType Leaf)) {
    throw "ZXPSignCmd failed to create $outputPath"
}

& $resolvedTool -verify $outputPath -certinfo
if ($LASTEXITCODE -ne 0) {
    Remove-Item -LiteralPath $outputPath -Force
    throw 'ZXP signature verification failed; the invalid artifact was removed.'
}
Write-Host "Created and verified signed ZXP: $outputPath" -ForegroundColor Green
$CertificatePassword = $null
