'use server'

import { createHash } from 'node:crypto'
import { planMeasurementTextItems } from '@uyut/ai'
import type { PlanReading } from '@uyut/db'
import { revalidatePath } from 'next/cache'
import { headers } from 'next/headers'
import type { ActionResult } from '@/actions/projects'
import { recordAudit } from '@/lib/audit'
import { AccessError, assertOwner } from '@/lib/projects/access'
import { PlanReadError, preparePlanPage } from '@/lib/projects/plan-document'
import { PlanEditConflictError, planEditRevision } from '@/lib/projects/plan-edit-revision'
import { verifyPlanPageOpenings } from '@/lib/projects/plan-page-feature-checks'
import { planPageContoursSchema, planPageReviewIssue } from '@/lib/projects/plan-page-review'
import { planPageRoomInventory } from '@/lib/projects/plan-page-room-inventory'
import { setPlanReading } from '@/lib/projects/repository'
import { getSession } from '@/lib/session'
import { getObject } from '@/lib/storage'

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
    return { ok: false, error: 'Проверьте контуры, номера комнат и выбранный лист.' }

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
    const page = await preparePlanPage(body, true, source.pdfPage, true)
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
    const issue = planPageReviewIssue(contours, before, source, page.linework)
    if (issue)
      return {
        ok: false,
        error:
          'Проверьте контуры, стороны проёмов и неподвижные объекты внутри комнат на выбранном листе. Разметка не сохранена.',
      }
    const sourceRooms = planPageRoomInventory(page.image.planText)
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
