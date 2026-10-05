import { createHash, randomUUID } from 'node:crypto'
import { lstat, mkdir, readFile, writeFile } from 'node:fs/promises'
import { dirname, join, resolve } from 'node:path'
import {
  DeleteObjectCommand,
  GetObjectCommand,
  PutObjectCommand,
  S3Client,
} from '@aws-sdk/client-s3'
import { z } from 'zod'
import { loadFileSnapshot, parseFileSnapshotManifest } from './file-snapshot'

export type FileBackupSource = { endpoint: string; bucket: string }
export type FileBackupStorage = FileBackupSource & {
  region: string
  accessKey: string
  secretKey: string
}

const maxManifestBytes = 32 * 1024 * 1024
const generationSchema = z.uuid()
const databaseArchiveSchema = z
  .object({
    key: z
      .string()
      .max(1024)
      .startsWith('data/coolify/backups/databases/')
      .refine(
        (key) => !key.split('/').some((segment) => !segment || segment === '.' || segment === '..'),
      ),
    sha256: z.string().regex(/^[a-f0-9]{64}$/),
    bytes: z
      .number()
      .int()
      .min(1)
      .max(64 * 1024 * 1024),
    createdAt: z.iso.datetime(),
  })
  .strict()
export type FileBackupDatabaseArchive = z.infer<typeof databaseArchiveSchema>
const envelopeSchema = z
  .object({
    kind: z.literal('domitsa-files'),
    version: z.literal(1),
    sourceId: z.string().regex(/^[a-f0-9]{64}$/),
    uploadedAt: z.iso.datetime(),
    snapshot: z.unknown().transform((value) => parseFileSnapshotManifest(value)),
    databaseArchive: databaseArchiveSchema.optional(),
  })
  .strict()

function sha256(body: Uint8Array | string) {
  return createHash('sha256').update(body).digest('hex')
}

function normalizeEndpoint(endpoint: string) {
  const url = new URL(endpoint)
  const loopback = url.hostname === '[::1]' || /^127\.(\d{1,3}\.){2}\d{1,3}$/.test(url.hostname)
  if (
    (url.protocol !== 'https:' && !(url.protocol === 'http:' && loopback)) ||
    url.username ||
    url.password ||
    url.search ||
    url.hash ||
    url.pathname !== '/'
  )
    throw new Error('Резервное хранилище требует HTTPS или numeric loopback QA endpoint.')
  return url.toString()
}

export function validateFileBackupStorage(source: FileBackupSource, backup: FileBackupStorage) {
  const bucketSchema = z.string().regex(/^[a-z0-9][a-z0-9.-]{1,61}[a-z0-9]$/)
  bucketSchema.parse(source.bucket)
  bucketSchema.parse(backup.bucket)
  if (source.bucket === backup.bucket)
    throw new Error('Исходный и резервный бакеты должны различаться независимо от endpoint.')
  const sourceEndpoint = normalizeEndpoint(source.endpoint)
  const backupEndpoint = normalizeEndpoint(backup.endpoint)
  for (const value of [backup.region, backup.accessKey, backup.secretKey])
    z.string().min(1).parse(value)
  return {
    sourceId: sha256(JSON.stringify([sourceEndpoint, source.bucket])),
    sourceEndpoint,
    backupEndpoint,
  }
}

export function parseExternalFileBackupEnvelope(value: unknown, expectedSourceId: string) {
  const envelope = envelopeSchema.parse(value)
  if (envelope.sourceId !== expectedSourceId)
    throw new Error('Исходное хранилище не совпало с manifest.')
  if (
    envelope.databaseArchive &&
    envelope.snapshot.databaseBackupId !== `pg-${envelope.databaseArchive.sha256}`
  )
    throw new Error('Идентификатор снимка не соответствует архиву БД.')
  return envelope
}

function createClient(backup: FileBackupStorage, endpoint: string) {
  return new S3Client({
    endpoint,
    region: backup.region,
    forcePathStyle: true,
    maxAttempts: 1,
    credentials: { accessKeyId: backup.accessKey, secretAccessKey: backup.secretKey },
  })
}

