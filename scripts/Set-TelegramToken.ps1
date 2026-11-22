$ErrorActionPreference = 'Stop'
$poidemEnv = Join-Path (Split-Path -Parent $PSScriptRoot) '.env'
if (-not (Test-Path -LiteralPath $poidemEnv)) {
    throw 'Сначала создайте .env через Initialize-LocalEnvironment.ps1.'
}
$poidemSecure = Read-Host 'Новый токен бота (ввод скрыт)' -AsSecureString
$poidemPointer = [Runtime.InteropServices.Marshal]::SecureStringToBSTR($poidemSecure)
try {
    $poidemValue = [Runtime.InteropServices.Marshal]::PtrToStringBSTR($poidemPointer)
    if ($poidemValue -notmatch '^[0-9]+:[A-Za-z0-9_-]{20,}$') {
        throw 'Формат токена не распознан. Значение не сохранено.'
    }
    $poidemText = [IO.File]::ReadAllText($poidemEnv, [Text.Encoding]::UTF8)
    $poidemLines = $poidemText -split '\r?\n'
    $poidemResult = foreach ($poidemLine in $poidemLines) {
        if ($poidemLine -match '^TELEGRAM_BOT_TOKEN=') { "TELEGRAM_BOT_TOKEN=$poidemValue" }
        else { $poidemLine }
    }
    if ($poidemText -notmatch '(?m)^TELEGRAM_BOT_TOKEN=') {
        $poidemResult += "TELEGRAM_BOT_TOKEN=$poidemValue"
    }
    [IO.File]::WriteAllLines($poidemEnv, [string[]]$poidemResult, [Text.UTF8Encoding]::new($false))
} finally {
    [Runtime.InteropServices.Marshal]::ZeroFreeBSTR($poidemPointer)
    Remove-Variable poidemValue -ErrorAction SilentlyContinue
    $poidemSecure.Dispose()
}
Write-Output 'Токен сохранён только в локальном .env. Перезапустите backend; значение не выводилось.'
