'use server'

import { createHash } from 'node:crypto'
import type { PlanReading } from '@uyut/db'
import { revalidatePath } from 'next/cache'
import { headers } from 'next/headers'
import { z } from 'zod'
import type { ActionResult } from '@/actions/projects'
import { recordAudit } from '@/lib/audit'
import { AccessError, assertOwner } from '@/lib/projects/access'
import { PlanReadError, preparePlanPage } from '@/lib/projects/plan-document'
import { PlanEditConflictError, planEditRevision } from '@/lib/projects/plan-edit-revision'
import { nativePaintedFloorProposal } from '@/lib/projects/plan-native-painted-floor-proposal'
import { nativePaintedFloorReview } from '@/lib/projects/plan-native-painted-floor-review'
import { setPlanReading } from '@/lib/projects/repository'
import { getSession } from '@/lib/session'
import { getObject } from '@/lib/storage'

const MAX_REVIEW_BYTES = 64 * 1024
const point = z
  .object({ x: z.number().finite().min(0).max(1000), y: z.number().finite().min(0).max(1000) })
  .strict()
const ring = z.array(point).min(3).max(100)
const reviewedSchema = z
  .object({
    review: z.literal('manual-native-painted-floor-review'),
    source: z
      .object({
        sha256: z.string().regex(/^[a-f0-9]{64}$/),
        pdfPage: z.number().int().min(1).max(9999),
        state: z.literal('existing'),
      })
      .strict(),
    rasterSource: z
      .object({
        sha256: z.string().regex(/^[a-f0-9]{64}$/),
        page: z.number().int().min(1).max(9999),
        width: z.number().int().min(1).max(100_000),
        height: z.number().int().min(1).max(100_000),
      })
      .strict(),
    floors: z
      .array(
        z
          .object({
            candidateId: z.string().min(1).max(128),
            pieceIndex: z.number().int().min(0).max(99),
            polygon: ring,
            holes: z.array(ring).max(50),
            owner: z
              .object({
                sourceRoomKey: z.string().min(1).max(32),
                nameLabelId: z.string().min(1).max(128),
                numberLabelId: z.string().min(1).max(128),
                association: z.literal('schedule-linked-circle').optional(),
              })
              .strict(),
            boundaryRoles: z
              .array(
                z
                  .object({
                    edgeIndex: z.number().int().min(0).max(99),
                    kind: z.enum([
                      'wall-face',
                      'opening-boundary',
                      'level-separator',
                      'unresolved',
                    ]),
                  })
                  .strict(),
              )
              .min(3)
              .max(100),
          })
          .strict(),
      )
      .min(1)
      .max(50),
  })
  .strict()

/** Prepare an unsaved, source-exact draft; the user must still compare it with the PDF. */
export async function proposePlanPaintedFloorReview(
  projectId: string,
  expectedRevision: string,
): Promise<ActionResult<{ json: string; suggested: number; skipped: number; rooms: string[] }>> {
  const session = await getSession()
  if (!session) return { ok: false, error: 'Сессия закончилась. Войдите снова.' }
  try {
    const project = await assertOwner(session.user.id, projectId)
    if (expectedRevision !== planEditRevision(project.planUrl, project.planReading))
      throw new PlanEditConflictError()
    const reading = project.planReading
    if (!project.planUrl?.toLowerCase().endsWith('.pdf') || !reading?.sourcePage)
      return { ok: false, error: 'Сначала прочитайте выбранный лист PDF-плана.' }
    if (reading.planState !== 'existing')
      return { ok: false, error: 'Предложение доступно только для существующего плана.' }
    const object = await getObject(project.planUrl)
    const body = Buffer.from(object.body)
    const originalHash = createHash('sha256').update(body).digest('hex')
    const page = await preparePlanPage(body, true, reading.sourcePage, true, true)
    const native = page.nativeTextAnchors
    if (
      page.pageNumber !== reading.sourcePage ||
      !native ||
      !page.linework ||
      !page.lineworkRasterSource ||
      native.originalPdfSha256 !== originalHash ||
      native.source.page !== page.pageNumber ||
      native.source.sha256 !== createHash('sha256').update(page.image.body).digest('hex') ||
      native.source.width !== page.image.width ||
      native.source.height !== page.image.height
    )
      return { ok: false, error: 'Исходный PDF или его нативные контуры сейчас недоступны.' }
    const result = nativePaintedFloorProposal({
      native,
      work: page.linework,
      lineworkSource: page.lineworkRasterSource,
    })
    if (!result.proposal) return { ok: false, error: result.reason ?? 'Нет однозначных областей.' }
    const json = JSON.stringify(result.proposal, null, 2)
    if (Buffer.byteLength(json, 'utf8') > MAX_REVIEW_BYTES)
      return {
        ok: false,
        error: 'Предложение слишком велико для сохранения; требуется ручная проверка.',
      }
    const labelNames = new Map(native.labels.map((label) => [label.id, label.name]))
    const rooms = result.proposal.floors.map((floor) => {
      const name = labelNames.get(floor.owner.nameLabelId) ?? 'без названия'
      const sourceNote =
        floor.owner.association === 'schedule-linked-circle' ? ' (по экспликации)' : ''
      return `${floor.owner.sourceRoomKey} — ${name}${sourceNote}`
    })
    return { ok: true, data: { json, suggested: result.suggested, skipped: result.skipped, rooms } }
  } catch (error) {
    if (error instanceof PlanEditConflictError)
      return { ok: false, error: error.message, code: 'plan-conflict' }
    if (error instanceof AccessError || error instanceof PlanReadError)
      return { ok: false, error: error.message }
    console.error('painted floor proposal failed', error)
    return { ok: false, error: 'Не получилось подготовить области пола. Попробуйте ещё раз.' }
  }
}

