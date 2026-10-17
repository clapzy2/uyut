import type { NativeTextAnchors } from '../plan-document'
import type { PdfCurvePath, PdfLinework, PdfVectorPath } from '../plan-pdf-linework'

// Synthetic source-space controls, never an apartment survey or source acceptance.
const source = { sha256: 'a'.repeat(64), page: 1, width: 1000, height: 1000 }

export function addNativeRoomLabel(
  labels: NativeTextAnchors['labels'],
  name: string,
  x: number,
  y: number,
) {
  const nativeIndex = 100 + labels.length * 3
  const label = {
    id: `native-text-${nativeIndex}`,
    nativeIndex,
    name,
    point: { x, y },
    pagePoint: { x, y },
    rotation: 0,
  }
  labels.push(label)
  return label
}

export function addNativeRoomBox(paths: PdfVectorPath[], base: number, x: number, y: number) {
  const corners = [
    { x: x - 10, y: y - 12 },
    { x: x + 10, y: y - 12 },
    { x: x + 10, y: y + 8 },
    { x: x - 10, y: y + 8 },
  ]
  for (let index = 0; index < 4; index++)
    paths.push({
      operationIndex: base + index,
      subpathIndex: 0,
      paint: 'stroke',
      closed: false,
      points: [
        corners[index] as { x: number; y: number },
        corners[(index + 1) % 4] as { x: number; y: number },
      ],
    })
}

export function addCircledNativeRoomMarker(
  input: ReturnType<typeof numberedNativeRoomFixture>,
  marker: (typeof input.native.labels)[number],
) {
  const center = marker.pagePoint
  if (!center) throw new Error('Missing source marker')
  const radius = 8
  const k = (4 / 3) * Math.tan(Math.PI / 8)
  const points = [
    { x: center.x + radius, y: center.y },
    { x: center.x, y: center.y + radius },
    { x: center.x - radius, y: center.y },
    { x: center.x, y: center.y - radius },
    { x: center.x + radius, y: center.y },
  ]
  const curve: PdfCurvePath = {
    operationIndex: 1000 + (input.work.curvePaths?.length ?? 0),
    subpathIndex: 0,
    operationSubpathCount: 1,
    paint: 'stroke',
    closed: true,
    start: points[0] as { x: number; y: number },
    segments: points.slice(1).map((end, index) => {
      const start = points[index] as { x: number; y: number }
      return {
        kind: 'cubic' as const,
        control1: { x: start.x - k * (start.y - center.y), y: start.y + k * (start.x - center.x) },
        control2: { x: end.x + k * (end.y - center.y), y: end.y - k * (end.x - center.x) },
        end,
      }
    }),
  }
  input.work.curvePaths ??= []
  input.work.curvePaths.push(curve)
  input.work.skippedCurves = input.work.curvePaths.length
  input.work.skippedCurveBounds ??= []
  input.work.skippedCurveBounds.push({
    operationIndex: curve.operationIndex,
    paint: 'stroke',
    bounds: {
      left: center.x - radius,
      right: center.x + radius,
      top: center.y - radius,
      bottom: center.y + radius,
    },
  })
}

export function numberedNativeRoomFixture() {
  const labels: NativeTextAnchors['labels'] = []
  addNativeRoomLabel(labels, '№', 100, 700)
  addNativeRoomLabel(labels, 'Наименование', 130, 700)
  addNativeRoomLabel(labels, 'Площадь', 210, 700)
  for (let index = 0; index < 3; index++) {
    addNativeRoomLabel(labels, String(index + 1), 100, 730 + index * 30)
    addNativeRoomLabel(labels, index === 2 ? 'Балкон' : 'Спальня', 130, 730 + index * 30)
    addNativeRoomLabel(labels, index === 2 ? '5,5' : '12,5', 210, 730 + index * 30)
  }
  const paths: PdfVectorPath[] = []
  for (let index = 0; index < 3; index++) {
    const left = 50 + index * 250
    paths.push({
      operationIndex: index + 1,
      subpathIndex: 0,
      paint: 'fill',
      closed: true,
      points: [
        { x: left, y: 50 },
        { x: left + 200, y: 50 },
        { x: left + 200, y: 300 },
        { x: left, y: 300 },
      ],
    })
    addNativeRoomLabel(labels, String(index + 1), 100 + index * 250, 150)
    addNativeRoomBox(paths, 100 + index * 10, 100 + index * 250, 150)
  }
  addNativeRoomLabel(labels, '1', 900, 950) // unboxed sheet number, not a room cue
  const native: NativeTextAnchors = {
    source,
    originalPdfSha256: 'b'.repeat(64),
    complete: true,
    labels,
    pageNormalizedScale: { x: 1, y: 1 },
  }
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

/** Two connected outline regions plus a separate balcony; no survey/metric claim. */
export function connectedNativeRoomFixture() {
  const input = numberedNativeRoomFixture()
  input.work.paths = input.work.paths.map((path) => ({ ...path, paint: 'stroke' }))
  const outer = input.work.paths.find((path) => path.operationIndex === 1)
  const divider = input.work.paths.find((path) => path.operationIndex === 2)
  if (!outer || !divider) throw new Error('Missing connected-room controls')
  outer.points = [
    { x: 50, y: 50 },
    { x: 500, y: 50 },
    { x: 500, y: 300 },
    { x: 50, y: 300 },
  ]
  divider.closed = false
  divider.points = [
    { x: 275, y: 50 },
    { x: 275, y: 300 },
  ]
  return input
}
