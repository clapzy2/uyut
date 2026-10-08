import { describe, expect, it } from 'vitest'
import type { NativeTextAnchors } from './plan-document'
import {
  type ReviewedNativeOpeningKinds,
  reviewedNativeOpeningKinds,
} from './plan-native-opening-kind-review'
import { nativeWallSectionGaps, type ReviewedNativeWallSection } from './plan-native-wall-section'
import type { PdfLinework, PdfVectorPath } from './plan-pdf-linework'

function fixture(kind: 'door' | 'window' = 'window') {
  const frame = { sha256: 'a'.repeat(64), page: 1, width: 1000, height: 1000 },
    source = { sha256: 'b'.repeat(64), pdfPage: 1, state: 'existing' as const }
  const rect = (operationIndex: number, left: number, right: number): PdfVectorPath => ({
    operationIndex,
    subpathIndex: 0,
    paint: 'fill',
    closed: true,
    points: [
      { x: left, y: 100 },
      { x: right, y: 100 },
      { x: right, y: 300 },
      { x: left, y: 300 },
    ],
  })
  const walls = [rect(1, 100, 200), rect(2, 300, 450)]
  const symbol: PdfVectorPath =
    kind === 'window'
      ? rect(99, 200, 300)
      : {
          operationIndex: 99,
          subpathIndex: 0,
          paint: 'stroke',
          closed: false,
          points: [
            { x: 200, y: 100 },
            { x: 200, y: 300 },
            { x: 300, y: 300 },
          ],
        }
  const work: PdfLinework = {
    coordinateSystem: 'page-0-1000',
    pageWidth: 1000,
    pageHeight: 1000,
    paths: [...walls, symbol],
    skippedCurves: 0,
    clippedPaths: 0,
    unsupportedPaths: 0,
    unsupportedContexts: 0,
    truncated: false,
  }
  const native: NativeTextAnchors = {
    source: frame,
    originalPdfSha256: source.sha256,
    complete: true,
    pageNormalizedScale: { x: 1, y: 1 },
    labels: [],
  }
  const section: ReviewedNativeWallSection = {
    review: 'manual-native-wall-section-review',
    source,
    rasterSource: frame,
    axis: 'width',
    at: 200,
    from: 100,
    to: 450,
    walls: walls.map((path) => ({
      operationIndex: path.operationIndex,
      subpathIndex: 0,
      polygon: structuredClone(path.points),
    })),
  }
  const gap = nativeWallSectionGaps({ native, work, lineworkSource: frame, reviewed: section })
    .gaps[0]
  if (!gap) throw new Error('Missing fixture gap')
  const reviewed: ReviewedNativeOpeningKinds = {
    review: 'manual-native-opening-kind-review',
    section,
    items: [
      { id: 'opening-1', kind, gap: structuredClone(gap), symbols: [structuredClone(symbol)] },
    ],
  }
  return { native, work, lineworkSource: frame, reviewed }
}
describe('source-reviewed opening kinds, not certified passages', () => {
  it.each([undefined, NaN])(
    'does not coerce incomplete or invalid nullable width %s into null',
    (value) => {
      const input = fixture(),
        item = input.reviewed.items[0]
      if (!item) throw new Error('Missing test review')
      item.gap.printedWidthMm = value as number
      expect(reviewedNativeOpeningKinds(input)).toMatchObject({
        status: 'unresolved',
        bindings: [],
      })
    },
  )
  it('supports a depth-axis source review', () => {
    const input = fixture()
    input.work.paths = input.work.paths.map((path) => ({
      ...path,
      points: path.points.map((point) => ({ x: point.y, y: point.x })),
    }))
    input.reviewed.section.axis = 'depth'
    input.reviewed.section.walls = input.reviewed.section.walls.map((wall) => ({
      ...wall,
      polygon: wall.polygon.map((point) => ({ x: point.y, y: point.x })),
    }))
    const item = input.reviewed.items[0],
      symbol = input.work.paths[2]
    const gap = nativeWallSectionGaps({ ...input, reviewed: input.reviewed.section }).gaps[0]
    if (!item || !symbol || !gap) throw new Error('Missing transformed fixture')
    item.gap = gap
    item.symbols = [structuredClone(symbol)]
    expect(reviewedNativeOpeningKinds(input).status).toBe('draft')
  })
  it.each(['paint', 'closed', 'ref', 'jamb'])('rejects a changed %s snapshot', (change) => {
    const input = fixture(),
      item = input.reviewed.items[0],
      symbol = item?.symbols[0],
      jamb = item?.gap.startJambs[0]
    if (!item || !symbol || !jamb) throw new Error('Missing fixture evidence')
    if (change === 'paint') symbol.paint = 'stroke'
    if (change === 'closed') symbol.closed = false
    if (change === 'ref') symbol.subpathIndex = 1
    if (change === 'jamb') jamb.operationIndex++
    expect(reviewedNativeOpeningKinds(input)).toMatchObject({ status: 'unresolved', bindings: [] })
  })
  it.each(['outside', 'short', 'unattached'])(
    'refuses a freshly reviewed but invalid %s symbol',
    (change) => {
      const input = fixture(change === 'unattached' ? 'door' : 'window'),
        item = input.reviewed.items[0],
        symbol = input.work.paths[2]
      if (!item || !symbol) throw new Error('Missing fixture symbol')
      if (change === 'outside')
        symbol.points = symbol.points.map((point) => ({ ...point, x: point.x - 1 }))
      if (change === 'short')
        symbol.points = symbol.points.map((point) => ({
          ...point,
          x: point.x === 300 ? 290 : point.x,
        }))
      if (change === 'unattached')
        symbol.points = [
          { x: 200, y: 150 },
          { x: 300, y: 250 },
        ]
      const gap = nativeWallSectionGaps({ ...input, reviewed: input.reviewed.section }).gaps[0]
      if (!gap) throw new Error('Missing fresh gap')
      item.gap = gap
      item.symbols = [structuredClone(symbol)]
      expect(reviewedNativeOpeningKinds(input).status).toBe('unresolved')
    },
  )
  it('rejects the whole batch when a later distinct opening has stale symbols', () => {
    const input = fixture(),
      item = input.reviewed.items[0]
    if (!item) throw new Error('Missing first item')
    const wall: PdfVectorPath = {
      operationIndex: 3,
      subpathIndex: 0,
      paint: 'fill',
      closed: true,
      points: [
        { x: 550, y: 100 },
        { x: 650, y: 100 },
        { x: 650, y: 300 },
        { x: 550, y: 300 },
      ],
    }
    const symbol: PdfVectorPath = {
      operationIndex: 100,
      subpathIndex: 0,
      paint: 'fill',
      closed: true,
      points: [
        { x: 450, y: 100 },
        { x: 550, y: 100 },
        { x: 550, y: 300 },
        { x: 450, y: 300 },
      ],
    }
    input.work.paths.push(wall, symbol)
    input.reviewed.section.to = 650
    input.reviewed.section.walls.push({
      operationIndex: 3,
      subpathIndex: 0,
      polygon: structuredClone(wall.points),
    })
    const gaps = nativeWallSectionGaps({ ...input, reviewed: input.reviewed.section }).gaps
    const gap = gaps[1]
    if (!gap) throw new Error('Missing second gap')
    const stale = structuredClone(symbol),
      point = stale.points[0]
    if (!point) throw new Error('Missing second symbol point')
    point.x++
    input.reviewed.items.push({ id: 'opening-2', kind: 'window', gap, symbols: [stale] })
    expect(reviewedNativeOpeningKinds(input)).toMatchObject({ status: 'unresolved', bindings: [] })
  })
  it.each(['window', 'door'] as const)(
    'binds %s while preserving blockers and disallowing physical passage',
    (kind) => {
      const input = fixture(kind),
        before = structuredClone(input)
      const result = reviewedNativeOpeningKinds(input)
      if (result.status !== 'draft') throw new Error(result.reason)
      expect(result.bindings[0]?.sourceReviewedKind).toBe(kind)
      expect(result.bindings[0]?.physicalPassageAccepted).toBe(false)
      expect(result.bindings[0]?.gap.openingKind).toBeNull()
      expect(result.bindings[0]?.gap.unknownFillOperations).toEqual(kind === 'window' ? [99] : [])
      expect(result.closesFloorBoundary).toBe(false)
      expect(result.completeOpeningInventory).toBe(false)
      expect(input).toEqual(before)
    },
  )
  it('leaves an unreviewed gap untyped', () => {
    const input = fixture()
    input.reviewed.items = []
    const result = reviewedNativeOpeningKinds(input)
    if (result.status !== 'draft') throw new Error(result.reason)
    expect(result.bindings).toEqual([])
    expect(result.unreviewedGaps).toHaveLength(1)
  })
  it.each(['point', 'unknown-fill', 'dimension', 'symbol', 'kind', 'duplicate', 'page'])(
    'rejects stale/conflicting %s review atomically',
    (change) => {
      const input = fixture(),
        item = input.reviewed.items[0]
      if (!item) throw new Error('Missing test item')
      if (change === 'point') item.gap.start.x++
      if (change === 'unknown-fill') item.gap.unknownFillOperations = []
      if (change === 'dimension') item.gap.printedWidthMm = 1000
      if (change === 'symbol') {
        const point = item.symbols[0]?.points[0]
        if (!point) throw new Error('Missing test symbol point')
        point.x++
      }
      if (change === 'kind') item.kind = 'arch' as 'door'
      if (change === 'duplicate') input.reviewed.items.push({ ...item, id: 'opening-2' })
      if (change === 'page') input.reviewed.section.source.pdfPage = 2
      expect(reviewedNativeOpeningKinds(input)).toMatchObject({
        status: 'unresolved',
        bindings: [],
      })
    },
  )
  it('rejects a selected wall body used as an opening symbol', () => {
    const input = fixture(),
      item = input.reviewed.items[0],
      wall = input.work.paths[0]
    if (!item || !wall) throw new Error('Missing test evidence')
    item.symbols = [structuredClone(wall)]
    expect(reviewedNativeOpeningKinds(input)).toMatchObject({
      reason: 'opening-symbol-wall-role-conflict',
      bindings: [],
    })
  })
  it('rejects a door symbol away from the section even if it touches a jamb endpoint', () => {
    const input = fixture('door'),
      symbol = input.work.paths[2],
      item = input.reviewed.items[0]
    if (!symbol || !item) throw new Error('Missing test symbol')
    symbol.points = [
      { x: 200, y: 300 },
      { x: 300, y: 300 },
    ]
    item.symbols = [structuredClone(symbol)]
    expect(reviewedNativeOpeningKinds(input).status).toBe('unresolved')
  })
  it('rejects a partial symbol with an omitted curve from the same native operation', () => {
    const input = fixture()
    input.work.skippedCurves = 1
    input.work.skippedCurveBounds = [
      { operationIndex: 99, bounds: { left: 200, right: 300, top: 500, bottom: 550 } },
    ]
    expect(reviewedNativeOpeningKinds(input)).toMatchObject({
      reason: 'stale-or-compound-opening-symbol',
      bindings: [],
    })
  })
  it('clones output symbols to prevent edits to the native source', () => {
    const input = fixture(),
      before = structuredClone(input.work)
    const result = reviewedNativeOpeningKinds(input)
    if (result.status !== 'draft') throw new Error(result.reason)
    const point = result.bindings[0]?.symbols[0]?.points[0]
    if (!point) throw new Error('Missing output point')
    point.x++
    expect(input.work).toEqual(before)
  })
})