/** Persist explicit source-role declarations only. This never confirms metric or physical geometry. */
export async function savePlanPaintedFloorReview(
  projectId: string,
  reviewJson: string,
  expectedRevision: string,
): Promise<ActionResult<{ reading: PlanReading; revision: string }>> {
  const session = await getSession()
  if (!session) return { ok: false, error: 'Сессия закончилась. Войдите снова.' }
  try {
    const project = await assertOwner(session.user.id, projectId)
    if (expectedRevision !== planEditRevision(project.planUrl, project.planReading))
      throw new PlanEditConflictError()
    if (!project.planUrl?.toLowerCase().endsWith('.pdf') || !project.planReading)
      return { ok: false, error: 'Сначала прочитайте выбранный лист PDF-плана.' }
    if (typeof reviewJson !== 'string' || Buffer.byteLength(reviewJson, 'utf8') > MAX_REVIEW_BYTES)
      return { ok: false, error: 'JSON разметки пола должен быть не больше 64 КиБ.' }
    let input: unknown
    try {
      input = JSON.parse(reviewJson)
    } catch {
      return { ok: false, error: 'Проверьте JSON разметки пола: его не удалось прочитать.' }
    }
    const parsed = reviewedSchema.safeParse(input)
    if (!parsed.success)
      return {
        ok: false,
        error:
          'Проверьте источник, контуры, владельцев и роли границ пола. Готовые доказательства и подтверждения в этот JSON не принимаются.',
      }
    const reviewed = parsed.data
    const before = project.planReading
    if (before.planState !== 'existing' || before.sourcePage !== reviewed.source.pdfPage)
      return {
        ok: false,
        error: 'Разметьте существующий план на том листе, с которого прочитан список комнат.',
      }
    const object = await getObject(project.planUrl)
    const body = Buffer.from(object.body)
    const originalHash = createHash('sha256').update(body).digest('hex')
    if (originalHash !== reviewed.source.sha256) throw new PlanEditConflictError()
    const page = await preparePlanPage(body, true, reviewed.source.pdfPage, true, true)
    const native = page.nativeTextAnchors
    if (
      page.pageNumber !== reviewed.source.pdfPage ||
      !native ||
      !page.linework ||
      !page.lineworkRasterSource ||
      native.originalPdfSha256 !== originalHash ||
      native.source.page !== page.pageNumber ||
      native.source.sha256 !== createHash('sha256').update(page.image.body).digest('hex') ||
      native.source.width !== page.image.width ||
      native.source.height !== page.image.height
    )
      return {
        ok: false,
        error:
          'Для сверки пола нужен актуальный исходный PDF с нативными линиями и подписями. Разметка не сохранена.',
      }
    const checked = nativePaintedFloorReview({
      native,
      work: page.linework,
      lineworkSource: page.lineworkRasterSource,
      reviewed,
    })
    if (checked.status !== 'reviewed-draft' || checked.refusalReason)
      return {
        ok: false,
        error:
          'Не удалось сверить выбранные участки пола с актуальным листом. Загрузите исходник заново и проверьте контуры, владельцев и роли границ. Разметка не сохранена.',
      }
    const reading: PlanReading = {
      ...before,
      paintedFloorReview: {
        version: 1,
        savedAt: new Date().toISOString(),
        draftJson: JSON.stringify(reviewed),
      },
    }
    // Any edited source floor selection invalidates its former height associations.
    delete reading.heightBindingReview
    // Compare both the stored file and complete reading atomically; concurrent edits must not be lost.
    await setPlanReading(session.user.id, projectId, reading, project)
    await recordAudit({
      action: 'project.plan_painted_floor_reviewed',
      actorId: session.user.id,
      targetType: 'project',
      targetId: projectId,
      headers: await headers(),
      metadata: {
        page: reviewed.source.pdfPage,
        planState: reviewed.source.state,
        floors: reviewed.floors.length,
      },
    })
    revalidatePath(`/projects/${projectId}`)
    return { ok: true, data: { reading, revision: planEditRevision(project.planUrl, reading) } }
  } catch (error) {
    if (error instanceof PlanEditConflictError)
      return { ok: false, error: error.message, code: 'plan-conflict' }
    if (error instanceof AccessError || error instanceof PlanReadError)
      return { ok: false, error: error.message }
    console.error('painted floor source review save failed', error)
    return { ok: false, error: 'Не получилось сохранить разметку пола. Попробуйте ещё раз.' }
  }
}
