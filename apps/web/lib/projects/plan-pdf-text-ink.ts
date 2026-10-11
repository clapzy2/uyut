import { nativeDimensionCaptionMillimetres } from './plan-pdf-caption-binding'
import type { PagePoint } from './plan-pdf-linework'

type Matrix = [number, number, number, number, number, number]
type Quad = [PagePoint, PagePoint, PagePoint, PagePoint]
type InkBounds = { left: number; bottom: number; right: number; top: number }
type SourceShow = {
  operationIndex: number
  text: string
  charSpacing: number
  wordSpacing: number
  glyphWidths: number[]
  textMatrix: Matrix
}

export type PdfTextInkFont = {
  fontMatrix?: ArrayLike<number>
  vertical?: boolean
  isType3Font?: boolean
  missingFile?: boolean
  disableFontFace?: boolean
}

export type NativeNumericTextInk = {
  complete: boolean
  refusalReason: string | null
  items: {
    index: number
    text: string
    fontName: string
    operationIndex: number
    quad: Quad
    baselineStart: PagePoint
    baselineEnd: PagePoint
    sourceGroup?: {
      operationIndexes: number[]
      shows: SourceShow[]
      packedTextMatrixOperationIndex?: number
      packedTranslation?: [number, number]
      cursorOffset?: [number, number]
      packedTextMatrix?: Matrix
      sourceCtm?: Matrix
      textContentTransform?: Matrix
      fontSize?: number
      horizontalScale?: number
    }
  }[]
  unresolved: { index: number; reason: string }[]
}

type TextItem = { str: string; fontName: string; transform: Matrix; width: number }
type State = {
  ctm: Matrix
  textMatrix: Matrix
  lineMatrix: Matrix
  fontName?: string
  fontSize: number
  hScale: number
  rise: number
  leading: number
  charSpacing: number
  wordSpacing: number
  renderingMode: number
  active: boolean
  quantizedTextLinear: boolean
  textAdvanceUnverified: boolean
  packedOrigin?: {
    operationIndex: number
    matrix: Matrix
    lineOffset: [number, number]
    textOffset: [number, number]
  }
  clips: Quad[]
  reason?: string
}
type Run = {
  operationIndex: number
  text: string
  fontName: string
  transform: Matrix
  advance: number
  ctm: Matrix
  textMatrix: Matrix
  fontSize: number
  hScale: number
  quantizedTextLinear: boolean
  endTransform: Matrix
  sourceOperations: number[]
  cursorAdvance: number
  nonzeroSpacing: boolean
  textRise: number
  shows: SourceShow[]
  packedOrigin?: State['packedOrigin']
  quad?: Quad
  reason?: string
}

const IDENTITY: Matrix = [1, 0, 0, 1, 0, 0]
const MAX_OPERATIONS = 100_000
const MAX_ITEMS = 1000
const MAX_GLYPHS = 1000
const MAX_PATH_VALUES = 20_000
const MAX_WORK = 2_000_000
const ARITHMETIC_EPSILON = 1e-7

function values(raw: unknown, limit: number): number[] | undefined {
  if (!Array.isArray(raw) && (!ArrayBuffer.isView(raw) || raw instanceof DataView)) return
  if ((raw as ArrayLike<number>).length > limit) return
  const result = Array.from(raw as ArrayLike<number>)
  if (result.length > limit || !result.every(Number.isFinite)) return
  return result
}

