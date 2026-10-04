[CmdletBinding()]
param(
  [Parameter(Mandatory = $true)]
  [string]$ArchivePath,

  [Parameter(Mandatory = $true)]
  [string]$OutputReportPath
)

Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'
$PSNativeCommandUseErrorActionPreference = $false

function Invoke-Docker {
  param([string[]]$Arguments, [string]$Purpose)

  # Ошибки восстановления могут содержать значения строк. Не печатаем их в журнал.
  $commandOutput = @(& docker @Arguments 2>&1)
  if ($LASTEXITCODE -ne 0) {
    throw "$Purpose завершилось ошибкой Docker (код $LASTEXITCODE)."
  }

  return ($commandOutput | ForEach-Object { $_.ToString() }) -join "`n"
}

function Get-Container {
  param([string]$ContainerId)

  $json = Invoke-Docker -Arguments @('inspect', $ContainerId) -Purpose 'Проверка контейнера'
  return @($json | ConvertFrom-Json)[0]
}

function Assert-IsolatedContainer {
  param($Container, [string]$ContainerId, [string]$ContainerName, [string]$RunId)

  $labelValue = $Container.Config.Labels.'domitsa.restore-check'
  $ports = @($Container.HostConfig.PortBindings.PSObject.Properties)
  # Docker хранит tmpfs в HostConfig.Tmpfs, а Mounts может быть пустым даже после запуска.
  $dataTmpfs = $Container.HostConfig.Tmpfs.'/var/lib/postgresql/data'
  $persistentMounts = @($Container.Mounts | Where-Object { $_.Type -ne 'tmpfs' })
  $attachedNetworks = @($Container.NetworkSettings.Networks.PSObject.Properties.Name)
  $externalNetworks = @($attachedNetworks | Where-Object { $_ -ne 'none' })

  if ($Container.Id -ne $ContainerId -or $Container.Name -ne "/$ContainerName" -or
      $labelValue -ne $RunId -or $Container.HostConfig.NetworkMode -ne 'none' -or
      $ports.Count -ne 0 -or $persistentMounts.Count -ne 0 -or
      $dataTmpfs -ne 'rw,size=1g' -or -not $Container.HostConfig.ReadonlyRootfs -or
      $attachedNetworks.Count -gt 1 -or $externalNetworks.Count -ne 0) {
    throw 'Изоляция контейнера не подтверждена. Удаление и восстановление запрещены.'
  }
}

function Invoke-RestoreSql {
  param([string]$ContainerId, [string]$Sql)

  return Invoke-Docker -Arguments @(
    'exec', $ContainerId, 'psql', '-X', '-q', '-A', '-t',
    '-v', 'ON_ERROR_STOP=1', '-U', 'restore_check', '-d', 'domitsa_restore_check', '-c', $Sql
  ) -Purpose 'Проверка восстановленной базы'
}

function Copy-ArchiveToContainer {
  param([string]$ContainerId, [string]$SourcePath)

  # docker cp проверяет read-only rootfs до разрешения tmpfs. Передаём байты через
  # stdin собственного exec: файл всё равно создаётся только во временном /tmp.
  $copyProcess = [Diagnostics.Process]::new()
  $copyProcess.StartInfo = [Diagnostics.ProcessStartInfo]::new()
  $copyProcess.StartInfo.FileName = 'docker'
  $copyProcess.StartInfo.UseShellExecute = $false
  $copyProcess.StartInfo.CreateNoWindow = $true
  $copyProcess.StartInfo.RedirectStandardInput = $true
  $copyProcess.StartInfo.RedirectStandardOutput = $true
  $copyProcess.StartInfo.RedirectStandardError = $true
  foreach ($argument in @('exec', '-i', $ContainerId, 'sh', '-c', 'cat > /tmp/source.dump')) {
    $copyProcess.StartInfo.ArgumentList.Add($argument)
  }

  $sourceStream = $null
  $processStarted = $false
  try {
    $processStarted = $copyProcess.Start()
    if (-not $processStarted) {
      throw 'Не удалось запустить передачу архива.'
    }
    $stdoutRead = $copyProcess.StandardOutput.ReadToEndAsync()
    $stderrRead = $copyProcess.StandardError.ReadToEndAsync()
    $sourceStream = [IO.File]::OpenRead($SourcePath)
    $sourceStream.CopyTo($copyProcess.StandardInput.BaseStream)
    $copyProcess.StandardInput.Close()

    if (-not $copyProcess.WaitForExit(300000) -or $copyProcess.ExitCode -ne 0) {
      throw 'Передача архива не завершилась успешно.'
    }
    # Читаем stderr, чтобы не блокировать процесс, но не публикуем его содержимое.
    $null = $stdoutRead.GetAwaiter().GetResult()
    $null = $stderrRead.GetAwaiter().GetResult()
  } catch {
    throw 'Не удалось передать бинарный архив в tmpfs изолированного контейнера.'
  } finally {
    if ($null -ne $sourceStream) {
      $sourceStream.Dispose()
    }
    if ($processStarted -and -not $copyProcess.HasExited) {
      $copyProcess.Kill($true)
    }
    $copyProcess.Dispose()
  }
}

