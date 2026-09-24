import { beforeEach, describe, expect, it, vi } from 'vitest'

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

import { savePlanGeometry } from './projects'

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

describe('manual plan draft', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mocks.getSession.mockResolvedValue({ user: { id: 'owner' } })
    mocks.assertOwner.mockResolvedValue({
      planUrl: 'plan.webp',
      planReading: {
        readAt: '2026-09-24T00:00:00.000Z',
        confirmedAt: '2026-09-24T00:00:00.000Z',
        rooms: [{ name: 'Кухня', areaM2: 5.4 }],
        geometry: emptyManualGeometry,
      },
    })
    mocks.setPlanReading.mockResolvedValue(undefined)
    mocks.audit.mockResolvedValue(undefined)
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
    )
    expect(mocks.audit).toHaveBeenCalledWith(
      expect.objectContaining({ action: 'project.plan_geometry_drafted' }),
    )
  })

  it('persists a calibrated underlay with a draft', async () => {
    const result = await savePlanGeometry(
      projectId,
      { ...emptyManualGeometry, imageCalibration: calibratedImage },
      'draft',
    )
    expect(result.ok).toBe(true)
    expect(mocks.setPlanReading).toHaveBeenCalledWith(
      'owner',
      projectId,
      expect.objectContaining({
        geometry: expect.objectContaining({ imageCalibration: calibratedImage }),
      }),
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
      {
        id: 'manual_000000000000000000000001',
        kind: 'outer' as const,
        start: { xCm: 0, yCm: 0 },
        end: { xCm: 500, yCm: 0 },
      },
      {
        id: 'manual_000000000000000000000002',
        kind: 'outer' as const,
        start: { xCm: 500, yCm: 0 },
        end: { xCm: 500, yCm: 400 },
      },
      {
        id: 'manual_000000000000000000000003',
        kind: 'outer' as const,
        start: { xCm: 500, yCm: 400 },
        end: { xCm: 0, yCm: 400 },
      },
      {
        id: 'manual_000000000000000000000004',
        kind: 'outer' as const,
        start: { xCm: 0, yCm: 400 },
        end: { xCm: 0, yCm: 0 },
      },
      {
        id: 'manual_000000000000000000000005',
        kind: 'inner' as const,
        start: { xCm: 200, yCm: 100 },
        end: { xCm: 300, yCm: 100 },
      },
    ]
    const rooms = [
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
    const submitted = { ...emptyManualGeometry, walls, rooms }

    const rejected = await savePlanGeometry(projectId, submitted, 'confirm')
    expect(rejected.ok).toBe(false)
    if (!rejected.ok) expect(rejected.error).toContain('не соединена')
    expect(mocks.setPlanReading).not.toHaveBeenCalled()

    const draft = await savePlanGeometry(projectId, submitted, 'draft')
    expect(draft.ok).toBe(true)
  })
})
