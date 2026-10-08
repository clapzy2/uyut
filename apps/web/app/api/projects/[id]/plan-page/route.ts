import { createHash } from 'node:crypto'
import { planMeasurementTextItems } from '@uyut/ai'
import type { NextRequest } from 'next/server'
import { AccessError, assertOwnerOrCollaborator } from '@/lib/projects/access'
import { PlanReadError, preparePlanPage } from '@/lib/projects/plan-document'
import { planEditRevision } from '@/lib/projects/plan-edit-revision'
import { nativeDimensionMillimetres } from '@/lib/projects/plan-pdf-dimension-chain'
import { nativePageSegments } from '@/lib/projects/plan-pdf-opening-endpoint'
import { getSession } from '@/lib/session'
import { getObject } from '@/lib/storage'

export const runtime = 'nodejs'

const privateHeaders = { 'cache-control': 'private, no-store', 'x-content-type-options': 'nosniff' }

function failure(message: string, status: number) {
  return new Response(message, { status, headers: privateHeaders })
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
    (format !== null && format !== 'points' && format !== 'raster')
  )
    return failure('Проверьте выбранный лист и версию плана.', 400)
  const pageNumber = Number(pageParam)
  const raster = format === 'raster'
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
    if (
      raster &&
      (project.planReading.pageReview ||
        project.planReading.geometry?.pdfCalibration ||
        project.planReading.geometry?.source !== 'manual')
    )
      return failure('Для нативной PDF-схемы используйте проверенный исходный лист.', 400)
    const object = await getObject(project.planUrl)
    const body = Buffer.from(object.body)
    const sha256 = createHash('sha256').update(body).digest('hex')
    const page = await preparePlanPage(body, true, pageNumber, !raster)
    const labels = planMeasurementTextItems(page.image.planText)
    if (
      page.pageNumber !== pageNumber ||
      (!raster &&
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
