import { existsSync } from 'node:fs'
import { readFile } from 'node:fs/promises'
import { describe, expect, it } from 'vitest'
import { preparePlanPage } from './plan-document'
import {
  nativePaintedFloorReview,
  type ReviewedNativePaintedFloors,
} from './plan-native-painted-floor-review'
import { nativeReviewedFloorHeightBindings } from './plan-native-reviewed-floor-heights'
import { floorHeightFixture } from './plan-native-reviewed-floor-heights.fixture'
import { nativeVisiblePaintRegions } from './plan-native-visible-paint'

const rectangle = (left: number, top: number, right: number, bottom: number) => [
  { x: left, y: top },
  { x: right, y: top },
  { x: right, y: bottom },
  { x: left, y: bottom },
]
describe('reviewed source room-height bindings', () => {
  it('offers untouched numeric source captions without ceiling or global datum acceptance', () => {
    const input = floorHeightFixture(),
      before = structuredClone(input)
    const options = nativeReviewedFloorHeightBindings(input)
    expect(options.refusalReason).toBeNull()
    expect(options.options).toHaveLength(1)
    const option = options.options[0]
    expect(option).toMatchObject({
      sourceRoomKey: '3.1',
      valueMm: 2700,
      quantityKind: 'unclassified-height',
    })
    const reviewed = {
      ...options.review,
      bindings: [{ floorId: option?.floorId, labelId: option?.labelId }],
    }
    const checked = nativeReviewedFloorHeightBindings({ ...input, reviewed })
    expect(checked.bindings).toHaveLength(1)
    expect(checked).toMatchObject({
      ceilingHeightsConfirmed: false,
      commonZeroConfirmed: false,
      readyFor2D: false,
      readyFor3D: false,
    })
    expect(input).toEqual(before)
  })
  it.each([
    { covered: 'height', bounds: { left: 149, top: 179, right: 201, bottom: 191 } },
    { covered: 'unit', bounds: { left: 149, top: 199, right: 201, bottom: 211 } },
    { covered: 'floor reference', bounds: { left: 149, top: 219, right: 201, bottom: 231 } },
  ])('withholds a source H association covered by later paint over the $covered', ({ bounds }) => {
    const input = floorHeightFixture()
    const before = nativeReviewedFloorHeightBindings(input)
    const option = before.options[0]
    if (!option) throw new Error('Missing original height option')
    input.work.paintBounds = {
      complete: true,
      refusalReason: null,
      events: [
        {
          operationIndex: 10,
          kind: 'vector',
          bounds: { left: 100, top: 100, right: 300, bottom: 300 },
          reason: null,
        },
        ...[102, 103, 104].map((operationIndex) => ({
          operationIndex,
          kind: 'text' as const,
          bounds: null,
          reason: 'text-paint-envelope-unavailable',
        })),
        { operationIndex: 200, kind: 'image', bounds, reason: null },
      ],
    }
    expect(nativeReviewedFloorHeightBindings(input).options).toEqual([])
    const reviewed = {
      ...before.review,
      bindings: [{ floorId: option.floorId, labelId: option.labelId }],
    }
    expect(nativeReviewedFloorHeightBindings({ ...input, reviewed })).toMatchObject({
      status: 'held',
      bindings: [],
      readyFor2D: false,
      readyFor3D: false,
    })
  })
  it('keeps a source H association when later bounded paint is spatially disjoint', () => {
    const input = floorHeightFixture()
    input.work.paintBounds = {
      complete: true,
      refusalReason: null,
      events: [
        {
          operationIndex: 102,
          kind: 'text',
          bounds: null,
          reason: 'text-paint-envelope-unavailable',
        },
        {
          operationIndex: 103,
          kind: 'text',
          bounds: null,
          reason: 'text-paint-envelope-unavailable',
        },
        {
          operationIndex: 104,
          kind: 'text',
          bounds: null,
          reason: 'text-paint-envelope-unavailable',
        },
        {
          operationIndex: 200,
          kind: 'image',
          bounds: { left: 500, top: 500, right: 600, bottom: 600 },
          reason: null,
        },
      ],
    }
    expect(nativeReviewedFloorHeightBindings(input).options).toHaveLength(1)
  })
  it.each(['source', 'rasterSource', 'revision', 'duplicate', 'unknown', 'claimed-height'])(
    'rejects %s input without saved claims',
    (mutation) => {
      const input = floorHeightFixture(),
        result = nativeReviewedFloorHeightBindings(input)
      const option = result.options[0]
      const reviewed = {
        ...result.review,
        bindings: [{ floorId: option?.floorId, labelId: option?.labelId }],
      }
      if (mutation === 'source') reviewed.source.sha256 = 'c'.repeat(64)
      if (mutation === 'rasterSource') reviewed.rasterSource.sha256 = 'c'.repeat(64)
      if (mutation === 'revision') reviewed.floorReviewSavedAt = '2026-10-11T00:00:00.000Z'
      if (mutation === 'duplicate')
        reviewed.bindings.push({ ...reviewed.bindings[0] } as (typeof reviewed.bindings)[number])
      const binding = reviewed.bindings[0]
      if (!binding) throw new Error('Missing synthetic binding')
      if (mutation === 'unknown') binding.labelId = 'native-text-999'
      if (mutation === 'claimed-height') Object.assign(binding, { valueMm: 3000 })
      expect(nativeReviewedFloorHeightBindings({ ...input, reviewed }).status).toBe('held')
    },
  )
  it('requires verified millimetre ink and local reference ink', () => {
    for (const field of ['heightUnitInk', 'heightFloorReferenceInk'] as const) {
      const input = floorHeightFixture()
      delete input.native[field]
      const result = nativeReviewedFloorHeightBindings(input)
      expect(result.options).toEqual([])
    }
  })
  it.each(['duplicate-index', 'missing-baseline', 'duplicate-operation', 'unresolved-ink'])(
    'withholds malformed %s caption evidence',
    (fault) => {
      const input = floorHeightFixture(),
        ink = input.native.heightCaptionInk,
        item = ink?.items[0]
      if (!ink || !item) throw new Error('Missing synthetic ink')
      if (fault === 'duplicate-index') ink.items.push(structuredClone(item))
      if (fault === 'missing-baseline') Object.assign(item, { baselineStart: null })
      if (fault === 'duplicate-operation') Object.assign(item, { operationIndex: -1 })
      if (fault === 'unresolved-ink') {
        ink.items = []
        ink.complete = false
        ink.unresolved = [{ index: 2, reason: 'unverified' }]
      }
      expect(nativeReviewedFloorHeightBindings(input).options).toEqual([])
    },
  )
  it('does not depend on JSON property order for an identical source frame', () => {
    const input = floorHeightFixture(),
      options = nativeReviewedFloorHeightBindings(input)
    const reviewed = {
      ...options.review,
      source: { state: 'existing', pdfPage: 3, sha256: input.reviewedFloors.source.sha256 },
    }
    expect(nativeReviewedFloorHeightBindings({ ...input, reviewed }).refusalReason).toBeNull()
  })
  it.each(['nan-start', 'infinite-end', 'outside-end'])(
    'does not bind a whole H caption with invalid %s baseline evidence',
    (fault) => {
      const input = floorHeightFixture()
      const item = input.native.heightCaptionInk?.items[0]
      if (!item) throw new Error('Missing synthetic height caption')
      item.baselineStart = { ...item.baselineStart }
      if (fault === 'nan-start') item.baselineStart.x = Number.NaN
      if (fault === 'infinite-end') item.baselineEnd.x = Number.POSITIVE_INFINITY
      if (fault === 'outside-end') item.baselineEnd.x = 1001
      const before = structuredClone(input)
      const result = nativeReviewedFloorHeightBindings(input)
      expect(result.refusalReason).toBe('invalid-height-ink-provenance')
      expect(result.options).toEqual([])
      expect(result.bindings).toEqual([])
      expect(result.commonZeroConfirmed).toBe(false)
      expect(result.readyFor3D).toBe(false)
      expect(input).toEqual(before)
    },
  )
  it('does not use caption origins when its whole glyph crosses a floor boundary', () => {
    const input = floorHeightFixture(),
      item = input.native.heightCaptionInk?.items[0]
    if (!item) throw new Error('Missing synthetic caption')
    item.quad = rectangle(150, 180, 350, 190) as typeof item.quad
    item.baselineEnd = { x: 350, y: 190 }
    expect(nativeReviewedFloorHeightBindings(input).options).toEqual([])
  })
  it.each([false, true])(
    'does not bind captions inside a paint hole with perimeter cut=%s',
    (cut) => {
      const input = floorHeightFixture()
      input.work.paths.push({
        operationIndex: 20,
        subpathIndex: 0,
        paint: 'fill',
        closed: true,
        points: rectangle(140, 178, 205, 195),
      })
      if (cut)
        input.work.paths.push({
          operationIndex: 30,
          subpathIndex: 0,
          paint: 'fill',
          closed: true,
          points: [
            { x: 251, y: 80 },
            { x: 310, y: 111 },
            { x: 270, y: 141 },
          ],
        })
      const piece = nativeVisiblePaintRegions(input).regions.find(
        (region) => region.candidateId === 'native-fill-10:0',
      )?.pieces[0]
      if (!piece) throw new Error('Missing punched piece')
      const floor = input.reviewedFloors.floors[0]
      if (!floor) throw new Error('Missing synthetic floor')
      Object.assign(floor, {
        polygon: piece.polygon,
        holes: piece.holes,
        boundaryRoles: piece.polygon.map((_, edgeIndex) => ({ edgeIndex, kind: 'unresolved' })),
      })
      expect(nativePaintedFloorReview({ ...input, reviewed: input.reviewedFloors }).status).toBe(
        'reviewed-draft',
      )
      expect(nativeReviewedFloorHeightBindings(input).options).toEqual([])
    },
  )
  const original =
    'C:/Users/Lenovo/Desktop/Room_project/output/pdf/source-search-20261003/rebrina-original.pdf'
  const reviewPath =
    'C:/Users/Lenovo/Desktop/Room_project/tmp/native-floor-object-binding-20261012/review.json'
  it.skipIf(!existsSync(original) || !existsSync(reviewPath))(
    'replays original Rebrina floor selections and source H captions without physical acceptance',
    async () => {
      const page = await preparePlanPage(await readFile(original), true, 3, true, true)
      const reviewedFloors = JSON.parse(
        await readFile(reviewPath, 'utf8'),
      ) as ReviewedNativePaintedFloors
      if (!page.nativeTextAnchors || !page.linework || !page.lineworkRasterSource)
        throw new Error('Missing original source ink')
      reviewedFloors.rasterSource = page.nativeTextAnchors.source
      const result = nativeReviewedFloorHeightBindings({
        native: page.nativeTextAnchors,
        work: page.linework,
        lineworkSource: page.lineworkRasterSource,
        reviewedFloors,
        floorReviewSavedAt: '2026-10-12T00:00:00.000Z',
      })
      expect(result.refusalReason).toBeNull()
      expect(result.floors).toHaveLength(8)
      expect(result.options.length).toBeGreaterThan(0)
      expect(result.bindings).toEqual([])
      expect(result.readyFor3D).toBe(false)
    },
    120_000,
  )
})
