import {
  nativeResetNoteBounds,
  sourceResetHeightLiteral,
  sourceResetNoteLiteral,
} from './plan-native-height-group'
import { nativeDimensionCaptionMillimetres } from './plan-pdf-caption-binding'
import type { Bounds, PagePoint } from './plan-pdf-linework'

type Matrix = [number, number, number, number, number, number]
type Quad = [PagePoint, PagePoint, PagePoint, PagePoint]
type InkBounds = { left: number; bottom: number; right: number; top: number }
type SourceShow = {
  operationIndex: number
  text: string
  /** Original Unicode before the one supported TextContent NBSP normalization. */
  rawText?: string
  charSpacing: number
  wordSpacing: number
  glyphWidths: number[]
  textMatrix: Matrix
  adjustments?: { glyphIndex: number; value: number }[]
  packedOrigin?: { operationIndex: number; matrix: Matrix; cursorOffset: [number, number] }
  quad?: Quad
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
    sourceResetCaption?: {
      shows: SourceShow[]
      generatedSpacesBefore: number[]
      sourceCtm: Matrix
      textContentTransform: Matrix
      textContentWidth: number
      fontSize: number
      horizontalScale: number
    }
  }[]
  unresolved: { index: number; reason: string }[]
  /** All source text paints, independently of caption selection. Null bounds stay unknown. */
  paintBounds?: {
    complete: boolean
    entries: { operationIndex: number; bounds: Bounds | null; reason: string | null }[]
  }
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
  clips: PagePoint[][]
  reason?: string
  /** Non-clipping uncertainty must survive a later clip overwriting the legacy reason. */
  paintStateReason?: string
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
  resetCaption?: { generatedSpacesBefore: number[] }
  sourceOwner?: boolean
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

function segmentsIntersect(a: PagePoint, b: PagePoint, c: PagePoint, d: PagePoint): boolean {
  const cross = (u: PagePoint, v: PagePoint) => u.x * v.y - u.y * v.x
  const direction = { x: b.x - a.x, y: b.y - a.y }
  const other = { x: d.x - c.x, y: d.y - c.y }
  const offset = { x: c.x - a.x, y: c.y - a.y }
  const denominator = cross(direction, other)
  if (Math.abs(denominator) <= ARITHMETIC_EPSILON) {
    if (Math.abs(cross(offset, direction)) > ARITHMETIC_EPSILON) return false
    const axis = Math.abs(direction.x) >= Math.abs(direction.y) ? 'x' : 'y'
    return (
      Math.max(Math.min(a[axis], b[axis]), Math.min(c[axis], d[axis])) <=
      Math.min(Math.max(a[axis], b[axis]), Math.max(c[axis], d[axis])) + ARITHMETIC_EPSILON
    )
  }
  const first = cross(offset, other) / denominator
  const second = cross(offset, direction) / denominator
  return (
    first >= -ARITHMETIC_EPSILON &&
    first <= 1 + ARITHMETIC_EPSILON &&
    second >= -ARITHMETIC_EPSILON &&
    second <= 1 + ARITHMETIC_EPSILON
  )
}

function clipPolygon(raw: unknown, ctm: Matrix): PagePoint[] | undefined {
  const path = values(raw, 52)
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
  if (points.length > 1 && points[0]?.x === points.at(-1)?.x && points[0]?.y === points.at(-1)?.y)
    points.pop()
  if (points.length < 4 || points.length > 16) return
  if (new Set(points.map((p) => `${p.x}:${p.y}`)).size !== points.length) return
  for (let index = 0; index < points.length; index++) {
    const start = points[index] as PagePoint
    const end = points[(index + 1) % points.length] as PagePoint
    if ((start.x === end.x) === (start.y === end.y)) return
    for (let other = index + 2; other < points.length; other++) {
      if (index === 0 && other === points.length - 1) continue
      if (
        segmentsIntersect(
          start,
          end,
          points[other] as PagePoint,
          points[(other + 1) % points.length] as PagePoint,
        )
      )
        return
    }
  }
  const transformed = points.map((p) => point(ctm, p.x, p.y))
  return transformed.every((p) => Number.isFinite(p.x) && Number.isFinite(p.y))
    ? transformed
    : undefined
}

function contains(clip: PagePoint[], quad: Quad): boolean {
  for (const p of quad) {
    let inside = false
    for (let index = 0; index < clip.length; index++) {
      const a = clip[index] as PagePoint
      const b = clip[(index + 1) % clip.length] as PagePoint
      if (segmentsIntersect(a, b, p, p)) return false
      const crossesRay = a.y > p.y !== b.y > p.y
      if (crossesRay && p.x < a.x + ((p.y - a.y) * (b.x - a.x)) / (b.y - a.y)) inside = !inside
    }
    if (!inside) return false
  }
  for (let index = 0; index < quad.length; index++) {
    const a = quad[index] as PagePoint
    const b = quad[(index + 1) % quad.length] as PagePoint
    for (let other = 0; other < clip.length; other++) {
      if (
        segmentsIntersect(
          a,
          b,
          clip[other] as PagePoint,
          clip[(other + 1) % clip.length] as PagePoint,
        )
      )
        return false
    }
  }
  return true
}

