import {
  DeleteObjectCommand,
  GetObjectCommand,
  ListObjectsV2Command,
  S3Client,
} from '@aws-sdk/client-s3'
import { z } from 'zod'
import {
  type FileBackupSource,
  type FileBackupStorage,
  parseExternalFileBackupEnvelope,
  validateFileBackupStorage,
} from './external-file-backup'

const prefix = 'domitsa-files/v1/'
const generationSchema = z.uuid()
type CompletedGeneration = { generationId: string; uploadedAt: string }

/** Храним последние 30 дней и месячные копии 12 месяцев, всегда оставляя новый снимок. */
export function expiredFileBackups(
  generations: CompletedGeneration[],
  newGenerationId: string,
  now = new Date(),
): string[] {
  generationSchema.parse(newGenerationId)
  if (!Number.isFinite(now.getTime())) throw new Error('Некорректное время ретеншена.')
  if (!generations.some((entry) => entry.generationId === newGenerationId))
    throw new Error('Новый завершённый снимок не найден: очистка запрещена.')
  if (new Set(generations.map((entry) => entry.generationId)).size !== generations.length)
    throw new Error('Повторный идентификатор снимка.')
  const dailyCutoff = now.getTime() - 30 * 24 * 60 * 60 * 1000
  const monthlyCutoff = new Date(now)
  monthlyCutoff.setUTCFullYear(monthlyCutoff.getUTCFullYear() - 1)
  const day = new Intl.DateTimeFormat('en-GB', { day: '2-digit', timeZone: 'Europe/Moscow' })
  return generations
    .filter((entry) => {
      generationSchema.parse(entry.generationId)
      z.iso.datetime({ offset: true }).parse(entry.uploadedAt)
      const uploaded = new Date(entry.uploadedAt)
      if (entry.generationId === newGenerationId || uploaded.getTime() >= dailyCutoff) return false
      return !(day.format(uploaded) === '01' && uploaded.getTime() >= monthlyCutoff.getTime())
    })
    .map((entry) => entry.generationId)
}

/** Только свои завершённые поколения; чужие пространства, БД и незавершённые копии не трогаем. */
export async function pruneFileBackups(
  source: FileBackupSource,
  backup: FileBackupStorage,
  newGenerationId: string,
  now = new Date(),
) {
  const target = validateFileBackupStorage(source, backup)
  const client = new S3Client({
    endpoint: target.backupEndpoint,
    region: backup.region,
    forcePathStyle: true,
    maxAttempts: 1,
    credentials: { accessKeyId: backup.accessKey, secretAccessKey: backup.secretKey },
  })
  const completed = []
  const tokens = new Set<string>()
  let token: string | undefined
  try {
    do {
      const page = await client.send(
        new ListObjectsV2Command({
          Bucket: backup.bucket,
          Prefix: prefix,
          ContinuationToken: token,
        }),
        { abortSignal: AbortSignal.timeout(30000) },
      )
      if (typeof page.IsTruncated !== 'boolean')
        throw new Error('Неполная инвентаризация резервных копий.')
      for (const object of page.Contents ?? []) {
        const match = object.Key?.match(/^domitsa-files\/v1\/([a-f0-9-]{36})\/manifest\.json$/)
        if (!match) continue
        const generationId = generationSchema.parse(match[1])
        if (completed.length >= 1000)
          throw new Error('Слишком много поколений для безопасной очистки.')
        if (!object.ETag || object.Size === undefined || object.Size > 32 * 1024 * 1024)
          throw new Error('Версия manifest не подтверждена.')
        const result = await client.send(
          new GetObjectCommand({ Bucket: backup.bucket, Key: object.Key, IfMatch: object.ETag }),
          { abortSignal: AbortSignal.timeout(30000) },
        )
        if (!result.Body || result.ContentLength !== object.Size || result.ETag !== object.ETag)
          throw new Error('Manifest изменился во время проверки.')
        const body = await result.Body.transformToByteArray()
        if (body.length !== object.Size) throw new Error('Manifest усечён.')
        const value = JSON.parse(Buffer.from(body).toString('utf8'))
        // Поколения других источников не принадлежат этой файловой цепочке.
        if (value?.sourceId !== target.sourceId) continue
        const envelope = parseExternalFileBackupEnvelope(value, target.sourceId)
        completed.push({
          generationId,
          uploadedAt: envelope.uploadedAt,
          etag: object.ETag,
          entries: envelope.snapshot.entries,
        })
      }
      if (!page.IsTruncated) break
      token = page.NextContinuationToken
      if (!token || tokens.has(token)) throw new Error('Нет нового токена инвентаризации.')
      tokens.add(token)
    } while (token)
    const expired = new Set(expiredFileBackups(completed, newGenerationId, now))
    let removed = 0
    for (const generation of completed) {
      if (!expired.has(generation.generationId)) continue
      const location = `${prefix}${generation.generationId}/`
      // Сначала убираем указатель завершённой копии. При отказе ни один её файл не удаляем.
      await client.send(
        new DeleteObjectCommand({
          Bucket: backup.bucket,
          Key: `${location}manifest.json`,
          IfMatch: generation.etag,
        }),
        { abortSignal: AbortSignal.timeout(30000) },
      )
      for (const entry of generation.entries) {
        await client.send(
          new DeleteObjectCommand({
            Bucket: backup.bucket,
            Key: `${location}objects/${entry.file}`,
          }),
          { abortSignal: AbortSignal.timeout(30000) },
        )
      }
      removed++
    }
    return { checked: completed.length, removed }
  } finally {
    client.destroy()
  }
}
