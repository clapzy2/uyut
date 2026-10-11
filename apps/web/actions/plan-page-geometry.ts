'use server'

import { createHash } from 'node:crypto'
import { isDeepStrictEqual } from 'node:util'
import type { PlanGeometry } from '@uyut/db'
import { revalidatePath } from 'next/cache'
import { headers } from 'next/headers'
import { z } from 'zod'
import type { ActionResult } from '@/actions/projects'
import { recordAudit } from '@/lib/audit'
import { AccessError, assertOwner } from '@/lib/projects/access'
import { PlanReadError, preparePlanPage } from '@/lib/projects/plan-document'
import { PlanEditConflictError, planEditRevision } from '@/lib/projects/plan-edit-revision'
import { planPageMetricDraft } from '@/lib/projects/plan-page-metric-draft'
import { planPageContoursSchema } from '@/lib/projects/plan-page-review'
import { planPageRoomInventory } from '@/lib/projects/plan-page-room-inventory'
import { pdfContourRoomNumbers } from '@/lib/projects/plan-pdf-room-binding'
import { currentPlanVerticalReference } from '@/lib/projects/plan-vertical-reference'
import { setPlanReading } from '@/lib/projects/repository'
import { getSession } from '@/lib/session'
import { getObject } from '@/lib/storage'

const roomNumbersSchema = z
  .array(z.number().int().min(1).max(50))
  .min(1)
  .max(12)
  .refine((numbers) => new Set(numbers).size === numbers.length)

function preserveReimportMeasurements(
  before: PlanGeometry,
  draft: PlanGeometry,
): string | undefined {
  if (
    new Set(before.walls.map((wall) => wall.id)).size !== before.walls.length ||
    new Set(before.openings.map((opening) => opening.id)).size !== before.openings.length
  )
    return 'В прежнем черновике повторяются идентификаторы владельцев обмеров.'
  if (before.pdfCalibration?.openingMeasurements?.length)
    return 'Сверка ширины и привязки проёмов содержит независимые обмеры: требуется отдельная повторная привязка, без удаления прежних значений.'
  if (
    before.imageCalibration &&
    !isDeepStrictEqual(before.imageCalibration, draft.imageCalibration)
  )
    return 'Сохранённая калибровка изображения не совпадает с новым переносом.'
  const samePoint = (a: { xCm: number; yCm: number }, b: { xCm: number; yCm: number }) =>
    a.xCm === b.xCm && a.yCm === b.yCm
  const sameWall = (a: PlanGeometry['walls'][number], b: PlanGeometry['walls'][number]) =>
    a.id === b.id && a.kind === b.kind && samePoint(a.start, b.start) && samePoint(a.end, b.end)
  for (const old of before.walls) {
    if (
      old.heightCm === undefined &&
      old.thicknessCm === undefined &&
      old.measuredThicknessCm === undefined
    )
      continue
    const matches = draft.walls.filter((wall) => sameWall(old, wall))
    const target = matches[0]
    if (matches.length !== 1 || !target)
      return 'Высота или толщина стены больше не имеет однозначного прежнего владельца.'
    Object.assign(target, {
      ...(old.heightCm === undefined ? {} : { heightCm: old.heightCm }),
      ...(old.thicknessCm === undefined ? {} : { thicknessCm: old.thicknessCm }),
      ...(old.measuredThicknessCm === undefined
        ? {}
        : { measuredThicknessCm: old.measuredThicknessCm }),
    })
  }
  for (const old of before.openings) {
    const measured = ['heightCm', 'bottomCm', 'sillHeightCm', 'clearance'] as const
    if (!measured.some((field) => old[field] !== undefined)) continue
    const host = before.walls.find((wall) => wall.id === old.wallId)
    const matches = draft.openings.filter((opening) => {
      const wall = draft.walls.find((wall) => wall.id === opening.wallId)
      return (
        opening.id === old.id &&
        opening.type === old.type &&
        opening.wallId === old.wallId &&
        opening.offsetCm === old.offsetCm &&
        opening.widthCm === old.widthCm &&
        host &&
        wall &&
        sameWall(host, wall)
      )
    })
    const target = matches[0]
    if (matches.length !== 1 || !target)
      return 'Высота, подоконник или открывание проёма больше не имеют однозначного прежнего владельца.'
    for (const field of measured) {
      if (old[field] !== undefined) Object.assign(target, { [field]: structuredClone(old[field]) })
    }
  }
  const independentObjects =
    (before.kitchenItems?.length ?? 0) + (before.utilityPoints?.length ?? 0)
  if (
    independentObjects &&
    (before.widthCm !== draft.widthCm ||
      before.heightCm !== draft.heightCm ||
      !isDeepStrictEqual(before.pdfCalibration?.origin, draft.pdfCalibration?.origin) ||
      before.pdfCalibration?.cmPerPoint !== draft.pdfCalibration?.cmPerPoint)
  )
    return 'Начало координат или масштаб изменились: кухонные элементы и инженерные точки нельзя перенести автоматически.'
  for (const old of before.obstacles ?? []) {
    const matches = (draft.obstacles ?? []).filter((item) => isDeepStrictEqual(item, old))
    if (matches.length !== 1)
      return 'Сохранённое препятствие изменилось или отсутствует в новой разметке.'
  }
  if (
    before.routeStartOpeningId &&
    !draft.openings.some((opening) => opening.id === before.routeStartOpeningId)
  )
    return 'Стартовая дверь сохранённого маршрута отсутствует в новой разметке.'
  if (before.verticalReference) {
    draft.verticalReference = structuredClone(before.verticalReference)
    if (!currentPlanVerticalReference(draft))
      return 'Обмеры уровней пола и порогов связаны с прежними контурами: обновление требует отдельной повторной привязки владельцев.'
  }
  for (const field of [
    'kitchenItems',
    'utilityPoints',
    'routeWidthCm',
    'routeStartOpeningId',
  ] as const) {
    if (before[field] !== undefined)
      Object.assign(draft, { [field]: structuredClone(before[field]) })
  }
  return undefined
}

