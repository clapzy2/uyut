import { createHash } from 'node:crypto'
import type { PlanReading } from '@uyut/db'
import type { NextRequest } from 'next/server'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { planEditRevision } from '@/lib/projects/plan-edit-revision'

const mocks = vi.hoisted(() => ({
  session: vi.fn(),
  access: vi.fn(),
  object: vi.fn(),
  candidates: vi.fn(),
}))
vi.mock('@/lib/session', () => ({ getSession: mocks.session }))
vi.mock('@/lib/projects/access', () => ({
  AccessError: class AccessError extends Error {},
  assertOwnerOrCollaborator: mocks.access,
}))
vi.mock('@/lib/storage', () => ({ getObject: mocks.object }))
vi.mock('@/lib/projects/plan-raster-candidates', () => ({ rasterPlanCandidates: mocks.candidates }))

import { AccessError } from '@/lib/projects/access'
import { GET } from './route'

const reading: PlanReading = {
  readAt: '2026-10-08',
  rooms: [],
  geometry: {
    version: 1,
    status: 'draft',
    source: 'manual',
    widthCm: 600,
    heightCm: 800,
    walls: [],
    rooms: [],
    openings: [],
    warnings: [],
  },
}
const project = {
  id: 'project',
  role: 'partner',
  planUrl: 'private/source.png',
  planReading: reading,
}
const revision = planEditRevision(project.planUrl, reading)
const context = { params: Promise.resolve({ id: 'project' }) }
const candidates = {
  width: 820,
  height: 970,
  points: [
    { x: 726, y: 823 },
    { x: 673, y: 876 },
  ],
  segments: [{ start: { x: 726, y: 823 }, end: { x: 673, y: 876 } }],
  truncated: false,
  uncertain: false,
}
function request(version: string | null = revision, page?: string) {
  const url = new URL('https://domitsa.ru/api/projects/project/plan-raster-edges')
  if (version !== null) url.searchParams.set('revision', version)
  if (page !== undefined) url.searchParams.set('page', page)
  return { nextUrl: url } as NextRequest
}

