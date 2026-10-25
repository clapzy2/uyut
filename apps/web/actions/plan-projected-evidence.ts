'use server'

import { createHash, randomUUID } from 'node:crypto'
import { isDeepStrictEqual } from 'node:util'
import {
  currentProjectedVerticalEvidence,
  isPrintedProjectZero,
  parsePrintedProjectValue,
  projectedVerticalEvidenceSchema,
} from '@uyut/catalog/plan-projected-vertical-evidence'
import { planVerticalRoomSnapshot } from '@uyut/catalog/plan-vertical-reference'
import type { PlanProjectedVerticalEvidence, PlanReading } from '@uyut/db'
import { revalidatePath } from 'next/cache'
import { headers } from 'next/headers'
import { z } from 'zod'
import { recordAudit } from '@/lib/audit'
import { AccessError, assertOwner } from '@/lib/projects/access'
import { PlanReadError, preparePlanPage } from '@/lib/projects/plan-document'
import { PlanEditConflictError, planEditRevision } from '@/lib/projects/plan-edit-revision'
import { setPlanReading } from '@/lib/projects/repository'
import { getSession } from '@/lib/session'
import { getObject } from '@/lib/storage'
import type { ActionResult } from './projects'

export type ProjectedCaptionSource = {
  sha256: string
  pdfPage: number
  pageCount: number
  preview: string
  captions: Array<{ index: number; text: string; x: number; y: number }>
}

async function context(projectId: string, revision: string) {
  const session = await getSession()
  if (!session) throw new AccessError('Сессия закончилась. Войдите снова.')
  const project = await assertOwner(session.user.id, projectId)
  if (revision !== planEditRevision(project.planUrl, project.planReading))
    throw new PlanEditConflictError()
  const reading = project.planReading
  const geometry = reading?.geometry
  const calibration = geometry?.pdfCalibration
  if (
    !project.planUrl?.toLowerCase().endsWith('.pdf') ||
    !reading ||
    !geometry ||
    !calibration ||
    reading.planState !== 'proposed' ||
    calibration.sourceState !== 'proposed' ||
    geometry.requiresSourceReviewReimport
  ) {
    throw new AccessError('Сначала сохраните актуальный проектный 2D-черновик из PDF.')
  }
  return { session, project, reading, geometry, calibration }
}

async function captionSource(ctx: Awaited<ReturnType<typeof context>>, pdfPage: number) {
  if (!Number.isSafeInteger(pdfPage) || pdfPage < 1 || pdfPage > 10000)
    throw new AccessError('Укажите страницу PDF.')
  const object = await getObject(ctx.project.planUrl as string)
  const body = Buffer.from(object.body)
  const sha256 = createHash('sha256').update(body).digest('hex')
  if (sha256 !== ctx.calibration.sourceSha256) throw new PlanEditConflictError()
  const page = await preparePlanPage(body, true, pdfPage, true, true)
  const native = page.nativeTextAnchors
  if (
    page.pageNumber !== pdfPage ||
    !native?.complete ||
    native.originalPdfSha256 !== sha256 ||
    native.source.page !== pdfPage
  ) {
    throw new AccessError(
      'На выбранной странице нет полного нативного текста. Подписи не подставлены.',
    )
  }
  return {
    page,
    sha256,
    captions: native.labels.flatMap((label) =>
      label.nativeIndex !== undefined && label.pagePoint && /\d/.test(label.name)
        ? [
            {
              index: label.nativeIndex,
              text: label.name,
              x: label.pagePoint.x,
              y: label.pagePoint.y,
            },
          ]
        : [],
    ),
  }
}

function failure(error: unknown): { ok: false; error: string; code?: 'plan-conflict' } {
  if (error instanceof PlanEditConflictError)
    return { ok: false, error: error.message, code: 'plan-conflict' }
  if (error instanceof AccessError || error instanceof PlanReadError)
    return { ok: false, error: error.message }
  console.error('Projected source evidence failed', error)
  return {
    ok: false,
    error:
      'Не получилось сохранить проектную подпись. Откройте актуальную схему и повторите сверку.',
  }
}

