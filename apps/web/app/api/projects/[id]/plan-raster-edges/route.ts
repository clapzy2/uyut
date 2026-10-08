import { createHash } from 'node:crypto'
import type { NextRequest } from 'next/server'
import { AccessError, assertOwnerOrCollaborator } from '@/lib/projects/access'
import { planEditRevision } from '@/lib/projects/plan-edit-revision'
import { rasterPlanCandidates } from '@/lib/projects/plan-raster-candidates'
import { getSession } from '@/lib/session'
import { getObject } from '@/lib/storage'

export const runtime = 'nodejs'

const privateHeaders = { 'cache-control': 'private, no-store', 'x-content-type-options': 'nosniff' }

function failure(message: string, status: number) {
  return new Response(message, { status, headers: privateHeaders })
}

/** Optional unclassified pixel guides for human tracing, never confirmed walls or openings. */
export async function GET(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const session = await getSession()
  if (!session) return failure('Сессия закончилась. Войдите снова.', 401)
  const revision = request.nextUrl.searchParams.get('revision')
  const pageParam = request.nextUrl.searchParams.get('page') ?? '1'
  if (!/^[a-f0-9]{64}$/.test(revision ?? '') || !/^[1-9]\d{0,3}$/.test(pageParam))
    return failure('Проверьте выбранный лист и версию плана.', 400)
  const pageNumber = Number(pageParam)
  const { id } = await params
  try {
    const project = await assertOwnerOrCollaborator(session.user.id, id)
    if (revision !== planEditRevision(project.planUrl, project.planReading))
      return failure('План изменился. Загрузите актуальную версию.', 409)
    if (!project.planUrl) return failure('Сначала загрузите исходный план.', 400)
    const isPdf = project.planUrl.toLowerCase().endsWith('.pdf')
    const reading = project.planReading
    if (
      (isPdf &&
        (reading?.geometry?.source !== 'manual' ||
          reading.pageReview ||
          reading.geometry.pdfCalibration ||
          pageNumber !== (reading.sourcePage ?? 1))) ||
      (!isPdf && pageNumber !== 1)
    )
      return failure('Выберите исходный лист для ручной растровой обводки.', 400)
    const object = await getObject(project.planUrl)
    const body = Buffer.from(object.body)
    const candidates = await rasterPlanCandidates(body, isPdf, pageNumber)
    // Access and revision are checked again after potentially slow decoding.
    const current = await assertOwnerOrCollaborator(session.user.id, id)
    if (revision !== planEditRevision(current.planUrl, current.planReading))
      return failure('План изменился. Загрузите актуальную версию.', 409)
    return Response.json(
      {
        source: {
          sha256: createHash('sha256').update(body).digest('hex'),
          page: pageNumber,
          width: candidates.width,
          height: candidates.height,
        },
        points: candidates.points,
        segments: candidates.segments,
        truncated: candidates.truncated,
        uncertain: candidates.uncertain,
      },
      { headers: privateHeaders },
    )
  } catch (error) {
    if (error instanceof AccessError) return failure('Проект не найден.', 404)
    // Decoder/storage diagnostics can include private object keys; do not expose them.
    return failure('Не получилось прочитать линии исходника. Попробуйте ещё раз.', 422)
  }
}
