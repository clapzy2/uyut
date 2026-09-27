import { createHash } from 'node:crypto'
import type { PlanGeometry, PlanReading } from '@uyut/db'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { PlanEditConflictError, planEditRevision } from '@/lib/projects/plan-edit-revision'

const mocks = vi.hoisted(() => ({
  session: vi.fn(),
  owner: vi.fn(),
  object: vi.fn(),
  prepare: vi.fn(),
  convert: vi.fn(),
  save: vi.fn(),
  audit: vi.fn(),
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
vi.mock('@/lib/projects/plan-page-metric-draft', () => ({ planPageMetricDraft: mocks.convert }))
vi.mock('@/lib/projects/repository', () => ({ setPlanReading: mocks.save }))
vi.mock('@/lib/audit', () => ({ recordAudit: mocks.audit }))
vi.mock('next/cache', () => ({ revalidatePath: vi.fn() }))
vi.mock('next/headers', () => ({ headers: async () => new Headers() }))

import { AccessError } from '@/lib/projects/access'
import { createPlanPageGeometryDraft } from './plan-page-geometry'

const source = {
  sha256: createHash('sha256').update('pdf').digest('hex'),
  pdfPage: 6,
  state: 'existing' as const,
}
const reading: PlanReading = {
  sourcePage: 6,
  planState: 'existing',
  readAt: '2026-09-27',
  confirmedAt: '2026-09-27',
  rooms: [{ name: 'Спальня', kind: 'bedroom', sourceNumber: 4 }],
  pageReview: {
    version: 1,
    savedAt: '2026-09-27',
    contours: {
      source,
      coordinateSystem: 'page-0-1000',
      review: 'manual-source-review',
      pageWidth: 842,
      pageHeight: 1191,
      rooms: [
        {
          roomSourceNumber: 4,
          polygon: [
            { x: 10, y: 10 },
            { x: 30, y: 10 },
            { x: 30, y: 30 },
          ],
        },
      ],
    },
  },
}
const geometry: PlanGeometry = {
  version: 1,
  source: 'manual',
  status: 'draft',
  widthCm: 300,
  heightCm: 500,
  walls: [],
  openings: [],
  rooms: [],
  warnings: ['Дополните схему'],
}
const project = { planUrl: 'plan.pdf', planReading: reading }
const revision = planEditRevision(project.planUrl, reading)
const page = { pageNumber: 6, linework: { paths: [] }, image: { planText: 'native-text' } }

describe('create metric draft from reviewed source page', () => {
  beforeEach(() => {
    vi.resetAllMocks()
    mocks.session.mockResolvedValue({ user: { id: 'owner' } })
    mocks.owner.mockResolvedValue(project)
    mocks.object.mockResolvedValue({ body: Buffer.from('pdf') })
    mocks.prepare.mockResolvedValue(page)
    mocks.convert.mockReturnValue({ ok: true, geometry })
    mocks.save.mockResolvedValue(undefined)
  })

  it('uses fresh PDF evidence and atomically creates an unconfirmed draft', async () => {
    const result = await createPlanPageGeometryDraft('project', [4], revision)
    if (!result.ok) throw new Error(result.error)
    expect(mocks.prepare).toHaveBeenCalledWith(Buffer.from('pdf'), true, 6, true)
    expect(mocks.convert).toHaveBeenCalledWith(
      reading,
      {
        source,
        linework: page.linework,
        planText: 'native-text',
        contours: reading.pageReview?.contours,
      },
      [4],
    )
    expect(result.data.geometry).toEqual(geometry)
    expect(result.data.geometry).not.toHaveProperty('confirmedAt')
    const saved = { ...reading, geometry }
    expect(mocks.save).toHaveBeenCalledWith('owner', 'project', saved, project)
    expect(result.data.revision).toBe(planEditRevision('plan.pdf', saved))
    expect(mocks.audit).toHaveBeenCalledWith(
      expect.objectContaining({
        action: 'project.plan_geometry_drafted',
        metadata: { source: 'reviewed-pdf', page: 6, roomContours: 0, openings: 0, obstacles: 0 },
      }),
    )
  })

  it('passes an explicit independently validated page-wide anchor choice', async () => {
    const result = await createPlanPageGeometryDraft('project', [4], revision, [4])
    expect(result.ok).toBe(true)
    expect(mocks.convert).toHaveBeenCalledWith(
      reading,
      expect.objectContaining({ calibrationRoomNumbers: [4] }),
      [4],
    )
  })

  it.each([[], [4, 4], ['4'], [0], [51]].map((anchors) => ({ anchors })))(
    'rejects invalid calibration anchor input: $anchors',
    async ({ anchors }) => {
      expect((await createPlanPageGeometryDraft('project', [4], revision, anchors)).ok).toBe(false)
      expect(mocks.object).not.toHaveBeenCalled()
      expect(mocks.save).not.toHaveBeenCalled()
    },
  )

  it.each(
    [
      null,
      [],
      [4, 4],
      [0],
      [1.5],
      ['4'],
      { rooms: [4], widthCm: 300 },
      Array.from({ length: 13 }, (_, i) => i + 1),
    ].map((input) => ({ input })),
  )('refuses invalid selection before source access: $input', async ({ input }) => {
    expect((await createPlanPageGeometryDraft('project', input, revision)).ok).toBe(false)
    expect(mocks.owner).not.toHaveBeenCalled()
    expect(mocks.object).not.toHaveBeenCalled()
  })

  it('requires an owner session and a current revision before storage access', async () => {
    mocks.session.mockResolvedValueOnce(null)
    expect((await createPlanPageGeometryDraft('project', [4], revision)).ok).toBe(false)
    mocks.owner.mockRejectedValueOnce(new AccessError('Только владелец'))
    expect((await createPlanPageGeometryDraft('project', [4], revision)).ok).toBe(false)
    expect(await createPlanPageGeometryDraft('project', [4], 'stale')).toMatchObject({
      ok: false,
      code: 'plan-conflict',
    })
    expect(mocks.object).not.toHaveBeenCalled()
    expect(mocks.save).not.toHaveBeenCalled()
  })

  it.each([
    { ...reading, geometry },
    { ...reading, confirmedAt: undefined },
    { ...reading, planState: 'proposed' as const },
    { ...reading, pageReview: undefined },
  ])('does not overwrite existing geometry or bypass the review prerequisites', async (before) => {
    mocks.owner.mockResolvedValue({ ...project, planReading: before })
    expect(
      (await createPlanPageGeometryDraft('project', [4], planEditRevision('plan.pdf', before))).ok,
    ).toBe(false)
    expect(mocks.object).not.toHaveBeenCalled()
    expect(mocks.save).not.toHaveBeenCalled()
  })

  it('refuses replaced source bytes before PDF preparation', async () => {
    mocks.object.mockResolvedValue({ body: Buffer.from('changed') })
    expect(await createPlanPageGeometryDraft('project', [4], revision)).toMatchObject({
      ok: false,
      code: 'plan-conflict',
    })
    expect(mocks.prepare).not.toHaveBeenCalled()
    expect(mocks.save).not.toHaveBeenCalled()
  })

  it('refuses an unannotated room before storage access', async () => {
    expect((await createPlanPageGeometryDraft('project', [5], revision)).ok).toBe(false)
    expect(mocks.object).not.toHaveBeenCalled()
    expect(mocks.save).not.toHaveBeenCalled()
  })

  it.each([
    { ...page, linework: undefined },
    { ...page, pageNumber: 12 },
  ])('requires the actual selected native page', async (prepared) => {
    mocks.prepare.mockResolvedValue(prepared)
    expect((await createPlanPageGeometryDraft('project', [4], revision)).ok).toBe(false)
    expect(mocks.convert).not.toHaveBeenCalled()
    expect(mocks.save).not.toHaveBeenCalled()
  })

  it('keeps all data unchanged when scale or opening proof is missing', async () => {
    mocks.convert.mockReturnValue({ ok: false, error: 'Уточните глубину помещения №4' })
    expect(await createPlanPageGeometryDraft('project', [4], revision)).toEqual({
      ok: false,
      error: 'Уточните глубину помещения №4',
    })
    expect(mocks.save).not.toHaveBeenCalled()
    expect(mocks.audit).not.toHaveBeenCalled()
  })

  it('reports a concurrent write as a conflict rather than replacing the new scheme', async () => {
    mocks.save.mockRejectedValue(new PlanEditConflictError())
    expect(await createPlanPageGeometryDraft('project', [4], revision)).toMatchObject({
      ok: false,
      code: 'plan-conflict',
    })
    expect(mocks.audit).not.toHaveBeenCalled()
  })
})
