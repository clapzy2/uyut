export type RasterRegionPoint = { x: number; y: number }
export type RasterPointMembership = {
  id: string
  point: RasterRegionPoint
  regionId: string | null
}
export type RasterFreeRegion = {
  id: string
  polygon: RasterRegionPoint[]
  pixelArea: number
  bounds: { minX: number; minY: number; maxX: number; maxY: number }
  hasInteriorIslands: boolean
}
export type RasterFreeRegions = {
  regions: RasterFreeRegion[]
  rejectedRegions: {
    pixelArea: number
    bounds: RasterFreeRegion['bounds']
    reason:
      | 'region-limit'
      | 'region-boundary-limit'
      | 'global-boundary-budget'
      | 'repeated-contour-edge'
      | 'multiple-outer-contours'
      | 'incomplete-contour'
      | 'contour-area-mismatch'
      | 'simplification-budget'
      | 'polygon-point-limit'
      | 'degenerate-polygon'
      | 'self-intersecting-polygon'
      | 'polygon-validation-budget'
  }[]
  frameIgnoredComponents: number
  truncated: boolean
  uncertain: boolean
  pointMembership?: RasterPointMembership[]
}

const MAX_REGIONS = 50
const MAX_REGION_EDGES = 120_000
const MAX_GLOBAL_EDGES = 2_000_000
const MAX_DISTANCE_CHECKS = 2_000_000
const MAX_POLYGON_POINTS = 200
const DIRECTIONS = [
  { x: 1, y: 0 },
  { x: 0, y: 1 },
  { x: -1, y: 0 },
  { x: 0, y: -1 },
]

function simpleRegionPolygon(points: RasterRegionPoint[], budget: { remaining: number }) {
  const cross = (a: RasterRegionPoint, b: RasterRegionPoint, c: RasterRegionPoint) =>
    (b.x - a.x) * (c.y - a.y) - (b.y - a.y) * (c.x - a.x)
  let area = 0
  for (let i = 0; i < points.length; i++) {
    const a = points[i],
      b = points[(i + 1) % points.length]
    if (!a || !b || (a.x === b.x && a.y === b.y)) return false
    area += a.x * b.y - b.x * a.y
    for (let j = i + 2; j < points.length; j++) {
      if (i === 0 && j === points.length - 1) continue
      if (--budget.remaining < 0) return false
      const c = points[j],
        d = points[(j + 1) % points.length]
      if (!c || !d) return false
      const boundsOverlap =
        Math.max(Math.min(a.x, b.x), Math.min(c.x, d.x)) <=
          Math.min(Math.max(a.x, b.x), Math.max(c.x, d.x)) &&
        Math.max(Math.min(a.y, b.y), Math.min(c.y, d.y)) <=
          Math.min(Math.max(a.y, b.y), Math.max(c.y, d.y))
      if (
        boundsOverlap &&
        cross(a, b, c) * cross(a, b, d) <= 0 &&
        cross(c, d, a) * cross(c, d, b) <= 0
      )
        return false
    }
  }
  return area > 0
}

/** Structural check only, not evidence of a room or measured floor. Accept either winding. */
export function validRasterRegionPolygon(points: RasterRegionPoint[]): boolean {
  if (
    points.length < 3 ||
    points.length > MAX_POLYGON_POINTS ||
    points.some((point) => !Number.isFinite(point.x) || !Number.isFinite(point.y))
  )
    return false
  const budget = { remaining: MAX_DISTANCE_CHECKS }
  return simpleRegionPolygon(points, budget) || simpleRegionPolygon([...points].reverse(), budget)
}

function distanceSquared(
  point: RasterRegionPoint,
  start: RasterRegionPoint,
  end: RasterRegionPoint,
) {
  const dx = end.x - start.x
  const dy = end.y - start.y
  const length = dx * dx + dy * dy
  const t =
    length === 0
      ? 0
      : Math.max(0, Math.min(1, ((point.x - start.x) * dx + (point.y - start.y) * dy) / length))
  return (point.x - start.x - t * dx) ** 2 + (point.y - start.y - t * dy) ** 2
}

function simplifyClosed(points: RasterRegionPoint[], budget: { remaining: number }) {
  const keep = new Uint8Array(points.length)
  keep[0] = 1
  keep[points.length - 1] = 1
  const ranges: [number, number][] = [[0, points.length - 1]]
  while (ranges.length > 0) {
    const range = ranges.pop()
    if (!range) break
    const [first, last] = range
    const start = points[first]
    const end = points[last]
    if (!start || !end) return null
    let furthest = -1
    let maximum = 1.5 ** 2
    for (let index = first + 1; index < last; index++) {
      if (--budget.remaining < 0) return null
      const point = points[index]
      if (!point) return null
      const distance = distanceSquared(point, start, end)
      if (distance > maximum) {
        maximum = distance
        furthest = index
      }
    }
    if (furthest >= 0) {
      keep[furthest] = 1
      ranges.push([first, furthest], [furthest, last])
    }
  }
  return points.filter((_, index) => keep[index] === 1).slice(0, -1)
}

