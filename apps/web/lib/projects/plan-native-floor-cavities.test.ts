import { describe, expect, it } from 'vitest'
import {
  exactNativeDirectionsParallel,
  exactNativeOrientation,
  exactNativePointKey,
  exactNativeSegmentCrossesPolygonInterior,
} from './plan-native-exact-intersections'
import { nativeFloorCavityCandidates } from './plan-native-floor-cavities'
import { nativeReviewPacket } from './plan-native-review-packet'
import type { Bounds, PagePoint, PdfCurvePath, PdfVectorPath } from './plan-pdf-linework'

type Input = Parameters<typeof nativeFloorCavityCandidates>[0]

function path(
  operationIndex: number,
  points: number[][],
  paint: PdfVectorPath['paint'] = 'stroke',
): PdfVectorPath {
  return {
    operationIndex,
    subpathIndex: 0,
    paint,
    closed: true,
    ...(paint === 'stroke' ? {} : { fillColor: '#736a5d' }),
    points: points.map(([x, y]) => ({ x: x as number, y: y as number })),
  }
}

function paintBox(operation: number, left: number, top: number, right: number, bottom: number) {
  return path(
    operation,
    [
      [left, top],
      [right, top],
      [right, bottom],
      [left, bottom],
    ],
    'fill-stroke',
  )
}

function fixture(): Input {
  const source = { sha256: 'a'.repeat(64), page: 1, width: 1000, height: 1000 }
  return {
    native: {
      source,
      originalPdfSha256: 'b'.repeat(64),
      complete: true,
      pageNormalizedScale: { x: 1, y: 1 },
      labels: [],
    },
    lineworkSource: { ...source },
    work: {
      coordinateSystem: 'page-0-1000',
      pageWidth: 1000,
      pageHeight: 1000,
      paths: [
        // Source paint with actual top and bottom gaps. No saved contours, IDs
        // supplied as selectors, fitted room box, or chosen wall-colour input.
        paintBox(1, 90, 90, 100, 320),
        paintBox(2, 300, 90, 310, 320),
        paintBox(3, 100, 90, 140, 100),
        paintBox(4, 260, 90, 300, 100),
        paintBox(5, 100, 300, 160, 320),
        paintBox(6, 240, 300, 300, 320),
        path(10, [
          [140, 90],
          [260, 90],
          [260, 100],
          [255, 100],
          [255, 102],
          [145, 102],
          [145, 100],
          [140, 100],
        ]),
        path(11, [
          [160, 300],
          [240, 300],
          [240, 320],
          [160, 320],
        ]),
        // Six-vertex structural contact outlines, independently painted and
        // backed by complete source paint along the two short frame edges.
        path(12, [
          [100, 300],
          [160, 300],
          [160, 320],
          [155, 320],
          [155, 325],
          [100, 325],
        ]),
        path(13, [
          [240, 300],
          [300, 300],
          [300, 325],
          [245, 325],
          [245, 320],
          [240, 320],
        ]),
      ],
      skippedCurves: 0,
      clippedPaths: 0,
      unsupportedPaths: 0,
      unsupportedContexts: 0,
      truncated: false,
    },
  }
}

function sourcePath(input: Input, operation: number) {
  const found = input.work.paths.find((item) => item.operationIndex === operation)
  if (!found) throw new Error('Missing synthetic source path')
  return found
}

function circle(input: Input, number: number, center: PagePoint = { x: 200, y: 200 }) {
  const radius = 10
  const k = (4 / 3) * Math.tan(Math.PI / 8)
  const points = [
    { x: center.x + radius, y: center.y },
    { x: center.x, y: center.y + radius },
    { x: center.x - radius, y: center.y },
    { x: center.x, y: center.y - radius },
    { x: center.x + radius, y: center.y },
  ]
  input.work.curvePaths ??= []
  const index = input.work.curvePaths.length
  const curve: PdfCurvePath = {
    operationIndex: 100 + index,
    subpathIndex: 0,
    operationSubpathCount: 1,
    paint: 'stroke',
    closed: true,
    start: points[0] as PagePoint,
    segments: points.slice(1).map((end, segmentIndex) => {
      const start = points[segmentIndex] as PagePoint
      return {
        kind: 'cubic',
        control1: { x: start.x - k * (start.y - center.y), y: start.y + k * (start.x - center.x) },
        control2: { x: end.x + k * (end.y - center.y), y: end.y - k * (end.x - center.x) },
        end,
      }
    }),
  }
  input.work.curvePaths.push(curve)
  input.native.labels.push({
    id: `native-text-${index}`,
    nativeIndex: index,
    name: String(number),
    point: { ...center },
    pagePoint: { ...center },
    rotation: 0,
  })
  refreshOmissions(input)
  return curve
}

