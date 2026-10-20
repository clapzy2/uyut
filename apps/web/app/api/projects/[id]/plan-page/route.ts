import { createHash } from 'node:crypto'
import { planMeasurementTextItems } from '@uyut/ai'
import type { NextRequest } from 'next/server'
import { AccessError, assertOwnerOrCollaborator } from '@/lib/projects/access'
import { PlanReadError, preparePlanPage } from '@/lib/projects/plan-document'
import { planEditRevision } from '@/lib/projects/plan-edit-revision'
import { nativeDimensionMillimetres } from '@/lib/projects/plan-pdf-dimension-chain'
import { nativePageSegments } from '@/lib/projects/plan-pdf-opening-endpoint'
import { pdfPointInside } from '@/lib/projects/plan-pdf-room-binding'
import { getSession } from '@/lib/session'
import { getObject } from '@/lib/storage'

export const runtime = 'nodejs'

const privateHeaders = { 'cache-control': 'private, no-store', 'x-content-type-options': 'nosniff' }

function failure(message: string, status: number) {
  return new Response(message, { status, headers: privateHeaders })
}

type SourceLabel = { name: string; pagePoint?: { x: number; y: number } }

/**
 * Подпись площади так, как она напечатана. Надстрочная «²» в PDF лежит отдельной
 * меткой рядом с «м»; возвращаем её обратно, ничего не додумывая сверх этого.
 */
function printedAreaText(label: SourceLabel, labels: readonly SourceLabel[]) {
  const text = label.name.trim()
  const point = label.pagePoint
  if (!point || !/(м|m)$/iu.test(text)) return text
  const superscript = labels.some((other) => {
    const candidate = other.pagePoint
    return (
      other !== label &&
      candidate !== undefined &&
      other.name.trim() === '2' &&
      Math.abs(candidate.y - point.y) <= 5 &&
      candidate.x > point.x &&
      candidate.x - point.x < 45
    )
  })
  return superscript ? `${text}²` : text
}

