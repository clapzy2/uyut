import { createHash } from 'node:crypto'
import { type PlanReading, parseFloorPlan } from '@uyut/ai'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import native from '../../../../docs/qa/fixtures/apartment-74-77-native-labels.json'
import annotated from '../../../../docs/qa/fixtures/apartment-74-77-page-contours.json'
import nativeAreas from '../../../../docs/qa/fixtures/basis-native-total-area.json'
import type { PdfRoomContours } from './plan-pdf-room-binding'

const mocks = vi.hoisted(() => ({ read: vi.fn(), prepare: vi.fn(), object: vi.fn() }))
vi.mock('server-only', () => ({}))
vi.mock('@uyut/ai', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@uyut/ai')>()),
  createFalPlanReader: () => mocks.read,
}))
vi.mock('@/lib/env', () => ({ getEnv: () => ({ FAL_KEY: 'test-key' }) }))
vi.mock('@/lib/storage', () => ({ getObject: mocks.object }))
vi.mock('./plan-document', () => ({
  PlanReadError: class PlanReadError extends Error {},
  preparePlanPage: mocks.prepare,
}))

import { readPlanFromStorage } from './plan-reading'

const reviewed: PdfRoomContours = {
  ...annotated,
  rooms: annotated.rooms.map(({ roomSourceNumber, polygon }) => ({ roomSourceNumber, polygon })),
  coordinateSystem: 'page-0-1000',
  review: 'manual-source-review',
  source: {
    ...annotated.source,
    state: 'existing',
    sha256: createHash('sha256').update('pdf').digest('hex'),
  },
}
const textItems = Array.from({ length: native.originalTextItemCount }, () => ({
  text: '',
  x: 0,
  y: 0,
  rotation: 0,
}))
for (const { index, ...item } of native.items) textItems[index] = item
const linework = {
  coordinateSystem: 'page-0-1000' as const,
  pageWidth: 842,
  pageHeight: 1191,
  paths: annotated.dimensionPaths as import('./plan-pdf-linework').PdfVectorPath[],
  // This mocked layer contains selected straight rails, not the complete PDF.
  skippedCurves: 0,
  unsupportedPaths: 0,
  unsupportedContexts: 0,
  clippedPaths: 0,
  truncated: false,
}
const reviewedPage = () => ({
  image: {
    body: Buffer.from('page6'),
    contentType: 'image/jpeg',
    planText: JSON.stringify(textItems),
  },
  linework,
  pageNumber: 6,
  pageCount: 48,
})
const reviewedReading: PlanReading = {
  planState: 'existing',
  rooms: [
    {
      name: 'Кухня',
      kind: 'kitchen',
      sourceNumber: 2,
      widthCm: 296.4,
      depthCm: 420.5,
      areaM2: 12.35,
      measurementEvidence: {
        width: {
          kind: 'horizontal-chain',
          scope: 'room',
          sourceNumber: 2,
          complete: true,
          segmentsMm: [525, 563, 926, 950],
          textItemIndexes: [7, 19, 8, 9],
        },
        depth: {
          kind: 'vertical-chain',
          scope: 'room',
          sourceNumber: 2,
          complete: true,
          segmentsMm: [3718, 487],
          textItemIndexes: [16, 17],
        },
      },
    },
  ],
}

