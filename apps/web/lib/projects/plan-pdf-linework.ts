type Matrix = [number, number, number, number, number, number]
export type PagePoint = { x: number; y: number }
export type Bounds = { left: number; top: number; right: number; bottom: number }
/** Unclipped raster-pen capsule; never a physical width or accepted source edge. */
export type PdfStraightStrokeRegion = {
  start: PagePoint
  end: PagePoint
  sourceToPage: Matrix
  radius: number
}
export type PdfPaintBounds = {
  complete: boolean
  refusalReason: string | null
  events: {
    operationIndex: number
    kind: 'vector' | 'text' | 'image' | 'unknown'
    bounds: Bounds | null
    reason: string | null
    subpathCount?: number
    straightStrokeRegion?: PdfStraightStrokeRegion
  }[]
}
/** Renderer operands and pen state, not original decimal tokens or final visible ink. */
export type PdfStrokeInk = {
  points: PagePoint[]
  sourceToPage: Matrix
  lineWidth: number
  lineCap: 0 | 1 | 2
  lineJoin: 0 | 1 | 2
  miterLimit: number
  dashArray: number[]
  dashPhase: number
  refusalReason: string | null
}
export type PdfVectorPath = {
  operationIndex: number
  subpathIndex: number
  paint: 'stroke' | 'fill' | 'fill-stroke'
  fillColor?: string
  strokeColor?: string
  closed: boolean
  points: PagePoint[]
  strokeInk?: PdfStrokeInk
}
export type PdfPathSegment =
  | { kind: 'line'; end: PagePoint }
  | { kind: 'quadratic'; control: PagePoint; end: PagePoint }
  | { kind: 'cubic'; control1: PagePoint; control2: PagePoint; end: PagePoint }
/** Source commands for symbol inspection only; never a flattened wall/floor polygon. */
export type PdfCurvePath = {
  operationIndex: number
  subpathIndex: number
  operationSubpathCount: number
  paint: PdfVectorPath['paint']
  strokeColor?: string
  closed: boolean
  start: PagePoint
  segments: PdfPathSegment[]
}
export type PdfLinework = {
  coordinateSystem: 'page-0-1000'
  pageWidth: number
  pageHeight: number
  paths: PdfVectorPath[]
  /** Conservative paint envelopes in source order, not visibility/physical proof. */
  paintBounds?: PdfPaintBounds
  curvePaths?: PdfCurvePath[]
  curvePathsTruncated?: boolean
  skippedCurves: number
  unsupportedPaths: number
  unsupportedContexts: number
  clippedPaths: number
  /** Diagnostic bounds of omitted paths; never evidence that their visible part was absent. */
  clippedPathBounds?: Array<{
    operationIndex: number
    bounds: Bounds
    paint?: PdfVectorPath['paint']
  }>
  clippedPathBoundsTruncated?: boolean
  /** Control-point bounds of omitted curves; the curve is never flattened into a wall. */
  skippedCurveBounds?: Array<{
    operationIndex: number
    bounds: Bounds
    paint?: PdfVectorPath['paint']
  }>
  skippedCurveBoundsTruncated?: boolean
  truncated: boolean
}
type Operators = Readonly<Record<string, number>>
type Viewport = {
  width: number
  height: number
  convertToViewportPoint(x: number, y: number): number[]
}
type GraphicsState = {
  matrix: Matrix
  clip?: Bounds
  polygonClips?: PagePoint[][]
  /** Unrounded mask for pen envelopes; old diagnostic polygons stay unchanged. */
  penClip?: Bounds
  penClipUnsupported?: boolean
  supported: boolean
  fillColor?: string
  strokeColor?: string
  pen: Omit<PdfStrokeInk, 'points' | 'sourceToPage'>
}
type Subpath = {
  points: PagePoint[]
  controlPoints: PagePoint[]
  closed: boolean
  curved: boolean
  segments: PdfPathSegment[]
}
const MAX_OPERATIONS = 100_000
const MAX_POINTS = 20_000
const MAX_PATHS = 5000
const MAX_PAINT_EVENTS = 6000

function updatePen(state: GraphicsState, key: string, value: unknown) {
  const pen = state.pen
  if (key === 'D') {
    if (
      !Array.isArray(value) ||
      value.length !== 2 ||
      !Array.isArray(value[0]) ||
      value[0].length > 100 ||
      !value[0].every((item) => Number.isFinite(item) && item >= 0) ||
      !Number.isFinite(value[1])
    )
      pen.refusalReason ??= 'invalid-source-pen-state'
    else {
      pen.dashArray = [...value[0]]
      pen.dashPhase = value[1]
    }
  } else if (key === 'LC' || key === 'LJ') {
    if (value !== 0 && value !== 1 && value !== 2) pen.refusalReason ??= 'invalid-source-pen-state'
    else if (key === 'LC') pen.lineCap = value
    else pen.lineJoin = value
  } else if (key === 'LW' || key === 'ML') {
    if (typeof value !== 'number' || !Number.isFinite(value) || value < 0 || value > 10000)
      pen.refusalReason ??= 'invalid-source-pen-state'
    else if (key === 'LW') pen.lineWidth = value
    else if (value < 1) pen.refusalReason ??= 'invalid-source-pen-state'
    else pen.miterLimit = value
  }
}