/** Private source pixels and coordinate metadata, without a paid reader invocation. */
export async function GET(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const session = await getSession()
  if (!session) return failure('Сессия закончилась. Войдите снова.', 401)
  const pageParam = request.nextUrl.searchParams.get('page')
  const revision = request.nextUrl.searchParams.get('revision')
  const format = request.nextUrl.searchParams.get('format')
  if (
    !pageParam ||
    !/^[1-9]\d{0,3}$/.test(pageParam) ||
    !/^[a-f0-9]{64}$/.test(revision ?? '') ||
    (format !== null &&
      ![
        'points',
        'raster',
        'native-review',
        'native-review-image',
        'source-floor-reference',
        'fill-hints',
      ].includes(format))
  )
    return failure('Проверьте выбранный лист и версию плана.', 400)
  const pageNumber = Number(pageParam)
  const raster = format === 'raster'
  const nativeReview = format === 'native-review'
  const nativeReviewImage = format === 'native-review-image'
  const sourceFloorReference = format === 'source-floor-reference'
  const fillHints = format === 'fill-hints'
  const inspection = nativeReview || nativeReviewImage || sourceFloorReference || fillHints
  const { id } = await params
  try {
    const project = await assertOwnerOrCollaborator(session.user.id, id)
    if (revision !== planEditRevision(project.planUrl, project.planReading))
      return failure('План изменился. Загрузите актуальную версию.', 409)
    if (!project.planUrl?.toLowerCase().endsWith('.pdf') || !project.planReading)
      return failure('Сначала прочитайте выбранный лист PDF-плана.', 400)
    if (
      (project.planReading.sourcePage ?? (raster ? 1 : undefined)) !== pageNumber ||
      (!raster &&
        project.planReading.planState !== 'existing' &&
        project.planReading.planState !== 'proposed')
    )
      return failure('Выберите прочитанный обмерный или проектный лист.', 400)
    if (inspection && project.planReading.planState !== 'existing')
      return failure('Для проверки выберите обмерный лист существующей квартиры.', 400)
    if (
      raster &&
      ((project.planReading.pageReview && !project.planReading.geometry?.manualPdfUnderlay) ||
        project.planReading.geometry?.pdfCalibration ||
        project.planReading.geometry?.source !== 'manual')
    )
      return failure('Для нативной PDF-схемы используйте проверенный исходный лист.', 400)
    const object = await getObject(project.planUrl)
    const body = Buffer.from(object.body)
    const sha256 = createHash('sha256').update(body).digest('hex')
    const manualUnderlay = project.planReading.geometry?.manualPdfUnderlay
    if (
      raster &&
      manualUnderlay &&
      (manualUnderlay.pdfPage !== pageNumber || manualUnderlay.sourceSha256 !== sha256)
    )
      return failure(
        'Исходный PDF изменился. Откройте актуальный лист и создайте ручной черновик заново.',
        409,
      )
    const page =
      nativeReview || sourceFloorReference || fillHints
        ? await preparePlanPage(body, true, pageNumber, true, true)
        : await preparePlanPage(body, true, pageNumber, inspection ? false : !raster)
    const labels = planMeasurementTextItems(page.image.planText)
    if (
      page.pageNumber !== pageNumber ||
      (!raster &&
        !inspection &&
        (!page.linework ||
          page.linework.paths.length === 0 ||
          page.linework.truncated ||
          page.linework.unsupportedContexts > 0 ||
          page.linework.unsupportedPaths > 0 ||
          !labels?.some((label) => label.text.trim() !== '')))
    )
      return failure('Для разметки нужен PDF с нативными линиями и подписями.', 422)
    // Do not return a superseded sheet if it changed during PDF preparation.
    const current = await assertOwnerOrCollaborator(session.user.id, id)
    if (revision !== planEditRevision(current.planUrl, current.planReading))
      return failure('План изменился. Загрузите актуальную версию.', 409)
    const sourceHeaders = {
      ...privateHeaders,
      'X-Plan-Sha256': sha256,
      'X-Plan-Page-Count': String(page.pageCount),
      'X-Plan-Page': String(page.pageNumber),
    }
    if (inspection) {
      const imageSha256 = createHash('sha256').update(page.image.body).digest('hex')
      const headers = {
        ...sourceHeaders,
        'X-Plan-Image-Width': String(page.image.width),
        'X-Plan-Image-Height': String(page.image.height),
        'X-Plan-Image-Sha256': imageSha256,
      }
      if (nativeReviewImage)
        return new Response(new Uint8Array(page.image.body), {
          headers: { ...headers, 'content-type': 'image/jpeg' },
        })
      if (fillHints) {
        if (!page.nativeTextAnchors || !page.linework || !page.lineworkRasterSource)
          return failure('Нативные заливки этого листа недоступны.', 422)
        if (
          page.nativeTextAnchors.originalPdfSha256 !== sha256 ||
          page.nativeTextAnchors.source.sha256 !== imageSha256 ||
          page.nativeTextAnchors.source.page !== pageNumber ||
          page.nativeTextAnchors.source.width !== page.image.width ||
          page.nativeTextAnchors.source.height !== page.image.height ||
          page.lineworkRasterSource.sha256 !== imageSha256 ||
          page.lineworkRasterSource.page !== pageNumber ||
          page.lineworkRasterSource.width !== page.image.width ||
          page.lineworkRasterSource.height !== page.image.height
        )
          return failure('Исходные заливки не совпадают с открытым листом.', 409)
        const { nativeFillCandidates } = await import('@/lib/projects/plan-native-fill-candidates')
        const { automaticNativeDimensionRoles } = await import(
          '@/lib/projects/plan-native-dimension-roles'
        )
        const { calibratedFillAreaM2, nativeNumberedFillHints, printedDimensionScale } =
          await import('@/lib/projects/plan-native-numbered-fill-hints')
        const { nativeRoomScheduleEvidence } = await import(
          '@/lib/projects/plan-native-room-schedule'
        )
        const evidence = {
          native: page.nativeTextAnchors,
          work: page.linework,
          lineworkSource: page.lineworkRasterSource,
        }
        const inventory = nativeFillCandidates(evidence)
        const dimensionRoles = automaticNativeDimensionRoles({
          ...evidence,
          source: { sha256, pdfPage: pageNumber, state: 'existing' },
        })
        const metricScale = dimensionRoles.refusalReason
          ? null
          : printedDimensionScale(
              dimensionRoles.candidates,
              page.linework.pageWidth,
              page.linework.pageHeight,
            )
        const numbered = nativeNumberedFillHints({
          native: page.nativeTextAnchors,
          inventory,
          schedule: nativeRoomScheduleEvidence(evidence),
        })
        const labels = page.nativeTextAnchors.labels
        const displayCandidates = inventory.candidates.filter(
          (candidate) => candidate.polygon.length <= 100,
        )
        const displayedIds = new Set(displayCandidates.map((candidate) => candidate.id))
        return Response.json(
          {
            sourceRevision: revision,
            source: { sha256, pdfPage: pageNumber, state: 'existing' },
            status: inventory.refusalReason ? 'held' : 'diagnostic',
            refusalReason: inventory.refusalReason,
            truncated:
              inventory.truncated || displayCandidates.length !== inventory.candidates.length,
            roomHints:
              numbered.status === 'diagnostic'
                ? numbered.rows.map((row) => ({
                    ...row,
                    fillIds: row.fillIds.filter((id) => displayedIds.has(id)),
                  }))
                : [],
            candidates: inventory.refusalReason
              ? []
              : displayCandidates.map((candidate) => {
                  const area = metricScale
                    ? calibratedFillAreaM2(candidate.polygon, metricScale)
                    : null
                  return {
                    id: candidate.id,
                    polygon: candidate.polygon,
                    areaM2:
                      area !== null && area >= 0.001 && area <= 10_000
                        ? Number(area.toFixed(3))
                        : null,
                    nearbyText: labels
                      .filter(
                        (label) =>
                          label.pagePoint &&
                          /^\p{Lu}[\p{L}\s–—-]{3,39}$/u.test(label.name.trim()) &&
                          pdfPointInside(label.pagePoint, candidate.polygon),
                      )
                      .slice(0, 4)
                      .map((label) => label.name.slice(0, 40)),
                    // Подпись площади, напечатанная внутри самой заливки: человеку
                    // нужно сравнить её с расчётом. Выбор контура она не определяет
                    // и в геометрию не попадает.
                    printedAreas: labels
                      .filter(
                        (label) =>
                          label.pagePoint &&
                          /\d[\d\s.,]*\s*(м|m)\s*2?\s*$/iu.test(label.name.trim()) &&
                          pdfPointInside(label.pagePoint, candidate.polygon),
                      )
                      .slice(0, 2)
                      .map((label) => printedAreaText(label, labels).slice(0, 40)),
                  }
                }),
          },
          {
            headers: {
              ...headers,
              'X-Plan-Page-Width': String(page.linework.pageWidth),
              'X-Plan-Page-Height': String(page.linework.pageHeight),
            },
          },
        )
      }
      if (sourceFloorReference) {
        if (!page.linework || !current.planReading)
          return failure('Не удалось проверить исходные области PDF.', 422)
        const { planPageSourceFloors } = await import('@/lib/projects/plan-page-source-floors')
        const reference = planPageSourceFloors({
          source: { sha256, pdfPage: pageNumber, state: 'existing' },
          sourceRevision: revision as string,
          pageWidth: page.linework.pageWidth,
          pageHeight: page.linework.pageHeight,
          reading: current.planReading,
          includeSpanVisibility: ['2', '3'].includes(
            request.nextUrl.searchParams.get('evidenceVersion') ?? '',
          ),
          includeBlockerPaint: request.nextUrl.searchParams.get('evidenceVersion') === '3',
          evidence:
            page.nativeTextAnchors && page.lineworkRasterSource
              ? {
                  native: page.nativeTextAnchors,
                  work: page.linework,
                  lineworkSource: page.lineworkRasterSource,
                }
              : undefined,
        })
        const afterReference = await assertOwnerOrCollaborator(session.user.id, id)
        if (revision !== planEditRevision(afterReference.planUrl, afterReference.planReading))
          return failure('План изменился. Загрузите актуальную версию.', 409)
        // Older open tabs validate their response strictly. Expand this read-only
        // contract only for clients that explicitly request the new inspection.
        if (request.nextUrl.searchParams.get('openingInspection') !== '1')
          delete reference.openingInspection
        return Response.json(reference, {
          headers: {
            ...headers,
            'X-Plan-Page-Width': String(page.linework.pageWidth),
            'X-Plan-Page-Height': String(page.linework.pageHeight),
          },
        })
      }
      const { nativeReviewPacket } = await import('@/lib/projects/plan-native-review-packet')
      const packet = nativeReviewPacket({
        source: { sha256, pdfPage: pageNumber, state: 'existing' },
        image: {
          sha256: imageSha256,
          page: pageNumber,
          width: page.image.width,
          height: page.image.height,
        },
        native: page.nativeTextAnchors,
        work: page.linework,
        lineworkSource: page.lineworkRasterSource,
        savedReading: current.planReading ?? undefined,
        includeEndpointWitnesses: request.nextUrl.searchParams.get('evidenceVersion') === '2',
      })
      const afterInspection = await assertOwnerOrCollaborator(session.user.id, id)
      if (revision !== planEditRevision(afterInspection.planUrl, afterInspection.planReading))
        return failure('План изменился. Загрузите актуальную версию.', 409)
      return Response.json({ ...packet, sourceRevision: revision }, { headers })
    }
    if (raster) {
      return new Response(new Uint8Array(page.image.body), {
        headers: {
          ...sourceHeaders,
          'X-Plan-Image-Width': String(page.image.width),
          'X-Plan-Image-Height': String(page.image.height),
          'content-type': 'image/jpeg',
        },
      })
    }
    // The native gate above requires both layers; raster preview never supplies native coordinates.
    if (!page.linework || !labels) return failure('Не удалось прочитать нативные слои PDF.', 422)
    const nativeHeaders = {
      ...sourceHeaders,
      'X-Plan-Page-Width': String(page.linework.pageWidth),
      'X-Plan-Page-Height': String(page.linework.pageHeight),
    }
    if (format === 'points') {
      // Bounded native vertices and stroke segments support exact endpoint crossings.
      // Только нативные числовые подписи, без вывода о стенах или размерах комнаты.
      const unique = new Map<string, { x: number; y: number }>()
      for (const path of page.linework.paths) {
        for (const point of path.points) unique.set(`${point.x}:${point.y}`, point)
      }
      return Response.json(
        {
          points: [...unique.values()],
          segments: nativePageSegments(page.linework),
          dimensionLabels: labels.flatMap((label, index) => {
            if (
              nativeDimensionMillimetres(label.text) === undefined ||
              !Number.isFinite(label.rotation) ||
              label.x === undefined ||
              label.y === undefined ||
              ![label.x, label.y].every(
                (value) => Number.isFinite(value) && value >= 0 && value <= 1000,
              )
            )
              return []
            return [{ index, text: label.text, rotation: label.rotation, x: label.x, y: label.y }]
          }),
        },
        { headers: nativeHeaders },
      )
    }
    return new Response(new Uint8Array(page.image.body), {
      headers: { ...nativeHeaders, 'content-type': 'image/jpeg' },
    })
  } catch (error) {
    if (error instanceof AccessError) return failure('Проект не найден.', 404)
    if (error instanceof PlanReadError) return failure(error.message, 422)
    console.error('plan page preview failed', error)
    return failure('Не получилось открыть лист. Попробуйте ещё раз.', 500)
  }
}