describe('single-page plan reader budget', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mocks.object.mockResolvedValue({ body: Buffer.from('pdf') })
    mocks.prepare.mockResolvedValue({
      image: { body: Buffer.from('page6'), contentType: 'image/jpeg' },
      pageNumber: 6,
      pageCount: 48,
    })
    mocks.read.mockResolvedValue({
      planState: 'existing',
      rooms: [{ name: 'Кухня', widthCm: 296.4, depthCm: 420.5, areaM2: 12.35 }],
    })
  })

  it('uses one paid call without automatic side rechecks', async () => {
    const reading = await readPlanFromStorage('plan.PDF', 6)
    expect(mocks.prepare).toHaveBeenCalledWith(Buffer.from('pdf'), true, 6, true)
    expect(mocks.read).toHaveBeenCalledTimes(1)
    expect(reading).toMatchObject({ sourcePage: 6, pageCount: 48, planState: 'existing' })
    expect(reading.rooms[0]?.widthCm).toBeUndefined()
    expect(reading.rooms[0]?.depthCm).toBeUndefined()
    expect(reading.rooms[0]?.areaM2).toBe(12.35)
  })

  it('keeps withheld native total and source warning through the storage reader path', async () => {
    mocks.prepare.mockResolvedValue({
      image: {
        body: Buffer.from('basis-page3'),
        contentType: 'image/jpeg',
        planText: JSON.stringify(nativeAreas.items),
      },
      pageNumber: 3,
      pageCount: 33,
    })
    mocks.read.mockImplementation(async (image) =>
      parseFloorPlan(
        JSON.stringify({
          planState: 'existing',
          totalAreaM2: 48.22,
          rooms: [
            { name: 'Помещение', sourceNumber: 1, areaM2: 40.13 },
            { name: 'Балкон 01', sourceNumber: 2, areaM2: 4.75 },
            { name: 'Балкон 02', sourceNumber: 3, areaM2: 3.34 },
          ],
        }),
        { requireMeasurementEvidence: true, planText: image.planText },
      ),
    )
    const reading = await readPlanFromStorage('plan.pdf', 3)
    expect(reading.totalAreaM2).toBeUndefined()
    expect(reading.rooms.map((room) => room.areaM2)).toEqual([40.13, 4.75, 3.34])
    expect(
      reading.rooms.every((room) => room.measurementWarnings?.[0]?.includes('Общая площадь')),
    ).toBe(true)
    expect(reading.sourcePage).toBe(3)
    expect(mocks.read).toHaveBeenCalledTimes(1)
  })

  it('makes no paid call if the selected page is invalid', async () => {
    mocks.prepare.mockRejectedValue(new Error('invalid page'))
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => {})
    await expect(readPlanFromStorage('plan.pdf', 49)).rejects.toThrow('Не получилось')
    expect(mocks.read).not.toHaveBeenCalled()
    consoleError.mockRestore()
  })

  it('does not keep a model-only raster or PDF floor as source-proven geometry', async () => {
    const geometry = {
      version: 1,
      status: 'draft',
      widthCm: 400,
      heightCm: 300,
      walls: [],
      rooms: [],
      openings: [],
      obstacles: [],
      warnings: [],
      footprint: [
        { xCm: 0, yCm: 0 },
        { xCm: 400, yCm: 0 },
        { xCm: 400, yCm: 300 },
      ],
    }
    mocks.read.mockResolvedValue({
      rooms: [{ name: 'Балкон', kind: 'living', spaceKind: 'balcony' }],
      geometry,
    })
    expect((await readPlanFromStorage('plan.webp')).geometry?.footprint).toBeUndefined()
    expect(mocks.read).toHaveBeenCalledTimes(2)
    expect((await readPlanFromStorage('plan.pdf')).geometry?.footprint).toBeUndefined()
    expect(geometry.footprint).toHaveLength(3)
  })

  it('retains unknown sides for an area-only room', async () => {
    mocks.read.mockResolvedValue({ rooms: [{ name: 'Коридор', areaM2: 7.7 }] })
    const reading = await readPlanFromStorage('plan.pdf', 6)
    expect(reading.rooms[0]?.widthCm).toBeUndefined()
    expect(reading.rooms[0]?.depthCm).toBeUndefined()
    expect(mocks.read).toHaveBeenCalledTimes(1)
  })

  it('passes the reviewed page through the geometry gate after exactly one mocked reader call', async () => {
    mocks.prepare.mockResolvedValue(reviewedPage())
    mocks.read.mockResolvedValue(structuredClone(reviewedReading))
    const reading = await readPlanFromStorage('plan.pdf', 6, reviewed)
    expect(mocks.prepare).toHaveBeenCalledWith(Buffer.from('pdf'), true, 6, true)
    expect(mocks.read).toHaveBeenCalledTimes(1)
    expect(reading.rooms[0]).toMatchObject({ widthCm: 296.4, depthCm: 420.5 })
  })
  it.each([
    { skippedCurves: 45 },
    { clippedPaths: 1 },
    {
      skippedCurves: 1,
      skippedCurveBounds: [
        {
          operationIndex: 999_999,
          subpathIndex: 0,
          bounds: { left: 218, top: 95, right: 219, bottom: 96 },
        },
      ],
    },
  ])(
    'does not let a manual room review bypass missing native dimension paths %j',
    async (change) => {
      mocks.prepare.mockResolvedValue({ ...reviewedPage(), linework: { ...linework, ...change } })
      mocks.read.mockResolvedValue(structuredClone(reviewedReading))
      const reading = await readPlanFromStorage('plan.pdf', 6, reviewed)
      expect(reading.rooms[0]?.widthCm).toBeUndefined()
      expect(reading.rooms[0]?.areaM2).toBe(12.35)
      if ('skippedCurveBounds' in change) expect(reading.rooms[0]?.depthCm).toBe(420.5)
      expect(mocks.read).toHaveBeenCalledTimes(1)
    },
  )
  it.each([
    [
      'changed file',
      'plan.pdf',
      6,
      { ...reviewed, source: { ...reviewed.source, sha256: 'a'.repeat(64) } },
    ],
    ['different page', 'plan.pdf', 12, reviewed],
    ['image', 'plan.jpg', 6, reviewed],
  ] as const)(
    'refuses %s before preparation or a paid reader call',
    async (_name, key, page, review) => {
      await expect(readPlanFromStorage(key, page, review)).rejects.toThrow(
        'другому файлу или листу',
      )
      expect(mocks.prepare).not.toHaveBeenCalled()
      expect(mocks.read).not.toHaveBeenCalled()
    },
  )
  it.each([
    { linework: undefined },
    { linework: { ...linework, paths: [] } },
    { image: { body: Buffer.from('page6'), contentType: 'image/jpeg' } },
    { image: { body: Buffer.from('page6'), contentType: 'image/jpeg', planText: '{broken' } },
    { image: { body: Buffer.from('page6'), contentType: 'image/jpeg', planText: '[{}]' } },
    { pageNumber: 12 },
  ])('refuses absent or wrong prepared evidence %j without a paid call', async (change) => {
    mocks.prepare.mockResolvedValue({ ...reviewedPage(), ...change })
    await expect(readPlanFromStorage('plan.pdf', 6, reviewed)).rejects.toThrow(
      'нужны нативные линии',
    )
    expect(mocks.read).not.toHaveBeenCalled()
  })
  it.each([
    { truncated: true },
    { unsupportedContexts: 1 },
    { unsupportedPaths: 1 },
    { pageWidth: 841 },
  ])('refuses incomplete or mismatched vectors %j before a paid call', async (change) => {
    mocks.prepare.mockResolvedValue({ ...reviewedPage(), linework: { ...linework, ...change } })
    await expect(readPlanFromStorage('plan.pdf', 6, reviewed)).rejects.toThrow('требуют уточнения')
    expect(mocks.read).not.toHaveBeenCalled()
  })
  it('refuses a self-intersecting contour without paying to reread it', async () => {
    mocks.prepare.mockResolvedValue(reviewedPage())
    const polygon = [
      { x: 100, y: 100 },
      { x: 200, y: 200 },
      { x: 100, y: 200 },
      { x: 200, y: 100 },
    ]
    await expect(
      readPlanFromStorage('plan.pdf', 6, {
        ...reviewed,
        rooms: [{ roomSourceNumber: 2, polygon }],
      }),
    ).rejects.toThrow('требуют уточнения')
    expect(mocks.read).not.toHaveBeenCalled()
  })
  it('does not silently retry when the model reports another source state', async () => {
    mocks.prepare.mockResolvedValue(reviewedPage())
    mocks.read.mockResolvedValue({ ...reviewedReading, planState: 'proposed' })
    const reading = await readPlanFromStorage('plan.pdf', 6, reviewed)
    expect(reading.rooms[0]?.widthCm).toBeUndefined()
    expect(reading.rooms[0]?.depthCm).toBeUndefined()
    expect(reading.rooms[0]?.areaM2).toBe(12.35)
    expect(mocks.read).toHaveBeenCalledTimes(1)
  })
  it('refuses a feature on a foreign edge before a paid reader invocation', async () => {
    mocks.prepare.mockResolvedValue(reviewedPage())
    const room = reviewed.rooms[0]
    if (!room) throw new Error('Missing room')
    await expect(
      readPlanFromStorage('plan.pdf', 6, {
        ...reviewed,
        rooms: [
          {
            ...room,
            openings: [
              {
                id: 'bad-door',
                kind: 'door',
                wallEdgeIndex: 0,
                start: { x: 100, y: 400 },
                end: { x: 110, y: 400 },
              },
            ],
          },
        ],
      }),
    ).rejects.toThrow('требуют уточнения')
    expect(mocks.read).not.toHaveBeenCalled()
  })
  it('checks native chains on the ordinary PDF path without a manual review annotation', async () => {
    const page = reviewedPage()
    mocks.prepare.mockResolvedValue({ ...page, linework: { ...linework, skippedCurves: 0 } })
    mocks.read.mockResolvedValue(structuredClone(reviewedReading))
    const reading = await readPlanFromStorage('plan.pdf', 6)
    expect(reading.rooms[0]).toMatchObject({ widthCm: 296.4, depthCm: 420.5, areaM2: 12.35 })
    expect(reading.rooms[0]?.measurementWarnings?.join(' ')).toContain('не подтверждены')
    expect(mocks.prepare.mock.calls[0]?.[3]).toBe(true)
    expect(mocks.read).toHaveBeenCalledTimes(1)
  })
  it('keeps label-only suggestions for a scanned PDF with no usable vector outline', async () => {
    mocks.prepare.mockResolvedValue({
      ...reviewedPage(),
      linework: { ...linework, paths: linework.paths.slice(0, 2) },
    })
    mocks.read.mockResolvedValue(structuredClone(reviewedReading))
    await readPlanFromStorage('plan.pdf', 6)
    expect(mocks.read).toHaveBeenCalledWith(
      expect.objectContaining({ keepNameOnlyCandidates: true }),
    )
    expect(mocks.read).toHaveBeenCalledTimes(1)
  })
  it('does not fall back to baseline-origin matches when prepared caption geometry is incomplete', async () => {
    mocks.prepare.mockResolvedValue({
      ...reviewedPage(),
      linework: { ...linework, skippedCurves: 0 },
      nativeCaptionGeometry: {
        source: {
          sha256: createHash('sha256').update('pdf').digest('hex'),
          pdfPage: 6,
          pageWidth: 842,
          pageHeight: 1191,
        },
        complete: false,
        items: [],
      },
    })
    mocks.read.mockResolvedValue(structuredClone(reviewedReading))
    const result = await readPlanFromStorage('plan.pdf', 6)
    expect(result.rooms[0]?.widthCm).toBeUndefined()
    expect(result.rooms[0]?.depthCm).toBeUndefined()
    expect(result.rooms[0]?.areaM2).toBe(12.35)
    expect(mocks.read).toHaveBeenCalledTimes(1)
  })
})
