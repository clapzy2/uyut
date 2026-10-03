import type { WallElevationPanel } from './wall-elevation'

export type WallSolidPoint = { distanceCm: number; depthCm: number; heightCm: number }
export type WallSolidFace = {
  role: 'face' | 'cap' | 'end' | 'reveal'
  points: WallSolidPoint[]
}
type Interval = { start: number; end: number }
type EdgeIndex = Map<number, Interval[]>

function addEdge(index: EdgeIndex, coordinate: number, start: number, end: number) {
  const intervals = index.get(coordinate) ?? []
  intervals.push({ start, end })
  index.set(coordinate, intervals)
}

/** Parts of an edge not covered by a neighbouring panel are physical exterior surfaces. */
function exposed(start: number, end: number, neighbours: Interval[] = []): Interval[] {
  const result: Interval[] = []
  let cursor = start
  for (const neighbour of neighbours) {
    if (neighbour.end <= cursor || neighbour.start >= end) continue
    if (neighbour.start > cursor) result.push({ start: cursor, end: neighbour.start })
    cursor = Math.max(cursor, neighbour.end)
    if (cursor >= end) break
  }
  if (cursor < end) result.push({ start: cursor, end })
  return result
}

/** Extrude the union of wall panels, without internal caps between adjacent panels. */
export function wallSolidFaces(
  panels: readonly WallElevationPanel[],
  lengthCm: number,
  heightCm: number,
  thicknessCm: number,
): WallSolidFace[] {
  const left: EdgeIndex = new Map()
  const right: EdgeIndex = new Map()
  const bottom: EdgeIndex = new Map()
  const top: EdgeIndex = new Map()
  for (const panel of panels) {
    addEdge(left, panel.startCm, panel.bottomCm, panel.topCm)
    addEdge(right, panel.endCm, panel.bottomCm, panel.topCm)
    addEdge(bottom, panel.bottomCm, panel.startCm, panel.endCm)
    addEdge(top, panel.topCm, panel.startCm, panel.endCm)
  }
  for (const index of [left, right, bottom, top]) {
    for (const intervals of index.values()) intervals.sort((a, b) => a.start - b.start)
  }

  const half = thicknessCm / 2
  const point = (distanceCm: number, depthCm: number, heightCm: number): WallSolidPoint => ({
    distanceCm,
    depthCm,
    heightCm,
  })
  const faces: WallSolidFace[] = []
  for (const panel of panels) {
    const { startCm: start, endCm: end, bottomCm: low, topCm: high } = panel
    faces.push(
      {
        role: 'face',
        points: [
          point(start, -half, low),
          point(end, -half, low),
          point(end, -half, high),
          point(start, -half, high),
        ],
      },
      {
        role: 'face',
        points: [
          point(start, half, low),
          point(start, half, high),
          point(end, half, high),
          point(end, half, low),
        ],
      },
    )
    for (const side of ['left', 'right'] as const) {
      const coordinate = side === 'left' ? start : end
      const neighbours = (side === 'left' ? right : left).get(coordinate)
      for (const edge of exposed(low, high, neighbours)) {
        const points = [
          point(coordinate, -half, edge.start),
          point(coordinate, -half, edge.end),
          point(coordinate, half, edge.end),
          point(coordinate, half, edge.start),
        ]
        faces.push({
          role: coordinate === 0 || coordinate === lengthCm ? 'end' : 'reveal',
          points: side === 'left' ? points : points.reverse(),
        })
      }
    }
    for (const side of ['bottom', 'top'] as const) {
      const coordinate = side === 'bottom' ? low : high
      const neighbours = (side === 'bottom' ? top : bottom).get(coordinate)
      for (const edge of exposed(start, end, neighbours)) {
        const points = [
          point(edge.start, -half, coordinate),
          point(edge.start, half, coordinate),
          point(edge.end, half, coordinate),
          point(edge.end, -half, coordinate),
        ]
        faces.push({
          role: coordinate === 0 || coordinate === heightCm ? 'cap' : 'reveal',
          points: side === 'bottom' ? points : points.reverse(),
        })
      }
    }
  }
  return faces
}
