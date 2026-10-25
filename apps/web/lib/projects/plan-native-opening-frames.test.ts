import { describe, expect, it } from 'vitest'
import type { NativeTextAnchors } from './plan-document'
import {
  exactNativeOpeningFrameShape,
  nativeOpeningFrameCandidates,
} from './plan-native-opening-frames'
import type { PagePoint, PdfLinework, PdfVectorPath } from './plan-pdf-linework'
import { PDF_NATIVE_MAX_PATHS } from './plan-pdf-linework'

const raster = { sha256: 'b'.repeat(64), page: 1, width: 1000, height: 1000 }
const native: NativeTextAnchors = {
  source: raster,
  originalPdfSha256: 'a'.repeat(64),
  complete: true,
  labels: [],
  pageNormalizedScale: { x: 1, y: 1 },
}
function path(operationIndex: number, points: number[][]): PdfVectorPath {
  return {
    operationIndex,
    subpathIndex: 0,
    paint: 'stroke',
    closed: true,
    points: points.map(([x, y]) => ({ x: x as number, y: y as number })),
  }
}
const rectangle = (operationIndex = 1, left = 100, right = 200, top = 100, bottom = 110) =>
  path(operationIndex, [
    [left, top],
    [right, top],
    [right, bottom],
    [left, bottom],
    [left, top],
  ])
const leftHost = () =>
  path(2, [
    [50, 90],
    [100, 90],
    [100, 120],
    [50, 120],
    [45, 115],
    [45, 105],
    [50, 90],
  ])
const rightHost = () =>
  path(3, [
    [200, 90],
    [250, 90],
    [255, 105],
    [255, 115],
    [250, 120],
    [200, 120],
    [200, 90],
  ])
function work(paths = [rectangle(), leftHost(), rightHost()]): PdfLinework {
  return {
    coordinateSystem: 'page-0-1000',
    pageWidth: 1000,
    pageHeight: 1000,
    paths,
    skippedCurves: 0,
    unsupportedPaths: 0,
    unsupportedContexts: 0,
    clippedPaths: 0,
    truncated: false,
  }
}
const run = (layer = work(), anchors = native) =>
  nativeOpeningFrameCandidates({
    native: anchors,
    work: layer,
    lineworkSource: anchors.source,
  })

function rotated(layer: PdfLinework, scaleX = 1): PdfLinework {
  return {
    ...structuredClone(layer),
    paths: layer.paths.map((source) => ({
      ...source,
      points: source.points.map(({ x, y }) => ({
        x: ((3 * x - 4 * y) / 5 + 300) / scaleX,
        y: (4 * x + 3 * y) / 5 + 100,
      })),
    })),
  }
}

