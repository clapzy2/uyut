import type { PlanGeometry } from '@uyut/db'
import { describe, expect, it } from 'vitest'
import type { NativeTextAnchors } from './plan-document'
import type { nativeDimensionEvidence } from './plan-native-dimension-evidence'
import { nativeFaceCycle } from './plan-native-face-cycle'
import { metricNativeCycles, type ReviewedMetricAnchors } from './plan-native-metric-cycles'
import type { PagePoint, PdfLinework } from './plan-pdf-linework'
import { buildPlanScene } from './plan-scene-geometry'
import { type PlanVolume, planVolume } from './plan-volume'

const rasterSource = { sha256: 'a'.repeat(64), page: 1, width: 1000, height: 1000 }
const source = { sha256: 'b'.repeat(64), pdfPage: 1, state: 'existing' as const }
const native: NativeTextAnchors = {
  source: rasterSource,
  complete: true,
  originalPdfSha256: source.sha256,
  labels: [],
}
const ref = (operationIndex: number) => ({ operationIndex, subpathIndex: 0, segmentIndex: 0 })
function fixture(diagonal = false) {
  const polygon = diagonal
    ? [
        { x: 20, y: 20 },
        { x: 80, y: 20 },
        { x: 80, y: 60 },
        { x: 60, y: 80 },
        { x: 20, y: 80 },
      ]
    : [
        { x: 20, y: 20 },
        { x: 80, y: 20 },
        { x: 80, y: 80 },
        { x: 20, y: 80 },
      ]
  const width = [
    { x: 20, y: 40 },
    { x: 80, y: 40 },
  ] as [PagePoint, PagePoint]
  const depth = diagonal
    ? ([
        { x: 40, y: 20 },
        { x: 40, y: 80 },
      ] as [PagePoint, PagePoint])
    : ([
        { x: 60, y: 80 },
        { x: 60, y: 20 },
      ] as [PagePoint, PagePoint])
  const paths = polygon.map((point, index) => ({
    operationIndex: index + 1,
    subpathIndex: 0,
    paint: 'stroke' as const,
    closed: false,
    points: [point, polygon[(index + 1) % polygon.length] as PagePoint],
  }))
  paths.push(
    ...[width, depth].map((points, index) => ({
      operationIndex: 10 + index,
      subpathIndex: 0,
      paint: 'stroke' as const,
      closed: false,
      points,
    })),
  )
  const work: PdfLinework = {
    coordinateSystem: 'page-0-1000',
    pageWidth: 1000,
    pageHeight: 1000,
    paths,
    skippedCurves: 0,
    clippedPaths: 0,
    unsupportedContexts: 0,
    unsupportedPaths: 0,
    truncated: false,
  }
  const dimensions: ReturnType<typeof nativeDimensionEvidence> = {
    status: 'draft',
    source,
    rasterSource,
    dimensionOperations: [10, 11],
    chains: [width, depth].map((ends, index) => ({
      id: index === 0 ? 'width' : 'depth',
      labelIds: [`native-text-${index}`],
      result: {
        status: 'candidate' as const,
        totalMm: 600,
        axis: index === 0 ? ('width' as const) : ('aligned' as const),
        labelIndexes: [index],
        lineOperations: [10 + index],
        ends,
        segments: [{ labelIndex: index, valueMm: 600, start: ends[0], end: ends[1] }],
        basis: 'native-page-dimension' as const,
      },
      rails: [{ operationIndex: 10 + index, subpathIndex: 0, points: ends }],
    })),
    nativeCoverageWarnings: {
      skippedCurves: 0,
      clippedPaths: 0,
      unsupportedContexts: 0,
      unsupportedPaths: 0,
    },
  }
  const cycle = nativeFaceCycle({
    native,
    work,
    dimensions,
    lineworkSource: rasterSource,
    reviewed: {
      source,
      rasterSource,
      review: 'manual-native-face-review',
      faces: paths
        .slice(0, polygon.length)
        .map((path) => ({ ref: ref(path.operationIndex), kind: 'wall-face' })),
    },
  })
  if (cycle.status !== 'candidate') throw new Error(cycle.reason)
  const reviewed: ReviewedMetricAnchors = {
    review: 'manual-native-metric-review',
    source,
    rasterSource,
    origin: { x: 0, y: 0 },
    anchors: [
      {
        chainId: 'width',
        cycleId: 'room',
        faceRef: ref(1),
        witnessRefs: [ref(polygon.length), ref(2)],
      },
      {
        chainId: 'depth',
        cycleId: 'room',
        faceRef: ref(diagonal ? 5 : 2),
        witnessRefs: diagonal ? [ref(1), ref(4)] : [ref(3), ref(1)],
      },
    ],
  }
  return {
    native,
    work,
    dimensions,
    lineworkSource: rasterSource,
    cycles: [{ id: 'room', cycle }],
    reviewed,
  }
}
describe('common printed scale for reviewed native contours', () => {
  it('uses one primary scale without rescaling axes or confirming geometry', () => {
    const result = metricNativeCycles(fixture())
    expect(result.status).toBe('draft')
    if (result.status !== 'draft') throw new Error(result.reason)
    expect(result.cmPerPoint).toBe(1)
    expect(result.contours[0]?.polygonCm).toEqual([
      { xCm: 20, yCm: 20 },
      { xCm: 80, yCm: 20 },
      { xCm: 80, yCm: 80 },
      { xCm: 20, yCm: 80 },
    ])
    expect(result.contours[0]?.areaM2).toBeCloseTo(0.36)
  })
  it('rejects conflicting independent scales instead of averaging them', () => {
    const input = fixture()
    const dimensions = {
      ...input.dimensions,
      chains: input.dimensions.chains.map((chain, index) =>
        index === 1 && chain.result.status === 'candidate'
          ? { ...chain, result: { ...chain.result, totalMm: 620 } }
          : chain,
      ),
    }
    expect(metricNativeCycles({ ...input, dimensions })).toMatchObject({
      status: 'unresolved',
      reason: 'common-scale-conflict',
    })
  })
  it('refuses reused and missing witness evidence', () => {
    const input = fixture()
    const first = input.reviewed.anchors[0]
    if (!first) throw new Error('Missing fixture anchor')
    expect(
      metricNativeCycles({ ...input, reviewed: { ...input.reviewed, anchors: [first, first] } }),
    ).toMatchObject({ status: 'unresolved', reason: 'reused-calibration-evidence' })
    expect(
      metricNativeCycles({
        ...input,
        reviewed: {
          ...input.reviewed,
          anchors: [
            { ...first, witnessRefs: [ref(999), ref(2)] },
            ...input.reviewed.anchors.slice(1),
          ],
        },
      }),
    ).toMatchObject({ status: 'unresolved', reason: 'missing-or-ambiguous-native-witness' })
  })
  it('does not extend a short witness to reach the dimension tip', () => {
    const input = fixture()
    const work = {
      ...input.work,
      paths: input.work.paths.map((path) =>
        path.operationIndex === 4
          ? {
              ...path,
              points: [
                { x: 20, y: 20 },
                { x: 20, y: 30 },
              ],
            }
          : path,
      ),
    }
    expect(metricNativeCycles({ ...input, work })).toMatchObject({
      status: 'unresolved',
      reason: 'unbounded-or-wrong-endpoint-witness',
    })
  })
  it('does not apply a scale to an unanchored second contour', () => {
    const input = fixture()
    const first = input.cycles[0]
    if (!first) throw new Error('Missing fixture cycle')
    expect(
      metricNativeCycles({ ...input, cycles: [...input.cycles, { ...first, id: 'unchecked' }] }),
    ).toMatchObject({
      status: 'unresolved',
      reason: 'two-independent-directions-required-per-contour',
    })
  })
  it('rejects a dimension spanning only part of the selected face', () => {
    const input = fixture()
    const dimensions = {
      ...input.dimensions,
      chains: input.dimensions.chains.map((chain, index) =>
        index === 0 && chain.result.status === 'candidate'
          ? {
              ...chain,
              result: {
                ...chain.result,
                totalMm: 400,
                ends: [
                  { x: 20, y: 40 },
                  { x: 60, y: 40 },
                ] as [PagePoint, PagePoint],
              },
            }
          : chain,
      ),
    }
    expect(metricNativeCycles({ ...input, dimensions })).toMatchObject({
      status: 'unresolved',
      reason: 'dimension-does-not-span-source-face',
    })
  })
  it('rejects stale source identity', () => {
    const input = fixture()
    expect(() =>
      metricNativeCycles({ ...input, lineworkSource: { ...rasterSource, page: 2 } }),
    ).toThrow()
    expect(() =>
      metricNativeCycles({
        ...input,
        reviewed: { ...input.reviewed, source: { ...source, sha256: 'c'.repeat(64) } },
      }),
    ).toThrow()
  })
  it('does not accept two parallel dimensions as independent directions', () => {
    const input = fixture()
    const dimensions = {
      ...input.dimensions,
      chains: input.dimensions.chains.map((chain, index) =>
        index === 1 && chain.result.status === 'candidate'
          ? {
              ...chain,
              result: {
                ...chain.result,
                axis: 'width' as const,
                ends: [
                  { x: 20, y: 60 },
                  { x: 80, y: 60 },
                ] as [PagePoint, PagePoint],
              },
            }
          : chain,
      ),
    }
    const left = input.work.paths.find((path) => path.operationIndex === 4)
    const right = input.work.paths.find((path) => path.operationIndex === 2)
    if (!left || !right) throw new Error('Missing witness fixture')
    const work = {
      ...input.work,
      paths: [
        ...input.work.paths,
        { ...left, operationIndex: 14 },
        { ...right, operationIndex: 12 },
      ],
    }
    const first = input.reviewed.anchors[0]
    if (!first) throw new Error('Missing fixture anchor')
    const reviewed = {
      ...input.reviewed,
      anchors: [
        first,
        {
          chainId: 'depth',
          cycleId: 'room',
          faceRef: ref(3),
          witnessRefs: [ref(14), ref(12)] as [ReturnType<typeof ref>, ReturnType<typeof ref>],
        },
      ],
    }
    expect(metricNativeCycles({ ...input, dimensions, work, reviewed })).toMatchObject({
      status: 'unresolved',
      reason: 'two-independent-directions-required-per-contour',
    })
  })
  it('preserves a diagonal in metric coordinates and the metre-based floor scene', () => {
    const result = metricNativeCycles(fixture(true))
    if (result.status !== 'draft') throw new Error(result.reason)
    const contour = result.contours[0]
    if (!contour) throw new Error('Missing metric contour')
    expect(contour.polygonCm).toHaveLength(5)
    expect(contour.areaM2).toBeCloseTo(0.34)
    const draft: PlanGeometry = {
      version: 1,
      status: 'draft',
      widthCm: 1000,
      heightCm: 1000,
      walls: [],
      openings: [],
      rooms: [],
      warnings: [],
      footprint: contour.polygonCm,
    }
    expect(planVolume(draft)).toBeNull()
    const primitive: PlanVolume = {
      floor: contour.polygonCm,
      voids: [],
      walls: [],
      openings: [],
      solidFaces: [],
      wallSource: 'centerline',
      joinedSolids: false,
      issues: [],
    }
    const scene = buildPlanScene(primitive)
    const floor = scene.surfaces.find((surface) => surface.kind === 'floor')
    if (!floor) throw new Error('Missing floor primitive')
    const positions = floor.geometry.getAttribute('position')
    for (const point of contour.polygonCm)
      expect(
        Array.from({ length: positions.count }, (_, index) => index).some(
          (index) =>
            Math.abs(positions.getX(index) - point.xCm / 100) < 1e-6 &&
            Math.abs(positions.getZ(index) - point.yCm / 100) < 1e-6 &&
            positions.getY(index) === 0,
        ),
      ).toBe(true)
    for (const surface of scene.surfaces) surface.geometry.dispose()
  })
})
