type Operators = Readonly<Record<string, number>>
type State = {
  fillTransparent: boolean
  strokeTransparent: boolean
  fillPattern: boolean
  strokePattern: boolean
  fillAlpha: number
  strokeAlpha: number
  blendMode: string
  mask: boolean
  transfer: boolean
  textRenderingMode: number
  reason?: string
}
type Scope = 'save' | 'form' | 'group' | 'annotation'

const MAX_OPERATIONS = 100_000
const MAX_DEPTH = 1000
const MAX_STATE_PAIRS = 100
const MAX_WORK = 200_000
const fillPaint = new Set([
  'fill',
  'eoFill',
  'fillStroke',
  'eoFillStroke',
  'closeFillStroke',
  'closeEOFillStroke',
  'shadingFill',
])
const strokePaint = new Set([
  'stroke',
  'closeStroke',
  'fillStroke',
  'eoFillStroke',
  'closeFillStroke',
  'closeEOFillStroke',
])
const knownStateKeys = new Set(['LW', 'LC', 'LJ', 'ML', 'D', 'RI', 'FL', 'Font'])
const fillColors = new Set(['setFillColor', 'setFillGray', 'setFillRGBColor', 'setFillCMYKColor'])
const strokeColors = new Set([
  'setStrokeColor',
  'setStrokeGray',
  'setStrokeRGBColor',
  'setStrokeCMYKColor',
])

/**
 * Whole-source strict visibility gate, not a renderer or a source-line filter.
 * Hidden or composited vector paint is retained as a refusal, never erased.
 * Images and text-only scopes do not by themselves count as vector evidence.
 * Explicit path clips remain the responsibility of extractPdfLinework and its
 * source-completeness guard; this supplements them with paint-state evidence.
 */
