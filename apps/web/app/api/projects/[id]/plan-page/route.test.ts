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
})