function refreshOmissions(input: Input) {
  input.work.skippedCurves = input.work.curvePaths?.length ?? 0
  input.work.skippedCurveBounds = (input.work.curvePaths ?? []).map((curve) => {
    const points = [
      curve.start,
      ...curve.segments.flatMap((segment) =>
        segment.kind === 'cubic'
          ? [segment.control1, segment.control2, segment.end]
          : segment.kind === 'quadratic'
            ? [segment.control, segment.end]
            : [segment.end],
      ),
    ]
    return { operationIndex: curve.operationIndex, bounds: bounds(points) }
  })
}

function bounds(points: PagePoint[]): Bounds {
  return {
    left: Math.min(...points.map((point) => point.x)),
    right: Math.max(...points.map((point) => point.x)),
    top: Math.min(...points.map((point) => point.y)),
    bottom: Math.max(...points.map((point) => point.y)),
  }
}

function expectLiteralBoundaryProof(
  input: Input,
  result: ReturnType<typeof nativeFloorCavityCandidates>,
) {
  for (const cavity of result.cavities) {
    expect(cavity.boundaries).toHaveLength(cavity.polygon.length)
    for (const [index, boundary] of cavity.boundaries.entries()) {
      expect(boundary.start).toEqual(cavity.polygon[index])
      expect(boundary.end).toEqual(cavity.polygon[(index + 1) % cavity.polygon.length])
      expect(boundary.supports.length).toBeGreaterThan(0)
      const axis = boundary.start.x === boundary.end.x ? 'y' : 'x'
      const from = Math.min(boundary.start[axis], boundary.end[axis])
      const to = Math.max(boundary.start[axis], boundary.end[axis])
      const intervals: { from: number; to: number }[] = []
      for (const support of boundary.supports) {
        const evidence = sourcePath(input, support.edge.operationIndex)
        expect(evidence.subpathIndex).toBe(support.edge.subpathIndex)
        expect(evidence.points[support.edge.segmentIndex]).toEqual(support.edge.start)
        expect(evidence.points[(support.edge.segmentIndex + 1) % evidence.points.length]).toEqual(
          support.edge.end,
        )
        expect(exactNativeOrientation(boundary.start, boundary.end, support.edge.start)).toBe(0)
        expect(exactNativeOrientation(boundary.start, boundary.end, support.edge.end)).toBe(0)
        intervals.push({
          from: Math.max(from, Math.min(support.edge.start[axis], support.edge.end[axis])),
          to: Math.min(to, Math.max(support.edge.start[axis], support.edge.end[axis])),
        })
      }
      let covered = from
      for (const interval of intervals.sort((a, b) => a.from - b.from)) {
        expect(interval.from).toBeLessThanOrEqual(covered)
        expect(interval.to).toBeGreaterThan(interval.from)
        covered = Math.max(covered, interval.to)
      }
      expect(covered).toBe(to)
    }
  }
}

