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
import {
  type HumanWallReviewOption,
  humanWallReviewCandidates,
  wallPairReviewKey,
} from '@/lib/projects/plan-human-wall-review'
import { currentWallFacePairs } from '@/lib/projects/plan-opening-face-pairs'
import { setPlanReading } from '@/lib/projects/repository'
import { getSession } from '@/lib/session'
import { getObject } from '@/lib/storage'

async function reviewContext(projectId: string, expectedRevision: string) {
  const session = await getSession()
  if (!session) throw new AccessError('Сессия закончилась. Войдите снова.')
  const project = await assertOwner(session.user.id, projectId)
  if (expectedRevision !== planEditRevision(project.planUrl, project.planReading))
    throw new PlanEditConflictError()
  const reading = project.planReading
  const source = reading?.pageReview?.contours.source
  if (
    !project.planUrl?.toLowerCase().endsWith('.pdf') ||
    !reading ||
    !source ||
    !reading.geometry?.pdfCalibration
  )
    throw new AccessError('Сначала сохраните разметку PDF и создайте 2D-черновик.')
  const object = await getObject(project.planUrl)
  const body = Buffer.from(object.body)
  if (createHash('sha256').update(body).digest('hex') !== source.sha256)
    throw new PlanEditConflictError()
  const page = await preparePlanPage(body, true, source.pdfPage, true, true)
  if (!page.linework) throw new AccessError('Не удалось извлечь исходные грани этого листа.')
  return {
    project,
    reading,
    session,
    candidates: humanWallReviewCandidates(reading, page.linework),
  }
}

function reviewFailure(error: unknown): { ok: false; error: string; code?: 'plan-conflict' } {
  if (error instanceof PlanEditConflictError)
    return { ok: false, error: error.message, code: 'plan-conflict' }
  if (error instanceof AccessError || error instanceof PlanReadError)
    return { ok: false, error: error.message }
  console.error('PDF wall review failed', error)
  return {
    ok: false,
    error: 'Не получилось проверить пару граней. Откройте актуальный лист и повторите сверку.',
  }
}

export async function getPlanWallReviewCandidates(
  projectId: string,
  expectedRevision: string,
): Promise<
  ActionResult<{
    candidates: HumanWallReviewOption[]
    reviews?: { id: string; reviewedAt: string; current: boolean }[]
  }>
> {
  try {
    const context = await reviewContext(projectId, expectedRevision)
    const geometry = context.reading.geometry
    const current = geometry ? currentWallFacePairs(geometry) : []
    const reviews = (
      geometry?.pdfCalibration?.sourceWallFacePairs ??
      geometry?.pdfCalibration?.wallFacePairs ??
      []
    ).flatMap((pair) =>
      pair.verification?.kind === 'human-source-review'
        ? [
            {
              id: createHash('sha256').update(wallPairReviewKey(pair)).digest('hex'),
              reviewedAt: pair.verification.reviewedAt,
              current: current.includes(pair),
            },
          ]
        : [],
    )
    return {
      ok: true,
      data: {
        candidates: context.candidates.map(({ metricPair: _metric, ...option }) => option),
        reviews,
      },
    }
  } catch (error) {
    return reviewFailure(error)
  }
}

const reviewRequest = z
  .object({ candidateId: z.string().regex(/^[a-f0-9]{64}$/), acknowledged: z.literal(true) })
  .strict()

