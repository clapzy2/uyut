import type { PlanReading } from '@uyut/db'
import type { NextRequest } from 'next/server'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { planEditRevision } from '@/lib/projects/plan-edit-revision'

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
  beforeEach(() => {
    vi.resetAllMocks()
    mocks.session.mockResolvedValue({ user: { id: 'partner' } })
    mocks.access.mockResolvedValue(project)
    mocks.object.mockResolvedValue({ body: Buffer.from('pdf') })
    mocks.prepare.mockResolvedValue(page)
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
