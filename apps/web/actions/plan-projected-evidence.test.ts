import { createHash } from 'node:crypto'
import type { PlanGeometry, PlanReading } from '@uyut/db'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { planEditRevision } from '@/lib/projects/plan-edit-revision'

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
vi.mock('@/lib/audit', () => ({ recordAudit: mocks.audit }))
vi.mock('next/cache', () => ({ revalidatePath: vi.fn() }))
vi.mock('next/headers', () => ({ headers: async () => new Headers() }))

import {
  getProjectedCaptionSource,
  removeProjectedVerticalEvidence,
  reviewProjectedFloorContour,
  saveProjectedVerticalEvidence,
} from './plan-projected-evidence'

const sha = createHash('sha256').update('pdf').digest('hex')
const geometry: PlanGeometry = {
  version: 1,
  source: 'manual',
  status: 'draft',
  widthCm: 300,
  heightCm: 400,
  walls: [{ id: 'wall', kind: 'inner', start: { xCm: 0, yCm: 0 }, end: { xCm: 300, yCm: 0 } }],
  openings: [{ id: 'door', type: 'door', wallId: 'wall', offsetCm: 100, widthCm: 70 }],
  rooms: [
    {
      name: 'Санузел',
      sourceNumber: 8,
      polygon: [
        { xCm: 0, yCm: 0 },
        { xCm: 300, yCm: 0 },
        { xCm: 300, yCm: 400 },
        { xCm: 0, yCm: 400 },
      ],
    },
  ],
  warnings: [],
  pdfCalibration: {
    sourceSha256: sha,
    pdfPage: 2,
    sourceState: 'proposed',
    cmPerPoint: 1,
    origin: { x: 0, y: 0 },
    anchorRoomNumbers: [],
    labelIndexes: [],
    derivedOpeningIds: [],
  },
}
let reading: PlanReading
let project: { planUrl: string; planReading: PlanReading }
const request = () => ({
  quantity: 'floor-level',
  printedValue: '-0.050',
  unit: 'm',
  target: { kind: 'room', roomIndex: 0 },
  sourceSha256: sha,
  sourcePage: 3,
  captionIndex: 243,
  scopeLabel: 'Основной пол, без душевой части',
  acknowledged: true,
})
const revision = () => planEditRevision(project.planUrl, reading)
function prepared(pdfPage: number) {
  return {
    pageNumber: pdfPage,
    pageCount: 7,
    image: { body: Buffer.from('image') },
    nativeTextAnchors: {
      complete: true,
      originalPdfSha256: sha,
      source: { page: pdfPage },
      labels: [
        { nativeIndex: 243, name: '-0.050', pagePoint: { x: 500, y: 550 } },
        { nativeIndex: 239, name: '±0.000', pagePoint: { x: 400, y: 400 } },
        { nativeIndex: 97, name: '2 680', pagePoint: { x: 200, y: 300 } },
        { nativeIndex: 71, name: '700х2360', pagePoint: { x: 800, y: 400 } },
        {
          nativeIndex: 128,
          name: 'Высота между перекрытиями Н=3080',
          pagePoint: { x: 100, y: 900 },
        },
      ],
    },
  }
}

