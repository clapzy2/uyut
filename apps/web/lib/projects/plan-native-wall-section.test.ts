import { describe, expect, it } from 'vitest'
import type { NativeTextAnchors } from './plan-document'
import { nativeWallSectionGaps, type ReviewedNativeWallSection } from './plan-native-wall-section'
import type { PdfLinework, PdfVectorPath } from './plan-pdf-linework'

function fixture() {
  const frame = { sha256: 'a'.repeat(64), page: 1, width: 1000, height: 1000 }
  const source = { sha256: 'b'.repeat(64), pdfPage: 1, state: 'existing' as const }
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
  const stroke = (operationIndex: number, points: PdfVectorPath['points']): PdfVectorPath => ({
    operationIndex,
    subpathIndex: 0,
    paint: 'stroke',
    closed: false,
    points,
  })
  const paths = [
    rect(1, 100, 200),
    rect(2, 300, 450),
    stroke(10, [
      { x: 200, y: 200 },
      { x: 300, y: 200 },
    ]),
    stroke(11, [
      { x: 195, y: 205 },
      { x: 205, y: 195 },
    ]),
    stroke(12, [
      { x: 295, y: 205 },
      { x: 305, y: 195 },
    ]),
  ]
  const work: PdfLinework = {
    coordinateSystem: 'page-0-1000',
    pageWidth: 1000,
    pageHeight: 1000,
    paths,
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
    labels: [
      {
        id: 'native-text-20',
        nativeIndex: 20,
        name: '1000',
        rotation: 0,
        pagePoint: { x: 250, y: 198 },
        point: { x: 250, y: 198 },
      },
    ],
  }
  const reviewed: ReviewedNativeWallSection = {
    review: 'manual-native-wall-section-review',
    source,
    rasterSource: frame,
    axis: 'width',
    at: 200,
    from: 100,
    to: 450,
    walls: paths.slice(0, 2).map((path) => ({
      operationIndex: path.operationIndex,
      subpathIndex: path.subpathIndex,
      polygon: structuredClone(path.points),
    })),
  }
  return { native, work, lineworkSource: frame, reviewed }
}
describe('reviewed source wall section gaps, never invented openings', () => {
  it('does not allow editing returned evidence to mutate native source points', () => {
    const input = fixture(),
      before = structuredClone(input.work)
    const result = nativeWallSectionGaps(input)
    const jamb = result.gaps[0]?.startJambs[0]
    if (!jamb) throw new Error('Missing output jamb')
    jamb.start.x++
    expect(input.work).toEqual(before)
  })
  it('keeps a sloped source jamb and its computed cut without closing the gap', () => {
    const input = fixture(),
      path = input.work.paths[0],
      wall = input.reviewed.walls[0]
    if (!path || !wall) throw new Error('Missing test wall')
    path.points = [
      { x: 100, y: 100 },
      { x: 200, y: 100 },
      { x: 300, y: 300 },
      { x: 100, y: 300 },
    ]
    wall.polygon = structuredClone(path.points)
    const result = nativeWallSectionGaps(input)
    expect(result.refusalReason).toBeNull()
    expect(result.gaps[0]).toMatchObject({
      from: 250,
      to: 300,
      printedWidthMm: null,
      openingKind: null,
    })
    expect(
      result.sectionCrossings.some(
        (entry) =>
          entry.kind === 'computed-source-edge-crossing' && entry.sourceEdge.operationIndex === 1,
      ),
    ).toBe(true)
  })
  it('accepts explicit repeated closure without changing source polygons', () => {
    const input = fixture()
    for (let index = 0; index < 2; index++) {
      const path = input.work.paths[index],
        wall = input.reviewed.walls[index]
      const first = path?.points[0]
      if (!path || !wall || !first) throw new Error('Missing test polygon')
      path.points.push({ ...first })
      wall.polygon = structuredClone(path.points)
    }
    const before = structuredClone(input)
    expect(nativeWallSectionGaps(input).gaps).toHaveLength(1)
    expect(input).toEqual(before)
  })
  it('refuses an interval without a representable interior sample', () => {
    const input = fixture()
    input.reviewed.from = 1
    const edges = [
      [1, 100.00000000000001],
      [100.00000000000003, 450],
    ]
    for (let index = 0; index < 2; index++) {
      const path = input.work.paths[index],
        wall = input.reviewed.walls[index],
        edge = edges[index]
      if (!path || !wall || !edge) throw new Error('Missing numerical test wall')
      const left = edge[0] as number,
        right = edge[1] as number
      path.points = [
        { x: left, y: 100 },
        { x: right, y: 100 },
        { x: right, y: 300 },
        { x: left, y: 300 },
      ]
      wall.polygon = structuredClone(path.points)
    }
    expect(nativeWallSectionGaps(input)).toMatchObject({
      refusalReason: 'unrepresentable-section-interval',
      gaps: [],
    })
  })
  it('finds a bounded gap and exact co-located printed span without closing geometry', () => {
    const input = fixture(),
      before = structuredClone(input)
    const result = nativeWallSectionGaps(input)
    expect(result.refusalReason).toBeNull()
    expect(result.gaps).toHaveLength(1)
    expect(result.gaps[0]).toMatchObject({
      from: 200,
      to: 300,
      boundedByReviewedWalls: true,
      dimensionLabelIds: ['native-text-20'],
      printedWidthMm: 1000,
      openingKind: null,
    })
    expect(result.gaps[0]?.startJambs[0]?.operationIndex).toBe(1)
    expect(result.gaps[0]?.endJambs[0]?.operationIndex).toBe(2)
    expect(result.closesFloorBoundary).toBe(false)
    expect(input).toEqual(before)
  })
  it('does not project the same numeric interval from another transverse plane', () => {
    const input = fixture()
    input.work.paths = input.work.paths.map((path) =>
      path.paint === 'stroke'
        ? { ...path, points: path.points.map((point) => ({ ...point, y: point.y + 150 })) }
        : path,
    )
    const label = input.native.labels[0]
    if (!label) throw new Error('Missing test label')
    label.point.y += 150
    label.pagePoint = { ...label.point }
    expect(nativeWallSectionGaps(input).gaps[0]?.printedWidthMm).toBeNull()
  })
  it('leaves boundary-clipped gaps unbounded and without a printed opening width', () => {
    const input = fixture()
    input.reviewed.from = 50
    const result = nativeWallSectionGaps(input)
    expect(result.gaps).toHaveLength(2)
    expect(result.gaps[0]).toMatchObject({
      from: 50,
      to: 100,
      boundedByReviewedWalls: false,
      printedWidthMm: null,
    })
  })
  it('reports unreviewed fill blockers rather than proving a clear opening', () => {
    const input = fixture()
    input.work.paths.push({
      operationIndex: 99,
      subpathIndex: 0,
      paint: 'fill',
      closed: true,
      points: [
        { x: 230, y: 100 },
        { x: 270, y: 100 },
        { x: 270, y: 300 },
        { x: 230, y: 300 },
      ],
    })
    expect(nativeWallSectionGaps(input).gaps[0]).toMatchObject({
      unknownFillOperations: [99],
      printedWidthMm: null,
    })
  })
  it.each(['snapshot', 'duplicate', 'page', 'stroke', 'compound', 'vertex', 'omission'])(
    'refuses %s evidence without partial gaps',
    (kind) => {
      const input = fixture(),
        wall = input.reviewed.walls[0],
        path = input.work.paths[0]
      if (!wall || !path) throw new Error('Missing test wall')
      const first = wall.polygon[0]
      if (!first) throw new Error('Missing test vertex')
      if (kind === 'snapshot') first.x++
      if (kind === 'duplicate') input.reviewed.walls.push(wall)
      if (kind === 'page') input.reviewed.source.pdfPage = 2
      if (kind === 'stroke') path.paint = 'stroke'
      if (kind === 'compound') input.work.paths.push({ ...path, subpathIndex: 1 })
      if (kind === 'vertex') input.reviewed.at = 100
      if (kind === 'omission') {
        input.work.skippedCurves = 1
        input.work.skippedCurveBounds = [
          { operationIndex: 90, bounds: { left: 200, right: 300, top: 190, bottom: 210 } },
        ]
      }
      const result = nativeWallSectionGaps(input)
      expect(result.refusalReason).not.toBeNull()
      expect(result.gaps).toEqual([])
    },
  )
  it('retains a geometry gap when text is unavailable but does not assign a width', () => {
    const input = fixture()
    input.native.complete = false
    expect(nativeWallSectionGaps(input).gaps[0]).toMatchObject({
      from: 200,
      to: 300,
      printedWidthMm: null,
    })
  })
})
