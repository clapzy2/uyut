import { describe, expect, it } from 'vitest'
import type { PdfLinework } from './plan-pdf-linework'
import {
  nativeEdgeCrossing,
  nativePageSegments,
  sourceOpeningEndpoint,
} from './plan-pdf-opening-endpoint'

const edge = [
  { x: 10, y: 10 },
  { x: 30, y: 10 },
] as const
const segment = {
  operationIndex: 5,
  subpathIndex: 0,
  segmentIndex: 0,
  start: { x: 20, y: 4 },
  end: { x: 20, y: 12 },
}
const proof = {
  kind: 'native-edge-crossing' as const,
  operationIndex: 5,
  subpathIndex: 0,
  segmentIndex: 0,
}
const nativePoints = new Set(['10:10', '30:10'])
const work: PdfLinework = {
  coordinateSystem: 'page-0-1000',
  pageWidth: 1000,
  pageHeight: 1000,
  paths: [
    {
      operationIndex: 5,
      subpathIndex: 0,
      paint: 'stroke',
      closed: false,
      points: [segment.start, segment.end],
    },
  ],
  truncated: false,
  skippedCurves: 0,
  unsupportedPaths: 0,
  unsupportedContexts: 0,
  clippedPaths: 0,
}

describe('bounded native segment / declared opening-edge crossing', () => {
  it('computes the exact crossing without fabricating an extractor vertex', () => {
    expect(nativeEdgeCrossing(edge, segment)).toEqual({ x: 20, y: 10 })
    expect(
      sourceOpeningEndpoint({ x: 20, y: 10 }, proof, edge, nativePoints, nativePageSegments(work)),
    ).toBe(true)
    expect(nativePoints.has('20:10')).toBe(false)
    expect(sourceOpeningEndpoint({ x: 20, y: 10 }, undefined, edge, nativePoints, [segment])).toBe(
      false,
    )
    expect(sourceOpeningEndpoint(edge[0], undefined, edge, nativePoints, [])).toBe(true)
  })

  it.each([
    { ...segment, end: { x: 20, y: 9 } },
    { ...segment, start: { x: 35, y: 4 }, end: { x: 35, y: 12 } },
    { ...segment, end: { x: 21, y: 12 } },
    { ...segment, start: { x: 20, y: 10 }, end: { x: 25, y: 10 } },
  ])(
    'refuses extensions, out-of-edge points, diagonals and overlapping strokes $end',
    (invalid) => {
      expect(nativeEdgeCrossing(edge, invalid)).toBeUndefined()
    },
  )

  it('refuses a forged coordinate, source reference, edge or duplicate identity', () => {
    expect(sourceOpeningEndpoint({ x: 20.001, y: 10 }, proof, edge, nativePoints, [segment])).toBe(
      false,
    )
    expect(
      sourceOpeningEndpoint(
        { x: 20, y: 10 },
        { ...proof, operationIndex: 99 },
        edge,
        nativePoints,
        [segment],
      ),
    ).toBe(false)
    expect(
      sourceOpeningEndpoint(
        { x: 20, y: 10 },
        proof,
        [
          { x: 10, y: 11 },
          { x: 30, y: 11 },
        ],
        nativePoints,
        [segment],
      ),
    ).toBe(false)
    expect(
      sourceOpeningEndpoint({ x: 20, y: 10 }, proof, edge, nativePoints, [segment, segment]),
    ).toBe(false)
  })

  it('does not use fills or an unsupported/truncated source layer as crossing strokes', () => {
    expect(
      nativePageSegments({
        ...work,
        paths: work.paths.map((path) => ({ ...path, paint: 'fill' })),
      }),
    ).toEqual([])
    expect(nativePageSegments({ ...work, truncated: true })).toEqual([])
    expect(nativePageSegments({ ...work, unsupportedContexts: 1 })).toEqual([])
    expect(nativePageSegments({ ...work, unsupportedPaths: 1 })).toEqual([])
  })
})
