import { createHash, randomBytes } from 'node:crypto'
import { lstat, readFile, realpath, writeFile } from 'node:fs/promises'
import { dirname, resolve } from 'node:path'
import {
  CreateBucketCommand,
  GetObjectCommand,
  HeadBucketCommand,
  PutObjectCommand,
  S3Client,
} from '@aws-sdk/client-s3'
import { z } from 'zod'

const entrySchema = z
  .object({
    kind: z.enum(['plan', 'render', 'mask', 'pdf']),
    file: z.string().regex(/^(plan|render|mask|pdf)\.bin$/),
    bytes: z
      .number()
      .int()
      .positive()
      .max(64 * 1024 * 1024),
    sha256: z.string().regex(/^[a-f0-9]{64}$/),
    contentType: z.enum(['application/pdf', 'image/png', 'image/jpeg', 'image/webp']),
  })
  .strict()

const manifestSchema = z
  .object({
    version: z.literal(1),
    entries: z.array(entrySchema).length(4),
  })
  .strict()

/** Принимаем только отдельное локальное хранилище, не рабочий endpoint из .env. */
export function validateRestoreTarget(endpoint: string, bucket: string) {
  const target = new URL(endpoint)
  if (
    !['127.0.0.1', '[::1]'].includes(target.hostname) ||
    target.protocol !== 'http:' ||
    target.username ||
    target.password ||
    !target.port ||
    target.search ||
    target.hash ||
    target.pathname !== '/' ||
    !/^domitsa-restore-[a-f0-9]{16}$/.test(bucket)
  ) {
    throw new Error('Восстановление разрешено только в отдельный локальный QA-бакет.')
  }
  return { endpoint: target.origin, bucket }
}

export function parseFileManifest(value: unknown) {
  const manifest = manifestSchema.parse(value)
  const kinds = new Set(manifest.entries.map((entry) => entry.kind))
  if (manifest.entries.reduce((sum, entry) => sum + entry.bytes, 0) > 128 * 1024 * 1024) {
    throw new Error('Контрольная копия превышает лимит 128 МиБ.')
  }
  if (
    kinds.size !== 4 ||
    manifest.entries.some((entry) => entry.file !== `${entry.kind}.bin`) ||
    manifest.entries.some(
      (entry) => entry.kind === 'pdf' && entry.contentType !== 'application/pdf',
    ) ||
    manifest.entries.some(
      (entry) => ['render', 'mask'].includes(entry.kind) && !entry.contentType.startsWith('image/'),
    )
  ) {
    throw new Error('Нужны четыре разных файла: исходный план, рендер, маска и PDF.')
  }
  return manifest
}

function hash(body: Uint8Array) {
  return createHash('sha256').update(body).digest('hex')
}

export async function loadFileBackup(manifestPath: string) {
  const manifest = parseFileManifest(JSON.parse(await readFile(manifestPath, 'utf8')))
  const sourceDirectory = await realpath(dirname(resolve(manifestPath)))
  const sources = []
  // Все четыре копии проверяем до первой записи в S3.
  for (const entry of manifest.entries) {
    const path = resolve(sourceDirectory, entry.file)
    const info = await lstat(path)
    if (
      !info.isFile() ||
      info.isSymbolicLink() ||
      (await realpath(path)) !== path ||
      info.size !== entry.bytes
    ) {
      throw new Error(`Некорректный файл копии: ${entry.kind}.`)
    }
    const body = await readFile(path)
    if (hash(body) !== entry.sha256) throw new Error(`Не совпала контрольная сумма: ${entry.kind}.`)
    sources.push({ entry, body })
  }
  return { sourceDirectory, sources }
}

