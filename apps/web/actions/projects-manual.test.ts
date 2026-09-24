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