describe('painted native opening frame candidates', () => {
  const realSource = fileURLToPath(
    new URL('../../../../output/pdf/source-search-20261003/rebrina-original.pdf', import.meta.url),
  )
  it.skipIf(!existsSync(realSource))(
    'does not advertise a recovered opening inventory for the actual Rebrina survey',
    async () => {
      const body = await readFile(realSource)
      expect(createHash('sha256').update(body).digest('hex')).toBe(
        '2e141c135812c81719e1f4783173cb5202e20041ac494d3cc799eb37ad62ad4e',
      )
      const { preparePlanPage } = await import('./plan-document')
      const page = await preparePlanPage(body, true, 3, true, true)
      if (!page.nativeTextAnchors || !page.linework || !page.lineworkRasterSource)
        throw new Error('Missing original native PDF evidence')
      const result = nativeOpeningFrameCandidates({
        native: page.nativeTextAnchors,
        work: page.linework,
        lineworkSource: page.lineworkRasterSource,
      })
      expect(result.refusalReason).toBeNull()
      expect(result.candidates).toEqual([])
      expect(result.completeOpeningInventory).toBe(false)
      expect(result.closesFloorBoundary).toBe(false)
    },
    30_000,
  )

  it('exposes exact topology without confusing it with a physical rectangle proof', () => {
    const points: [PagePoint, PagePoint, PagePoint, PagePoint] = [
      { x: 1, y: 1 },
      { x: 11, y: 6 },
      { x: 12, y: 8 },
      { x: 2, y: 3 },
    ]
    expect(exactNativeOpeningFrameShape(points)).toBe(true)
    expect(exactNativeOpeningFrameShape(points, { x: 1, y: 1 })).toBe(false)
    expect(exactNativeOpeningFrameShape([...points].reverse())).toBe(true)
    expect(exactNativeOpeningFrameShape([points[0], points[2], points[1], points[3]])).toBe(false)
    expect(exactNativeOpeningFrameShape(points.map((point) => ({ x: point.x, y: 1 })))).toBe(false)
    expect(exactNativeOpeningFrameShape(points.map((point) => ({ ...point, x: 1001 })))).toBe(false)
  })

  it('retains arbitrary-angle source vertices and exact collinear jamb coverage without snapping', () => {
    const input = rotated(work())
    const result = run(input)
    expect(result.candidates).toHaveLength(1)
    expect(result.coverageScope).toBe('exact-physical-rectangular-source-frames-only')
    expect(result.candidates[0]?.frame).toEqual(input.paths[0])
    expect(result.candidates[0]?.longEdges.map((edge) => edge.segmentIndex)).toEqual([0, 2])
    expect(result.candidates[0]?.jambs.map((jamb) => jamb.sourceEdges[0]?.operationIndex)).toEqual([
      3, 2,
    ])
    expect(result.candidates[0]).toMatchObject({
      openingKind: null,
      semanticStatus: 'unclassified',
      physicalPassageAccepted: false,
      closesFloorBoundary: false,
    })
  })

  it('checks physical right angles under anisotropic normalized-page coordinates', () => {
    const input = rotated(work(), 0.5)
    const anchors = {
      ...native,
      source: { ...raster, width: 500 },
      pageNormalizedScale: { x: 0.5, y: 1 },
    }
    expect(run(input, anchors).candidates).toHaveLength(1)
    // The same source quadrilateral is a parallelogram, not a rectangle, on a square page.
    expect(run(input).candidates).toEqual([])
  })

  it('does not promote nearly rectangular or nearly collinear rotated source ink', () => {
    const distorted = rotated(work())
    const vertex = distorted.paths[0]?.points[1]
    if (vertex) vertex.x += 0.000000001
    expect(run(distorted).candidates).toEqual([])
    const separated = rotated(work())
    const host = separated.paths[1]
    if (host) host.points = host.points.map((point) => ({ ...point, x: point.x + 0.000000001 }))
    expect(run(separated).candidates).toEqual([])
  })

  it('deduplicates rotated repaints with reversed winding and shifted first vertex', () => {
    const input = rotated(work())
    const frame = input.paths[0] as PdfVectorPath
    const vertices = frame.points.slice(0, -1).reverse()
    const shifted = [...vertices.slice(1), vertices[0] as { x: number; y: number }]
    const first = shifted[0]
    if (!first) throw new Error('Missing alias vertex')
    const alias = { ...frame, operationIndex: 4, points: [...shifted, first] }
    input.paths.push(alias)
    const result = run(input)
    expect(result.candidates).toHaveLength(1)
    expect(result.candidates[0]?.repaintAliases).toEqual([alias])
  })

  it('does not confuse overlapping axis bounds with overlapping rotated painted frames', () => {
    const input = work()
    const second = structuredClone(input.paths).map((source) => ({
      ...source,
      operationIndex: source.operationIndex + 10,
      points: source.points.map((point) => ({ ...point, y: point.y + 20 })),
    }))
    input.paths.push(...second)
    const result = run(rotated(input))
    expect(result.candidates).toHaveLength(2)
    const overlapping = work()
    overlapping.paths.push(rectangle(5, 100, 200, 105, 115))
    expect(run(rotated(overlapping)).candidates).toEqual([])
  })

  it('retains actual rectangle, long boundary edges and fully containing jamb source edges', () => {
    const input = work()
    const original = structuredClone(input)
    const result = run(input)
    expect(result.refusalReason).toBeNull()
    expect(result.candidates).toHaveLength(1)
    const frame = result.candidates[0]
    expect(frame?.frame).toEqual(input.paths[0])
    expect(frame?.longEdges.map((edge) => edge.segmentIndex)).toEqual([0, 2])
    expect(frame?.jambs.map((jamb) => jamb.sourceEdges.map((edge) => edge.operationIndex))).toEqual(
      [[3], [2]],
    )
    expect(frame).toMatchObject({
      openingKind: null,
      semanticStatus: 'unclassified',
      closesFloorBoundary: false,
      physicalPassageAccepted: false,
      unresolvedInk: [],
    })
    expect(result.completeOpeningInventory).toBe(false)
    expect(input).toEqual(original)
    const copiedPoint = frame?.frame.points[0]
    if (copiedPoint) copiedPoint.x = 999
    expect(input).toEqual(original)
  })

  it('permits distinct jamb edges in the same source path, without asserting a wall role', () => {
    const host = path(2, [
      [100, 90],
      [100, 100],
      [100, 110],
      [100, 120],
      [200, 120],
      [200, 110],
      [200, 100],
      [200, 90],
      [100, 90],
    ])
    const result = run(work([rectangle(), host]))
    expect(result.candidates).toHaveLength(1)
    expect(result.candidates[0]?.jambs.map((jamb) => jamb.sourceEdges[0]?.operationIndex)).toEqual([
      2, 2,
    ])
    expect(result.candidates[0]?.jambs[0]?.sourceEdges[0]?.segmentIndex).not.toBe(
      result.candidates[0]?.jambs[1]?.sourceEdges[0]?.segmentIndex,
    )
  })

  it('refuses endpoint-only, partial and near-collinear contacts', () => {
    for (const host of [
      path(2, [
        [50, 90],
        [100, 90],
        [100, 105],
        [50, 105],
        [45, 100],
        [45, 95],
        [50, 90],
      ]),
      path(2, [
        [50, 90],
        [100, 100],
        [100.000001, 110],
        [50, 120],
        [45, 115],
        [45, 105],
        [50, 90],
      ]),
      path(2, [
        [50, 90],
        [100.000001, 90],
        [100.000001, 120],
        [50, 120],
        [45, 115],
        [45, 105],
        [50, 90],
      ]),
    ]) {
      const result = run(work([rectangle(), host, rightHost()]))
      expect(result.candidates).toEqual([])
      expect(result.rejected).toContainEqual({
        operationIndex: 1,
        subpathIndex: 0,
        reason: 'no-two-complete-source-jambs',
      })
    }
  })

  it('does not use another small rectangular icon as a structural jamb contact', () => {
    expect(
      run(work([rectangle(), rectangle(2, 50, 100, 90, 120), rightHost()])).candidates,
    ).toEqual([])
  })

  it('joins exact painted jamb intervals, retains outside tails and refuses a tiny gap', () => {
    const bottom = path(2, [
      [50, 90],
      [100, 90],
      [100, 105],
      [50, 105],
      [45, 100],
      [45, 95],
      [50, 90],
    ])
    const top = path(4, [
      [50, 105],
      [100, 105],
      [100, 120],
      [50, 120],
      [45, 115],
      [45, 110],
      [50, 105],
    ])
    const input = work([rectangle(), bottom, top, rightHost()])
    const result = run(input)
    expect(result.candidates).toHaveLength(1)
    expect(result.candidates[0]?.jambs[1]?.sourceEdges.map((edge) => edge.operationIndex)).toEqual([
      2, 4,
    ])
    expect(result.candidates[0]?.jambs[1]?.sourceEdges[0]?.start.y).toBe(90)
    const gap = structuredClone(input)
    const join = gap.paths[2]?.points[1]
    if (join) join.y = 105.000000001
    expect(run(gap).candidates).toEqual([])
  })

  it('rejects square, degenerate, unpainted and open frames', () => {
    for (const frame of [
      rectangle(1, 100, 200, 100, 200),
      rectangle(1, 100, 200, 100, 100),
      { ...rectangle(), paint: 'fill' as const },
      { ...rectangle(), closed: false },
    ])
      expect(run(work([frame, leftHost(), rightHost()])).candidates).toEqual([])
  })

  it('uses the raster aspect, not normalized page aspect, to distinguish short jambs', () => {
    const result = run(work([rectangle(1, 100, 200, 100, 130), leftHost(), rightHost()]), {
      ...native,
      source: { ...raster, width: 500 },
      pageNormalizedScale: { x: 0.5, y: 1 },
    })
    expect(result.candidates).toEqual([])
  })

  it('keeps local omitted ink unresolved, never reclassifies it as clear floor', () => {
    const input = work()
    input.skippedCurves = 2
    input.skippedCurveBounds = [
      { operationIndex: 77, bounds: { left: 95, right: 105, top: 99, bottom: 101 } },
      { operationIndex: 78, bounds: { left: 500, right: 510, top: 500, bottom: 510 } },
    ]
    const result = run(input)
    expect(result.candidates).toHaveLength(1)
    expect(result.candidates[0]?.unresolvedInk).toEqual([
      { kind: 'curve', ...input.skippedCurveBounds[0] },
    ])
    expect(result.candidates[0]?.physicalPassageAccepted).toBe(false)
    expect(input.skippedCurves).toBe(2)
  })

  it('does not reuse a frame or jamb operation with an omitted sibling path', () => {
    for (const operationIndex of [1, 2]) {
      const input = work()
      input.clippedPaths = 1
      input.clippedPathBounds = [
        { operationIndex, bounds: { left: 900, right: 910, top: 900, bottom: 910 } },
      ]
      expect(run(input).candidates).toEqual([])
    }
  })

  it('keeps exact repaints as aliases but removes competing overlapping frames', () => {
    const input = work([rectangle(), rectangle(4), leftHost(), rightHost()])
    expect(run(input).candidates[0]?.repaintAliases).toEqual([rectangle(4)])
    input.paths.push(rectangle(5, 100, 200, 105, 115))
    const result = run(input)
    expect(result.candidates).toEqual([])
    expect(
      result.rejected.filter((entry) => entry.reason === 'competing-painted-frames'),
    ).toHaveLength(2)
  })

  it('fails atomically for incomplete layer, duplicate refs and unsupported precision', () => {
    const truncated = work()
    truncated.truncated = true
    expect(run(truncated)).toMatchObject({
      status: 'unresolved',
      candidates: [],
      refusalReason: 'incomplete-native-layer',
    })
    expect(run(work([rectangle(), leftHost(), rightHost(), rectangle()]))).toMatchObject({
      candidates: [],
      refusalReason: 'invalid-native-provenance',
    })
    const precision = work()
    const sourcePoint = precision.paths[1]?.points[0]
    if (sourcePoint) sourcePoint.x = 1e-19
    expect(run(precision)).toMatchObject({
      candidates: [],
      refusalReason: 'unsupported-source-coordinate-precision',
    })
  })

  it('refuses invalid source points, paint/closure values and contradictory omission counts', () => {
    for (const value of [-1, 1001, Number.NaN, Number.POSITIVE_INFINITY]) {
      const input = work()
      const point = input.paths[1]?.points[0]
      if (point) point.x = value
      expect(run(input).candidates).toEqual([])
    }
    const closure = work()
    const candidate = closure.paths[0]
    if (candidate) candidate.closed = 'closed' as unknown as boolean
    expect(run(closure).refusalReason).toBe('invalid-native-provenance')
    const paint = work()
    if (paint.paths[0]) paint.paths[0].paint = 'unknown' as PdfVectorPath['paint']
    expect(run(paint).refusalReason).toBe('invalid-native-provenance')
    const omissions = work()
    omissions.skippedCurveBounds = [
      { operationIndex: 42, bounds: { left: 0, right: 1, top: 0, bottom: 1 } },
    ]
    expect(run(omissions).refusalReason).toBe('invalid-omission-provenance')
  })

  it('fails atomically for an oversized source inventory or unavailable omission bounds', () => {
    const input = work()
    input.skippedCurves = 1
    expect(run(input).refusalReason).toBe('incomplete-native-layer')
    input.skippedCurves = 0
    input.paths = Array.from({ length: PDF_NATIVE_MAX_PATHS + 1 }, (_, index) =>
      rectangle(index + 1),
    )
    expect(run(input).refusalReason).toBe('incomplete-native-layer')
  })

  it('fails atomically when source comparisons exceed the bounded work budget', () => {
    const frames = Array.from({ length: 90 }, (_, index) =>
      rectangle(index + 10, 100, 200, 100 + index / 100, 110 + index / 100),
    )
    const hosts = Array.from({ length: 500 }, (_, index) => ({
      ...leftHost(),
      operationIndex: index + 500,
    }))
    const result = run(work([...frames, ...hosts, rightHost()]))
    expect(result).toMatchObject({
      status: 'unresolved',
      candidates: [],
      refusalReason: 'frame-search-budget',
    })
  })

  it('fails atomically rather than exposing the first hundred frame candidates', () => {
    const frames = Array.from({ length: 101 }, (_, index) =>
      rectangle(index + 10, 100, 200, 100 + index * 2, 101 + index * 2),
    )
    const first = leftHost()
    const second = rightHost()
    first.points = first.points.map((point) => ({ ...point, y: point.y === 120 ? 400 : point.y }))
    second.points = second.points.map((point) => ({ ...point, y: point.y === 120 ? 400 : point.y }))
    expect(run(work([...frames, first, second]))).toMatchObject({
      status: 'unresolved',
      candidates: [],
      refusalReason: 'frame-candidate-limit',
    })
  })
})

import { createHash } from 'node:crypto'
import { existsSync } from 'node:fs'
import { readFile } from 'node:fs/promises'
import { fileURLToPath } from 'node:url'
