import type {
  PlanGeometry,
  PlanPageContours,
  PlanPoint,
  PlanWall,
  PlanWallFacePair,
} from '@uyut/db'

type PagePoint = { x: number; y: number }

export type SourceOuterWallGap = {
  edgeIndex: number
  wallId: string
  start: PagePoint
  end: PagePoint
}

export function sourceBackedOuterSpans(
  wall: PlanWall,
  pairs: PlanWallFacePair[],
): Array<[number, number]> {
  const dx = wall.end.xCm - wall.start.xCm
  const dy = wall.end.yCm - wall.start.yCm
  const lengthSquared = dx * dx + dy * dy
  if (lengthSquared === 0) return []

  const spans = pairs.flatMap((pair) =>
    pair.faces.flatMap((face): Array<[number, number]> => {
      if (face.wall.id !== wall.id || face.wall.kind !== 'outer') return []
      const fraction = (point: PlanPoint) =>
        ((point.xCm - wall.start.xCm) * dx + (point.yCm - wall.start.yCm) * dy) / lengthSquared
      const start = fraction(face.start)
      const end = fraction(face.end)
      return [[Math.max(0, Math.min(start, end)), Math.min(1, Math.max(start, end))]]
    }),
  )
  spans.sort((a, b) => a[0] - b[0])

  const merged: Array<[number, number]> = []
  for (const [start, end] of spans) {
    const previous = merged.at(-1)
    if (previous && start <= previous[1]) previous[1] = Math.max(previous[1], end)
    else if (start < end) merged.push([start, end])
  }
  return merged
}

export function unpairedOuterSpans(spans: Array<[number, number]>): Array<[number, number]> {
  const gaps: Array<[number, number]> = []
  let position = 0
  for (const [start, end] of spans) {
    if (start > position) gaps.push([position, start])
    position = end
  }
  if (position < 1) gaps.push([position, 1])
  return gaps
}

/** Read-only hints on the saved source edge. Interpolated endpoints are not PDF witnesses. */
export function sourceOuterWallGaps(
  geometry: PlanGeometry | undefined,
  contours: PlanPageContours | undefined,
  pairs: PlanWallFacePair[],
): SourceOuterWallGap[] {
  const calibration = geometry?.pdfCalibration
  const exterior = contours?.exterior
  if (
    !geometry ||
    !calibration ||
    !contours ||
    !exterior ||
    exterior.boundaryRole !== 'outer-wall-envelope' ||
    contours.source.state !== 'existing' ||
    calibration.sourceSha256 !== contours.source.sha256 ||
    calibration.pdfPage !== contours.source.pdfPage ||
    !Number.isFinite(calibration.cmPerPoint) ||
    calibration.cmPerPoint <= 0 ||
    ![calibration.origin.x, calibration.origin.y, contours.pageWidth, contours.pageHeight].every(
      Number.isFinite,
    ) ||
    contours.pageWidth <= 0 ||
    contours.pageHeight <= 0 ||
    exterior.polygon.length < 3 ||
    exterior.polygon.length > 200
  )
    return []

  const toMetric = (point: PagePoint): PlanPoint => ({
    xCm:
      Math.round(
        ((point.x - calibration.origin.x) * contours.pageWidth * calibration.cmPerPoint) / 100,
      ) / 10,
    yCm:
      Math.round(
        ((point.y - calibration.origin.y) * contours.pageHeight * calibration.cmPerPoint) / 100,
      ) / 10,
  })
  const matches = (a: PlanPoint, b: PlanPoint) =>
    Math.abs(a.xCm - b.xCm) < 0.051 && Math.abs(a.yCm - b.yCm) < 0.051
  const interpolate = (a: PagePoint, b: PagePoint, fraction: number): PagePoint => ({
    x: a.x + (b.x - a.x) * fraction,
    y: a.y + (b.y - a.y) * fraction,
  })
  const gaps: SourceOuterWallGap[] = []
  for (const [edgeIndex, start] of exterior.polygon.entries()) {
    const end = exterior.polygon[(edgeIndex + 1) % exterior.polygon.length]
    if (!end || ![start.x, start.y, end.x, end.y].every(Number.isFinite)) return []
    const metricStart = toMetric(start)
    const metricEnd = toMetric(end)
    const walls = geometry.walls.filter(
      (wall) =>
        wall.kind === 'outer' && matches(wall.start, metricStart) && matches(wall.end, metricEnd),
    )
    // An edited or ambiguous metric wall must not be projected onto this source edge.
    if (walls.length !== 1) return []
    const wall = walls[0]
    if (!wall) return []
    for (const [from, to] of unpairedOuterSpans(sourceBackedOuterSpans(wall, pairs))) {
      gaps.push({
        edgeIndex,
        wallId: wall.id,
        start: interpolate(start, end, from),
        end: interpolate(start, end, to),
      })
    }
  }
  return gaps
}
