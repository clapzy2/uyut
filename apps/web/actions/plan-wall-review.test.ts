import { createHash } from 'node:crypto'
import type { PlanReading, PlanWallFacePair } from '@uyut/db'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { PlanEditConflictError, planEditRevision } from '@/lib/projects/plan-edit-revision'
import {
  type HumanWallReviewCandidate,
  wallPairReviewKey,
} from '@/lib/projects/plan-human-wall-review'

const mocks = vi.hoisted(() => ({
  session: vi.fn(),
  owner: vi.fn(),
  object: vi.fn(),
  prepare: vi.fn(),
  candidates: vi.fn(),
  save: vi.fn(),
  audit: vi.fn(),
  revalidate: vi.fn(),
}))
vi.mock('@/lib/session', () => ({ getSession: mocks.session }))
vi.mock('@/lib/projects/access', () => ({
  AccessError: class AccessError extends Error {},
  assertOwner: mocks.owner,
}))
vi.mock('@/lib/storage', () => ({ getObject: mocks.object }))
vi.mock('@/lib/projects/plan-document', () => ({
  PlanReadError: class PlanReadError extends Error {},
  preparePlanPage: mocks.prepare,
}))
vi.mock('@/lib/projects/plan-human-wall-review', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/lib/projects/plan-human-wall-review')>()),
  humanWallReviewCandidates: mocks.candidates,
}))
vi.mock('@/lib/projects/repository', () => ({ setPlanReading: mocks.save }))
vi.mock('next/cache', () => ({ revalidatePath: mocks.revalidate }))
vi.mock('next/headers', () => ({ headers: async () => new Headers() }))
vi.mock('@/lib/audit', () => ({ recordAudit: mocks.audit }))

import { AccessError } from '@/lib/projects/access'
import {
  getPlanWallReviewCandidates,
  revokePlanWallReview,
  savePlanWallReview,
} from './plan-wall-review'

const candidateId = 'b'.repeat(64)
const sourceSha = createHash('sha256').update('pdf').digest('hex')
const now = '2026-10-24T12:34:56.000Z'

function fixture() {
  const first = {
    id: 'outer',
    kind: 'outer' as const,
    start: { xCm: 0, yCm: 0 },
    end: { xCm: 0, yCm: 100 },
  }
  const second = {
    id: 'inner',
    kind: 'inner' as const,
    start: { xCm: 20, yCm: 0 },
    end: { xCm: 20, yCm: 100 },
  }
  const pair: PlanWallFacePair = {
    faces: [
      {
        wall: first,
        start: first.start,
        end: first.end,
        nativeSegment: { operationIndex: 1, subpathIndex: 0, segmentIndex: 0 },
      },
      {
        wall: second,
        start: second.start,
        end: second.end,
        nativeSegment: { operationIndex: 2, subpathIndex: 0, segmentIndex: 0 },
      },
    ],
    openings: [],
  }
  const source = { sha256: sourceSha, pdfPage: 4, state: 'existing' as const }
  const reading: PlanReading = {
    readAt: '2026-10-24',
    sourcePage: 4,
    planState: 'existing',
    rooms: [{ name: 'Гостиная', sourceNumber: 1, kind: 'living' }],
    pageReview: {
      version: 1,
      savedAt: '2026-10-24',
      contours: {
        source,
        coordinateSystem: 'page-0-1000',
        review: 'manual-source-review',
        pageWidth: 1000,
        pageHeight: 1000,
        rooms: [],
      },
    },
    geometry: {
      version: 1,
      source: 'manual',
      status: 'draft',
      widthCm: 100,
      heightCm: 100,
      warnings: [],
      rooms: [],
      walls: [first, second],
      openings: [],
      pdfCalibration: {
        sourceSha256: sourceSha,
        pdfPage: 4,
        cmPerPoint: 1,
        origin: { x: 0, y: 0 },
        anchorRoomNumbers: [],
        labelIndexes: [],
        derivedOpeningIds: [],
        sourceWallFacePairs: [],
        wallFacePairs: [],
        wallFaceRoomPolygons: [],
      },
    },
    deliveryMeasurements: {
      version: 1,
      savedAt: '2026-10-24',
      draftJson: '{"door":900}',
      reportJson: '{"ready":true}',
    },
  }
  const candidate: HumanWallReviewCandidate = {
    id: candidateId,
    pair: {
      faces: [
        {
          contourKey: 'exterior',
          wallEdgeIndex: 0,
          start: { x: 0, y: 0 },
          end: { x: 0, y: 100 },
          nativeSegment: pair.faces[0].nativeSegment,
        },
        {
          contourKey: '1',
          wallEdgeIndex: 0,
          start: { x: 20, y: 0 },
          end: { x: 20, y: 100 },
          nativeSegment: pair.faces[1].nativeSegment,
        },
      ],
    },
    visibilityIssues: ['later-paint-near-face'],
    metricPair: pair,
  }
  const project = { planUrl: 'plan.pdf', planReading: reading }
  return { project, reading, candidate, revision: planEditRevision(project.planUrl, reading) }
}