if (-not [IO.Path]::IsPathRooted($ArchivePath) -or
    -not [IO.Path]::IsPathRooted($OutputReportPath)) {
  throw 'ArchivePath и OutputReportPath должны быть абсолютными путями.'
}

$sourceFile = Get-Item -LiteralPath $ArchivePath
if ($sourceFile.PSIsContainer -or $sourceFile.Length -eq 0) {
  throw 'Нужен непустой файл резервной копии.'
}
$archiveFullPath = $sourceFile.FullName
$reportFullPath = [IO.Path]::GetFullPath($OutputReportPath)
if ($archiveFullPath -eq $reportFullPath -or (Test-Path -LiteralPath $reportFullPath)) {
  throw 'Отчёт должен быть новым файлом, отдельно от исходной копии.'
}

$archiveStream = [IO.File]::OpenRead($archiveFullPath)
try {
  $header = New-Object byte[] 5
  $bytesRead = $archiveStream.Read($header, 0, $header.Length)
  if ($bytesRead -ne 5 -or [Text.Encoding]::ASCII.GetString($header) -ne 'PGDMP') {
    throw 'Поддерживается только custom-архив PostgreSQL с заголовком PGDMP.'
  }
} finally {
  $archiveStream.Dispose()
}

$sourceHash = (Get-FileHash -LiteralPath $archiveFullPath -Algorithm SHA256).Hash.ToLowerInvariant()
$runId = [Guid]::NewGuid().ToString('N')
$containerName = "domitsa-restore-check-$runId"
$containerId = $null
$failure = $null
$cleanupFailure = $null
$startedAt = [DateTimeOffset]::UtcNow
$report = [ordered]@{
  version = 1
  status = 'pending'
  startedAt = $startedAt.ToString('o')
  archive = [ordered]@{ bytes = $sourceFile.Length; sha256 = $sourceHash; unchanged = $false }
  isolation = [ordered]@{
    containerName = $containerName
    image = 'pgvector/pgvector:pg17'
    network = 'none'
    publishedPorts = 0
    persistentMounts = 0
    dataTmpfsLimitBytes = 1073741824
    database = 'domitsa_restore_check'
    verified = $false
    removed = $false
  }
  checks = $null
}

