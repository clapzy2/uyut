'use server'

import { createHash } from 'node:crypto'
import type { PlanReading } from '@uyut/db'
import { revalidatePath } from 'next/cache'
import { headers } from 'next/headers'
import type { ActionResult } from '@/actions/projects'
import { recordAudit } from '@/lib/audit'
import { AccessError, assertOwner } from '@/lib/projects/access'
import { PlanReadError, preparePlanPage } from '@/lib/projects/plan-document'
import { PlanEditConflictError, planEditRevision } from '@/lib/projects/plan-edit-revision'
import type { ReviewedNativePaintedFloors } from '@/lib/projects/plan-native-painted-floor-review'
import { nativeReviewedFloorHeightBindings } from '@/lib/projects/plan-native-reviewed-floor-heights'
import { setPlanReading } from '@/lib/projects/repository'
import { getSession } from '@/lib/session'
import { getObject } from '@/lib/storage'

async function checkedSource(projectId: string, expectedRevision: string) {
  const session = await getSession()
  if (!session) throw new AccessError('Сессия закончилась. Войдите снова.')
  const project = await assertOwner(session.user.id, projectId)
  if (expectedRevision !== planEditRevision(project.planUrl, project.planReading))
    throw new PlanEditConflictError()
  const before = project.planReading
  if (
    !project.planUrl?.toLowerCase().endsWith('.pdf') ||
    !before?.paintedFloorReview ||
    before.planState !== 'existing'
  )
    throw new PlanReadError('Сначала сохраните выбор областей пола на существующем PDF-плане.')
  if (
    before.paintedFloorReview.version !== 1 ||
    typeof before.paintedFloorReview.draftJson !== 'string' ||
    Buffer.byteLength(before.paintedFloorReview.draftJson, 'utf8') > 64 * 1024
  )
    throw new PlanReadError('Сохранённый выбор пола слишком большой.')
  let reviewedFloors: ReviewedNativePaintedFloors
  try {
    reviewedFloors = JSON.parse(before.paintedFloorReview.draftJson)
  } catch {
    throw new PlanReadError('Сохранённый выбор пола не удалось прочитать.')
  }
  if (!reviewedFloors?.source || reviewedFloors.source.pdfPage !== before.sourcePage)
    throw new PlanEditConflictError()
  const object = await getObject(project.planUrl)
  const body = Buffer.from(object.body)
  const hash = createHash('sha256').update(body).digest('hex')
  if (hash !== reviewedFloors.source.sha256) throw new PlanEditConflictError()
  const page = await preparePlanPage(body, true, before.sourcePage, true, true)
  const native = page.nativeTextAnchors
  if (
    page.pageNumber !== before.sourcePage ||
    !native ||
    !page.linework ||
    !page.lineworkRasterSource ||
    native.originalPdfSha256 !== hash ||
    native.source.page !== page.pageNumber ||
    native.source.sha256 !== createHash('sha256').update(page.image.body).digest('hex') ||
    native.source.width !== page.image.width ||
    native.source.height !== page.image.height
  )
    throw new PlanReadError('Не удалось проверить актуальные линии и подписи PDF-плана.')
  const input = {
    native,
    work: page.linework,
    lineworkSource: page.lineworkRasterSource,
    reviewedFloors,
    floorReviewSavedAt: before.paintedFloorReview.savedAt,
  }
  const result = nativeReviewedFloorHeightBindings(input)
  if (result.refusalReason)
    throw new PlanReadError(`Привязка высот пока недоступна: ${result.refusalReason}.`)
  return { session, project, before, input, result }
}

function failed(error: unknown): { ok: false; error: string; code?: 'plan-conflict' } {
  if (error instanceof PlanEditConflictError)
    return { ok: false, error: error.message, code: 'plan-conflict' }
  if (error instanceof AccessError || error instanceof PlanReadError)
    return { ok: false, error: error.message }
  console.error('floor height source review failed', error)
  return { ok: false, error: 'Не удалось проверить привязку высот. Попробуйте ещё раз.' }
}

/** Read-only fresh PDF verification, without AI calls or geometry mutations. */
export async function getPlanFloorHeightReviewOptions(
  projectId: string,
  expectedRevision: string,
): Promise<
  ActionResult<
    Pick<ReturnType<typeof nativeReviewedFloorHeightBindings>, 'review' | 'floors' | 'options'> & {
      revision: string
      savedBindingStatus: 'not-saved' | 'checked' | 'refused'
      savedBindingReason: string | null
    }
  >
> {
  try {
    const { project, before, input, result } = await checkedSource(projectId, expectedRevision)
    let savedBindingStatus: 'not-saved' | 'checked' | 'refused' = 'not-saved'
    let savedBindingReason: string | null = null
    let review = result.review
    if (before.heightBindingReview) {
      savedBindingStatus = 'refused'
      savedBindingReason = 'invalid-saved-height-review'
      if (
        before.heightBindingReview.version === 1 &&
        typeof before.heightBindingReview.draftJson === 'string' &&
        Buffer.byteLength(before.heightBindingReview.draftJson, 'utf8') <= 16 * 1024
      ) {
        try {
          const checked = nativeReviewedFloorHeightBindings({
            ...input,
            reviewed: JSON.parse(before.heightBindingReview.draftJson),
          })
          savedBindingReason = checked.refusalReason
          if (!checked.refusalReason) {
            savedBindingStatus = 'checked'
            review = checked.review
          }
        } catch {
          /* Invalid stored input stays refused; current options remain available. */
        }
      }
    }
    return {
      ok: true,
      data: {
        review,
        floors: result.floors,
        options: result.options,
        revision: planEditRevision(project.planUrl, before),
        savedBindingStatus,
        savedBindingReason,
      },
    }
  } catch (error) {
    return failed(error)
  }
}

/** Persist only source IDs selected by a person; source values are freshly derived. */
export async function savePlanFloorHeightReview(
  projectId: string,
  reviewJson: string,
  expectedRevision: string,
): Promise<ActionResult<{ reading: PlanReading; revision: string }>> {
  try {
    const { session, project, before, input } = await checkedSource(projectId, expectedRevision)
    if (typeof reviewJson !== 'string' || Buffer.byteLength(reviewJson, 'utf8') > 16 * 1024)
      throw new PlanReadError('Привязка высот должна быть не больше 16 КиБ.')
    let reviewed: unknown
    try {
      reviewed = JSON.parse(reviewJson)
    } catch {
      throw new PlanReadError('Не удалось прочитать привязку высот.')
    }
    const checked = nativeReviewedFloorHeightBindings({ ...input, reviewed })
    if (checked.refusalReason)
      throw new PlanReadError(`Привязка высот не сохранена: ${checked.refusalReason}.`)
    const reading: PlanReading = {
      ...before,
      heightBindingReview: {
        version: 1,
        savedAt: new Date().toISOString(),
        draftJson: JSON.stringify(checked.review),
      },
    }
    await setPlanReading(session.user.id, projectId, reading, project)
    await recordAudit({
      action: 'project.plan_floor_height_reviewed',
      actorId: session.user.id,
      targetType: 'project',
      targetId: projectId,
      headers: await headers(),
      metadata: { page: input.reviewedFloors.source.pdfPage, bindings: checked.bindings.length },
    })
    revalidatePath(`/projects/${projectId}`)
    return { ok: true, data: { reading, revision: planEditRevision(project.planUrl, reading) } }
  } catch (error) {
    return failed(error)
  }
}