function matrix(raw: unknown): Matrix | undefined {
  const result = values(raw, 6)
  return result?.length === 6 ? (result as Matrix) : undefined
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

function translate(m: Matrix, x: number, y: number): Matrix {
  return multiply(m, [1, 0, 0, 1, x, y])
}

function point(m: Matrix, x: number, y: number): PagePoint {
  return { x: m[0] * x + m[2] * y + m[4], y: m[1] * x + m[3] * y + m[5] }
}

function rectangle(b: InkBounds, transform: Matrix): Quad {
  return [
    point(transform, b.left, b.bottom),
    point(transform, b.right, b.bottom),
    point(transform, b.right, b.top),
    point(transform, b.left, b.top),
  ]
}

function transformedOutline(path: number[], transform: Matrix): number[] | undefined {
  const result: number[] = []
  for (let i = 0; i < path.length; ) {
    const command = path[i++]
    result.push(command as number)
    if (command === 4) continue
    const count = command === 0 || command === 1 ? 2 : command === 2 ? 6 : command === 3 ? 4 : 0
    if (!count || i + count > path.length) return
    for (let end = i + count; i < end; i += 2) {
      const p = point(transform, path[i] as number, path[i + 1] as number)
      result.push(p.x, p.y)
    }
  }
  return result
}

function segmentArea(points: PagePoint[]): number {
  const polynomial = (axis: 'x' | 'y') => {
    const p = points.map((point) => point[axis])
    const a = p[0] as number,
      b = p[1] as number,
      c = p[2] as number,
      d = p[3] as number
    if (p.length === 2) return [a, b - a]
    if (p.length === 3) return [a, 2 * (b - a), a - 2 * b + c]
    return [a, 3 * (b - a), 3 * (a - 2 * b + c), -a + 3 * b - 3 * c + d]
  }
  const x = polynomial('x'),
    y = polynomial('y')
  let area = 0
  for (let i = 0; i < x.length; i++)
    for (let j = 1; j < y.length; j++) {
      area +=
        (((x[i] as number) * (y[j] as number) - (y[i] as number) * (x[j] as number)) * j) / (i + j)
    }
  return area / 2
}

/** Bounds of actual embedded PDF.js DrawOPS outlines, not font metrics or control-point boxes. */
export function pdfGlyphInkBounds(raw: unknown): InkBounds | undefined {
  const path = values(raw, MAX_PATH_VALUES)
  if (!path || path.length === 0) return
  let current: PagePoint | undefined
  let first: PagePoint | undefined
  let closed = false
  let bounds: InkBounds = { left: Infinity, bottom: Infinity, right: -Infinity, top: -Infinity }
  const contours: { bounds: InkBounds; area: number }[] = []
  const segments = new Set<string>()
  let contourArea = 0
  let segmentCount = 0
  const segment = (points: PagePoint[]) => {
    if (points.length === 2 && points[0]?.x === points[1]?.x && points[0]?.y === points[1]?.y)
      return true
    const forward = points.map((p) => `${p.x}:${p.y}`).join('/')
    const reverse = [...points]
      .reverse()
      .map((p) => `${p.x}:${p.y}`)
      .join('/')
    const key = forward < reverse ? forward : reverse
    if (segments.has(key)) return false
    segments.add(key)
    segmentCount++
    contourArea += segmentArea(points)
    return Number.isFinite(contourArea)
  }
  const add = (p: PagePoint) => {
    bounds.left = Math.min(bounds.left, p.x)
    bounds.right = Math.max(bounds.right, p.x)
    bounds.bottom = Math.min(bounds.bottom, p.y)
    bounds.top = Math.max(bounds.top, p.y)
  }
  const finishContour = () => {
    if (segmentCount === 0 || contourArea === 0 || !Object.values(bounds).every(Number.isFinite))
      return false
    contours.push({ bounds: { ...bounds }, area: contourArea })
    closed = true
    return true
  }
  for (let i = 0; i < path.length; ) {
    const command = path[i++]
    if (command === 4) {
      if (!current || !first || closed) return
      if (!segment([current, first])) return
      if (!finishContour()) return
      current = first
      closed = true
      continue
    }
    const count = command === 0 || command === 1 ? 2 : command === 2 ? 6 : command === 3 ? 4 : 0
    if (!count || i + count > path.length || (command !== 0 && (!current || closed))) return
    const end = { x: path[i + count - 2] as number, y: path[i + count - 1] as number }
    if (command === 0) {
      if (!closed && segmentCount > 0) {
        // PDF.js TrueType contours also close with an exact line-to-start before the next move.
        if (current?.x !== first?.x || current?.y !== first?.y || !finishContour()) return
      }
      first = end
      closed = false
      bounds = { left: Infinity, bottom: Infinity, right: -Infinity, top: -Infinity }
      contourArea = 0
      segmentCount = 0
    } else if (current) {
      add(current)
      add(end)
      if (command === 2 || command === 3) {
        const c1 = { x: path[i] as number, y: path[i + 1] as number }
        const c2 =
          command === 2 ? { x: path[i + 2] as number, y: path[i + 3] as number } : undefined
        if (!segment(c2 ? [current, c1, c2, end] : [current, c1, end])) return
        const roots: number[] = []
        for (const axis of ['x', 'y'] as const) {
          if (!c2) {
            const denominator = current[axis] - 2 * c1[axis] + end[axis]
            if (!Number.isFinite(denominator)) return
            if (denominator !== 0) roots.push((current[axis] - c1[axis]) / denominator)
          } else {
            const a = -current[axis] + 3 * c1[axis] - 3 * c2[axis] + end[axis]
            const b = 2 * (current[axis] - 2 * c1[axis] + c2[axis])
            const c = c1[axis] - current[axis]
            if (![a, b, c].every(Number.isFinite)) return
            if (a === 0) {
              if (b !== 0) roots.push(-c / b)
            } else {
              const discriminant = b * b - 4 * a * c
              if (!Number.isFinite(discriminant)) return
              if (discriminant >= 0)
                roots.push(
                  (-b + Math.sqrt(discriminant)) / (2 * a),
                  (-b - Math.sqrt(discriminant)) / (2 * a),
                )
            }
          }
        }
        for (const t of roots.filter((t) => Number.isFinite(t) && t > 0 && t < 1)) {
          const u = 1 - t
          add(
            c2
              ? {
                  x:
                    u ** 3 * current.x +
                    3 * u * u * t * c1.x +
                    3 * u * t * t * c2.x +
                    t ** 3 * end.x,
                  y:
                    u ** 3 * current.y +
                    3 * u * u * t * c1.y +
                    3 * u * t * t * c2.y +
                    t ** 3 * end.y,
                }
              : {
                  x: u * u * current.x + 2 * u * t * c1.x + t * t * end.x,
                  y: u * u * current.y + 2 * u * t * c1.y + t * t * end.y,
                },
          )
        }
      } else if (!segment([current, end])) return
    }
    current = end
    i += count
  }
  if (
    !closed &&
    segmentCount > 0 &&
    (current?.x !== first?.x || current?.y !== first?.y || !finishContour())
  )
    return
  if (!contours.length || contours.reduce((sum, c) => sum + c.area, 0) === 0) return
  bounds = {
    left: Math.min(...contours.map((c) => c.bounds.left)),
    right: Math.max(...contours.map((c) => c.bounds.right)),
    bottom: Math.min(...contours.map((c) => c.bounds.bottom)),
    top: Math.max(...contours.map((c) => c.bounds.top)),
  }
  return Object.values(bounds).every(Number.isFinite) &&
    bounds.right > bounds.left &&
    bounds.top > bounds.bottom
    ? bounds
    : undefined
}

function clipQuad(raw: unknown, ctm: Matrix): Quad | undefined {
  const path = values(raw, 20)
  if (!path) return
  const points: PagePoint[] = []
  for (let i = 0; i < path.length; ) {
    const command = path[i++]
    if (command === 4 && i === path.length) break
    if (
      (command !== 0 && command !== 1) ||
      (points.length === 0) !== (command === 0) ||
      i + 2 > path.length
    )
      return
    points.push({ x: path[i++] as number, y: path[i++] as number })
  }
  if (points.length === 5 && points[0]?.x === points[4]?.x && points[0]?.y === points[4]?.y)
    points.pop()
  if (points.length !== 4 || new Set(points.map((p) => `${p.x}:${p.y}`)).size !== 4) return
  const xs = new Set(points.map((p) => p.x)),
    ys = new Set(points.map((p) => p.y))
  if (
    xs.size !== 2 ||
    ys.size !== 2 ||
    points.some((p, i) => p.x !== points[(i + 1) % 4]?.x && p.y !== points[(i + 1) % 4]?.y)
  )
    return
  return points.map((p) => point(ctm, p.x, p.y)) as Quad
}

function contains(clip: Quad, p: PagePoint): boolean {
  const crosses = clip.map((a, i) => {
    const b = clip[(i + 1) % 4] as PagePoint
    return (b.x - a.x) * (p.y - a.y) - (b.y - a.y) * (p.x - a.x)
  })
  return (
    crosses.every((value) => value >= -ARITHMETIC_EPSILON) ||
    crosses.every((value) => value <= ARITHMETIC_EPSILON)
  )
}

/** A deliberately narrow replay of native text placement. Unsupported drawing state is held. */
export function nativeNumericTextInk(input: {
  operatorList: { fnArray: ArrayLike<number>; argsArray: ArrayLike<unknown> }
  operators: Readonly<Record<string, number>>
  textItems: readonly unknown[]
  // Overrides numeric selection. Every source occurrence of a selected literal
  // is replayed, so choosing one item cannot hide a competing text-show run.
  selectedTextIndexes?: readonly number[]
  viewport: {
    width: number
    height: number
    convertToViewportPoint(x: number, y: number): number[]
  }
  getFont(fontName: string): PdfTextInkFont | undefined
  getGlyphPath(fontName: string, fontChar: string): unknown
  isOptionalContentVisible?(properties: unknown): boolean | undefined
}): NativeNumericTextInk {
  const fail = (refusalReason: string): NativeNumericTextInk => ({
    complete: false,
    refusalReason,
    items: [],
    unresolved: [],
  })
  const { operatorList, operators, textItems, viewport } = input
  if (
    operatorList.fnArray.length > MAX_OPERATIONS ||
    operatorList.fnArray.length !== operatorList.argsArray.length ||
    textItems.length > MAX_ITEMS
  )
    return fail('text-ink-budget-exceeded')
  if (![viewport.width, viewport.height].every((v) => Number.isFinite(v) && v > 0))
    return fail('invalid-text-ink-viewport')
  const selectedIndexes = input.selectedTextIndexes
  const selectedLiterals = new Set<string>()
  if (selectedIndexes !== undefined) {
    if (
      !Array.isArray(selectedIndexes) ||
      selectedIndexes.length > MAX_ITEMS ||
      new Set(selectedIndexes).size !== selectedIndexes.length
    )
      return fail('invalid-selected-text-ink-indexes')
    for (const index of selectedIndexes) {
      if (!Number.isSafeInteger(index) || index < 0 || index >= textItems.length)
        return fail('invalid-selected-text-ink-indexes')
      const item = textItems[index]
      if (
        !item ||
        typeof item !== 'object' ||
        !('str' in item) ||
        typeof item.str !== 'string' ||
        !item.str.trim() ||
        item.str.length > 200
      )
        return fail('invalid-selected-text-ink-indexes')
      selectedLiterals.add(item.str.trim())
    }
  }
  const selectedLiteralList = [...selectedLiterals]
  let work = 0
  const selectedIndexSet = new Set(selectedIndexes)
  const selectsLiteral = (literal: string) =>
    selectedIndexes === undefined
      ? nativeDimensionCaptionMillimetres(literal.trim()) !== undefined
      : selectedLiterals.has(literal.trim())
  const selectsFragment = (literal: string) =>
    selectsLiteral(literal) ||
    (selectedIndexes !== undefined &&
      literal.length > 0 &&
      selectedLiteralList.some((selected) => {
        if (work > MAX_WORK) return false
        work += selected.length + literal.length
        return selected.includes(literal)
      }))
  const startsSelectedLiteral = (fragment: string) =>
    selectedLiteralList.some((literal) => {
      if (work > MAX_WORK) return false
      work += literal.length + fragment.length
      return literal.startsWith(fragment)
    })
  const text: { index: number; item: TextItem }[] = []
  for (const [index, raw] of textItems.entries()) {
    if (!raw || typeof raw !== 'object' || !('str' in raw) || typeof raw.str !== 'string') continue
    if (raw.str.length > 200) return fail('text-ink-budget-exceeded')
    if (selectedIndexes === undefined ? !selectsLiteral(raw.str) : !selectedIndexSet.has(index))
      continue
    const item = raw as TextItem
    if (
      typeof item.fontName !== 'string' ||
      !matrix(item.transform) ||
      !Number.isFinite(item.width) ||
      item.width <= 0
    )
      return fail('invalid-native-text-ink-item')
    text.push({ index, item })
  }
  const names = new Map(Object.entries(operators).map(([name, code]) => [code, name]))
  let state: State = {
    ctm: [...IDENTITY],
    textMatrix: [...IDENTITY],
    lineMatrix: [...IDENTITY],
    fontSize: 0,
    hScale: 1,
    rise: 0,
    leading: 0,
    charSpacing: 0,
    wordSpacing: 0,
    renderingMode: 0,
    active: false,
    quantizedTextLinear: false,
    textAdvanceUnverified: false,
    clips: [],
  }
  const stack: State[] = []
  const runs: Run[] = []
  let pendingClip = false
  let markedReason: string | undefined
  const markedStack: (string | undefined)[] = []
  const save = () => stack.push(structuredClone(state))
  const restore = () => {
    const prior = stack.pop()
    if (!prior) return false
    state = prior
    return true
  }
  const move = (x: number, y: number) => {
    state.lineMatrix = translate(state.lineMatrix, x, y)
    state.textMatrix = [...state.lineMatrix]
    state.textAdvanceUnverified = false
    if (state.packedOrigin) {
      state.packedOrigin.lineOffset[0] += x
      state.packedOrigin.lineOffset[1] += y
      state.packedOrigin.textOffset = [...state.packedOrigin.lineOffset]
    }
  }
  for (let operationIndex = 0; operationIndex < operatorList.fnArray.length; operationIndex++) {
    if (++work > MAX_WORK) return fail('text-ink-budget-exceeded')
    const name = names.get(operatorList.fnArray[operationIndex] as number)
    if (!name) return fail('unknown-text-ink-operator')
    const rawArgs = operatorList.argsArray[operationIndex]
    const args = Array.isArray(rawArgs) ? rawArgs : []
    if (name === 'save') {
      if (stack.length >= 1000) return fail('text-ink-budget-exceeded')
      save()
    } else if (name === 'restore') {
      if (!restore()) return fail('invalid-text-ink-state-stack')
    } else if (name === 'transform') {
      const m = matrix(args)
      if (!m) return fail('invalid-text-ink-transform')
      state.ctm = multiply(state.ctm, m)
    } else if (name === 'beginText') {
      state.active = true
      state.textMatrix = [...IDENTITY]
      state.lineMatrix = [...IDENTITY]
      state.quantizedTextLinear = false
      delete state.packedOrigin
      state.textAdvanceUnverified = false
    } else if (name === 'endText') state.active = false
    else if (name === 'setFont') {
      if (typeof args[0] !== 'string' || typeof args[1] !== 'number' || !Number.isFinite(args[1]))
        return fail('invalid-text-ink-font-state')
      state.fontName = args[0]
      state.fontSize = args[1]
    } else if (name === 'setTextMatrix') {
      const m = matrix(args.length === 1 ? args[0] : args)
      if (!m) return fail('invalid-text-ink-transform')
      state.textMatrix = [...m]
      state.lineMatrix = [...m]
      state.quantizedTextLinear = args.length === 1 && args[0] instanceof Float32Array
      if (state.quantizedTextLinear)
        state.packedOrigin = {
          operationIndex,
          matrix: [...m],
          lineOffset: [0, 0],
          textOffset: [0, 0],
        }
      else delete state.packedOrigin
      state.textAdvanceUnverified = false
    } else if (name === 'moveText' || name === 'setLeadingMoveText') {
      if (args.length !== 2 || !args.every(Number.isFinite))
        return fail('invalid-text-ink-text-state')
      if (name === 'setLeadingMoveText') state.leading = -(args[1] as number)
      move(args[0] as number, args[1] as number)
    } else if (name === 'nextLine') move(0, -state.leading)
    else if (
      [
        'setCharSpacing',
        'setWordSpacing',
        'setHScale',
        'setLeading',
        'setTextRise',
        'setTextRenderingMode',
      ].includes(name ?? '')
    ) {
      if (args.length !== 1 || typeof args[0] !== 'number' || !Number.isFinite(args[0]))
        return fail('invalid-text-ink-text-state')
      const v = args[0]
      if (name === 'setCharSpacing') state.charSpacing = v
      if (name === 'setWordSpacing') state.wordSpacing = v
      if (name === 'setHScale') state.hScale = v / 100
      if (name === 'setLeading') state.leading = v
      if (name === 'setTextRise') state.rise = v
      if (name === 'setTextRenderingMode') {
        state.renderingMode = v
        if ((v & 4) !== 0) state.reason = 'unsupported-text-ink-clipping'
      }
    } else if (name === 'clip' || name === 'eoClip') pendingClip = true
    else if (name === 'constructPath' && pendingClip) {
      const paths = args[1]
      const clip =
        Array.isArray(paths) && paths.length === 1 ? clipQuad(paths[0], state.ctm) : undefined
      if (state.clips.length >= 32) return fail('text-ink-budget-exceeded')
      if (clip) state.clips.push(clip)
      else state.reason = 'unsupported-text-ink-clipping'
      pendingClip = false
    } else if (name === 'paintFormXObjectBegin' || name === 'beginGroup') {
      if (stack.length >= 1000) return fail('text-ink-budget-exceeded')
      save()
      state.reason = 'unsupported-text-ink-context'
      if (name === 'paintFormXObjectBegin' && args[0] !== null && args[0] !== undefined) {
        const m = matrix(args[0])
        if (!m) return fail('invalid-text-ink-transform')
        state.ctm = multiply(state.ctm, m)
      }
    } else if (name === 'paintFormXObjectEnd' || name === 'endGroup') {
      if (!restore()) return fail('invalid-text-ink-state-stack')
    } else if (name === 'setGState') {
      if (!Array.isArray(args[0])) return fail('invalid-text-ink-graphics-state')
      if (args[0].length > 100) return fail('text-ink-budget-exceeded')
      for (const pair of args[0]) {
        if (++work > MAX_WORK) return fail('text-ink-budget-exceeded')
        if (!Array.isArray(pair) || pair.length !== 2)
          return fail('invalid-text-ink-graphics-state')
        if (['LW', 'LC', 'LJ', 'ML', 'D', 'RI', 'FL', 'CA'].includes(pair[0])) continue
        if ((pair[0] === 'ca' && pair[1] === 1) || (pair[0] === 'BM' && pair[1] === 'source-over'))
          continue
        state.reason = 'unsupported-text-ink-graphics-state'
      }
    } else if (name === 'setFillTransparent') state.reason = 'transparent-native-text-ink'
    else if (name === 'setFillColorN') state.reason = 'unsupported-native-text-ink-pattern'
    else if (name === 'beginAnnotation' || name === 'endAnnotation')
      return fail('unsupported-text-ink-context')
    else if (name === 'beginMarkedContent' || name === 'beginMarkedContentProps') {
      if (markedStack.length >= 1000) return fail('text-ink-budget-exceeded')
      markedStack.push(markedReason)
      if (name === 'beginMarkedContentProps' && args[0] === 'OC') {
        let visible: boolean | undefined
        try {
          visible = input.isOptionalContentVisible?.(args[1])
        } catch {
          /* Visibility must be proved by the same rendering configuration. */
        }
        if (visible !== true)
          markedReason ??=
            visible === false
              ? 'hidden-native-text-ink-optional-content'
              : 'unverified-native-text-ink-optional-content'
      }
    } else if (name === 'endMarkedContent') {
      if (!markedStack.length) return fail('invalid-text-ink-state-stack')
      markedReason = markedStack.pop()
    } else if (name === 'showText') {
      const glyphs = args[0]
      if (!Array.isArray(glyphs) || glyphs.length > MAX_GLYPHS)
        return fail('text-ink-budget-exceeded')
      let font: PdfTextInkFont | undefined
      try {
        font = state.fontName ? input.getFont(state.fontName) : undefined
      } catch {
        /* Missing native objects remain held. */
      }
      const fontMatrix = font?.fontMatrix ? matrix(font.fontMatrix) : undefined
      let reason = state.reason ?? markedReason
      if (state.textAdvanceUnverified) reason ??= 'unverified-native-text-ink-advance'
      if (
        !state.active ||
        !state.fontName ||
        !font ||
        font.missingFile !== false ||
        font.isType3Font !== false ||
        font.vertical !== false ||
        font.disableFontFace !== true ||
        !fontMatrix ||
        fontMatrix.some((v, i) => v !== [0.001, 0, 0, 0.001, 0, 0][i])
      )
        reason ??= 'unsupported-native-text-ink-font'
      const advanceKnown =
        font?.isType3Font === false &&
        font.vertical === false &&
        fontMatrix?.every((v, i) => v === [0.001, 0, 0, 0.001, 0, 0][i]) === true &&
        state.fontSize > 0 &&
        state.hScale > 0
      if (state.fontSize <= 0 || state.hScale <= 0 || state.renderingMode !== 0 || pendingClip)
        reason ??= 'unsupported-native-text-ink-mode'
      const trm = multiply(
        state.ctm,
        multiply(state.textMatrix, [
          state.fontSize * state.hScale,
          0,
          0,
          state.fontSize,
          0,
          state.rise,
        ]),
      )
      const baselineScale = Math.hypot(trm[0], trm[1])
      const ux = trm[0] / baselineScale
      const uy = trm[1] / baselineScale
      const sourceFrame: Matrix = [ux, uy, -uy, ux, trm[4], trm[5]]
      const shear = trm[2] * ux + trm[3] * uy
      const height = -trm[2] * uy + trm[3] * ux
      const ink: InkBounds = { left: Infinity, bottom: Infinity, right: -Infinity, top: -Infinity }
      let advance = 0
      let lastSpacing = 0
      let str = ''
      const originalTextMatrix: Matrix = [...state.textMatrix]
      const originalPackedOrigin = state.packedOrigin
        ? structuredClone(state.packedOrigin)
        : undefined
      let literal = ''
      for (const glyph of glyphs) {
        if (typeof glyph === 'number') continue
        if (
          !glyph ||
          typeof glyph.unicode !== 'string' ||
          glyph.unicode.length > 200 ||
          typeof glyph.fontChar !== 'string' ||
          glyph.fontChar.length > 20
        )
          return fail('invalid-native-text-ink-glyph')
        work += glyph.unicode.length + glyph.fontChar.length
        if (work > MAX_WORK) return fail('text-ink-budget-exceeded')
        literal += glyph.unicode
      }
      const selected = selectsFragment(literal)
      for (const glyph of glyphs) {
        if (++work > MAX_WORK) return fail('text-ink-budget-exceeded')
        if (typeof glyph === 'number') {
          if (!Number.isFinite(glyph)) return fail('invalid-native-text-ink-glyph')
          advance -= glyph / 1000
          reason ??= 'unsupported-native-text-ink-adjustment'
          continue
        }
        if (
          !glyph ||
          typeof glyph !== 'object' ||
          typeof glyph.unicode !== 'string' ||
          typeof glyph.fontChar !== 'string' ||
          !Number.isFinite(glyph.width) ||
          glyph.width < 0
        )
          return fail('invalid-native-text-ink-glyph')
        str += glyph.unicode
        const spacing =
          state.fontSize > 0
            ? (state.charSpacing + (glyph.isSpace ? state.wordSpacing : 0)) / state.fontSize
            : 0
        // Some embedded PDFs encode a blank outside the font's mapped glyph set.
        // Only the original empty outline can prove that this contributes no ink;
        // its source advance still participates in the full caption identity.
        const missingWhitespace =
          glyph.isInFont === false &&
          glyph.isSpace === false &&
          !glyph.accent &&
          /^[ \u00a0\u202f]$/u.test(glyph.unicode)
        if ((!missingWhitespace && glyph.isInFont !== true) || glyph.accent)
          reason ??= 'unsupported-native-text-ink-glyph'
        if (glyph.isSpace && !/^[ \u00a0\u202f]+$/.test(glyph.unicode))
          reason ??= 'unsupported-native-text-ink-glyph'
        if (selected && !glyph.isSpace) {
          let rawPath: unknown
          try {
            rawPath = state.fontName
              ? input.getGlyphPath(state.fontName, glyph.fontChar)
              : undefined
          } catch {
            /* Do not substitute a system font. */
          }
          const path = values(rawPath, MAX_PATH_VALUES)
          const verifiedEmptyWhitespace = missingWhitespace && path?.length === 0
          if (missingWhitespace && !verifiedEmptyWhitespace)
            reason ??= 'unsupported-native-text-ink-glyph'
          if (path) work += path.length * 3
          if (work > MAX_WORK) return fail('text-ink-budget-exceeded')
          // Bound the actual outline in an orthonormal source-baseline frame.
          // Transforming an already-bounded local box would invent empty extrema under shear.
          const projectedPath = path
            ? transformedOutline(path, [
                baselineScale,
                0,
                shear,
                height,
                advance * baselineScale,
                0,
              ])
            : undefined
          const bounds = projectedPath ? pdfGlyphInkBounds(projectedPath) : undefined
          if (!bounds && !verifiedEmptyWhitespace) reason ??= 'native-glyph-ink-unavailable'
          else if (bounds) {
            ink.left = Math.min(ink.left, bounds.left)
            ink.right = Math.max(ink.right, bounds.right)
            ink.bottom = Math.min(ink.bottom, bounds.bottom)
            ink.top = Math.max(ink.top, bounds.top)
          }
        }
        advance += (glyph.width as number) / 1000 + spacing
        lastSpacing = spacing
      }
      state.textMatrix = translate(state.textMatrix, advance * state.fontSize * state.hScale, 0)
      if (state.packedOrigin)
        state.packedOrigin.textOffset[0] += advance * state.fontSize * state.hScale
      if (!advanceKnown) state.textAdvanceUnverified = true
      if (!selectsFragment(str)) continue
      if (str !== str.trim()) reason ??= 'unsupported-native-text-ink-text'
      if (
        !Number.isFinite(advance) ||
        advance <= 0 ||
        Math.abs(trm[0] * trm[3] - trm[1] * trm[2]) <= Number.EPSILON
      )
        reason ??= 'invalid-native-text-ink-transform'
      const quad = Number.isFinite(ink.left) ? rectangle(ink, sourceFrame) : undefined
      if (quad?.some((p) => ![p.x, p.y].every(Number.isFinite)))
        reason ??= 'invalid-native-text-ink-transform'
      if (quad && state.clips.some((clip) => quad.some((p) => !contains(clip, p))))
        reason ??= 'clipped-native-text-ink'
      if (runs.length >= MAX_ITEMS) return fail('text-ink-budget-exceeded')
      runs.push({
        operationIndex,
        text: str,
        fontName: state.fontName ?? '',
        transform: trm,
        advance: advance - lastSpacing,
        ctm: [...state.ctm],
        textMatrix: originalTextMatrix,
        fontSize: state.fontSize,
        hScale: state.hScale,
        quantizedTextLinear: state.quantizedTextLinear,
        endTransform: multiply(
          state.ctm,
          multiply(state.textMatrix, [
            state.fontSize * state.hScale,
            0,
            0,
            state.fontSize,
            0,
            state.rise,
          ]),
        ),
        sourceOperations: [operationIndex],
        cursorAdvance: advance,
        nonzeroSpacing: state.charSpacing !== 0 || state.wordSpacing !== 0,
        textRise: state.rise,
        shows: [
          {
            operationIndex,
            text: str,
            charSpacing: state.charSpacing,
            wordSpacing: state.wordSpacing,
            glyphWidths: glyphs
              .filter((glyph) => typeof glyph !== 'number')
              .map((glyph) => glyph.width as number),
            textMatrix: originalTextMatrix,
          },
        ],
        ...(originalPackedOrigin ? { packedOrigin: originalPackedOrigin } : {}),
        quad,
        reason,
      })
    } else if (
      [
        'showSpacedText',
        'nextLineShowText',
        'nextLineSetSpacingShowText',
        'setTextContent',
        'paintXObject',
      ].includes(name ?? '')
    )
      state.reason = 'unsupported-native-text-ink-operation'
  }
  if (stack.length || markedStack.length || pendingClip || state.active)
    return fail('invalid-text-ink-state-stack')
  // TextContent joins glyph shows on one source text line. Reconstruct only
  // literal consecutive shows, never neighbouring labels or different BTs.
  const candidates = runs.filter((run) => selectsLiteral(run.text))
  if (selectedIndexes !== undefined) {
    for (let start = 0; start < runs.length; start++) {
      if (work > MAX_WORK) return fail('text-ink-budget-exceeded')
      const first = runs[start] as Run
      if (!startsSelectedLiteral(first.text)) continue
      let group = structuredClone(first)
      for (let next = start + 1; next < runs.length; next++) {
        if (group.sourceOperations.length >= 50) break
        const run = runs[next] as Run
        if (++work > MAX_WORK) return fail('text-ink-budget-exceeded')
        const previous = runs[next - 1] as Run
        let continuation = true
        for (let index = previous.operationIndex + 1; index < run.operationIndex; index++) {
          if (++work > MAX_WORK) return fail('text-ink-budget-exceeded')
          if (names.get(operatorList.fnArray[index] as number) !== 'setCharSpacing') {
            continuation = false
            break
          }
        }
        if (
          !continuation ||
          run.fontName !== first.fontName ||
          run.fontSize !== first.fontSize ||
          run.hScale !== first.hScale ||
          run.ctm.some((value, index) => value !== first.ctm[index]) ||
          run.transform.some(
            (value, index) =>
              Math.abs(value - (previous.endTransform[index] as number)) > ARITHMETIC_EPSILON,
          ) ||
          first.reason ||
          run.reason ||
          !group.quad ||
          !run.quad
        )
          break
        const text = group.text + run.text
        if (text.length > 200 || !startsSelectedLiteral(text)) break
        const scale = Math.hypot(first.transform[0], first.transform[1])
        const ux = first.transform[0] / scale,
          uy = first.transform[1] / scale
        const corners = [...group.quad, ...run.quad].map((point) => ({
          x: (point.x - first.transform[4]) * ux + (point.y - first.transform[5]) * uy,
          y: -(point.x - first.transform[4]) * uy + (point.y - first.transform[5]) * ux,
        }))
        group = {
          ...group,
          text,
          advance: group.cursorAdvance + run.advance,
          cursorAdvance: group.cursorAdvance + run.cursorAdvance,
          endTransform: [...run.endTransform],
          nonzeroSpacing: group.nonzeroSpacing || run.nonzeroSpacing,
          sourceOperations: [...group.sourceOperations, run.operationIndex],
          shows: [...group.shows, ...run.shows],
          quad: rectangle(
            {
              left: Math.min(...corners.map((point) => point.x)),
              right: Math.max(...corners.map((point) => point.x)),
              bottom: Math.min(...corners.map((point) => point.y)),
              top: Math.max(...corners.map((point) => point.y)),
            },
            [ux, uy, -uy, ux, first.transform[4], first.transform[5]],
          ),
        }
        if (selectsLiteral(text)) {
          candidates.push(structuredClone(group))
          if (candidates.length > MAX_ITEMS) return fail('text-ink-budget-exceeded')
        }
      }
    }
  }
  const items: NativeNumericTextInk['items'] = []
  const unresolved: NativeNumericTextInk['unresolved'] = []
  const identities = text.map(({ index, item }) => {
    const matches = candidates.filter((run) => {
      if (++work > MAX_WORK) return false
      if (run.text !== item.str || run.fontName !== item.fontName) return false
      const [a, b, c, d] = run.ctm
      const determinant = a * d - b * c
      if (
        !Number.isFinite(determinant) ||
        determinant === 0 ||
        run.fontSize <= 0 ||
        run.hScale <= 0
      )
        return false
      // PDF.js packs setTextMatrix in Float32Array but TextContent retains source doubles.
      // Re-quantize only the recovered linear operands; do not widen page-coordinate matching.
      const linear = [
        (d * item.transform[0] - c * item.transform[1]) / determinant / (run.fontSize * run.hScale),
        (-b * item.transform[0] + a * item.transform[1]) /
          determinant /
          (run.fontSize * run.hScale),
        (d * item.transform[2] - c * item.transform[3]) / determinant / run.fontSize,
        (-b * item.transform[2] + a * item.transform[3]) / determinant / run.fontSize,
      ]
      const exactTransform = run.transform.every(
        (v, i) => Math.abs(v - (item.transform[i] as number)) <= ARITHMETIC_EPSILON,
      )
      const quantizedTransform =
        run.quantizedTextLinear &&
        Math.abs(run.transform[4] - item.transform[4]) <= ARITHMETIC_EPSILON &&
        Math.abs(run.transform[5] - item.transform[5]) <= ARITHMETIC_EPSILON &&
        linear.every((v, i) => Math.fround(v) === run.textMatrix[i])
      const origin = run.packedOrigin
      // Installed PDF.js packs Tm operands for render operations but keeps
      // source doubles in TextContent. Prove the original quantization cell
      // after undoing CTM and the explicit source text cursor, not tolerance.
      const recoveredTranslation: [number, number] = [
        (d * (item.transform[4] - run.ctm[4]) - c * (item.transform[5] - run.ctm[5])) /
          determinant -
          (linear[0] as number) * (origin?.textOffset[0] ?? 0) -
          (linear[2] as number) * (origin?.textOffset[1] ?? 0),
        (-b * (item.transform[4] - run.ctm[4]) + a * (item.transform[5] - run.ctm[5])) /
          determinant -
          (linear[1] as number) * (origin?.textOffset[0] ?? 0) -
          (linear[3] as number) * (origin?.textOffset[1] ?? 0),
      ]
      const quantizedGroup =
        run.sourceOperations.length > 1 &&
        run.textRise === 0 &&
        !!origin &&
        linear.every((value, index) => Math.fround(value) === origin.matrix[index]) &&
        recoveredTranslation.every(
          (value, index) => Math.fround(value) === origin.matrix[index + 4],
        )
      if (!exactTransform && !quantizedTransform && !quantizedGroup) return false
      // TextContent measures advances with text-line and CTM X scales separately.
      // This is not the physical baseline norm when a rotated run has an anisotropic CTM.
      const advanceScale =
        run.fontSize *
        run.hScale *
        Math.hypot(a, b) *
        Math.hypot(linear[0] as number, linear[1] as number)
      return Math.abs(run.advance * advanceScale - item.width) <= ARITHMETIC_EPSILON
    })
    return { index, item, matches }
  })
  if (work > MAX_WORK) return fail('text-ink-budget-exceeded')
  const claims = new Map<Run, number>()
  for (const { matches } of identities)
    for (const run of matches) claims.set(run, (claims.get(run) ?? 0) + 1)
  if (candidates.some((run) => !claims.has(run))) return fail('unmatched-native-numeric-text-show')
  const normalized = (p: PagePoint): PagePoint | undefined => {
    const [x, y] = viewport.convertToViewportPoint(p.x, p.y)
    if (
      typeof x !== 'number' ||
      typeof y !== 'number' ||
      ![x, y].every(Number.isFinite) ||
      x < 0 ||
      y < 0 ||
      x > viewport.width ||
      y > viewport.height
    )
      return
    return { x: (x / viewport.width) * 1000, y: (y / viewport.height) * 1000 }
  }
  for (const { index, item, matches } of identities) {
    const run = matches[0]
    if (!run || matches.length !== 1 || claims.get(run) !== 1) {
      unresolved.push({
        index,
        reason:
          matches.length === 0
            ? 'native-text-show-identity-unresolved'
            : 'ambiguous-native-text-show-identity',
      })
      continue
    }
    if (run.reason || !run.quad || (run.nonzeroSpacing && run.sourceOperations.length === 1)) {
      unresolved.push({
        index,
        reason:
          run.reason ??
          (run.nonzeroSpacing
            ? 'unsupported-native-text-ink-spacing'
            : 'native-glyph-ink-unavailable'),
      })
      continue
    }
    const quad = run.quad.map(normalized)
    const baselineStart = normalized(point(run.transform, 0, 0))
    const baselineEnd = normalized(point(run.transform, run.advance, 0))
    if (quad.some((p) => !p) || !baselineStart || !baselineEnd) {
      unresolved.push({ index, reason: 'native-text-ink-outside-page' })
      continue
    }
    items.push({
      index,
      text: item.str,
      fontName: item.fontName,
      operationIndex: run.operationIndex,
      quad: quad as Quad,
      baselineStart,
      baselineEnd,
      ...(run.sourceOperations.length > 1
        ? {
            sourceGroup: {
              operationIndexes: [...run.sourceOperations],
              shows: structuredClone(run.shows),
              ...(run.packedOrigin
                ? {
                    packedTextMatrixOperationIndex: run.packedOrigin.operationIndex,
                    packedTranslation: [run.packedOrigin.matrix[4], run.packedOrigin.matrix[5]] as [
                      number,
                      number,
                    ],
                    cursorOffset: [...run.packedOrigin.textOffset] as [number, number],
                    packedTextMatrix: [...run.packedOrigin.matrix] as Matrix,
                    sourceCtm: [...run.ctm] as Matrix,
                    textContentTransform: [...item.transform] as Matrix,
                    fontSize: run.fontSize,
                    horizontalScale: run.hScale,
                  }
                : {}),
            },
          }
        : {}),
    })
  }
  return { complete: unresolved.length === 0, refusalReason: null, items, unresolved }
}
