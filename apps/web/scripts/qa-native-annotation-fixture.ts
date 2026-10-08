import type { NativeTextAnchors } from '../lib/projects/plan-document'
import type { ReviewedNativeAnnotations } from '../lib/projects/plan-native-annotation-review'
import type { PdfLinework, PdfVectorPath } from '../lib/projects/plan-pdf-linework'

/** Synthetic cm-proportional source, not an obmer or the user's apartment. */
export function nativeAnnotationFixture() {
  const frame = { sha256: 'a'.repeat(64), page: 1, width: 1000, height: 1000 }
  const source = { sha256: 'b'.repeat(64), pdfPage: 1, state: 'existing' as const }
  const living = [
    { x: 100, y: 100 },
    { x: 520, y: 100 },
    { x: 520, y: 455 },
    { x: 100, y: 455 },
  ]
  const balcony = [
    { x: 520, y: 100 },
    { x: 650, y: 100 },
    { x: 650, y: 245 },
    { x: 615, y: 280 },
    { x: 520, y: 280 },
  ]
  const stroke = (
    operationIndex: number,
    points: PdfVectorPath['points'],
    closed = false,
  ): PdfVectorPath => ({ operationIndex, subpathIndex: 0, points, closed, paint: 'stroke' })
  const label = {
    id: 'native-text-10',
    nativeIndex: 10,
    name: '3000',
    rotation: 0,
    pagePoint: { x: 300, y: 168 },
    point: { x: 300, y: 168 },
  }
  const native: NativeTextAnchors = {
    source: frame,
    originalPdfSha256: source.sha256,
    pageNormalizedScale: { x: 1, y: 1 },
    complete: true,
    labels: [label],
  }
  const work: PdfLinework = {
    coordinateSystem: 'page-0-1000',
    pageWidth: 1000,
    pageHeight: 1000,
    paths: [
      stroke(1, living, true),
      stroke(2, balcony, true),
      stroke(10, [
        { x: 150, y: 170 },
        { x: 450, y: 170 },
      ]),
      stroke(11, [
        { x: 145, y: 175 },
        { x: 155, y: 165 },
      ]),
      stroke(12, [
        { x: 445, y: 175 },
        { x: 455, y: 165 },
      ]),
    ],
    skippedCurves: 0,
    clippedPaths: 0,
    unsupportedPaths: 0,
    unsupportedContexts: 0,
    truncated: false,
  }
  const reviewed: ReviewedNativeAnnotations = {
    review: 'manual-native-annotation-review',
    source,
    rasterSource: frame,
    walls: [
      {
        ref: { operationIndex: 1, subpathIndex: 0, segmentIndex: 0 },
        start: living[0] as { x: number; y: number },
        end: living[1] as { x: number; y: number },
      },
    ],
    exclusions: work.paths.slice(2).map((path) => ({
      ref: { operationIndex: path.operationIndex, subpathIndex: 0, segmentIndex: 0 },
      start: path.points[0] as { x: number; y: number },
      end: path.points[1] as { x: number; y: number },
      role: path.operationIndex === 10 ? 'dimension-rail' : 'dimension-tick',
      label: {
        id: label.id,
        text: label.name,
        pagePoint: { ...label.pagePoint },
        rotation: label.rotation,
      },
      valueMm: 3000,
    })),
  }
  return { native, work, lineworkSource: frame, reviewed }
}
