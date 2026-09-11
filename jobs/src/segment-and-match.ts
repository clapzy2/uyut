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

// Поле вокруг предмета в долях его размера: без него вырезка режет предмет по краю,
// а с большим полем в кадр опять лезет комната.
const CROP_PADDING = 0.04
const MASK_PADDING = 0.06
const CROP_SIDE = 512

/** Вырезке нужны только рамка и подпись: остального у сохранённых предметов уже нет. */
type CroppedObject = Pick<DetectedObject, 'label' | 'bbox'>

type Progress = { stage: 'detect' | 'mask' | 'embed' | 'match' | 'done'; found: number }

function publish(progress: Progress): void {
  metadata.set('progress', progress)
}

/** Прямоугольник вокруг предмета: запасной путь, когда маска не посчиталась. */
async function cropByBox(
  render: Buffer,
  width: number,
  height: number,
  object: CroppedObject,
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
    .resize({ width: CROP_SIDE, height: CROP_SIDE, fit: 'inside', withoutEnlargement: true })
    .jpeg({ quality: 88 })
    .toBuffer()
}

/** Границы белого пятна маски. Тоньше рамки детектора: она всегда с запасом. */
function maskBounds(
  pixels: Buffer,
  width: number,
  height: number,
): { left: number; top: number; right: number; bottom: number } | null {
  let left = width
  let top = height
  let right = -1
  let bottom = -1
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      if ((pixels[y * width + x] ?? 0) < 128) {
        continue
      }
      if (x < left) left = x
      if (x > right) right = x
      if (y < top) top = y
      if (y > bottom) bottom = y
    }
  }
  return right < left || bottom < top ? null : { left, top, right, bottom }
}

/**
 * Вырезка предмета по маске, а не прямоугольником.
 *
 * В прямоугольник вместе с предметом попадает пол, стена, соседняя мебель и то, что стоит
 * на столешнице.
 *
 * Замер на сорока одном предмете с боевых рендеров, поровну по категориям
 * (jobs/scripts/bench-crop.ts): кресла 0.303 → 0.565, хранение 0.483 → 0.607, диваны 0.685 → 0.728,
 * светильники 0.692 → 0.725, ковры 0.644 → 0.668. Столы и декор не сдвинулись
 * (−0.016 и −0.003), хотя именно ради столов всё затевалось: их слабый подбор объясняется
 * чем-то другим, скорее всего самим каталогом. Отдельный рецепт для двух категорий
 * делать не стали: разница меньше разброса на шести предметах и подгонка под выборку вреднее.
 *
 * Маска приходит от SAM белым пятном по чёрному в обычных каналах цвета, а не прозрачностью,
 * поэтому её сначала приходится превратить в альфу и только потом класть на рендер.
 */
async function cropByMask(
  render: Buffer,
  width: number,
  height: number,
  maskBody: Buffer,
): Promise<Buffer> {
  const alpha = await sharp(maskBody)
    .resize(width, height, { fit: 'fill' })
    .greyscale()
    .raw()
    .toBuffer()
  const bounds = maskBounds(alpha, width, height)
  if (!bounds) {
    throw new Error('маска пустая')
  }
  const cut = await sharp(render)
    .removeAlpha()
    .joinChannel(alpha, { raw: { width, height, channels: 1 } })
    .flatten({ background: '#ffffff' })
    .toBuffer()

  const boxWidth = bounds.right - bounds.left + 1
  const boxHeight = bounds.bottom - bounds.top + 1
  const pad = Math.round(Math.max(boxWidth, boxHeight) * MASK_PADDING)
  const left = Math.max(0, bounds.left - pad)
  const top = Math.max(0, bounds.top - pad)
  const right = Math.min(width, bounds.right + 1 + pad)
  const bottom = Math.min(height, bounds.bottom + 1 + pad)

  return (
    sharp(cut)
      .extract({ left, top, width: Math.max(8, right - left), height: Math.max(8, bottom - top) })
      // Квадрат с белым полем: у Voyage все картинки каталога тоже на белом фоне товарных карточек
      .resize({
        width: CROP_SIDE,
        height: CROP_SIDE,
        fit: 'contain',
        background: '#ffffff',
      })
      .jpeg({ quality: 88 })
      .toBuffer()
  )
}

/** По маске, если она есть и сработала; иначе прямоугольником, как раньше. */
export async function cropObject(
  render: Buffer,
  width: number,
  height: number,
  object: CroppedObject,
  maskBody: Buffer | null,
): Promise<Buffer> {
  if (maskBody) {
    try {
      return await cropByMask(render, width, height, maskBody)
    } catch (error) {
      logger.warn('crop by mask failed', { label: object.label, error: String(error) })
    }
  }
  return cropByBox(render, width, height, object)
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
      // Маски считаются раньше вырезок, потому что вырезка теперь идёт по маске.
      // Раньше оба шага шли рядом, и вырезка ничего о маске знать не могла.
      const masked = await Promise.all(
        detected.map(async (object, index) => {
          try {
            const mask = await segmenter.maskForBox(image, object.bbox)
            const key = `${base}/${index}-mask.png`
            await putObject(key, mask.body, 'image/png')
            return { key, body: mask.body }
          } catch (error) {
            logger.warn('mask failed', { index, error: String(error) })
            return { key: null, body: null }
          }
        }),
      )
      const masks = masked.map((one) => one.key)
      const crops = await Promise.all(
        detected.map((object, index) =>
          cropObject(render.body, width, height, object, masked[index]?.body ?? null),
        ),
      )

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