export async function getProjectedCaptionSource(
  projectId: string,
  pdfPage: number,
  revision: string,
): Promise<ActionResult<ProjectedCaptionSource>> {
  try {
    const ctx = await context(projectId, revision)
    const source = await captionSource(ctx, pdfPage)
    await context(projectId, revision)
    return {
      ok: true,
      data: {
        sha256: source.sha256,
        pdfPage,
        pageCount: source.page.pageCount,
        preview: `data:image/jpeg;base64,${source.page.image.body.toString('base64')}`,
        captions: source.captions,
      },
    }
  } catch (error) {
    return failure(error)
  }
}

const requestSchema = z
  .object({
    quantity: projectedVerticalEvidenceSchema.shape.quantity,
    printedValue: z.string().trim().min(1).max(100),
    unit: z.enum(['mm', 'cm', 'm']),
    target: z.discriminatedUnion('kind', [
      z.object({ kind: z.literal('room'), roomIndex: z.number().int().min(0) }).strict(),
      z.object({ kind: z.literal('opening'), openingId: z.string().min(1).max(100) }).strict(),
      z.object({ kind: z.literal('project') }).strict(),
    ]),
    sourceSha256: z.string().regex(/^[a-f0-9]{64}$/),
    sourcePage: z.number().int().positive().max(10000),
    captionIndex: z.number().int().min(0),
    scopeLabel: z.string().trim().max(300).optional(),
    reviewNote: z.string().trim().max(1000).optional(),
    acknowledged: z.literal(true),
  })
  .strict()

