import { createHash, randomBytes } from 'node:crypto'
import { lstat, mkdir, readFile, writeFile } from 'node:fs/promises'
import { dirname, join, resolve } from 'node:path'
import {
  CreateBucketCommand,
  GetObjectCommand,
  HeadBucketCommand,
  ListObjectsV2Command,
  PutObjectCommand,
  S3Client,
} from '@aws-sdk/client-s3'
import { z } from 'zod'
import { validateRestoreTarget } from './check-file-restore'

const maxFiles = 10000
const maxObjectBytes = 64 * 1024 * 1024
const maxSnapshotBytes = 1024 * 1024 * 1024
const inventoryEntrySchema = z
  .object({
    key: z
      .string()
      .min(1)
      .max(1024)
      .refine(
        (key) => !key.split('/').some((segment) => segment === '.' || segment === '..'),
        'Точечные сегменты S3-ключа не поддерживаются проверкой приватности.',
      ),
    bytes: z.number().int().min(0).max(maxObjectBytes),
    etag: z.string().min(1),
  })
  .strict()
const manifestSchema = z
  .object({
    version: z.literal(1),
    databaseBackupId: z.string().regex(/^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/),
    capturedAt: z.iso.datetime(),
    entries: z
      .array(
        inventoryEntrySchema
          .extend({
            file: z.string().regex(/^[a-f0-9]{64}\.bin$/),
            sha256: z.string().regex(/^[a-f0-9]{64}$/),
            contentType: z.string().min(1).max(1024),
          })
          .strict(),
      )
      .max(maxFiles),
  })
  .strict()
type InventoryEntry = z.infer<typeof inventoryEntrySchema>
type FileManifest = z.infer<typeof manifestSchema>

function hash(body: Uint8Array | string) {
  return createHash('sha256').update(body).digest('hex')
}

function validateEntries(entries: InventoryEntry[]) {
  if (
    entries.length > maxFiles ||
    entries.reduce((sum, entry) => sum + entry.bytes, 0) > maxSnapshotBytes
  )
    throw new Error('Снимок превышает лимит файлов или 1 ГиБ.')
  if (new Set(entries.map((entry) => entry.key)).size !== entries.length)
    throw new Error('Повторный ключ объекта в снимке.')
}

/** ETag identifies the source revision; SHA-256 separately verifies saved bytes. */
export async function inventoryFileSnapshot(client: S3Client, bucket: string) {
  const entries: InventoryEntry[] = []
  const tokens = new Set<string>()
  let token: string | undefined
  do {
    const page = await client.send(
      new ListObjectsV2Command({
        Bucket: bucket,
        ContinuationToken: token,
      }),
      { abortSignal: AbortSignal.timeout(30000) },
    )
    for (const object of page.Contents ?? []) {
      entries.push(
        inventoryEntrySchema.parse({ key: object.Key, bytes: object.Size, etag: object.ETag }),
      )
    }
    validateEntries(entries)
    if (typeof page.IsTruncated !== 'boolean') throw new Error('Неполная страница инвентаризации.')
    if (!page.IsTruncated) break
    token = page.NextContinuationToken
    if (!token || tokens.has(token)) throw new Error('Нет нового токена полной инвентаризации.')
    tokens.add(token)
  } while (token)
  return entries.sort((left, right) => (left.key < right.key ? -1 : left.key > right.key ? 1 : 0))
}

/** Reject links in every existing path component, including the manifest itself. */
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

async function readObject(body: AsyncIterable<Uint8Array> | undefined, expectedBytes: number) {
  if (!body) throw new Error('Нет тела объекта.')
  const chunks: Uint8Array[] = []
  let bytes = 0
  for await (const chunk of body) {
    bytes += chunk.length
    if (bytes > expectedBytes) throw new Error('Объект превышает заявленный размер.')
    chunks.push(chunk)
  }
  if (bytes !== expectedBytes) throw new Error('Объект усечён.')
  return Buffer.concat(chunks, bytes)
}

