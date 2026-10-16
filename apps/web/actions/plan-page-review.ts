'use server'

import { createHash } from 'node:crypto'
import { planMeasurementTextItems } from '@uyut/ai'
import type { PlanPageContours, PlanReading } from '@uyut/db'
import { revalidatePath } from 'next/cache'
import { headers } from 'next/headers'
import type { ActionResult } from '@/actions/projects'
import { recordAudit } from '@/lib/audit'
import { AccessError, assertOwner } from '@/lib/projects/access'
import { PlanReadError, preparePlanPage } from '@/lib/projects/plan-document'
import { PlanEditConflictError, planEditRevision } from '@/lib/projects/plan-edit-revision'
import { verifyPlanPageOpenings } from '@/lib/projects/plan-page-feature-checks'
import { planPageGeometryElementId } from '@/lib/projects/plan-page-metric-draft'
import { planPageContoursSchema } from '@/lib/projects/plan-page-review'
import { planPageRoomInventory } from '@/lib/projects/plan-page-room-inventory'
import { sourceTopologyDraftIssue } from '@/lib/projects/plan-page-source-topology'
import { pdfDimensionForEdge } from '@/lib/projects/plan-pdf-edge-dimension'
import {
  pdfContourIdentity,
  pdfContourKey,
  pdfContourRoomNumbers,
} from '@/lib/projects/plan-pdf-room-binding'
import { setPlanReading } from '@/lib/projects/repository'
import { getSession } from '@/lib/session'
import { getObject } from '@/lib/storage'

const floorReviewMessages: Record<string, string> = {
  'source-topology-snapshot-mismatch':
    'Исходный контур, вырезы или точные ключи изменились. Повторно загрузите выбранную область PDF; округлённая замена не сохраняется.',
  'source-topology-owner-mismatch':
    'Исходная область не соответствует выбранному номеру помещения.',
  'floor-requires-outer-wall-envelope':
    'Отдельную границу пола сохраняйте вместе с внешней границей типа «Наружная сторона стен».',
  'invalid-floor-contour': 'Проверьте замкнутый контур пола: его стороны не должны пересекаться.',
  'floor-outside-exterior-contour':
    'Граница пола должна оставаться внутри наружной стороны стен. Сверьте обе линии с исходным листом.',
  'room-outside-floor-contour':
    'Один из контуров комнат выходит за границу пола. Сверьте его вершины и границу пола с исходным листом.',
  'void-outside-floor-contour':
    'Техническая пустота выходит за границу пола. Сверьте её контур с исходным листом.',
  'non-native-floor-vertex':
    'Привяжите каждую вершину границы пола к узлу исходного PDF. Произвольные точки не сохраняются.',
}

function contourGeometryKey(contours: PlanPageContours): string {
  const sorted = <T>(items: T[], key: (item: T) => string) =>
    [...items].sort((left, right) => key(left).localeCompare(key(right)))
  // Proof metadata can be refreshed without moving a physical boundary. Printed
  // dimension choices, however, affect the metric scale and must remain significant.
  return JSON.stringify(
    {
      source: contours.source,
      pageWidth: contours.pageWidth,
      pageHeight: contours.pageHeight,
      exterior: contours.exterior
        ? {
            polygon: contours.exterior.polygon,
            boundaryRole: contours.exterior.boundaryRole ?? 'floor',
          }
        : null,
      floor: contours.floor?.polygon ?? null,
      voids: sorted(contours.voids ?? [], (item) => item.id),
      rooms: sorted(contours.rooms, pdfContourKey).map((room) => ({
        identity: pdfContourKey(room),
        polygon: room.polygon,
        ...(room.sourceTopology ? { sourceTopology: room.sourceTopology } : {}),
        conditionalEdges: (room.conditionalEdges ?? [])
          .map((edge) => edge.wallEdgeIndex)
          .sort((a, b) => a - b),
        dimensionEdges: sorted(room.dimensionEdges ?? [], (edge) => String(edge.wallEdgeIndex)),
        openings: sorted(room.openings ?? [], (opening) => opening.id).map((opening) => ({
          id: opening.id,
          kind: opening.kind,
          wallEdgeIndex: opening.wallEdgeIndex,
          start: opening.start,
          end: opening.end,
        })),
        obstacles: sorted(room.obstacles ?? [], (obstacle) => obstacle.id),
      })),
    },
    (_key, value) =>
      value && typeof value === 'object' && !Array.isArray(value)
        ? Object.fromEntries(Object.entries(value).sort(([a], [b]) => a.localeCompare(b)))
        : value,
  )
}

