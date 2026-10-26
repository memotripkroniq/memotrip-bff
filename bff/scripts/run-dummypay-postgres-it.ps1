$ErrorActionPreference = 'Stop'
$pgBin = 'C:\Program Files\PostgreSQL\17\bin'
$repoRoot = Split-Path $PSScriptRoot -Parent
$runId = [Guid]::NewGuid().ToString('N')
$testRoot = Join-Path ([IO.Path]::GetTempPath()) "memotrip-dummypay-isolated-it-$runId"
$dataPath = Join-Path $testRoot 'data'
$databaseName = "dummypay_it_$runId"
$testOwner = 'dummypay_it_owner'
$password = [Guid]::NewGuid().ToString('N')
$listener = [Net.Sockets.TcpListener]::new([Net.IPAddress]::Loopback, 0)
$listener.Start()
$testPort = $listener.LocalEndpoint.Port
$listener.Stop()
$started = $false
$savedDatabaseUrl = $env:DATABASE_URL
$savedPgPassword = $env:PGPASSWORD
$savedTestUrl = $env:DUMMYPAY_IT_URL
$savedMarker = $env:DUMMYPAY_IT_MARKER
$savedPort = $env:DUMMYPAY_IT_PORT
$savedName = $env:DUMMYPAY_IT_DATABASE
$savedNodeEnv = $env:NODE_ENV
function Assert-Exit { if ($LASTEXITCODE -ne 0) { throw "Command failed with exit code $LASTEXITCODE" } }
try {
    New-Item -ItemType Directory -Path $testRoot | Out-Null
    Set-Content -LiteralPath (Join-Path $testRoot 'ISOLATED_TEST_CLUSTER') -Value $runId
    $passwordFile = Join-Path $testRoot 'init-password'
    Set-Content -LiteralPath $passwordFile -Value $password -NoNewline
    & "$pgBin\initdb.exe" -D $dataPath -U $testOwner --auth=scram-sha-256 --pwfile=$passwordFile --encoding=UTF8 --locale=C | Out-Null
    Assert-Exit
    Remove-Item -LiteralPath $passwordFile
    # Separate redirected handles prevent the background server inheriting the calling tool's pipes.
    $startArgs = "-D `"$dataPath`" -l `"$(Join-Path $testRoot 'server.log')`" -o `"-h 127.0.0.1 -p $testPort`" -w start"
    $starter = Start-Process -FilePath "$pgBin\pg_ctl.exe" -ArgumentList $startArgs -WindowStyle Hidden -PassThru -RedirectStandardOutput (Join-Path $testRoot 'start.stdout') -RedirectStandardError (Join-Path $testRoot 'start.stderr')
    $started = $true
    if (!$starter.WaitForExit(30000)) { throw 'Test cluster starter timed out' }
    if ($starter.ExitCode -ne 0) { throw 'Test cluster failed to start' }
    $env:PGPASSWORD = $password
    & "$pgBin\psql.exe" -X -h 127.0.0.1 -p $testPort -U $testOwner -d postgres -v ON_ERROR_STOP=1 -c "CREATE DATABASE $databaseName" | Out-Null
    Assert-Exit
    & "$pgBin\psql.exe" -X -h 127.0.0.1 -p $testPort -U $testOwner -d $databaseName -v ON_ERROR_STOP=1 -c "COMMENT ON DATABASE $databaseName IS 'MEMOTRIP_DUMMYPAY_ISOLATED_IT'" | Out-Null
    Assert-Exit
    $env:DATABASE_URL = "postgresql://${testOwner}:${password}@127.0.0.1:${testPort}/${databaseName}?schema=public&connection_limit=1"
    $env:DUMMYPAY_IT_URL = $env:DATABASE_URL
    $env:DUMMYPAY_IT_MARKER = 'MEMOTRIP_DUMMYPAY_ISOLATED_IT'
    $env:DUMMYPAY_IT_PORT = "$testPort"
    $env:DUMMYPAY_IT_DATABASE = $databaseName
    $env:NODE_ENV = 'development'
    # Validate both the destination and server identity before any schema migration.
    $parsed = [Uri]$env:DATABASE_URL
    if ($parsed.Host -ne '127.0.0.1' -or $parsed.Port -ne $testPort -or $parsed.AbsolutePath -ne "/$databaseName" -or
        !(Test-Path -LiteralPath (Join-Path $testRoot 'ISOLATED_TEST_CLUSTER'))) { throw 'Unsafe migration destination' }
    $identity = & "$pgBin\psql.exe" -X -h 127.0.0.1 -p $testPort -U $testOwner -d $databaseName -At -v ON_ERROR_STOP=1 -c "SELECT current_database(), inet_server_addr(), inet_server_port(), shobj_description(oid, 'pg_database'), current_setting('data_directory') FROM pg_database WHERE datname=current_database()"
    Assert-Exit
    $expected = "$databaseName|127.0.0.1|$testPort|MEMOTRIP_DUMMYPAY_ISOLATED_IT|$($dataPath.Replace('\','/'))"
    if ($identity.Replace('\','/') -ne $expected) { throw 'Server identity or cluster marker mismatch' }
    # Copy only schema/migrations: Prisma runs outside the application tree and cannot load its .env.
    $prismaPath = Join-Path $testRoot 'prisma'
    New-Item -ItemType Directory -Path $prismaPath | Out-Null
    Copy-Item -LiteralPath (Join-Path $repoRoot 'prisma\schema.prisma') -Destination $prismaPath
    Copy-Item -LiteralPath (Join-Path $repoRoot 'prisma\migrations') -Destination $prismaPath -Recurse
    Push-Location $testRoot
    try {
        & node (Join-Path $repoRoot 'node_modules\prisma\build\index.js') migrate deploy --schema (Join-Path $prismaPath 'schema.prisma')
        Assert-Exit
    } finally { Pop-Location }
    Write-Output "Isolated PostgreSQL: 127.0.0.1:$testPort / $databaseName"
    & node (Join-Path $repoRoot 'node_modules\ts-node\dist\bin.js') --project (Join-Path $repoRoot 'tsconfig.json') (Join-Path $repoRoot 'scripts\dummypay-postgres-it.ts')
    Assert-Exit
} finally {
    if ($started) {
        & "$pgBin\pg_ctl.exe" -D $dataPath -m fast -w stop | Out-Null
        if ($LASTEXITCODE -ne 0) { Write-Warning "Test cluster stop failed: $testRoot" }
        else { Write-Output "Test cluster stopped; isolated artifacts retained at $testRoot" }
    }
    $env:DATABASE_URL = $savedDatabaseUrl
    $env:PGPASSWORD = $savedPgPassword
    $env:DUMMYPAY_IT_URL = $savedTestUrl
    $env:DUMMYPAY_IT_MARKER = $savedMarker
    $env:DUMMYPAY_IT_PORT = $savedPort
    $env:DUMMYPAY_IT_DATABASE = $savedName
    $env:NODE_ENV = $savedNodeEnv
}
