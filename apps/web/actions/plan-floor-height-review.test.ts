import { createHash } from 'node:crypto'
import type { PlanReading } from '@uyut/db'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { PlanEditConflictError, planEditRevision } from '@/lib/projects/plan-edit-revision'
import { nativeReviewedFloorHeightBindings } from '@/lib/projects/plan-native-reviewed-floor-heights'
import { floorHeightFixture } from '@/lib/projects/plan-native-reviewed-floor-heights.fixture'

const mocks = vi.hoisted(() => ({
  session: vi.fn(),
  owner: vi.fn(),
  object: vi.fn(),
  prepare: vi.fn(),
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
vi.mock('@/lib/projects/repository', () => ({ setPlanReading: mocks.save }))
vi.mock('@/lib/audit', () => ({ recordAudit: mocks.audit }))
vi.mock('next/cache', () => ({ revalidatePath: mocks.revalidate }))
vi.mock('next/headers', () => ({ headers: async () => new Headers() }))

import { AccessError } from '@/lib/projects/access'
import {
  getPlanFloorHeightReviewOptions,
  savePlanFloorHeightReview,
} from './plan-floor-height-review'

function fixture() {
  const body = Buffer.from('synthetic PDF'),
    imageBody = Buffer.from('synthetic image'),
    input = floorHeightFixture()
  const hash = createHash('sha256').update(body).digest('hex')
  input.native.originalPdfSha256 = hash
  input.reviewedFloors.source.sha256 = hash
  input.native.source.sha256 = createHash('sha256').update(imageBody).digest('hex')
  for (const ink of [
    input.native.heightCaptionInk,
    input.native.heightUnitInk,
    input.native.heightFloorReferenceInk,
  ])
    if (ink?.source) ink.source.sha256 = hash
  const result = nativeReviewedFloorHeightBindings(input),
    option = result.options[0]
  if (!option) throw new Error(`Missing synthetic option: ${result.refusalReason}`)
  const review = {
    ...result.review,
    bindings: [{ floorId: option.floorId, labelId: option.labelId }],
  }
  const reading: PlanReading = {
    sourcePage: 3,
    planState: 'existing',
    readAt: 'old',
    rooms: [{ name: 'Спальня', kind: 'bedroom' }],
    paintedFloorReview: {
      version: 1,
      savedAt: input.floorReviewSavedAt,
      draftJson: JSON.stringify(input.reviewedFloors),
    },
    deliveryMeasurements: { version: 1, savedAt: 'old', draftJson: 'unchanged' },
  }
  const project = { planUrl: 'source.pdf', planReading: reading }
  const revision = planEditRevision(project.planUrl, reading)
  const page = {
    pageNumber: 3,
    image: { body: imageBody, width: 1000, height: 1000 },
    nativeTextAnchors: input.native,
    linework: input.work,
    lineworkRasterSource: input.lineworkSource,
  }
  return { body, input, review, reading, project, revision, page }
}
let f: ReturnType<typeof fixture>
beforeEach(() => {
  vi.clearAllMocks()
  f = fixture()
  mocks.session.mockResolvedValue({ user: { id: 'owner' } })
  mocks.owner.mockResolvedValue(f.project)
  mocks.object.mockResolvedValue({ body: f.body })
  mocks.prepare.mockResolvedValue(f.page)
  mocks.save.mockResolvedValue(undefined)
})
describe('floor height review actions', () => {
  it('loads fresh eligible source options without writing', async () => {
    const result = await getPlanFloorHeightReviewOptions('project', f.revision)
    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.data.options).toHaveLength(1)
    expect(result.data.review.bindings).toEqual([])
    expect(result.data.savedBindingStatus).toBe('not-saved')
    expect(mocks.save).not.toHaveBeenCalled()
    expect(mocks.prepare).toHaveBeenCalledWith(f.body, true, 3, true, true)
  })
  it('saves only source IDs while preserving unrelated reading and CAS', async () => {
    const result = await savePlanFloorHeightReview('project', JSON.stringify(f.review), f.revision)
    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.data.reading).toMatchObject(f.reading)
    expect(JSON.parse(result.data.reading.heightBindingReview?.draftJson ?? 'null')).toEqual(
      f.review,
    )
    expect(mocks.save).toHaveBeenCalledWith('owner', 'project', result.data.reading, f.project)
    expect(mocks.audit).toHaveBeenCalledWith(
      expect.objectContaining({ action: 'project.plan_floor_height_reviewed' }),
    )
  })
  it.each([
    'session',
    'owner',
    'revision',
    'original',
    'page',
    'raster',
    'unit',
    'reference',
    'floor-version',
  ])('rejects %s failures without writes', async (failure) => {
    if (failure === 'session') mocks.session.mockResolvedValue(null)
    if (failure === 'owner') mocks.owner.mockRejectedValue(new AccessError('Forbidden'))
    if (failure === 'revision') f.revision = 'stale'
    if (failure === 'original') mocks.object.mockResolvedValue({ body: Buffer.from('changed PDF') })
    if (failure === 'page') f.page.pageNumber = 4
    if (failure === 'raster') f.page.image.width = 900
    if (failure === 'unit') delete f.input.native.heightUnitInk
    if (failure === 'reference') delete f.input.native.heightFloorReferenceInk
    if (failure === 'floor-version') {
      Object.assign(f.reading.paintedFloorReview ?? {}, { version: 2 })
      f.revision = planEditRevision(f.project.planUrl, f.reading)
    }
    expect(
      (await savePlanFloorHeightReview('project', JSON.stringify(f.review), f.revision)).ok,
    ).toBe(false)
    expect(mocks.save).not.toHaveBeenCalled()
  })
  it.each([
    'invalid-json',
    'oversize',
    'stale-floor',
    'cross-owner',
    'forged-proof',
    'forged-value',
  ])('rejects %s review', async (failure) => {
    let json = JSON.stringify(f.review)
    if (failure === 'invalid-json') json = '{'
    if (failure === 'oversize') json = 'x'.repeat(16 * 1024 + 1)
    if (failure === 'stale-floor')
      json = JSON.stringify({ ...f.review, floorReviewSavedAt: '2026-10-10T00:00:00.000Z' })
    if (failure === 'cross-owner')
      json = JSON.stringify({
        ...f.review,
        bindings: [{ floorId: 'other', labelId: 'native-text-2' }],
      })
    if (failure === 'forged-proof') json = JSON.stringify({ ...f.review, readyFor3D: true })
    if (failure === 'forged-value')
      json = JSON.stringify({ ...f.review, bindings: [{ ...f.review.bindings[0], valueMm: 2800 }] })
    expect((await savePlanFloorHeightReview('project', json, f.revision)).ok).toBe(false)
    expect(mocks.save).not.toHaveBeenCalled()
  })
  it('reports refused stored selections instead of treating them as accepted', async () => {
    Object.assign(f.reading, {
      heightBindingReview: { version: 2, savedAt: 'old', draftJson: JSON.stringify(f.review) },
    })
    f.revision = planEditRevision(f.project.planUrl, f.reading)
    const result = await getPlanFloorHeightReviewOptions('project', f.revision)
    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.data.savedBindingStatus).toBe('refused')
    expect(result.data.review.bindings).toEqual([])
    expect(mocks.save).not.toHaveBeenCalled()
  })
  it('rechecks stored selections and permits explicitly clearing them', async () => {
    f.reading.heightBindingReview = {
      version: 1,
      savedAt: 'old',
      draftJson: JSON.stringify(f.review),
    }
    f.revision = planEditRevision(f.project.planUrl, f.reading)
    const result = await getPlanFloorHeightReviewOptions('project', f.revision)
    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.data.savedBindingStatus).toBe('checked')
    expect(result.data.review.bindings).toEqual(f.review.bindings)
    expect(
      (
        await savePlanFloorHeightReview(
          'project',
          JSON.stringify({ ...f.review, bindings: [] }),
          f.revision,
        )
      ).ok,
    ).toBe(true)
  })
  it('returns race conflicts without recording successful audit', async () => {
    mocks.save.mockRejectedValue(new PlanEditConflictError())
    expect(
      await savePlanFloorHeightReview('project', JSON.stringify(f.review), f.revision),
    ).toMatchObject({ ok: false, code: 'plan-conflict' })
    expect(mocks.audit).not.toHaveBeenCalled()
  })
})
