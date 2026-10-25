import { describe, expect, it } from 'vitest'
import type { NativeTextAnchors } from './plan-document'
import { nativeFillCandidates } from './plan-native-fill-candidates'
import type { PagePoint, PdfLinework, PdfVectorPath } from './plan-pdf-linework'

const source = { sha256: 'a'.repeat(64), page: 1, width: 1000, height: 1000 }
const native: NativeTextAnchors = {
  source,
  originalPdfSha256: 'b'.repeat(64),
  complete: true,
  labels: [],
  pageNormalizedScale: { x: 1, y: 1 },
}
function rectangle(left = 20, top = 20, width = 60, height = 60): PagePoint[] {
  return [
    { x: left, y: top },
    { x: left + width, y: top },
    { x: left + width, y: top + height },
    { x: left, y: top + height },
    { x: left, y: top },
  ]
}
const path = (operationIndex: number, points = rectangle(), fillColor?: string): PdfVectorPath => ({
  operationIndex,
  subpathIndex: 0,
  paint: 'fill',
  closed: true,
  points,
  ...(fillColor ? { fillColor } : {}),
})
const work: PdfLinework = {
  coordinateSystem: 'page-0-1000',
  pageWidth: 1000,
  pageHeight: 1000,
  paths: [path(1)],
  skippedCurves: 0,
  clippedPaths: 0,
  unsupportedPaths: 0,
  unsupportedContexts: 0,
  truncated: false,
}
const input = { native, work, lineworkSource: source }
describe('unclassified automatic native fill candidates', () => {
  it('keeps exact geometry and native paint provenance without asserting floor semantics', () => {
    const result = nativeFillCandidates(input)
    expect(result.candidates[0]?.polygon).toEqual(rectangle().slice(0, -1))
    expect(result.candidates[0]?.sourceRef).toEqual({ operationIndex: 1, subpathIndex: 0 })
    expect(result.semanticStatus).toBe('unclassified')
    expect(result.status).toBe('draft')
    expect(result.polygonCoordinateSystem).toBe('page-0-1000')
    expect(input.work.paths[0]?.points).toHaveLength(5)
  })
  it('does not assume a special room colour or require a text layer for geometry', () => {
    const result = nativeFillCandidates({
      ...input,
      native: { ...native, complete: false },
      work: {
        ...work,
        paths: [
          path(1, rectangle(), '#ffffff'),
          path(2, rectangle(120), '#aaaaaa'),
          path(3, rectangle(220)),
        ],
      },
    })
    expect(result.candidates).toHaveLength(3)
    expect(result.candidates[0]?.fillColor).toBe('#ffffff')
    expect(result.candidates[2]?.fillColor).toBeUndefined()
  })
  it('retains a diagonal and canonicalises only winding and starting vertex', () => {
    const polygon = [
      { x: 20, y: 20 },
      { x: 80, y: 20 },
      { x: 80, y: 60 },
      { x: 60, y: 80 },
      { x: 20, y: 80 },
    ]
    const result = nativeFillCandidates({
      ...input,
      work: { ...work, paths: [path(1, [...polygon].reverse())] },
    })
    expect(result.candidates[0]?.polygon).toEqual(polygon)
  })
  it('refuses compound fill operations instead of filling unrepresented holes', () => {
    const result = nativeFillCandidates({
      ...input,
      work: {
        ...work,
        paths: [path(1), { ...path(1, rectangle(40, 40, 20, 20)), subpathIndex: 1 }],
      },
    })
    expect(result.candidates).toEqual([])
    expect(result.rejectedCount).toBe(2)
    expect(result.rejected[0]?.reason).toBe('compound-or-omitted-fill-topology')
  })
  it('refuses a fill operation with an omitted curved subpath', () => {
    const result = nativeFillCandidates({
      ...input,
      work: {
        ...work,
        skippedCurves: 1,
        skippedCurveBounds: [
          { operationIndex: 1, bounds: { left: 40, top: 40, right: 50, bottom: 50 } },
        ],
      },
    })
    expect(result.candidates).toEqual([])
  })
  it('refuses a later sole subpath when earlier degenerate subpaths were not emitted', () => {
    const result = nativeFillCandidates({
      ...input,
      work: { ...work, paths: [{ ...path(1), subpathIndex: 1 }] },
    })
    expect(result.candidates).toEqual([])
    expect(result.rejected[0]?.reason).toBe('compound-or-omitted-fill-topology')
  })
  it('does not promote crop edges, tiny shapes or strokes to floor candidates', () => {
    const result = nativeFillCandidates({
      ...input,
      work: {
        ...work,
        paths: [
          path(1, rectangle(0)),
          path(2, rectangle(20, 20, 10, 10)),
          { ...path(3), paint: 'stroke' },
        ],
      },
    })
    expect(result.candidates).toEqual([])
    expect(result.ignoredFrameFills).toBe(1)
    expect(result.filteredSmallFills).toBe(1)
  })
  it('rejects self-crossing paint geometry without replacing it with a bounding box', () => {
    const result = nativeFillCandidates({
      ...input,
      work: {
        ...work,
        paths: [
          path(1, [
            { x: 20, y: 20 },
            { x: 80, y: 80 },
            { x: 20, y: 80 },
            { x: 80, y: 20 },
          ]),
        ],
      },
    })
    expect(result.candidates).toEqual([])
    expect(result.rejected[0]?.reason).toBe('non-simple-native-fill')
  })
  it.each([
    { ...work, truncated: true },
    { ...work, unsupportedContexts: 1 },
    { ...work, skippedCurves: 1 },
  ])('refuses incomplete native coverage', (invalid) => {
    const result = nativeFillCandidates({ ...input, work: invalid })
    expect(result.candidates).toEqual([])
    expect(result.truncated).toBe(true)
  })
  it('marks an over-limit candidate inventory incomplete', () => {
    const paths = Array.from({ length: 51 }, (_, index) =>
      path(index + 1, rectangle(20 + (index % 7) * 120, 20 + Math.floor(index / 7) * 120)),
    )
    const result = nativeFillCandidates({ ...input, work: { ...work, paths } })
    expect(result.candidates).toHaveLength(50)
    expect(result.truncated).toBe(true)
    expect(result.refusalReason).toBe('candidate-limit')
  })
  it('keeps fill evidence on a complete page with 6000 straight source paths', () => {
    const strokes: PdfVectorPath[] = Array.from({ length: 5999 }, (_, index) => ({
      ...path(index + 2),
      paint: 'stroke',
      closed: false,
      points: [
        { x: 10, y: 10 },
        { x: 20, y: 20 },
      ],
    }))
    const result = nativeFillCandidates({
      ...input,
      work: { ...work, paths: [path(1), ...strokes] },
    })
    expect(result.refusalReason).toBeNull()
    expect(result.candidates).toHaveLength(1)
    expect(result.candidates[0]?.sourceRef.operationIndex).toBe(1)
  })
  it.each([
    {
      count: 12_001,
      points: [
        { x: 10, y: 10 },
        { x: 20, y: 20 },
      ],
    },
    {
      count: 10_001,
      points: [
        { x: 10, y: 10 },
        { x: 20, y: 20 },
        { x: 30, y: 10 },
      ],
    },
  ])(
    'refuses an over-budget straight inventory instead of accepting its first fill',
    ({ count, points }) => {
      const paths = Array.from({ length: count }, (_, index) => ({ ...path(index + 1), points }))
      const result = nativeFillCandidates({ ...input, work: { ...work, paths } })
      expect(result.refusalReason).toBe('incomplete-native-layer')
      expect(result.candidates).toEqual([])
    },
  )
  it('rejects stale source frames and invalid raster mapping', () => {
    expect(() =>
      nativeFillCandidates({ ...input, lineworkSource: { ...source, page: 2 } }),
    ).toThrow()
    expect(() =>
      nativeFillCandidates({
        ...input,
        native: { ...native, pageNormalizedScale: { x: 2, y: 1 } },
      }),
    ).toThrow()
  })
})
