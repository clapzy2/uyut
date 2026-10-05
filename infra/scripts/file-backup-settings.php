<?php
// Only selected metadata; credentials go directly to the backup process via stdin.
try {
    require 'vendor/autoload.php';
    $app = require 'bootstrap/app.php';
    $app->make(Illuminate\Contracts\Console\Kernel::class)->bootstrap();

    $applicationUuid = getenv('DOMITSA_APPLICATION_UUID');
    $backupUuid = getenv('DOMITSA_DB_BACKUP_UUID');
    foreach ([$applicationUuid, $backupUuid] as $uuid) {
        if (!is_string($uuid) || !preg_match('/^[a-z0-9]{20,32}$/', $uuid)) {
            throw new RuntimeException('Invalid resource identifier');
        }
    }
    $application = App\Models\Application::where('uuid', $applicationUuid)->firstOrFail();
    $variables = App\Models\EnvironmentVariable::where('resourceable_type', App\Models\Application::class)
        ->where('resourceable_id', $application->id)
        ->where('is_preview', false)
        ->where('is_runtime', true)
        ->whereIn('key', ['DATABASE_URL', 'S3_ENDPOINT', 'S3_REGION', 'S3_BUCKET', 'S3_ACCESS_KEY', 'S3_SECRET_KEY'])
        ->get();
    $source = [];
    foreach ($variables as $variable) {
        $source[$variable->key] = $variable->real_value;
    }
    foreach (['DATABASE_URL', 'S3_ENDPOINT', 'S3_REGION', 'S3_BUCKET', 'S3_ACCESS_KEY', 'S3_SECRET_KEY'] as $key) {
        if (!isset($source[$key]) || !is_string($source[$key]) || $source[$key] === '') {
            throw new RuntimeException('Missing source configuration');
        }
    }
    $backup = App\Models\ScheduledDatabaseBackup::where('uuid', $backupUuid)->firstOrFail();
    if ($backup->database->uuid !== parse_url($source['DATABASE_URL'], PHP_URL_HOST)
        || !$backup->enabled || !$backup->save_s3 || !$backup->s3) {
        throw new RuntimeException('Database backup not linked to this application');
    }
    $execution = $backup->executions()->orderByDesc('created_at')->firstOrFail();
    if ($execution->status !== 'success' || !$execution->s3_uploaded) {
        throw new RuntimeException('Latest database backup is not complete');
    }
    $storage = $backup->s3;
    echo json_encode([
        'source' => [
            'endpoint' => $source['S3_ENDPOINT'], 'region' => $source['S3_REGION'],
            'bucket' => $source['S3_BUCKET'], 'accessKey' => $source['S3_ACCESS_KEY'],
            'secretKey' => $source['S3_SECRET_KEY'],
        ],
        'backup' => [
            'endpoint' => $storage->endpoint, 'region' => $storage->region,
            'bucket' => $storage->bucket, 'accessKey' => $storage->key,
            'secretKey' => $storage->secret,
        ],
        'databaseArchive' => [
            'key' => ltrim($execution->filename, '/'), 'bytes' => (int) $execution->size,
            'createdAt' => $execution->created_at->toIso8601String(),
        ],
    ], JSON_THROW_ON_ERROR);
} catch (Throwable $error) {
    fwrite(STDERR, "Backup configuration unavailable; private details hidden.\n");
    exit(1);
}