function strokeInk(raw: Subpath, state: GraphicsState, viewport: Viewport): PdfStrokeInk {
  const m = state.matrix
  const [ox = Number.NaN, oy = Number.NaN] = viewport.convertToViewportPoint(m[4], m[5])
  const [xx = Number.NaN, xy = Number.NaN] = viewport.convertToViewportPoint(
    m[0] + m[4],
    m[1] + m[5],
  )
  const [yx = Number.NaN, yy = Number.NaN] = viewport.convertToViewportPoint(
    m[2] + m[4],
    m[3] + m[5],
  )
  const sx = 1000 / viewport.width
  const sy = 1000 / viewport.height
  const transform: Matrix = [
    (xx - ox) * sx,
    (xy - oy) * sy,
    (yx - ox) * sx,
    (yy - oy) * sy,
    ox * sx,
    oy * sy,
  ]
  const result: PdfStrokeInk = {
    ...state.pen,
    dashArray: [...state.pen.dashArray],
    points: raw.points.map((point) => ({ ...point })),
    sourceToPage: transform,
  }
  if (result.refusalReason) return result
  const [a, b, c, d, e, f] = transform
  const determinant = a * d - b * c
  if (
    !transform.every(Number.isFinite) ||
    Math.abs(determinant) <= 64 * Number.EPSILON * Math.max(Math.abs(a * d), Math.abs(b * c))
  )
    result.refusalReason = 'unstable-source-pen-transform'
  else if (result.lineWidth === 0) result.refusalReason = 'device-dependent-source-hairline'
  else if (result.dashArray.length) result.refusalReason = 'dashed-source-pen'
  else if (raw.curved || raw.closed || raw.points.length !== 2)
    result.refusalReason = 'unsupported-source-pen-topology'
  else if (state.penClipUnsupported || state.polygonClips?.length)
    result.refusalReason = 'unsupported-source-pen-clip'
  else {
    // A conservative full envelope includes round/square caps. It never proves
    // visibility from centreline containment or the clipping epsilon.
    const radius = result.lineWidth / Math.SQRT2
    const padX = radius * Math.hypot(a, c)
    const padY = radius * Math.hypot(b, d)
    const bounds = pointBounds(
      raw.points.map((point) => ({
        x: a * point.x + c * point.y + e,
        y: b * point.x + d * point.y + f,
      })),
    )
    const clip = state.penClip ?? { left: 0, top: 0, right: 1000, bottom: 1000 }
    if (
      bounds.left - padX <= Math.max(0, clip.left) ||
      bounds.right + padX >= Math.min(1000, clip.right) ||
      bounds.top - padY <= Math.max(0, clip.top) ||
      bounds.bottom + padY >= Math.min(1000, clip.bottom)
    )
      result.refusalReason = 'source-pen-envelope-clipped'
  }
  return result
}

function matrix(raw: unknown): Matrix | undefined {
  if (!Array.isArray(raw) || raw.length !== 6 || !raw.every(Number.isFinite)) return undefined
  return raw as Matrix
}

function multiply(a: Matrix, b: Matrix): Matrix {
  return [
    a[0] * b[0] + a[2] * b[1],
    a[1] * b[0] + a[3] * b[1],
    a[0] * b[2] + a[2] * b[3],
    a[1] * b[2] + a[3] * b[3],
    a[0] * b[4] + a[2] * b[5] + a[4],
    a[1] * b[4] + a[3] * b[5] + a[5],
  ]
}

/** PDF.js 6 DrawOPS: preserve commands; a curve is never replaced with its chord. */
function subpaths(raw: unknown): Subpath[] | undefined {
  if (!Array.isArray(raw) && !(raw instanceof Float32Array)) return undefined
  if (raw.length > MAX_POINTS * 7 || !raw.every(Number.isFinite)) return undefined
  const paths: Subpath[] = []
  let current: Subpath | undefined
  for (let i = 0; i < raw.length; ) {
    const command = raw[i++]
    if (command === 4) {
      if (!current) return undefined
      current.closed = true
      continue
    }
    const size = command === 0 || command === 1 ? 2 : command === 2 ? 6 : command === 3 ? 4 : 0
    if (size === 0 || i + size > raw.length || (command !== 0 && (!current || current.closed)))
      return undefined
    const point = { x: raw[i + size - 2], y: raw[i + size - 1] }
    if (typeof point.x !== 'number' || typeof point.y !== 'number') return undefined
    if (command === 0) {
      current = { points: [point], controlPoints: [], closed: false, curved: false, segments: [] }
      paths.push(current)
    } else if (current) {
      if (command === 2 || command === 3) {
        current.curved = true
        for (let control = i; control < i + size - 2; control += 2) {
          current.controlPoints.push({ x: raw[control], y: raw[control + 1] })
        }
      }
      if (command === 2)
        current.segments.push({
          kind: 'cubic',
          control1: { x: raw[i], y: raw[i + 1] },
          control2: { x: raw[i + 2], y: raw[i + 3] },
          end: point,
        })
      else if (command === 3)
        current.segments.push({
          kind: 'quadratic',
          control: { x: raw[i], y: raw[i + 1] },
          end: point,
        })
      else current.segments.push({ kind: 'line', end: point })
      current.points.push(point)
    }
    i += size
  }
  return paths
}

