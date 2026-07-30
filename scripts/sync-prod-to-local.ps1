<#
.SYNOPSIS
  Mirrors the Railway production database into the local Postgres database.

.DESCRIPTION
  Dumps production first, and only touches the local database once a healthy
  dump exists on disk. A network blip therefore leaves local untouched rather
  than dropped-and-empty.

  The local database is DESTROYED and replaced on every run. Anything created
  locally since the last sync is gone. That is intentional: local is a
  disposable mirror of production.

  Credentials come from scripts/.env.sync (gitignored). Never hardcode them here.

.EXAMPLE
  npm run db:sync-prod
  powershell -NoProfile -ExecutionPolicy Bypass -File scripts/sync-prod-to-local.ps1
#>
[CmdletBinding()]
param(
    # Path to the env file holding PROD_DATABASE_URL / LOCAL_DATABASE_URL.
    [string]$EnvFile
)

$ErrorActionPreference = 'Stop'
Set-StrictMode -Version Latest

$Root = Split-Path -Parent $PSScriptRoot
if (-not $EnvFile) { $EnvFile = Join-Path $PSScriptRoot '.env.sync' }

$LogDir = Join-Path $PSScriptRoot 'logs'
if (-not (Test-Path $LogDir)) { New-Item -ItemType Directory -Path $LogDir | Out-Null }
$LogFile = Join-Path $LogDir ("sync-{0}.log" -f (Get-Date -Format 'yyyy-MM-dd'))

function Write-Log {
    param([string]$Message, [string]$Level = 'INFO')
    $line = "{0} [{1}] {2}" -f (Get-Date -Format 'yyyy-MM-dd HH:mm:ss'), $Level, $Message
    Write-Host $line
    Add-Content -Path $LogFile -Value $line -Encoding utf8
}

function Read-EnvFile {
    param([string]$Path)
    if (-not (Test-Path $Path)) {
        throw "Config file not found: $Path`nCopy scripts/.env.sync.example to scripts/.env.sync and fill in the two connection strings."
    }
    $map = @{}
    foreach ($raw in (Get-Content -Path $Path)) {
        $line = $raw.Trim()
        if ($line -eq '' -or $line.StartsWith('#')) { continue }
        $split = $line.IndexOf('=')
        if ($split -lt 1) { continue }
        $key = $line.Substring(0, $split).Trim()
        $value = $line.Substring($split + 1).Trim()
        # Strip one layer of matching quotes, if present.
        if ($value.Length -ge 2 -and
            (($value.StartsWith('"') -and $value.EndsWith('"')) -or
             ($value.StartsWith("'") -and $value.EndsWith("'")))) {
            $value = $value.Substring(1, $value.Length - 2)
        }
        $map[$key] = $value
    }
    return $map
}

