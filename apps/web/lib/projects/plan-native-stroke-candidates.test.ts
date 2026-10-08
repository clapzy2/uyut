import { describe, expect, it } from 'vitest'
import type { NativeTextAnchors } from './plan-document'
import { nativeStrokeCycleCandidates } from './plan-native-stroke-candidates'
import type { PagePoint, PdfLinework, PdfVectorPath } from './plan-pdf-linework'

const source = { sha256: 'a'.repeat(64), page: 1, width: 1000, height: 1000 }
const rectangle = [
  { x: 100, y: 100 },
  { x: 400, y: 100 },
  { x: 400, y: 400 },
  { x: 100, y: 400 },
]
function fixture(polygon: PagePoint[] = rectangle) {
  const native: NativeTextAnchors = {
    source,
    originalPdfSha256: 'b'.repeat(64),
    pageNormalizedScale: { x: 1, y: 1 },
    complete: true,
    labels: [],
  }
  const paths: PdfVectorPath[] = polygon.map((point, index) => ({
    operationIndex: index,
    subpathIndex: 0,
    paint: 'stroke',
    closed: false,
    points: [point, polygon[(index + 1) % polygon.length] as PagePoint],
  }))
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
  return { native, work, lineworkSource: source }
}
function addStroke(input: ReturnType<typeof fixture>, start: PagePoint, end: PagePoint) {
  input.work.paths.push({
    operationIndex: 100,
    subpathIndex: 0,
    paint: 'stroke',
    closed: false,
    points: [start, end],
  })
}
describe('unclassified native endpoint stroke cycles', () => {
  it('finds separate source strokes without fills, labels or manual refs', () => {
    const result = nativeStrokeCycleCandidates(fixture())
    expect(result).toMatchObject({
      status: 'draft',
      semanticStatus: 'unclassified',
      truncated: false,
    })
    expect(result.candidates).toHaveLength(1)
    expect(result.candidates[0]?.polygon).toEqual(rectangle)
    expect(result.candidates[0]?.pixelArea).toBe(90000)
    expect(result.candidates[0]?.sourceRefs).toHaveLength(4)
  })
  it('preserves a diagonal side and canonical geometry when paths reverse order', () => {
    const polygon = [
      ...rectangle.slice(0, 2),
      { x: 400, y: 330 },
      { x: 330, y: 400 },
      rectangle[3] as PagePoint,
    ]
    const input = fixture(polygon)
    input.work.paths.reverse()
    expect(nativeStrokeCycleCandidates(input).candidates[0]?.polygon).toEqual(polygon)
  })
  it('does not snap a subpixel endpoint gap or close a missing side', () => {
    const input = fixture()
    const edge = input.work.paths[0]
    if (!edge) throw new Error('Missing test edge')
    edge.points = [
      { x: 100.001, y: 100 },
      { x: 400, y: 100 },
    ]
    expect(nativeStrokeCycleCandidates(input).candidates).toEqual([])
    input.work.paths.pop()
    expect(nativeStrokeCycleCandidates(input).candidates).toEqual([])
  })
  it('rejects branches, duplicate geometry and self-intersections', () => {
    const branch = fixture()
    addStroke(branch, rectangle[0] as PagePoint, { x: 50, y: 50 })
    expect(nativeStrokeCycleCandidates(branch).candidates).toEqual([])
    const duplicate = fixture()
    addStroke(duplicate, rectangle[0] as PagePoint, rectangle[1] as PagePoint)
    expect(nativeStrokeCycleCandidates(duplicate).candidates).toEqual([])
    const crossing = fixture([
      rectangle[0] as PagePoint,
      rectangle[2] as PagePoint,
      rectangle[1] as PagePoint,
      rectangle[3] as PagePoint,
    ])
    expect(nativeStrokeCycleCandidates(crossing).candidates).toEqual([])
  })
  it('rejects external crossings and endpoint-interior contact, including diagonals', () => {
    for (const [start, end] of [
      [
        { x: 50, y: 150 },
        { x: 450, y: 350 },
      ],
      [
        { x: 250, y: 50 },
        { x: 250, y: 100 },
      ],
    ] as [PagePoint, PagePoint][]) {
      const input = fixture()
      addStroke(input, start, end)
      const result = nativeStrokeCycleCandidates(input)
      expect(result.candidates).toEqual([])
      expect(result.rejected.some((entry) => entry.reason === 'crossing-external-stroke')).toBe(
        true,
      )
    }
  })
  it('filters page frames and small annotation cycles', () => {
    expect(
      nativeStrokeCycleCandidates(fixture(rectangle.map((p) => ({ x: p.x - 100, y: p.y }))))
        .candidates,
    ).toEqual([])
    expect(
      nativeStrokeCycleCandidates(
        fixture(rectangle.map((p) => ({ x: p.x / 20 + 100, y: p.y / 20 + 100 }))),
      ).candidates,
    ).toEqual([])
  })
  it('refuses unknown omissions and blocks known nearby omitted geometry', () => {
    const input = fixture()
    input.work.clippedPaths = 1
    expect(nativeStrokeCycleCandidates(input)).toMatchObject({ truncated: true, candidates: [] })
    input.work.clippedPathBounds = [
      { operationIndex: 90, bounds: { left: 200, right: 210, top: 200, bottom: 210 } },
    ]
    const result = nativeStrokeCycleCandidates(input)
    expect(result.truncated).toBe(false)
    expect(result.candidates).toEqual([])
    expect(result.rejected[0]?.reason).toBe('near-omitted-geometry')
  })
  it('rejects malformed source refs before constructing the graph', () => {
    const input = fixture()
    const edge = input.work.paths[0]
    if (!edge) throw new Error('Missing test edge')
    edge.operationIndex = -1
    expect(nativeStrokeCycleCandidates(input)).toMatchObject({
      refusalReason: 'invalid-native-provenance',
      candidates: [],
    })
  })
  it('does not confuse the independent fill candidate limit with incomplete strokes', () => {
    const input = fixture()
    for (let index = 0; index < 51; index++)
      input.work.paths.push({
        operationIndex: 1000 + index,
        subpathIndex: 0,
        paint: 'fill',
        closed: true,
        points: rectangle,
      })
    const result = nativeStrokeCycleCandidates(input)
    expect(result.truncated).toBe(false)
    expect(result.candidates).toHaveLength(1)
  })
  it('keeps nested cycles unclassified rather than deciding which ring is a room', () => {
    const input = fixture()
    const inner = fixture(rectangle.map((p) => ({ x: p.x / 2 + 100, y: p.y / 2 + 100 })))
    input.work.paths.push(
      ...inner.work.paths.map((path) => ({ ...path, operationIndex: path.operationIndex + 100 })),
    )
    const result = nativeStrokeCycleCandidates(input)
    expect(result.candidates).toHaveLength(2)
    expect(result.semanticStatus).toBe('unclassified')
  })
  it('fails closed within the shared budget for a high-degree hub', () => {
    const input = fixture()
    const points: PagePoint[] = []
    for (let index = 0; index < 1000; index++) {
      points.push({ x: 700, y: 700 }, { x: 500 + index / 10, y: 500 })
    }
    input.work.paths.push({
      operationIndex: 1000,
      subpathIndex: 0,
      paint: 'stroke',
      closed: false,
      points,
    })
    expect(nativeStrokeCycleCandidates(input)).toMatchObject({
      truncated: true,
      refusalReason: 'graph-search-budget',
      candidates: [],
    })
  })
})
