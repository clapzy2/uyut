import type { PlanReading } from '@uyut/db'
import type { NextRequest } from 'next/server'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { previewFromHeaders } from '@/components/plan-page-contour-editor-model'
import { planEditRevision } from '@/lib/projects/plan-edit-revision'
import { floorHeightFixture } from '@/lib/projects/plan-native-reviewed-floor-heights.fixture'

const mocks = vi.hoisted(() => ({
  session: vi.fn(),
  access: vi.fn(),
  object: vi.fn(),
  prepare: vi.fn(),
}))
vi.mock('@/lib/session', () => ({ getSession: mocks.session }))
vi.mock('@/lib/projects/access', () => ({
  AccessError: class AccessError extends Error {},
  assertOwnerOrCollaborator: mocks.access,
}))
vi.mock('@/lib/storage', () => ({ getObject: mocks.object }))
vi.mock('@/lib/projects/plan-document', () => ({
  PlanReadError: class PlanReadError extends Error {},
  preparePlanPage: mocks.prepare,
}))

import { AccessError } from '@/lib/projects/access'
import { GET } from './route'

const reading: PlanReading = {
  sourcePage: 6,
  planState: 'existing',
  readAt: '2026-09-27',
  rooms: [{ name: 'Спальня', kind: 'bedroom', sourceNumber: 4 }],
}
const project = { id: 'project', role: 'partner', planUrl: 'plan.pdf', planReading: reading }
const revision = planEditRevision(project.planUrl, reading)
const page = {
  pageNumber: 6,
  pageCount: 48,
  image: {
    body: Buffer.from('jpeg'),
    contentType: 'image/jpeg',
    width: 1414,
    height: 2000,
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
          { x: 12.345678, y: 20 },
          { x: 30, y: 40 },
        ],
      },
      {
        operationIndex: 2,
        subpathIndex: 0,
        paint: 'stroke',
        closed: false,
        points: [
          { x: 30, y: 40 },
          { x: 50, y: 60 },
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
const request = (page = '6', version = revision, format?: string) =>
  ({
    nextUrl: new URL(
      `https://domitsa.ru/api/projects/project/plan-page?page=${page}&revision=${version}${format === undefined ? '' : `&format=${format}`}`,
    ),
  }) as NextRequest
const context = { params: Promise.resolve({ id: 'project' }) }

describe('private PDF page preview', () => {
  function savedProject() {
    const savedReading: PlanReading = {
      ...structuredClone(reading),
      pageReview: {
        version: 1,
        savedAt: '2026-10-09',
        contours: {
          source: {
            sha256: createHash('sha256').update('pdf').digest('hex'),
            pdfPage: 6,
            state: 'existing',
          },
          coordinateSystem: 'page-0-1000',
          review: 'manual-source-review',
          pageWidth: page.linework.pageWidth,
          pageHeight: page.linework.pageHeight,
          rooms: [
            {
              roomSourceNumber: 4,
              polygon: [
                { x: 12.345678, y: 20 },
                { x: 30, y: 40 },
                { x: 50, y: 60 },
              ],
            },
          ],
        },
      },
    }
    return { ...project, planReading: savedReading }
  }
  beforeEach(() => {
    vi.resetAllMocks()
    mocks.session.mockResolvedValue({ user: { id: 'partner' } })
    mocks.access.mockResolvedValue(project)
    mocks.object.mockResolvedValue({ body: Buffer.from('pdf') })
    mocks.prepare.mockResolvedValue(page)
  })
  it('returns fresh coverage for saved review without serializing the reading or saved geometry', async () => {
    const own = savedProject(),
      before = structuredClone(own)
    mocks.access.mockResolvedValue(own)
    const result = await GET(
      request('6', planEditRevision(own.planUrl, own.planReading), 'native-review'),
      context,
    )
    expect(result.status).toBe(200)
    const packet = await result.json()
    expect(packet.savedReview).toMatchObject({
      status: 'checked',
      coverage: { status: 'partial', floorBoundary: 'missing' },
    })
    expect(packet.savedReview.coverage.source.sha256).toBe(result.headers.get('x-plan-sha256'))
    expect(packet).not.toHaveProperty('pageReview')
    expect(packet).not.toHaveProperty('planReading')
    expect(packet.savedReview.coverage).not.toHaveProperty('reviewSpans')
    expect(own).toEqual(before)
  })
  it('rejects a saved-review change during coverage inspection even when PDF URL is unchanged', async () => {
    const own = savedProject(),
      changed = structuredClone(own)
    if (!changed.planReading.pageReview) throw new Error('Missing review')
    changed.planReading.pageReview.savedAt = '2026-10-10'
    mocks.access
      .mockResolvedValueOnce(own)
      .mockResolvedValueOnce(own)
      .mockResolvedValueOnce(changed)
    const result = await GET(
      request('6', planEditRevision(own.planUrl, own.planReading), 'native-review'),
      context,
    )
    expect(result.status).toBe(409)
    expect(result.headers.get('cache-control')).toBe('private, no-store')
  })

  it('returns a read-only unresolved whole-page packet when native layers are unavailable', async () => {
    const result = await GET(request('6', revision, 'native-review'), context)
    expect(result.status).toBe(200)
    expect(result.headers.get('cache-control')).toBe('private, no-store')
    const body = await result.json()
    expect(body).toMatchObject({
      version: 1,
      status: 'unresolved',
      sourceRevision: revision,
      readiness: { readyFor2D: false, readyFor3D: false, readOnly: true },
    })
    expect(body.source.sha256).toBe(result.headers.get('x-plan-sha256'))
    expect(body.image.sha256).toBe(result.headers.get('x-plan-image-sha256'))
    expect(body).not.toHaveProperty('geometry')
    expect(mocks.prepare).toHaveBeenCalledWith(Buffer.from('pdf'), true, 6, true, true)
    expect(mocks.access).toHaveBeenCalledTimes(3)
  })
  it('returns private inspection pixels without requiring AI room numbers', async () => {
    const withoutNumbers = { ...reading, rooms: [{ name: 'Комната', kind: 'bedroom' as const }] }
    const own = { ...project, planReading: withoutNumbers }
    mocks.access.mockResolvedValue(own)
    const version = planEditRevision(own.planUrl, withoutNumbers)
    const result = await GET(request('6', version, 'native-review-image'), context)
    expect(result.status).toBe(200)
    expect(result.headers.get('x-plan-image-sha256')).toMatch(/^[a-f0-9]{64}$/)
    expect(await result.text()).toBe('jpeg')
    expect(mocks.prepare).toHaveBeenCalledWith(Buffer.from('pdf'), true, 6, false)
  })
  it.each(['native-review', 'native-review-image', 'source-floor-reference', 'fill-hints'])(
    'protects %s before loading private source',
    async (format) => {
      mocks.session.mockResolvedValue(null)
      expect((await GET(request('6', revision, format), context)).status).toBe(401)
      expect(mocks.object).not.toHaveBeenCalled()
      expect(mocks.prepare).not.toHaveBeenCalled()
    },
  )
  it('rejects a proposed page for native inspection without extraction', async () => {
    const proposed = { ...reading, planState: 'proposed' as const }
    mocks.access.mockResolvedValue({ ...project, planReading: proposed })
    expect(
      (
        await GET(
          request('6', planEditRevision(project.planUrl, proposed), 'native-review'),
          context,
        )
      ).status,
    ).toBe(400)
    expect(mocks.prepare).not.toHaveBeenCalled()
  })
  it('rejects a source change during whole-page inspection', async () => {
    mocks.access
      .mockResolvedValueOnce(project)
      .mockResolvedValueOnce(project)
      .mockResolvedValueOnce({ ...project, planUrl: 'changed.pdf' })
    const result = await GET(request('6', revision, 'native-review'), context)
    expect(result.status).toBe(409)
    expect(result.headers.get('cache-control')).toBe('private, no-store')
  })
  it('rechecks access before returning the inspection packet', async () => {
    mocks.access
      .mockResolvedValueOnce(project)
      .mockResolvedValueOnce(project)
      .mockRejectedValueOnce(new AccessError('revoked'))
    expect((await GET(request('6', revision, 'native-review'), context)).status).toBe(404)
  })

  it('returns an isolated raw source reference without changing the ordinary point response', async () => {
    const result = await GET(request('6', revision, 'source-floor-reference'), context)
    expect(result.status).toBe(200)
    expect(await result.json()).toMatchObject({
      version: 1,
      coordinateSystem: 'page-0-1000',
      status: 'not-saved',
      floors: [],
      sourceRevision: revision,
      readOnly: true,
      physicalBoundariesAccepted: false,
      pageWidth: 842,
      pageHeight: 1191,
    })
    expect(result.headers.get('cache-control')).toBe('private, no-store')
    expect(result.headers.get('x-plan-page-width')).toBe('842')
    expect(result.headers.get('x-plan-page-height')).toBe('1191')
    expect(previewFromHeaders(result.headers, 6)).toMatchObject({
      page: 6,
      width: 842,
      height: 1191,
    })
    expect(mocks.prepare).toHaveBeenCalledWith(Buffer.from('pdf'), true, 6, true, true)
    expect(mocks.access).toHaveBeenCalledTimes(3)
  })
  it('returns bounded paint outlines as private hints without claiming room ownership', async () => {
    const imageSource = {
      sha256: createHash('sha256').update('jpeg').digest('hex'),
      page: 6,
      width: 1414,
      height: 2000,
    }
    mocks.prepare.mockResolvedValue({
      ...page,
      nativeTextAnchors: {
        source: imageSource,
        originalPdfSha256: createHash('sha256').update('pdf').digest('hex'),
        complete: true,
        pageNormalizedScale: { x: imageSource.width / 1000, y: imageSource.height / 1000 },
        labels: [
          { id: 'room-name', name: 'Кухня', pagePoint: { x: 150, y: 150 } },
          // Подпись площади внутри заливки; надстрочная «²» лежит отдельной меткой.
          { id: 'room-area', name: 'S: 4,64 м', pagePoint: { x: 140, y: 160 } },
          { id: 'room-area-sup', name: '2', pagePoint: { x: 170, y: 158 } },
          { id: 'outside-area', name: 'S: 99,00 м', pagePoint: { x: 500, y: 500 } },
        ],
      },
      lineworkRasterSource: imageSource,
      linework: {
        ...page.linework,
        paths: [
          ...page.linework.paths,
          {
            operationIndex: 10,
            subpathIndex: 0,
            paint: 'fill',
            closed: true,
            fillColor: '#ffffff',
            points: [
              { x: 100, y: 100 },
              { x: 200, y: 100 },
              { x: 200, y: 200 },
              { x: 100, y: 200 },
            ],
          },
        ],
      },
    })
    const result = await GET(request('6', revision, 'fill-hints'), context)
    expect(result.status).toBe(200)
    const hints = await result.json()
    expect(hints).toMatchObject({
      sourceRevision: revision,
      status: 'diagnostic',
      candidates: [
        {
          id: 'native-fill-10:0',
          areaM2: null,
          nearbyText: ['Кухня'],
          // Подпись площади чертежа показывается рядом с расчётом и не выбирает контур.
          printedAreas: ['S: 4,64 м²'],
        },
      ],
      roomHints: [],
    })
    expect(hints).not.toHaveProperty('geometry')
    expect(hints).not.toHaveProperty('roomSourceNumber')
    expect(result.headers.get('cache-control')).toBe('private, no-store')
    expect(result.headers.get('x-plan-page-width')).toBe('842')
    expect(result.headers.get('x-plan-page-height')).toBe('1191')
    expect(mocks.prepare).toHaveBeenCalledWith(Buffer.from('pdf'), true, 6, true, true)
  })
  it.each([
    [false, false],
    [true, false],
    [true, true],
  ])(
    'freshly rechecks selected source coordinates with backwards-compatible inspection, openings=%s visibility=%s',
    async (includeOpenings, includeVisibility) => {
      const evidence = floorHeightFixture()
      // This route also serves older source packets without a paint inventory.
      delete evidence.work.paintBounds
      const sha256 = createHash('sha256').update('pdf').digest('hex')
      evidence.native.originalPdfSha256 = sha256
      evidence.reviewedFloors.source.sha256 = sha256
      evidence.native.source.sha256 = createHash('sha256').update('jpeg').digest('hex')
      const selectedReading: PlanReading = {
        ...reading,
        sourcePage: 3,
        paintedFloorReview: {
          version: 1,
          savedAt: '2026-10-12',
          draftJson: JSON.stringify(evidence.reviewedFloors),
        },
      }
      const own = { ...project, planReading: selectedReading }
      mocks.access.mockResolvedValue(own)
      mocks.prepare.mockResolvedValue({
        ...page,
        pageNumber: 3,
        image: { ...page.image, width: 1000, height: 1000 },
        linework: evidence.work,
        nativeTextAnchors: evidence.native,
        lineworkRasterSource: evidence.lineworkSource,
      })
      const sourceRequest = request(
        '3',
        planEditRevision(own.planUrl, selectedReading),
        'source-floor-reference',
      )
      if (includeOpenings) sourceRequest.nextUrl.searchParams.set('openingInspection', '1')
      if (includeVisibility) sourceRequest.nextUrl.searchParams.set('evidenceVersion', '2')
      const result = await GET(sourceRequest, context)
      expect(result.status).toBe(200)
      const reference = await result.json()
      expect(reference.status).toBe('checked')
      expect(reference.floors[0].polygon).toEqual(evidence.reviewedFloors.floors[0]?.polygon)
      expect(reference.floors[0].sourceRoomKey).toBe('3.1')
      expect(reference.physicalBoundariesAccepted).toBe(false)
      expect(reference).not.toHaveProperty('geometry')
      if (includeOpenings) {
        expect(reference.openingInspection).toMatchObject({
          status: 'checked',
          physicalJambAccepted: false,
          physicalPassageAccepted: false,
        })
      } else expect(reference).not.toHaveProperty('openingInspection')
      const contact = reference.floors[0].boundarySupports[0].contacts[0]
      if (includeVisibility)
        expect(contact.visibility).toMatchObject({
          status: 'held',
          reason: 'paint-envelope-inventory-unavailable',
        })
      else expect(contact).not.toHaveProperty('visibility')
    },
  )

  it('returns bounded late-paint envelopes only for the explicit v3 inspection', async () => {
    const evidence = floorHeightFixture()
    const sha256 = createHash('sha256').update('pdf').digest('hex')
    evidence.native.originalPdfSha256 = sha256
    evidence.reviewedFloors.source.sha256 = sha256
    evidence.native.source.sha256 = createHash('sha256').update('jpeg').digest('hex')
    evidence.work.paintBounds = {
      complete: true,
      refusalReason: null,
      events: [
        ...evidence.work.paths.map((path) => ({
          operationIndex: path.operationIndex,
          kind: 'vector' as const,
          subpathCount: 1,
          bounds: {
            left: Math.min(...path.points.map((point) => point.x)),
            top: Math.min(...path.points.map((point) => point.y)),
            right: Math.max(...path.points.map((point) => point.x)),
            bottom: Math.max(...path.points.map((point) => point.y)),
          },
          reason: null,
        })),
        {
          operationIndex: 1000,
          kind: 'image',
          bounds: { left: 90, top: 90, right: 310, bottom: 310 },
          reason: null,
        },
      ],
    }
    const selectedReading: PlanReading = {
      ...reading,
      sourcePage: 3,
      paintedFloorReview: {
        version: 1,
        savedAt: '2026-10-12',
        draftJson: JSON.stringify(evidence.reviewedFloors),
      },
    }
    const own = { ...project, planReading: selectedReading }
    mocks.access.mockResolvedValue(own)
    mocks.prepare.mockResolvedValue({
      ...page,
      pageNumber: 3,
      image: { ...page.image, width: 1000, height: 1000 },
      linework: evidence.work,
      nativeTextAnchors: evidence.native,
      lineworkRasterSource: evidence.lineworkSource,
    })
    const sourceRequest = request(
      '3',
      planEditRevision(own.planUrl, selectedReading),
      'source-floor-reference',
    )
    sourceRequest.nextUrl.searchParams.set('evidenceVersion', '3')
    const result = await GET(sourceRequest, context)
    expect(result.status).toBe(200)
    const reference = await result.json()
    expect(reference.blockerPaint).toMatchObject({
      status: 'checked',
      reason: null,
      events: [
        {
          operationIndex: 1000,
          kind: 'image',
          bounds: { left: 90, top: 90, right: 310, bottom: 310 },
        },
      ],
    })
    expect(reference.physicalBoundariesAccepted).toBe(false)
  })

  it.each(['source', 'revoked'])(
    'rechecks %s after the fresh raw source reference is prepared',
    async (fault) => {
      mocks.access.mockResolvedValueOnce(project).mockResolvedValueOnce(project)
      if (fault === 'source') mocks.access.mockResolvedValueOnce({ ...project, planUrl: 'new.pdf' })
      else mocks.access.mockRejectedValueOnce(new AccessError('revoked'))
      expect((await GET(request('6', revision, 'source-floor-reference'), context)).status).toBe(
        fault === 'source' ? 409 : 404,
      )
    },
  )

  it('does not promote malformed stored source-floor selection into a reference', async () => {
    const invalid = {
      ...project,
      planReading: {
        ...reading,
        paintedFloorReview: { version: 1 as const, savedAt: 'old', draftJson: '{}' },
      },
    }
    mocks.access.mockResolvedValue(invalid)
    const version = planEditRevision(invalid.planUrl, invalid.planReading)
    const result = await GET(request('6', version, 'source-floor-reference'), context)
    expect(result.status).toBe(200)
    expect(await result.json()).toMatchObject({
      status: 'held',
      floors: [],
      physicalBoundariesAccepted: false,
    })
    expect(invalid.planReading.paintedFloorReview.draftJson).toBe('{}')
  })

  it('returns only private pixels and source metadata to an authorized collaborator', async () => {
    const result = await GET(request(), context)
    expect(result.status).toBe(200)
    expect(result.headers.get('cache-control')).toBe('private, no-store')
    expect(result.headers.get('content-type')).toBe('image/jpeg')
    expect(result.headers.get('x-plan-page')).toBe('6')
    expect(result.headers.get('x-plan-page-count')).toBe('48')
    expect(result.headers.get('x-plan-page-width')).toBe('842')
    expect(result.headers.get('x-plan-page-height')).toBe('1191')
    expect(result.headers.get('x-plan-sha256')).toMatch(/^[a-f0-9]{64}$/)
    expect(await result.text()).toBe('jpeg')
    expect(mocks.access).toHaveBeenCalledWith('partner', 'project')
  })

  it.each([false, true])(
    'allows explicit manual tracing of a reviewed PDF only for its current source, changed=%s',
    async (changed) => {
      const saved = savedProject()
      saved.planReading.geometry = {
        version: 1,
        status: 'draft',
        source: 'manual',
        widthCm: 500,
        heightCm: 400,
        walls: [],
        openings: [],
        rooms: [],
        warnings: [],
        manualPdfUnderlay: {
          pdfPage: 6,
          sourceSha256: changed ? 'a'.repeat(64) : createHash('sha256').update('pdf').digest('hex'),
        },
      }
      mocks.access.mockResolvedValue(saved)
      const version = planEditRevision(saved.planUrl, saved.planReading)
      const result = await GET(request('6', version, 'raster'), context)
      expect(result.status).toBe(changed ? 409 : 200)
      if (!changed) expect(await result.text()).toBe('jpeg')
    },
  )

  it('returns unique exact native vertices with the same private source metadata', async () => {
    const result = await GET(request('6', revision, 'points'), context)
    expect(result.status).toBe(200)
    expect(result.headers.get('cache-control')).toBe('private, no-store')
    expect(result.headers.get('x-plan-page')).toBe('6')
    expect(result.headers.get('x-plan-sha256')).toMatch(/^[a-f0-9]{64}$/)
    expect(await result.json()).toEqual({
      dimensionLabels: [{ index: 0, text: '2985', x: 20, y: 10, rotation: 0 }],
      points: [
        { x: 12.345678, y: 20 },
        { x: 30, y: 40 },
        { x: 50, y: 60 },
      ],
      segments: [
        {
          operationIndex: 1,
          subpathIndex: 0,
          segmentIndex: 0,
          start: { x: 12.345678, y: 20 },
          end: { x: 30, y: 40 },
        },
        {
          operationIndex: 2,
          subpathIndex: 0,
          segmentIndex: 0,
          start: { x: 30, y: 40 },
          end: { x: 50, y: 60 },
        },
      ],
    })
  })

  it('rejects unknown formats before fetching private source bytes', async () => {
    expect((await GET(request('6', revision, 'vectors'), context)).status).toBe(400)
    expect(mocks.object).not.toHaveBeenCalled()
  })

  it('applies the same access and revision gates to native points', async () => {
    mocks.session.mockResolvedValueOnce(null)
    expect((await GET(request('6', revision, 'points'), context)).status).toBe(401)
    mocks.access.mockRejectedValueOnce(new AccessError('private'))
    expect((await GET(request('6', revision, 'points'), context)).status).toBe(404)
    expect((await GET(request('6', 'b'.repeat(64), 'points'), context)).status).toBe(409)
    expect(mocks.object).not.toHaveBeenCalled()
  })

  it('denies unauthenticated and inaccessible sources before fetching private pixels', async () => {
    mocks.session.mockResolvedValueOnce(null)
    expect((await GET(request(), context)).status).toBe(401)
    mocks.access.mockRejectedValueOnce(new AccessError('private'))
    expect((await GET(request(), context)).status).toBe(404)
    expect(mocks.object).not.toHaveBeenCalled()
  })

  it('rejects stale, missing or invalid page requests before PDF work', async () => {
    expect((await GET(request('6', 'b'.repeat(64)), context)).status).toBe(409)
    expect((await GET(request('0'), context)).status).toBe(400)
    expect((await GET(request('12'), context)).status).toBe(400)
    expect(mocks.prepare).not.toHaveBeenCalled()
  })

  it('refuses incomplete or absent native geometry for reviewed editing', async () => {
    mocks.prepare.mockResolvedValue({ ...page, linework: { ...page.linework, truncated: true } })
    expect((await GET(request(), context)).status).toBe(422)
    mocks.prepare.mockResolvedValue({ ...page, image: { ...page.image, planText: undefined } })
    expect((await GET(request(), context)).status).toBe(422)
  })

  it('does not return superseded pixels after the source changes during preparation', async () => {
    mocks.access
      .mockResolvedValueOnce(project)
      .mockResolvedValueOnce({ ...project, planUrl: 'new-plan.pdf', planReading: null })
    expect((await GET(request(), context)).status).toBe(409)
  })

  it('renders a scan for a manual draft without native lines or labels', async () => {
    const rasterReading: PlanReading = {
      ...reading,
      planState: 'unknown',
      geometry: {
        version: 1,
        status: 'draft',
        source: 'manual',
        warnings: [],
        widthCm: 700,
        heightCm: 800,
        walls: [],
        rooms: [],
        openings: [],
      },
    }
    const rasterProject = { ...project, planReading: rasterReading }
    mocks.access.mockResolvedValue(rasterProject)
    mocks.prepare.mockResolvedValue({
      ...page,
      image: { ...page.image, planText: undefined },
      linework: undefined,
    })
    const version = planEditRevision(project.planUrl, rasterReading)
    const result = await GET(request('6', version, 'raster'), context)
    expect(result.status).toBe(200)
    expect(result.headers.get('x-plan-image-width')).toBe('1414')
    expect(result.headers.get('x-plan-image-height')).toBe('2000')
    expect(result.headers.get('x-plan-page-width')).toBeNull()
    expect(result.headers.get('x-plan-sha256')).toMatch(/^[a-f0-9]{64}$/)
    expect(result.headers.get('cache-control')).toBe('private, no-store')
    expect(result.headers.get('x-plan-page')).toBe('6')
    expect(result.headers.get('x-plan-page-count')).toBe('48')
    expect(await result.text()).toBe('jpeg')
    expect(mocks.prepare).toHaveBeenCalledWith(Buffer.from('pdf'), true, 6, false)
    expect((await GET(request('6', version), context)).status).toBe(400)
    mocks.access.mockResolvedValue({
      ...rasterProject,
      planReading: { ...rasterReading, planState: 'existing' },
    })
    const nativeVersion = planEditRevision(project.planUrl, {
      ...rasterReading,
      planState: 'existing',
    })
    expect((await GET(request('6', nativeVersion), context)).status).toBe(422)
  })

  it('requires a manual draft and refuses native proof in raster mode', async () => {
    const geometry = {
      version: 1 as const,
      status: 'draft' as const,
      source: 'manual' as const,
      warnings: [],
      widthCm: 700,
      heightCm: 800,
      walls: [],
      rooms: [],
      openings: [],
    }
    for (const value of [
      reading,
      { ...reading, geometry: { ...geometry, source: undefined } },
      { ...reading, geometry: { ...geometry, pdfCalibration: {} } },
      { ...reading, geometry, pageReview: {} },
    ]) {
      mocks.access.mockResolvedValue({ ...project, planReading: value })
      expect(
        (
          await GET(
            request('6', planEditRevision(project.planUrl, value as PlanReading), 'raster'),
            context,
          )
        ).status,
      ).toBe(400)
    }
    expect(mocks.prepare).not.toHaveBeenCalled()
  })

  it('keeps authentication and revision gates for raster sources', async () => {
    mocks.session.mockResolvedValueOnce(null)
    expect((await GET(request('6', revision, 'raster'), context)).status).toBe(401)
    mocks.access.mockRejectedValueOnce(new AccessError('private'))
    expect((await GET(request('6', revision, 'raster'), context)).status).toBe(404)
    expect((await GET(request('6', 'b'.repeat(64), 'raster'), context)).status).toBe(409)
    expect(mocks.object).not.toHaveBeenCalled()
  })

  it('defaults a legacy raster reading to page one and rejects mismatched or superseded pages', async () => {
    const rasterReading: PlanReading = {
      ...reading,
      sourcePage: undefined,
      planState: 'unknown',
      geometry: {
        version: 1,
        status: 'draft',
        source: 'manual',
        warnings: [],
        widthCm: 700,
        heightCm: 800,
        walls: [],
        rooms: [],
        openings: [],
      },
    }
    const rasterProject = { ...project, planReading: rasterReading }
    const version = planEditRevision(project.planUrl, rasterReading)
    mocks.access.mockResolvedValue(rasterProject)
    expect((await GET(request('6', version, 'raster'), context)).status).toBe(400)
    expect(mocks.prepare).not.toHaveBeenCalled()
    mocks.prepare.mockResolvedValue({ ...page, pageNumber: 1, linework: undefined })
    expect((await GET(request('1', version, 'raster'), context)).status).toBe(200)
    expect(mocks.prepare).toHaveBeenCalledWith(Buffer.from('pdf'), true, 1, false)
    mocks.access
      .mockResolvedValueOnce(rasterProject)
      .mockResolvedValueOnce({ ...rasterProject, planReading: { ...rasterReading, sourcePage: 2 } })
    expect((await GET(request('1', version, 'raster'), context)).status).toBe(409)
    mocks.prepare.mockResolvedValue({ ...page, pageNumber: 2 })
    expect((await GET(request('1', version, 'raster'), context)).status).toBe(422)
  })
})

import { createHash } from 'node:crypto'