# Runs a Postgres CLI tool and returns its exit code. stdout/stderr are captured
# to temp files rather than redirected inline: PowerShell 5.1 turns native stderr
# into error records, which would make a benign warning look like a failure.
function Invoke-Pg {
    param(
        [string]$Exe,
        [string[]]$Arguments,
        [string]$Label,
        [switch]$EchoStdOut
    )
    $outFile = [System.IO.Path]::GetTempFileName()
    $errFile = [System.IO.Path]::GetTempFileName()
    try {
        $quoted = @()
        foreach ($a in $Arguments) {
            if ($a -match '[\s"]') {
                # CommandLineToArgvW rules: backslashes are literal unless they
                # precede a quote, so double them there, and escape the quote.
                # Without this, quoted SQL identifiers like "Employee" arrive bare.
                $escaped = [regex]::Replace($a, '(\\*)"', '$1$1\"')
                $escaped = [regex]::Replace($escaped, '(\\+)$', '$1$1')
                $quoted += ('"' + $escaped + '"')
            }
            else { $quoted += $a }
        }
        $proc = Start-Process -FilePath $Exe -ArgumentList $quoted -NoNewWindow -Wait -PassThru `
            -RedirectStandardOutput $outFile -RedirectStandardError $errFile
        $stdErr = (Get-Content -Path $errFile -Raw -ErrorAction SilentlyContinue)
        if ($stdErr) {
            foreach ($l in ($stdErr -split "`r?`n")) {
                if ($l.Trim()) { Write-Log "$Label : $l" 'TOOL' }
            }
        }
        if ($EchoStdOut) {
            $stdOut = (Get-Content -Path $outFile -Raw -ErrorAction SilentlyContinue)
            if ($stdOut) { $script:LastStdOut = $stdOut.Trim() } else { $script:LastStdOut = '' }
        }
        return $proc.ExitCode
    }
    finally {
        Remove-Item $outFile, $errFile -Force -ErrorAction SilentlyContinue
    }
}

# Only one sync at a time. A slow run must not collide with the next trigger.
$mutex = New-Object System.Threading.Mutex($false, 'Local\PlethoraDbSync')
if (-not $mutex.WaitOne(0)) {
    Write-Log 'Another sync is already running; exiting without changes.' 'WARN'
    exit 0
}

$dumpFile = $null
$exitCode = 1

try {
    Write-Log '==> Plethora prod -> local database sync starting'

    # ---- 1. Config -------------------------------------------------------
    $cfg = Read-EnvFile -Path $EnvFile
    foreach ($required in @('PROD_DATABASE_URL', 'LOCAL_DATABASE_URL')) {
        if (-not $cfg.ContainsKey($required) -or -not $cfg[$required]) {
            throw "$required is missing or empty in $EnvFile"
        }
    }
    $prodUrl = $cfg['PROD_DATABASE_URL']
    $localUrl = $cfg['LOCAL_DATABASE_URL']

    $pgBin = 'C:\Program Files\PostgreSQL\18\bin'
    if ($cfg.ContainsKey('PG_BIN') -and $cfg['PG_BIN']) { $pgBin = $cfg['PG_BIN'] }

    # ---- 2. Tools --------------------------------------------------------
    # Absolute paths matter: Task Scheduler does not inherit an interactive PATH.
    $pgDump = Join-Path $pgBin 'pg_dump.exe'
    $pgRestore = Join-Path $pgBin 'pg_restore.exe'
    $psql = Join-Path $pgBin 'psql.exe'
    foreach ($tool in @($pgDump, $pgRestore, $psql)) {
        if (-not (Test-Path $tool)) { throw "Postgres tool not found: $tool  (check PG_BIN in $EnvFile)" }
    }

    # ---- 3. Local target -------------------------------------------------
    # Split the URL by hand rather than via [Uri]/UriBuilder, which would
    # re-encode the password and break the %40 in it.
    $noQuery = $localUrl.Split('?')[0]
    $slash = $noQuery.LastIndexOf('/')
    if ($slash -lt 0) { throw "LOCAL_DATABASE_URL has no database path: $localUrl" }
    $dbName = [Uri]::UnescapeDataString($noQuery.Substring($slash + 1))
    $maintenanceUrl = $noQuery.Substring(0, $slash + 1) + 'postgres'
    if (-not $dbName) { throw 'LOCAL_DATABASE_URL does not name a database.' }
    if ($dbName -in @('postgres', 'template0', 'template1')) {
        throw "Refusing to drop the '$dbName' maintenance database."
    }
    $dbIdent = '"' + $dbName.Replace('"', '""') + '"'
    Write-Log "Target local database: $dbName"

    $env:PGCONNECT_TIMEOUT = '30'

    # ---- 4. Dump production ---------------------------------------------
    # Deliberately BEFORE any destructive local step.
    $stamp = Get-Date -Format 'yyyyMMdd-HHmmss'
    $dumpFile = Join-Path $env:TEMP "plethora-sync-$stamp.dump"
    Write-Log '==> Dumping production...'
    $code = Invoke-Pg -Exe $pgDump -Label 'pg_dump' -Arguments @(
        '--format=custom'
        '--no-owner'
        '--no-privileges'
        "--file=$dumpFile"
        $prodUrl
    )
    if ($code -ne 0) { throw "pg_dump failed with exit code $code. Local database left untouched." }
    if (-not (Test-Path $dumpFile)) { throw 'pg_dump reported success but produced no file. Local database left untouched.' }
    $dumpSize = (Get-Item $dumpFile).Length
    if ($dumpSize -lt 102400) {
        throw ("Dump is only $dumpSize bytes - suspiciously small, treating as failed. Local database left untouched.")
    }
    Write-Log ("Dump OK: {0:N1} MB" -f ($dumpSize / 1MB))

    # ---- 5. Recreate local ----------------------------------------------
    # FORCE terminates open connections, including a running dev API's Prisma pool.
    Write-Log "==> Recreating local database $dbName..."
    $code = Invoke-Pg -Exe $psql -Label 'psql' -Arguments @(
        '--variable=ON_ERROR_STOP=1'
        $maintenanceUrl
        '-c', "DROP DATABASE IF EXISTS $dbIdent WITH (FORCE);"
        '-c', "CREATE DATABASE $dbIdent;"
    )
    if ($code -ne 0) { throw "Failed to recreate local database (exit $code). The dump is intact at $dumpFile" }

    # ---- 6. Restore ------------------------------------------------------
    Write-Log '==> Restoring into local...'
    $code = Invoke-Pg -Exe $pgRestore -Label 'pg_restore' -Arguments @(
        '--no-owner'
        '--no-privileges'
        '--jobs=4'
        "--dbname=$localUrl"
        $dumpFile
    )
    if ($code -ne 0) { throw "pg_restore failed with exit code $code." }

    # ---- 7. Sanity check -------------------------------------------------
    # Prisma generates quoted PascalCase table names here - "User", not users.
    $script:LastStdOut = ''
    $code = Invoke-Pg -Exe $psql -Label 'psql' -EchoStdOut -Arguments @(
        '-tAc'
        'SELECT (SELECT count(*) FROM "User") || '' users, '' || (SELECT count(*) FROM "Employee") || '' employees, '' || (SELECT count(*) FROM "_prisma_migrations") || '' migrations'''
        $localUrl
    )
    if ($code -eq 0 -and $script:LastStdOut) {
        Write-Log "Restored: $($script:LastStdOut)"
    }
    else {
        Write-Log 'Row-count check did not return a result; inspect the database manually.' 'WARN'
    }

    Write-Log '==> Sync complete. Restart the dev API if it was running.'
    $exitCode = 0
}
catch {
    Write-Log $_.Exception.Message 'ERROR'
    $exitCode = 1
}
finally {
    # The dump holds real employee PII and payroll data - do not leave it lying around.
    if ($dumpFile -and (Test-Path $dumpFile)) {
        Remove-Item $dumpFile -Force -ErrorAction SilentlyContinue
    }
    Get-ChildItem -Path $LogDir -Filter 'sync-*.log' -ErrorAction SilentlyContinue |
        Where-Object { $_.LastWriteTime -lt (Get-Date).AddDays(-14) } |
        Remove-Item -Force -ErrorAction SilentlyContinue
    $mutex.ReleaseMutex()
    $mutex.Dispose()
}

exit $exitCode
