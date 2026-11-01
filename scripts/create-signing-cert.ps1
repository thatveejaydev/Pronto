[CmdletBinding()]
param(
    [string]$CountryCode = 'TW',
    [string]$StateOrProvince = 'Taiwan',
    [string]$Organization = 'PRONTO',
    [string]$CommonName = 'Vee Jay',
    [int]$ValidityDays = 3650,
    [string]$ToolPath = $env:PRONTO_ZXP_SIGN_CMD
)

$ErrorActionPreference = 'Stop'
$repoRoot = [IO.Path]::GetFullPath((Join-Path $PSScriptRoot '..'))
if (-not $ToolPath) {
    $bundledTool = Join-Path $repoRoot '.tools\Adobe-CEP-Resources\ZXPSignCMD\4.1.3\x64\ZXPSignCmd.exe'
    if (Test-Path -LiteralPath $bundledTool -PathType Leaf) { $ToolPath = $bundledTool }
}
if (-not $ToolPath -or -not (Test-Path -LiteralPath $ToolPath -PathType Leaf)) {
    throw 'ZXPSignCmd was not found. Set PRONTO_ZXP_SIGN_CMD to its full path.'
}

$securePassword = Read-Host 'Choose a password for the PRONTO signing certificate' -AsSecureString
$confirmation = Read-Host 'Enter the password again' -AsSecureString
$first = [Runtime.InteropServices.Marshal]::SecureStringToBSTR($securePassword)
$second = [Runtime.InteropServices.Marshal]::SecureStringToBSTR($confirmation)
try {
    $plainPassword = [Runtime.InteropServices.Marshal]::PtrToStringBSTR($first)
    $plainConfirmation = [Runtime.InteropServices.Marshal]::PtrToStringBSTR($second)
    if (-not $plainPassword -or $plainPassword -ne $plainConfirmation) {
        throw 'Certificate passwords did not match or were empty.'
    }
    $certDir = Join-Path $repoRoot '.tools\signing'
    New-Item -ItemType Directory -Path $certDir -Force | Out-Null
    $certPath = Join-Path $certDir 'pronto-signing.p12'
    $passwordPath = Join-Path $certDir 'pronto-signing-password.dpapi'
    if (Test-Path -LiteralPath $certPath) {
        throw "A signing certificate already exists at $certPath. It was not overwritten."
    }
    & $ToolPath -selfSignedCert $CountryCode $StateOrProvince $Organization $CommonName $plainPassword $certPath -validityDays $ValidityDays
    if ($LASTEXITCODE -ne 0 -or -not (Test-Path -LiteralPath $certPath -PathType Leaf)) {
        throw 'ZXPSignCmd failed to create the signing certificate.'
    }
    [void][Reflection.Assembly]::LoadWithPartialName('System.Security')
    $passwordBytes = [Text.Encoding]::Unicode.GetBytes($plainPassword)
    $protectedBytes = [Security.Cryptography.ProtectedData]::Protect($passwordBytes, $null, [Security.Cryptography.DataProtectionScope]::CurrentUser)
    $encryptedPassword = -join ($protectedBytes | ForEach-Object { $_.ToString('x2') })
    [IO.File]::WriteAllText($passwordPath, $encryptedPassword, [Text.Encoding]::ASCII)
    [Array]::Clear($passwordBytes, 0, $passwordBytes.Length)
    [Array]::Clear($protectedBytes, 0, $protectedBytes.Length)
    Write-Host "Created certificate: $certPath" -ForegroundColor Green
    Write-Host 'Its password is encrypted for the current Windows user. Back up the certificate and password separately.' -ForegroundColor Yellow
} finally {
    if ($first -ne [IntPtr]::Zero) { [Runtime.InteropServices.Marshal]::ZeroFreeBSTR($first) }
    if ($second -ne [IntPtr]::Zero) { [Runtime.InteropServices.Marshal]::ZeroFreeBSTR($second) }
    $plainPassword = $null
    $plainConfirmation = $null
}
