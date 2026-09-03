param(
    [ValidateSet('Chrome', 'Edge', 'Both')]
    [string]$Browser = 'Both'
)

$ErrorActionPreference = 'Stop'
$nativeHostName = 'io.github.mivaille777.dsh_selection_companion'

function Remove-NativeHost([string]$RegistryPath) {
    if (Test-Path $RegistryPath) {
        Remove-Item -Path $RegistryPath -Recurse -Force
    }
}

if ($Browser -eq 'Chrome' -or $Browser -eq 'Both') {
    Remove-NativeHost "HKCU:\Software\Google\Chrome\NativeMessagingHosts\$nativeHostName"
}
if ($Browser -eq 'Edge' -or $Browser -eq 'Both') {
    Remove-NativeHost "HKCU:\Software\Microsoft\Edge\NativeMessagingHosts\$nativeHostName"
}

Write-Host "Native host registration removed: $nativeHostName"