describe('private unclassified raster guides', () => {
  beforeEach(() => {
    vi.resetAllMocks()
    mocks.session.mockResolvedValue({ user: { id: 'partner' } })
    mocks.access.mockResolvedValue(project)
    mocks.object.mockResolvedValue({ body: Buffer.from('actual source bytes') })
    mocks.candidates.mockResolvedValue(candidates)
  })

  it('returns private pixel guides and a digest of actual source bytes to an authorized collaborator', async () => {
    const result = await GET(request(), context)
    expect(result.status).toBe(200)
    expect(result.headers.get('cache-control')).toBe('private, no-store')
    expect(result.headers.get('x-content-type-options')).toBe('nosniff')
    expect(result.headers.get('content-type')).toContain('application/json')
    expect(await result.json()).toEqual({
      source: {
        sha256: createHash('sha256').update('actual source bytes').digest('hex'),
        page: 1,
        width: 820,
        height: 970,
      },
      points: candidates.points,
      segments: candidates.segments,
      truncated: false,
      uncertain: false,
    })
    expect(mocks.access).toHaveBeenCalledTimes(2)
    expect(mocks.access).toHaveBeenCalledWith('partner', 'project')
    expect(mocks.candidates).toHaveBeenCalledWith(Buffer.from('actual source bytes'), false, 1)
  })

  it('keeps uncertainty and truncation explicit rather than treating partial guides as geometry', async () => {
    mocks.candidates.mockResolvedValue({ ...candidates, truncated: true, uncertain: true })
    const result = await GET(request(), context)
    expect(await result.json()).toMatchObject({ truncated: true, uncertain: true })
  })

  it('denies unauthenticated and inaccessible sources without fetching bytes', async () => {
    mocks.session.mockResolvedValueOnce(null)
    expect((await GET(request(), context)).status).toBe(401)
    mocks.access.mockRejectedValueOnce(new AccessError('private'))
    expect((await GET(request(), context)).status).toBe(404)
    expect(mocks.object).not.toHaveBeenCalled()
  })

  it('requires a valid current revision and positive integer page before decoding', async () => {
    for (const version of [null, '', 'a'.repeat(63), 'A'.repeat(64)])
      expect((await GET(request(version), context)).status).toBe(400)
    for (const page of ['', '0', '-1', '1.5', '01', '10000'])
      expect((await GET(request(revision, page), context)).status).toBe(400)
    expect((await GET(request('b'.repeat(64)), context)).status).toBe(409)
    expect(mocks.object).not.toHaveBeenCalled()
    expect(mocks.candidates).not.toHaveBeenCalled()
  })

  it('requires an existing source and page one for a raster upload', async () => {
    expect((await GET(request(revision, '2'), context)).status).toBe(400)
    mocks.access.mockResolvedValue({ ...project, planUrl: null })
    expect((await GET(request(planEditRevision(null, reading)), context)).status).toBe(400)
    expect(mocks.object).not.toHaveBeenCalled()
  })

  it('supports only the selected manual PDF sheet, with legacy page one default', async () => {
    const pdfReading = { ...reading, sourcePage: 6 }
    const pdfProject = { ...project, planUrl: 'private/source.PDF', planReading: pdfReading }
    const version = planEditRevision(pdfProject.planUrl, pdfReading)
    mocks.access.mockResolvedValue(pdfProject)
    expect((await GET(request(version), context)).status).toBe(400)
    const result = await GET(request(version, '6'), context)
    expect(result.status).toBe(200)
    expect(await result.json()).toMatchObject({ source: { page: 6 } })
    expect(mocks.candidates).toHaveBeenCalledWith(Buffer.from('actual source bytes'), true, 6)
    mocks.access.mockResolvedValue({ ...pdfProject, planReading: reading })
    expect(
      (await GET(request(planEditRevision(pdfProject.planUrl, reading)), context)).status,
    ).toBe(200)
  })

  it('refuses native PDF proofs and PDF readings without manual geometry', async () => {
    for (const value of [
      null,
      { ...reading, geometry: undefined },
      { ...reading, geometry: { ...reading.geometry, source: 'image' } },
      { ...reading, pageReview: {} },
      { ...reading, geometry: { ...reading.geometry, pdfCalibration: {} } },
    ]) {
      const planUrl = 'private/source.pdf'
      mocks.access.mockResolvedValue({ ...project, planUrl, planReading: value })
      const version = planEditRevision(planUrl, value as PlanReading | null)
      expect((await GET(request(version), context)).status).toBe(400)
    }
    expect(mocks.candidates).not.toHaveBeenCalled()
    expect(mocks.object).not.toHaveBeenCalled()
  })

  it('never returns superseded guides or guides after access is revoked during decoding', async () => {
    mocks.access
      .mockResolvedValueOnce(project)
      .mockResolvedValueOnce({ ...project, planUrl: 'new.png' })
    expect((await GET(request(), context)).status).toBe(409)
    mocks.access.mockResolvedValueOnce(project).mockRejectedValueOnce(new AccessError('revoked'))
    expect((await GET(request(), context)).status).toBe(404)
  })

  it('returns generic private errors for unreadable objects and decoder failures', async () => {
    mocks.object.mockRejectedValueOnce(new Error('private/object-key signed-secret'))
    const missing = await GET(request(), context)
    expect(missing.status).toBe(422)
    expect(await missing.text()).not.toMatch(/private|signed-secret/)
    mocks.candidates.mockRejectedValueOnce(new Error('decoder internal private/source.png'))
    const invalid = await GET(request(), context)
    expect(invalid.status).toBe(422)
    expect(invalid.headers.get('cache-control')).toBe('private, no-store')
    expect(await invalid.text()).not.toContain('private/source.png')
  })
})