async function validateLocalPath(path: string) {
  let current = resolve(path)
  while (true) {
    const info = await lstat(current)
    if (info.isSymbolicLink()) throw new Error('Ссылки в пути копии запрещены.')
    const parent = dirname(current)
    if (parent === current) break
    current = parent
  }
}

async function checkPrivate(endpoint: string, bucket: string, key: string) {
  const encodedKey = key.split('/').map(encodeURIComponent).join('/')
  const response = await fetch(`${endpoint}${bucket}/${encodedKey}`, {
    signal: AbortSignal.timeout(30000),
    redirect: 'error',
  })
  await response.body?.cancel()
  if (response.status !== 403) throw new Error('Приватность резервного объекта не подтверждена.')
}

async function readRemote(client: S3Client, bucket: string, key: string, expectedBytes?: number) {
  const signal = AbortSignal.timeout(30000)
  const result = await client.send(new GetObjectCommand({ Bucket: bucket, Key: key }), {
    abortSignal: signal,
  })
  const limit = expectedBytes ?? maxManifestBytes
  if (
    !result.Body ||
    result.ContentLength === undefined ||
    result.ContentLength < 0 ||
    result.ContentLength > limit ||
    (expectedBytes !== undefined && result.ContentLength !== expectedBytes)
  )
    throw new Error('Некорректный размер резервного объекта.')
  const chunks: Uint8Array[] = []
  let bytes = 0
  const iterator = (result.Body as AsyncIterable<Uint8Array>)[Symbol.asyncIterator]()
  let abortListener = () => {}
  const aborted = new Promise<never>((_, reject) => {
    abortListener = () => reject(signal.reason)
    signal.addEventListener('abort', abortListener, { once: true })
  })
  try {
    while (true) {
      signal.throwIfAborted()
      const chunk = await Promise.race([iterator.next(), aborted])
      if (chunk.done) break
      bytes += chunk.value.length
      if (bytes > limit) throw new Error('Резервный объект превышает заявленный размер.')
      chunks.push(chunk.value)
    }
  } catch (error) {
    // Do not wait for return() on a stream whose next() may already be stalled.
    void iterator.return?.().catch(() => {})
    throw error
  } finally {
    signal.removeEventListener('abort', abortListener)
  }
  if (bytes !== result.ContentLength) throw new Error('Резервный объект усечён.')
  return { body: Buffer.concat(chunks, bytes), contentType: result.ContentType }
}

async function putVerified(
  client: S3Client,
  backup: FileBackupStorage,
  endpoint: string,
  key: string,
  body: Buffer,
  contentType: string,
) {
  await client.send(
    new PutObjectCommand({
      Bucket: backup.bucket,
      Key: key,
      Body: body,
      ContentType: contentType,
      ACL: 'private',
      IfNoneMatch: '*',
    }),
    { abortSignal: AbortSignal.timeout(30000) },
  )
  const stored = await readRemote(client, backup.bucket, key, body.length)
  if (sha256(stored.body) !== sha256(body) || stored.contentType !== contentType)
    throw new Error('Не прошла сверка резервного объекта.')
  await checkPrivate(endpoint, backup.bucket, key)
}

async function verifyBackupPrivacy(
  client: S3Client,
  backup: FileBackupStorage,
  endpoint: string,
  prefix: string,
) {
  const key = `${prefix}/privacy-probe-${randomUUID()}.txt`
  const body = Buffer.from('domitsa-files privacy probe v1\n')
  const contentType = 'text/plain'
  let created = false
  try {
    await client.send(
      new PutObjectCommand({
        Bucket: backup.bucket,
        Key: key,
        Body: body,
        ContentType: contentType,
        ACL: 'private',
        IfNoneMatch: '*',
      }),
      { abortSignal: AbortSignal.timeout(30000) },
    )
    created = true
    const stored = await readRemote(client, backup.bucket, key, body.length)
    if (sha256(stored.body) !== sha256(body) || stored.contentType !== contentType)
      throw new Error('Не прошла сверка контрольного объекта приватности.')
    await checkPrivate(endpoint, backup.bucket, key)
  } finally {
    // Delete only our nonce after a confirmed conditional PUT, never an existing object.
    if (created)
      await client.send(new DeleteObjectCommand({ Bucket: backup.bucket, Key: key }), {
        abortSignal: AbortSignal.timeout(30000),
      })
  }
}

