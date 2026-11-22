$ErrorActionPreference = 'Stop'
$poidemRoot = Split-Path -Parent $PSScriptRoot
$poidemEnv = Join-Path $poidemRoot '.env'
if (Test-Path -LiteralPath $poidemEnv) {
    throw '.env уже существует. Скрипт не перезаписывает ваши настройки.'
}

function New-PoidemPassword {
    $poidemBytes = New-Object byte[] 32
    $poidemRng = [Security.Cryptography.RandomNumberGenerator]::Create()
    try { $poidemRng.GetBytes($poidemBytes) } finally { $poidemRng.Dispose() }
    return [BitConverter]::ToString($poidemBytes).Replace('-', '').ToLowerInvariant()
}

$poidemAdmin = New-PoidemPassword
$poidemApp = New-PoidemPassword
$poidemMigration = New-PoidemPassword
$poidemValues = @{
    POSTGRES_PASSWORD = $poidemAdmin
    POSTGRES_APP_PASSWORD = $poidemApp
    POSTGRES_MIGRATION_PASSWORD = $poidemMigration
    DATABASE_URL = "postgresql+psycopg://poidem_app:${poidemApp}@127.0.0.1:5432/poidem"
    MIGRATION_DATABASE_URL = "postgresql+psycopg://poidem_migrator:${poidemMigration}@127.0.0.1:5432/poidem"
    DATABASE_URL_TEST = "postgresql+psycopg://poidem_app:${poidemApp}@127.0.0.1:5433/poidem_test"
    MIGRATION_DATABASE_URL_TEST = "postgresql+psycopg://poidem_migrator:${poidemMigration}@127.0.0.1:5433/poidem_test"
}
$poidemLines = Get-Content -LiteralPath (Join-Path $poidemRoot '.env.example') -Encoding UTF8
$poidemResult = foreach ($poidemLine in $poidemLines) {
    if ($poidemLine -match '^([A-Z_]+)=') {
        $poidemName = $Matches[1]
        if ($poidemValues.ContainsKey($poidemName)) {
            "$poidemName=$($poidemValues[$poidemName])"
            continue
        }
    }
    $poidemLine
}
[IO.File]::WriteAllLines($poidemEnv, [string[]]$poidemResult, [Text.UTF8Encoding]::new($false))
Write-Output '.env создан. Пароли не выводятся; файл исключён из Git.'