function rectangle(points: PagePoint[]): Bounds | undefined {
  const first = points[0]
  const last = points.at(-1)
  if (!first || !last) return undefined
  const corners = first.x === last.x && first.y === last.y ? points.slice(0, -1) : points
  if (corners.length !== 4) return undefined
  const xs = [...new Set(corners.map((point) => point.x))]
  const ys = [...new Set(corners.map((point) => point.y))]
  if (xs.length !== 2 || ys.length !== 2) return undefined
  if (new Set(corners.map((point) => `${point.x},${point.y}`)).size !== 4) return undefined
  if (
    corners.some((point, index) => {
      const next = corners[(index + 1) % corners.length]
      return !next || (point.x !== next.x && point.y !== next.y)
    })
  )
    return undefined
  return {
    left: Math.min(...xs),
    right: Math.max(...xs),
    top: Math.min(...ys),
    bottom: Math.max(...ys),
  }
}

function contains(bounds: Bounds, point: PagePoint): boolean {
  return (
    point.x >= bounds.left &&
    point.x <= bounds.right &&
    point.y >= bounds.top &&
    point.y <= bounds.bottom
  )
}

function pointBounds(points: PagePoint[]): Bounds {
  const first = points[0]
  if (!first) throw new Error('Cannot bound an empty PDF path')
  const bounds = { left: first.x, top: first.y, right: first.x, bottom: first.y }
  for (const point of points.slice(1)) {
    bounds.left = Math.min(bounds.left, point.x)
    bounds.top = Math.min(bounds.top, point.y)
    bounds.right = Math.max(bounds.right, point.x)
    bounds.bottom = Math.max(bounds.bottom, point.y)
  }
  return bounds
}

const CLIP_EPSILON = 0.00001

function cross(a: PagePoint, b: PagePoint, c: PagePoint): number {
  return (b.x - a.x) * (c.y - a.y) - (b.y - a.y) * (c.x - a.x)
}

function pointOnSegment(point: PagePoint, a: PagePoint, b: PagePoint): boolean {
  return (
    Math.abs(cross(a, b, point)) <= CLIP_EPSILON &&
    point.x >= Math.min(a.x, b.x) - CLIP_EPSILON &&
    point.x <= Math.max(a.x, b.x) + CLIP_EPSILON &&
    point.y >= Math.min(a.y, b.y) - CLIP_EPSILON &&
    point.y <= Math.max(a.y, b.y) + CLIP_EPSILON
  )
}

function pointInsidePolygon(point: PagePoint, polygon: PagePoint[]): boolean {
  let inside = false
  for (let i = 0; i < polygon.length; i++) {
    const a = polygon[i]
    const b = polygon[(i + 1) % polygon.length]
    if (!a || !b) return false
    if (pointOnSegment(point, a, b)) return true
    if (
      a.y > point.y !== b.y > point.y &&
      point.x < a.x + ((b.x - a.x) * (point.y - a.y)) / (b.y - a.y)
    )
      inside = !inside
  }
  return inside
}

/** Endpoints alone are insufficient for a concave mask: check every interval between crossings. */
function segmentInsidePolygon(a: PagePoint, b: PagePoint, polygon: PagePoint[]): boolean {
  if (!pointInsidePolygon(a, polygon) || !pointInsidePolygon(b, polygon)) return false
  const parameters = [0, 1]
  const dx = b.x - a.x
  const dy = b.y - a.y
  for (let i = 0; i < polygon.length; i++) {
    const c = polygon[i]
    const d = polygon[(i + 1) % polygon.length]
    if (!c || !d) return false
    const ex = d.x - c.x
    const ey = d.y - c.y
    const denominator = dx * ey - dy * ex
    if (Math.abs(denominator) <= CLIP_EPSILON) {
      if (pointOnSegment(c, a, b) || pointOnSegment(d, a, b)) {
        const lengthSquared = dx * dx + dy * dy
        if (lengthSquared > 0) {
          for (const point of [c, d]) {
            parameters.push(((point.x - a.x) * dx + (point.y - a.y) * dy) / lengthSquared)
          }
        }
      }
      continue
    }
    const t = ((c.x - a.x) * ey - (c.y - a.y) * ex) / denominator
    const u = ((c.x - a.x) * dy - (c.y - a.y) * dx) / denominator
    if (t >= 0 && t <= 1 && u >= 0 && u <= 1) parameters.push(t)
  }
  const sorted = [...new Set(parameters.filter((t) => t >= 0 && t <= 1))].sort((x, y) => x - y)
  for (let i = 1; i < sorted.length; i++) {
    const start = sorted[i - 1]
    const end = sorted[i]
    if (start === undefined || end === undefined || end - start <= Number.EPSILON) continue
    const middle = (start + end) / 2
    if (!pointInsidePolygon({ x: a.x + dx * middle, y: a.y + dy * middle }, polygon)) return false
  }
  return true
}