function separateContourLoops(points: RasterRegionPoint[], stride: number) {
  const path: RasterRegionPoint[] = []
  const indices = new Map<number, number>()
  let outer: RasterRegionPoint[] | null = null
  let outerArea = 0
  let hasInteriorLoops = false
  for (const point of points) {
    const key = point.y * stride + point.x
    const previous = indices.get(key)
    if (previous === undefined) {
      indices.set(key, path.length)
      path.push(point)
      continue
    }
    const loop = [...path.slice(previous), point]
    let twiceArea = 0
    for (let index = 1; index < loop.length; index++) {
      const start = loop[index - 1]
      const end = loop[index]
      if (start && end) twiceArea += start.x * end.y - end.x * start.y
    }
    if (twiceArea > 0) {
      if (outer) return null
      outer = loop
      outerArea = twiceArea / 2
    } else if (twiceArea < 0) {
      hasInteriorLoops = true
    }
    while (path.length > previous + 1) {
      const removed = path.pop()
      if (removed) indices.delete(removed.y * stride + removed.x)
    }
  }
  return outer ? { outer, outerArea, hasInteriorLoops } : null
}

/**
 * Experimental image-space candidates, not rooms or measured floor geometry.
 * Bright components connected through doors stay merged. Frame-touching regions
 * are excluded: an image crop is never interpreted as a closing wall.
 * Polygons follow cell edges, simplified within 1.5 pixels. Interior ink islands
 * are flagged, not filled or interpreted as obstacles, walls or floor holes.
 */
