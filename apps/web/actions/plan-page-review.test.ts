import { createHash } from 'node:crypto'
import type { PlanPageContours, PlanReading } from '@uyut/db'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { PlanEditConflictError, planEditRevision } from '@/lib/projects/plan-edit-revision'
import features from '../../../docs/qa/fixtures/apartment-74-77-page-features.json'

const mocks = vi.hoisted(() => ({
  session: vi.fn(),
  owner: vi.fn(),
  object: vi.fn(),
  prepare: vi.fn(),
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
vi.mock('@/lib/projects/repository', () => ({ setPlanReading: mocks.save }))
vi.mock('next/cache', () => ({ revalidatePath: vi.fn() }))
vi.mock('next/headers', () => ({ headers: async () => new Headers() }))
vi.mock('@/lib/audit', () => ({ recordAudit: mocks.audit }))

import { AccessError } from '@/lib/projects/access'
import { savePlanPageReview } from './plan-page-review'

const contours: PlanPageContours = {
  source: {
    sha256: createHash('sha256').update('pdf').digest('hex'),
    pdfPage: 6,
    state: 'existing',
  },
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
}
const reading: PlanReading = {
  sourcePage: 6,
  planState: 'existing',
  readAt: '2026-09-27',
  rooms: [{ name: 'Спальня', kind: 'bedroom', sourceNumber: 4 }],
}
const project = { planUrl: 'plan.pdf', planReading: reading }
const revision = planEditRevision(project.planUrl, reading)
const page = {
  pageNumber: 6,
  pageCount: 48,
  image: {
    body: Buffer.from('jpeg'),
    contentType: 'image/jpeg',
    planText: JSON.stringify([{ text: '2985', x: 20, y: 10, rotation: 0 }]),
  },
  linework: {
    coordinateSystem: 'page-0-1000',
    pageWidth: 842,
    pageHeight: 1191,
    paths: [
      {
        operationIndex: 1,
        subpathIndex: 0,
        paint: 'stroke',
        closed: false,
        points: [
          { x: 10, y: 10 },
          { x: 30, y: 10 },
          { x: 30, y: 30 },
        ],
      },
    ],
    skippedCurves: 0,
    unsupportedPaths: 0,
    unsupportedContexts: 0,
    clippedPaths: 0,
    truncated: false,
  },
}

describe('save source page review action', () => {
  beforeEach(() => {
    vi.resetAllMocks()
    mocks.session.mockResolvedValue({ user: { id: 'owner' } })
    mocks.owner.mockResolvedValue(project)
    mocks.object.mockResolvedValue({ body: Buffer.from('pdf') })
    mocks.prepare.mockResolvedValue(page)
    mocks.save.mockResolvedValue(undefined)
  })

  it('saves a versioned review using fresh native PDF proof and atomic source guard', async () => {
    const result = await savePlanPageReview('project', contours, revision)
    if (!result.ok) throw new Error(result.error)
    expect(mocks.prepare).toHaveBeenCalledWith(Buffer.from('pdf'), true, 6, true)
    expect(result.data.reading.pageReview).toMatchObject({ version: 1, contours })
    expect(result.data.reading).not.toHaveProperty('confirmedAt')
    expect(mocks.save).toHaveBeenCalledWith('owner', 'project', result.data.reading, project)
    expect(result.data.revision).toBe(planEditRevision('plan.pdf', result.data.reading))
    expect(mocks.audit).toHaveBeenCalledWith({
      action: 'project.plan_page_reviewed',
      actorId: 'owner',
      targetType: 'project',
      targetId: 'project',
      headers: expect.any(Headers),
      metadata: { page: 6, planState: 'existing', contours: 1, openings: 0, obstacles: 0 },
    })
    const saveOrder = mocks.save.mock.invocationCallOrder[0]
    const auditOrder = mocks.audit.mock.invocationCallOrder[0]
    if (saveOrder === undefined || auditOrder === undefined)
      throw new Error('Missing save or audit')
    expect(saveOrder).toBeLessThan(auditOrder)
  })

  it('refuses a missing session, malformed payload, or stale revision before reading storage', async () => {
    mocks.session.mockResolvedValueOnce(null)
    expect((await savePlanPageReview('project', contours, revision)).ok).toBe(false)
    expect((await savePlanPageReview('project', null, revision)).ok).toBe(false)
    expect(await savePlanPageReview('project', contours, 'stale')).toMatchObject({
      ok: false,
      code: 'plan-conflict',
    })
    expect(mocks.object).not.toHaveBeenCalled()
    expect(mocks.save).not.toHaveBeenCalled()
  })
  it('derives a printed opening width from fresh native evidence without creating metric layout geometry', async () => {
    const sourceRoom = features.rooms.find((room) => room.roomSourceNumber === 4)
    if (!sourceRoom) throw new Error('Missing native source room')
    const input: PlanPageContours = {
      ...contours,
      rooms: [
        {
          roomSourceNumber: 4,
          polygon: sourceRoom.polygon,
          openings: sourceRoom.openings.map(({ id, wallEdgeIndex, start, end }) => ({
            id,
            kind: 'door',
            wallEdgeIndex,
            start,
            end,
          })),
        },
      ],
    }
    const labels = Array.from({ length: 170 }, () => ({ text: '', x: 0, y: 0, rotation: 0 }))
    for (const { index, ...label } of features.labels) labels[index] = label
    mocks.prepare.mockResolvedValue({
      ...page,
      image: { ...page.image, planText: JSON.stringify(labels) },
      linework: { ...page.linework, paths: [...features.wallPaths, ...features.dimensionPaths] },
    })
    const result = await savePlanPageReview('project', input, revision)
    if (!result.ok) throw new Error(result.error)
    expect(result.data.reading.pageReview?.featureChecks?.openings).toEqual([
      {
        roomSourceNumber: 4,
        openingId: 'room-4-existing-door',
        status: 'candidate',
        widthMm: 896,
        labelIndex: 59,
      },
    ])
    expect(result.data.reading).not.toHaveProperty('geometry')
    expect(result.data.reading).not.toHaveProperty('confirmedAt')
    expect(mocks.save).toHaveBeenCalledWith('owner', 'project', result.data.reading, project)
  })

  it('refuses dimensions injected into submitted feature annotations before storage access', async () => {
    const input = structuredClone(contours)
    const room = input.rooms[0]
    if (!room) throw new Error('Missing room')
    Object.assign(room, {
      openings: [
        {
          id: 'door',
          kind: 'door',
          wallEdgeIndex: 0,
          start: room.polygon[0],
          end: room.polygon[1],
          widthMm: 900,
        },
      ],
    })
    expect((await savePlanPageReview('project', input, revision)).ok).toBe(false)
    expect(mocks.object).not.toHaveBeenCalled()
    expect(mocks.save).not.toHaveBeenCalled()
  })

  it('refuses changed source bytes before PDF processing', async () => {
    mocks.object.mockResolvedValue({ body: Buffer.from('new-pdf') })
    expect(await savePlanPageReview('project', contours, revision)).toMatchObject({
      ok: false,
      code: 'plan-conflict',
    })
    expect(mocks.prepare).not.toHaveBeenCalled()
    expect(mocks.save).not.toHaveBeenCalled()
  })

  it('keeps editing owner-only even when a collaborator can preview the source', async () => {
    mocks.owner.mockRejectedValue(new AccessError('Это может сделать только владелец проекта.'))
    expect(await savePlanPageReview('project', contours, revision)).toMatchObject({ ok: false })
    expect(mocks.object).not.toHaveBeenCalled()
    expect(mocks.save).not.toHaveBeenCalled()
  })

  it('rejects a forged unsnapped contour even when the client bypasses the editor', async () => {
    const changed = structuredClone(contours)
    const vertex = changed.rooms[0]?.polygon[0]
    if (!vertex) throw new Error('Missing contour vertex')
    vertex.x += 0.1
    expect((await savePlanPageReview('project', changed, revision)).ok).toBe(false)
    expect(mocks.save).not.toHaveBeenCalled()
    expect(mocks.audit).not.toHaveBeenCalled()
  })

  it.each([
    { ...page, linework: undefined },
    { ...page, image: { ...page.image, planText: undefined } },
    { ...page, linework: { ...page.linework, paths: [] } },
    { ...page, linework: { ...page.linework, truncated: true } },
  ])('does not save a page without usable native proof', async (prepared) => {
    mocks.prepare.mockResolvedValue(prepared)
    expect((await savePlanPageReview('project', contours, revision)).ok).toBe(false)
    expect(mocks.save).not.toHaveBeenCalled()
  })

  it('does not accept an unknown page state or another selected page', async () => {
    const unknown = { ...project, planReading: { ...reading, planState: 'unknown' as const } }
    mocks.owner.mockResolvedValue(unknown)
    expect(
      (
        await savePlanPageReview(
          'project',
          contours,
          planEditRevision('plan.pdf', unknown.planReading),
        )
      ).ok,
    ).toBe(false)
    expect(mocks.object).not.toHaveBeenCalled()
  })

  it('reports concurrent file replacement as a conflict at the final write', async () => {
    mocks.save.mockRejectedValue(new PlanEditConflictError())
    expect(await savePlanPageReview('project', contours, revision)).toMatchObject({
      ok: false,
      code: 'plan-conflict',
    })
  })
})