/** Only one straight, simple polygon is supported; curved or compound clips still fail closed. */
function simpleClipPolygon(path: Subpath): PagePoint[] | undefined {
  if (path.curved) return undefined
  const points = path.points
  const first = points[0]
  const last = points.at(-1)
  if (!first || !last || (!path.closed && (first.x !== last.x || first.y !== last.y)))
    return undefined
  const corners = first.x === last.x && first.y === last.y ? points.slice(0, -1) : points
  if (corners.length < 3 || corners.length > 100) return undefined
  let area = 0
  for (let i = 0; i < corners.length; i++) {
    const a = corners[i]
    const b = corners[(i + 1) % corners.length]
    if (!a || !b || (a.x === b.x && a.y === b.y)) return undefined
    area += a.x * b.y - a.y * b.x
    for (let j = i + 2; j < corners.length; j++) {
      if (i === 0 && j === corners.length - 1) continue
      const c = corners[j]
      const d = corners[(j + 1) % corners.length]
      if (!c || !d) return undefined
      const opposite = cross(a, b, c) * cross(a, b, d) < 0
      const reverse = cross(c, d, a) * cross(c, d, b) < 0
      if (
        (opposite && reverse) ||
        pointOnSegment(c, a, b) ||
        pointOnSegment(d, a, b) ||
        pointOnSegment(a, c, d) ||
        pointOnSegment(b, c, d)
      )
        return undefined
    }
  }
  return Math.abs(area) > CLIP_EPSILON ? corners : undefined
}

function pathInsidePolygon(path: Subpath, polygon: PagePoint[], closed: boolean): boolean {
  const segmentCount = closed ? path.points.length : path.points.length - 1
  for (let i = 0; i < segmentCount; i++) {
    const a = path.points[i]
    const b = path.points[(i + 1) % path.points.length]
    if (!a || !b || !segmentInsidePolygon(a, b, polygon)) return false
  }
  return true
}

export function pdfVectorRectangle(path: PdfVectorPath): Bounds | undefined {
  return path.closed ? rectangle(path.points) : undefined
}

