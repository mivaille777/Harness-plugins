param(
    [Parameter(Mandatory = $true)]
    [ValidatePattern('^[a-p]{32}$')]
    [string]$ExtensionId,

    [string]$BinaryPath = '.\native\src-tauri\target\debug\dsh-selection-companion-host.exe',

    [ValidateSet('Chrome', 'Chromium', 'Edge', 'Both', 'All')]
    [string]$Browser = 'Both'
)

$ErrorActionPreference = 'Stop'
$nativeHostName = 'io.github.mivaille777.dsh_selection_companion'
$resolvedBinary = (Resolve-Path $BinaryPath).Path
$manifestDirectory = Join-Path $env:LOCALAPPDATA 'DeepSeekSelectionCompanion'
$manifestPath = Join-Path $manifestDirectory 'native-messaging-host.json'
New-Item -ItemType Directory -Path $manifestDirectory -Force | Out-Null

$manifest = [ordered]@{
    name = $nativeHostName
    description = 'DeepSeek Selection Companion browser native messaging host'
    path = $resolvedBinary
    type = 'stdio'
    allowed_origins = @("chrome-extension://$ExtensionId/")
}
$json = $manifest | ConvertTo-Json -Depth 6
[System.IO.File]::WriteAllText(
    $manifestPath,
    $json,
    (New-Object System.Text.UTF8Encoding($false))
)

function Register-NativeHost([string]$RegistryPath) {
    New-Item -Path $RegistryPath -Force | Out-Null
    Set-Item -Path $RegistryPath -Value $manifestPath
}

if ($Browser -eq 'Chrome' -or $Browser -eq 'Both' -or $Browser -eq 'All') {
    Register-NativeHost "HKCU:\Software\Google\Chrome\NativeMessagingHosts\$nativeHostName"
}
if ($Browser -eq 'Chromium' -or $Browser -eq 'All') {
    Register-NativeHost "HKCU:\Software\Chromium\NativeMessagingHosts\$nativeHostName"
}
if ($Browser -eq 'Edge' -or $Browser -eq 'Both' -or $Browser -eq 'All') {
    Register-NativeHost "HKCU:\Software\Microsoft\Edge\NativeMessagingHosts\$nativeHostName"
}

Write-Host "Native host registered: $nativeHostName"
Write-Host "Manifest: $manifestPath"
Write-Host "Binary:   $resolvedBinary"
Write-Host "Origin:   chrome-extension://$ExtensionId/"
Write-Host "Browser:  $Browser"