/** The database ID is an operator label, not proof of an atomic DB/object snapshot. */
export async function captureFileSnapshot(
  client: S3Client,
  bucket: string,
  directory: string,
  databaseBackupId: string,
) {
  manifestSchema.shape.databaseBackupId.parse(databaseBackupId)
  const entries = await inventoryFileSnapshot(client, bucket)
  const target = resolve(directory)
  await validateLocalPath(dirname(target))
  await mkdir(target, { mode: 0o700 })
  const saved: FileManifest['entries'] = []
  for (const entry of entries) {
    const result = await client.send(
      new GetObjectCommand({
        Bucket: bucket,
        Key: entry.key,
        IfMatch: entry.etag,
      }),
      { abortSignal: AbortSignal.timeout(30000) },
    )
    if (result.ETag !== entry.etag || result.ContentLength !== entry.bytes || !result.ContentType)
      throw new Error('Версия, размер или тип исходного объекта не подтверждены.')
    const body = await readObject(result.Body as AsyncIterable<Uint8Array> | undefined, entry.bytes)
    const file = `${hash(entry.key)}.bin`
    await writeFile(join(target, file), body, { flag: 'wx', mode: 0o600 })
    saved.push({ ...entry, file, sha256: hash(body), contentType: result.ContentType })
  }
  const finalEntries = await inventoryFileSnapshot(client, bucket)
  if (JSON.stringify(entries) !== JSON.stringify(finalEntries))
    throw new Error('Исходный набор изменился: завершённый снимок не создан.')
  const manifest = parseFileSnapshotManifest({
    version: 1,
    databaseBackupId,
    capturedAt: new Date().toISOString(),
    entries: saved,
  })
  // Only a complete, stable snapshot receives a manifest; failed directories remain for inspection.
  await writeFile(join(target, 'manifest.json'), JSON.stringify(manifest, null, 2), {
    flag: 'wx',
    mode: 0o600,
  })
  return manifest
}

export function parseFileSnapshotManifest(value: unknown) {
  const manifest = manifestSchema.parse(value)
  validateEntries(manifest.entries)
  if (manifest.entries.some((entry) => entry.file !== `${hash(entry.key)}.bin`))
    throw new Error('Имя локального файла не соответствует ключу.')
  return manifest
}

export async function loadFileSnapshot(manifestPath: string) {
  await validateLocalPath(manifestPath)
  const info = await lstat(manifestPath)
  if (!info.isFile() || info.size > 32 * 1024 * 1024) throw new Error('Некорректный manifest.')
  const manifest = parseFileSnapshotManifest(JSON.parse(await readFile(manifestPath, 'utf8')))
  const directory = dirname(resolve(manifestPath))
  // Validate every saved object before the first S3 write, without retaining 1 GiB in memory.
  for (const entry of manifest.entries) await readSavedObject(directory, entry)
  return { manifest, directory }
}

async function readSavedObject(directory: string, entry: FileManifest['entries'][number]) {
  const path = join(directory, entry.file)
  const info = await lstat(path)
  if (!info.isFile() || info.isSymbolicLink() || info.size !== entry.bytes)
    throw new Error('Некорректный файл снимка.')
  const body = await readFile(path)
  if (hash(body) !== entry.sha256) throw new Error('Не совпала контрольная сумма снимка.')
  return body
}

