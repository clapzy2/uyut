import { describe, expect, it } from 'vitest'
import type { NativeTextAnchors } from './plan-document'
import type { nativeDimensionEvidence } from './plan-native-dimension-evidence'
import { nativeFaceCycle, type ReviewedNativeFaces } from './plan-native-face-cycle'
import { planPageReviewIssue } from './plan-page-review'
import type { PagePoint, PdfLinework } from './plan-pdf-linework'

const rasterSource = { sha256: 'a'.repeat(64), page: 1, width: 1000, height: 1000 }
const source = { sha256: 'b'.repeat(64), pdfPage: 1, state: 'existing' as const }
const native: NativeTextAnchors = {
  source: rasterSource,
  originalPdfSha256: source.sha256,
  complete: true,
  labels: [],
}
const dimensions: ReturnType<typeof nativeDimensionEvidence> = {
  status: 'draft',
  source,
  rasterSource,
  chains: [],
  dimensionOperations: [],
  nativeCoverageWarnings: {
    skippedCurves: 0,
    clippedPaths: 0,
    unsupportedContexts: 0,
    unsupportedPaths: 0,
  },
}
const rectangle = [
  { x: 20, y: 20 },
  { x: 80, y: 20 },
  { x: 80, y: 80 },
  { x: 20, y: 80 },
]
function fixture(polygon: PagePoint[]) {
  const paths = polygon.map((point, index) => ({
    operationIndex: index + 1,
    subpathIndex: 0,
    paint: 'stroke' as const,
    closed: false,
    points: [point, polygon[(index + 1) % polygon.length] as PagePoint],
  }))
  const work: PdfLinework = {
    coordinateSystem: 'page-0-1000',
    pageWidth: 1000,
    pageHeight: 1000,
    paths,
    skippedCurves: 0,
    unsupportedContexts: 0,
    unsupportedPaths: 0,
    clippedPaths: 0,
    truncated: false,
  }
  const reviewed: ReviewedNativeFaces = {
    review: 'manual-native-face-review',
    source,
    rasterSource,
    faces: paths.map((path) => ({
      ref: { operationIndex: path.operationIndex, subpathIndex: 0, segmentIndex: 0 },
      kind: 'wall-face',
    })),
  }
  return { native, dimensions, lineworkSource: rasterSource, work, reviewed }
}
const input = fixture(rectangle)
describe('single reviewed native floor-face cycle', () => {
  it('orders unordered faces without moving or inventing vertices', () => {
    const reviewed = {
      ...input.reviewed,
      faces: [
        input.reviewed.faces[2],
        input.reviewed.faces[0],
        input.reviewed.faces[3],
        input.reviewed.faces[1],
      ],
    } as ReviewedNativeFaces
    const result = nativeFaceCycle({ ...input, reviewed })
    expect(result.status).toBe('candidate')
    expect(result.polygon).toEqual(rectangle)
    if (result.status !== 'candidate') throw new Error('Missing cycle')
    expect(result.vertices.every((vertex) => vertex.proof?.kind === 'native-endpoint')).toBe(true)
    expect(input.work.paths[0]?.points[0]).toEqual({ x: 20, y: 20 })
  })
  it('supports a diagonal through observed shared endpoints', () => {
    const polygon = [
      { x: 20, y: 20 },
      { x: 80, y: 20 },
      { x: 80, y: 60 },
      { x: 60, y: 80 },
      { x: 20, y: 80 },
    ]
    expect(nativeFaceCycle(fixture(polygon)).polygon).toEqual(polygon)
  })
  it('uses bounded real crossings to trim native faces, not line extensions', () => {
    const sides = [
      [
        { x: 10, y: 20 },
        { x: 90, y: 20 },
      ],
      [
        { x: 80, y: 10 },
        { x: 80, y: 90 },
      ],
      [
        { x: 10, y: 80 },
        { x: 90, y: 80 },
      ],
      [
        { x: 20, y: 10 },
        { x: 20, y: 90 },
      ],
    ]
    const work = {
      ...input.work,
      paths: input.work.paths.map((path, index) => ({
        ...path,
        points: sides[index] as PagePoint[],
      })),
    }
    const result = nativeFaceCycle({ ...input, work })
    expect(result.polygon).toEqual(rectangle)
    if (result.status !== 'candidate') throw new Error('Missing cycle')
    expect(
      result.vertices.every((vertex) => vertex.proof?.kind === 'bounded-native-crossing'),
    ).toBe(true)
    expect(result.vertexProofs).toHaveLength(4)
    const contours = {
      source,
      coordinateSystem: 'page-0-1000' as const,
      review: 'manual-source-review' as const,
      pageWidth: 1000,
      pageHeight: 1000,
      rooms: [{ roomSourceNumber: 1, polygon: result.polygon, vertexProofs: result.vertexProofs }],
    }
    const reading = {
      sourcePage: 1,
      planState: 'existing' as const,
      readAt: '2026-10-09',
      rooms: [{ sourceNumber: 1, name: 'Комната', kind: 'living' as const }],
    }
    expect(planPageReviewIssue(contours, reading, source, work)).toBeUndefined()
    expect(
      planPageReviewIssue(
        { ...contours, source: { ...source, sha256: 'c'.repeat(64) } },
        reading,
        source,
        work,
      ),
    ).toBe('different-plan-source')
    const proof = result.vertexProofs[0]
    if (!proof) throw new Error('Missing crossing proof')
    proof.segments[0].start.x += 1
    expect(planPageReviewIssue(contours, reading, source, work)).toBe('non-native-contour-vertex')
    expect(work.paths[0]?.points[0]?.x).toBe(10)
  })
  it('refuses even a small source gap instead of snapping it closed', () => {
    const work = {
      ...input.work,
      paths: input.work.paths.map((path, index) =>
        index === 3
          ? {
              ...path,
              points: [
                { x: 20, y: 80 },
                { x: 20, y: 20.001 },
              ],
            }
          : path,
      ),
    }
    const result = nativeFaceCycle({ ...input, work })
    expect(result.status).toBe('unresolved')
    expect(result.polygon).toBeNull()
  })
  it('refuses a selected dimension operation even after a role conflict', () => {
    const result = nativeFaceCycle({
      ...input,
      dimensions: { ...dimensions, dimensionOperations: [1] },
    })
    expect(result).toEqual({
      status: 'unresolved',
      reason: 'dimension-operation-is-not-a-floor-face',
      polygon: null,
    })
  })
  it('does not select one of multiple disconnected cycles', () => {
    const second = fixture(rectangle.map((point) => ({ x: point.x + 100, y: point.y })))
    const paths = [
      ...input.work.paths,
      ...second.work.paths.map((path) => ({ ...path, operationIndex: path.operationIndex + 10 })),
    ]
    const reviewed = {
      ...input.reviewed,
      faces: paths.map((path) => ({
        ref: { operationIndex: path.operationIndex, subpathIndex: 0, segmentIndex: 0 },
        kind: 'wall-face' as const,
      })),
    }
    expect(
      nativeFaceCycle({ ...input, work: { ...input.work, paths }, reviewed }).polygon,
    ).toBeNull()
  })
  it('refuses a branch and a self-crossing polygon', () => {
    const extra = {
      operationIndex: 10,
      subpathIndex: 0,
      paint: 'stroke' as const,
      closed: false,
      points: [
        { x: 50, y: 10 },
        { x: 50, y: 90 },
      ],
    }
    expect(
      nativeFaceCycle({
        ...input,
        work: { ...input.work, paths: [...input.work.paths, extra] },
        reviewed: {
          ...input.reviewed,
          faces: [
            ...input.reviewed.faces,
            { ref: { operationIndex: 10, subpathIndex: 0, segmentIndex: 0 }, kind: 'wall-face' },
          ],
        },
      }).polygon,
    ).toBeNull()
    const crossed = fixture([
      { x: 20, y: 20 },
      { x: 80, y: 80 },
      { x: 20, y: 80 },
      { x: 80, y: 20 },
    ])
    expect(nativeFaceCycle(crossed).polygon).toBeNull()
  })
  it('refuses omitted evidence touching the selected boundary', () => {
    const work = {
      ...input.work,
      skippedCurves: 1,
      skippedCurveBounds: [
        { operationIndex: 10, bounds: { left: 40, top: 19, right: 60, bottom: 21 } },
      ],
    }
    expect(nativeFaceCycle({ ...input, work }).polygon).toBeNull()
  })
  it('rejects a changed source and refuses a reused native face', () => {
    expect(() =>
      nativeFaceCycle({ ...input, lineworkSource: { ...rasterSource, page: 2 } }),
    ).toThrow()
    const first = input.reviewed.faces[0]
    if (!first) throw new Error('Missing fixture face')
    expect(
      nativeFaceCycle({
        ...input,
        reviewed: { ...input.reviewed, faces: [...input.reviewed.faces, first] },
      }).polygon,
    ).toBeNull()
  })
  it('refuses a just-outside omitted bound within the PDF-point exclusion margin', () => {
    const work = {
      ...input.work,
      skippedCurves: 1,
      skippedCurveBounds: [
        { operationIndex: 10, bounds: { left: 40, top: 19, right: 60, bottom: 19.999 } },
      ],
    }
    expect(nativeFaceCycle({ ...input, work }).polygon).toBeNull()
  })
  it('does not reject a selected cycle for a sufficiently distant omitted bound', () => {
    const work = {
      ...input.work,
      skippedCurves: 1,
      skippedCurveBounds: [
        { operationIndex: 10, bounds: { left: 40, top: 19, right: 60, bottom: 19.8 } },
      ],
    }
    expect(nativeFaceCycle({ ...input, work }).status).toBe('candidate')
  })
})