export async function revokePlanWallReview(
  projectId: string,
  input: unknown,
  expectedRevision: string,
): Promise<ActionResult<{ reading: PlanReading; revision: string }>> {
  const parsed = z
    .object({ reviewId: z.string().regex(/^[a-f0-9]{64}$/) })
    .strict()
    .safeParse(input)
  if (!parsed.success) return { ok: false, error: 'Выберите сохранённую ручную сверку.' }
  try {
    const session = await getSession()
    if (!session) throw new AccessError('Сессия закончилась. Войдите снова.')
    const project = await assertOwner(session.user.id, projectId)
    if (expectedRevision !== planEditRevision(project.planUrl, project.planReading))
      throw new PlanEditConflictError()
    const before = project.planReading
    const geometry = before?.geometry
    const calibration = geometry?.pdfCalibration
    if (!before || !geometry || !calibration) throw new AccessError('Ручная сверка не найдена.')
    const previous = calibration.sourceWallFacePairs ?? calibration.wallFacePairs ?? []
    const pairs = previous.filter(
      (pair) =>
        pair.verification?.kind !== 'human-source-review' ||
        createHash('sha256').update(wallPairReviewKey(pair)).digest('hex') !== parsed.data.reviewId,
    )
    if (pairs.length === previous.length)
      throw new AccessError(
        'Ручная сверка не найдена. Автоматические пары этим действием не снимаются.',
      )
    const reading: PlanReading = {
      ...before,
      geometry: {
        ...geometry,
        status: 'draft',
        pdfCalibration: { ...calibration, sourceWallFacePairs: pairs, wallFacePairs: pairs },
      },
    }
    if (reading.geometry) delete reading.geometry.confirmedAt
    if (reading.deliveryMeasurements) {
      const { reportJson: _report, ...measurements } = reading.deliveryMeasurements
      reading.deliveryMeasurements = measurements
    }
    await setPlanReading(session.user.id, projectId, reading, project)
    await recordAudit({
      action: 'project.plan_wall_pair_reviewed',
      actorId: session.user.id,
      targetType: 'project',
      targetId: projectId,
      headers: await headers(),
      metadata: { reviewId: parsed.data.reviewId, revoked: true },
    })
    revalidatePath(`/projects/${projectId}`)
    return { ok: true, data: { reading, revision: planEditRevision(project.planUrl, reading) } }
  } catch (error) {
    return reviewFailure(error)
  }
}

export async function savePlanWallReview(
  projectId: string,
  input: unknown,
  expectedRevision: string,
): Promise<ActionResult<{ reading: PlanReading; revision: string }>> {
  const parsed = reviewRequest.safeParse(input)
  if (!parsed.success)
    return {
      ok: false,
      error: 'Выберите пару и подтвердите сверку обеих граней по исходному листу.',
    }
  try {
    const context = await reviewContext(projectId, expectedRevision)
    const candidate = context.candidates.find(
      (candidate) => candidate.id === parsed.data.candidateId,
    )
    if (!candidate)
      throw new AccessError(
        'Эта пара уже изменена или не соответствует текущей обводке. Загрузите варианты заново.',
      )
    const geometry = context.reading.geometry
    if (!geometry?.pdfCalibration || geometry.status !== 'draft') throw new PlanEditConflictError()
    const pair = {
      ...candidate.metricPair,
      verification: { kind: 'human-source-review' as const, reviewedAt: new Date().toISOString() },
    }
    const previousPairs =
      geometry.pdfCalibration.sourceWallFacePairs ?? geometry.pdfCalibration.wallFacePairs ?? []
    const pairs = [
      ...previousPairs.filter(
        (previous) =>
          previous.verification?.kind !== 'human-source-review' ||
          wallPairReviewKey(previous) !== wallPairReviewKey(pair),
      ),
      pair,
    ]
    const reading: PlanReading = {
      ...context.reading,
      geometry: {
        ...geometry,
        status: 'draft',
        pdfCalibration: {
          ...geometry.pdfCalibration,
          sourceWallFacePairs: pairs,
          wallFacePairs: pairs,
        },
      },
    }
    if (reading.deliveryMeasurements) {
      const { reportJson: _report, ...measurements } = reading.deliveryMeasurements
      reading.deliveryMeasurements = measurements
    }
    await setPlanReading(context.session.user.id, projectId, reading, context.project)
    await recordAudit({
      action: 'project.plan_wall_pair_reviewed',
      actorId: context.session.user.id,
      targetType: 'project',
      targetId: projectId,
      headers: await headers(),
      metadata: {
        candidateId: candidate.id,
        page: reading.geometry?.pdfCalibration?.pdfPage,
        verification: 'human-source-review',
      },
    })
    revalidatePath(`/projects/${projectId}`)
    return {
      ok: true,
      data: { reading, revision: planEditRevision(context.project.planUrl, reading) },
    }
  } catch (error) {
    return reviewFailure(error)
  }
}
