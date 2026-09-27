import type { PlanReading } from '@uyut/db'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { AccessError } from '@/lib/projects/access'
import { PlanEditConflictError, planEditRevision } from '@/lib/projects/plan-edit-revision'

const mocks = vi.hoisted(() => ({
  assertOwner: vi.fn(),
  audit: vi.fn(),
  getSession: vi.fn(),
  revalidate: vi.fn(),
  setPlanReading: vi.fn(),
}))

vi.mock('@/lib/projects/access', () => ({
  AccessError: class AccessError extends Error {},
  assertOwner: mocks.assertOwner,
}))
vi.mock('@/lib/projects/repository', () => ({ setPlanReading: mocks.setPlanReading }))
vi.mock('@/lib/projects/plan-reading', () => ({
  PlanReadError: class PlanReadError extends Error {},
  readPlanFromStorage: vi.fn(),
}))
vi.mock('@/lib/session', () => ({ getSession: mocks.getSession }))
vi.mock('@/lib/audit', () => ({ recordAudit: mocks.audit }))
vi.mock('next/cache', () => ({ revalidatePath: mocks.revalidate }))
vi.mock('next/headers', () => ({ headers: async () => new Headers() }))

import { savePlanGeometry as saveGeometryAction } from './projects'

let source: { planUrl: string; planReading: PlanReading }

function savePlanGeometry(id: string, input: unknown, mode: 'draft' | 'confirm') {
  return saveGeometryAction(id, input, mode, planEditRevision(source.planUrl, source.planReading))
}

const projectId = 'f6fcb42e-2b4e-4b39-bb5c-31c9bfbe9f2f'
const emptyManualGeometry = {
  version: 1 as const,
  source: 'manual' as const,
  status: 'draft' as const,
  widthCm: 500,
  heightCm: 400,
  walls: [],
  openings: [],
  rooms: [],
  warnings: [],
}

const calibratedImage = {
  imageWidthPx: 1000,
  imageHeightPx: 800,
  pixelStart: { x: 100, y: 100 },
  pixelEnd: { x: 400, y: 100 },
  worldStart: { xCm: 0, yCm: 0 },
  lengthCm: 300,
  direction: 'right' as const,
}

const corners = [
  { xCm: 0, yCm: 0 },
  { xCm: 500, yCm: 0 },
  { xCm: 500, yCm: 400 },
  { xCm: 0, yCm: 400 },
]
const closedWalls = corners.map((start, index) => ({
  id: `manual_${String(index + 1).padStart(24, '0')}`,
  kind: 'outer' as const,
  start,
  end: corners[(index + 1) % corners.length],
}))
const kitchenContour = [
  {
    name: 'Кухня',
    polygon: [
      { xCm: 0, yCm: 0 },
      { xCm: 300, yCm: 0 },
      { xCm: 300, yCm: 180 },
      { xCm: 0, yCm: 180 },
    ],
  },
]