export async function saveProjectedVerticalEvidence(
  projectId: string,
  input: unknown,
  revision: string,
): Promise<ActionResult<{ revision: string }>> {
  try {
    const request = requestSchema.safeParse(input)
    if (!request.success)
      throw new AccessError(
        'Выберите объект, подпись, единицы и подтвердите сверку с проектным листом.',
      )
    const data = request.data
    const ctx = await context(projectId, revision)
    if ((ctx.geometry.projectedVerticalEvidence?.length ?? 0) >= 100)
      throw new AccessError('Сохранено слишком много проектных отметок.')
    const source = await captionSource(ctx, data.sourcePage)
    if (source.sha256 !== data.sourceSha256) throw new PlanEditConflictError()
    const caption = source.captions.find((value) => value.index === data.captionIndex)
    if (!caption) throw new AccessError('Подпись не найдена в исходном тексте выбранной страницы.')
    const valueCm = parsePrintedProjectValue(data.printedValue, data.unit)
    // Native PDF fonts can keep a thousands separator inside a single caption.
    // Only that numeric grouping is joined; separate labels and expressions are not.
    const captionNumbers = caption.text.replace(
      /(?<!\d)\d{1,3}(?:[ \u00a0]\d{3})+(?:[.,]\d+)?(?!\d)/g,
      (token) => token.replace(/[ \u00a0]/g, ''),
    )
    const tokens = captionNumbers.match(/[±+−-]?(?:\d+(?:[.,]\d+)?|[.,]\d+)/g) ?? []
    if (
      valueCm === undefined ||
      !tokens.some((token) => parsePrintedProjectValue(token, data.unit) === valueCm)
    )
      throw new AccessError(
        'Выбранная подпись не содержит указанного числа. Арифметика и неподписанные значения не принимаются.',
      )
    let target: PlanProjectedVerticalEvidence['target']
    if (data.target.kind === 'room') {
      const room = ctx.geometry.rooms[data.target.roomIndex]
      if (!room) throw new AccessError('Комната изменилась. Загрузите схему заново.')
      target = { kind: 'room', room: planVerticalRoomSnapshot(room) }
    } else if (data.target.kind === 'opening') {
      const openingId = data.target.openingId
      const opening = ctx.geometry.openings.find((item) => item.id === openingId)
      const wall = ctx.geometry.walls.find((item) => item.id === opening?.wallId)
      if (!opening || !wall) throw new AccessError('Проём изменился. Загрузите схему заново.')
      const { id, type, wallId, offsetCm, widthCm } = opening
      target = {
        kind: 'opening',
        opening: { id, type, wallId, offsetCm, widthCm },
        wall: {
          id: wall.id,
          kind: wall.kind,
          start: wall.start,
          end: wall.end,
          ...(wall.thicknessCm !== undefined ? { thicknessCm: wall.thicknessCm } : {}),
        },
      }
    } else target = { kind: 'project' }
    const entry: PlanProjectedVerticalEvidence = {
      id: randomUUID(),
      quantity: data.quantity,
      printedValue: data.printedValue,
      unit: data.unit,
      valueCm,
      ...(data.scopeLabel ? { scopeLabel: data.scopeLabel } : {}),
      target,
      geometrySource: {
        sha256: ctx.calibration.sourceSha256,
        pdfPage: ctx.calibration.pdfPage,
        state: 'proposed',
      },
      source: {
        sha256: source.sha256,
        pdfPage: data.sourcePage,
        captionIndexes: [data.captionIndex],
        captionTexts: [caption.text],
      },
      ...(data.reviewNote ? { reviewNote: data.reviewNote } : {}),
      reviewedAt: new Date().toISOString(),
      reviewedBy: ctx.session.user.id,
    }
    if (!projectedVerticalEvidenceSchema.safeParse(entry).success)
      throw new AccessError(
        'Тип подписи, объект или диапазон значения не подходят. Опуск не является абсолютной высотой потолка.',
      )
    const reading: PlanReading = {
      ...ctx.reading,
      geometry: {
        ...ctx.geometry,
        status: 'draft',
        projectedVerticalEvidence: [...(ctx.geometry.projectedVerticalEvidence ?? []), entry],
      },
    }
    if (reading.geometry) delete reading.geometry.confirmedAt
    await setPlanReading(ctx.session.user.id, projectId, reading, ctx.project)
    await recordAudit({
      action: 'project.plan_geometry_drafted',
      actorId: ctx.session.user.id,
      targetType: 'project',
      targetId: projectId,
      headers: await headers(),
      metadata: {
        projectedEvidenceId: entry.id,
        quantity: entry.quantity,
        sourcePage: data.sourcePage,
      },
    })
    revalidatePath(`/projects/${projectId}`)
    revalidatePath(`/projects/${projectId}/summary`)
    return { ok: true, data: { revision: planEditRevision(ctx.project.planUrl, reading) } }
  } catch (error) {
    return failure(error)
  }
}

export async function removeProjectedVerticalEvidence(
  projectId: string,
  evidenceId: string,
  revision: string,
): Promise<ActionResult<{ revision: string }>> {
  try {
    const ctx = await context(projectId, revision)
    const entries = ctx.geometry.projectedVerticalEvidence ?? []
    if (!entries.some((entry) => entry.id === evidenceId))
      throw new AccessError('Проектная отметка не найдена.')
    const reading: PlanReading = {
      ...ctx.reading,
      geometry: {
        ...ctx.geometry,
        projectedVerticalEvidence: entries.filter((entry) => entry.id !== evidenceId),
      },
    }
    await setPlanReading(ctx.session.user.id, projectId, reading, ctx.project)
    revalidatePath(`/projects/${projectId}`)
    revalidatePath(`/projects/${projectId}/summary`)
    return { ok: true, data: { revision: planEditRevision(ctx.project.planUrl, reading) } }
  } catch (error) {
    return failure(error)
  }
}

const floorReviewRequest = z.discriminatedUnion('mode', [
  z
    .object({
      mode: z.literal('apply'),
      evidenceId: z.string().min(1).max(100),
      zeroCaptionIndex: z.number().int().min(0),
      roomContourAcknowledged: z.literal(true),
      commonZeroAcknowledged: z.literal(true),
    })
    .strict(),
  z.object({ mode: z.literal('remove'), evidenceId: z.string().min(1).max(100) }).strict(),
])