beforeEach(() => {
  vi.resetAllMocks()
  mocks.session.mockResolvedValue({ user: { id: 'owner' } })
  mocks.object.mockResolvedValue({ body: Buffer.from('pdf') })
  mocks.prepare.mockResolvedValue({ linework: { paths: [] } })
  mocks.save.mockResolvedValue(undefined)
  vi.useFakeTimers()
  vi.setSystemTime(new Date(now))
})
afterEach(() => vi.useRealTimers())

describe('explicit owner review of PDF wall pairs', () => {
  function setup() {
    const input = fixture()
    mocks.owner.mockResolvedValue(input.project)
    mocks.candidates.mockReturnValue([input.candidate])
    return input
  }

  it('requires a signed-in owner before revealing or saving candidates', async () => {
    const input = setup()
    mocks.session.mockResolvedValue(null)
    expect(await getPlanWallReviewCandidates('project', input.revision)).toMatchObject({
      ok: false,
    })
    expect(
      await savePlanWallReview('project', { candidateId, acknowledged: true }, input.revision),
    ).toMatchObject({ ok: false })
    expect(mocks.owner).not.toHaveBeenCalled()
    expect(mocks.object).not.toHaveBeenCalled()
    expect(mocks.save).not.toHaveBeenCalled()

    mocks.session.mockResolvedValue({ user: { id: 'partner' } })
    mocks.owner.mockRejectedValue(new AccessError('Это может сделать только владелец проекта.'))
    expect(await getPlanWallReviewCandidates('project', input.revision)).toEqual({
      ok: false,
      error: 'Это может сделать только владелец проекта.',
    })
    expect(
      await savePlanWallReview('project', { candidateId, acknowledged: true }, input.revision),
    ).toMatchObject({ ok: false })
    expect(mocks.owner).toHaveBeenCalledWith('partner', 'project')
    expect(mocks.object).not.toHaveBeenCalled()
    expect(mocks.save).not.toHaveBeenCalled()
  })

  it('rejects a stale revision before reading the source', async () => {
    setup()
    expect(await getPlanWallReviewCandidates('project', 'stale')).toMatchObject({
      ok: false,
      code: 'plan-conflict',
    })
    expect(
      await savePlanWallReview('project', { candidateId, acknowledged: true }, 'stale'),
    ).toMatchObject({ ok: false, code: 'plan-conflict' })
    expect(mocks.object).not.toHaveBeenCalled()
    expect(mocks.save).not.toHaveBeenCalled()
  })

  it('rejects a replaced PDF before extracting or accepting its old pair', async () => {
    const input = setup()
    mocks.object.mockResolvedValue({ body: Buffer.from('another-pdf') })
    expect(
      await savePlanWallReview('project', { candidateId, acknowledged: true }, input.revision),
    ).toMatchObject({ ok: false, code: 'plan-conflict' })
    expect(mocks.prepare).not.toHaveBeenCalled()
    expect(mocks.candidates).not.toHaveBeenCalled()
    expect(mocks.save).not.toHaveBeenCalled()
  })

  it.each([
    { candidateId },
    { candidateId, acknowledged: false },
    {
      candidateId,
      acknowledged: true,
      verification: { kind: 'human-source-review', reviewedAt: now },
    },
  ])('requires explicit acknowledgment and rejects client proof metadata: %j', async (request) => {
    const input = setup()
    expect(await savePlanWallReview('project', request, input.revision)).toMatchObject({
      ok: false,
    })
    expect(mocks.session).not.toHaveBeenCalled()
    expect(mocks.save).not.toHaveBeenCalled()
  })

  it('accepts only an ID freshly derived from the current source and geometry', async () => {
    const input = setup()
    expect(
      await savePlanWallReview(
        'project',
        { candidateId: 'c'.repeat(64), acknowledged: true },
        input.revision,
      ),
    ).toMatchObject({ ok: false })
    expect(mocks.prepare).toHaveBeenCalledWith(Buffer.from('pdf'), true, 4, true, true)
    expect(mocks.candidates).toHaveBeenCalledWith(input.reading, { paths: [] })
    expect(mocks.save).not.toHaveBeenCalled()
  })

  it('returns source review options without exposing a writable metric pair', async () => {
    const input = setup()
    const result = await getPlanWallReviewCandidates('project', input.revision)
    expect(result).toMatchObject({
      ok: true,
      data: {
        candidates: [
          {
            id: candidateId,
            pair: input.candidate.pair,
            visibilityIssues: input.candidate.visibilityIssues,
          },
        ],
      },
    })
    if (!result.ok) throw new Error(result.error)
    expect(result.data.candidates[0]).not.toHaveProperty('metricPair')
    expect(mocks.save).not.toHaveBeenCalled()
  })

  it('generates provenance on the server and saves the pair atomically without adding measurements', async () => {
    const input = setup()
    const before = structuredClone(input.reading)
    const result = await savePlanWallReview(
      'project',
      { candidateId, acknowledged: true },
      input.revision,
    )
    if (!result.ok) throw new Error(result.error)
    const pairs = result.data.reading.geometry?.pdfCalibration?.sourceWallFacePairs
    expect(pairs).toEqual([
      {
        ...input.candidate.metricPair,
        verification: { kind: 'human-source-review', reviewedAt: now },
      },
    ])
    expect(result.data.reading.geometry?.pdfCalibration?.wallFacePairs).toEqual(pairs)
    expect(result.data.reading.geometry?.status).toBe('draft')
    expect(result.data.reading.geometry?.walls).toEqual(before.geometry?.walls)
    expect(result.data.reading.geometry?.openings).toEqual(before.geometry?.openings)
    expect(result.data.reading.geometry?.verticalReference).toBeUndefined()
    expect(result.data.reading.rooms).toEqual(before.rooms)
    expect(result.data.reading.deliveryMeasurements).toEqual({
      version: 1,
      savedAt: '2026-10-24',
      draftJson: '{"door":900}',
    })
    expect(input.reading).toEqual(before)
    expect(mocks.save).toHaveBeenCalledExactlyOnceWith(
      'owner',
      'project',
      result.data.reading,
      input.project,
    )
    expect(result.data.revision).toBe(planEditRevision('plan.pdf', result.data.reading))
    expect(mocks.audit).toHaveBeenCalledWith(
      expect.objectContaining({
        action: 'project.plan_wall_pair_reviewed',
        actorId: 'owner',
        targetId: 'project',
        metadata: { candidateId, page: 4, verification: 'human-source-review' },
      }),
    )
    expect(mocks.revalidate).toHaveBeenCalledWith('/projects/project')
  })

  it('reports a concurrent atomic write conflict without auditing a successful review', async () => {
    const input = setup()
    mocks.save.mockRejectedValue(new PlanEditConflictError())
    expect(
      await savePlanWallReview('project', { candidateId, acknowledged: true }, input.revision),
    ).toMatchObject({ ok: false, code: 'plan-conflict' })
    expect(mocks.save).toHaveBeenCalledWith('owner', 'project', expect.any(Object), input.project)
    expect(mocks.audit).not.toHaveBeenCalled()
    expect(mocks.revalidate).not.toHaveBeenCalled()
  })

  it('replaces a stale human review of the same faces on explicit resverka', async () => {
    const input = setup()
    const calibration = input.reading.geometry?.pdfCalibration
    if (!calibration) throw new Error('Expected source calibration')
    const stale: PlanWallFacePair = {
      ...input.candidate.metricPair,
      openings: [{ id: 'old-cut', type: 'door', wallId: 'outer', offsetCm: 10, widthCm: 20 }],
      verification: { kind: 'human-source-review', reviewedAt: '2026-10-23T00:00:00.000Z' },
    }
    const automatic: PlanWallFacePair = {
      ...input.candidate.metricPair,
      faces: [
        {
          ...input.candidate.metricPair.faces[0],
          nativeSegment: { operationIndex: 99, subpathIndex: 0, segmentIndex: 0 },
        },
        input.candidate.metricPair.faces[1],
      ],
    }
    calibration.sourceWallFacePairs = [stale, automatic]
    calibration.wallFacePairs = [stale, automatic]
    const revision = planEditRevision(input.project.planUrl, input.reading)

    const result = await savePlanWallReview(
      'project',
      { candidateId, acknowledged: true },
      revision,
    )
    if (!result.ok) throw new Error(result.error)
    expect(result.data.reading.geometry?.pdfCalibration?.sourceWallFacePairs).toEqual([
      automatic,
      {
        ...input.candidate.metricPair,
        verification: { kind: 'human-source-review', reviewedAt: now },
      },
    ])
    expect(stale.verification?.reviewedAt).toBe('2026-10-23T00:00:00.000Z')
  })

  function reviewedSetup() {
    const input = setup()
    const geometry = input.reading.geometry
    const calibration = geometry?.pdfCalibration
    if (!geometry || !calibration) throw new Error('Expected source geometry')
    const manual: PlanWallFacePair = {
      ...input.candidate.metricPair,
      verification: { kind: 'human-source-review', reviewedAt: '2026-10-23T00:00:00.000Z' },
    }
    const automatic: PlanWallFacePair = {
      ...input.candidate.metricPair,
      faces: [
        {
          ...input.candidate.metricPair.faces[0],
          nativeSegment: { operationIndex: 99, subpathIndex: 0, segmentIndex: 0 },
        },
        input.candidate.metricPair.faces[1],
      ],
    }
    calibration.sourceWallFacePairs = [manual, automatic]
    calibration.wallFacePairs = [manual, automatic]
    const reviewId = createHash('sha256').update(wallPairReviewKey(manual)).digest('hex')
    return {
      ...input,
      geometry,
      manual,
      automatic,
      reviewId,
      revision: planEditRevision(input.project.planUrl, input.reading),
    }
  }

  it('lists the human review status without treating automatic pairs as revocable reviews', async () => {
    const input = reviewedSetup()
    const result = await getPlanWallReviewCandidates('project', input.revision)
    expect(result).toMatchObject({
      ok: true,
      data: {
        reviews: [
          { id: input.reviewId, reviewedAt: input.manual.verification?.reviewedAt, current: true },
        ],
      },
    })
    if (!result.ok) throw new Error(result.error)
    expect(result.data.reviews).toHaveLength(1)
    input.geometry.openings.push({
      id: 'changed-cut',
      wallId: 'outer',
      type: 'door',
      offsetCm: 0,
      widthCm: 20,
    })
    const changed = await getPlanWallReviewCandidates(
      'project',
      planEditRevision(input.project.planUrl, input.reading),
    )
    expect(changed).toMatchObject({
      ok: true,
      data: { reviews: [{ id: input.reviewId, current: false }] },
    })
  })

  it('requires owner access and the current revision to revoke a human review', async () => {
    const input = reviewedSetup()
    mocks.session.mockResolvedValue({ user: { id: 'partner' } })
    mocks.owner.mockRejectedValue(new AccessError('Это может сделать только владелец проекта.'))
    expect(
      await revokePlanWallReview('project', { reviewId: input.reviewId }, input.revision),
    ).toMatchObject({ ok: false })
    expect(mocks.owner).toHaveBeenCalledWith('partner', 'project')
    expect(mocks.save).not.toHaveBeenCalled()

    mocks.session.mockResolvedValue({ user: { id: 'owner' } })
    mocks.owner.mockResolvedValue(input.project)
    expect(
      await revokePlanWallReview('project', { reviewId: input.reviewId }, 'stale'),
    ).toMatchObject({ ok: false, code: 'plan-conflict' })
    expect(mocks.save).not.toHaveBeenCalled()
  })

  it('rejects an unknown review ID and an automatic pair ID without changing geometry', async () => {
    const input = reviewedSetup()
    const automaticId = createHash('sha256')
      .update(wallPairReviewKey(input.automatic))
      .digest('hex')
    for (const reviewId of ['c'.repeat(64), automaticId]) {
      expect(await revokePlanWallReview('project', { reviewId }, input.revision)).toMatchObject({
        ok: false,
      })
    }
    expect(mocks.save).not.toHaveBeenCalled()
    expect(mocks.audit).not.toHaveBeenCalled()
  })

  it('revokes only the human review, returns a draft and preserves the supplied measurements', async () => {
    const input = reviewedSetup()
    input.geometry.status = 'confirmed'
    input.geometry.confirmedAt = '2026-10-23T00:00:00.000Z'
    const before = structuredClone(input.reading)
    const result = await revokePlanWallReview(
      'project',
      { reviewId: input.reviewId },
      planEditRevision(input.project.planUrl, input.reading),
    )
    if (!result.ok) throw new Error(result.error)
    expect(result.data.reading.geometry?.status).toBe('draft')
    expect(result.data.reading.geometry?.confirmedAt).toBeUndefined()
    expect(result.data.reading.geometry?.pdfCalibration?.sourceWallFacePairs).toEqual([
      input.automatic,
    ])
    expect(result.data.reading.geometry?.pdfCalibration?.wallFacePairs).toEqual([input.automatic])
    expect(result.data.reading.geometry?.walls).toEqual(before.geometry?.walls)
    expect(result.data.reading.geometry?.openings).toEqual(before.geometry?.openings)
    expect(result.data.reading.geometry?.verticalReference).toBeUndefined()
    expect(result.data.reading.rooms).toEqual(before.rooms)
    expect(result.data.reading.deliveryMeasurements).not.toHaveProperty('reportJson')
    expect(input.reading).toEqual(before)
    expect(mocks.save).toHaveBeenCalledExactlyOnceWith(
      'owner',
      'project',
      result.data.reading,
      input.project,
    )
    expect(result.data.revision).toBe(planEditRevision('plan.pdf', result.data.reading))
  })
})
