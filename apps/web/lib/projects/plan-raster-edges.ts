export type RasterEdgePoint = { x: number; y: number }
export type RasterEdgeSegment = { start: RasterEdgePoint; end: RasterEdgePoint }
export type RasterEdgeCandidates = {
  segments: RasterEdgeSegment[]
  points: RasterEdgePoint[]
  truncated: boolean
  uncertain: boolean
}

const DARK_THRESHOLD = 100
const MAX_BOUNDARY_EDGES = 120_000
const MAX_SEGMENTS = 2_000
const MAX_DISTANCE_CHECKS = 2_000_000
const MIN_SEGMENT_LENGTH = 15
const SIMPLIFICATION_TOLERANCE_SQUARED = 1.5 ** 2

function distanceSquared(point: RasterEdgePoint, start: RasterEdgePoint, end: RasterEdgePoint) {
  const dx = end.x - start.x
  const dy = end.y - start.y
  const lengthSquared = dx * dx + dy * dy
  const t =
    lengthSquared === 0
      ? 0
      : Math.max(
          0,
          Math.min(1, ((point.x - start.x) * dx + (point.y - start.y) * dy) / lengthSquared),
        )
  return (point.x - start.x - t * dx) ** 2 + (point.y - start.y - t * dy) ** 2
}

function simplify(points: RasterEdgePoint[], budget: { remaining: number }) {
  const keep = new Uint8Array(points.length)
  keep[0] = 1
  keep[points.length - 1] = 1
  const pending: [number, number][] = [[0, points.length - 1]]
  while (pending.length) {
    const range = pending.pop()
    if (!range) break
    const [first, last] = range
    const start = points[first]
    const end = points[last]
    if (!start || !end) continue
    let farthest = -1
    let maxDistance = SIMPLIFICATION_TOLERANCE_SQUARED
    for (let index = first + 1; index < last; index++) {
      if (--budget.remaining < 0) return null
      const point = points[index]
      if (!point) continue
      const distance = distanceSquared(point, start, end)
      if (distance > maxDistance) {
        maxDistance = distance
        farthest = index
      }
    }
    if (farthest !== -1) {
      keep[farthest] = 1
      pending.push([first, farthest], [farthest, last])
    }
  }
  return points.filter((_, index) => keep[index] === 1)
}

/**
 * Unclassified dark-ink boundaries for optional human tracing assistance.
 * Coordinates follow pixel cell edges, not measured walls. Text, furniture and
 * dimension lines can also produce candidates. Never closes gaps in the source.
 */
