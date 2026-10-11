import { createHash } from 'node:crypto'
import type { PlanReading } from '@uyut/db'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { PlanEditConflictError, planEditRevision } from '@/lib/projects/plan-edit-revision'
import type { ReviewedNativePaintedFloors } from '@/lib/projects/plan-native-painted-floor-review'
import { nativePaintedFloorReview } from '@/lib/projects/plan-native-painted-floor-review'
import { nativeVisiblePaintRegions } from '@/lib/projects/plan-native-visible-paint'

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
import { savePlanPaintedFloorReview } from './plan-painted-floor-review'

const required = <T>(value: T | undefined): T => {
  if (value === undefined) throw new Error('Missing fixture')
  return value
}
function fixture() {
  const body = Buffer.from('synthetic source PDF'),
    imageBody = Buffer.from('synthetic rendered image')
  const hash = createHash('sha256').update(body).digest('hex')
  const raster = {
    sha256: createHash('sha256').update(imageBody).digest('hex'),
    page: 3,
    width: 1000,
    height: 1000,
  }
  const common: Parameters<typeof nativeVisiblePaintRegions>[0] = {
    native: {
      source: raster,
      originalPdfSha256: hash,
      complete: true,
      pageNormalizedScale: { x: 1, y: 1 },
      labels: [
        {
          id: 'native-text-1',
          nativeIndex: 1,
          name: 'Спальня',
          point: { x: 150, y: 160 },
          pagePoint: { x: 150, y: 160 },
          rotation: 0,
        },
        {
          id: 'native-text-2',
          nativeIndex: 2,
          name: '3',
          point: { x: 150, y: 180 },
          pagePoint: { x: 150, y: 180 },
          rotation: 0,
        },
      ],
    },
    lineworkSource: raster,
    work: {
      coordinateSystem: 'page-0-1000',
      pageWidth: 1000,
      pageHeight: 1000,
      paths: [
        {
          operationIndex: 10,
          subpathIndex: 0,
          paint: 'fill',
          closed: true,
          points: [
            { x: 100, y: 100 },
            { x: 300, y: 100 },
            { x: 300, y: 300 },
            { x: 100, y: 300 },
          ],
        },
      ],
      skippedCurves: 0,
      clippedPaths: 0,
      unsupportedPaths: 0,
      unsupportedContexts: 0,
      truncated: false,
    },
  }
  const piece = required(nativeVisiblePaintRegions(common).regions[0]?.pieces[0])
  const reviewed: ReviewedNativePaintedFloors = {
    review: 'manual-native-painted-floor-review',
    source: { sha256: hash, pdfPage: 3, state: 'existing' },
    rasterSource: raster,
    floors: [
      {
        candidateId: 'native-fill-10:0',
        pieceIndex: 0,
        polygon: structuredClone(piece.polygon),
        holes: structuredClone(piece.holes),
        owner: { sourceRoomKey: '3', nameLabelId: 'native-text-1', numberLabelId: 'native-text-2' },
        boundaryRoles: piece.polygon.map((_, edgeIndex) => ({ edgeIndex, kind: 'unresolved' })),
      },
    ],
  }
  const reading: PlanReading = {
    sourcePage: 3,
    planState: 'existing',
    readAt: 'old',
    rooms: [{ name: 'Спальня', kind: 'bedroom', sourceNumber: 3 }],
    confirmedAt: 'unchanged',
    deliveryMeasurements: {
      version: 1,
      savedAt: 'old',
      draftJson: 'survey',
      reportJson: 'previous report',
    },
    geometry: {
      version: 1,
      source: 'manual',
      status: 'confirmed',
      confirmedAt: 'old',
      widthCm: 100,
      heightCm: 100,
      walls: [],
      rooms: [],
      openings: [],
      warnings: [],
    },
    pageReview: {
      version: 1,
      savedAt: 'old',
      contours: {
        source: reviewed.source,
        coordinateSystem: 'page-0-1000',
        review: 'manual-source-review',
        pageWidth: 1000,
        pageHeight: 1000,
        rooms: [],
      },
    },
  }
  const project = { planUrl: 'source.pdf', planReading: reading }
  const page = {
    pageNumber: 3,
    pageCount: 5,
    image: { body: imageBody, contentType: 'image/jpeg', width: 1000, height: 1000 },
    nativeTextAnchors: common.native,
    linework: common.work,
    lineworkRasterSource: common.lineworkSource,
  }
  return {
    body,
    common,
    reviewed,
    reading,
    project,
    page,
    revision: planEditRevision(project.planUrl, reading),
  }
}

