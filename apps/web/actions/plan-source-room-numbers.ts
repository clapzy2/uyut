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
import {
  planSourceRoomNumberOptions,
  recoverPlanSourceRoomNumbers,
} from '@/lib/projects/plan-source-room-numbers'
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
    before?.planState !== 'existing' ||
    !before.paintedFloorReview
  )
    throw new PlanReadError('Сначала сохраните выбор пола на существующем PDF-плане.')
  const saved = before.paintedFloorReview
  if (
    saved.version !== 1 ||
    typeof saved.draftJson !== 'string' ||
    Buffer.byteLength(saved.draftJson, 'utf8') > 64 * 1024
  )
    throw new PlanReadError('Не удалось прочитать сохранённый выбор пола.')
  let reviewed: ReviewedNativePaintedFloors
  try {
    reviewed = JSON.parse(saved.draftJson)
  } catch {
    throw new PlanReadError('Не удалось прочитать сохранённый выбор пола.')
  }
  if (!reviewed?.source || reviewed.source.pdfPage !== before.sourcePage)
    throw new PlanEditConflictError()
  const object = await getObject(project.planUrl)
  const body = Buffer.from(object.body)
  const hash = createHash('sha256').update(body).digest('hex')
  if (hash !== reviewed.source.sha256) throw new PlanEditConflictError()
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
    throw new PlanReadError('Не удалось сверить номера с актуальными линиями и подписями PDF.')
  const input = {
    native,
    work: page.linework,
    lineworkSource: page.lineworkRasterSource,
    reviewed,
    reading: before,
  }
  return { session, project, before, input }
}

function failed(error: unknown): { ok: false; error: string; code?: 'plan-conflict' } {
  if (error instanceof PlanEditConflictError)
    return { ok: false, error: error.message, code: 'plan-conflict' }
  if (error instanceof AccessError || error instanceof PlanReadError)
    return { ok: false, error: error.message }
  console.error('source room number recovery failed', error)
  return { ok: false, error: 'Не удалось восстановить номера комнат. Попробуйте ещё раз.' }
}

/** Authenticated read-only proposals; no AI calls and no automatic identity assignment. */
export async function getPlanSourceRoomNumberOptions(
  projectId: string,
  expectedRevision: string,
): Promise<
  ActionResult<
    Omit<ReturnType<typeof planSourceRoomNumberOptions>, 'refusalReason'> & { revision: string }
  >
> {
  try {
    const { project, before, input } = await checkedSource(projectId, expectedRevision)
    const result = planSourceRoomNumberOptions(input)
    if (result.refusalReason)
      throw new PlanReadError(`Номера комнат пока нельзя восстановить: ${result.refusalReason}.`)
    const { refusalReason: _, ...options } = result
    return { ok: true, data: { ...options, revision: planEditRevision(project.planUrl, before) } }
  } catch (error) {
    return failed(error)
  }
}

/** Restore missing printed identifiers only; retain every other field and atomic revision guard. */
export async function savePlanSourceRoomNumbers(
  projectId: string,
  reviewJson: string,
  expectedRevision: string,
): Promise<ActionResult<{ reading: PlanReading; revision: string }>> {
  try {
    const { session, project, input } = await checkedSource(projectId, expectedRevision)
    if (typeof reviewJson !== 'string' || Buffer.byteLength(reviewJson, 'utf8') > 16 * 1024)
      throw new PlanReadError('Выбор номеров должен быть не больше 16 КиБ.')
    let review: unknown
    try {
      review = JSON.parse(reviewJson)
    } catch {
      throw new PlanReadError('Не удалось прочитать выбор номеров.')
    }
    const result = recoverPlanSourceRoomNumbers(input, review)
    if (!result.reading || result.refusalReason)
      throw new PlanReadError(`Номера не сохранены: ${result.refusalReason}.`)
    await setPlanReading(session.user.id, projectId, result.reading, project)
    await recordAudit({
      action: 'project.plan_rooms',
      actorId: session.user.id,
      targetType: 'project',
      targetId: projectId,
      headers: await headers(),
      metadata: {
        operation: 'source-room-number-recovery',
        page: input.reviewed.source.pdfPage,
        mappings: result.mappings.map(({ floorId, roomIndex, sourceNumber }) => ({
          floorId,
          roomIndex,
          sourceNumber,
        })),
        geometryChanged: false,
      },
    })
    revalidatePath(`/projects/${projectId}`)
    return {
      ok: true,
      data: {
        reading: result.reading,
        revision: planEditRevision(project.planUrl, result.reading),
      },
    }
  } catch (error) {
    return failed(error)
  }
}
