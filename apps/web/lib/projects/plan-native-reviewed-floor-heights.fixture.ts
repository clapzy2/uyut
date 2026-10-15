import type { ReviewedNativePaintedFloors } from './plan-native-painted-floor-review'
import type { nativeReviewedFloorHeightBindings } from './plan-native-reviewed-floor-heights'
import { nativeVisiblePaintRegions } from './plan-native-visible-paint'

type Input = Parameters<typeof nativeReviewedFloorHeightBindings>[0]
const rectangle = (left: number, top: number, right: number, bottom: number) => [
  { x: left, y: top },
  { x: right, y: top },
  { x: right, y: bottom },
  { x: left, y: bottom },
]
export function floorHeightFixture(): Input {
  const source = { sha256: 'b'.repeat(64), pdfPage: 3, state: 'existing' as const }
  const raster = { sha256: 'a'.repeat(64), page: 3, width: 1000, height: 1000 }
  const texts = [
    'Спальня',
    '3.1',
    'H=2700',
    'Размеры указаны в миллиметрах',
    'Все отметки высот на замере даны от чистового пола',
  ]
  const labels = texts.map((name, nativeIndex) => ({
    id: `native-text-${nativeIndex}`,
    nativeIndex,
    name,
    point: { x: 150, y: 150 + nativeIndex * 20 },
    pagePoint: { x: 150, y: 150 + nativeIndex * 20 },
    rotation: 0,
  }))
  const ink = (index: number) => ({
    source: { ...source, pageWidth: 1000, pageHeight: 1000 },
    complete: true,
    refusalReason: null,
    unresolved: [],
    items: [
      {
        index,
        text: texts[index] as string,
        fontName: 'F1',
        operationIndex: 100 + index,
        quad: rectangle(150, 140 + index * 20, 200, 150 + index * 20) as [
          { x: number; y: number },
          { x: number; y: number },
          { x: number; y: number },
          { x: number; y: number },
        ],
        baselineStart: labels[index]?.pagePoint as { x: number; y: number },
        baselineEnd: { x: 200, y: 150 + index * 20 },
      },
    ],
  })
  const common = {
    native: {
      source: raster,
      originalPdfSha256: source.sha256,
      complete: true,
      pageNormalizedScale: { x: 1, y: 1 },
      labels,
      heightCaptionInk: ink(2),
      heightUnitInk: ink(3),
      heightFloorReferenceInk: ink(4),
    },
    lineworkSource: raster,
    work: {
      coordinateSystem: 'page-0-1000' as const,
      pageWidth: 1000,
      pageHeight: 1000,
      paths: [
        {
          operationIndex: 10,
          subpathIndex: 0,
          paint: 'fill' as const,
          closed: true,
          points: rectangle(100, 100, 300, 300),
        },
      ],
      paintBounds: {
        complete: true,
        refusalReason: null,
        events: [
          {
            operationIndex: 10,
            kind: 'vector' as const,
            bounds: { left: 100, top: 100, right: 300, bottom: 300 },
            reason: null,
          },
          ...Array.from({ length: 5 }, (_, index) => ({
            operationIndex: 100 + index,
            kind: 'text' as const,
            bounds: null,
            reason: 'text-paint-envelope-unavailable',
          })),
        ],
      },
      skippedCurves: 0,
      clippedPaths: 0,
      unsupportedPaths: 0,
      unsupportedContexts: 0,
      truncated: false,
    },
  }
  const piece = nativeVisiblePaintRegions(common).regions[0]?.pieces[0]
  if (!piece) throw new Error('Missing synthetic source piece')
  const reviewedFloors: ReviewedNativePaintedFloors = {
    review: 'manual-native-painted-floor-review',
    source,
    rasterSource: raster,
    floors: [
      {
        candidateId: 'native-fill-10:0',
        pieceIndex: 0,
        polygon: piece.polygon,
        holes: piece.holes,
        owner: {
          sourceRoomKey: '3.1',
          nameLabelId: 'native-text-0',
          numberLabelId: 'native-text-1',
        },
        boundaryRoles: piece.polygon.map((_, edgeIndex) => ({ edgeIndex, kind: 'unresolved' })),
      },
    ],
  }
  return { ...common, reviewedFloors, floorReviewSavedAt: '2026-10-12T00:00:00.000Z' }
}