/** A design-only surface scope, independent of as-built confirmation or physical 3D. */
export async function reviewProjectedFloorContour(
  projectId: string,
  input: unknown,
  revision: string,
): Promise<ActionResult<{ revision: string }>> {
  try {
    const parsed = floorReviewRequest.safeParse(input)
    if (!parsed.success)
      throw new AccessError('Сверьте весь контур и общий проектный ноль на листе.')
    const request = parsed.data
    const ctx = await context(projectId, revision)
    const records = ctx.geometry.projectedVerticalEvidence ?? []
    const entry = records.find((record) => record.id === request.evidenceId)
    if (entry?.quantity !== 'floor-level' || entry.target.kind !== 'room')
      throw new AccessError('Выберите сохранённую отметку пола комнаты.')
    let review: PlanProjectedVerticalEvidence['floorContourReview']
    if (request.mode === 'apply') {
      const current = currentProjectedVerticalEvidence(ctx.geometry)
      if (!current.some((record) => record.id === entry.id)) throw new PlanEditConflictError()
      if (
        current.some(
          (record) =>
            record.quantity === 'floor-level' &&
            isDeepStrictEqual(record.target, entry.target) &&
            record.valueCm !== entry.valueCm,
        )
      )
        throw new AccessError(
          'В этом контуре отмечено несколько уровней пола. Сначала выделите отдельные поверхности; один плоский пол не подставлен.',
        )
      const source = await captionSource(ctx, entry.source.pdfPage)
      if (
        entry.source.captionIndexes.some(
          (index, at) =>
            source.captions.find((caption) => caption.index === index)?.text !==
            entry.source.captionTexts[at],
        )
      )
        throw new PlanEditConflictError()
      const zero = source.captions.find((caption) => caption.index === request.zeroCaptionIndex)
      if (!zero || !isPrintedProjectZero(zero.text))
        throw new AccessError(
          'Выберите отдельную подписанную нулевую отметку, например ±0.000. Номер комнаты или обычный размер не подходят.',
        )
      if (
        current.some(
          (record) =>
            record.id !== entry.id &&
            record.floorContourReview &&
            (record.source.pdfPage !== entry.source.pdfPage ||
              record.source.sha256 !== entry.source.sha256 ||
              record.floorContourReview.zeroCaptionIndex !== zero.index ||
              record.floorContourReview.zeroCaptionText !== zero.text),
        )
      )
        throw new AccessError(
          'Другие полы сверены по другой нулевой подписи. Выберите ту же исходную отметку либо сначала отмените прежнюю привязку.',
        )
      review = {
        zeroCaptionIndex: zero.index,
        zeroCaptionText: zero.text,
        reviewedAt: new Date().toISOString(),
        reviewedBy: ctx.session.user.id,
      }
    }
    const updated = { ...entry }
    if (review) updated.floorContourReview = review
    else delete updated.floorContourReview
    if (!projectedVerticalEvidenceSchema.safeParse(updated).success)
      throw new PlanEditConflictError()
    const reading: PlanReading = {
      ...ctx.reading,
      geometry: {
        ...ctx.geometry,
        projectedVerticalEvidence: records.map((record) =>
          record.id === entry.id ? updated : record,
        ),
      },
    }
    await setPlanReading(ctx.session.user.id, projectId, reading, ctx.project)
    await recordAudit({
      action: 'project.plan_geometry_drafted',
      actorId: ctx.session.user.id,
      targetType: 'project',
      targetId: projectId,
      headers: await headers(),
      metadata: { projectedFloorReviewId: entry.id, mode: request.mode },
    })
    revalidatePath(`/projects/${projectId}`)
    revalidatePath(`/projects/${projectId}/summary`)
    return { ok: true, data: { revision: planEditRevision(ctx.project.planUrl, reading) } }
  } catch (error) {
    return failure(error)
  }
}