function geometryUsesReview(reading: PlanReading, contours: PlanPageContours): boolean {
  const geometry = reading.geometry
  if (!geometry) return false
  const calibration = geometry.pdfCalibration
  if (calibration)
    return (
      calibration.sourceSha256 === contours.source.sha256 &&
      calibration.pdfPage === contours.source.pdfPage
    )
  // Legacy imports have no global calibration. Only server-generated IDs tied to
  // this exact file/page/contour identify them; unrelated manual drawings stay intact.
  // The original importer serialized this order; JSONB does not preserve key order.
  const importedSource = {
    sha256: contours.source.sha256,
    pdfPage: contours.source.pdfPage,
    state: contours.source.state,
  }
  return contours.rooms.some((room) =>
    room.polygon.some((_point, index) =>
      geometry.walls.some(
        (wall) =>
          wall.id === planPageGeometryElementId(importedSource, pdfContourKey(room), 'wall', index),
      ),
    ),
  )
}

/** Saving a page contour does not call the AI reader or confirm apartment measurements. */
export async function savePlanPageReview(
  projectId: string,
  input: unknown,
  expectedRevision: string,
): Promise<ActionResult<{ reading: PlanReading; revision: string }>> {
  const session = await getSession()
  if (!session) return { ok: false, error: 'Сессия закончилась. Войдите снова.' }
  const parsed = planPageContoursSchema.safeParse(input)
  if (!parsed.success)
    return {
      ok: false,
      error:
        floorReviewMessages[parsed.error.issues[0]?.message ?? ''] ??
        'Проверьте контуры, номера комнат и выбранный лист.',
    }

  try {
    const project = await assertOwner(session.user.id, projectId)
    if (expectedRevision !== planEditRevision(project.planUrl, project.planReading))
      throw new PlanEditConflictError()
    if (!project.planUrl?.toLowerCase().endsWith('.pdf') || !project.planReading)
      return { ok: false, error: 'Сначала прочитайте выбранный лист PDF-плана.' }
    const contours = parsed.data
    const before = project.planReading
    if (before.sourcePage !== contours.source.pdfPage || before.planState !== contours.source.state)
      return { ok: false, error: 'Разметьте тот лист, с которого прочитан список комнат.' }

    const object = await getObject(project.planUrl)
    const body = Buffer.from(object.body)
    const source = {
      sha256: createHash('sha256').update(body).digest('hex'),
      pdfPage: contours.source.pdfPage,
      state: contours.source.state,
    }
    if (source.sha256 !== contours.source.sha256) throw new PlanEditConflictError()
    const hasSourceTopology = contours.rooms.some((room) => room.sourceTopology !== undefined)
    for (const previous of before.pageReview?.contours.rooms ?? []) {
      if (!previous.sourceTopology) continue
      const previousMembers = new Set(pdfContourRoomNumbers(previous))
      const reclassified = contours.rooms.some(
        (room) =>
          !room.sourceTopology &&
          pdfContourRoomNumbers(room).some((number) => previousMembers.has(number)),
      )
      if (reclassified)
        return {
          ok: false,
          error:
            'Исходный контур нельзя превратить в физическую комнату удалением его признака. Он остаётся исходным черновиком; переход требует отдельной проверки границ.',
        }
    }
    const page = hasSourceTopology
      ? await preparePlanPage(body, true, source.pdfPage, true, true)
      : await preparePlanPage(body, true, source.pdfPage, true)
    const labels = planMeasurementTextItems(page.image.planText)
    if (
      page.pageNumber !== source.pdfPage ||
      !page.linework ||
      !labels?.some((label) => label.text.trim() !== '')
    )
      return {
        ok: false,
        error:
          'Для сверки нужен PDF с нативными линиями и подписями. Обычное чтение остаётся доступным.',
      }
    const issue = sourceTopologyDraftIssue({
      contours,
      reading: before,
      source,
      linework: page.linework,
      evidence:
        hasSourceTopology && page.nativeTextAnchors && page.lineworkRasterSource
          ? {
              native: page.nativeTextAnchors,
              work: page.linework,
              lineworkSource: page.lineworkRasterSource,
            }
          : undefined,
    })
    if (issue) {
      return {
        ok: false,
        error:
          floorReviewMessages[issue] ??
          'Проверьте контуры, стороны проёмов и неподвижные объекты внутри комнат на выбранном листе. Разметка не сохранена.',
      }
    }
    const sourceRooms = planPageRoomInventory(page.image.planText, page)
    // Source-only snapshots have no dimension edges and must not enter physical binding checks.
    const dimensionContours = {
      ...contours,
      rooms: contours.rooms.filter((room) => room.sourceTopology === undefined),
    }
    for (const room of dimensionContours.rooms) {
      for (const edge of room.dimensionEdges ?? []) {
        const selected = edge.labelIndexes.flatMap((index) => {
          const label = labels[index]
          return label && label.x !== undefined && label.y !== undefined
            ? [{ ...label, index, x: label.x, y: label.y }]
            : []
        })
        const binding = pdfDimensionForEdge(
          page.linework,
          source,
          dimensionContours,
          pdfContourIdentity(room),
          edge,
          selected,
        )
        if (binding.status !== 'candidate')
          return {
            ok: false,
            error: `Сторона ${edge.wallEdgeIndex + 1}: проверьте выбранные подписи и связь обоих концов размера с углами стены. Разметка не сохранена.`,
          }
      }
    }
    const reading: PlanReading = {
      ...before,
      pageReview: {
        version: 1,
        savedAt: new Date().toISOString(),
        contours,
        ...(sourceRooms ? { sourceRooms } : {}),
        featureChecks: {
          openings: verifyPlanPageOpenings(page.linework, source, contours, page.image.planText),
        },
      },
    }
    const previousContours = before.pageReview?.contours
    if (
      before.geometry &&
      geometryUsesReview(before, previousContours ?? contours) &&
      (!previousContours || contourGeometryKey(previousContours) !== contourGeometryKey(contours))
    ) {
      const { confirmedAt: _confirmation, ...geometry } = before.geometry
      reading.geometry = {
        ...geometry,
        status: 'draft',
        requiresSourceReviewReimport: true,
        warnings: [
          ...new Set([
            ...geometry.warnings,
            'Исходная разметка PDF изменилась. Прежние координаты и обмеры сохранены как черновик; обновите перенос из исходного листа и заново сверьте высоты, уровни и маршрут заноса перед подтверждением.',
          ]),
        ],
      }
      if (before.deliveryMeasurements) {
        const { reportJson: _report, ...measurements } = before.deliveryMeasurements
        reading.deliveryMeasurements = measurements
      }
    }
    // The repository compares both the file key and the complete JSONB reading atomically.
    await setPlanReading(session.user.id, projectId, reading, project)
    await recordAudit({
      action: 'project.plan_page_reviewed',
      actorId: session.user.id,
      targetType: 'project',
      targetId: projectId,
      headers: await headers(),
      metadata: {
        page: source.pdfPage,
        planState: source.state,
        contours: contours.rooms.length,
        ...(contours.floor ? { floorVertices: contours.floor.polygon.length } : {}),
        openings: contours.rooms.reduce((count, room) => count + (room.openings?.length ?? 0), 0),
        obstacles: contours.rooms.reduce((count, room) => count + (room.obstacles?.length ?? 0), 0),
      },
    })
    revalidatePath(`/projects/${projectId}`)
    return { ok: true, data: { reading, revision: planEditRevision(project.planUrl, reading) } }
  } catch (error) {
    if (error instanceof PlanEditConflictError)
      return { ok: false, error: error.message, code: 'plan-conflict' }
    if (error instanceof AccessError || error instanceof PlanReadError)
      return { ok: false, error: error.message }
    console.error('plan page review save failed', error)
    return { ok: false, error: 'Не получилось сохранить разметку. Попробуйте ещё раз.' }
  }
}
