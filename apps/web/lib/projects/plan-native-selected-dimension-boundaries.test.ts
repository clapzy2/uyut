import { createHash } from 'node:crypto'
import { existsSync } from 'node:fs'
import { readFile } from 'node:fs/promises'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { preparePlanPage } from './plan-document'
import * as captionBindings from './plan-native-caption-bindings'
import { nativeCaptionBindings } from './plan-native-caption-bindings'
import { nativeFaceRationalPredicates } from './plan-native-face-rational'
import * as floorReview from './plan-native-painted-floor-review'
import { nativeSelectedDimensionBoundaries } from './plan-native-selected-dimension-boundaries'
import { nativeVisiblePaintRegions } from './plan-native-visible-paint'

type Input = Parameters<typeof nativeSelectedDimensionBoundaries>[0]
const required = <T>(value: T | undefined): T => {
  if (value === undefined) throw new Error('Missing fixture value')
  return value
}
function fixture(): Input {
  const source = { sha256: 'b'.repeat(64), pdfPage: 1, state: 'existing' as const }
  const frame = { sha256: 'a'.repeat(64), page: 1, width: 1000, height: 1000 }
  const origin = { x: 191, y: 168 }
  const input: Input = {
    source,
    lineworkSource: frame,
    native: {
      source: frame,
      originalPdfSha256: source.sha256,
      complete: true,
      pageNormalizedScale: { x: 1, y: 1 },
      labels: [
        {
          id: 'native-text-1',
          nativeIndex: 1,
          compactIndex: 0,
          name: 'Кухня',
          rotation: 0,
          point: { x: 150, y: 350 },
          pagePoint: { x: 150, y: 350 },
        },
        {
          id: 'native-text-2',
          nativeIndex: 2,
          compactIndex: 1,
          name: '2',
          rotation: 0,
          point: { x: 150, y: 370 },
          pagePoint: { x: 150, y: 370 },
        },
        {
          id: 'native-text-10',
          nativeIndex: 10,
          compactIndex: 2,
          name: '200',
          rotation: 0,
          point: origin,
          pagePoint: origin,
        },
      ],
      compactCaptionGeometry: {
        source: { sha256: source.sha256, pdfPage: 1, pageWidth: 1000, pageHeight: 1000 },
        complete: true,
        items: [
          {
            index: 1,
            text: '2',
            rotation: 0,
            origin: { x: 150, y: 370 },
            baselineStart: { x: 150, y: 370 },
            baselineEnd: { x: 152, y: 370 },
          },
          {
            index: 2,
            text: '200',
            rotation: 0,
            origin,
            baselineStart: origin,
            baselineEnd: { x: 209, y: 168 },
          },
        ],
      },
    },
    work: {
      coordinateSystem: 'page-0-1000',
      pageWidth: 1000,
      pageHeight: 1000,
      skippedCurves: 0,
      clippedPaths: 0,
      unsupportedPaths: 0,
      unsupportedContexts: 0,
      truncated: false,
      paths: [
        {
          operationIndex: 1,
          subpathIndex: 0,
          paint: 'stroke',
          closed: false,
          points: [
            { x: 100, y: 170 },
            { x: 300, y: 170 },
          ],
        },
        {
          operationIndex: 2,
          subpathIndex: 0,
          paint: 'stroke',
          closed: false,
          points: [
            { x: 95, y: 175 },
            { x: 105, y: 165 },
          ],
        },
        {
          operationIndex: 3,
          subpathIndex: 0,
          paint: 'stroke',
          closed: false,
          points: [
            { x: 295, y: 175 },
            { x: 305, y: 165 },
          ],
        },
        {
          operationIndex: 10,
          subpathIndex: 0,
          paint: 'fill',
          closed: true,
          points: [
            { x: 100, y: 300 },
            { x: 300, y: 300 },
            { x: 270, y: 450 },
            { x: 120, y: 450 },
          ],
        },
      ],
    },
    reviewed: {
      review: 'manual-native-painted-floor-review',
      source,
      rasterSource: frame,
      floors: [],
    },
  }
  const region = required(nativeVisiblePaintRegions(input).regions[0])
  const piece = required(region.pieces[0])
  input.reviewed.floors.push({
    candidateId: region.candidateId,
    pieceIndex: 0,
    polygon: piece.polygon,
    holes: piece.holes,
    owner: { sourceRoomKey: '2', nameLabelId: 'native-text-1', numberLabelId: 'native-text-2' },
    boundaryRoles: piece.polygon.map((_, edgeIndex) => ({ edgeIndex, kind: 'unresolved' })),
  })
  return input
}
afterEach(() => vi.restoreAllMocks())

