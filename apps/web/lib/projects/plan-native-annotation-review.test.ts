import { describe, expect, it } from 'vitest'
import { nativeAnnotationFixture } from '../../scripts/qa-native-annotation-fixture'
import { reviewedNativeAnnotationFaces } from './plan-native-annotation-review'
import { nativeStrokeFaceCandidates } from './plan-native-stroke-candidates'

describe('source-bound partial annotation exclusion batch', () => {
  it('finds two synthetic faces including the diagonal balcony without changing source data', () => {
    const input = nativeAnnotationFixture(),
      before = structuredClone(input)
    expect(nativeStrokeFaceCandidates(input).candidates).toHaveLength(1)
    const result = reviewedNativeAnnotationFaces(input)
    if (result.status !== 'draft') throw new Error(result.reason)
    expect(result.excluded).toHaveLength(3)
    expect(result.searchedPathCount).toBe(2)
    expect(result.faces.candidates.map((entry) => entry.pixelArea).sort((a, b) => a - b)).toEqual([
      22787.5, 149100,
    ])
    expect(result.faces.semanticStatus).toBe('unclassified')
    expect(result.confirmsFloorGeometry).toBe(false)
    expect(result.completeAnnotationInventory).toBe(false)
    expect(input).toEqual(before)
  })
  it('rejects a selected annotation also declared to be a wall', () => {
    const input = nativeAnnotationFixture(),
      exclusion = input.reviewed.exclusions[0]
    if (!exclusion) throw new Error('Missing test exclusion')
    input.reviewed.walls.push(exclusion)
    expect(reviewedNativeAnnotationFaces(input)).toMatchObject({
      status: 'unresolved',
      reason: 'annotation-wall-role-conflict',
      excluded: [],
    })
  })
  it('rejects overlapping wall geometry even when its source identity differs', () => {
    const input = nativeAnnotationFixture()
    input.work.paths.push({
      operationIndex: 20,
      subpathIndex: 0,
      paint: 'stroke',
      closed: false,
      points: [
        { x: 200, y: 170 },
        { x: 400, y: 170 },
      ],
    })
    input.reviewed.walls.push({
      ref: { operationIndex: 20, subpathIndex: 0, segmentIndex: 0 },
      start: { x: 200, y: 170 },
      end: { x: 400, y: 170 },
    })
    expect(reviewedNativeAnnotationFaces(input).status).toBe('unresolved')
  })
  it.each(['coordinate', 'label', 'ref', 'role', 'value', 'duplicate', 'page'])(
    'refuses stale or unsupported %s review without partial exclusions',
    (kind) => {
      const input = nativeAnnotationFixture(),
        exclusion = input.reviewed.exclusions[0]
      if (!exclusion) throw new Error('Missing test exclusion')
      // Clone because source fixture endpoint objects are intentionally shared initially.
      input.reviewed = structuredClone(input.reviewed)
      const selected = input.reviewed.exclusions[0]
      if (!selected) throw new Error('Missing cloned exclusion')
      if (kind === 'coordinate') selected.start.x++
      if (kind === 'label') selected.label.text = '3001'
      if (kind === 'ref') selected.ref.segmentIndex = 1
      if (kind === 'role') selected.role = 'dimension-tick'
      if (kind === 'value') selected.valueMm++
      if (kind === 'duplicate') input.reviewed.exclusions.push(selected)
      if (kind === 'page') input.reviewed.source.pdfPage = 2
      expect(reviewedNativeAnnotationFaces(input)).toMatchObject({
        status: 'unresolved',
        excluded: [],
        faces: null,
      })
    },
  )
  it('preserves an unknown stroke instead of expanding the reviewed selection', () => {
    const input = nativeAnnotationFixture()
    input.work.paths.push({
      operationIndex: 30,
      subpathIndex: 0,
      paint: 'stroke',
      closed: false,
      points: [
        { x: 50, y: 200 },
        { x: 550, y: 400 },
      ],
    })
    const result = reviewedNativeAnnotationFaces(input)
    if (result.status !== 'draft') throw new Error(result.reason)
    expect(result.searchedPathCount).toBe(3)
    expect(result.faces.refusalReason).toBe('unsupported-diagonal-crossing')
    expect(result.faces.candidates).toEqual([])
  })
  it('does not close a door gap after excluding annotations', () => {
    const input = nativeAnnotationFixture(),
      living = input.work.paths[0]
    if (!living) throw new Error('Missing living contour')
    living.closed = false
    const result = reviewedNativeAnnotationFaces(input)
    if (result.status !== 'draft') throw new Error(result.reason)
    expect(result.faces.candidates).toHaveLength(1)
    expect(result.faces.candidates[0]?.pixelArea).toBe(22787.5)
  })
  it('preserves omitted-curve uncertainty after a valid partial review', () => {
    const input = nativeAnnotationFixture()
    input.work.skippedCurves = 1
    input.work.skippedCurveBounds = [
      { operationIndex: 40, bounds: { left: 200, top: 200, right: 210, bottom: 210 } },
    ]
    const result = reviewedNativeAnnotationFaces(input)
    if (result.status !== 'draft') throw new Error(result.reason)
    expect(result.faces.candidates).toHaveLength(1)
    expect(result.faces.candidates[0]?.pixelArea).toBe(22787.5)
  })
})
