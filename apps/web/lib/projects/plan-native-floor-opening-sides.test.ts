import { describe, expect, it } from 'vitest'
import { exactNativeOrientation } from './plan-native-exact-intersections'
import { nativeFloorCavityCandidates } from './plan-native-floor-cavities'
import { nativeFloorOpeningSides } from './plan-native-floor-opening-sides'
import { nativeOpeningSourceLinks } from './plan-native-opening-links'
import type { PagePoint, PdfVectorPath } from './plan-pdf-linework'
import type { NativePageSegment } from './plan-pdf-opening-endpoint'

type Floor = Parameters<typeof nativeFloorOpeningSides>[0]
type Links = Parameters<typeof nativeFloorOpeningSides>[1]
type Input = { floor: Floor; links: Links }
type Cell = Floor['cavities'][number]
type Frame = Links['openingFrames']['candidates'][number]
const COLOR = '#736a5d'

function sourceFrame(id = 'source-frame', operationIndex = 20): Frame {
  const frame: PdfVectorPath = {
    operationIndex,
    subpathIndex: 0,
    paint: 'stroke',
    closed: true,
    points: [
      { x: 180, y: 100 },
      { x: 220, y: 100 },
      { x: 220, y: 110 },
      { x: 180, y: 110 },
    ],
  }
  return {
    id,
    frame,
    repaintAliases: [],
    longEdges: [],
    jambs: [],
    unresolvedInk: [],
    openingKind: null,
    semanticStatus: 'unclassified',
    physicalPassageAccepted: false,
    closesFloorBoundary: false,
  }
}
function rectangle(left: number, top: number, right: number, bottom: number): PagePoint[] {
  return [
    { x: left, y: top },
    { x: right, y: top },
    { x: right, y: bottom },
    { x: left, y: bottom },
  ]
}
function cavity(id: string, polygon: PagePoint[]): Cell {
  return {
    id,
    polygon,
    boundaries: [],
    paintColor: COLOR,
    markerLabelIds: [],
    markerStatus: 'unmarked',
    closureIds: [],
    unknownInteriorStrokeCount: 0,
    omittedBoundaryInkCount: 0,
  }
}
function fixture(): Input {
  const source = { sha256: 'a'.repeat(64), page: 1, width: 1000, height: 1000 }
  const common: Parameters<typeof nativeFloorCavityCandidates>[0] = {
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
      paths: [],
      skippedCurves: 0,
      clippedPaths: 0,
      unsupportedPaths: 0,
      unsupportedContexts: 0,
      truncated: false,
    },
  }
  // The producer establishes the current source/result envelope. The small typed
  // cells below isolate side correspondence without selecting a saved room review.
  const floor = nativeFloorCavityCandidates(common)
  const links = nativeOpeningSourceLinks(common)
  floor.cavities = [
    cavity('upper', rectangle(150, 50, 250, 100)),
    cavity('lower', rectangle(150, 110, 250, 160)),
  ]
  links.openingFrames.candidates = [sourceFrame()]
  const input = { floor, links }
  rebuild(input)
  return input
}
function frameOf(input: Input, index = 0): Frame {
  const frame = input.links.openingFrames.candidates[index]
  if (!frame) throw new Error('Missing source frame')
  return frame
}
function cellOf(input: Input, id: string): Cell {
  const cell = input.floor.cavities.find((cell) => cell.id === id)
  if (!cell) throw new Error('Missing source cavity')
  return cell
}
function sourceEdges(path: PdfVectorPath): NativePageSegment[] {
  return path.points.map((start, segmentIndex) => ({
    operationIndex: path.operationIndex,
    subpathIndex: path.subpathIndex,
    segmentIndex,
    start,
    end: path.points[(segmentIndex + 1) % path.points.length] as PagePoint,
  }))
}
function rebuild(input: Input) {
  for (const frame of input.links.openingFrames.candidates) {
    const edges = sourceEdges(frame.frame)
    const length = (edge: NativePageSegment) =>
      Math.hypot(edge.end.x - edge.start.x, edge.end.y - edge.start.y)
    const longest = Math.max(...edges.map(length))
    frame.longEdges = edges.filter((edge) => length(edge) === longest)
  }
  input.floor.thresholds = input.links.openingFrames.candidates.map((frame) => ({
    id: `threshold-${frame.id}`,
    frameId: frame.id,
    polygon: structuredClone(frame.frame.points),
    paintColors: [COLOR],
  }))
  for (const [cellIndex, cell] of input.floor.cavities.entries()) {
    cell.boundaries = cell.polygon.map((start, index) => {
      const end = cell.polygon[(index + 1) % cell.polygon.length] as PagePoint
      const supports: Cell['boundaries'][number]['supports'] = [
        {
          kind: 'paint-boundary',
          id: `paint-${cellIndex}`,
          edge: {
            operationIndex: 100 + cellIndex,
            subpathIndex: 0,
            segmentIndex: index,
            start: { ...start },
            end: { ...end },
          },
        },
      ]
      for (const frame of input.links.openingFrames.candidates) {
        for (const edge of frame.longEdges) {
          if (
            exactNativeOrientation(start, end, edge.start) === 0 &&
            exactNativeOrientation(start, end, edge.end) === 0
          )
            supports.push({ kind: 'frame-side', id: frame.id, edge: structuredClone(edge) })
        }
      }
      return { start: { ...start }, end: { ...end }, supports }
    })
  }
}
function expectReport(input: Input, status: string) {
  const before = structuredClone(input)
  const report = nativeFloorOpeningSides(input.floor, input.links)
  expect(report.status).toBe('draft')
  expect(report.frames[0]?.status).toBe(status)
  expect(report.readOnly).toBe(true)
  expect(report.physicalPassagesAccepted).toBe(false)
  expect(report.roomOwnershipConfirmed).toBe(false)
  expect(report.completeOpeningInventory).toBe(false)
  expect(report.readyFor2D).toBe(false)
  expect(report.readyFor3D).toBe(false)
  expect(input).toEqual(before)
  return report
}
function expectRefused(input: Input, reason: string) {
  const before = structuredClone(input)
  const report = nativeFloorOpeningSides(input.floor, input.links)
  expect(report.status).toBe('unresolved')
  expect(report.refusalReason).toBe(reason)
  expect(report.frames).toEqual([])
  expect(input).toEqual(before)
}

