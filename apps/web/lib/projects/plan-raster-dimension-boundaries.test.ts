import { describe, expect, it } from 'vitest'
import type { NativeTextAnchors } from './plan-document'
import type { nativeDimensionEvidence } from './plan-native-dimension-evidence'
import { rasterDimensionBoundaryAudit } from './plan-raster-dimension-boundaries'

const source = { sha256: 'a'.repeat(64), page: 1, width: 1000, height: 1000 }
const native: NativeTextAnchors = {
  source,
  complete: true,
  originalPdfSha256: 'b'.repeat(64),
  pageNormalizedScale: { x: 1, y: 1 },
  labels: [],
}
const start = { x: 20, y: 50 },
  end = { x: 80, y: 50 }
const dimensions: ReturnType<typeof nativeDimensionEvidence> = {
  status: 'draft',
  source: { sha256: 'b'.repeat(64), pdfPage: 1, state: 'existing' },
  rasterSource: source,
  chains: [
    {
      id: 'printed-chain',
      labelIds: ['native-text-1'],
      result: {
        status: 'candidate',
        totalMm: 1000,
        axis: 'width',
        labelIndexes: [1],
        lineOperations: [10],
        ends: [start, end],
        basis: 'native-page-dimension',
        segments: [{ labelIndex: 1, valueMm: 1000, start, end }],
      },
      rails: [{ operationIndex: 10, subpathIndex: 0, points: [start, end] }],
    },
  ],
  nativeCoverageWarnings: {
    skippedCurves: 0,
    clippedPaths: 0,
    unsupportedPaths: 0,
    unsupportedContexts: 0,
  },
}
const rectangle = (left: number, top: number, right: number, bottom: number) => [
  { x: left, y: top },
  { x: right, y: top },
  { x: right, y: bottom },
  { x: left, y: bottom },
]
const input = {
  native,
  dimensions,
  regions: [{ id: 'fragment', polygon: rectangle(20, 51, 80, 150) }],
}
describe('annotation boundary admission guard', () => {
  it('blocks a candidate whose boundary follows a printed dimension span', () => {
    const result = rasterDimensionBoundaryAudit(input)
    expect(result.audits[0]?.status).toBe('blocked-annotation-boundary')
    expect(result.audits[0]?.annotationBoundaryMatches[0]).toEqual({
      edgeIndex: 0,
      chainId: 'printed-chain',
      labelIndex: 1,
      operationIndex: 10,
      subpathIndex: 0,
      overlapPx: 60,
      maxDistancePx: 1,
    })
    expect(result.status).toBe('draft')
  })
  it.each([
    { polygon: rectangle(20, 53, 80, 150) },
    { polygon: rectangle(45, 20, 55, 80) },
    { polygon: rectangle(80, 51, 120, 150) },
  ])(
    'does not confuse distant, crossed or endpoint-only lines with a shared boundary',
    ({ polygon }) => {
      const result = rasterDimensionBoundaryAudit({
        ...input,
        regions: [{ id: 'unchecked', polygon }],
      })
      expect(result.audits[0]?.status).toBe('needs-source-review')
      expect(result.audits[0]?.annotationBoundaryMatches).toEqual([])
    },
  )
  it('never accepts a floor merely because dimension evidence is absent or unresolved', () => {
    const result = rasterDimensionBoundaryAudit({
      ...input,
      dimensions: { ...dimensions, chains: [] },
    })
    expect(result.audits[0]?.status).toBe('needs-source-review')
  })
  it('requires five pixels of actual projected overlap', () => {
    const result = rasterDimensionBoundaryAudit({
      ...input,
      regions: [{ id: 'short', polygon: rectangle(78, 51, 100, 150) }],
    })
    expect(result.audits[0]?.status).toBe('needs-source-review')
  })
  it('keeps partial-span provenance instead of marking an entire native operation', () => {
    const result = rasterDimensionBoundaryAudit({
      ...input,
      regions: [{ id: 'partial', polygon: rectangle(5, 51, 40, 150) }],
    })
    expect(result.audits[0]?.annotationBoundaryMatches[0]?.overlapPx).toBe(20)
  })
  it('handles reversed spans with unchanged overlap', () => {
    const chain = dimensions.chains[0]
    if (chain?.result.status !== 'candidate') throw new Error('Missing fixture chain')
    const reversed: typeof dimensions = {
      ...dimensions,
      chains: [
        {
          ...chain,
          result: {
            ...chain.result,
            ends: [end, start],
            segments: [{ labelIndex: 1, valueMm: 1000, start: end, end: start }],
          },
        },
      ],
    }
    const result = rasterDimensionBoundaryAudit({ ...input, dimensions: reversed })
    expect(result.audits[0]?.annotationBoundaryMatches[0]?.overlapPx).toBe(60)
  })
  it('uses pixel distance after anisotropic page-to-raster scaling', () => {
    const rasterSource = { ...source, height: 500 }
    const result = rasterDimensionBoundaryAudit({
      native: { ...native, source: rasterSource, pageNormalizedScale: { x: 1, y: 0.5 } },
      dimensions: { ...dimensions, rasterSource },
      regions: [{ id: 'scaled', polygon: rectangle(20, 26, 80, 100) }],
    })
    expect(result.audits[0]?.annotationBoundaryMatches[0]?.maxDistancePx).toBe(1)
  })
  it('matches a diagonal span without rectifying the contour', () => {
    const chain = dimensions.chains[0]
    if (chain?.result.status !== 'candidate') throw new Error('Missing fixture chain')
    const first = { x: 20, y: 20 },
      last = { x: 80, y: 80 }
    const diagonal: typeof dimensions = {
      ...dimensions,
      chains: [
        {
          ...chain,
          result: {
            ...chain.result,
            axis: 'aligned',
            ends: [first, last],
            segments: [{ labelIndex: 1, valueMm: 1000, start: first, end: last }],
          },
          rails: [{ operationIndex: 10, subpathIndex: 0, points: [first, last] }],
        },
      ],
    }
    const polygon = [
      { x: 20, y: 22 },
      { x: 80, y: 82 },
      { x: 100, y: 62 },
      { x: 40, y: 2 },
    ]
    const result = rasterDimensionBoundaryAudit({
      ...input,
      dimensions: diagonal,
      regions: [{ id: 'diagonal', polygon }],
    })
    expect(result.audits[0]?.status).toBe('blocked-annotation-boundary')
    expect(result.audits[0]?.annotationBoundaryMatches[0]?.maxDistancePx).toBeCloseTo(Math.SQRT2)
    expect(polygon[0]).toEqual({ x: 20, y: 22 })
  })
  it('keeps the exact two-pixel and five-pixel admission thresholds', () => {
    const edge = rasterDimensionBoundaryAudit({
      ...input,
      regions: [{ id: 'threshold', polygon: rectangle(75, 52, 100, 100) }],
    })
    expect(edge.audits[0]?.annotationBoundaryMatches[0]).toMatchObject({
      overlapPx: 5,
      maxDistancePx: 2,
    })
    const short = rasterDimensionBoundaryAudit({
      ...input,
      regions: [{ id: 'shorter', polygon: rectangle(75.001, 52, 100, 100) }],
    })
    expect(short.audits[0]?.status).toBe('needs-source-review')
  })
  it.each([
    { ...input, native: { ...native, complete: false } },
    { ...input, native: { ...native, pageNormalizedScale: { x: 2, y: 1 } } },
    { ...input, dimensions: { ...dimensions, rasterSource: { ...source, page: 2 } } },
    {
      ...input,
      dimensions: { ...dimensions, source: { ...dimensions.source, sha256: 'c'.repeat(64) } },
    },
  ])('rejects stale or incomplete source evidence', (invalid) => {
    expect(() => rasterDimensionBoundaryAudit(invalid)).toThrow()
  })
})