export async function restoreFileSnapshot(
  manifestPath: string,
  endpoint: string,
  bucket = `domitsa-restore-${randomBytes(8).toString('hex')}`,
) {
  const target = validateRestoreTarget(endpoint, bucket)
  const { manifest, directory } = await loadFileSnapshot(manifestPath)
  const client = createClient('RESTORE_S3', target.endpoint)
  try {
    let absent = false
    try {
      await client.send(new HeadBucketCommand({ Bucket: bucket }), {
        abortSignal: AbortSignal.timeout(15000),
      })
    } catch (error) {
      absent =
        (error as { $metadata?: { httpStatusCode?: number } }).$metadata?.httpStatusCode === 404
      if (!absent) throw new Error('Отсутствие QA-бакета не подтверждено.')
    }
    if (!absent) throw new Error('QA-бакет уже существует: перезапись запрещена.')
    await client.send(new CreateBucketCommand({ Bucket: bucket }), {
      abortSignal: AbortSignal.timeout(15000),
    })
    for (const entry of manifest.entries) {
      const body = await readSavedObject(directory, entry)
      await client.send(
        new PutObjectCommand({
          Bucket: bucket,
          Key: entry.key,
          Body: body,
          ContentType: entry.contentType,
          IfNoneMatch: '*',
        }),
        { abortSignal: AbortSignal.timeout(30000) },
      )
      const result = await client.send(new GetObjectCommand({ Bucket: bucket, Key: entry.key }), {
        abortSignal: AbortSignal.timeout(30000),
      })
      const restored = await readObject(
        result.Body as AsyncIterable<Uint8Array> | undefined,
        entry.bytes,
      )
      if (hash(restored) !== entry.sha256 || result.ContentType !== entry.contentType)
        throw new Error('Не прошла сверка восстановленного объекта.')
      const encodedKey = entry.key.split('/').map(encodeURIComponent).join('/')
      const anonymous = await fetch(`${target.endpoint}/${bucket}/${encodedKey}`, {
        signal: AbortSignal.timeout(15000),
        redirect: 'error',
      })
      await anonymous.body?.cancel()
      if (anonymous.status !== 403) throw new Error('Приватность QA-бакета не подтверждена.')
    }
    await loadFileSnapshot(manifestPath)
    return {
      status: 'passed',
      files: manifest.entries.length,
      databaseBackupId: manifest.databaseBackupId,
      bucket,
    }
  } finally {
    client.destroy()
  }
}

function createClient(prefix: 'FILE_SNAPSHOT_S3' | 'RESTORE_S3', endpoint?: string) {
  const accessKeyId = process.env[`${prefix}_ACCESS_KEY`]
  const secretAccessKey = process.env[`${prefix}_SECRET_KEY`]
  const target = endpoint ?? process.env[`${prefix}_ENDPOINT`]
  if (!accessKeyId || !secretAccessKey || !target)
    throw new Error(`Нужны отдельные ${prefix} настройки.`)
  const url = new URL(target)
  if (
    !['http:', 'https:'].includes(url.protocol) ||
    url.username ||
    url.password ||
    url.search ||
    url.hash ||
    url.pathname !== '/'
  )
    throw new Error('Некорректный endpoint снимка.')
  return new S3Client({
    endpoint: target,
    region: process.env[`${prefix}_REGION`] ?? 'us-east-1',
    forcePathStyle: true,
    maxAttempts: 1,
    credentials: { accessKeyId, secretAccessKey },
  })
}

if (import.meta.main) {
  const [mode, ...args] = process.argv.slice(2)
  const path = args[1]
  const value = args[3]
  // Pass --no-env-file to Bun. This script never imports the application environment.
  if (
    mode === 'restore' &&
    args.length === 4 &&
    args[0] === '--manifest' &&
    args[2] === '--endpoint' &&
    path &&
    value
  ) {
    console.log(JSON.stringify(await restoreFileSnapshot(path, value)))
  } else if (
    (mode === 'inventory' && args.length === 0) ||
    (mode === 'capture' &&
      args.length === 4 &&
      args[0] === '--directory' &&
      args[2] === '--database-backup-id' &&
      path &&
      value)
  ) {
    const bucket = process.env.FILE_SNAPSHOT_S3_BUCKET
    if (!bucket) throw new Error('Нужен FILE_SNAPSHOT_S3_BUCKET.')
    const client = createClient('FILE_SNAPSHOT_S3')
    try {
      const result =
        mode === 'inventory'
          ? await inventoryFileSnapshot(client, bucket)
          : (await captureFileSnapshot(client, bucket, path ?? '', value ?? '')).entries
      console.log(
        JSON.stringify({
          mode,
          files: result.length,
          bytes: result.reduce((sum, entry) => sum + entry.bytes, 0),
        }),
      )
    } finally {
      client.destroy()
    }
  } else {
    throw new Error(
      'Используйте inventory; capture --directory PATH --database-backup-id ID; restore --manifest PATH --endpoint URL.',
    )
  }
}