describe('manual plan draft', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mocks.getSession.mockResolvedValue({ user: { id: 'owner' } })
    source = {
      planUrl: 'plan.webp',
      planReading: {
        readAt: '2026-09-24T00:00:00.000Z',
        confirmedAt: '2026-09-24T00:00:00.000Z',
        rooms: [{ name: 'Кухня', kind: 'kitchen', areaM2: 5.4 }],
        geometry: emptyManualGeometry,
      },
    }
    mocks.assertOwner.mockResolvedValue(source)
    mocks.setPlanReading.mockResolvedValue(undefined)
    mocks.audit.mockResolvedValue(undefined)
  })

  it('rejects an old editor revision without writing or announcing success', async () => {
    const result = await saveGeometryAction(projectId, emptyManualGeometry, 'draft', '0'.repeat(64))
    expect(result.ok).toBe(false)
    expect(mocks.setPlanReading).not.toHaveBeenCalled()
    expect(mocks.audit).not.toHaveBeenCalled()
    expect(mocks.revalidate).not.toHaveBeenCalled()
  })

  it('requires a source revision even when called outside the editor', async () => {
    expect(await saveGeometryAction(projectId, emptyManualGeometry, 'draft')).toMatchObject({
      ok: false,
      code: 'plan-conflict',
    })
    expect(mocks.setPlanReading).not.toHaveBeenCalled()
  })

  it('does not save without a session or owner permission', async () => {
    mocks.getSession.mockResolvedValueOnce(null)
    expect((await savePlanGeometry(projectId, emptyManualGeometry, 'draft')).ok).toBe(false)
    expect(mocks.assertOwner).not.toHaveBeenCalled()
    mocks.assertOwner.mockRejectedValueOnce(new AccessError('Проект не найден'))
    expect(await savePlanGeometry(projectId, emptyManualGeometry, 'draft')).toEqual({
      ok: false,
      error: 'Проект не найден',
    })
    expect(mocks.setPlanReading).not.toHaveBeenCalled()
  })

  it('returns a conflict if the source changes between validation and the database write', async () => {
    mocks.setPlanReading.mockRejectedValueOnce(new PlanEditConflictError())
    expect(await savePlanGeometry(projectId, emptyManualGeometry, 'draft')).toMatchObject({
      ok: false,
      code: 'plan-conflict',
    })
    expect(mocks.audit).not.toHaveBeenCalled()
    expect(mocks.revalidate).not.toHaveBeenCalled()
  })

  it('allows retry after a failed write and only then records success', async () => {
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => {})
    try {
      mocks.setPlanReading.mockRejectedValueOnce(new Error('Synthetic database failure'))
      expect((await savePlanGeometry(projectId, emptyManualGeometry, 'draft')).ok).toBe(false)
      expect(mocks.audit).not.toHaveBeenCalled()
      expect(mocks.revalidate).not.toHaveBeenCalled()
      const retry = await savePlanGeometry(projectId, emptyManualGeometry, 'draft')
      expect(retry.ok).toBe(true)
      if (retry.ok) {
        expect(retry.data.revision).toBe(
          planEditRevision(source.planUrl, {
            ...source.planReading,
            geometry: retry.data.geometry,
          }),
        )
      }
      expect(mocks.audit).toHaveBeenCalledOnce()
      expect(mocks.revalidate).toHaveBeenCalledOnce()
    } finally {
      consoleError.mockRestore()
    }
  })

  it('revalidates a saved draft before giving it a new confirmation', async () => {
    source.planReading.rooms = [{ name: 'Кухня', kind: 'kitchen', areaM2: 20 }]
    const result = await savePlanGeometry(
      projectId,
      {
        ...emptyManualGeometry,
        walls: closedWalls,
        rooms: [{ name: 'Кухня', polygon: corners }],
        confirmedAt: 'forged-old-confirmation',
      },
      'confirm',
    )
    expect(result.ok).toBe(true)
    if (result.ok) {
      expect(result.data.geometry.status).toBe('confirmed')
      expect(result.data.geometry.confirmedAt).toMatch(/^2026-/)
      expect(result.data.geometry.confirmedAt).not.toBe('forged-old-confirmation')
    }
  })

  it('saves further edits as a draft and removes the old geometry confirmation', async () => {
    source.planReading.geometry = {
      ...emptyManualGeometry,
      status: 'confirmed',
      confirmedAt: '2026-09-26T00:00:00.000Z',
    }
    const result = await savePlanGeometry(projectId, emptyManualGeometry, 'draft')
    expect(result.ok).toBe(true)
    const saved = mocks.setPlanReading.mock.calls[0]?.[2]
    expect(saved.geometry.status).toBe('draft')
    expect(saved.geometry).not.toHaveProperty('confirmedAt')
    expect(saved.confirmedAt).toBe(source.planReading.confirmedAt)
  })

  it('saves an empty draft without upgrading it to confirmed geometry', async () => {
    const result = await savePlanGeometry(projectId, emptyManualGeometry, 'draft')

    expect(result.ok).toBe(true)
    expect(mocks.setPlanReading).toHaveBeenCalledWith(
      'owner',
      projectId,
      expect.objectContaining({
        geometry: expect.objectContaining({ status: 'draft', walls: [], source: 'manual' }),
      }),
      source,
    )
    expect(mocks.audit).toHaveBeenCalledWith(
      expect.objectContaining({ action: 'project.plan_geometry_drafted' }),
    )
  })

  it('persists a calibrated underlay with a draft', async () => {
    const checkedCalibration = {
      ...calibratedImage,
      verificationLines: [
        {
          pixelStart: { x: 200, y: 500 },
          pixelEnd: { x: 340, y: 500 },
          lengthCm: 140,
        },
      ],
    }
    const result = await savePlanGeometry(
      projectId,
      { ...emptyManualGeometry, imageCalibration: checkedCalibration },
      'draft',
    )
    expect(result.ok).toBe(true)
    expect(mocks.setPlanReading).toHaveBeenCalledWith(
      'owner',
      projectId,
      expect.objectContaining({
        geometry: expect.objectContaining({ imageCalibration: checkedCalibration }),
      }),
      source,
    )
  })

  it('rejects a calibration outside the canvas', async () => {
    const result = await savePlanGeometry(
      projectId,
      {
        ...emptyManualGeometry,
        imageCalibration: { ...calibratedImage, worldStart: { xCm: 400, yCm: 0 } },
      },
      'draft',
    )
    expect(result.ok).toBe(false)
    expect(mocks.setPlanReading).not.toHaveBeenCalled()
  })

  it('rejects fabricated verification lines outside the image', async () => {
    const result = await savePlanGeometry(
      projectId,
      {
        ...emptyManualGeometry,
        imageCalibration: {
          ...calibratedImage,
          verificationLines: [
            { pixelStart: { x: 900, y: 500 }, pixelEnd: { x: 1200, y: 500 }, lengthCm: 140 },
          ],
        },
      },
      'draft',
    )
    expect(result.ok).toBe(false)
    expect(mocks.setPlanReading).not.toHaveBeenCalled()
  })

  it('does not confirm geometry when independent dimensions contradict the scale', async () => {
    const result = await savePlanGeometry(
      projectId,
      {
        ...emptyManualGeometry,
        walls: closedWalls,
        rooms: kitchenContour,
        imageCalibration: {
          ...calibratedImage,
          verificationLines: [
            { pixelStart: { x: 100, y: 500 }, pixelEnd: { x: 200, y: 500 }, lengthCm: 140 },
          ],
        },
      },
      'confirm',
    )
    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.error).toContain('не сходятся')
    expect(mocks.setPlanReading).not.toHaveBeenCalled()
  })

  it('does not confirm a room contour that disagrees with its labelled area', async () => {
    const result = await savePlanGeometry(
      projectId,
      {
        ...emptyManualGeometry,
        walls: closedWalls,
        rooms: [
          {
            name: 'Кухня',
            polygon: [
              { xCm: 0, yCm: 0 },
              { xCm: 300, yCm: 0 },
              { xCm: 300, yCm: 150 },
              { xCm: 0, yCm: 150 },
            ],
          },
        ],
      },
      'confirm',
    )
    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.error).toContain('на плане подписано')
    expect(mocks.setPlanReading).not.toHaveBeenCalled()
  })

  it('never confirms an unfinished apartment', async () => {
    const walls = [
      [
        { xCm: 0, yCm: 0 },
        { xCm: 500, yCm: 0 },
      ],
      [
        { xCm: 500, yCm: 0 },
        { xCm: 500, yCm: 400 },
      ],
      [
        { xCm: 500, yCm: 400 },
        { xCm: 0, yCm: 0 },
      ],
    ].map(([start, end], index) => ({
      id: `manual_${String(index + 1).padStart(24, '0')}`,
      kind: 'outer',
      start,
      end,
    }))
    const result = await savePlanGeometry(projectId, { ...emptyManualGeometry, walls }, 'confirm')

    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.error).toContain('контуры всех комнат')
    expect(mocks.setPlanReading).not.toHaveBeenCalled()
  })

  it('rejects an isolated wall when confirming, but still saves the draft', async () => {
    const walls = [
      ...closedWalls,
      {
        id: 'manual_000000000000000000000005',
        kind: 'inner' as const,
        start: { xCm: 200, yCm: 100 },
        end: { xCm: 300, yCm: 100 },
      },
    ]
    const submitted = { ...emptyManualGeometry, walls, rooms: kitchenContour }

    const rejected = await savePlanGeometry(projectId, submitted, 'confirm')
    expect(rejected.ok).toBe(false)
    if (!rejected.ok) expect(rejected.error).toContain('не соединена')
    expect(mocks.setPlanReading).not.toHaveBeenCalled()

    const draft = await savePlanGeometry(projectId, submitted, 'draft')
    expect(draft.ok).toBe(true)
  })
})