describe('fresh source-cavity contacts to logical opening-frame sides', () => {
  it('pairs two exact source-supported sides without inventing room or passage authority', () => {
    const input = fixture()
    const report = expectReport(input, 'two-sided')
    expect(report.frames[0]?.sides.map((side) => side.status)).toEqual(['matched', 'matched'])
    expect(report.frames[0]?.sides.map((side) => side.contacts[0]?.cavityId)).toEqual([
      'upper',
      'lower',
    ])
    expect(report.frames[0]?.sides.map((side) => side.contacts[0]?.coverage)).toEqual([
      'complete',
      'complete',
    ])
    expect(report.frames[0]?.reason).toBeNull()
  })
  it.each(['upper', 'lower'])('keeps a sole observed %s side as one-sided', (remaining) => {
    const input = fixture()
    input.floor.cavities = input.floor.cavities.filter((cell) => cell.id === remaining)
    const report = expectReport(input, 'one-sided')
    expect(report.frames[0]?.reason).toBe('unobserved-opposite-cavity')
  })
  it.each(['cells', 'frame', 'both'])(
    'is invariant under %s source-direction reversal',
    (target) => {
      const input = fixture()
      if (target !== 'frame') {
        for (const cell of input.floor.cavities) cell.polygon.reverse()
      }
      if (target !== 'cells') frameOf(input).frame.points.reverse()
      rebuild(input)
      expectReport(input, 'two-sided')
    },
  )
  it('uses local winding even when a concave cell wraps past the frame-side line elsewhere', () => {
    const input = fixture()
    cellOf(input, 'upper').polygon = [
      { x: 140, y: 80 },
      { x: 260, y: 80 },
      { x: 260, y: 140 },
      { x: 230, y: 140 },
      { x: 230, y: 95 },
      { x: 220, y: 95 },
      { x: 220, y: 100 },
      { x: 180, y: 100 },
      { x: 180, y: 95 },
      { x: 170, y: 95 },
      { x: 170, y: 140 },
      { x: 140, y: 140 },
    ]
    cellOf(input, 'lower').polygon = rectangle(180, 110, 220, 160)
    rebuild(input)
    expectReport(input, 'two-sided')
  })
  it('distinguishes the same cavity reaching both logical sides', () => {
    const input = fixture()
    input.floor.cavities = [
      cavity('around-strip', [
        { x: 150, y: 80 },
        { x: 250, y: 80 },
        { x: 250, y: 150 },
        { x: 150, y: 150 },
        { x: 150, y: 110 },
        { x: 220, y: 110 },
        { x: 220, y: 100 },
        { x: 150, y: 100 },
      ]),
    ]
    rebuild(input)
    expectReport(input, 'same-cavity')
  })
  it('does not snap a nearby cavity edge onto a logical frame side', () => {
    const input = fixture()
    cellOf(input, 'upper').polygon = rectangle(150, 50, 250, 100 - 1e-9)
    rebuild(input)
    const report = expectReport(input, 'one-sided')
    expect(report.frames[0]?.sides[0]?.status).toBe('unobserved')
  })
  it('keeps a corner-only touch unobserved', () => {
    const input = fixture()
    cellOf(input, 'upper').polygon = rectangle(140, 50, 180, 100)
    rebuild(input)
    const report = expectReport(input, 'one-sided')
    expect(report.frames[0]?.sides[0]?.contacts).toEqual([])
  })
  it('keeps partial side coverage partial', () => {
    const input = fixture()
    cellOf(input, 'upper').polygon = rectangle(150, 50, 200, 100)
    rebuild(input)
    const report = expectReport(input, 'unresolved')
    expect(report.frames[0]?.sides[0]?.status).toBe('partial')
    expect(report.frames[0]?.sides[0]?.contacts[0]?.coverage).toBe('partial')
  })
  it('does not bridge an internal 1e-9 gap in collinear source coverage', () => {
    const input = fixture()
    const gap = 1e-9
    cellOf(input, 'upper').polygon = [
      { x: 150, y: 50 },
      { x: 250, y: 50 },
      { x: 250, y: 100 },
      { x: 200 + gap, y: 100 },
      { x: 200 + gap, y: 90 },
      { x: 200, y: 90 },
      { x: 200, y: 100 },
      { x: 150, y: 100 },
    ]
    rebuild(input)
    const report = expectReport(input, 'unresolved')
    expect(report.frames[0]?.sides[0]?.status).toBe('partial')
  })
  it('accepts exact gapless coverage divided across multiple source boundary edges', () => {
    const input = fixture()
    cellOf(input, 'upper').polygon = [
      { x: 150, y: 50 },
      { x: 250, y: 50 },
      { x: 250, y: 100 },
      { x: 200, y: 100 },
      { x: 190, y: 100 },
      { x: 150, y: 100 },
    ]
    rebuild(input)
    const report = expectReport(input, 'two-sided')
    expect(report.frames[0]?.sides[0]?.contacts[0]?.boundaryEdgeIndices).toHaveLength(3)
  })
  it.each(['partial', 'complete'])(
    'holds a competing %s contact instead of choosing the full/nearest cavity',
    (coverage) => {
      const input = fixture()
      input.floor.cavities.push(
        cavity('competitor', rectangle(150, 60, coverage === 'partial' ? 190 : 250, 100)),
      )
      rebuild(input)
      const report = expectReport(input, 'ambiguous')
      expect(report.frames[0]?.reason).toBe('competing-cavity-contacts')
      expect(report.frames[0]?.sides[0]?.contacts).toHaveLength(2)
    },
  )
  it('holds positive-area overlap between a cavity and logical strip', () => {
    const input = fixture()
    cellOf(input, 'upper').polygon = rectangle(150, 50, 250, 100 + 1e-9)
    rebuild(input)
    const report = expectReport(input, 'ambiguous')
    expect(report.frames[0]?.reason).toBe('strip-overlaps-cavity')
  })
  it('does not match a cavity from another source paint group', () => {
    const input = fixture()
    cellOf(input, 'upper').paintColor = '#999999'
    const report = expectReport(input, 'unresolved')
    expect(report.frames[0]?.sides[0]?.contacts[0]?.coverage).toBe('unproved')
  })
  it('does not infer source-frame provenance from geometric coincidence alone', () => {
    const input = fixture()
    for (const edge of cellOf(input, 'upper').boundaries)
      edge.supports = edge.supports.filter((support) => support.kind !== 'frame-side')
    const report = expectReport(input, 'unresolved')
    expect(report.frames[0]?.sides[0]?.contacts[0]?.coverage).toBe('unproved')
  })
  it.each(['kind', 'id', 'operation', 'subpath', 'segment', 'snapshot'] as const)(
    'requires source-frame support %s',
    (field) => {
      const input = fixture()
      const support = cellOf(input, 'upper')
        .boundaries.flatMap((edge) => edge.supports)
        .find((support) => support.kind === 'frame-side')
      if (!support) throw new Error('Missing source support')
      if (field === 'kind') support.kind = 'profile-side'
      if (field === 'id') support.id = 'other-frame'
      if (field === 'operation') support.edge.operationIndex++
      if (field === 'subpath') support.edge.subpathIndex++
      if (field === 'segment') support.edge.segmentIndex++
      if (field === 'snapshot') support.edge.start.x += 1e-9
      expectReport(input, 'unresolved')
    },
  )
  it('holds an unproved neighboring source region rather than dropping its ambiguity', () => {
    const input = fixture()
    input.floor.unprovedCavities.push({
      polygon: null,
      bounds: { left: 190, right: 200, top: 90, bottom: 100 },
      vertexCount: 4,
      reason: 'unsupported-source-edge',
    })
    const report = expectReport(input, 'unresolved')
    expect(report.frames[0]?.reason).toBe('unproved-neighbor-region')
  })
  it('does not turn absent threshold evidence into a strip', () => {
    const input = fixture()
    input.floor.thresholds = []
    const report = expectReport(input, 'unresolved')
    expect(report.frames[0]?.reason).toBe('logical-strip-unavailable')
  })
  it.each([{ colors: [] }, { colors: [COLOR, '#999999'] }])(
    'holds missing/competing threshold paint evidence %j',
    ({ colors }) => {
      const input = fixture()
      const threshold = input.floor.thresholds[0]
      if (!threshold) throw new Error('Missing threshold')
      threshold.paintColors = colors
      const report = expectReport(input, 'ambiguous')
      expect(report.frames[0]?.reason).toBe('competing-strip-paint')
    },
  )
  it('preserves omitted ink diagnostics without promoting physical readiness', () => {
    const input = fixture()
    frameOf(input).unresolvedInk = [
      {
        kind: 'curve',
        operationIndex: 900,
        bounds: { left: 180, right: 220, top: 90, bottom: 110 },
      },
      {
        kind: 'clip',
        operationIndex: 901,
        bounds: { left: 181, right: 219, top: 100, bottom: 110 },
      },
    ]
    const report = expectReport(input, 'two-sided')
    expect(report.frames[0]?.omittedInkCount).toBe(2)
  })
  it('includes only actually linked source door symbols', () => {
    const input = fixture()
    input.links.doorLinks = [
      {
        symbolId: 'source-swing',
        status: 'linked',
        targetKind: 'opening-frame',
        targetId: frameOf(input).id,
        relation: 'jamb-to-frame',
        evidence: [],
      },
      {
        symbolId: 'elsewhere',
        status: 'unresolved',
        targetKind: null,
        targetId: null,
        relation: null,
        evidence: [],
      },
    ]
    expect(expectReport(input, 'two-sided').frames[0]?.doorSymbolIds).toEqual(['source-swing'])
  })
  it('does not report door-symbol links from a refused link inventory', () => {
    const input = fixture()
    input.links.status = 'unresolved'
    input.links.doorLinks = [
      {
        symbolId: 'source-swing',
        status: 'linked',
        targetKind: 'opening-frame',
        targetId: frameOf(input).id,
        relation: 'jamb-to-frame',
        evidence: [],
      },
    ]
    expect(expectReport(input, 'two-sided').frames[0]?.doorSymbolIds).toEqual([])
  })
  it('does not depend on source operation, frame or cavity identifiers', () => {
    const input = fixture()
    frameOf(input).id = 'renamed-source-frame'
    frameOf(input).frame.operationIndex = 2000
    cellOf(input, 'upper').id = 'source-cell-alpha'
    cellOf(input, 'lower').id = 'source-cell-beta'
    rebuild(input)
    const report = expectReport(input, 'two-sided')
    expect(report.frames[0]?.frameId).toBe('renamed-source-frame')
    expect(report.frames[0]?.sides.map((side) => side.contacts[0]?.cavityId)).toEqual([
      'source-cell-alpha',
      'source-cell-beta',
    ])
  })
  it('returns detached correspondence arrays', () => {
    const input = fixture()
    const before = structuredClone(input)
    const report = expectReport(input, 'two-sided')
    const contact = report.frames[0]?.sides[0]?.contacts[0]
    if (!contact) throw new Error('Missing contact')
    contact.boundaryEdgeIndices.push(999)
    contact.cavityId = 'changed'
    expect(input).toEqual(before)
  })
  it.each(['floor', 'frames'] as const)(
    'holds an unavailable %s inventory atomically',
    (target) => {
      const input = fixture()
      if (target === 'floor') input.floor.status = 'unresolved'
      else input.links.openingFrames.status = 'unresolved'
      expectRefused(input, 'floor-or-frame-inventory-unavailable')
    },
  )
  it.each(['originalPdfSha256', 'sha256', 'page', 'width', 'height'] as const)(
    'holds mismatched %s source across inventories',
    (field) => {
      const input = fixture()
      if (field === 'originalPdfSha256') input.links.originalPdfSha256 = 'c'.repeat(64)
      else if (field === 'sha256') input.links.source.sha256 = 'c'.repeat(64)
      else input.links.source[field]++
      expectRefused(input, 'different-floor-frame-source')
    },
  )
  it('holds a frame subinventory from another source', () => {
    const input = fixture()
    input.links.openingFrames.source.page++
    expectRefused(input, 'different-floor-frame-source')
  })
  it('requires an original PDF fingerprint', () => {
    const input = fixture()
    delete input.floor.originalPdfSha256
    expectRefused(input, 'different-floor-frame-source')
  })
  it.each(['frames', 'cavities', 'thresholds', 'doors'] as const)(
    'holds oversized %s input',
    (field) => {
      const input = fixture()
      if (field === 'frames')
        input.links.openingFrames.candidates = Array.from({ length: 101 }, (_, i) =>
          sourceFrame(`frame-${i}`, i + 10),
        )
      if (field === 'cavities')
        input.floor.cavities = Array.from({ length: 101 }, (_, i) => ({
          ...structuredClone(cellOf(input, 'upper')),
          id: `cell-${i}`,
        }))
      if (field === 'thresholds')
        input.floor.thresholds = Array.from({ length: 101 }, (_, i) => ({
          id: `threshold-${i}`,
          frameId: `frame-${i}`,
          polygon: [],
          paintColors: [COLOR],
        }))
      if (field === 'doors')
        input.links.doorLinks = Array.from({ length: 101 }, (_, i) => ({
          symbolId: `symbol-${i}`,
          status: 'unresolved',
          targetKind: null,
          targetId: null,
          relation: null,
          evidence: [],
        }))
      expectRefused(input, 'floor-frame-side-input-limit')
    },
  )
  it.each(['frames', 'cavities', 'thresholds'] as const)(
    'holds duplicate %s identities',
    (field) => {
      const input = fixture()
      if (field === 'frames')
        input.links.openingFrames.candidates.push(structuredClone(frameOf(input)))
      if (field === 'cavities') input.floor.cavities.push(structuredClone(cellOf(input, 'upper')))
      if (field === 'thresholds') {
        const threshold = input.floor.thresholds[0]
        if (!threshold) throw new Error('Missing threshold')
        input.floor.thresholds.push(structuredClone(threshold))
      }
      expectRefused(input, 'floor-frame-side-input-limit')
    },
  )
  it('holds mismatched cavity boundary inventory', () => {
    const input = fixture()
    cellOf(input, 'upper').boundaries.pop()
    expectRefused(input, 'floor-frame-side-input-limit')
  })
  it('matches vertical long sides after exact axis exchange', () => {
    const input = fixture()
    const exchange = (point: PagePoint) => ({ x: point.y, y: point.x })
    frameOf(input).frame.points = frameOf(input).frame.points.map(exchange)
    for (const cell of input.floor.cavities) cell.polygon = cell.polygon.map(exchange)
    rebuild(input)
    expectReport(input, 'two-sided')
  })
  it('holds stale cavity boundary point ordering', () => {
    const input = fixture()
    cellOf(input, 'upper').polygon.reverse()
    expectRefused(input, 'unsupported-cavity-boundary-order')
  })
  it.each(['operation', 'subpath', 'segment', 'snapshot'] as const)(
    'holds malformed long-side %s metadata',
    (field) => {
      const input = fixture()
      const side = frameOf(input).longEdges[0]
      if (!side) throw new Error('Missing source long side')
      if (field === 'operation') side.operationIndex++
      if (field === 'subpath') side.subpathIndex++
      if (field === 'segment') side.segmentIndex = 1
      if (field === 'snapshot') side.start.x += 1e-9
      expectRefused(input, 'unsupported-source-frame-sides')
    },
  )
  it('holds a threshold polygon from another source frame geometry', () => {
    const input = fixture()
    const point = input.floor.thresholds[0]?.polygon[0]
    if (!point) throw new Error('Missing threshold source point')
    point.x += 1e-9
    expectRefused(input, 'unsupported-source-frame-sides')
  })
  it('holds oversized unproved-region inventory', () => {
    const input = fixture()
    input.floor.unprovedCavities = Array.from({ length: 101 }, () => ({
      polygon: null,
      bounds: { left: 900, right: 901, top: 900, bottom: 901 },
      vertexCount: 4,
      reason: 'unproved',
    }))
    expectRefused(input, 'floor-frame-side-input-limit')
  })
  it('holds oversized per-cavity polygons', () => {
    const input = fixture()
    cellOf(input, 'upper').polygon = Array.from({ length: 101 }, (_, index) => ({
      x: 150 + index / 10,
      y: 100,
    }))
    rebuild(input)
    expectRefused(input, 'floor-frame-side-input-limit')
  })
  it('holds excessive whole-input polygon work', () => {
    const input = fixture()
    const parent = cellOf(input, 'upper')
    input.floor.cavities = Array.from({ length: 41 }, (_, index) => ({
      ...structuredClone(parent),
      id: `cell-${index}`,
      polygon: Array.from({ length: 100 }, (_, i) => ({ x: 150 + i / 10, y: 100 })),
    }))
    rebuild(input)
    expectRefused(input, 'floor-frame-side-input-limit')
  })
  it('holds a degenerate source cavity with unsupported winding', () => {
    const input = fixture()
    cellOf(input, 'upper').polygon = [
      { x: 150, y: 100 },
      { x: 200, y: 100 },
      { x: 250, y: 100 },
    ]
    rebuild(input)
    expectRefused(input, 'unsupported-cavity-winding')
  })
  it('holds contact-output exhaustion atomically', () => {
    const input = fixture()
    const upper = cellOf(input, 'upper'),
      lower = cellOf(input, 'lower')
    input.floor.cavities = Array.from({ length: 100 }, (_, index) => ({
      ...structuredClone(index < 50 ? upper : lower),
      id: `cell-${index}`,
    }))
    input.links.openingFrames.candidates = Array.from({ length: 20 }, (_, index) =>
      sourceFrame(`frame-${index}`, index + 20),
    )
    rebuild(input)
    expectRefused(input, 'floor-frame-side-output-limit')
  })
  it('holds boundary-index output exhaustion before the contact-count limit', () => {
    const input = fixture()
    // Explicit stress inventory, not a producer/golden floor: duplicate geometry
    // carries distinct IDs to exercise the report's independent output budget.
    const subdivided = [
      { x: 150, y: 50 },
      { x: 250, y: 50 },
      { x: 250, y: 100 },
      ...Array.from({ length: 97 }, (_, index) => ({ x: 250 - ((index + 1) * 100) / 97, y: 100 })),
    ]
    input.floor.cavities = Array.from({ length: 40 }, (_, index) =>
      cavity(`cell-${index}`, structuredClone(subdivided)),
    )
    input.links.openingFrames.candidates = Array.from({ length: 10 }, (_, index) =>
      sourceFrame(`frame-${index}`, index + 20),
    )
    rebuild(input)
    expectRefused(input, 'floor-frame-side-output-limit')
  })
  it('holds unsupported source-frame decimal precision rather than fitting coordinates', () => {
    const input = fixture()
    for (const point of frameOf(input).frame.points) if (point.x === 180) point.x = 1e-19
    rebuild(input)
    expectRefused(input, 'unsupported-source-frame-sides')
  })
  it('holds unsupported cavity decimal precision rather than fitting coordinates', () => {
    const input = fixture()
    const point = cellOf(input, 'upper').polygon[0]
    if (!point) throw new Error('Missing source point')
    point.x = 1e-19
    rebuild(input)
    expectRefused(input, 'unsupported-cavity-winding')
  })
  it('holds bounded geometric work exhaustion atomically', () => {
    const input = fixture()
    const square = [
      ...Array.from({ length: 25 }, (_, i) => ({ x: 600 + i * 4, y: 600 })),
      ...Array.from({ length: 25 }, (_, i) => ({ x: 700, y: 600 + i * 4 })),
      ...Array.from({ length: 25 }, (_, i) => ({ x: 700 - i * 4, y: 700 })),
      ...Array.from({ length: 25 }, (_, i) => ({ x: 600, y: 700 - i * 4 })),
    ]
    input.floor.cavities = Array.from({ length: 40 }, (_, index) =>
      cavity(`cell-${index}`, structuredClone(square)),
    )
    input.links.openingFrames.candidates = Array.from({ length: 100 }, (_, index) =>
      sourceFrame(`frame-${index}`, index + 20),
    )
    rebuild(input)
    expectRefused(input, 'floor-frame-side-work-limit')
  })
})