describe('persist explicit source-painted floor review', () => {
  let current: ReturnType<typeof fixture>
  beforeEach(() => {
    vi.resetAllMocks()
    current = fixture()
    mocks.session.mockResolvedValue({ user: { id: 'owner' } })
    mocks.owner.mockResolvedValue(current.project)
    mocks.object.mockResolvedValue({ body: current.body })
    mocks.prepare.mockResolvedValue(current.page)
    mocks.save.mockResolvedValue(undefined)
  })
  const save = () =>
    savePlanPaintedFloorReview('project', JSON.stringify(current.reviewed), current.revision)

  it('checks actual source-floor core and saves only validated declarations without confirming geometry', async () => {
    const proof = nativePaintedFloorReview({ ...current.common, reviewed: current.reviewed })
    expect(proof.status).toBe('reviewed-draft')
    expect(proof.readyFor2D).toBe(false)
    const before = structuredClone(current.reading)
    const result = await save()
    expect(result.ok).toBe(true)
    const reading = mocks.save.mock.calls[0]?.[2] as PlanReading
    expect(reading.paintedFloorReview).toMatchObject({
      version: 1,
      draftJson: JSON.stringify(current.reviewed),
    })
    expect(reading.paintedFloorReview?.savedAt).toMatch(/^\d{4}-\d{2}-\d{2}T/)
    expect({ ...reading, paintedFloorReview: undefined }).toEqual({
      ...before,
      paintedFloorReview: undefined,
    })
    expect(current.reading).toEqual(before)
    expect(JSON.parse(required(reading.paintedFloorReview).draftJson)).not.toHaveProperty(
      'readyFor2D',
    )
    expect(mocks.prepare).toHaveBeenCalledWith(current.body, true, 3, true, true)
    expect(mocks.save).toHaveBeenCalledWith('owner', 'project', reading, current.project)
    expect(mocks.audit).toHaveBeenCalledWith(
      expect.objectContaining({
        action: 'project.plan_painted_floor_reviewed',
        metadata: { page: 3, planState: 'existing', floors: 1 },
      }),
    )
    expect(mocks.revalidate).toHaveBeenCalledWith('/projects/project')
    if (!result.ok) throw new Error(result.error)
    expect(result.data.reading).toEqual(reading)
    expect(result.data.reading.paintedFloorReview?.draftJson).toBe(JSON.stringify(current.reviewed))
    expect(result.data.revision).toBe(planEditRevision(current.project.planUrl, reading))
    expect(result.data.revision).not.toBe(current.revision)
  })

  it('requires a signed-in owner, not a project collaborator', async () => {
    mocks.session.mockResolvedValue(null)
    expect((await save()).ok).toBe(false)
    expect(mocks.owner).not.toHaveBeenCalled()
    mocks.session.mockResolvedValue({ user: { id: 'collaborator' } })
    mocks.owner.mockRejectedValue(new AccessError('Недостаточно прав'))
    expect(await save()).toEqual({ ok: false, error: 'Недостаточно прав' })
    expect(mocks.object).not.toHaveBeenCalled()
    expect(mocks.save).not.toHaveBeenCalled()
  })

  it('rejects stale revisions before fetching the source', async () => {
    const result = await savePlanPaintedFloorReview(
      'project',
      JSON.stringify(current.reviewed),
      'stale',
    )
    expect(result).toMatchObject({ ok: false, code: 'plan-conflict' })
    expect(mocks.object).not.toHaveBeenCalled()
    expect(mocks.save).not.toHaveBeenCalled()
  })

  it('preserves concurrent edits through repository CAS and returns a conflict without audit', async () => {
    mocks.save.mockRejectedValue(new PlanEditConflictError())
    expect(await save()).toMatchObject({ ok: false, code: 'plan-conflict' })
    expect(mocks.audit).not.toHaveBeenCalled()
    expect(mocks.revalidate).not.toHaveBeenCalled()
  })

  it.each(['{broken', 'null', '[]', '{}'])(
    'rejects malformed or missing review input %s',
    async (input) => {
      expect((await savePlanPaintedFloorReview('project', input, current.revision)).ok).toBe(false)
      expect(mocks.object).not.toHaveBeenCalled()
      expect(mocks.save).not.toHaveBeenCalled()
    },
  )

  it('bounds JSON UTF8 bytes before parsing, including multibyte input', async () => {
    expect(
      (await savePlanPaintedFloorReview('project', 'я'.repeat(32769), current.revision)).ok,
    ).toBe(false)
    expect(mocks.object).not.toHaveBeenCalled()
  })

  it.each(['root', 'floor', 'point', 'owner', 'role', 'source', 'raster'])(
    'rejects caller proof claims and extra nested keys at %s',
    async (location) => {
      const input = structuredClone(current.reviewed)
      const floor = required(input.floors[0])
      const targets = {
        root: input,
        floor,
        point: required(floor.polygon[0]),
        owner: floor.owner,
        role: required(floor.boundaryRoles[0]),
        source: input.source,
        raster: input.rasterSource,
      }
      const target = targets[location as keyof typeof targets] as unknown as Record<string, unknown>
      target.physicalBoundariesAccepted = true
      expect(
        (await savePlanPaintedFloorReview('project', JSON.stringify(input), current.revision)).ok,
      ).toBe(false)
      expect(mocks.object).not.toHaveBeenCalled()
      expect(mocks.save).not.toHaveBeenCalled()
    },
  )

  it('rejects a different original source hash before preparing a page', async () => {
    mocks.object.mockResolvedValue({ body: Buffer.from('changed PDF') })
    expect(await save()).toMatchObject({ ok: false, code: 'plan-conflict' })
    expect(mocks.prepare).not.toHaveBeenCalled()
    expect(mocks.save).not.toHaveBeenCalled()
  })

  it.each(['page', 'state', 'file'])(
    'requires the current existing PDF reading %s',
    async (kind) => {
      const project = structuredClone(current.project)
      if (kind === 'page') project.planReading.sourcePage = 4
      if (kind === 'state') project.planReading.planState = 'proposed'
      if (kind === 'file') project.planUrl = 'source.jpg'
      mocks.owner.mockResolvedValue(project)
      expect(
        (
          await savePlanPaintedFloorReview(
            'project',
            JSON.stringify(current.reviewed),
            planEditRevision(project.planUrl, project.planReading),
          )
        ).ok,
      ).toBe(false)
      expect(mocks.object).not.toHaveBeenCalled()
      expect(mocks.save).not.toHaveBeenCalled()
    },
  )

  it.each(['page', 'image', 'hash', 'raster', 'width', 'missing'])(
    'rejects stale fresh-render evidence %s',
    async (kind) => {
      const page = structuredClone(current.page)
      if (kind === 'page') page.pageNumber = 4
      if (kind === 'image') page.image.body = Buffer.from('different image')
      if (kind === 'hash') page.nativeTextAnchors.originalPdfSha256 = 'c'.repeat(64)
      if (kind === 'raster')
        page.lineworkRasterSource = { ...page.lineworkRasterSource, sha256: 'c'.repeat(64) }
      if (kind === 'width') page.image.width = 999
      if (kind === 'missing') page.linework = undefined as unknown as typeof page.linework
      mocks.prepare.mockResolvedValue(page)
      expect((await save()).ok).toBe(false)
      expect(mocks.save).not.toHaveBeenCalled()
    },
  )

  it.each(['polygon', 'owner', 'roles', 'raster', 'native'])(
    'uses real validator to reject held reviews %s',
    async (kind) => {
      if (kind === 'polygon') required(required(current.reviewed.floors[0]).polygon[0]).x += 1
      if (kind === 'owner')
        required(current.reviewed.floors[0]).owner.nameLabelId = 'native-text-99'
      if (kind === 'roles') required(current.reviewed.floors[0]).boundaryRoles.pop()
      if (kind === 'raster')
        current.reviewed.rasterSource = { ...current.reviewed.rasterSource, sha256: 'c'.repeat(64) }
      if (kind === 'native') current.page.nativeTextAnchors.complete = false
      expect((await save()).ok).toBe(false)
      expect(mocks.save).not.toHaveBeenCalled()
      expect(mocks.audit).not.toHaveBeenCalled()
    },
  )
})
