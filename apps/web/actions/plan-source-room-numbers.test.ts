import { createHash } from 'node:crypto'
import type { PlanReading } from '@uyut/db'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { PlanEditConflictError, planEditRevision } from '@/lib/projects/plan-edit-revision'
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
  getPlanSourceRoomNumberOptions,
  savePlanSourceRoomNumbers,
} from './plan-source-room-numbers'

function fixture() {
  const body = Buffer.from('synthetic PDF'),
    imageBody = Buffer.from('synthetic image')
  const source = floorHeightFixture()
  const hash = createHash('sha256').update(body).digest('hex')
  source.native.originalPdfSha256 = hash
  source.reviewedFloors.source.sha256 = hash
  source.native.source.sha256 = createHash('sha256').update(imageBody).digest('hex')
  const reading: PlanReading = {
    sourcePage: 3,
    planState: 'existing',
    readAt: 'old',
    rooms: [{ name: 'Спальня', kind: 'bedroom', areaM2: 12 }],
    geometry: {
      version: 1,
      status: 'confirmed',
      confirmedAt: 'old',
      widthCm: 500,
      heightCm: 400,
      walls: [],
      openings: [],
      rooms: [],
      warnings: [],
      footprint: [
        { xCm: 0, yCm: 0 },
        { xCm: 500, yCm: 0 },
        { xCm: 500, yCm: 400 },
        { xCm: 0, yCm: 400 },
      ],
    },
    ceilingCm: 270,
    paintedFloorReview: {
      version: 1,
      savedAt: 'old',
      draftJson: JSON.stringify(source.reviewedFloors),
    },
    heightBindingReview: { version: 1, savedAt: 'old', draftJson: 'unchanged' },
    deliveryMeasurements: { version: 1, savedAt: 'old', draftJson: 'unchanged' },
  }
  const project = { planUrl: 'source.pdf', planReading: reading }
  const revision = planEditRevision(project.planUrl, reading)
  const page = {
    pageNumber: 3,
    image: { body: imageBody, width: 1000, height: 1000 },
    nativeTextAnchors: source.native,
    linework: source.work,
    lineworkRasterSource: source.lineworkSource,
  }
  const review = {
    acknowledgement: true,
    selections: [{ floorId: 'native-fill-10:0:piece-0', roomIndex: 0 }],
  }
  return { body, source, reading, project, revision, page, review }
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

describe('authenticated source room number recovery', () => {
  it('loads fresh readonly proposals without writes', async () => {
    const result = await getPlanSourceRoomNumberOptions('project', f.revision)
    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.data.options).toHaveLength(1)
    expect(result.data.options[0]?.sourceNumber).toBe(3.1)
    expect(result.data.readyFor3D).toBe(false)
    expect(mocks.save).not.toHaveBeenCalled()
    expect(mocks.prepare).toHaveBeenCalledWith(f.body, true, 3, true, true)
  })
  it('preserves the complete reading except the selected missing identifier and saves with CAS', async () => {
    const before = structuredClone(f.reading)
    const result = await savePlanSourceRoomNumbers('project', JSON.stringify(f.review), f.revision)
    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.data.reading).toEqual({
      ...before,
      rooms: [{ ...before.rooms[0], sourceNumber: 3.1 }],
    })
    expect(f.reading).toEqual(before)
    expect(mocks.save).toHaveBeenCalledWith('owner', 'project', result.data.reading, f.project)
    expect(mocks.audit).toHaveBeenCalledWith(
      expect.objectContaining({
        action: 'project.plan_rooms',
        metadata: expect.objectContaining({
          operation: 'source-room-number-recovery',
          geometryChanged: false,
        }),
      }),
    )
  })
  it.each([
    'session',
    'owner',
    'revision',
    'original',
    'page',
    'raster',
    'incomplete',
    'floor-version',
    'fuzzy-name',
    'collision',
  ])('rejects %s without writes', async (failure) => {
    if (failure === 'session') mocks.session.mockResolvedValue(null)
    if (failure === 'owner') mocks.owner.mockRejectedValue(new AccessError('Forbidden'))
    if (failure === 'revision') f.revision = 'stale'
    if (failure === 'original')
      mocks.object.mockResolvedValue({ body: Buffer.from('different PDF') })
    if (failure === 'page') f.page.pageNumber = 4
    if (failure === 'raster') f.page.image.width = 900
    if (failure === 'incomplete') f.source.native.complete = false
    if (failure === 'floor-version')
      Object.assign(f.reading.paintedFloorReview ?? {}, { version: 2 })
    if (failure === 'fuzzy-name') Object.assign(f.reading.rooms[0] ?? {}, { name: 'спальня' })
    if (failure === 'collision')
      f.reading.rooms.push({ name: 'Кладовая', kind: 'bedroom', sourceNumber: 3.1 })
    if (['floor-version', 'fuzzy-name', 'collision'].includes(failure))
      f.revision = planEditRevision(f.project.planUrl, f.reading)
    expect(
      (await savePlanSourceRoomNumbers('project', JSON.stringify(f.review), f.revision)).ok,
    ).toBe(false)
    expect(mocks.save).not.toHaveBeenCalled()
    expect(mocks.audit).not.toHaveBeenCalled()
  })
  it('handles a concurrent write conflict without audit or path revalidation', async () => {
    mocks.save.mockRejectedValue(new PlanEditConflictError())
    expect(
      await savePlanSourceRoomNumbers('project', JSON.stringify(f.review), f.revision),
    ).toMatchObject({ ok: false, code: 'plan-conflict' })
    expect(mocks.audit).not.toHaveBeenCalled()
    expect(mocks.revalidate).not.toHaveBeenCalled()
  })
  it.each([
    '{',
    'x'.repeat(16 * 1024 + 1),
    JSON.stringify({ acknowledgement: false, selections: [] }),
    JSON.stringify({ acknowledgement: true, selections: [{ floorId: 'other', roomIndex: 0 }] }),
  ])('rejects malformed/stale input', async (review) => {
    expect((await savePlanSourceRoomNumbers('project', review, f.revision)).ok).toBe(false)
    expect(mocks.save).not.toHaveBeenCalled()
  })
})