/** Diagnostic vector layer, not walls, millimetres or proof of a room's measurement. */
export function extractPdfLinework(
  list: { fnArray: readonly number[]; argsArray: readonly unknown[] },
  ops: Operators,
  viewport: Viewport,
  paintViewport?: { width: number; height: number },
): PdfLinework {
  if (
    !Number.isFinite(viewport.width) ||
    !Number.isFinite(viewport.height) ||
    viewport.width <= 0 ||
    viewport.height <= 0
  ) {
    throw new Error('Invalid PDF viewport')
  }
  const result: PdfLinework = {
    coordinateSystem: 'page-0-1000',
    pageWidth: viewport.width,
    pageHeight: viewport.height,
    paths: [],
    paintBounds: { complete: true, refusalReason: null, events: [] },
    curvePaths: [],
    curvePathsTruncated: false,
    skippedCurves: 0,
    unsupportedPaths: 0,
    unsupportedContexts: 0,
    clippedPaths: 0,
    clippedPathBounds: [],
    clippedPathBoundsTruncated: false,
    skippedCurveBounds: [],
    skippedCurveBoundsTruncated: false,
    truncated: list.fnArray.length > MAX_OPERATIONS,
  }
  let state: GraphicsState = {
    matrix: [1, 0, 0, 1, 0, 0],
    supported: true,
    pen: {
      lineWidth: 1,
      lineCap: 0,
      lineJoin: 0,
      miterLimit: 10,
      dashArray: [],
      dashPhase: 0,
      refusalReason: null,
    },
  }
  const stack: GraphicsState[] = []
  let pendingClip = false
  let pointCount = 0
  let curvePointCount = 0
  const names = new Map(Object.entries(ops).map(([name, id]) => [id, name]))
  const recordPaint = (
    operationIndex: number,
    kind: PdfPaintBounds['events'][number]['kind'],
    bounds: Bounds | null,
    reason: string | null,
  ) => {
    const inventory = result.paintBounds
    if (!inventory?.complete) return
    if (inventory.events.length >= MAX_PAINT_EVENTS) {
      inventory.complete = false
      inventory.refusalReason = 'paint-envelope-output-limit'
      inventory.events = []
      return
    }
    inventory.events.push({ operationIndex, kind, bounds, reason })
  }
  const unroundedPoint = (raw: PagePoint): PagePoint => {
    const m = state.matrix
    const [x, y] = viewport.convertToViewportPoint(
      m[0] * raw.x + m[2] * raw.y + m[4],
      m[1] * raw.x + m[3] * raw.y + m[5],
    )
    return {
      x: ((x ?? Number.NaN) / viewport.width) * 1000,
      y: ((y ?? Number.NaN) / viewport.height) * 1000,
    }
  }
  const point = (raw: PagePoint): PagePoint => {
    const m = state.matrix
    const [x, y] = viewport.convertToViewportPoint(
      m[0] * raw.x + m[2] * raw.y + m[4],
      m[1] * raw.x + m[3] * raw.y + m[5],
    )
    return {
      x: Math.round(((x ?? Number.NaN) / viewport.width) * 1_000_000) / 1000,
      y: Math.round(((y ?? Number.NaN) / viewport.height) * 1_000_000) / 1000,
    }
  }
  const rasterPen = () => {
    if (!state.supported) return null
    const pen = state.pen
    if (pen.refusalReason || (pen.lineWidth === 0 && !paintViewport)) return null
    const m = state.matrix
    const origin = unroundedPoint({ x: 0, y: 0 })
    const x = unroundedPoint({ x: 1, y: 0 })
    const y = unroundedPoint({ x: 0, y: 1 })
    // Include square caps and every possible miter. Dash never shrinks a bound.
    const a = x.x - origin.x,
      b = x.y - origin.y
    const c = y.x - origin.x,
      d = y.y - origin.y
    let scaleX = 1,
      scaleY = 1
    if (paintViewport) {
      if (
        ![paintViewport.width, paintViewport.height].every(
          (value) => Number.isFinite(value) && value > 0,
        )
      )
        return null
      const da = (a * paintViewport.width) / 1000,
        db = (b * paintViewport.height) / 1000
      const dc = (c * paintViewport.width) / 1000,
        dd = (d * paintViewport.height) / 1000
      const normX = Math.hypot(da, db),
        normY = Math.hypot(dc, dd)
      // Installed PDF.js getScaleForStroking widens thin ink to one device
      // pixel. Replay that scale for exclusion bounds, not physical pen evidence.
      if (db === 0 && dc === 0) {
        if (normX === 0 || normY === 0) return null
        scaleX = pen.lineWidth === 0 ? 1 / normX : Math.max(1, 1 / (normX * pen.lineWidth))
        scaleY = pen.lineWidth === 0 ? 1 / normY : Math.max(1, 1 / (normY * pen.lineWidth))
      } else {
        const determinant = Math.abs(da * dd - db * dc)
        if (
          !Number.isFinite(determinant) ||
          determinant <= 64 * Number.EPSILON * (Math.abs(da * dd) + Math.abs(db * dc))
        )
          return null
        const area = (pen.lineWidth || 1) * determinant
        scaleX = pen.lineWidth === 0 ? normY / determinant : Math.max(1, normY / area)
        scaleY = pen.lineWidth === 0 ? normX / determinant : Math.max(1, normX / area)
      }
    }
    const sourceToPage: Matrix = [
      a * scaleX,
      b * scaleX,
      c * scaleY,
      d * scaleY,
      origin.x,
      origin.y,
    ]
    if (
      !m.every(Number.isFinite) ||
      !sourceToPage.every(Number.isFinite) ||
      ![scaleX, scaleY].every((value) => Number.isFinite(value) && value > 0)
    )
      return null
    return { sourceToPage, scaleX, scaleY, radius: (pen.lineWidth || 1) / 2 }
  }
  const envelope = (points: PagePoint[], stroked: boolean, joined = true): Bounds | null => {
    if (!state.supported || !points.length) return null
    const mapped = points.map(unroundedPoint)
    if (mapped.some((p) => !Number.isFinite(p.x) || !Number.isFinite(p.y))) return null
    const box = pointBounds(mapped)
    let padX = 0
    let padY = 0
    if (stroked) {
      const pen = rasterPen()
      if (!pen) return null
      const [a, b, c, d] = pen.sourceToPage
      const radius = pen.radius * Math.max(Math.SQRT2, joined ? state.pen.miterLimit : 0)
      padX = radius * Math.hypot(a, c)
      padY = radius * Math.hypot(b, d)
      if (!Number.isFinite(padX + padY)) return null
    }
    // This is an outward arithmetic guard, not a contact or installation tolerance.
    const guard =
      64 *
      Number.EPSILON *
      (1 + padX + padY + mapped.reduce((sum, p) => sum + Math.abs(p.x) + Math.abs(p.y), 0))
    return {
      left: box.left - padX - guard,
      right: box.right + padX + guard,
      top: box.top - padY - guard,
      bottom: box.bottom + padY + guard,
    }
  }
  for (
    let operationIndex = 0;
    operationIndex < Math.min(list.fnArray.length, MAX_OPERATIONS);
    operationIndex++
  ) {
    const fn = list.fnArray[operationIndex]
    const rawArgs = list.argsArray[operationIndex]
    const args = Array.isArray(rawArgs) ? rawArgs : []
    const name = names.get(fn as number)
    if (!name && result.paintBounds) {
      result.paintBounds.complete = false
      result.paintBounds.refusalReason = 'unknown-paint-envelope-operator'
      result.paintBounds.events = []
    }
    if (
      name &&
      ['showText', 'showSpacedText', 'nextLineShowText', 'nextLineSetSpacingShowText'].includes(
        name,
      )
    )
      recordPaint(operationIndex, 'text', null, 'text-paint-envelope-unavailable')
    else if (
      name &&
      [
        'paintImageXObject',
        'paintInlineImageXObject',
        'paintImageMaskXObject',
        'paintSolidColorImageMask',
      ].includes(name)
    )
      recordPaint(
        operationIndex,
        'image',
        envelope(
          [
            { x: 0, y: 0 },
            { x: 1, y: 0 },
            { x: 1, y: 1 },
            { x: 0, y: 1 },
          ],
          false,
        ),
        state.supported ? null : 'image-paint-context-unavailable',
      )
    else if (
      name &&
      (name.startsWith('paint') ||
        [
          'shadingFill',
          'rawFillPath',
          'endInlineImage',
          'endGroup',
          'endAnnotation',
          'stroke',
          'closeStroke',
          'fill',
          'eoFill',
          'fillStroke',
          'eoFillStroke',
          'closeFillStroke',
          'closeEOFillStroke',
        ].includes(name))
    )
      recordPaint(operationIndex, 'unknown', null, 'unsupported-paint-envelope-operation')
    if (
      fn === ops.save ||
      fn === ops.paintFormXObjectBegin ||
      fn === ops.beginGroup ||
      fn === ops.beginAnnotation
    ) {
      stack.push(state)
      state = { ...state, pen: { ...state.pen, dashArray: [...state.pen.dashArray] } }
      if (fn !== ops.save) {
        state.supported = false
        result.unsupportedContexts++
      }
      continue
    }
    if (
      fn === ops.restore ||
      fn === ops.paintFormXObjectEnd ||
      fn === ops.endGroup ||
      fn === ops.endAnnotation
    ) {
      const previous = stack.pop()
      if (!previous) {
        state.supported = false
        result.unsupportedContexts++
      } else state = previous
      continue
    }
    if (fn === ops.transform) {
      const transform = matrix(args)
      if (!transform) {
        state.supported = false
        result.unsupportedContexts++
      } else state.matrix = multiply(state.matrix, transform)
      continue
    }
    const penKey =
      fn === ops.setLineWidth
        ? 'LW'
        : fn === ops.setLineCap
          ? 'LC'
          : fn === ops.setLineJoin
            ? 'LJ'
            : fn === ops.setMiterLimit
              ? 'ML'
              : fn === ops.setDash
                ? 'D'
                : null
    if (penKey) {
      updatePen(state, penKey, penKey === 'D' ? args : args[0])
      continue
    }
    if (fn === ops.setGState) {
      if (!Array.isArray(args[0]) || args[0].length > 100)
        state.pen.refusalReason ??= 'invalid-source-pen-state'
      else
        for (const pair of args[0]) {
          if (!Array.isArray(pair) || pair.length !== 2 || typeof pair[0] !== 'string')
            state.pen.refusalReason ??= 'invalid-source-pen-state'
          else updatePen(state, pair[0], pair[1])
        }
      continue
    }
    if (fn === ops.setFillRGBColor || fn === ops.setStrokeRGBColor) {
      const color = args[0]
      // Keep only explicit PDF.js RGB values; an absent style is unknown, not black.
      const verifiedColor =
        typeof color === 'string' && /^#[0-9a-f]{6}$/i.test(color) ? color.toLowerCase() : undefined
      if (fn === ops.setFillRGBColor) state.fillColor = verifiedColor
      else state.strokeColor = verifiedColor
      continue
    }
    if (fn === ops.clip || fn === ops.eoClip) {
      pendingClip = true
      continue
    }
    if (fn !== ops.constructPath) continue
    // PDF.js выдаёт [endPath, [null], null] для пустого сброса без геометрии.
    // Пустая/непонятная маска всё ещё требует отказа, а не отмены отсечения.
    if (
      args[0] === ops.endPath &&
      Array.isArray(args[1]) &&
      args[1].length === 1 &&
      args[1][0] === null &&
      args[2] === null &&
      !pendingClip
    )
      continue
    const rawPaths = Array.isArray(args[1]) ? subpaths(args[1][0]) : undefined
    if (args[0] !== ops.endPath) {
      const sourceStroke = [
        ops.stroke,
        ops.closeStroke,
        ops.fillStroke,
        ops.eoFillStroke,
        ops.closeFillStroke,
        ops.closeEOFillStroke,
      ].includes(args[0] as number)
      const sourceFill = [
        ops.fill,
        ops.eoFill,
        ops.fillStroke,
        ops.eoFillStroke,
        ops.closeFillStroke,
        ops.closeEOFillStroke,
      ].includes(args[0] as number)
      const bounds =
        rawPaths && (sourceStroke || sourceFill)
          ? envelope(
              rawPaths.flatMap((path) => [...path.points, ...path.controlPoints]),
              sourceStroke,
              rawPaths.some((path) => path.closed || path.points.length > 2),
            )
          : null
      recordPaint(
        operationIndex,
        'vector',
        bounds,
        bounds ? null : 'vector-paint-envelope-unavailable',
      )
      const event = result.paintBounds?.events.at(-1)
      if (event?.operationIndex === operationIndex && rawPaths) event.subpathCount = rawPaths.length
      const rawStroke = rawPaths?.length === 1 ? rawPaths[0] : undefined
      if (
        event?.operationIndex === operationIndex &&
        bounds &&
        args[0] === ops.stroke &&
        rawStroke &&
        !rawStroke.closed &&
        !rawStroke.curved &&
        rawStroke.points.length === 2
      ) {
        const pen = rasterPen()
        const start = rawStroke.points[0],
          end = rawStroke.points[1]
        if (pen && start && end)
          event.straightStrokeRegion = {
            start: { x: start.x / pen.scaleX, y: start.y / pen.scaleY },
            end: { x: end.x / pen.scaleX, y: end.y / pen.scaleY },
            sourceToPage: pen.sourceToPage,
            radius: pen.radius * (state.pen.lineCap === 2 ? Math.SQRT2 : 1),
          }
      }
    }
    if (!rawPaths) {
      result.unsupportedPaths++
      if (pendingClip) state.supported = false
      pendingClip = false
      continue
    }
    const transformed = rawPaths.map((path) => ({
      ...path,
      points: path.points.map(point),
      controlPoints: path.controlPoints.map(point),
      segments: path.segments.map((segment): PdfPathSegment => {
        if (segment.kind === 'cubic')
          return {
            kind: 'cubic',
            control1: point(segment.control1),
            control2: point(segment.control2),
            end: point(segment.end),
          }
        if (segment.kind === 'quadratic')
          return { kind: 'quadratic', control: point(segment.control), end: point(segment.end) }
        return { kind: 'line', end: point(segment.end) }
      }),
    }))
    const invalid = transformed.some((path) =>
      [...path.points, ...path.controlPoints].some(
        (p) => !Number.isFinite(p.x) || !Number.isFinite(p.y),
      ),
    )
    if (invalid) {
      result.unsupportedPaths++
      state.supported = false
      pendingClip = false
      continue
    }
    if (pendingClip) {
      const rawClip = rawPaths.length === 1 ? rawPaths[0] : undefined
      const preciseClip =
        rawClip && !rawClip.curved ? rectangle(rawClip.points.map(unroundedPoint)) : undefined
      if (!preciseClip) state.penClipUnsupported = true
      else
        state.penClip = state.penClip
          ? {
              left: Math.max(state.penClip.left, preciseClip.left),
              top: Math.max(state.penClip.top, preciseClip.top),
              right: Math.min(state.penClip.right, preciseClip.right),
              bottom: Math.min(state.penClip.bottom, preciseClip.bottom),
            }
          : preciseClip
      const path = transformed[0]
      const box =
        transformed.length === 1 && path && !path.curved ? rectangle(path.points) : undefined
      const polygon = transformed.length === 1 && path ? simpleClipPolygon(path) : undefined
      if (!polygon) {
        state.supported = false
        result.unsupportedContexts++
      } else if (box) {
        state.clip = state.clip
          ? {
              left: Math.max(state.clip.left, box.left),
              top: Math.max(state.clip.top, box.top),
              right: Math.min(state.clip.right, box.right),
              bottom: Math.min(state.clip.bottom, box.bottom),
            }
          : box
      } else {
        state.polygonClips = [...(state.polygonClips ?? []), polygon]
      }
      pendingClip = false
    }
    const paint = args[0]
    if (paint === ops.endPath || !state.supported) continue
    if (typeof paint !== 'number') {
      result.unsupportedPaths++
      continue
    }
    const stroked = [
      ops.stroke,
      ops.closeStroke,
      ops.fillStroke,
      ops.eoFillStroke,
      ops.closeFillStroke,
      ops.closeEOFillStroke,
    ].includes(paint)
    const filled = [
      ops.fill,
      ops.eoFill,
      ops.fillStroke,
      ops.eoFillStroke,
      ops.closeFillStroke,
      ops.closeEOFillStroke,
    ].includes(paint)
    if (!stroked && !filled) {
      result.unsupportedPaths++
      continue
    }
    const paintKind: PdfVectorPath['paint'] = filled ? (stroked ? 'fill-stroke' : 'fill') : 'stroke'
    for (const [subpathIndex, path] of transformed.entries()) {
      if (path.curved) {
        result.skippedCurves++
        if (result.skippedCurveBounds && result.skippedCurveBounds.length < MAX_PATHS) {
          result.skippedCurveBounds.push({
            operationIndex,
            bounds: pointBounds([...path.points, ...path.controlPoints]),
            paint: paintKind,
          })
        } else {
          result.skippedCurveBoundsTruncated = true
        }
        // The control box encloses every Bezier segment. Check all its edges:
        // endpoints alone cannot prove visibility through a concave mask.
        const sourcePoints = [...path.points, ...path.controlPoints]
        const bounds = pointBounds(sourcePoints)
        const enclosure = [
          { x: bounds.left, y: bounds.top },
          { x: bounds.right, y: bounds.top },
          { x: bounds.right, y: bounds.bottom },
          { x: bounds.left, y: bounds.bottom },
        ]
        const start = path.points[0]
        if (
          start &&
          (state.polygonClips ?? []).every((polygon) =>
            enclosure.every((a, index) => {
              const b = enclosure[(index + 1) % enclosure.length]
              return b !== undefined && segmentInsidePolygon(a, b, polygon)
            }),
          ) &&
          sourcePoints.every(
            (p) =>
              contains({ left: 0, top: 0, right: 1000, bottom: 1000 }, p) &&
              (!state.clip || contains(state.clip, p)),
          )
        ) {
          if (
            (result.curvePaths?.length ?? 0) >= MAX_PATHS ||
            curvePointCount + sourcePoints.length > MAX_POINTS
          ) {
            result.curvePathsTruncated = true
          } else {
            result.curvePaths?.push({
              operationIndex,
              subpathIndex,
              operationSubpathCount: transformed.length,
              paint: filled ? (stroked ? 'fill-stroke' : 'fill') : 'stroke',
              ...(stroked && state.strokeColor ? { strokeColor: state.strokeColor } : {}),
              closed:
                path.closed ||
                filled ||
                paint === ops.closeStroke ||
                (start.x === path.points.at(-1)?.x && start.y === path.points.at(-1)?.y),
              start,
              segments: path.segments,
            })
            curvePointCount += sourcePoints.length
          }
        }
        continue
      }
      if (path.points.length < 2) continue
      const clip = state.clip
      if (
        path.points.some(
          (p) =>
            !contains({ left: 0, top: 0, right: 1000, bottom: 1000 }, p) ||
            (clip && !contains(clip, p)),
        ) ||
        (state.polygonClips ?? []).some(
          (polygon) => !pathInsidePolygon(path, polygon, path.closed || filled),
        )
      ) {
        result.clippedPaths++
        if (result.clippedPathBounds && result.clippedPathBounds.length < MAX_PATHS) {
          result.clippedPathBounds.push({
            operationIndex,
            bounds: pointBounds(path.points),
            paint: paintKind,
          })
        } else {
          result.clippedPathBoundsTruncated = true
        }
        continue
      }
      const first = path.points[0]
      const last = path.points.at(-1)
      const closed =
        path.closed ||
        filled ||
        paint === ops.closeStroke ||
        (first?.x === last?.x && first?.y === last?.y)
      if (result.paths.length >= MAX_PATHS || pointCount + path.points.length > MAX_POINTS) {
        result.truncated = true
        if (result.paintBounds) {
          result.paintBounds.complete = false
          result.paintBounds.refusalReason = 'incomplete-paint-envelope-operators'
          result.paintBounds.events = []
        }
        return result
      }
      result.paths.push({
        operationIndex,
        subpathIndex,
        paint: filled ? (stroked ? 'fill-stroke' : 'fill') : 'stroke',
        ...(filled && state.fillColor ? { fillColor: state.fillColor } : {}),
        ...(stroked && state.strokeColor ? { strokeColor: state.strokeColor } : {}),
        closed,
        points: path.points,
        ...(stroked
          ? { strokeInk: strokeInk(rawPaths[subpathIndex] as Subpath, state, viewport) }
          : {}),
      })
      pointCount += path.points.length
    }
  }
  if (stack.length > 0 || pendingClip) result.unsupportedContexts++
  if (result.paintBounds && (result.truncated || list.fnArray.length !== list.argsArray.length)) {
    result.paintBounds.complete = false
    result.paintBounds.refusalReason = 'incomplete-paint-envelope-operators'
    result.paintBounds.events = []
  }
  return result
}
