type Matrix = [number, number, number, number, number, number]
export type PagePoint = { x: number; y: number }
type Bounds = { left: number; top: number; right: number; bottom: number }
export type PdfVectorPath = {
  operationIndex: number
  subpathIndex: number
  paint: 'stroke' | 'fill' | 'fill-stroke'
  closed: boolean
  points: PagePoint[]
}
export type PdfLinework = {
  coordinateSystem: 'page-0-1000'
  pageWidth: number
  pageHeight: number
  paths: PdfVectorPath[]
  skippedCurves: number
  unsupportedPaths: number
  unsupportedContexts: number
  clippedPaths: number
  truncated: boolean
}
type Operators = Readonly<Record<string, number>>
type Viewport = {
  width: number
  height: number
  convertToViewportPoint(x: number, y: number): number[]
}
type GraphicsState = { matrix: Matrix; clip?: Bounds; supported: boolean }
type Subpath = { points: PagePoint[]; closed: boolean; curved: boolean }
const MAX_OPERATIONS = 100_000
const MAX_POINTS = 20_000
const MAX_PATHS = 3000

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

/** PDF.js 6 DrawOPS: straight subpaths only; a curve is never replaced with its chord. */
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
      current = { points: [point], closed: false, curved: false }
      paths.push(current)
    } else if (current) {
      if (command === 2 || command === 3) current.curved = true
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

export function pdfVectorRectangle(path: PdfVectorPath): Bounds | undefined {
  return path.closed ? rectangle(path.points) : undefined
}

/** Diagnostic vector layer, not walls, millimetres or proof of a room's measurement. */
export function extractPdfLinework(
  list: { fnArray: readonly number[]; argsArray: readonly unknown[] },
  ops: Operators,
  viewport: Viewport,
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
    skippedCurves: 0,
    unsupportedPaths: 0,
    unsupportedContexts: 0,
    clippedPaths: 0,
    truncated: list.fnArray.length > MAX_OPERATIONS,
  }
  let state: GraphicsState = { matrix: [1, 0, 0, 1, 0, 0], supported: true }
  const stack: GraphicsState[] = []
  let pendingClip = false
  let pointCount = 0
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
  for (
    let operationIndex = 0;
    operationIndex < Math.min(list.fnArray.length, MAX_OPERATIONS);
    operationIndex++
  ) {
    const fn = list.fnArray[operationIndex]
    const rawArgs = list.argsArray[operationIndex]
    const args = Array.isArray(rawArgs) ? rawArgs : []
    if (
      fn === ops.save ||
      fn === ops.paintFormXObjectBegin ||
      fn === ops.beginGroup ||
      fn === ops.beginAnnotation
    ) {
      stack.push(state)
      state = { ...state }
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
    if (fn === ops.clip || fn === ops.eoClip) {
      pendingClip = true
      continue
    }
    if (fn !== ops.constructPath) continue
    const rawPaths = Array.isArray(args[1]) ? subpaths(args[1][0]) : undefined
    if (!rawPaths) {
      result.unsupportedPaths++
      if (pendingClip) state.supported = false
      pendingClip = false
      continue
    }
    const transformed = rawPaths.map((path) => ({ ...path, points: path.points.map(point) }))
    const invalid = transformed.some((path) =>
      path.points.some((p) => !Number.isFinite(p.x) || !Number.isFinite(p.y)),
    )
    if (invalid) {
      result.unsupportedPaths++
      state.supported = false
      pendingClip = false
      continue
    }
    if (pendingClip) {
      const path = transformed[0]
      const box =
        transformed.length === 1 && path && !path.curved ? rectangle(path.points) : undefined
      if (!box) {
        state.supported = false
        result.unsupportedContexts++
      } else {
        state.clip = state.clip
          ? {
              left: Math.max(state.clip.left, box.left),
              top: Math.max(state.clip.top, box.top),
              right: Math.min(state.clip.right, box.right),
              bottom: Math.min(state.clip.bottom, box.bottom),
            }
          : box
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
    for (const [subpathIndex, path] of transformed.entries()) {
      if (path.curved) {
        result.skippedCurves++
        continue
      }
      if (path.points.length < 2) continue
      const clip = state.clip
      if (
        path.points.some(
          (p) =>
            !contains({ left: 0, top: 0, right: 1000, bottom: 1000 }, p) ||
            (clip && !contains(clip, p)),
        )
      ) {
        result.clippedPaths++
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
        return result
      }
      result.paths.push({
        operationIndex,
        subpathIndex,
        paint: filled ? (stroked ? 'fill-stroke' : 'fill') : 'stroke',
        closed,
        points: path.points,
      })
      pointCount += path.points.length
    }
  }
  if (stack.length > 0 || pendingClip) result.unsupportedContexts++
  return result
}