try {
  # inspect не скачивает образ. run/create дополнительно запрещает любой pull.
  $imageJson = Invoke-Docker -Arguments @('image', 'inspect', 'pgvector/pgvector:pg17') -Purpose 'Проверка локального образа'
  $imageId = @($imageJson | ConvertFrom-Json)[0].Id
  $report.isolation.imageId = $imageId

  $containerId = (Invoke-Docker -Arguments @(
    'create', '--pull=never', '--name', $containerName,
    '--label', "domitsa.restore-check=$runId", '--network', 'none', '--restart', 'no',
    '--read-only', '--pids-limit', '128', '--memory', '1536m', '--cpus', '2',
    '--tmpfs', '/var/lib/postgresql/data:rw,size=1g',
    '--tmpfs', '/var/run/postgresql:rw,size=16m', '--tmpfs', '/tmp:rw,size=128m',
    '--env', 'POSTGRES_USER=restore_check', '--env', 'POSTGRES_DB=domitsa_restore_check',
    '--env', 'POSTGRES_HOST_AUTH_METHOD=trust', $imageId
  ) -Purpose 'Создание изолированной базы').Trim()
  if ($containerId -notmatch '^[a-f0-9]{64}$') {
    throw 'Docker не вернул точный ID созданного контейнера.'
  }

  $container = Get-Container -ContainerId $containerId
  Assert-IsolatedContainer -Container $container -ContainerId $containerId -ContainerName $containerName -RunId $runId
  $report.isolation.verified = $true
  $null = Invoke-Docker -Arguments @('start', $containerId) -Purpose 'Запуск изолированной базы'

  $ready = $false
  for ($attempt = 0; $attempt -lt 60; $attempt++) {
    # TCP включается только у основного сервера, не у временного сервера initdb.
    $null = & docker exec $containerId pg_isready -h 127.0.0.1 -U restore_check -d domitsa_restore_check 2>&1
    if ($LASTEXITCODE -eq 0) {
      $ready = $true
      break
    }
    Start-Sleep -Seconds 1
  }
  if (-not $ready) {
    throw 'Изолированная база не подготовилась за 60 секунд.'
  }

  $container = Get-Container -ContainerId $containerId
  Assert-IsolatedContainer -Container $container -ContainerId $containerId -ContainerName $containerName -RunId $runId

  Copy-ArchiveToContainer -ContainerId $containerId -SourcePath $archiveFullPath
  $copiedChecksum = Invoke-Docker -Arguments @('exec', $containerId, 'sha256sum', '/tmp/source.dump') -Purpose 'Проверка переданного архива'
  $copiedHash = ($copiedChecksum.Trim() -split '\s+')[0].ToLowerInvariant()
  $report.archive.copiedSha256 = $copiedHash
  if ($copiedHash -ne $sourceHash) {
    throw 'Переданный архив не совпал с контрольной суммой источника.'
  }
  $null = Invoke-Docker -Arguments @(
    'exec', '--env', 'PGOPTIONS=-c statement_timeout=300000', $containerId,
    'pg_restore', '--exit-on-error', '--no-owner', '--no-privileges',
    '-U', 'restore_check', '-d', 'domitsa_restore_check', '/tmp/source.dump'
  ) -Purpose 'Восстановление архива'

  $sql = @'
CREATE TEMP TABLE restore_table_counts (schema_name text, table_name text, row_count bigint);
CREATE TEMP TABLE restore_fk_counts (constraint_name text, orphan_count bigint);
DO $restore$
DECLARE
  relation record;
  foreign_key record;
  total bigint;
  join_predicate text;
  nonnull_predicate text;
BEGIN
  FOR relation IN
    SELECT schemaname, tablename FROM pg_tables
    WHERE schemaname IN ('public', 'drizzle') ORDER BY schemaname, tablename
  LOOP
    EXECUTE format('SELECT count(*) FROM %I.%I', relation.schemaname, relation.tablename) INTO total;
    INSERT INTO restore_table_counts VALUES (relation.schemaname, relation.tablename, total);
  END LOOP;

  FOR foreign_key IN
    SELECT c.oid, c.conname, c.conrelid, c.confrelid, c.conkey, c.confkey
    FROM pg_constraint c JOIN pg_class r ON r.oid = c.conrelid
    JOIN pg_namespace n ON n.oid = r.relnamespace
    WHERE c.contype = 'f' AND n.nspname = 'public'
  LOOP
    SELECT string_agg(format('child.%I = parent.%I', a.attname, b.attname), ' AND ' ORDER BY k.ordinality),
           string_agg(format('child.%I IS NOT NULL', a.attname), ' AND ' ORDER BY k.ordinality)
      INTO join_predicate, nonnull_predicate
    FROM unnest(foreign_key.conkey, foreign_key.confkey) WITH ORDINALITY AS k(child_key, parent_key, ordinality)
    JOIN pg_attribute a ON a.attrelid = foreign_key.conrelid AND a.attnum = k.child_key
    JOIN pg_attribute b ON b.attrelid = foreign_key.confrelid AND b.attnum = k.parent_key;
    EXECUTE format('SELECT count(*) FROM %s child WHERE %s AND NOT EXISTS (SELECT 1 FROM %s parent WHERE %s)',
      foreign_key.conrelid::regclass, nonnull_predicate, foreign_key.confrelid::regclass, join_predicate) INTO total;
    INSERT INTO restore_fk_counts VALUES (foreign_key.conname, total);
  END LOOP;
END $restore$;

SELECT jsonb_build_object(
  'database', current_database(),
  'schemas', (SELECT jsonb_agg(nspname ORDER BY nspname) FROM pg_namespace WHERE nspname IN ('public', 'drizzle')),
  'tables', (SELECT jsonb_agg(jsonb_build_object('schema', schema_name, 'table', table_name, 'rows', row_count) ORDER BY schema_name, table_name) FROM restore_table_counts),
  'vectorExtension', EXISTS (SELECT 1 FROM pg_extension WHERE extname = 'vector'),
  'constraints', (SELECT count(*) FROM pg_constraint c JOIN pg_class r ON r.oid = c.conrelid JOIN pg_namespace n ON n.oid = r.relnamespace WHERE n.nspname = 'public'),
  'invalidConstraints', (SELECT count(*) FROM pg_constraint c JOIN pg_class r ON r.oid = c.conrelid JOIN pg_namespace n ON n.oid = r.relnamespace WHERE n.nspname = 'public' AND NOT c.convalidated),
  'invalidIndexes', (SELECT count(*) FROM pg_index i JOIN pg_class r ON r.oid = i.indrelid JOIN pg_namespace n ON n.oid = r.relnamespace WHERE n.nspname = 'public' AND (NOT i.indisvalid OR NOT i.indisready)),
  'foreignKeys', (SELECT count(*) FROM restore_fk_counts),
  'orphanReferences', (SELECT coalesce(sum(orphan_count), 0) FROM restore_fk_counts),
  'migrations', (SELECT jsonb_agg(jsonb_build_object('hash', hash, 'createdAt', created_at) ORDER BY created_at) FROM drizzle.__drizzle_migrations),
  'invariants', jsonb_build_object(
    'readyConceptsWithoutRender', (SELECT count(*) FROM public.concepts WHERE status = 'ready' AND nullif(btrim(render_url), '') IS NULL),
    'readyExportsWithoutPdfKey', (SELECT count(*) FROM public.project_exports WHERE status = 'ready' AND nullif(btrim(pdf_key), '') IS NULL),
    'nonPositiveShoppingQuantity', (SELECT count(*) FROM public.shopping_list_items WHERE quantity <= 0)
  )
);
'@
  $checks = (Invoke-RestoreSql -ContainerId $containerId -Sql $sql) | ConvertFrom-Json
  $report.checks = $checks

  $requiredTables = @(
    'users', 'accounts', 'sessions', 'verifications', 'projects', 'rooms', 'concepts',
    'style_votes', 'catalog_items', 'concept_objects', 'shopping_lists', 'shopping_list_items',
    'project_exports', 'purchases', 'subscriptions', 'audit_log', 'chat_messages',
    'project_collaborators', 'project_invites', 'concept_plan_reviews'
  )
  $restoredTables = @($checks.tables | Where-Object { $_.schema -eq 'public' } | ForEach-Object { $_.table })
  $missingTables = @($requiredTables | Where-Object { $_ -notin $restoredTables })
  $report.checks | Add-Member -NotePropertyName missingRequiredTables -NotePropertyValue $missingTables

  $repoRoot = [IO.Path]::GetFullPath((Join-Path $PSScriptRoot '../..'))
  $migrationDirectory = Join-Path $repoRoot 'packages/db/drizzle'
  $journal = Get-Content -LiteralPath (Join-Path $migrationDirectory 'meta/_journal.json') -Raw | ConvertFrom-Json
  $missingMigrations = @()
  foreach ($entry in $journal.entries) {
    $migrationPath = Join-Path $migrationDirectory "$($entry.tag).sql"
    $migrationHash = (Get-FileHash -LiteralPath $migrationPath -Algorithm SHA256).Hash.ToLowerInvariant()
    $matches = @($checks.migrations | Where-Object { $_.hash -eq $migrationHash -and $_.createdAt -eq $entry.when })
    if ($matches.Count -ne 1) {
      $missingMigrations += $entry.tag
    }
  }
  $report.checks | Add-Member -NotePropertyName expectedMigrationCount -NotePropertyValue @($journal.entries).Count
  $report.checks | Add-Member -NotePropertyName missingOrChangedMigrations -NotePropertyValue $missingMigrations

  $invalidInvariants = @($checks.invariants.PSObject.Properties | Where-Object { $_.Value -ne 0 })
  if ($checks.database -ne 'domitsa_restore_check' -or -not $checks.vectorExtension -or
      $missingTables.Count -ne 0 -or $missingMigrations.Count -ne 0 -or
      @($checks.migrations).Count -ne @($journal.entries).Count -or
      $checks.constraints -eq 0 -or $checks.foreignKeys -eq 0 -or
      $checks.invalidConstraints -ne 0 -or $checks.invalidIndexes -ne 0 -or
      $checks.orphanReferences -ne 0 -or $invalidInvariants.Count -ne 0) {
    throw 'Восстановление завершилось, но проверки схемы, миграций или связности данных не прошли. Подробности — только агрегаты в отчёте.'
  }
  $report.status = 'passed'
} catch {
  $failure = $_.Exception.Message
  $report.status = 'failed'
  $report.error = $failure
} finally {
  try {
    $finalHash = (Get-FileHash -LiteralPath $archiveFullPath -Algorithm SHA256).Hash.ToLowerInvariant()
    $report.archive.unchanged = $finalHash -eq $sourceHash
    if (-not $report.archive.unchanged) {
      $report.status = 'failed'
      $failure = 'Контрольная сумма исходного архива изменилась.'
      $report.error = $failure
    }
  } catch {
    $report.status = 'failed'
    $failure = 'Не удалось повторно проверить исходный архив.'
    $report.error = $failure
  }

  if ($null -ne $containerId) {
    try {
      $container = Get-Container -ContainerId $containerId
      Assert-IsolatedContainer -Container $container -ContainerId $containerId -ContainerName $containerName -RunId $runId
      $null = Invoke-Docker -Arguments @('rm', '--force', $containerId) -Purpose 'Удаление своего временного контейнера'
      $report.isolation.removed = $true
    } catch {
      $cleanupFailure = 'Свой временный контейнер не удалён: проверка принадлежности или удаление не прошли. Чужие ресурсы не затронуты.'
      $report.status = 'failed'
      $report.cleanupError = $cleanupFailure
    }
  }

  $report.finishedAt = [DateTimeOffset]::UtcNow.ToString('o')
  $report.durationSeconds = [Math]::Round(([DateTimeOffset]::UtcNow - $startedAt).TotalSeconds, 2)
  $reportDirectory = [IO.Path]::GetDirectoryName($reportFullPath)
  $null = [IO.Directory]::CreateDirectory($reportDirectory)
  [IO.File]::WriteAllText($reportFullPath, ($report | ConvertTo-Json -Depth 12), [Text.UTF8Encoding]::new($false))
}

if ($null -ne $failure -or $null -ne $cleanupFailure) {
  throw 'Проверка копии не пройдена. См. JSON-отчёт; исходный архив сохранён.'
}

Write-Output "Копия восстановлена и проверена. Временный контейнер удалён. Отчёт: $reportFullPath"