export function pdfNativePaintVisibilityIssue(input: {
  operatorList: { fnArray: readonly number[]; argsArray: readonly unknown[] }
  operators: Operators
  isOptionalContentVisible?(properties: unknown): boolean | undefined
}): string | undefined {
  const { operatorList, operators } = input
  if (
    !Array.isArray(operatorList.fnArray) ||
    !Array.isArray(operatorList.argsArray) ||
    operatorList.fnArray.length !== operatorList.argsArray.length
  )
    return 'invalid-native-vector-operator-list'
  if (operatorList.fnArray.length > MAX_OPERATIONS)
    return 'native-vector-visibility-budget-exceeded'
  const names = new Map(Object.entries(operators).map(([name, value]) => [value, name]))
  if (
    names.size !== Object.keys(operators).length ||
    names.size > 500 ||
    [...names.keys()].some((value) => !Number.isSafeInteger(value) || value < 0)
  )
    return 'invalid-native-vector-operators'
  let state: State = {
    fillTransparent: false,
    strokeTransparent: false,
    fillPattern: false,
    strokePattern: false,
    fillAlpha: 1,
    strokeAlpha: 1,
    blendMode: 'source-over',
    mask: false,
    transfer: false,
    textRenderingMode: 0,
  }
  const states: { scope: Scope; state: State }[] = []
  const marked: (string | undefined)[] = []
  let markedReason: string | undefined
  let malformed: string | undefined
  let sawPaint = false
  let work = 0
  const enter = (scope: Scope) => {
    if (states.length >= MAX_DEPTH) return false
    states.push({ scope, state: { ...state } })
    if (scope !== 'save') state.reason ??= 'unsupported-native-vector-paint-context'
    return true
  }
  const leave = (scope: Scope) => {
    const previous = states.pop()
    if (!previous || previous.scope !== scope) {
      malformed ??= 'invalid-native-vector-state-stack'
      state.reason ??= malformed
      return
    }
    state = previous.state
  }
  const paintIssue = (name: string): string | undefined => {
    sawPaint = true
    if (malformed) return malformed
    if (markedReason) return markedReason
    if (state.reason) return state.reason
    if (state.blendMode !== 'source-over' || state.mask || state.transfer)
      return 'unsupported-native-vector-paint-composite'
    const fill = fillPaint.has(name)
    const stroke = strokePaint.has(name)
    if (name === 'shadingFill' || (fill && state.fillPattern) || (stroke && state.strokePattern))
      return 'unverified-native-vector-pattern-paint'
    if ((fill && state.fillTransparent) || (stroke && state.strokeTransparent))
      return 'transparent-native-vector-paint'
    if ((fill && state.fillAlpha !== 1) || (stroke && state.strokeAlpha !== 1))
      return 'unverified-native-vector-paint-alpha'
    return undefined
  }
  for (let index = 0; index < operatorList.fnArray.length; index++) {
    work += 1
    if (work > MAX_WORK) return 'native-vector-visibility-budget-exceeded'
    const name = names.get(operatorList.fnArray[index] as number)
    if (!name) return 'unknown-native-vector-operator'
    const rawArgs = operatorList.argsArray[index]
    const args = Array.isArray(rawArgs) ? rawArgs : []
    if (name === 'save') {
      if (!enter('save')) return 'native-vector-visibility-budget-exceeded'
    } else if (name === 'restore') leave('save')
    else if (
      name === 'paintFormXObjectBegin' ||
      name === 'beginGroup' ||
      name === 'beginAnnotation'
    ) {
      const scope =
        name === 'paintFormXObjectBegin' ? 'form' : name === 'beginGroup' ? 'group' : 'annotation'
      if (!enter(scope)) return 'native-vector-visibility-budget-exceeded'
    } else if (name === 'paintFormXObjectEnd') leave('form')
    else if (name === 'endGroup') leave('group')
    else if (name === 'endAnnotation') leave('annotation')
    else if (name === 'beginMarkedContent' || name === 'beginMarkedContentProps') {
      if (marked.length >= MAX_DEPTH) return 'native-vector-visibility-budget-exceeded'
      marked.push(markedReason)
      if (name === 'beginMarkedContentProps' && args[0] === 'OC') {
        let visible: boolean | undefined
        try {
          visible = input.isOptionalContentVisible?.(args[1])
        } catch {
          // Use the renderer's answer only; a failed callback cannot prove visible paint.
        }
        if (visible !== true)
          markedReason ??=
            visible === false
              ? 'hidden-native-vector-optional-content'
              : 'unverified-native-vector-optional-content'
      }
    } else if (name === 'endMarkedContent') {
      if (!marked.length) malformed ??= 'invalid-native-vector-state-stack'
      else markedReason = marked.pop()
    } else if (name === 'setFillTransparent') state.fillTransparent = true
    else if (name === 'setStrokeTransparent') state.strokeTransparent = true
    else if (name === 'setFillColorN') state.fillPattern = true
    else if (name === 'setStrokeColorN') state.strokePattern = true
    else if (fillColors.has(name)) {
      state.fillTransparent = false
      state.fillPattern = false
    } else if (strokeColors.has(name)) {
      state.strokeTransparent = false
      state.strokePattern = false
    } else if (name === 'setGState') {
      if (!Array.isArray(args[0])) {
        state.reason ??= 'invalid-native-vector-graphics-state'
        continue
      }
      if (args[0].length > MAX_STATE_PAIRS) return 'native-vector-visibility-budget-exceeded'
      for (const pair of args[0]) {
        work += 1
        if (work > MAX_WORK) return 'native-vector-visibility-budget-exceeded'
        if (!Array.isArray(pair) || pair.length !== 2 || typeof pair[0] !== 'string') {
          state.reason ??= 'invalid-native-vector-graphics-state'
          continue
        }
        const [key, value] = pair
        if (knownStateKeys.has(key)) continue
        if (key === 'ca' || key === 'CA') {
          if (typeof value !== 'number' || !Number.isFinite(value) || value < 0 || value > 1)
            state.reason ??= 'invalid-native-vector-graphics-state'
          else if (key === 'ca') state.fillAlpha = value
          else state.strokeAlpha = value
        } else if (key === 'BM') {
          if (typeof value !== 'string') state.reason ??= 'invalid-native-vector-graphics-state'
          else state.blendMode = value
        } else if (key === 'SMask') state.mask = value !== false && value !== null
        else if (key === 'TR') state.transfer = value !== null
        else state.reason ??= 'unsupported-native-vector-graphics-state'
      }
    } else if (name === 'setTextRenderingMode') {
      if (!Number.isSafeInteger(args[0]) || (args[0] as number) < 0 || (args[0] as number) > 7)
        state.reason ??= 'invalid-native-vector-text-clip'
      else state.textRenderingMode = args[0] as number
    } else if (
      ['showText', 'showSpacedText', 'nextLineShowText', 'nextLineSetSpacingShowText'].includes(
        name,
      )
    ) {
      // Text-path clipping persists after endText and a later rendering-mode reset.
      // Its glyph-shaped coverage is outside this narrow vector visibility proof.
      if (state.textRenderingMode >= 4) state.reason ??= 'unsupported-native-vector-text-clip'
    } else if (name === 'constructPath') {
      // PDF.js 6 packs the paint code into constructPath; older lists paint later.
      if (Array.isArray(args[0])) continue
      const paint = names.get(args[0] as number)
      if (paint === 'endPath') continue
      if (!paint || (!fillPaint.has(paint) && !strokePaint.has(paint)))
        return 'unknown-native-vector-paint'
      const issue = paintIssue(paint)
      if (issue) return issue
    } else if (fillPaint.has(name) || strokePaint.has(name)) {
      const issue = paintIssue(name)
      if (issue) return issue
    }
  }
  if (sawPaint && (states.length || marked.length || malformed))
    return malformed ?? 'invalid-native-vector-state-stack'
  return undefined
}
