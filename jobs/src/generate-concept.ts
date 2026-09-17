import { logger, metadata, task } from '@trigger.dev/sdk'
import {
  buildTemplatePlan,
  type ConceptBrief,
  type ConceptModelId,
  type ConceptRenderer,
  conceptModels,
  createFalRenderer,
  createPromptBuilder,
  isConceptModelId,
  KEEP_THE_REST,
  nearestStyles,
  type RenderResult,
  renderArchitectureAnchoredBatch,
  reviewConceptImage,
  roomRenderAspectRatio,
  type StyleEntry,
  styleLibrary,
} from '@uyut/ai'
import {
  type LayoutItem,
  layoutPromptContract,
  layoutRoom,
  subcategoryFromText,
} from '@uyut/catalog'
import {
  catalogItems,
  conceptObjects,
  concepts,
  projects,
  rooms,
  shoppingListItems,
} from '@uyut/db'
import { and, eq } from 'drizzle-orm'
import sharp from 'sharp'
import { z } from 'zod'
import { db } from './lib/db'
import { requireEnv } from './lib/env'
import { putObject, readObject } from './lib/s3'
import { cropObject, segmentAndMatch } from './segment-and-match'

const payloadSchema = z.object({
  roomId: z.uuid(),
  batchId: z.uuid(),
  count: z.number().int().min(1).max(8).default(5),
  /** Правка из чата после первой генерации, по-английски */
  revision: z.string().max(500).optional(),
  /**
   * Правка готового рендера: рисуем от него, а не от фотографии комнаты.
   * Только так работает «вот этот вариант, но шкаф под окном».
   */
  baseConceptId: z.uuid().optional(),
  /** Текст просьбы словами человека: показываем его рядом с результатом */
  editRequest: z.string().max(500).optional(),
  /**
   * Готовый план правки по шагам. Считается до запуска и показывается человеку,
   * чтобы он видел, за что платит.
   */
  editSteps: z
    .array(
      z.object({
        titleRu: z.string().max(200),
        prompt: z.string().min(1).max(600),
        needsObject: z.boolean().optional(),
      }),
    )
    .min(1)
    .max(4)
    .optional(),
  /**
   * Ключ кадра с самим предметом: вырезка с фото или карточка товара.
   * Словами модель рисует похожую мебель, картинкой — ту самую.
   */
  objectKey: z.string().max(500).optional(),
  /**
   * Предмет с рендера, который человек ткнул пальцем. Вырезаем его здесь же по маске:
   * так работает и со старыми концептами, где вырезки нигде не сохранены.
   */
  objectId: z.uuid().optional(),
  /** Варианты на двоих: у каждого рендера своя правка и название, общая часть промпта из шаблона */
  duo: z
    .object({
      variations: z
        .array(
          z.object({
            title: z.string().min(1).max(60),
            idea: z.string().min(1).max(400),
            revision: z.string().min(1).max(400),
          }),
        )
        .min(1)
        .max(3),
    })
    .optional(),
})

export type GenerateConceptPayload = z.input<typeof payloadSchema>

function pickStyles(vector: number[] | null): { primary: StyleEntry; secondary: StyleEntry[] } {
  const nearest = vector ? nearestStyles(vector, 3) : []
  const primary = nearest[0] ?? (styleLibrary[0] as StyleEntry)
  return { primary, secondary: nearest.slice(1) }
}

function renderer(override?: ConceptModelId): {
  renderer: ConceptRenderer
  modelId: ConceptModelId
} {
  const raw = process.env.CONCEPT_MODEL ?? 'gpt-image-2.5-sunburst'
  const modelId: ConceptModelId =
    override ?? (isConceptModelId(raw) ? raw : 'gpt-image-2.5-sunburst')
  return { renderer: createFalRenderer(requireEnv('FAL_KEY'), modelId), modelId }
}

/** Считает реальные обращения к платному рендеру, включая каждый шаг сложной правки. */
function withRenderMeter(engine: ConceptRenderer, onRequest: () => void): ConceptRenderer {
  return {
    model: engine.model,
    async render(request) {
      onRequest()
      return engine.render(request)
    },
  }
}

type Progress = { stage: string; done: number; total: number; failed: number }

/**
 * Правка по шагам: каждый следующий рисуется поверх результата предыдущего.
 *
 * Одним заданием модель не переносит предметы вообще, а двумя — переносит. Проверено на живой
 * кухне: «убери шкаф» плюс «поставь шкаф под окном» дали то, чего не дала ни одна формулировка в лоб.
 * Комната за четыре шага не расползается, поэтому ошибки цепочки не копятся.
 */