/** A deliberately narrow replay of native text placement. Unsupported drawing state is held. */
export function nativeNumericTextInk(input: {
  operatorList: { fnArray: ArrayLike<number>; argsArray: ArrayLike<unknown> }
  operators: Readonly<Record<string, number>>
  textItems: readonly unknown[]
  // Overrides numeric selection. Every source occurrence of a selected literal
  // is replayed, so choosing one item cannot hide a competing text-show run.
  selectedTextIndexes?: readonly number[]
  collectPaintBounds?: boolean
  viewport: {
    width: number
    height: number
    convertToViewportPoint(x: number, y: number): number[]
  }
  getFont(fontName: string): PdfTextInkFont | undefined
  getGlyphPath(fontName: string, fontChar: string): unknown
  isOptionalContentVisible?(properties: unknown): boolean | undefined
}): NativeNumericTextInk {
  const paintEntries: NonNullable<NativeNumericTextInk['paintBounds']>['entries'] = []
  const fail = (refusalReason: string): NativeNumericTextInk => ({
    complete: false,
    refusalReason,
    items: [],
    unresolved: [],
    ...(input.collectPaintBounds ? { paintBounds: { complete: false, entries: [] } } : {}),
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
  // Numeric shows inside a date, height or room key still need a complete
  // source owner. They are replayed for identity, never returned as dimensions.
  const ownerLiterals = new Set<string>()
  if (selectedIndexes === undefined) {
    for (const raw of textItems) {
      if (raw && typeof raw === 'object' && 'str' in raw && typeof raw.str === 'string') {
        const literal = raw.str.trim()
        if (literal.length > 200 || !/\d/.test(literal)) continue
        if (selectsDimension(literal)) {
          if (/^\d{1,2} \d{3}$/u.test(literal)) selectedLiterals.add(literal)
        } else {
          ownerLiterals.add(literal)
        }
      }
    }
  }
  function selectsDimension(literal: string) {
    return nativeDimensionCaptionMillimetres(literal) !== undefined
  }
  const selectedLiteralList = [...selectedLiterals, ...ownerLiterals]
  const ownerLiteralList = [...ownerLiterals]
  // Explicit height selection needs the same CAD show replay as excluded
  // documentary owners. These literals stay selected, so their own source
  // groups are returned and cannot suppress a competing selected caption.
  const selectedHeightOwnerLiterals = [...selectedLiterals].filter((literal) =>
    sourceResetHeightLiteral.test(literal),
  )
  const documentaryOwnerLiterals = [...ownerLiteralList, ...selectedHeightOwnerLiterals]
  // A selected or excluded threshold suffix may span source text objects.
  // It is an owner only for reconstructing its own exact source literal; it
  // cannot claim or suppress other selected text occurrences.
  const splitSuffixLiterals = [...selectedLiterals, ...ownerLiterals].filter((literal) =>
    /^=\s*\d{1,4}\s*мм$/iu.test(literal),
  )
  // PDF.js can join one printed number split by a source moveText into a
  // single TextContent item. Reconstruct only that selected literal; the
  // matching identity below must still prove its source origin and width.
  const splitNumericLiterals =
    selectedIndexes === undefined
      ? [...selectedLiterals].filter((literal) => /\s/u.test(literal))
      : []
  const sourceOwnerLiteralList = [
    ...ownerLiteralList,
    ...selectedHeightOwnerLiterals,
    ...splitSuffixLiterals,
    ...splitNumericLiterals,
  ]
  const resetNoteLiterals = selectedLiteralList.filter((literal) =>
    sourceResetNoteLiteral.test(literal),
  )
  let work = 0
  const selectedIndexSet = new Set(selectedIndexes)
  const selectsLiteral = (literal: string) =>
    selectedIndexes === undefined
      ? nativeDimensionCaptionMillimetres(literal.trim()) !== undefined
      : selectedLiterals.has(literal)
  const selectsFragment = (literal: string) =>
    selectsLiteral(literal) ||
    (selectedLiteralList.length > 0 &&
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
    if (
      selectedIndexes === undefined
        ? !selectsLiteral(raw.str) && !ownerLiterals.has(raw.str.trim())
        : !selectedIndexSet.has(index)
    )
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
        Array.isArray(paths) && paths.length === 1 ? clipPolygon(paths[0], state.ctm) : undefined
      if (state.clips.length >= 32) return fail('text-ink-budget-exceeded')
      if (clip) state.clips.push(clip)
      else state.reason = 'unsupported-text-ink-clipping'
      pendingClip = false
    } else if (name === 'paintFormXObjectBegin' || name === 'beginGroup') {
      if (stack.length >= 1000) return fail('text-ink-budget-exceeded')
      save()
      state.reason = 'unsupported-text-ink-context'
      if (input.collectPaintBounds) state.paintStateReason ??= state.reason
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
        if (input.collectPaintBounds) state.paintStateReason ??= state.reason
      }
    } else if (name === 'setFillTransparent') {
      state.reason = 'transparent-native-text-ink'
      if (input.collectPaintBounds) state.paintStateReason ??= state.reason
    } else if (name === 'setFillColorN') {
      state.reason = 'unsupported-native-text-ink-pattern'
      if (input.collectPaintBounds) state.paintStateReason ??= state.reason
    } else if (name === 'beginAnnotation' || name === 'endAnnotation')
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
      const supportedFont =
        state.active &&
        !!state.fontName &&
        !!font &&
        font.missingFile === false &&
        font.isType3Font === false &&
        font.vertical === false &&
        font.disableFontFace === true &&
        !!fontMatrix &&
        fontMatrix.every((v, i) => v === [0.001, 0, 0, 0.001, 0, 0][i])
      if (!supportedFont) reason ??= 'unsupported-native-text-ink-font'
      const advanceKnown =
        font?.isType3Font === false &&
        font.vertical === false &&
        fontMatrix?.every((v, i) => v === [0.001, 0, 0, 0.001, 0, 0][i]) === true &&
        state.fontSize > 0 &&
        state.hScale > 0
      if (state.fontSize <= 0 || state.hScale <= 0 || state.renderingMode !== 0 || pendingClip)
        reason ??= 'unsupported-native-text-ink-mode'
      // Paint inventory does not inherit the legacy caption-only rejection of TJ
      // adjustments. It does inherit uncertain source state and glyph placement.
      let paintReason = state.paintStateReason ?? markedReason
      if (state.textAdvanceUnverified) paintReason ??= 'unverified-native-text-ink-advance'
      if (!supportedFont) paintReason ??= 'unsupported-native-text-ink-font'
      if (state.fontSize <= 0 || state.hScale <= 0 || state.renderingMode !== 0)
        paintReason ??= 'unsupported-native-text-ink-mode'
      // Any clipping mask only subtracts glyph ink. It cannot enlarge this
      // deliberately unclipped envelope, unlike alpha/pattern/font uncertainty.
      const paintBounds: Bounds = {
        left: Infinity,
        top: Infinity,
        right: -Infinity,
        bottom: -Infinity,
      }
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
      const numericLiteral = selectsDimension(literal.replace(/\u00a0/g, ' '))
      const normalizedLiteral = literal.replace(/\u00a0/g, ' ')
      const ownerFragment = sourceOwnerLiteralList.some((owner) => {
        work += owner.length + normalizedLiteral.length
        return (
          work <= MAX_WORK && literal === normalizedLiteral && owner.includes(normalizedLiteral)
        )
      })
      const selected = selectsFragment(literal) || numericLiteral || ownerFragment
      const noteFragment = resetNoteLiterals.some(
        (note) => literal.length > 0 && note.includes(literal),
      )
      const adjustments: { glyphIndex: number; value: number }[] = []
      let glyphIndex = 0
      for (const glyph of glyphs) {
        if (++work > MAX_WORK) return fail('text-ink-budget-exceeded')
        if (typeof glyph === 'number') {
          if (!Number.isFinite(glyph)) return fail('invalid-native-text-ink-glyph')
          advance -= glyph / 1000
          if (noteFragment || ownerFragment) adjustments.push({ glyphIndex, value: glyph })
          else reason ??= 'unsupported-native-text-ink-adjustment'
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
        // PDF.js TextContent normalizes NBSP to U+0020. No other Unicode
        // substitutions are accepted here, and the original advance is retained.
        str +=
          numericLiteral || ownerFragment ? glyph.unicode.replace(/\u00a0/g, ' ') : glyph.unicode
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
        if (input.collectPaintBounds) {
          if ((!missingWhitespace && glyph.isInFont !== true) || glyph.accent)
            paintReason ??= 'unsupported-native-text-ink-glyph'
          if (glyph.isSpace && !/^[ \u00a0\u202f]+$/.test(glyph.unicode))
            paintReason ??= 'unsupported-native-text-ink-glyph'
          let outline: number[] | undefined
          try {
            outline = state.fontName
              ? values(input.getGlyphPath(state.fontName, glyph.fontChar), MAX_PATH_VALUES)
              : undefined
          } catch {
            // Missing glyph ink is never replaced with FontBBox or a system font.
          }
          if (outline) work += outline.length * 3
          if (work > MAX_WORK) return fail('text-ink-budget-exceeded')
          const empty =
            /^[ \u00a0\u202f]+$/.test(glyph.unicode) &&
            (outline?.length === 0 || (outline?.length === 1 && outline[0] === 4))
          if (missingWhitespace && !empty) paintReason ??= 'unsupported-native-text-ink-glyph'
          if (!empty) {
            if (!outline || !pdfGlyphInkBounds(outline)) {
              paintReason ??= 'native-glyph-ink-unavailable'
            } else {
              // The complete control-point hull bounds the painted Bezier curves.
              // Work directly from outlines: FontBBox and glyph advance are not ink.
              const projected = transformedOutline(outline, translate(trm, advance, 0))
              if (!projected) paintReason ??= 'invalid-native-text-ink-transform'
              else {
                const sourceMagnitude = outline.reduce(
                  (max, value) => Math.max(max, Math.abs(value)),
                  0,
                )
                const transformMagnitude = trm.reduce((sum, value) => sum + Math.abs(value), 0)
                for (let index = 0; index < projected.length; ) {
                  const command = projected[index++]
                  const count = command === 4 ? 0 : command === 2 ? 6 : command === 3 ? 4 : 2
                  for (const end = index + count; index < end; index += 2) {
                    const px = projected[index] as number
                    const py = projected[index + 1] as number
                    const [x, y] = viewport.convertToViewportPoint(px, py)
                    if (x === undefined || y === undefined || ![x, y].every(Number.isFinite)) {
                      paintReason ??= 'invalid-native-text-ink-transform'
                      continue
                    }
                    const nx = (x / viewport.width) * 1000
                    const ny = (y / viewport.height) * 1000
                    // Outward arithmetic guard only; no page clipping or rounded
                    // diagnostic coordinates may shrink an exclusion envelope.
                    const guard =
                      64 *
                      Number.EPSILON *
                      (1 +
                        Math.abs(nx) +
                        Math.abs(ny) +
                        transformMagnitude * (1 + Math.abs(advance) + sourceMagnitude)) *
                      Math.max(1, 1000 / viewport.width, 1000 / viewport.height)
                    if (!Number.isFinite(guard)) {
                      paintReason ??= 'invalid-native-text-ink-transform'
                      continue
                    }
                    paintBounds.left = Math.min(paintBounds.left, nx - guard)
                    paintBounds.right = Math.max(paintBounds.right, nx + guard)
                    paintBounds.top = Math.min(paintBounds.top, ny - guard)
                    paintBounds.bottom = Math.max(paintBounds.bottom, ny + guard)
                  }
                }
              }
            }
          }
        }
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
          const verifiedEmptyWhitespace =
            (missingWhitespace && path?.length === 0) ||
            ((noteFragment ||
              ownerFragment ||
              (numericLiteral && glyph.unicode === '\u00a0' && glyph.isInFont === true)) &&
              /^[ \u00a0\u202f]$/u.test(glyph.unicode) &&
              (path?.length === 0 || (path?.length === 1 && path[0] === 4)))
          if (missingWhitespace && !verifiedEmptyWhitespace)
            reason ??= 'unsupported-native-text-ink-glyph'
          if (numericLiteral && glyph.unicode === '\u00a0' && !verifiedEmptyWhitespace)
            reason ??= 'unverified-native-numeric-space-normalization'
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
        glyphIndex++
      }
      state.textMatrix = translate(state.textMatrix, advance * state.fontSize * state.hScale, 0)
      if (state.packedOrigin)
        state.packedOrigin.textOffset[0] += advance * state.fontSize * state.hScale
      if (!advanceKnown) state.textAdvanceUnverified = true
      if (input.collectPaintBounds) {
        if (paintEntries.length >= MAX_ITEMS) return fail('text-ink-budget-exceeded')
        if (
          !Number.isFinite(advance) ||
          !trm.every(Number.isFinite) ||
          Math.abs(trm[0] * trm[3] - trm[1] * trm[2]) <= Number.EPSILON
        )
          paintReason ??= 'invalid-native-text-ink-transform'
        const empty = paintBounds.left === Infinity
        paintEntries.push({
          operationIndex,
          bounds: paintReason || empty ? null : paintBounds,
          reason: paintReason ?? (empty ? 'empty-source-text-paint' : null),
        })
      }
      if (!selectsFragment(str) && !numericLiteral) continue
      if (str !== str.trim() && !ownerFragment) reason ??= 'unsupported-native-text-ink-text'
      if (
        !Number.isFinite(advance) ||
        advance <= 0 ||
        Math.abs(trm[0] * trm[3] - trm[1] * trm[2]) <= Number.EPSILON
      )
        reason ??= 'invalid-native-text-ink-transform'
      const quad = Number.isFinite(ink.left) ? rectangle(ink, sourceFrame) : undefined
      if (quad?.some((p) => ![p.x, p.y].every(Number.isFinite)))
        reason ??= 'invalid-native-text-ink-transform'
      if (quad && state.clips.some((clip) => !contains(clip, quad)))
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
            ...(str !== literal ? { rawText: literal } : {}),
            charSpacing: state.charSpacing,
            wordSpacing: state.wordSpacing,
            glyphWidths: glyphs
              .filter((glyph) => typeof glyph !== 'number')
              .map((glyph) => glyph.width as number),
            textMatrix: originalTextMatrix,
            ...(noteFragment || ownerFragment
              ? {
                  adjustments,
                  quad,
                  ...(originalPackedOrigin
                    ? {
                        packedOrigin: {
                          operationIndex: originalPackedOrigin.operationIndex,
                          matrix: [...originalPackedOrigin.matrix] as Matrix,
                          cursorOffset: [...originalPackedOrigin.textOffset] as [number, number],
                        },
                      }
                    : {}),
                }
              : {}),
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
    ) {
      if (input.collectPaintBounds && name !== 'setTextContent' && name !== 'paintXObject') {
        if (paintEntries.length >= MAX_ITEMS) return fail('text-ink-budget-exceeded')
        paintEntries.push({
          operationIndex,
          bounds: null,
          reason: 'unsupported-native-text-ink-operation',
        })
      }
      state.reason = 'unsupported-native-text-ink-operation'
      if (input.collectPaintBounds) state.paintStateReason ??= state.reason
      if (input.collectPaintBounds) state.textAdvanceUnverified = true
    }
  }
  if (stack.length || markedStack.length || pendingClip || state.active)
    return fail('invalid-text-ink-state-stack')
  // TextContent joins glyph shows on one source text line. Reconstruct only
  // literal consecutive shows, never neighbouring labels or different BTs.
  const candidates = runs.filter((run) => selectsLiteral(run.text) || ownerLiterals.has(run.text))
  if (selectedLiteralList.length > 0) {
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
        const sourceOwner = sourceOwnerLiteralList.some((owner) => {
          work += owner.length + group.text.length
          return work <= MAX_WORK && owner.startsWith(group.text)
        })
        // CAD exports can split one documentary caption between text objects
        // with repeated graphics setup. These excluded owners never become
        // dimensions: every show still needs the same font/frame, visible ink
        // and an exact TextContent origin/advance before owning a number.
        const documentaryOwner = documentaryOwnerLiterals.some((literal) => {
          work += literal.length + group.text.length
          return (
            work <= MAX_WORK &&
            /^(?:S:\s*\d+(?:[,.]\d+)?\s*м|[НH]\s*=\s*\d+\s*мм\/[^\d]*)$/u.test(literal) &&
            literal.startsWith(group.text)
          )
        })
        const splitSuffixOwner = splitSuffixLiterals.some((literal) =>
          literal.startsWith(group.text),
        )
        const splitNumericOwner = sourceOwnerLiteralList.some(
          (literal) =>
            (/^(?:H\s*)?=\s*\d[\d ]*(?:\s*\(0,000\))?$/u.test(literal) ||
              /^\(-?0,\d{3}\)$/u.test(literal)) &&
            literal.startsWith(group.text),
        )
        const contiguous = run.transform.every(
          (value, index) =>
            Math.abs(value - (previous.endTransform[index] as number)) <= ARITHMETIC_EPSILON,
        )
        const resetNote =
          (sourceOwner && (!contiguous || !!group.resetCaption)) ||
          resetNoteLiterals.some((note) => note.startsWith(group.text))
        const reflectedOwner =
          sourceOwner &&
          first.ctm[3] < 0 &&
          first.textMatrix[0] === 1 &&
          first.textMatrix[1] === 0 &&
          first.textMatrix[2] === 0 &&
          first.textMatrix[3] === -1 &&
          run.textMatrix[0] === 1 &&
          run.textMatrix[1] === 0 &&
          run.textMatrix[2] === 0 &&
          run.textMatrix[3] === -1
        const rotatedOwner =
          sourceOwner &&
          first.ctm[1] === 0 &&
          first.ctm[2] === 0 &&
          first.ctm[0] > 0 &&
          first.ctm[3] < 0 &&
          first.textMatrix.slice(0, 4).every((value, index) => value === run.textMatrix[index]) &&
          Math.abs(first.textMatrix[0]) <= ARITHMETIC_EPSILON &&
          Math.abs(first.textMatrix[3]) <= ARITHMETIC_EPSILON &&
          first.textMatrix[1] === -1 &&
          first.textMatrix[2] === -1
        let continuation = true
        for (let index = previous.operationIndex + 1; index < run.operationIndex; index++) {
          if (++work > MAX_WORK) return fail('text-ink-budget-exceeded')
          const name = names.get(operatorList.fnArray[index] as number)
          const interveningArgs = operatorList.argsArray[index]
          if (
            name !== 'setCharSpacing' &&
            !(
              documentaryOwner &&
              [
                'save',
                'restore',
                'transform',
                'eoClip',
                'clip',
                'setFont',
                'setFillRGBColor',
              ].includes(name ?? '')
            ) &&
            !(
              documentaryOwner &&
              name === 'constructPath' &&
              Array.isArray(interveningArgs) &&
              interveningArgs[0] === operators.endPath
            ) &&
            !(
              (resetNote || sourceOwner) &&
              (name === 'setTextMatrix' ||
                (sourceOwner && name === 'moveText') ||
                ((splitSuffixOwner || splitNumericOwner || documentaryOwner) &&
                  (name === 'endText' || name === 'beginText')))
            )
          ) {
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
          (!resetNote &&
            run.transform.some(
              (value, index) =>
                Math.abs(value - (previous.endTransform[index] as number)) > ARITHMETIC_EPSILON,
            )) ||
          first.reason ||
          run.reason ||
          !group.quad ||
          (!run.quad && !(sourceOwner && /^ +$/.test(run.text)))
        )
          break
        let separator = ''
        if (resetNote) {
          if (
            ((!first.packedOrigin || !run.packedOrigin) && !sourceOwner) ||
            first.hScale !== 1 ||
            first.textRise !== 0 ||
            run.textRise !== 0 ||
            first.ctm[1] !== 0 ||
            first.ctm[2] !== 0 ||
            first.ctm[0] <= 0 ||
            (splitSuffixOwner
              ? first.ctm[3] === 0
              : first.ctm[3] <= 0 && !reflectedOwner && !rotatedOwner) ||
            first.textMatrix
              .slice(0, 4)
              .some(
                (value, index) =>
                  value !==
                  (splitSuffixOwner || reflectedOwner || rotatedOwner
                    ? run.textMatrix[index]
                    : IDENTITY[index]),
              ) ||
            (!splitSuffixOwner &&
              !reflectedOwner &&
              !rotatedOwner &&
              run.textMatrix.slice(0, 4).some((value, index) => value !== IDENTITY[index]))
          )
            break
          const baselineScale = Math.hypot(first.transform[0], first.transform[1])
          const baselineX = first.transform[0] / baselineScale
          const baselineY = first.transform[1] / baselineScale
          const deltaX = run.transform[4] - previous.transform[4]
          const deltaY = run.transform[5] - previous.transform[5]
          const gap =
            (deltaX * baselineX + deltaY * baselineY) / Math.hypot(first.ctm[0], first.ctm[1]) -
            previous.advance * first.fontSize
          if (
            gap < -0.2 * first.fontSize ||
            Math.abs(
              (run.transform[4] - first.transform[4]) * -baselineY +
                (run.transform[5] - first.transform[5]) * baselineX,
            ) /
              Math.abs(first.ctm[3]) >
              0.25 * first.fontSize
          )
            break
          if (gap >= 0.102 * first.fontSize && gap <= 0.6 * first.fontSize)
            separator =
              sourceOwner && (group.text.endsWith(' ') || run.text.startsWith(' ')) ? '' : ' '
          else if (gap > 0.102 * first.fontSize) break
        }
        const text = group.text + separator + run.text
        if (text.length > 200 || !startsSelectedLiteral(text)) break
        const scale = Math.hypot(first.transform[0], first.transform[1])
        const ux = first.transform[0] / scale,
          uy = first.transform[1] / scale
        const corners = [...group.quad, ...(run.quad ?? [])].map((point) => ({
          x: (point.x - first.transform[4]) * ux + (point.y - first.transform[5]) * uy,
          y: -(point.x - first.transform[4]) * uy + (point.y - first.transform[5]) * ux,
        }))
        group = {
          ...group,
          text,
          advance: resetNote
            ? ((run.transform[4] - first.transform[4]) * ux +
                (run.transform[5] - first.transform[5]) * uy) /
                scale +
              run.advance
            : group.cursorAdvance + run.advance,
          cursorAdvance: resetNote
            ? ((run.transform[4] - first.transform[4]) * ux +
                (run.transform[5] - first.transform[5]) * uy) /
                scale +
              run.cursorAdvance
            : group.cursorAdvance + run.cursorAdvance,
          endTransform: [...run.endTransform],
          nonzeroSpacing: group.nonzeroSpacing || run.nonzeroSpacing,
          sourceOperations: [...group.sourceOperations, run.operationIndex],
          shows: [...group.shows, ...run.shows],
          ...(resetNote
            ? {
                sourceOwner,
                resetCaption: {
                  generatedSpacesBefore: [
                    ...(group.resetCaption?.generatedSpacesBefore ?? []),
                    ...(separator ? [group.shows.length] : []),
                  ],
                },
              }
            : {}),
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
        if (selectsLiteral(text) || ownerLiterals.has(text)) {
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
      if (run.resetCaption) {
        if (run.sourceOwner && exactTransform && !run.packedOrigin)
          return Math.abs(run.advance * advanceScale - item.width) <= ARITHMETIC_EPSILON
        const last = run.shows.at(-1)
        const packed = last?.packedOrigin
        if (
          !last ||
          !packed ||
          !quantizedGroup ||
          b !== 0 ||
          c !== 0 ||
          a <= 0 ||
          (splitSuffixLiterals.includes(run.text)
            ? d === 0
            : d <= 0 &&
              !(
                run.sourceOwner &&
                d < 0 &&
                (run.textMatrix[3] === -1 ||
                  (Math.abs(run.textMatrix[0]) <= ARITHMETIC_EPSILON &&
                    run.textMatrix[1] === -1 &&
                    run.textMatrix[2] === -1 &&
                    Math.abs(run.textMatrix[3]) <= ARITHMETIC_EPSILON))
              )) ||
          run.hScale !== 1 ||
          item.width <= 0
        )
          return false
        let lastAdvance = 0
        for (let index = 0; index < last.glyphWidths.length; index++) {
          for (const adjustment of last.adjustments?.filter((row) => row.glyphIndex === index) ??
            [])
            lastAdvance -= (adjustment.value / 1000) * run.fontSize
          lastAdvance +=
            ((last.glyphWidths[index] as number) / 1000) * run.fontSize + last.charSpacing
        }
        lastAdvance -= last.charSpacing
        if (d > 0 && run.textMatrix[0] === 1 && run.textMatrix[3] === 1) {
          const recoveredLastOrigin =
            (item.transform[4] + item.width - lastAdvance * a - run.ctm[4]) / a -
            packed.cursorOffset[0]
          return Math.fround(recoveredLastOrigin) === packed.matrix[4]
        }
        const baselineLength = Math.hypot(item.transform[0], item.transform[1])
        const lastPageX =
          item.transform[4] +
          (item.width * item.transform[0]) / baselineLength -
          lastAdvance * (a * (linear[0] as number) + c * (linear[1] as number))
        const lastPageY =
          item.transform[5] +
          (item.width * item.transform[1]) / baselineLength -
          lastAdvance * (b * (linear[0] as number) + d * (linear[1] as number))
        const lastSourceX =
          (d * (lastPageX - run.ctm[4]) - c * (lastPageY - run.ctm[5])) / determinant -
          (linear[0] as number) * packed.cursorOffset[0] -
          (linear[2] as number) * packed.cursorOffset[1]
        const lastSourceY =
          (-b * (lastPageX - run.ctm[4]) + a * (lastPageY - run.ctm[5])) / determinant -
          (linear[1] as number) * packed.cursorOffset[0] -
          (linear[3] as number) * packed.cursorOffset[1]
        return (
          Math.fround(lastSourceX) === packed.matrix[4] &&
          Math.fround(lastSourceY) === packed.matrix[5]
        )
      }
      return Math.abs(run.advance * advanceScale - item.width) <= ARITHMETIC_EPSILON
    })
    return { index, item, matches }
  })
  if (work > MAX_WORK) return fail('text-ink-budget-exceeded')
  const claims = new Map<Run, number>()
  for (const { matches } of identities)
    for (const run of matches) claims.set(run, (claims.get(run) ?? 0) + 1)
  const uniqueOwners = identities
    .filter(
      ({ item, matches }) =>
        ownerLiterals.has(item.str) &&
        matches.length === 1 &&
        claims.get(matches[0] as Run) === 1 &&
        !matches[0]?.reason,
    )
    .map(({ matches }) => matches[0] as Run)
  const ownershipCounts = new Map<Run, number>()
  for (const run of candidates) {
    let count = 0
    for (const owner of uniqueOwners) {
      let contains = true
      for (const operation of run.sourceOperations) {
        work += owner.sourceOperations.length
        if (work > MAX_WORK) return fail('text-ink-budget-exceeded')
        if (!owner.sourceOperations.includes(operation)) {
          contains = false
          break
        }
      }
      if (contains) count++
    }
    ownershipCounts.set(run, count)
  }
  // A joined numeric TextContent item can own its exact source shows. The
  // individual numeric shows are not extra labels, but another TextContent
  // claim on either show would make the ownership ambiguous.
  const compositeOwners = identities.flatMap(({ item, matches }) => {
    const owner = matches[0]
    return selectsLiteral(item.str) &&
      matches.length === 1 &&
      owner &&
      claims.get(owner) === 1 &&
      !owner.reason &&
      owner.sourceOperations.length > 1
      ? [owner]
      : []
  })
  const compositeCoverage = new Map<Run, number>()
  for (const run of candidates) {
    let count = 0
    for (const owner of compositeOwners) {
      if (run === owner || run.sourceOperations.length >= owner.sourceOperations.length) continue
      for (
        let offset = 0;
        offset <= owner.sourceOperations.length - run.sourceOperations.length;
        offset++
      ) {
        work += run.sourceOperations.length
        if (work > MAX_WORK) return fail('text-ink-budget-exceeded')
        if (
          run.sourceOperations.every(
            (operation, index) => operation === owner.sourceOperations[offset + index],
          )
        ) {
          count++
          break
        }
      }
    }
    compositeCoverage.set(run, count)
  }
  if (
    candidates.some(
      (run) =>
        (compositeCoverage.get(run) ?? 0) > 1 ||
        (claims.has(run) && (compositeCoverage.get(run) ?? 0) > 0),
    )
  )
    return fail('competing-native-text-show-ownership')
  if (
    identities.some(
      ({ item, matches }) =>
        selectsLiteral(item.str) && matches.some((run) => (ownershipCounts.get(run) ?? 0) > 0),
    )
  )
    return fail('competing-native-text-show-ownership')
  if (
    candidates.some(
      (run) =>
        !claims.has(run) && ownershipCounts.get(run) !== 1 && compositeCoverage.get(run) !== 1,
    )
  ) {
    return fail('unmatched-native-numeric-text-show')
  }
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
    if (selectedIndexes === undefined && !selectsLiteral(item.str)) continue
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
    const unspacedSelectedFragment =
      selectedIndexes !== undefined &&
      run.nonzeroSpacing &&
      run.sourceOperations.length === 1 &&
      run.shows.length === 1 &&
      run.shows[0]?.wordSpacing === 0 &&
      !/[\s\u00a0\u202f]/u.test(item.str) &&
      !run.shows[0]?.adjustments?.length
    if (
      run.reason ||
      !run.quad ||
      (run.sourceOperations.length === 1 &&
        run.nonzeroSpacing &&
        !selectsDimension(item.str) &&
        !unspacedSelectedFragment) ||
      (run.shows.some((show) => show.wordSpacing !== 0) && !unspacedSelectedFragment)
    ) {
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
    const candidate: NativeNumericTextInk['items'][number] = {
      index,
      text: item.str,
      fontName: item.fontName,
      operationIndex: run.operationIndex,
      quad: quad as Quad,
      baselineStart,
      baselineEnd,
      ...(run.resetCaption &&
      (sourceResetNoteLiteral.test(item.str) || selectedHeightOwnerLiterals.includes(item.str))
        ? {
            sourceResetCaption: {
              shows: structuredClone(run.shows),
              generatedSpacesBefore: [...run.resetCaption.generatedSpacesBefore],
              sourceCtm: [...run.ctm] as Matrix,
              textContentTransform: [...item.transform] as Matrix,
              textContentWidth: item.width,
              fontSize: run.fontSize,
              horizontalScale: run.hScale,
            },
          }
        : {}),
      ...((run.sourceOperations.length > 1 ||
        unspacedSelectedFragment ||
        (selectsDimension(item.str) && (run.nonzeroSpacing || run.packedOrigin))) &&
      (!run.resetCaption ||
        !(sourceResetNoteLiteral.test(item.str) || selectedHeightOwnerLiterals.includes(item.str)))
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
    }
    if (candidate.sourceResetCaption) {
      const originalOrigin = normalized(point(item.transform, 0, 0))
      if (
        !originalOrigin ||
        !nativeResetNoteBounds(
          candidate,
          { name: item.str, pagePoint: originalOrigin, rotation: 0 },
          { pageWidth: viewport.width, pageHeight: viewport.height },
        )
      ) {
        unresolved.push({ index, reason: 'unverified-source-reset-note' })
        continue
      }
    }
    items.push(candidate)
  }
  return {
    complete: unresolved.length === 0,
    refusalReason: null,
    items,
    unresolved,
    ...(input.collectPaintBounds ? { paintBounds: { complete: true, entries: paintEntries } } : {}),
  }
}