/** Проверяет готовую копию. Не читает рабочую БД, не вызывает AI и ничего не удаляет. */
export async function checkFileRestore(manifestPath: string, endpoint: string, bucket: string) {
  const target = validateRestoreTarget(endpoint, bucket)
  const { sourceDirectory, sources } = await loadFileBackup(manifestPath)
  const accessKeyId = process.env.RESTORE_S3_ACCESS_KEY
  const secretAccessKey = process.env.RESTORE_S3_SECRET_KEY
  if (!accessKeyId || !secretAccessKey)
    throw new Error('Нужны отдельные RESTORE_S3 ключи локальной проверки.')
  const client = new S3Client({
    endpoint: target.endpoint,
    region: 'us-east-1',
    forcePathStyle: true,
    maxAttempts: 1,
    credentials: { accessKeyId, secretAccessKey },
  })
  const checks = []
  try {
    let absent = false
    try {
      await client.send(new HeadBucketCommand({ Bucket: target.bucket }), {
        abortSignal: AbortSignal.timeout(15000),
      })
    } catch (error) {
      absent =
        (error as { $metadata?: { httpStatusCode?: number } }).$metadata?.httpStatusCode === 404
      if (!absent) throw new Error('Не удалось подтвердить отсутствие QA-бакета.')
    }
    if (!absent)
      throw new Error('Бакет уже существует: перезапись запрещена, нужен новый QA-бакет.')
    await client.send(new CreateBucketCommand({ Bucket: target.bucket }), {
      abortSignal: AbortSignal.timeout(15000),
    })
    for (const { entry, body } of sources) {
      await client.send(
        new PutObjectCommand({
          Bucket: target.bucket,
          Key: entry.file,
          Body: body,
          ContentType: entry.contentType,
          IfNoneMatch: '*',
        }),
        { abortSignal: AbortSignal.timeout(30000) },
      )
      const result = await client.send(
        new GetObjectCommand({ Bucket: target.bucket, Key: entry.file }),
        { abortSignal: AbortSignal.timeout(30000) },
      )
      const restored = await result.Body?.transformToByteArray()
      if (
        !restored ||
        hash(restored) !== entry.sha256 ||
        restored.length !== entry.bytes ||
        result.ContentType !== entry.contentType
      )
        throw new Error(`Не прошла сверка восстановленного файла: ${entry.kind}.`)
      // Неподписанная ссылка не должна раскрывать даже тестовый файл.
      const anonymous = await fetch(`${target.endpoint}/${target.bucket}/${entry.file}`, {
        signal: AbortSignal.timeout(15000),
        redirect: 'error',
      })
      await anonymous.body?.cancel()
      if (anonymous.status !== 403)
        throw new Error('Анонимное чтение не отклонено: приватность копии не подтверждена.')
      if (hash(await readFile(resolve(sourceDirectory, entry.file))) !== entry.sha256) {
        throw new Error('Исходная копия изменилась во время проверки.')
      }
      checks.push({
        kind: entry.kind,
        bytes: entry.bytes,
        sha256: entry.sha256,
        contentType: entry.contentType,
        restored: true,
        sourceUnchanged: true,
        anonymousStatus: anonymous.status,
      })
    }
    return {
      version: 1,
      status: 'passed',
      bucket: target.bucket,
      checkedAt: new Date().toISOString(),
      checks,
    }
  } finally {
    client.destroy()
  }
}

if (import.meta.main) {
  const [manifestPath, endpoint, reportPath] = process.argv.slice(2)
  if (!manifestPath || !endpoint || !reportPath)
    throw new Error('Нужны пути manifest.json, endpoint и нового отчёта.')
  try {
    await lstat(reportPath)
    throw new Error('Отчёт уже существует: выберите новый путь.')
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error
  }
  const report = await checkFileRestore(
    manifestPath,
    endpoint,
    `domitsa-restore-${randomBytes(8).toString('hex')}`,
  )
  await writeFile(reportPath, JSON.stringify(report, null, 2), { flag: 'wx', mode: 0o600 })
  console.log(JSON.stringify({ status: report.status, files: report.checks.length, aiRequests: 0 }))
}
