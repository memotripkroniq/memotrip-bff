param([Parameter(Mandatory=$true)][string]$ClusterRoot)
$ErrorActionPreference = 'Stop'
$pgBin = 'C:\Program Files\PostgreSQL\17\bin'
$repoRoot = Split-Path $PSScriptRoot -Parent
$resolvedRoot = (Resolve-Path -LiteralPath $ClusterRoot).Path
$expectedParent = [IO.Path]::GetFullPath([IO.Path]::GetTempPath()).TrimEnd('\')
$leaf = Split-Path $resolvedRoot -Leaf
if ((Split-Path $resolvedRoot -Parent) -ne $expectedParent -or $leaf -notmatch '^memotrip-dummypay-isolated-it-([a-f0-9]{32})$') { throw 'Not an isolated test cluster directory' }
$runId = $Matches[1]
if ((Get-Content -LiteralPath (Join-Path $resolvedRoot 'ISOLATED_TEST_CLUSTER') -Raw).Trim() -ne $runId) { throw 'Test marker mismatch' }
$dataPath = Join-Path $resolvedRoot 'data'
if ((Get-Content -LiteralPath (Join-Path $dataPath 'PG_VERSION') -Raw).Trim() -ne '17' -or (Test-Path -LiteralPath (Join-Path $dataPath 'postmaster.pid'))) { throw 'Cluster version mismatch or cluster already running' }
# Temp-directory preservation may omit empty PostgreSQL directories. Recreate only
# these known empty directories in this stopped, marker-verified synthetic cluster.
foreach ($relative in @('pg_commit_ts','pg_dynshmem','pg_notify','pg_replslot','pg_serial','pg_snapshots','pg_stat_tmp','pg_tblspc','pg_twophase','pg_logical\snapshots','pg_logical\mappings','pg_wal\archive_status','pg_wal\summaries')) {
    $emptyPath = Join-Path $dataPath $relative
    if (!(Test-Path -LiteralPath $emptyPath)) { New-Item -ItemType Directory -Path $emptyPath | Out-Null }
}
$databaseName = "dummypay_it_$runId"
$listener = [Net.Sockets.TcpListener]::new([Net.IPAddress]::Loopback, 0)
$listener.Start(); $testPort = $listener.LocalEndpoint.Port; $listener.Stop()
$runRoot = Join-Path $resolvedRoot "recovery-test-$([Guid]::NewGuid().ToString('N'))"
New-Item -ItemType Directory -Path $runRoot | Out-Null
# This already-migrated cluster contains synthetic test data only. A temporary HBA
# allows just its test owner on loopback; the original cluster configuration is untouched.
$hba = Join-Path $runRoot 'pg_hba.conf'
Set-Content -LiteralPath $hba -Value 'host all dummypay_it_owner 127.0.0.1/32 trust'
$names = @('DATABASE_URL','DUMMYPAY_IT_URL','DUMMYPAY_IT_MARKER','DUMMYPAY_IT_PORT','DUMMYPAY_IT_DATABASE','PGOPTIONS','PGPASSWORD','NODE_ENV')
$saved = @{}; foreach ($name in $names) { $saved[$name] = [Environment]::GetEnvironmentVariable($name, 'Process') }
$started = $false
try {
    $startArgs = "-D `"$dataPath`" -l `"$(Join-Path $runRoot 'server.log')`" -o `"-h 127.0.0.1 -p $testPort -c hba_file=$hba`" -w start"
    $starter = Start-Process -FilePath "$pgBin\pg_ctl.exe" -ArgumentList $startArgs -WindowStyle Hidden -PassThru -RedirectStandardOutput (Join-Path $runRoot 'start.stdout') -RedirectStandardError (Join-Path $runRoot 'start.stderr')
    $started = $true
    if (!$starter.WaitForExit(30000) -or $starter.ExitCode -ne 0) { throw 'Test cluster start failed' }
    $env:PGPASSWORD = ''
    $env:PGOPTIONS = '-c default_transaction_read_only=on -c statement_timeout=10000'
    $sql = "SELECT current_database(), inet_server_addr(), inet_server_port(), shobj_description(oid, 'pg_database'), current_setting('data_directory'), (SELECT count(*) FROM public.`"_prisma_migrations`" WHERE finished_at IS NOT NULL AND rolled_back_at IS NULL) FROM pg_database WHERE datname=current_database()"
    $identity = & "$pgBin\psql.exe" -X --no-password -h 127.0.0.1 -p $testPort -U dummypay_it_owner -d $databaseName -At -v ON_ERROR_STOP=1 -c $sql
    if ($LASTEXITCODE -ne 0) { throw 'Existing test schema identity read failed' }
    $expected = "$databaseName|127.0.0.1|$testPort|MEMOTRIP_DUMMYPAY_ISOLATED_IT|$($dataPath.Replace('\','/'))|23"
    if ($identity.Replace('\','/') -ne $expected) { throw 'Existing test database identity or schema mismatch' }
    $env:PGOPTIONS = ''
    $env:DUMMYPAY_IT_URL = "postgresql://dummypay_it_owner@127.0.0.1:${testPort}/${databaseName}?schema=public&connection_limit=1"
    $env:DATABASE_URL = $env:DUMMYPAY_IT_URL
    $env:DUMMYPAY_IT_MARKER = 'MEMOTRIP_DUMMYPAY_ISOLATED_IT'
    $env:DUMMYPAY_IT_PORT = "$testPort"
    $env:DUMMYPAY_IT_DATABASE = $databaseName
    $env:NODE_ENV = 'development'
    Write-Output 'Verified existing isolated PostgreSQL test schema; no migrations or schema changes executed.'
    & node (Join-Path $repoRoot 'node_modules\ts-node\dist\bin.js') --project (Join-Path $repoRoot 'tsconfig.json') (Join-Path $repoRoot 'scripts\dummypay-postgres-it.ts')
    if ($LASTEXITCODE -ne 0) { throw 'Integration tests failed' }
} finally {
    if ($started) {
        & "$pgBin\pg_ctl.exe" -D $dataPath -m fast -w stop | Out-Null
        if ($LASTEXITCODE -ne 0) { Write-Warning 'Isolated test cluster stop failed' }
        else { Write-Output 'Isolated test cluster stopped.' }
    }
    foreach ($name in $names) { [Environment]::SetEnvironmentVariable($name, $saved[$name], 'Process') }
}
