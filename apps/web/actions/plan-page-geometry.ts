'use server'

import { createHash } from 'node:crypto'
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
import { pdfContourRoomNumbers } from '@/lib/projects/plan-pdf-room-binding'
import { setPlanReading } from '@/lib/projects/repository'
import { getSession } from '@/lib/session'
import { getObject } from '@/lib/storage'

const roomNumbersSchema = z
  .array(z.number().int().min(1).max(50))
  .min(1)
  .max(12)
  .refine((numbers) => new Set(numbers).size === numbers.length)

/** Creates a new draft only; never replaces existing geometry or confirms measurements. */
export async function createPlanPageGeometryDraft(
  projectId: string,
  roomNumbers: unknown,
  expectedRevision: string,
  calibrationRoomNumbers?: unknown,
): Promise<ActionResult<{ geometry: PlanGeometry; revision: string }>> {
  const session = await getSession()
  if (!session) return { ok: false, error: 'Сессия закончилась. Войдите снова.' }
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
    if (before.geometry)
      return {
        ok: false,
        error: '2D-схема уже существует. Её правки сохранены; откройте редактор схемы.',
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
      },
      selected.data,
    )
    if (!result.ok) return result

    const reading = { ...before, geometry: result.geometry }
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