async function renderSteps(
  engine: ConceptRenderer,
  steps: Array<{ prompt: string; needsObject?: boolean }>,
  imageUrl: string | undefined,
  referenceUrls: string[],
  aspectRatio: string,
): Promise<RenderResult> {
  let current = imageUrl
  let last: RenderResult | null = null
  for (const step of steps) {
    // Кадр предмета нужен только тому шагу, который что-то ставит. На шаге «убрать шкаф»
    // вторая картинка со шкафом — прямое противоречие команде, и модель рисовала его заново
    const withObject = referenceUrls.length > 0 && step.needsObject === true
    last = await engine.render({
      prompt: `${step.prompt} ${KEEP_THE_REST}`,
      imageUrl: current,
      ...(withObject ? { referenceUrls } : {}),
      aspectRatio,
    })
    current = `data:${last.contentType};base64,${last.body.toString('base64')}`
  }
  if (!last) {
    throw new Error('план правки пуст')
  }
  return last
}

/**
 * Вырезка предмета с рендера, на котором его нашли.
 *
 * Модель не переносит предметы и не помнит, как выглядел «тот самый шкаф»: словами она рисует
 * похожую мебель, а не ту же. Картинка предмета вторым кадром — единственный способ сказать
 * «поставь вот это», и вырезаем мы её по маске, а не рамкой: в рамку попадают стена и соседи.
 */
