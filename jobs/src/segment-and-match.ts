import { logger, metadata, task } from '@trigger.dev/sdk'
import { createFalDetector, createFalSegmenter, type DetectedObject, priceWindow } from '@uyut/ai'
import { countItems, findSimilar } from '@uyut/catalog'
import { conceptObjects, concepts, projects, rooms } from '@uyut/db'
import { eq } from 'drizzle-orm'
import sharp from 'sharp'
import { z } from 'zod'
import { db } from './lib/db'
import { voyageOrNull } from './lib/embed-catalog'
import { requireEnv } from './lib/env'
import { putObject, readObject } from './lib/s3'

const payloadSchema = z.object({ conceptId: z.uuid() })
export type SegmentAndMatchPayload = z.input<typeof payloadSchema>

const CROP_PADDING = 0.04

type Progress = { stage: 'detect' | 'mask' | 'embed' | 'match' | 'done'; found: number }

function publish(progress: Progress): void {
  metadata.set('progress', progress)
}

async function cropObject(
  render: Buffer,
  width: number,
  height: number,
  object: DetectedObject,
): Promise<Buffer> {
  const left = Math.max(0, Math.round((object.bbox.x - CROP_PADDING) * width))
  const top = Math.max(0, Math.round((object.bbox.y - CROP_PADDING) * height))
  const right = Math.min(width, Math.round((object.bbox.x + object.bbox.w + CROP_PADDING) * width))
  const bottom = Math.min(
    height,
    Math.round((object.bbox.y + object.bbox.h + CROP_PADDING) * height),
  )
  return sharp(render)
    .extract({ left, top, width: Math.max(8, right - left), height: Math.max(8, bottom - top) })
    .resize({ width: 512, height: 512, fit: 'inside', withoutEnlargement: true })
    .jpeg({ quality: 88 })
    .toBuffer()
}

/**
 * Предметы на готовом рендере: детектор → маски → векторы → лучший товар. Запускается
 * из generate-concept на каждый удачный рендер. Без ключа Voyage предметы всё равно
 * находятся, но без векторов подобрать товар нечем, поэтому задача помечает концепт как skipped.
 */
export const segmentAndMatch = task({
  id: 'segment-and-match',
  maxDuration: 300,
  retry: { maxAttempts: 1 },
  run: async (raw: SegmentAndMatchPayload) => {
    const { conceptId } = payloadSchema.parse(raw)
    const database = db()
    const [row] = await database
      .select({ concept: concepts, room: rooms, project: projects })
      .from(concepts)
      .innerJoin(rooms, eq(rooms.id, concepts.roomId))
      .innerJoin(projects, eq(projects.id, rooms.projectId))
      .where(eq(concepts.id, conceptId))
      .limit(1)
    if (!row) {
      throw new Error(`концепт ${conceptId} не найден`)
    }
    const { concept, room, project } = row
    if (concept.status !== 'ready' || !concept.renderUrl) {
      await database
        .update(concepts)
        .set({ objectsStatus: 'skipped', objectsError: 'рендер не готов' })
        .where(eq(concepts.id, concept.id))
      return { conceptId, objects: 0, skipped: true }
    }

    const embedder = voyageOrNull()
    if (!embedder) {
      await database
        .update(concepts)
        .set({ objectsStatus: 'skipped', objectsError: 'нет ключа Voyage' })
        .where(eq(concepts.id, concept.id))
      return { conceptId, objects: 0, skipped: true }
    }

    try {
      const falKey = requireEnv('FAL_KEY')
      const render = await readObject(concept.renderUrl)
      const meta = await sharp(render.body).metadata()
      const width = meta.width ?? 0
      const height = meta.height ?? 0
      if (!width || !height) {
        throw new Error('у рендера нет размеров')
      }
      const image = { ...render, width, height }

      publish({ stage: 'detect', found: 0 })
      const detected = await createFalDetector(falKey).detect(image, room.kind, 6)
      logger.info('objects detected', {
        count: detected.length,
        labels: detected.map((o) => o.label),
      })
      publish({ stage: 'mask', found: detected.length })

      const segmenter = createFalSegmenter(falKey)
      const base = `projects/${project.id}/rooms/${room.id}/concepts/${concept.id}/objects`
      const [masks, crops] = await Promise.all([
        Promise.all(
          detected.map(async (object, index) => {
            try {
              const mask = await segmenter.maskForBox(image, object.bbox)
              const key = `${base}/${index}-mask.png`
              await putObject(key, mask.body, 'image/png')
              return key
            } catch (error) {
              logger.warn('mask failed', { index, error: String(error) })
              return null
            }
          }),
        ),
        Promise.all(detected.map((object) => cropObject(render.body, width, height, object))),
      ])

      publish({ stage: 'embed', found: detected.length })
      const vectors =
        detected.length > 0
          ? await embedder.embed(
              crops.map((body) => ({ image: { body, contentType: 'image/jpeg' } })),
            )
          : []

      publish({ stage: 'match', found: detected.length })
      const catalog = await countItems(database)
      await database.delete(conceptObjects).where(eq(conceptObjects.conceptId, concept.id))
      let matched = 0
      for (const [index, object] of detected.entries()) {
        const embedding = vectors[index]
        if (!embedding || embedding.length === 0) {
          continue
        }
        let best: { id: string; similarity: number } | null = null
        if (catalog.embedded > 0) {
          const window = priceWindow(project.budgetKopecks, object.category)
          const inBudget = await findSimilar(database, {
            embedding,
            category: object.category,
            minPriceKopecks: window?.minKopecks,
            maxPriceKopecks: window?.maxKopecks,
            limit: 1,
          })
          const candidate =
            inBudget[0] ??
            (await findSimilar(database, { embedding, category: object.category, limit: 1 }))[0]
          if (candidate) {
            best = { id: candidate.id, similarity: candidate.similarity }
            matched += 1
          }
        }
        await database.insert(conceptObjects).values({
          conceptId: concept.id,
          orderIndex: index,
          category: object.category,
          label: object.label,
          bbox: object.bbox,
          maskUrl: masks[index] ?? null,
          embedding,
          matchedCatalogItemId: best?.id ?? null,
          matchedConfidence: best
            ? Math.round(Math.max(0, Math.min(1, best.similarity)) * 100) / 100
            : null,
        })
      }
      await database
        .update(concepts)
        .set({ objectsStatus: 'ready', objectsError: null })
        .where(eq(concepts.id, concept.id))
      publish({ stage: 'done', found: detected.length })
      logger.info('segment-and-match finished', { conceptId, objects: detected.length, matched })
      return { conceptId, objects: detected.length, matched, skipped: false }
    } catch (error) {
      logger.error('segment-and-match failed', { conceptId, error: String(error) })
      await database
        .update(concepts)
        .set({ objectsStatus: 'failed', objectsError: String(error).slice(0, 500) })
        .where(eq(concepts.id, concept.id))
      throw error
    }
  },
})