export function detectPlanRasterRegions(input: {
  grayscale: Uint8Array
  width: number
  height: number
  probes?: { id: string; point: RasterRegionPoint }[]
}): RasterFreeRegions {
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
  const probes = input.probes
  if (
    probes &&
    (probes.length > 50 ||
      new Set(probes.map((probe) => probe.id)).size !== probes.length ||
      probes.some(
        ({ id, point }) =>
          !id ||
          id.length > 120 ||
          id.trim() !== id ||
          !Number.isFinite(point.x) ||
          !Number.isFinite(point.y) ||
          point.x < 0 ||
          point.y < 0 ||
          point.x >= width ||
          point.y >= height,
      ))
  )
    throw new RangeError('Expected at most 50 unique in-frame point probes')
  const result: RasterFreeRegions = {
    regions: [],
    rejectedRegions: [],
    frameIgnoredComponents: 0,
    truncated: false,
    uncertain: false,
  }
  const reject = (
    pixelArea: number,
    bounds: RasterFreeRegion['bounds'],
    reason: RasterFreeRegions['rejectedRegions'][number]['reason'],
  ) => {
    result.truncated = true
    result.uncertain = true
    if (result.rejectedRegions.length < MAX_REGIONS)
      result.rejectedRegions.push({ pixelArea, bounds, reason })
  }
  const labels = new Uint32Array(grayscale.length)
  const queue = new Uint32Array(grayscale.length)
  const minimumArea = Math.max(400, Math.ceil(grayscale.length * 0.002))
  const distanceBudget = { remaining: MAX_DISTANCE_CHECKS }
  let boundaryBudget = MAX_GLOBAL_EDGES
  let label = 0

  for (let seed = 0; seed < grayscale.length; seed++) {
    if (labels[seed] !== 0 || (grayscale[seed] ?? 0) < 180) continue
    label++
    let head = 0
    let tail = 1
    queue[0] = seed
    labels[seed] = label
    let touchesFrame = false
    const bounds = { minX: width, minY: height, maxX: 0, maxY: 0 }
    while (head < tail) {
      const pixel = queue[head++] ?? 0
      const x = pixel % width
      const y = Math.floor(pixel / width)
      bounds.minX = Math.min(bounds.minX, x)
      bounds.minY = Math.min(bounds.minY, y)
      bounds.maxX = Math.max(bounds.maxX, x + 1)
      bounds.maxY = Math.max(bounds.maxY, y + 1)
      touchesFrame ||= x === 0 || y === 0 || x === width - 1 || y === height - 1
      for (const delta of DIRECTIONS) {
        const nx = x + delta.x
        const ny = y + delta.y
        if (nx < 0 || ny < 0 || nx >= width || ny >= height) continue
        const next = ny * width + nx
        if (labels[next] !== 0 || (grayscale[next] ?? 0) < 180) continue
        labels[next] = label
        queue[tail++] = next
      }
    }
    if (touchesFrame) {
      result.frameIgnoredComponents++
      continue
    }
    if (tail < minimumArea) continue
    if (result.regions.length === MAX_REGIONS) {
      reject(tail, bounds, 'region-limit')
      break
    }
    const belongs = (x: number, y: number) =>
      x >= 0 && y >= 0 && x < width && y < height && labels[y * width + x] === label
    let boundaryEdges = 0
    for (let index = 0; index < tail; index++) {
      const pixel = queue[index] ?? 0
      const x = pixel % width
      const y = Math.floor(pixel / width)
      for (const delta of DIRECTIONS) {
        if (!belongs(x + delta.x, y + delta.y)) boundaryEdges++
      }
      if (boundaryEdges > MAX_REGION_EDGES || boundaryEdges > boundaryBudget) break
    }
    boundaryBudget -= boundaryEdges
    if (boundaryEdges > MAX_REGION_EDGES || boundaryBudget < 0) {
      reject(tail, bounds, boundaryBudget < 0 ? 'global-boundary-budget' : 'region-boundary-limit')
      if (boundaryBudget < 0) break
      continue
    }

    // Clockwise edges have the component to their right. Right-turn preference
    // traces its outer boundary without building a large vertex adjacency map.
    const edgeExists = (x: number, y: number, direction: number) => {
      if (direction === 0) return belongs(x, y) && !belongs(x, y - 1)
      if (direction === 1) return belongs(x - 1, y) && !belongs(x, y)
      if (direction === 2) return belongs(x - 1, y - 1) && !belongs(x - 1, y)
      return belongs(x, y - 1) && !belongs(x - 1, y - 1)
    }
    const first = { x: seed % width, y: Math.floor(seed / width) }
    const contour: RasterRegionPoint[] = [first]
    const visitedEdges = new Set<number>([(first.y * (width + 1) + first.x) * 4])
    let x = first.x
    let y = first.y
    let direction = 0
    let closed = false
    let repeatedEdge = false
    for (let step = 0; step < boundaryEdges; step++) {
      if (--boundaryBudget < 0) break
      const delta = DIRECTIONS[direction]
      if (!delta) break
      const nx = x + delta.x
      const ny = y + delta.y
      x = nx
      y = ny
      contour.push({ x, y })
      const next = [(direction + 1) % 4, direction, (direction + 3) % 4, (direction + 2) % 4].find(
        (candidate) => edgeExists(x, y, candidate),
      )
      if (next === undefined) break
      if (x === first.x && y === first.y && next === 0) {
        closed = true
        break
      }
      const edge = (y * (width + 1) + x) * 4 + next
      if (visitedEdges.has(edge)) {
        repeatedEdge = true
        break
      }
      visitedEdges.add(edge)
      direction = next
    }
    if (!closed) {
      const reason =
        boundaryBudget < 0
          ? 'global-boundary-budget'
          : repeatedEdge
            ? 'repeated-contour-edge'
            : 'incomplete-contour'
      reject(tail, bounds, reason)
      if (boundaryBudget < 0) break
      continue
    }
    // A diagonal ink contact can attach an island boundary to the outer walk
    // at one vertex. Separate its signed loops without deleting positive area.
    const loops = separateContourLoops(contour, width + 1)
    if (!loops || loops.outerArea < tail - 0.5) {
      reject(tail, bounds, !loops ? 'multiple-outer-contours' : 'contour-area-mismatch')
      continue
    }
    const polygon = simplifyClosed(loops.outer, distanceBudget)
    if (!polygon || polygon.length < 3 || polygon.length > MAX_POLYGON_POINTS) {
      reject(
        tail,
        bounds,
        !polygon
          ? 'simplification-budget'
          : polygon.length < 3
            ? 'degenerate-polygon'
            : 'polygon-point-limit',
      )
      if (distanceBudget.remaining < 0) break
      continue
    }
    if (!simpleRegionPolygon(polygon, distanceBudget)) {
      reject(
        tail,
        bounds,
        distanceBudget.remaining < 0 ? 'polygon-validation-budget' : 'self-intersecting-polygon',
      )
      if (distanceBudget.remaining < 0) break
      continue
    }
    const hasInteriorIslands = loops.hasInteriorLoops || loops.outerArea > tail + 0.5
    result.uncertain ||= hasInteriorIslands
    result.regions.push({
      id: `region-${label}`,
      polygon,
      pixelArea: tail,
      bounds,
      hasInteriorIslands,
    })
  }
  if (probes) {
    const acceptedIds = new Set(result.regions.map((region) => region.id))
    result.pointMembership = probes.map(({ id, point }) => {
      const component = labels[Math.floor(point.y) * width + Math.floor(point.x)] ?? 0
      const regionId = `region-${component}`
      return { id, point: { ...point }, regionId: acceptedIds.has(regionId) ? regionId : null }
    })
  }
  return result
}
