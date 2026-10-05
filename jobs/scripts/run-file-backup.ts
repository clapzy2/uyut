import { createHash, randomUUID } from 'node:crypto'
import { mkdtemp, realpath, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { basename, dirname, join } from 'node:path'
import { GetObjectCommand, HeadObjectCommand, S3Client } from '@aws-sdk/client-s3'
import { z } from 'zod'
import {
  type FileBackupDatabaseArchive,
  uploadFileSnapshot,
  validateFileBackupStorage,
} from './external-file-backup'
import { pruneFileBackups } from './file-backup-retention'
import { captureFileSnapshot } from './file-snapshot'

const storageSchema = z
  .object({
    endpoint: z.string().url(),
    bucket: z.string().min(1),
    region: z.string().min(1),
    accessKey: z.string().min(1),
    secretKey: z.string().min(1),
  })
  .strict()
const configSchema = z
  .object({
    source: storageSchema,
    backup: storageSchema,
    databaseArchive: z
      .object({
        key: z
          .string()
          .startsWith('data/coolify/backups/databases/')
          .max(1024)
          .refine(
            (key) =>
              !key.split('/').some((segment) => !segment || segment === '.' || segment === '..'),
          ),
        bytes: z
          .number()
          .int()
          .positive()
          .max(64 * 1024 * 1024),
        createdAt: z.iso.datetime({ offset: true }),
      })
      .strict(),
  })
  .strict()
export type ScheduledFileBackupConfig = z.infer<typeof configSchema>

async function removeTemporaryBackup(directory: string, temporaryRoot: string) {
  const actual = await realpath(directory)
  if (
    actual !== directory ||
    dirname(actual) !== temporaryRoot ||
    !basename(actual).startsWith('domitsa-file-backup-')
  )
    throw new Error('Принадлежность временной папки не подтверждена; очистка отменена.')
  await rm(actual, { recursive: true })
}

function client(config: z.infer<typeof storageSchema>) {
  return new S3Client({
    endpoint: config.endpoint,
    region: config.region,
    forcePathStyle: true,
    maxAttempts: 1,
    credentials: { accessKeyId: config.accessKey, secretAccessKey: config.secretKey },
  })
}

/** Проверяем именно существующий внешний архив PostgreSQL, не фиктивную метку даты. */
async function databaseArchiveReference(
  database: S3Client,
  config: ScheduledFileBackupConfig,
  now: Date,
): Promise<FileBackupDatabaseArchive> {
  const saved = config.databaseArchive
  const age = now.getTime() - new Date(saved.createdAt).getTime()
  if (age < 0 || age > 26 * 60 * 60 * 1000) throw new Error('Нужна свежая завершённая копия базы.')
  const target = { Bucket: config.backup.bucket, Key: saved.key }
  const before = await database.send(new HeadObjectCommand(target), {
    abortSignal: AbortSignal.timeout(30000),
  })
  if (!before.ETag || before.ContentLength !== saved.bytes)
    throw new Error('Архив базы не подтверждён.')
  const archive = await database.send(new GetObjectCommand({ ...target, IfMatch: before.ETag }), {
    abortSignal: AbortSignal.timeout(60000),
  })
  if (!archive.Body || archive.ContentLength !== saved.bytes || archive.ETag !== before.ETag)
    throw new Error('Версия архива базы изменилась.')
  const hash = createHash('sha256')
  let bytes = 0
  let header = Buffer.alloc(0)
  for await (const chunk of archive.Body as AsyncIterable<Uint8Array>) {
    bytes += chunk.length
    if (bytes > saved.bytes) throw new Error('Архив базы больше заявленного размера.')
    if (header.length < 5)
      header = Buffer.concat([header, Buffer.from(chunk.subarray(0, 5 - header.length))])
    hash.update(chunk)
  }
  if (bytes !== saved.bytes || header.toString() !== 'PGDMP')
    throw new Error('Архив базы усечён или другого формата.')
  const after = await database.send(new HeadObjectCommand(target), {
    abortSignal: AbortSignal.timeout(30000),
  })
  if (
    after.ETag !== before.ETag ||
    after.ContentLength !== before.ContentLength ||
    after.VersionId !== before.VersionId
  )
    throw new Error('Архив базы изменился во время проверки.')
  return {
    ...saved,
    createdAt: new Date(saved.createdAt).toISOString(),
    sha256: hash.digest('hex'),
  }
}

export async function runScheduledFileBackup(raw: unknown, now = new Date()) {
  const config = configSchema.parse(raw)
  validateFileBackupStorage(config.source, config.backup)
  const source = client(config.source)
  const backup = client(config.backup)
  const temporaryRoot = await realpath(tmpdir())
  const directory = await mkdtemp(join(temporaryRoot, 'domitsa-file-backup-'))
  const generationId = randomUUID()
  let stage = 'database-archive'
  try {
    const archive = await databaseArchiveReference(backup, config, now)
    stage = 'source-snapshot'
    const snapshotPath = join(directory, 'snapshot')
    const snapshot = await captureFileSnapshot(
      source,
      config.source.bucket,
      snapshotPath,
      `pg-${archive.sha256}`,
    )
    stage = 'external-upload'
    const uploaded = await uploadFileSnapshot(
      join(snapshotPath, 'manifest.json'),
      config.source,
      config.backup,
      generationId,
      archive,
    )
    stage = 'retention'
    const retention = await pruneFileBackups(
      config.source,
      config.backup,
      uploaded.generationId,
      now,
    )
    return {
      status: 'passed',
      generationId: uploaded.generationId,
      files: uploaded.files,
      bytes: uploaded.bytes,
      databaseSha256: archive.sha256,
      databaseBackupAt: archive.createdAt,
      removedGenerations: retention.removed,
      sourceCommands: 'List/Get only',
      atomicDatabaseSnapshot: false,
      capturedAt: snapshot.capturedAt,
    }
  } catch (error) {
    const category =
      error instanceof Error && /^[A-Za-z][A-Za-z0-9_]{0,70}$/.test(error.name)
        ? error.name
        : 'unknown'
    const reason =
      error instanceof Error && error.message.includes('Приватность') ? 'privacy' : 'other'
    throw Object.assign(new Error('Файловая копия не принята.', { cause: error }), {
      stage,
      category,
      reason,
      generationId,
    })
  } finally {
    source.destroy()
    backup.destroy()
    await removeTemporaryBackup(directory, temporaryRoot)
  }
}

if (import.meta.main) {
  try {
    // Конфигурация с секретами поступает через stdin, не argv и не журнал службы.
    let input = ''
    for await (const chunk of process.stdin) {
      input += chunk.toString()
      if (Buffer.byteLength(input) > 64 * 1024) throw new Error('Конфигурация слишком велика.')
    }
    console.log(JSON.stringify(await runScheduledFileBackup(JSON.parse(input))))
  } catch (error) {
    const details = error as {
      stage?: string
      category?: string
      reason?: string
      generationId?: string
    }
    console.error(
      JSON.stringify({
        status: 'failed',
        stage: details?.stage ?? 'configuration-or-cleanup',
        category: details?.category ?? 'unknown',
        reason: details?.reason ?? 'other',
        generationId: details?.generationId ?? null,
        message:
          'Файловая копия не принята. Проверьте источник, внешний резерв и журнал службы. Секреты и ключи файлов скрыты.',
      }),
    )
    process.exitCode = 1
  }
}