export function detectPlanRasterEdges(input: {
  grayscale: Uint8Array
  width: number
  height: number
}): RasterEdgeCandidates {
  const { grayscale, width, height } = input
  if (
    !Number.isInteger(width) ||
    !Number.isInteger(height) ||
    width < 1 ||
    height < 1 ||
    width > 2_000 ||
    height > 2_000 ||
    !(grayscale instanceof Uint8Array) ||
    grayscale.length !== width * height
  ) {
    throw new RangeError('Expected grayscale raster of 1–2000 pixels per axis')
  }
  const empty = (): RasterEdgeCandidates => ({
    segments: [],
    points: [],
    truncated: false,
    uncertain: false,
  })
  const stride = width + 1
  const starts: number[] = []
  const ends: number[] = []
  const directions: number[] = []
  const outgoing = new Map<number, number[]>()
  let boundaryOverflow = false
  function add(start: number, end: number, direction: number) {
    if (starts.length === MAX_BOUNDARY_EDGES) {
      boundaryOverflow = true
      return
    }
    const index = starts.length
    starts.push(start)
    ends.push(end)
    directions.push(direction)
    const existing = outgoing.get(start)
    if (existing) existing.push(index)
    else outgoing.set(start, [index])
  }
  const dark = (x: number, y: number) =>
    x >= 0 &&
    y >= 0 &&
    x < width &&
    y < height &&
    (grayscale[y * width + x] ?? 255) <= DARK_THRESHOLD
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      if (!dark(x, y)) continue
      const topLeft = y * stride + x
      if (!dark(x, y - 1)) add(topLeft, topLeft + 1, 0)
      if (!dark(x + 1, y)) add(topLeft + 1, topLeft + stride + 1, 1)
      if (!dark(x, y + 1)) add(topLeft + stride + 1, topLeft + stride, 2)
      if (!dark(x - 1, y)) add(topLeft + stride, topLeft, 3)
      if (boundaryOverflow) return { ...empty(), truncated: true, uncertain: true }
    }
  }
  const visited = new Uint8Array(starts.length)
  const budget = { remaining: MAX_DISTANCE_CHECKS }
  const result = empty()
  const uniquePoints = new Map<string, RasterEdgePoint>()
  const pointAt = (vertex: number): RasterEdgePoint => ({
    x: vertex % stride,
    y: Math.floor(vertex / stride),
  })
  for (let firstEdge = 0; firstEdge < starts.length; firstEdge++) {
    if (visited[firstEdge]) continue
    const firstVertex = starts[firstEdge]
    if (firstVertex === undefined) continue
    const contour = [pointAt(firstVertex)]
    let current = firstEdge
    let closed = false
    while (!visited[current]) {
      visited[current] = 1
      const end = ends[current]
      if (end === undefined) break
      contour.push(pointAt(end))
      if (end === firstVertex) {
        closed = true
        break
      }
      const choices = (outgoing.get(end) ?? []).filter((edge) => !visited[edge])
      // At diagonally touching ink cells, a right turn keeps separate boundaries.
      choices.sort((a, b) => {
        const turn = (edge: number) =>
          ((directions[edge] ?? 0) - (directions[current] ?? 0) + 4) % 4
        const rank = (edge: number) => [1, 0, 3, 2][turn(edge)] ?? 4
        return rank(a) - rank(b)
      })
      const next = choices[0]
      if (next === undefined) break
      current = next
    }
    if (!closed) {
      result.uncertain = true
      continue
    }
    if (contour.length < MIN_SEGMENT_LENGTH * 2) continue
    // Split a closed contour at its farthest vertex so RDP cannot collapse it
    // into the identical start/end point.
    const origin = contour[0]
    if (!origin) continue
    let split = 1
    let maxDistance = 0
    for (let index = 1; index < contour.length - 1; index++) {
      const point = contour[index]
      if (!point) continue
      const distance = (point.x - origin.x) ** 2 + (point.y - origin.y) ** 2
      if (distance > maxDistance) {
        maxDistance = distance
        split = index
      }
    }
    const arcs = [contour.slice(0, split + 1), contour.slice(split)]
    for (const arc of arcs) {
      const simplified = simplify(arc, budget)
      if (!simplified)
        return { ...result, points: [...uniquePoints.values()], truncated: true, uncertain: true }
      for (let index = 1; index < simplified.length; index++) {
        const start = simplified[index - 1]
        const end = simplified[index]
        if (!start || !end || Math.hypot(end.x - start.x, end.y - start.y) < MIN_SEGMENT_LENGTH)
          continue
        // Outside pixels are unknown, not white paper. A cropped ink boundary
        // must not become a fabricated corner or closing edge at the image frame.
        const onFrame = (point: RasterEdgePoint) =>
          point.x === 0 || point.y === 0 || point.x === width || point.y === height
        if (onFrame(start) || onFrame(end)) continue
        if (result.segments.length === MAX_SEGMENTS) {
          return { ...result, points: [...uniquePoints.values()], truncated: true, uncertain: true }
        }
        result.segments.push({ start, end })
        uniquePoints.set(`${start.x},${start.y}`, start)
        uniquePoints.set(`${end.x},${end.y}`, end)
      }
    }
  }
  result.points = [...uniquePoints.values()]
  return result
}