export async function uploadFileSnapshot(
  manifestPath: string,
  source: FileBackupSource,
  backup: FileBackupStorage,
  generationId: string = randomUUID(),
  databaseArchive?: FileBackupDatabaseArchive,
) {
  const { sourceId, backupEndpoint } = validateFileBackupStorage(source, backup)
  generationSchema.parse(generationId)
  const prefix = `domitsa-files/v1/${generationId}`
  const { manifest, directory } = await loadFileSnapshot(manifestPath)
  const envelope = parseExternalFileBackupEnvelope(
    {
      kind: 'domitsa-files',
      version: 1,
      sourceId,
      uploadedAt: new Date().toISOString(),
      snapshot: manifest,
      ...(databaseArchive ? { databaseArchive } : {}),
    },
    sourceId,
  )
  const envelopeBody = Buffer.from(JSON.stringify(envelope, null, 2))
  if (envelopeBody.length > maxManifestBytes) throw new Error('Резервный manifest превышает лимит.')
  const client = createClient(backup, backupEndpoint)
  try {
    // A missing object's 403 does not prove uploaded data will be private.
    await verifyBackupPrivacy(client, backup, backupEndpoint, prefix)
    for (const entry of manifest.entries) {
      const path = join(directory, entry.file)
      await validateLocalPath(path)
      const info = await lstat(path)
      if (!info.isFile() || info.size !== entry.bytes) throw new Error('Некорректный файл снимка.')
      const body = await readFile(path)
      if (sha256(body) !== entry.sha256) throw new Error('Не совпала контрольная сумма снимка.')
      await putVerified(
        client,
        backup,
        backupEndpoint,
        `${prefix}/objects/${entry.file}`,
        body,
        entry.contentType,
      )
    }
    await putVerified(
      client,
      backup,
      backupEndpoint,
      `${prefix}/manifest.json`,
      envelopeBody,
      'application/json',
    )
    return {
      generationId,
      files: manifest.entries.length,
      bytes: manifest.entries.reduce((sum, entry) => sum + entry.bytes, 0),
    }
  } finally {
    client.destroy()
  }
}

export async function downloadFileSnapshot(
  source: FileBackupSource,
  backup: FileBackupStorage,
  generationId: string,
  newDirectory: string,
) {
  const { sourceId, backupEndpoint } = validateFileBackupStorage(source, backup)
  generationSchema.parse(generationId)
  const prefix = `domitsa-files/v1/${generationId}`
  const client = createClient(backup, backupEndpoint)
  try {
    const remote = await readRemote(client, backup.bucket, `${prefix}/manifest.json`)
    if (remote.contentType !== 'application/json') throw new Error('Некорректный тип manifest.')
    const envelope = parseExternalFileBackupEnvelope(
      JSON.parse(remote.body.toString('utf8')),
      sourceId,
    )
    await checkPrivate(backupEndpoint, backup.bucket, `${prefix}/manifest.json`)
    const target = resolve(newDirectory)
    await validateLocalPath(dirname(target))
    await mkdir(target, { mode: 0o700 })
    for (const entry of envelope.snapshot.entries) {
      const key = `${prefix}/objects/${entry.file}`
      const object = await readRemote(client, backup.bucket, key, entry.bytes)
      if (sha256(object.body) !== entry.sha256 || object.contentType !== entry.contentType)
        throw new Error('Не прошла сверка скачанного объекта.')
      await checkPrivate(backupEndpoint, backup.bucket, key)
      await validateLocalPath(target)
      await writeFile(join(target, entry.file), object.body, { flag: 'wx', mode: 0o600 })
    }
    await validateLocalPath(target)
    const manifestPath = join(target, 'manifest.json')
    await writeFile(manifestPath, JSON.stringify(envelope.snapshot, null, 2), {
      flag: 'wx',
      mode: 0o600,
    })
    return {
      manifestPath,
      files: envelope.snapshot.entries.length,
      bytes: envelope.snapshot.entries.reduce((sum, entry) => sum + entry.bytes, 0),
    }
  } finally {
    client.destroy()
  }
}
