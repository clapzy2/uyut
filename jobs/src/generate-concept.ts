import { GetObjectCommand, PutObjectCommand, S3Client } from '@aws-sdk/client-s3'
import { logger, metadata, task } from '@trigger.dev/sdk'
import {
  type ConceptBrief,
  type ConceptModelId,
  type ConceptRenderer,
  conceptModels,
  createFalRenderer,
  createPromptBuilder,
  isConceptModelId,
  nearestStyles,
  type StyleEntry,
  styleLibrary,
} from '@uyut/ai'
import { concepts, createDb, projects, rooms } from '@uyut/db'
import { eq } from 'drizzle-orm'
import sharp from 'sharp'
import { z } from 'zod'

const payloadSchema = z.object({
  roomId: z.uuid(),
  batchId: z.uuid(),
  count: z.number().int().min(1).max(8).default(5),
})

export type GenerateConceptPayload = z.input<typeof payloadSchema>

function requireEnv(name: string): string {
  const value = process.env[name]
  if (!value) {
    throw new Error(`${name} не задан`)
  }
  return value
}

let cachedDb: ReturnType<typeof createDb> | undefined
function db() {
  if (!cachedDb) {
    cachedDb = createDb(requireEnv('DATABASE_URL'))
  }
  return cachedDb
}

let cachedS3: S3Client | undefined
function s3(): S3Client {
  if (!cachedS3) {
    cachedS3 = new S3Client({
      endpoint: requireEnv('S3_ENDPOINT'),
      region: requireEnv('S3_REGION'),
      forcePathStyle: true,
      credentials: {
        accessKeyId: requireEnv('S3_ACCESS_KEY'),
        secretAccessKey: requireEnv('S3_SECRET_KEY'),
      },
    })
  }
  return cachedS3
}

async function readObject(key: string): Promise<{ body: Buffer; contentType: string }> {
  const result = await s3().send(
    new GetObjectCommand({ Bucket: requireEnv('S3_BUCKET'), Key: key }),
  )
  const bytes = await result.Body?.transformToByteArray()
  if (!bytes) {
    throw new Error(`объект ${key} пустой`)
  }
  return { body: Buffer.from(bytes), contentType: result.ContentType ?? 'image/jpeg' }
}

async function putObject(key: string, body: Buffer, contentType: string): Promise<void> {
  await s3().send(
    new PutObjectCommand({
      Bucket: requireEnv('S3_BUCKET'),
      Key: key,
      Body: body,
      ContentType: contentType,
    }),
  )
}

function pickStyles(vector: number[] | null): { primary: StyleEntry; secondary: StyleEntry[] } {
  const nearest = vector ? nearestStyles(vector, 3) : []
  const primary = nearest[0] ?? (styleLibrary[0] as StyleEntry)
  return { primary, secondary: nearest.slice(1) }
}

function renderer(): { renderer: ConceptRenderer; modelId: ConceptModelId } {
  const raw = process.env.CONCEPT_MODEL ?? 'nano-banana-2'
  const modelId: ConceptModelId = isConceptModelId(raw) ? raw : 'nano-banana-2'
  return { renderer: createFalRenderer(requireEnv('FAL_KEY'), modelId), modelId }
}

type Progress = { stage: string; done: number; total: number; failed: number }

function publish(progress: Progress): void {
  metadata.set('progress', progress)
}

// Пять рендеров одной комнаты: общая часть промпта одна, вариации разные.
export const generateConcept = task({
  id: 'generate-concept',
  maxDuration: 600,
  retry: { maxAttempts: 1 },
  run: async (raw: GenerateConceptPayload) => {
    const payload = payloadSchema.parse(raw)
    const database = db()

    const [row] = await database
      .select({ room: rooms, project: projects })
      .from(rooms)
      .innerJoin(projects, eq(projects.id, rooms.projectId))
      .where(eq(rooms.id, payload.roomId))
      .limit(1)
    if (!row) {
      throw new Error(`комната ${payload.roomId} не найдена`)
    }
    const { room, project } = row

    publish({ stage: 'brief', done: 0, total: payload.count, failed: 0 })
    const { primary, secondary } = pickStyles(project.styleReferenceEmbedding)
    const brief: ConceptBrief = {
      roomKind: room.kind,
      roomName: room.name,
      areaM2: room.areaM2,
      condition: room.condition,
      notes: room.notes,
      hasPhoto: Boolean(room.photoUrl),
      budgetKopecks: project.budgetKopecks,
      household: project.household ?? null,
      primaryStyle: primary,
      secondaryStyles: secondary,
      families: [...new Set([primary, ...secondary].map((style) => style.family))],
    }

    publish({ stage: 'prompt', done: 0, total: payload.count, failed: 0 })
    const plan = await createPromptBuilder({
      anthropicKey: process.env.ANTHROPIC_API_KEY,
      falKey: process.env.FAL_KEY,
    }).build(brief, payload.count)
    logger.info('prompt plan ready', { source: plan.source, variations: plan.variations.length })

    const { renderer: engine, modelId } = renderer()
    const created = await database
      .insert(concepts)
      .values(
        plan.variations.map((variation, index) => ({
          roomId: room.id,
          batchId: payload.batchId,
          orderIndex: index,
          status: 'pending' as const,
          prompt: `${plan.shared} ${variation}`.trim(),
          styleTags: project.styleTags,
          aiModel: modelId,
        })),
      )
      .returning()

    // Фото комнаты становится основой рендера; без него модель рисует комнату с нуля
    const photo = room.photoUrl ? await readObject(room.photoUrl) : null
    const imageUrl = photo
      ? `data:${photo.contentType};base64,${photo.body.toString('base64')}`
      : undefined

    let done = 0
    let failed = 0
    publish({ stage: 'render', done, total: created.length, failed })

    await Promise.all(
      created.map(async (concept) => {
        try {
          const result = await engine.render({
            prompt: concept.prompt,
            imageUrl,
            seed: 1000 + concept.orderIndex,
            aspectRatio: '16:9',
          })
          const base = `projects/${project.id}/rooms/${room.id}/concepts/${concept.id}`
          const full = await sharp(result.body).webp({ quality: 88 }).toBuffer()
          const thumb = await sharp(result.body)
            .resize({ width: 640, withoutEnlargement: true })
            .webp({ quality: 78 })
            .toBuffer()
          await Promise.all([
            putObject(`${base}.webp`, full, 'image/webp'),
            putObject(`${base}-thumb.webp`, thumb, 'image/webp'),
          ])
          await database
            .update(concepts)
            .set({
              status: 'ready',
              renderUrl: `${base}.webp`,
              renderThumbUrl: `${base}-thumb.webp`,
              seed: result.seed,
            })
            .where(eq(concepts.id, concept.id))
          done += 1
        } catch (error) {
          failed += 1
          logger.error('render failed', { conceptId: concept.id, error: String(error) })
          await database
            .update(concepts)
            .set({ status: 'failed', errorText: String(error).slice(0, 500) })
            .where(eq(concepts.id, concept.id))
        }
        publish({ stage: 'render', done, total: created.length, failed })
      }),
    )

    publish({ stage: 'done', done, total: created.length, failed })
    const usd = conceptModels[modelId].usdPerImage * created.length
    logger.info('batch finished', { batchId: payload.batchId, done, failed, usd })
    return { batchId: payload.batchId, done, failed, usd }
  },
})