describe('documentary proposed values through owner actions', () => {
  beforeEach(() => {
    vi.resetAllMocks()
    reading = {
      readAt: '2026-10-25',
      sourcePage: 2,
      planState: 'proposed',
      rooms: [{ sourceNumber: 8, name: 'Санузел', kind: 'bath' }],
      geometry: structuredClone(geometry),
    }
    project = { planUrl: 'source.pdf', planReading: reading }
    mocks.session.mockResolvedValue({ user: { id: 'owner' } })
    mocks.owner.mockResolvedValue(project)
    mocks.object.mockResolvedValue({ body: Buffer.from('pdf') })
    mocks.prepare.mockImplementation(async (_body: unknown, _native: unknown, page: number) =>
      prepared(page),
    )
    mocks.save.mockResolvedValue(undefined)
  })
  it('loads an auxiliary page without changing the selected source or confusing native and compact indices', async () => {
    const result = await getProjectedCaptionSource('project', 3, revision())
    expect(result.ok).toBe(true)
    if (!result.ok) throw new Error(result.error)
    expect(result.data.captions[0]).toEqual({ index: 243, text: '-0.050', x: 500, y: 550 })
    expect(reading.sourcePage).toBe(2)
    expect(mocks.save).not.toHaveBeenCalled()
  })
  it('stamps a source-backed signed value and its exact owner without creating physical measurements', async () => {
    const result = await saveProjectedVerticalEvidence('project', request(), revision())
    expect(result.ok).toBe(true)
    const saved = mocks.save.mock.calls[0]?.[2] as PlanReading
    expect(saved.geometry?.projectedVerticalEvidence?.[0]).toMatchObject({
      quantity: 'floor-level',
      valueCm: -5,
      unit: 'm',
      target: { kind: 'room', room: geometry.rooms[0] },
      source: { sha256: sha, pdfPage: 3, captionIndexes: [243], captionTexts: ['-0.050'] },
      reviewedBy: 'owner',
    })
    expect(saved.geometry?.verticalReference).toBeUndefined()
    expect(saved.geometry?.status).toBe('draft')
    expect(saved.geometry?.openings).toEqual(geometry.openings)
    expect(saved.geometry?.walls).toEqual(geometry.walls)
    expect(saved.geometry?.rooms).toEqual(geometry.rooms)
  })
  it('accepts native thousands grouping, but never evaluates an expression', async () => {
    expect(
      (
        await saveProjectedVerticalEvidence(
          'project',
          {
            ...request(),
            quantity: 'section-headroom',
            printedValue: '2680',
            unit: 'mm',
            sourcePage: 6,
            captionIndex: 97,
          },
          revision(),
        )
      ).ok,
    ).toBe(true)
    mocks.save.mockClear()
    expect(
      (
        await saveProjectedVerticalEvidence(
          'project',
          {
            ...request(),
            quantity: 'section-headroom',
            printedValue: '3080-300-100',
            unit: 'mm',
            sourcePage: 6,
            captionIndex: 97,
          },
          revision(),
        )
      ).ok,
    ).toBe(false)
    expect(mocks.save).not.toHaveBeenCalled()
  })
  it('binds an opening height to its opening and host snapshot, not a threshold or bottom', async () => {
    expect(
      (
        await saveProjectedVerticalEvidence(
          'project',
          {
            ...request(),
            quantity: 'opening-height',
            printedValue: '2360',
            unit: 'mm',
            target: { kind: 'opening', openingId: 'door' },
            sourcePage: 2,
            captionIndex: 71,
            scopeLabel: 'Д2',
          },
          revision(),
        )
      ).ok,
    ).toBe(true)
    const saved = mocks.save.mock.calls[0]?.[2] as PlanReading
    expect(saved.geometry?.projectedVerticalEvidence?.[0]?.target).toMatchObject({
      kind: 'opening',
      opening: geometry.openings[0],
      wall: geometry.walls[0],
    })
    expect(saved.geometry?.openings[0]).not.toHaveProperty('bottomCm')
    expect(saved.geometry?.openings[0]).not.toHaveProperty('heightCm')
  })
  it.each([
    'unacknowledged',
    'missing-number',
    'wrong-sha',
    'wrong-index',
    'wrong-target',
    'forged-provenance',
    'bad-page',
  ])('refuses %s without persisting partial evidence', async (kind) => {
    const input: Record<string, unknown> = request()
    if (kind === 'unacknowledged') input.acknowledged = false
    if (kind === 'missing-number') input.printedValue = '-0.060'
    if (kind === 'wrong-sha') input.sourceSha256 = 'b'.repeat(64)
    if (kind === 'wrong-index') input.captionIndex = 0
    if (kind === 'wrong-target') input.target = { kind: 'room', roomIndex: 9 }
    if (kind === 'forged-provenance') input.reviewedBy = 'somebody'
    if (kind === 'bad-page') input.sourcePage = 0
    expect((await saveProjectedVerticalEvidence('project', input, revision())).ok).toBe(false)
    expect(mocks.save).not.toHaveBeenCalled()
  })
  it.each([
    'existing',
    'unknown',
    'stale',
    'no-owner',
    'incomplete-text',
    'changed-file',
    'other-page',
  ])('holds %s context', async (kind) => {
    if (kind === 'existing') reading.planState = 'existing'
    if (kind === 'unknown') reading.planState = 'unknown'
    if (kind === 'no-owner') mocks.owner.mockRejectedValue(new Error('No access'))
    if (kind === 'incomplete-text') {
      const page = prepared(3)
      page.nativeTextAnchors.complete = false
      mocks.prepare.mockResolvedValue(page)
    }
    if (kind === 'changed-file') mocks.object.mockResolvedValue({ body: Buffer.from('changed') })
    if (kind === 'other-page') mocks.prepare.mockResolvedValue(prepared(4))
    expect(
      (
        await saveProjectedVerticalEvidence(
          'project',
          request(),
          kind === 'stale' ? 'stale' : revision(),
        )
      ).ok,
    ).toBe(false)
    expect(mocks.save).not.toHaveBeenCalled()
  })
  it('removes only the requested statement without changing a room or its measurements', async () => {
    await saveProjectedVerticalEvidence('project', request(), revision())
    reading = mocks.save.mock.calls[0]?.[2] as PlanReading
    project.planReading = reading
    const id = reading.geometry?.projectedVerticalEvidence?.[0]?.id
    if (!id) throw new Error('Missing stored fixture')
    mocks.save.mockClear()
    expect((await removeProjectedVerticalEvidence('project', id, revision())).ok).toBe(true)
    const saved = mocks.save.mock.calls[0]?.[2] as PlanReading
    expect(saved.geometry?.projectedVerticalEvidence).toEqual([])
    expect(saved.geometry?.rooms).toEqual(geometry.rooms)
  })

  async function savedFloor() {
    await saveProjectedVerticalEvidence('project', request(), revision())
    reading = mocks.save.mock.calls[0]?.[2] as PlanReading
    project.planReading = reading
    mocks.save.mockClear()
    const entry = reading.geometry?.projectedVerticalEvidence?.[0]
    if (!entry) throw new Error('Missing floor statement')
    return entry
  }

  it('stores an explicitly reviewed whole-room scope and exact printed zero without changing physical geometry', async () => {
    const entry = await savedFloor()
    const result = await reviewProjectedFloorContour(
      'project',
      {
        mode: 'apply',
        evidenceId: entry.id,
        zeroCaptionIndex: 239,
        roomContourAcknowledged: true,
        commonZeroAcknowledged: true,
      },
      revision(),
    )
    expect(result.ok).toBe(true)
    const saved = mocks.save.mock.calls[0]?.[2] as PlanReading
    expect(saved.geometry?.projectedVerticalEvidence?.[0]?.floorContourReview).toMatchObject({
      zeroCaptionIndex: 239,
      zeroCaptionText: '±0.000',
      reviewedBy: 'owner',
    })
    expect(saved.geometry?.rooms).toEqual(geometry.rooms)
    expect(saved.geometry?.walls).toEqual(geometry.walls)
    expect(saved.geometry?.footprint).toBeUndefined()
    expect(saved.geometry?.verticalReference).toBeUndefined()
  })

  it.each([
    'no-scope',
    'no-datum',
    'unsigned-zero',
    'dimension-zero',
    'wrong-zero',
    'changed-caption',
    'changed-room',
    'stale-revision',
    'conflicting-shower',
  ])('refuses %s without assigning a floor surface', async (kind) => {
    const entry = await savedFloor()
    const input = {
      mode: 'apply',
      evidenceId: entry.id,
      zeroCaptionIndex: 239,
      roomContourAcknowledged: true,
      commonZeroAcknowledged: true,
    }
    if (kind === 'no-scope') input.roomContourAcknowledged = false
    if (kind === 'no-datum') input.commonZeroAcknowledged = false
    if (kind === 'wrong-zero') input.zeroCaptionIndex = 243
    if (kind === 'unsigned-zero' || kind === 'dimension-zero' || kind === 'changed-caption') {
      const page = prepared(3)
      const zero = page.nativeTextAnchors.labels.find(
        (item) => item.nativeIndex === (kind === 'changed-caption' ? 243 : 239),
      )
      if (!zero) throw new Error('Missing mock caption')
      zero.name = kind === 'unsigned-zero' ? '0.000' : kind === 'dimension-zero' ? '1000' : '-0.060'
      mocks.prepare.mockResolvedValue(page)
    }
    const stored = reading.geometry
    if (!stored) throw new Error('Missing geometry')
    if (kind === 'changed-room') {
      const first = geometry.rooms[0]
      if (!first) throw new Error('Missing room')
      stored.rooms[0] = { ...first, name: 'Другая комната' }
    }
    if (kind === 'conflicting-shower')
      stored.projectedVerticalEvidence?.push({
        ...structuredClone(entry),
        id: 'shower',
        printedValue: '+0.150',
        valueCm: 15,
        scopeLabel: 'Душевой участок',
        source: { ...entry.source, captionIndexes: [246], captionTexts: ['+0.150'] },
      })
    expect(
      (
        await reviewProjectedFloorContour(
          'project',
          input,
          kind === 'stale-revision' ? 'stale' : revision(),
        )
      ).ok,
    ).toBe(false)
    expect(mocks.save).not.toHaveBeenCalled()
  })

  it('removes only design surface authority and retains the documentary value', async () => {
    const entry = await savedFloor()
    entry.floorContourReview = {
      zeroCaptionIndex: 239,
      zeroCaptionText: '±0.000',
      reviewedAt: '2026-10-25T00:00:00.000Z',
      reviewedBy: 'owner',
    }
    expect(
      (
        await reviewProjectedFloorContour(
          'project',
          { mode: 'remove', evidenceId: entry.id },
          revision(),
        )
      ).ok,
    ).toBe(true)
    const saved = mocks.save.mock.calls[0]?.[2] as PlanReading
    expect(saved.geometry?.projectedVerticalEvidence?.[0]).toEqual({
      ...entry,
      floorContourReview: undefined,
    })
    expect(saved.geometry?.projectedVerticalEvidence?.[0]).not.toHaveProperty('floorContourReview')
  })

  it('does not mix two different printed zeros even when both captions contain the same number', async () => {
    const entry = await savedFloor()
    const other = structuredClone(entry)
    other.id = 'other-reviewed-floor'
    other.floorContourReview = {
      zeroCaptionIndex: 239,
      zeroCaptionText: '±0.000',
      reviewedAt: '2026-10-25T00:00:00.000Z',
      reviewedBy: 'owner',
    }
    reading.geometry?.projectedVerticalEvidence?.push(other)
    const page = prepared(3)
    page.nativeTextAnchors.labels.push({
      nativeIndex: 241,
      name: '±0.000',
      pagePoint: { x: 800, y: 800 },
    })
    mocks.prepare.mockResolvedValue(page)
    const result = await reviewProjectedFloorContour(
      'project',
      {
        mode: 'apply',
        evidenceId: entry.id,
        zeroCaptionIndex: 241,
        roomContourAcknowledged: true,
        commonZeroAcknowledged: true,
      },
      revision(),
    )
    expect(result.ok).toBe(false)
    expect(mocks.save).not.toHaveBeenCalled()
  })
})