describe('native painted cavities with documented source opening boundaries', () => {
  it.each([
    { name: 'through the middle', start: [50, 200], end: [350, 200], crosses: true },
    { name: 'through opposite corners', start: [50, 50], end: [350, 350], crosses: true },
    { name: 'tangent to one corner', start: [50, 150], end: [150, 50], crosses: false },
    { name: 'coincident with a boundary', start: [50, 100], end: [350, 100], crosses: false },
    {
      name: 'one billionth outside',
      start: [50, 100 - 1e-9],
      end: [350, 100 - 1e-9],
      crosses: false,
    },
    { name: 'inside despite touching one corner', start: [50, 50], end: [150, 150], crosses: true },
    { name: 'outside', start: [50, 50], end: [350, 50], crosses: false },
  ])('distinguishes source ink $name from a real interior crossing', ({ start, end, crosses }) => {
    const polygon = [
      { x: 100, y: 100 },
      { x: 300, y: 100 },
      { x: 300, y: 300 },
      { x: 100, y: 300 },
    ]
    expect(
      exactNativeSegmentCrossesPolygonInterior(
        {
          start: { x: start[0] as number, y: start[1] as number },
          end: { x: end[0] as number, y: end[1] as number },
        },
        polygon,
      ),
    ).toBe(crosses)
  })

  it('counts a full-width source stroke whose endpoints both lie outside the candidate floor', () => {
    const input = fixture()
    const baseline = nativeFloorCavityCandidates(input).cavities[0]?.unknownInteriorStrokeCount
    const crossing = path(30, [
      [50, 200],
      [350, 200],
    ])
    crossing.closed = false
    input.work.paths.push(crossing)
    const result = nativeFloorCavityCandidates(input)
    expect(result.cavities[0]?.unknownInteriorStrokeCount).toBe((baseline ?? 0) + 1)
    expect(result.readyFor2D).toBe(false)
    expect(result.readyFor3D).toBe(false)
  })

  it.each([
    [
      [50, 150],
      [150, 50],
    ],
    [
      [50, 100],
      [350, 100],
    ],
    [
      [50, 50],
      [350, 50],
    ],
  ])('does not report border-only or outside source ink as interior', (start, end) => {
    const input = fixture()
    const baseline = nativeFloorCavityCandidates(input).cavities[0]?.unknownInteriorStrokeCount
    const stroke = path(30, [start, end])
    stroke.closed = false
    input.work.paths.push(stroke)
    expect(nativeFloorCavityCandidates(input).cavities[0]?.unknownInteriorStrokeCount).toBe(
      baseline,
    )
  })

  it('proves opposed diagonal profile contacts without changing the source paths', () => {
    const input = fixture()
    for (const path of input.work.paths) {
      path.points = path.points.map(({ x, y }) => ({
        x: 500 + (3 * x - 4 * y) / 5,
        y: (4 * x + 3 * y) / 5,
      }))
    }
    const before = structuredClone(input)
    const result = nativeFloorCavityCandidates(input)
    expect(result.closures).toHaveLength(1)
    expect(result.thresholds).toHaveLength(1)
    expect(result.cavities).toHaveLength(1)
    expectLiteralBoundaryProof(input, result)
    expect(result.readyFor2D).toBe(false)
    expect(result.readyFor3D).toBe(false)
    expect(input).toEqual(before)
  })

  it('distinguishes parallel diagonal source directions from nearby and zero directions', () => {
    const first = { start: { x: 10, y: 10 }, end: { x: 40, y: 50 } }
    const second = { start: { x: 110, y: 110 }, end: { x: 80, y: 70 } }
    expect(exactNativeDirectionsParallel(first, second)).toBe(true)
    expect(
      exactNativeDirectionsParallel(first, {
        ...second,
        end: { ...second.end, x: second.end.x + 1e-9 },
      }),
    ).toBe(false)
    expect(exactNativeDirectionsParallel(first, { start: first.start, end: first.start })).toBe(
      false,
    )
    expect(
      exactNativeDirectionsParallel(first, {
        ...second,
        end: { x: Number.NaN, y: 70 },
      }),
    ).toBeNull()
  })

  it('assembles one source-backed negative-space cell without a saved contour or selected colour', () => {
    const input = fixture()
    circle(input, 1)
    const result = nativeFloorCavityCandidates(input)
    expect(result.status).toBe('draft')
    expect(result.refusalReason).toBeNull()
    expect(result.thresholds).toHaveLength(1)
    expect(result.closures).toHaveLength(1)
    expect(result.cavities).toHaveLength(1)
    expect(result.cavities[0]).toMatchObject({
      paintColor: '#736a5d',
      markerLabelIds: ['native-text-0'],
      markerStatus: 'unambiguous',
      omittedBoundaryInkCount: 0,
    })
    expect(bounds(result.cavities[0]?.polygon ?? [])).toEqual({
      left: 100,
      top: 100,
      right: 300,
      bottom: 300,
    })
    expectLiteralBoundaryProof(input, result)
    expect(result).toMatchObject({
      readOnly: true,
      completeFloorInventory: false,
      roomOwnershipConfirmed: false,
      physicalPassagesAccepted: false,
      readyFor2D: false,
      readyFor3D: false,
    })
    for (const key of ['reading', 'pageReview', 'geometry', 'footprint', 'floorAreaM2'])
      expect(result).not.toHaveProperty(key)
  })

  it('does not snap a positive 1e-9 paint/profile contact gap closed', () => {
    const input = fixture()
    for (const point of sourcePath(input, 3).points) if (point.x === 140) point.x -= 1e-9
    const result = nativeFloorCavityCandidates(input)
    expect(result.closures).toEqual([])
    expect(result.cavities).toEqual([])
  })

  it('requires complete paint coverage across both actual frame jamb spans', () => {
    const input = fixture()
    for (const point of sourcePath(input, 5).points) if (point.y === 320) point.y -= 1e-9
    const result = nativeFloorCavityCandidates(input)
    expect(result.thresholds).toEqual([])
    expect(result.cavities).toEqual([])
  })

  it('cannot invent a threshold where one complex source jamb outline is absent', () => {
    const input = fixture()
    input.work.paths = input.work.paths.filter((item) => item.operationIndex !== 12)
    expect(nativeFloorCavityCandidates(input).thresholds).toEqual([])
    expect(nativeFloorCavityCandidates(input).cavities).toEqual([])
  })

  it('rejects two positive contacts from two paint operations on the same profile side', () => {
    const input = fixture()
    input.work.paths = input.work.paths.filter((item) => ![3, 4].includes(item.operationIndex))
    input.work.paths.push(paintBox(3, 100, 90, 140, 95), paintBox(14, 100, 95, 140, 100))
    const result = nativeFloorCavityCandidates(input)
    expect(result.closures).toEqual([])
    expect(result.cavities).toEqual([])
  })

  it('requires two independent paint operations, not two subpaths of one compound operation', () => {
    const input = fixture()
    const right = sourcePath(input, 4)
    right.operationIndex = 3
    right.subpathIndex = 1
    expect(nativeFloorCavityCandidates(input).closures).toEqual([])
  })

  it('preserves exact source repaint aliases without duplicating a profile closure', () => {
    const input = fixture()
    input.work.paths.push({ ...structuredClone(sourcePath(input, 10)), operationIndex: 40 })
    const result = nativeFloorCavityCandidates(input)
    expect(result.closures).toHaveLength(1)
    expect(result.cavities).toHaveLength(1)
    expectLiteralBoundaryProof(input, result)
  })

  it('does not choose a paint colour when the same closures have competing colour support', () => {
    const input = fixture()
    input.work.paths.push(
      ...input.work.paths
        .filter((item) => item.paint !== 'stroke')
        .map((item) => ({
          ...structuredClone(item),
          operationIndex: item.operationIndex + 30,
          fillColor: '#a3512e',
        })),
    )
    const result = nativeFloorCavityCandidates(input)
    expect(result.closures).toHaveLength(1)
    expect(result.closures[0]?.paintColors).toEqual(['#736a5d', '#a3512e'])
    expect(result.thresholds[0]?.paintColors).toEqual(['#736a5d', '#a3512e'])
    expect(result.cavities).toEqual([])
  })

  it('retains an actual closed suffix and its unused prefix without flipping path.closed', () => {
    const input = fixture()
    const profile = sourcePath(input, 10)
    const first = profile.points[0]
    if (!first) throw new Error('Missing fixture profile')
    profile.points = [{ x: 120, y: 90 }, ...profile.points, { ...first }]
    profile.closed = false
    const before = structuredClone(input)
    const result = nativeFloorCavityCandidates(input)
    expect(result.cavities).toHaveLength(1)
    expect(result.closures[0]).toMatchObject({
      sourceKind: 'literal-closed-run',
      remainingSegments: [{ operationIndex: 10, segmentIndex: 0 }],
    })
    expectLiteralBoundaryProof(input, result)
    expect(input).toEqual(before)
  })

  it('withholds an overlapping compound paint bar instead of guessing its fill rule', () => {
    const input = fixture()
    input.work.paths.push({ ...paintBox(3, 110, 90, 140, 100), subpathIndex: 1 })
    const result = nativeFloorCavityCandidates(input)
    expect(result.cavities).toEqual([])
    expect(result.closures).toEqual([])
  })

  it('does not drop a disconnected paint island inside a simple emitted cavity', () => {
    const input = fixture()
    input.work.paths.push(paintBox(30, 180, 180, 220, 220))
    const result = nativeFloorCavityCandidates(input)
    // The simple-polygon output cannot encode this occupied island as a hole.
    expect(result.cavities).toEqual([])
    expect(result.unprovedCavityCount).toBeGreaterThan(0)
    expect(result.unprovedCavities).toContainEqual(
      expect.objectContaining({ reason: 'nested-painted-island', vertexCount: 8 }),
    )
  })

  it('withholds a cavity intersecting unresolved compound paint instead of erasing that interior ink', () => {
    const input = fixture()
    input.work.paths.push(paintBox(30, 180, 180, 220, 220), {
      ...paintBox(30, 190, 190, 230, 230),
      subpathIndex: 1,
    })
    const before = structuredClone(input)
    const result = nativeFloorCavityCandidates(input)
    expect(result.cavities).toEqual([])
    expect(result.unprovedCavities).toContainEqual(
      expect.objectContaining({ reason: 'unresolved-paint-topology' }),
    )
    expect(input).toEqual(before)
    expect(result.completeFloorInventory).toBe(false)
  })

  it('preserves a rejected thin raw cavity rather than silently deleting a source sliver', () => {
    const input = fixture()
    input.work.paths.push(
      paintBox(30, 490, 490, 500, 510),
      paintBox(31, 501, 490, 511, 510),
      paintBox(32, 500, 490, 501, 500),
      paintBox(33, 500, 500.0001, 501, 510),
    )
    const result = nativeFloorCavityCandidates(input)
    expect(result.cavities).toHaveLength(1)
    expect(result.unprovedCavityCount).toBe(1)
    expect(result.unprovedCavities).toEqual([
      expect.objectContaining({
        reason: 'unsupported-cavity-polygon',
        vertexCount: 4,
        bounds: { left: 500, top: 500, right: 501, bottom: 500.0001 },
        polygon: expect.any(Array),
      }),
    ])
  })

  it('keeps unmarked source cavities rather than deleting them to match printed room counts', () => {
    const result = nativeFloorCavityCandidates(fixture())
    expect(result.cavities).toHaveLength(1)
    expect(result.cavities[0]).toMatchObject({ markerStatus: 'unmarked', markerLabelIds: [] })
    expect(result.completeFloorInventory).toBe(false)
  })

  it('retains both source markers in one joint cell without inventing a separating wall', () => {
    const input = fixture()
    circle(input, 1, { x: 170, y: 200 })
    circle(input, 5, { x: 230, y: 200 })
    const result = nativeFloorCavityCandidates(input)
    expect(result.cavities).toHaveLength(1)
    expect(result.cavities[0]).toMatchObject({
      markerStatus: 'unambiguous',
      markerLabelIds: ['native-text-0', 'native-text-1'],
    })
    expect(result.roomOwnershipConfirmed).toBe(false)
  })

  it('marks repeated source numbers ambiguous even when both circles lie in the same cell', () => {
    const input = fixture()
    circle(input, 1, { x: 170, y: 200 })
    circle(input, 1, { x: 230, y: 200 })
    expect(nativeFloorCavityCandidates(input).cavities[0]?.markerStatus).toBe('ambiguous')
  })

  it('does not attach the outboard number 8 by proximity or by matching printed area', () => {
    const input = fixture()
    circle(input, 8, { x: 340, y: 200 })
    const result = nativeFloorCavityCandidates(input)
    expect(result.cavities[0]).toMatchObject({ markerStatus: 'unmarked', markerLabelIds: [] })
    expect(result.unresolvedMarkerLabelIds).toEqual(['native-text-0'])
  })

  it('checks original cubic control hull, not the label baseline or fitted-circle box', () => {
    const input = fixture()
    const cue = circle(input, 1, { x: 289.999, y: 200 })
    const segment = cue.segments[0]
    if (segment?.kind !== 'cubic') throw new Error('Missing fixture cubic')
    segment.control1.x = 300.001
    refreshOmissions(input)
    const result = nativeFloorCavityCandidates(input)
    expect(result.markersAvailable).toBe(true)
    expect(result.cavities[0]?.markerLabelIds).toEqual([])
    expect(result.unresolvedMarkerLabelIds).toEqual(['native-text-0'])
  })

  it('keeps annotation strokes, original curves and their omission counts inside a candidate', () => {
    const input = fixture()
    circle(input, 1)
    const annotation = path(30, [
      [150, 150],
      [170, 155],
    ])
    annotation.closed = false
    input.work.paths.push(annotation)
    const before = structuredClone(input)
    const result = nativeFloorCavityCandidates(input)
    expect(result.cavities).toHaveLength(1)
    expect(result.cavities[0]?.unknownInteriorStrokeCount).toBeGreaterThan(0)
    expect(input.work.skippedCurves).toBe(1)
    expect(input.work.curvePaths).toHaveLength(1)
    expect(input).toEqual(before)
    expect(result.physicalPassagesAccepted).toBe(false)
  })

  it('binds an outboard number by one actual source leader without altering the cavity', () => {
    const input = fixture()
    const unmarked = nativeFloorCavityCandidates(input).cavities[0]
    circle(input, 8, { x: 400, y: 200 })
    input.work.paths.push({
      ...path(50, [
        [200, 200],
        [391, 200],
      ]),
      closed: false,
    })
    const before = structuredClone(input)
    const result = nativeFloorCavityCandidates(input)
    expect(result.cavities[0]?.polygon).toEqual(unmarked?.polygon)
    expect(result.cavities[0]).toMatchObject({
      markerLabelIds: ['native-text-0'],
      markerStatus: 'unambiguous',
    })
    expect(result.markerLeaders).toHaveLength(1)
    expect(result.markerLeaders[0]).toMatchObject({
      labelId: 'native-text-0',
      cavityId: result.cavities[0]?.id,
      circleEndpoint: 'end',
    })
    expect(result.unresolvedMarkerLabelIds).toEqual([])
    expect(result.roomOwnershipConfirmed).toBe(false)
    expect(result.physicalPassagesAccepted).toBe(false)
    expect(result.readyFor2D).toBe(false)
    expect(result.readyFor3D).toBe(false)
    const packet = nativeReviewPacket({
      ...input,
      source: { sha256: input.native.originalPdfSha256 as string, pdfPage: 1, state: 'existing' },
      image: input.native.source,
    })
    expect(packet.floorCavities?.markerLeaders).toEqual([
      {
        labelId: 'native-text-0',
        cavityId: result.cavities[0]?.id,
        circleEndpoint: 'end',
        segment: {
          operationIndex: 50,
          subpathIndex: 0,
          segmentIndex: 0,
          start: { x: 200, y: 200 },
          end: { x: 391, y: 200 },
        },
      },
    ])
    expect(packet.floorCavities?.markerLeaders?.[0]).not.toHaveProperty('proof')
    expect(packet.readiness.readyFor2D).toBe(false)
    expect(input).toEqual(before)
  })

  it('keeps competing source leaders unresolved and does not lose the unmarked floor', () => {
    const input = fixture()
    circle(input, 8, { x: 400, y: 200 })
    input.work.paths.push(
      {
        ...path(50, [
          [200, 200],
          [391, 200],
        ]),
        closed: false,
      },
      {
        ...path(51, [
          [210, 200],
          [392, 200],
        ]),
        closed: false,
      },
    )
    const result = nativeFloorCavityCandidates(input)
    expect(result.cavities).toHaveLength(1)
    expect(result.cavities[0]).toMatchObject({ markerLabelIds: [], markerStatus: 'unmarked' })
    expect(result.markerLeaders).toEqual([])
    expect(result.markerLeaderIssues).toHaveLength(1)
    expect(result.unresolvedMarkerLabelIds).toEqual(['native-text-0'])
  })

  it('retains repeated source numbers as ambiguous even when one uses a leader', () => {
    const input = fixture()
    circle(input, 8, { x: 400, y: 200 })
    circle(input, 8, { x: 200, y: 250 })
    input.work.paths.push({
      ...path(50, [
        [200, 200],
        [391, 200],
      ]),
      closed: false,
    })
    const result = nativeFloorCavityCandidates(input)
    expect(result.cavities[0]).toMatchObject({
      markerLabelIds: ['native-text-1', 'native-text-0'],
      markerStatus: 'ambiguous',
    })
    expect(result.markerLeaders).toHaveLength(1)
    expect(result.roomOwnershipConfirmed).toBe(false)
  })

  it('records omitted boundary ink without silently repairing or deleting its source count', () => {
    const input = fixture()
    input.work.skippedCurves = 1
    input.work.skippedCurveBounds = [
      { operationIndex: 50, bounds: { left: 95, top: 180, right: 105, bottom: 190 } },
    ]
    const result = nativeFloorCavityCandidates(input)
    expect(result.cavities).toHaveLength(1)
    expect(result.cavities[0]?.omittedBoundaryInkCount).toBe(1)
    expect(result.cavities[0]?.markerStatus).toBe('unavailable')
    expect(result.completeFloorInventory).toBe(false)
    expect(input.work.skippedCurves).toBe(1)
  })

  it('does not use a partial command inventory as a unique marker proof', () => {
    const input = fixture()
    circle(input, 1)
    circle(input, 5, { x: 240, y: 200 })
    input.work.curvePaths?.pop()
    const result = nativeFloorCavityCandidates(input)
    expect(result.cavities).toHaveLength(1)
    expect(result.markersAvailable).toBe(false)
    expect(result.cavities[0]).toMatchObject({ markerStatus: 'unavailable', markerLabelIds: [] })
  })

  it.each(['hash', 'page', 'scale', 'duplicate-ref', 'unsupported-layer'] as const)(
    'withholds the whole candidate inventory after %s source failure',
    (failure) => {
      const input = fixture()
      if (failure === 'hash') input.lineworkSource.sha256 = 'c'.repeat(64)
      if (failure === 'page') input.lineworkSource.page = 2
      if (failure === 'scale') delete input.native.pageNormalizedScale
      if (failure === 'duplicate-ref') input.work.paths.push(structuredClone(sourcePath(input, 1)))
      if (failure === 'unsupported-layer') input.work.unsupportedContexts = 1
      const result = nativeFloorCavityCandidates(input)
      expect(result.status).toBe('unresolved')
      expect(result.cavities).toEqual([])
      expect(result.thresholds).toEqual([])
      expect(result.closures).toEqual([])
    },
  )

  it('refuses oversized source paths atomically rather than returning earlier floor cells', () => {
    const input = fixture()
    input.work.paths = Array.from({ length: 3001 }, (_, index) => ({
      ...path(index, [
        [1, 1],
        [2, 2],
      ]),
      closed: false,
    }))
    const result = nativeFloorCavityCandidates(input)
    expect(result.status).toBe('unresolved')
    expect(result.cavities).toEqual([])
    expect(result.thresholds).toEqual([])
  })

  it('keeps source snapshots immutable and detaches polygon, edge and closure output', () => {
    const input = fixture()
    const before = structuredClone(input)
    const result = nativeFloorCavityCandidates(input)
    const cell = result.cavities[0]
    const closure = result.closures[0]
    if (!cell || !closure) throw new Error('Missing fixture cavity')
    const corner = cell.polygon[0]
    const support = cell.boundaries[0]?.supports[0]
    if (corner) corner.x = 999
    if (support) support.edge.start.x = 999
    if (closure.polygon[0]) closure.polygon[0].x = 999
    expect(input).toEqual(before)
    expect(exactNativePointKey(sourcePath(input, 10).points[0] as PagePoint)).not.toBeNull()
  })

  it('publishes fresh source-frame side correspondence separately from accepted floor geometry', () => {
    const input = fixture()
    const before = structuredClone(input)
    const packet = nativeReviewPacket({
      ...input,
      source: { sha256: input.native.originalPdfSha256 as string, pdfPage: 1, state: 'existing' },
      image: input.native.source,
    })
    expect(packet.floorOpeningSides).toMatchObject({ status: 'draft', refusalReason: null })
    const frame = packet.floorOpeningSides?.frames[0]
    expect(frame).toMatchObject({ status: 'one-sided', reason: 'unobserved-opposite-cavity' })
    expect(frame?.sides.flatMap((side) => side.contacts)).toHaveLength(1)
    expect(frame?.sides.flatMap((side) => side.contacts)[0]?.cavityId).toBe(
      packet.floorCavities?.candidates[0]?.id,
    )
    expect(packet.floorOpeningSides).not.toHaveProperty('physicalPassagesAccepted')
    expect(packet).not.toHaveProperty('geometry')
    expect(packet.readiness).toEqual({ readOnly: true, readyFor2D: false, readyFor3D: false })
    expect(input).toEqual(before)
  })
})