describe('selected-floor equal source-vector proposals', () => {
  function wholeSpanFixture() {
    const input = fixture()
    const floorPath = required(input.work.paths.find((path) => path.operationIndex === 10))
    input.work.paintBounds = {
      complete: true,
      refusalReason: null,
      events: [
        {
          operationIndex: 10,
          kind: 'vector',
          subpathCount: 1,
          reason: null,
          bounds: { left: 99, top: 299, right: 301, bottom: 501 },
        },
      ],
    }
    const result = nativeSelectedDimensionBoundaries(input)
    const candidate = required(required(result.observations[0]).candidates[0])
    return { input, floorPath, candidate }
  }
  it('checks the entire literal selected segment without accepting physical boundaries or its ink strip', () => {
    const { input, candidate } = wholeSpanFixture()
    const before = structuredClone(input)
    expect(candidate.boundaryVisibility).toEqual({
      scope: 'literal-selected-edge-segment',
      status: 'unoccluded',
      reason: null,
      sourceRef: { operationIndex: 10, subpathIndex: 0, segmentIndex: 0 },
      blockerOperations: [],
    })
    expect(nativeSelectedDimensionBoundaries(input).physicalBoundariesAccepted).toBe(false)
    expect(input).toEqual(before)
  })
  it('holds late paint crossing the middle even when both selected endpoints are outside', () => {
    const { input } = wholeSpanFixture()
    required(input.work.paintBounds).events.push({
      operationIndex: 20,
      kind: 'image',
      reason: null,
      bounds: { left: 195, top: 295, right: 205, bottom: 305 },
    })
    expect(
      required(required(nativeSelectedDimensionBoundaries(input).observations[0]).candidates[0])
        .boundaryVisibility,
    ).toMatchObject({
      status: 'held',
      reason: 'later-paint-may-cover-selected-segment',
      blockerOperations: [20],
    })
  })
  it('does not use rounded display agreement as a literal source endpoint', () => {
    const { input } = wholeSpanFixture()
    const report = floorReview.nativePaintedFloorReview(input)
    const selected = required(report.floors[0])
    // Both endpoints shift equally, preserving the vector but not source identity.
    selected.exactPointKeys[0] = '300000000001/3000000000:300/1'
    selected.exactPointKeys[1] = '900000000001/3000000000:300/1'
    vi.spyOn(floorReview, 'nativePaintedFloorReview').mockReturnValue(report)
    expect(
      required(required(nativeSelectedDimensionBoundaries(input).observations[0]).candidates[0])
        .boundaryVisibility,
    ).toMatchObject({
      status: 'held',
      reason: 'selected-segment-source-not-unique',
      sourceRef: null,
    })
  })
  it.each(['inventory', 'compound', 'missing-paint', 'unknown-later'])(
    'holds whole selected source span with %s uncertainty',
    (kind) => {
      const { input } = wholeSpanFixture(),
        paint = required(input.work.paintBounds)
      if (kind === 'inventory') paint.complete = false
      if (kind === 'compound') required(paint.events[0]).subpathCount = 2
      if (kind === 'missing-paint') paint.events = []
      if (kind === 'unknown-later')
        paint.events.push({
          operationIndex: 20,
          kind: 'unknown',
          bounds: null,
          reason: 'unbounded-paint',
        })
      const result = nativeSelectedDimensionBoundaries(input)
      expect(
        required(required(result.observations[0]).candidates[0]).boundaryVisibility?.status,
      ).toBe('held')
      expect(result.mayTransfer2D).toBe(false)
      expect(result.mayTransfer3D).toBe(false)
    },
  )
  it('proposes an untouched whole edge without asserting visibility or physical acceptance', () => {
    const input = fixture()
    const before = structuredClone(input)
    const result = nativeSelectedDimensionBoundaries(input, nativeCaptionBindings(input))
    expect(result).toMatchObject({
      status: 'draft',
      refusalReason: null,
      physicalBoundariesAccepted: false,
      mayTransfer2D: false,
      mayTransfer3D: false,
    })
    expect(result.observations).toEqual([
      {
        labelId: 'native-text-10',
        valueMm: 200,
        status: 'candidate',
        reason: 'physical-boundary-proof-missing',
        candidates: [
          {
            floorId: 'native-fill-10:0:piece-0',
            sourceRoomKey: '2',
            edgeIndex: 0,
            declaredRole: 'unresolved',
            span: 'whole-translated-source-vector',
            sourceRefs: [{ operationIndex: 10, subpathIndex: 0, segmentIndex: 0 }],
            boundaryInkComplete: true,
          },
        ],
      },
    ])
    expect(input).toEqual(before)
  })
  it('retains separately bounded equal faces as ambiguous rather than selecting nearest', () => {
    const input = fixture()
    const report = floorReview.nativePaintedFloorReview(input)
    const alternative = structuredClone(required(report.floors[0]))
    alternative.id = 'other-reviewed-piece'
    alternative.owner.sourceRoomKey = '3'
    report.floors.push(alternative)
    vi.spyOn(floorReview, 'nativePaintedFloorReview').mockReturnValue(report)
    expect(nativeSelectedDimensionBoundaries(input).observations[0]).toMatchObject({
      status: 'ambiguous',
      candidates: [{ sourceRoomKey: '2' }, { sourceRoomKey: '3' }],
    })
  })
  it('does not treat declared wall or opening roles as physical proof', () => {
    const input = fixture()
    required(required(input.reviewed.floors[0]).boundaryRoles[0]).kind = 'wall-face'
    expect(nativeSelectedDimensionBoundaries(input)).toMatchObject({
      physicalBoundariesAccepted: false,
      observations: [
        { reason: 'physical-boundary-proof-missing', candidates: [{ declaredRole: 'wall-face' }] },
      ],
    })
  })
  it('marks incomplete source boundaries without hiding the exact owner proposal', () => {
    const input = fixture()
    const report = floorReview.nativePaintedFloorReview(input)
    required(report.floors[0]).boundaryInkComplete = false
    vi.spyOn(floorReview, 'nativePaintedFloorReview').mockReturnValue(report)
    expect(nativeSelectedDimensionBoundaries(input).observations[0]).toMatchObject({
      status: 'candidate',
      reason: 'incomplete-source-boundary',
      candidates: [{ boundaryInkComplete: false }],
    })
  })
  it.each([199.999999999, 150])('does not expand shorter or near-equal spans (%s)', (length) => {
    const input = fixture()
    const path = required(input.work.paths[3])
    required(path.points[1]).x = 100 + length
    const piece = required(required(nativeVisiblePaintRegions(input).regions[0]).pieces[0])
    required(input.reviewed.floors[0]).polygon = piece.polygon
    expect(nativeSelectedDimensionBoundaries(input).observations[0]).toMatchObject({
      status: 'unresolved',
      candidates: [],
      reason: 'no-equal-whole-selected-boundary-vector',
    })
  })
  it('handles reversed source rail endpoints without changing the candidate', () => {
    const input = fixture()
    const before = nativeSelectedDimensionBoundaries(input)
    required(input.work.paths[0]).points.reverse()
    expect(nativeSelectedDimensionBoundaries(input)).toEqual(before)
  })
  it('uses proven rational keys rather than rounded displayed floor endpoints', () => {
    const input = fixture()
    const report = floorReview.nativePaintedFloorReview(input)
    required(report.floors[0]).exactPointKeys[0] = '300000000001/3000000000:300/1'
    // The display still says x=100, but the exact start differs by 1/3e9.
    vi.spyOn(floorReview, 'nativePaintedFloorReview').mockReturnValue(report)
    expect(nativeSelectedDimensionBoundaries(input).observations[0]?.candidates).toEqual([])
  })
  it('refuses stale bindings, source mismatches, stale geometry and proof hint keys', () => {
    const input = fixture()
    const bindings = nativeCaptionBindings(input)
    required(bindings.candidates[0]).valueMm++
    expect(nativeSelectedDimensionBoundaries(input, bindings).refusalReason).toBe(
      'stale-source-caption-bindings',
    )
    input.reviewed.source = { ...input.source, sha256: 'c'.repeat(64) }
    expect(nativeSelectedDimensionBoundaries(input).refusalReason).toBe(
      'painted-floor-review-source-mismatch',
    )
    input.reviewed.source = input.source
    Object.assign(input.reviewed, { physicalBoundariesAccepted: true })
    expect(nativeSelectedDimensionBoundaries(input).refusalReason).toBe(
      'invalid-painted-floor-review',
    )
  })
  it('refuses modified declarations and duplicate reviewed owners', () => {
    const input = fixture()
    Object.assign(required(required(input.reviewed.floors[0]).boundaryRoles[0]), {
      physicalJambAccepted: true,
    })
    expect(nativeSelectedDimensionBoundaries(input).refusalReason).toBe(
      'invalid-painted-floor-boundary-roles',
    )
    delete (
      required(required(input.reviewed.floors[0]).boundaryRoles[0]) as {
        physicalJambAccepted?: boolean
      }
    ).physicalJambAccepted
    input.reviewed.floors.push(structuredClone(required(input.reviewed.floors[0])))
    expect(nativeSelectedDimensionBoundaries(input).refusalReason).toBe(
      'duplicate-painted-floor-piece',
    )
  })
  it('refuses stale selected geometry and incomplete source vector evidence', () => {
    const input = fixture()
    required(required(input.reviewed.floors[0]).polygon[0]).x++
    expect(nativeSelectedDimensionBoundaries(input).refusalReason).toBe(
      'stale-painted-floor-selection',
    )
    const clean = fixture()
    clean.native.vectorInkRefusal = 'hidden-native-vector-optional-content'
    expect(nativeSelectedDimensionBoundaries(clean)).toMatchObject({
      refusalReason: 'source-vector-ink-unverified',
      observations: [],
      physicalBoundariesAccepted: false,
    })
  })
  it('clears all proposals when the output limit is reached', () => {
    const input = fixture()
    const fresh = nativeCaptionBindings(input)
    const dimension = required(fresh.candidates[0])
    fresh.candidates = Array.from({ length: 1000 }, (_, index) => ({
      ...dimension,
      labelId: `native-text-${index + 10}`,
    }))
    const report = floorReview.nativePaintedFloorReview(input)
    const floor = required(report.floors[0])
    report.floors = Array.from({ length: 3 }, (_, index) => ({
      ...floor,
      id: `floor-${index}`,
    }))
    vi.spyOn(captionBindings, 'nativeCaptionBindings').mockReturnValue(fresh)
    vi.spyOn(floorReview, 'nativePaintedFloorReview').mockReturnValue(report)
    expect(nativeSelectedDimensionBoundaries(input)).toMatchObject({
      status: 'unresolved',
      refusalReason: 'selected-dimension-output-limit',
      observations: [],
    })
  })
  it('bounds exhaustive unequal-span comparisons and retains no partial result', () => {
    const input = fixture()
    const fresh = nativeCaptionBindings(input)
    const dimension = required(fresh.candidates[0])
    fresh.candidates = Array.from({ length: 1000 }, (_, index) => ({
      ...dimension,
      labelId: `native-text-${index + 10}`,
    }))
    const report = floorReview.nativePaintedFloorReview(input)
    const floor = required(report.floors[0])
    const edge = required(floor.edges[0])
    report.floors = Array.from({ length: 50 }, (_, index) => ({
      ...floor,
      id: `floor-${index}`,
      edges: Array.from({ length: 100 }, () => edge),
      exactPointKeys: Array.from({ length: 100 }, (_, point) => `${point}/1:300/1`),
    }))
    vi.spyOn(captionBindings, 'nativeCaptionBindings').mockReturnValue(fresh)
    vi.spyOn(floorReview, 'nativePaintedFloorReview').mockReturnValue(report)
    expect(nativeSelectedDimensionBoundaries(input)).toMatchObject({
      status: 'unresolved',
      refusalReason: 'selected-dimension-work-limit',
      observations: [],
    })
  })
  it('keeps rational vector comparison exact under reversal and nonterminating fractions', () => {
    const exact = nativeFaceRationalPredicates()
    expect(exact.equalSpanVectors('1/3:2/7', '601/3:2/7', '100/1:300/1', '300/1:300/1')).toBe(true)
    expect(exact.equalSpanVectors('601/3:2/7', '1/3:2/7', '300/1:300/1', '100/1:300/1')).toBe(true)
    expect(
      exact.equalSpanVectors(
        '1/3:2/7',
        '601000000001/3000000000:2/7',
        '100/1:300/1',
        '300/1:300/1',
      ),
    ).toBe(false)
  })

  const original = new URL(
    '../../../../output/pdf/source-search-20261003/rebrina-original.pdf',
    import.meta.url,
  )
  it.skipIf(!existsSync(original))(
    'links the real 684 vector to the selected room 2 edge only as a proposal',
    async () => {
      const body = await readFile(original)
      const hash = createHash('sha256').update(body).digest('hex')
      expect(hash).toBe('2e141c135812c81719e1f4783173cb5202e20041ac494d3cc799eb37ad62ad4e')
      const page = await preparePlanPage(body, true, 3, true, true)
      const common = {
        source: { sha256: hash, pdfPage: 3, state: 'existing' as const },
        native: required(page.nativeTextAnchors),
        work: required(page.linework),
        lineworkSource: required(page.lineworkRasterSource),
      }
      const region = required(
        nativeVisiblePaintRegions(common).regions.find(
          (region) => region.candidateId === 'native-fill-1462:0',
        ),
      )
      const piece = required(region.pieces[0])
      const reviewed: floorReview.ReviewedNativePaintedFloors = {
        review: 'manual-native-painted-floor-review',
        source: common.source,
        rasterSource: common.native.source,
        floors: [
          {
            candidateId: region.candidateId,
            pieceIndex: 0,
            polygon: piece.polygon,
            holes: piece.holes,
            owner: {
              sourceRoomKey: '2',
              nameLabelId: 'native-text-179',
              numberLabelId: 'native-text-181',
            },
            boundaryRoles: piece.polygon.map((_, edgeIndex) => ({ edgeIndex, kind: 'unresolved' })),
          },
        ],
      }
      const input = { ...common, reviewed }
      const before = structuredClone(input)
      const result = nativeSelectedDimensionBoundaries(input)
      const row = required(result.observations.find((row) => row.valueMm === 684))
      expect(row).toMatchObject({
        status: 'candidate',
        reason: 'incomplete-source-boundary',
        candidates: [
          {
            floorId: 'native-fill-1462:0:piece-0',
            sourceRoomKey: '2',
            edgeIndex: 40,
            sourceRefs: [{ operationIndex: 1858, subpathIndex: 0, segmentIndex: 2 }],
          },
        ],
      })
      expect(result.physicalBoundariesAccepted).toBe(false)
      expect(result.mayTransfer2D).toBe(false)
      expect(result.mayTransfer3D).toBe(false)
      expect(input).toEqual(before)
    },
    30_000,
  )
})