async function cropConceptObject(
  objectId: string,
  conceptId: string,
): Promise<{ body: Buffer; contentType: string }> {
  // Предмет обязан принадлежать правимому рендеру. Проверка стоит и в действии, и здесь:
  // задача читает файлы из хранилища, и открыть по чужому id чужую комнату она не должна
  // ни при каком способе попасть в очередь.
  const [row] = await db()
    .select({ object: conceptObjects, concept: concepts })
    .from(conceptObjects)
    .innerJoin(concepts, eq(concepts.id, conceptObjects.conceptId))
    .where(and(eq(conceptObjects.id, objectId), eq(conceptObjects.conceptId, conceptId)))
    .limit(1)
  if (!row) {
    throw new Error('предмет не найден')
  }
  const key = row.concept.editedRenderUrl ?? row.concept.renderUrl
  if (!key) {
    throw new Error('у концепта нет рендера')
  }
  const render = await readObject(key)
  const meta = await sharp(render.body).metadata()
  const width = meta.width ?? 0
  const height = meta.height ?? 0
  if (width === 0 || height === 0) {
    throw new Error('рендер не читается')
  }
  const mask = row.object.maskUrl ? await readObject(row.object.maskUrl).catch(() => null) : null
  const body = await cropObject(
    Buffer.from(render.body),
    width,
    height,
    { label: row.object.label, bbox: row.object.bbox },
    mask ? Buffer.from(mask.body) : null,
  )
  return { body, contentType: 'image/jpeg' }
}

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

    // Если человек уже выбрал товары и вернулся за новым вариантом, красивый рендер получает
    // ту же проверенную расстановку, что 2D-схема. Без списка или размеров ничего не выдумываем.
    const measuredWidth = room.measurements?.widthCm
    const measuredDepth = room.measurements?.depthCm
    let layoutContract: string | undefined
    if (measuredWidth && measuredDepth) {
      const selected = await database
        .select({ item: shoppingListItems, product: catalogItems })
        .from(shoppingListItems)
        .innerJoin(catalogItems, eq(catalogItems.id, shoppingListItems.catalogItemId))
        .where(eq(shoppingListItems.roomId, room.id))
      const layoutItems: LayoutItem[] = selected.map(({ item, product }) => ({
        id: item.id,
        title: product.title,
        category: product.category,
        subcategory: subcategoryFromText(product.category, product.title),
        dimensions: item.dimensionsCm ?? product.attributes?.dimensionsCm ?? null,
        operationClearance: item.operationClearanceCm,
        placement: item.placementCm,
        quantity: item.quantity,
      }))
      if (layoutItems.length > 0) {
        const calculated = layoutRoom(
          {
            roomKind: room.kind,
            widthCm: measuredWidth,
            depthCm: measuredDepth,
            layoutNotes: room.measurements?.layoutNotes,
          },
          layoutItems,
        )
        if (
          calculated.placed.length > 0 &&
          calculated.problems.length === 0 &&
          calculated.unmeasured.length === 0
        ) {
          layoutContract = layoutPromptContract(calculated)
        }
      }
    }

    // Правка готового рендера рисуется от него, а не от фотографии комнаты
    const [base] = payload.baseConceptId
      ? await database
          .select()
          .from(concepts)
          .where(and(eq(concepts.id, payload.baseConceptId), eq(concepts.roomId, room.id)))
          .limit(1)
      : []
    // Перекрашенная версия идёт первой: именно её человек видит везде в сервисе и её же имеет в виду,
    // когда просит поправить «этот вариант». Та же формула уже живёт в списке комнаты, на странице концепта и в PDF.
    const baseRenderKey = base ? (base.editedRenderUrl ?? base.renderUrl) : null
    if (payload.baseConceptId && !baseRenderKey) {
      throw new Error(`концепт-основа ${payload.baseConceptId} не найден или без рендера`)
    }

    const count = payload.duo ? payload.duo.variations.length : payload.count
    publish({ stage: 'brief', done: 0, total: count, failed: 0 })
    const { primary, secondary } = pickStyles(project.styleReferenceEmbedding)
    const brief: ConceptBrief = {
      roomKind: room.kind,
      roomName: room.name,
      areaM2: room.areaM2,
      // Правка рендера всегда бережливая, как бы ни была отмечена сама комната:
      // основа — уже готовый интерьер, и переделывать его целиком никто не просил.
      condition: base ? 'keep' : room.condition,
      // У правки своя просьба, заметки комнаты в неё не подмешиваем
      notes: base ? (payload.editRequest ?? null) : room.notes,
      revision: payload.revision ?? null,
      hasPhoto: Boolean(base ?? room.photoUrl),
      ...(room.measurements ? { sizeCm: room.measurements } : {}),
      ...(room.measurements?.layoutNotes ? { layoutNotes: room.measurements.layoutNotes } : {}),
      ...(layoutContract ? { layoutContract } : {}),
      budgetKopecks: project.budgetKopecks,
      household: project.household ?? null,
      primaryStyle: primary,
      secondaryStyles: secondary,
      families: [...new Set([primary, ...secondary].map((style) => style.family))],
    }

    publish({ stage: 'prompt', done: 0, total: count, failed: 0 })
    const plan = payload.duo
      ? {
          ...buildTemplatePlan(brief, count),
          variations: payload.duo.variations.map((variation) => variation.revision),
        }
      : await createPromptBuilder({
          anthropicKey: process.env.ANTHROPIC_API_KEY,
          falKey: process.env.FAL_KEY,
        }).build(brief, count)
    logger.info('prompt plan ready', { source: plan.source, variations: plan.variations.length })

    // Где надо сохранить комнату, там рисует модель, которая это умеет. Прежняя на той же кухне
    // рисовала чужую светлую комнату даже на прямую просьбу ничего не менять. С нуля рисуем прежней: там беречь нечего, а она дешевле.
    const preserving = Boolean(payload.editSteps) || brief.condition === 'keep'
    const { renderer: rawEngine, modelId } = renderer(preserving ? 'gpt-image-2.5' : undefined)
    let renderRequests = 0
    let reviewRequests = 0
    const engine = withRenderMeter(rawEngine, () => {
      renderRequests += 1
    })
    const created = await database
      .insert(concepts)
      .values(
        plan.variations.map((variation, index) => ({
          roomId: room.id,
          batchId: payload.batchId,
          batchKind: base
            ? ('edit' as const)
            : payload.duo
              ? ('duo' as const)
              : ('regular' as const),
          orderIndex: index,
          status: 'pending' as const,
          prompt: payload.editSteps
            ? payload.editSteps.map((step) => step.prompt).join(' → ')
            : `${plan.shared} ${variation} ${plan.mandate}`.replace(/\s+/g, ' ').trim(),
          styleTags: project.styleTags,
          aiModel: modelId,
          baseConceptId: base?.id ?? null,
          editRequest: base ? (payload.editRequest ?? null) : null,
          title: payload.duo?.variations[index]?.title ?? null,
          // У вариантов на двоих подпись уже есть: это идея из предложения модели
          note: payload.duo?.variations[index]?.idea ?? null,
        })),
      )
      .returning()

    // Основа рендера: выбранный концепт, если это правка, иначе фото комнаты.
    // Без основы модель рисует комнату с нуля.
    const sourceKey = baseRenderKey ?? room.photoUrl
    const source = sourceKey ? await readObject(sourceKey) : null
    const imageUrl = source
      ? `data:${source.contentType};base64,${source.body.toString('base64')}`
      : undefined

    // Кадр самого предмета, если его приложили: без него модель рисует похожую мебель
    const attached = payload.objectKey
      ? await readObject(payload.objectKey).catch(() => null)
      : payload.objectId && payload.baseConceptId
        ? await cropConceptObject(payload.objectId, payload.baseConceptId).catch((error) => {
            logger.warn('object crop failed', { error: String(error) })
            return null
          })
        : null
    const objectUrls = attached
      ? [`data:${attached.contentType};base64,${attached.body.toString('base64')}`]
      : []
    const aspectRatio = roomRenderAspectRatio(brief)

    let done = 0
    let failed = 0
    publish({ stage: 'render', done, total: created.length, failed })

    // Когда фотографии комнаты нет, независимые text-to-image запросы рисуют разные квартиры:
    // у вариантов меняются окно, дверь и даже пропорции. Первый результат становится общим
    // визуальным якорем, а остальные строятся edit-запросами от него. Число рендеров не растёт.
    // Если самый первый запрос упал, его не повторяем автоматически: остальные продолжают
    // прежним независимым способом, а оплаченный/неоплаченный сбой не дублируется.
    const anchorItems = created.map((concept) => ({
      prompt: concept.prompt,
      seed: 1000 + concept.orderIndex,
      aspectRatio,
    }))
    const anchored =
      !imageUrl && !payload.editSteps && !preserving && anchorItems.length > 0
        ? renderArchitectureAnchoredBatch(
            engine,
            anchorItems as [(typeof anchorItems)[number], ...Array<(typeof anchorItems)[number]>],
          )
        : null
    if (anchored && created.length > 1) {
      void anchored.anchor.then(
        () =>
          logger.info('architecture anchor ready', {
            conceptId: created[0]?.id,
            derivedVariants: created.length - 1,
          }),
        (error) =>
          logger.warn('architecture anchor failed; remaining variants stay independent', {
            conceptId: created[0]?.id,
            error: String(error),
          }),
      )
    }

    await Promise.all(
      created.map(async (concept, conceptIndex) => {
        try {
          let result: RenderResult
          if (anchored) {
            const anchoredResult = anchored.results[conceptIndex]
            if (!anchoredResult) throw new Error('нет результата варианта')
            result = await anchoredResult
          } else if (payload.editSteps) {
            result = await renderSteps(engine, payload.editSteps, imageUrl, objectUrls, aspectRatio)
          } else {
            result = await engine.render({
              prompt: concept.prompt,
              imageUrl,
              seed: 1000 + concept.orderIndex,
              aspectRatio,
            })
          }
          const base = `projects/${project.id}/rooms/${room.id}/concepts/${concept.id}`
          const full = await sharp(result.body).webp({ quality: 88 }).toBuffer()
          // Проверяем пиксели, а не промпт. Уменьшение ограничивает размер запроса;
          // общий HTTP-дедлайн проверки — 35 секунд, её сбой не роняет результат.
          const reviewImage = await sharp(result.body)
            .resize({ width: 1280, height: 1280, fit: 'inside', withoutEnlargement: true })
            .jpeg({ quality: 85 })
            .toBuffer()
          reviewRequests += 1
          const qualityReview = await reviewConceptImage(
            requireEnv('FAL_KEY'),
            { body: reviewImage, contentType: 'image/jpeg' },
            brief,
          )
          logger.info('concept quality review', {
            conceptId: concept.id,
            status: qualityReview.status,
            issueCodes: qualityReview.issues.map((issue) => issue.code),
          })
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
              qualityReview,
              // Описание основано на готовом изображении, не на намерениях из задания.
              note: qualityReview.description,
            })
            .where(eq(concepts.id, concept.id))
          done += 1
          // Подбор предметов идёт отдельной задачей; её сбой не должен ронять рендер
          try {
            await segmentAndMatch.trigger({ conceptId: concept.id })
          } catch (error) {
            logger.warn('segment-and-match not triggered', {
              conceptId: concept.id,
              error: String(error),
            })
          }
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
    // fal не отдаёт фактически списанную сумму в ответе задачи. Это верхняя оценка по числу
    // отправленных запросов: отклонённый до постановки в очередь запрос мог не списаться.
    const renderUsdEstimate = Number(
      (conceptModels[modelId].usdPerImage * renderRequests).toFixed(4),
    )
    logger.info('batch finished', {
      batchId: payload.batchId,
      done,
      failed,
      modelId,
      renderRequests,
      reviewRequests,
      renderUsdEstimate,
    })
    return {
      batchId: payload.batchId,
      done,
      failed,
      usd: renderUsdEstimate,
      renderRequests,
      reviewRequests,
    }
  },
})
