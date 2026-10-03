import type { PlanPageContours, PlanReading } from '@uyut/db'
import type { PageDimensionLabel } from '../../../components/plan-page-contour-editor-model'
import { pdfDimensionForEdge } from '../plan-pdf-edge-dimension'
import type { PagePoint, PdfLinework, PdfVectorPath } from '../plan-pdf-linework'

// Синтетический наклонный трапециевидный контур: контроль связей, не реальный обмер.
export function required<T>(value: T | undefined): T {
  if (value === undefined) throw new Error('Не найден объект тестового исходника')
  return value
}

export function edgeDimensionFixture(angleDegrees = 27) {
  const radians = (angleDegrees * Math.PI) / 180
  const point = (x: number, y: number): PagePoint => ({
    x: 400 + x * Math.cos(radians) - y * Math.sin(radians),
    y: ((250 + x * Math.sin(radians) + y * Math.cos(radians)) * 1000) / 700,
  })
  let operationIndex = 0
  const path = (a: [number, number], b: [number, number]): PdfVectorPath => ({
    operationIndex: operationIndex++,
    subpathIndex: 0,
    closed: false,
    paint: 'stroke',
    points: [point(...a), point(...b)],
  })
  const source = { sha256: 'a'.repeat(64), pdfPage: 1, state: 'existing' as const }
  const polygon = [point(0, 0), point(300, 0), point(330, 200), point(0, 200)]
  const work: PdfLinework = {
    coordinateSystem: 'page-0-1000',
    pageWidth: 1000,
    pageHeight: 700,
    skippedCurves: 0,
    unsupportedContexts: 0,
    unsupportedPaths: 0,
    clippedPaths: 0,
    truncated: false,
    paths: [
      path([0, 0], [300, 0]),
      path([300, 0], [330, 200]),
      path([330, 200], [0, 200]),
      path([0, 200], [0, 0]),
      path([0, -20], [300, -20]),
      path([-2, -22], [2, -18]),
      path([298, -22], [302, -18]),
      path([0, 0], [0, -30]),
      path([300, 0], [300, -30]),
      path([-20, 0], [-20, 200]),
      path([-22, -2], [-18, 2]),
      path([-22, 198], [-18, 202]),
      path([0, 0], [-30, 0]),
      path([0, 200], [-30, 200]),
    ],
  }
  const labels: [PageDimensionLabel, PageDimensionLabel] = [
    { ...point(150, -22), index: 0, text: '3000', rotation: -angleDegrees },
    { ...point(-22, 110), index: 1, text: '2000', rotation: 90 - angleDegrees },
  ]
  const contours: PlanPageContours = {
    source,
    coordinateSystem: 'page-0-1000',
    review: 'manual-source-review',
    pageWidth: 1000,
    pageHeight: 700,
    rooms: [
      {
        roomSourceNumber: 1,
        polygon,
        dimensionEdges: [
          { wallEdgeIndex: 0, labelIndexes: [0] },
          { wallEdgeIndex: 3, labelIndexes: [1] },
        ],
      },
    ],
  }
  const reading: PlanReading = {
    planState: 'existing',
    sourcePage: 1,
    readAt: '2026-10-03',
    rooms: [{ name: 'Гостиная', kind: 'living', sourceNumber: 1 }],
  }
  const context = {
    source,
    linework: work,
    contours,
    planText: JSON.stringify(labels),
    useEdgeDimensions: true,
  }
  const binding = (wallEdgeIndex = 0, labelIndexes = [0]) =>
    pdfDimensionForEdge(
      work,
      source,
      contours,
      { roomSourceNumber: 1 },
      { wallEdgeIndex, labelIndexes },
      labels.filter((label) => labelIndexes.includes(label.index)),
    )
  return {
    work,
    point,
    path,
    labels,
    contours,
    reading,
    context,
    binding,
    room: required(contours.rooms[0]),
  }
}