/** New draft or explicitly acknowledged held-source reimport; never confirms measurements. */
export async function createPlanPageGeometryDraft(
  projectId: string,
  roomNumbers: unknown,
  expectedRevision: string,
  calibrationRoomNumbers?: unknown,
  useEdgeDimensions = false,
  replaceSourceDraft = false,
): Promise<ActionResult<{ geometry: PlanGeometry; revision: string }>> {
  const session = await getSession()
  if (!session) return { ok: false, error: 'Сессия закончилась. Войдите снова.' }
  if (typeof useEdgeDimensions !== 'boolean' || typeof replaceSourceDraft !== 'boolean')
    return { ok: false, error: 'Выберите способ проверки масштаба.' }
  const selected = roomNumbersSchema.safeParse(roomNumbers)
  if (!selected.success) return { ok: false, error: 'Выберите от одной до двенадцати комнат.' }
  const anchors =
    calibrationRoomNumbers === undefined
      ? undefined
      : roomNumbersSchema.safeParse(calibrationRoomNumbers)
  if (anchors && !anchors.success)
    return { ok: false, error: 'Выберите комнаты для проверки единого масштаба.' }

  try {
    const project = await assertOwner(session.user.id, projectId)
    const before = project.planReading
    if (expectedRevision !== planEditRevision(project.planUrl, before))
      throw new PlanEditConflictError()
    if (!before?.confirmedAt || !project.planUrl?.toLowerCase().endsWith('.pdf'))
      return { ok: false, error: 'Сначала подтвердите список комнат исходного PDF-плана.' }
    if (before.geometry && (!replaceSourceDraft || !before.geometry.requiresSourceReviewReimport))
      return {
        ok: false,
        error: '2D-схема уже существует. Её правки сохранены; откройте редактор схемы.',
      }
    if (before.geometry && !useEdgeDimensions && calibrationRoomNumbers === undefined)
      return {
        ok: false,
        error:
          'Для обновления переноса выберите проверку единого масштаба по комнате или отдельным сторонам.',
      }
    const review = planPageContoursSchema.safeParse(before.pageReview?.contours)
    if (!review.success || before.planState !== 'existing')
      return { ok: false, error: 'Сначала сохраните разметку комнат на исходном обмерном листе.' }
    if (
      selected.data.some(
        (number) => !review.data.rooms.some((room) => pdfContourRoomNumbers(room).includes(number)),
      )
    )
      return { ok: false, error: 'Выберите комнаты, размеченные на текущем листе.' }

    const object = await getObject(project.planUrl)
    const body = Buffer.from(object.body)
    const source = {
      sha256: createHash('sha256').update(body).digest('hex'),
      pdfPage: review.data.source.pdfPage,
      state: 'existing' as const,
    }
    if (source.sha256 !== review.data.source.sha256) throw new PlanEditConflictError()
    if (
      before.geometry?.pdfCalibration &&
      (before.geometry.pdfCalibration.sourceSha256 !== source.sha256 ||
        before.geometry.pdfCalibration.pdfPage !== source.pdfPage)
    )
      return {
        ok: false,
        error:
          'Прежняя схема относится к другому исходному PDF-листу. Автоматическая замена запрещена.',
      }
    const page = await preparePlanPage(body, true, source.pdfPage, true)
    if (page.pageNumber !== source.pdfPage || !page.linework)
      return { ok: false, error: 'Для переноса нужны нативные линии выбранного PDF-листа.' }
    const result = planPageMetricDraft(
      before,
      {
        source,
        linework: page.linework,
        planText: page.image.planText,
        contours: review.data,
        ...(anchors?.success ? { calibrationRoomNumbers: anchors.data } : {}),
        ...(useEdgeDimensions ? { useEdgeDimensions: true } : {}),
      },
      selected.data,
    )
    if (!result.ok) return result
    if (before.geometry) {
      const issue = preserveReimportMeasurements(before.geometry, result.geometry)
      if (issue)
        return {
          ok: false,
          error: `${issue} Прежний черновик и все обмеры сохранены; автоматическая замена не выполнена.`,
        }
      result.geometry.status = 'draft'
      delete result.geometry.confirmedAt
      delete result.geometry.requiresSourceReviewReimport
      result.geometry.warnings.push(
        'Перенос из исходного PDF обновлён по вашему подтверждению. Заново сверьте схему, высоты и маршрут заноса; прежнее подтверждение не восстановлено.',
      )
    }

    const sourceRooms = planPageRoomInventory(page.image.planText)
    const reading = {
      ...before,
      pageReview: before.pageReview
        ? {
            ...before.pageReview,
            ...(sourceRooms ? { sourceRooms } : {}),
          }
        : undefined,
      geometry: result.geometry,
    }
    if (before.geometry && before.deliveryMeasurements) {
      const { reportJson: _report, ...measurements } = before.deliveryMeasurements
      reading.deliveryMeasurements = measurements
    }
    // File, reading, source review and the absence of geometry are guarded atomically.
    await setPlanReading(session.user.id, projectId, reading, project)
    await recordAudit({
      action: 'project.plan_geometry_drafted',
      actorId: session.user.id,
      targetType: 'project',
      targetId: projectId,
      headers: await headers(),
      metadata: {
        source: 'reviewed-pdf',
        ...(before.geometry ? { reimport: true } : {}),
        page: source.pdfPage,
        roomContours: result.geometry.rooms.length,
        openings: result.geometry.openings.length,
        obstacles: result.geometry.obstacles?.length ?? 0,
      },
    })
    revalidatePath(`/projects/${projectId}`)
    return {
      ok: true,
      data: { geometry: result.geometry, revision: planEditRevision(project.planUrl, reading) },
    }
  } catch (error) {
    if (error instanceof PlanEditConflictError)
      return { ok: false, error: error.message, code: 'plan-conflict' }
    if (error instanceof AccessError || error instanceof PlanReadError)
      return { ok: false, error: error.message }
    console.error('plan page geometry draft failed', error)
    return {
      ok: false,
      error: 'Не получилось создать 2D-черновик. Выбранные комнаты можно сверить и повторить.',
    }
  }
}
