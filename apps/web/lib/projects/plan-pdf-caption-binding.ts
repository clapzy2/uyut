import type { PagePoint, PdfLinework } from './plan-pdf-linework'
import type { PdfPlanSource } from './plan-pdf-room-binding'

export type NativeDimensionCaptionContext = {
  source: { sha256: string; pdfPage: number; pageWidth: number; pageHeight: number }
  /** Complete numeric native runs, not a semantic interpretation of the drawing. */
  complete: boolean
  items: Array<{
    index: number
    text: string
    rotation: number
    origin: PagePoint
    baselineStart: PagePoint
    baselineEnd: PagePoint
    /** Optional actual embedded glyph-run ink, not the font-wide box or estimated text width. */
    inkPolygon?: PagePoint[]
    inkSourceOperation?: number
    /** Every original text-show operation that painted this numeric run. */
    inkSourceOperations?: number[]
    inkRefusal?: string
  }>
}

export type NativeCaptionRail = {
  start: PagePoint
  end: PagePoint
  operationIndex: number
  subpathIndex: number
  branched: boolean
  /** Native endpoints of unique stroke ticks, projected outside each end of the rail. */
  outboard?: { start: PagePoint; end: PagePoint }
}
type CaptionLabel = PagePoint & { index: number; text: string; rotation: number }
export type NativeCaptionMatch =
  | { status: 'candidate'; span: NativeCaptionRail; basis: 'centered-caption' | 'outboard-caption' }
  | { status: 'unresolved' | 'ambiguous'; reason: string }

export function nativeDimensionCaptionMillimetres(text: string): number | undefined {
  if (!/^(?:\d{1,3}(?:[ \u00a0\u202f]\d{3})+|\d{1,5})$/.test(text)) return
  const value = Number(text.replace(/[ \u00a0\u202f]/g, ''))
  return Number.isSafeInteger(value) && value > 0 && value <= 99_999 ? value : undefined
}

/** Shape/identity invariants of source glyph envelopes, not font authenticity. */
export function nativeCaptionInkIssue(
  context: NativeDimensionCaptionContext,
  work: PdfLinework,
): string | undefined {
  const operations = new Set<number>()
  for (const item of context.items) {
    if (
      item.inkRefusal !== undefined &&
      (typeof item.inkRefusal !== 'string' || !item.inkRefusal || item.inkRefusal.length > 128)
    )
      return 'invalid-native-caption-context'
    if (item.inkPolygon === undefined) {
      if (item.inkSourceOperation !== undefined || item.inkSourceOperations !== undefined)
        return 'invalid-native-caption-context'
      continue
    }
    const refs = item.inkSourceOperations ?? [item.inkSourceOperation]
    if (
      !Array.isArray(item.inkPolygon) ||
      item.inkPolygon.length !== 4 ||
      item.inkRefusal !== undefined ||
      !Number.isSafeInteger(item.inkSourceOperation) ||
      (item.inkSourceOperation ?? -1) < 0 ||
      !Array.isArray(refs) ||
      refs.length < 1 ||
      refs.length > 16 ||
      refs[0] !== item.inkSourceOperation ||
      new Set(refs).size !== refs.length ||
      refs.some(
        (ref) => !Number.isSafeInteger(ref) || (ref ?? -1) < 0 || operations.has(ref as number),
      ) ||
      item.inkPolygon.some(
        (point) =>
          !point ||
          ![point.x, point.y].every(
            (value) => Number.isFinite(value) && value >= 0 && value <= 1000,
          ),
      )
    )
      return 'invalid-native-caption-context'
    for (const ref of refs) operations.add(ref as number)
    const physical = (point: PagePoint) => ({
      x: (point.x * work.pageWidth) / 1000,
      y: (point.y * work.pageHeight) / 1000,
    })
    const [a, b, c, d] = item.inkPolygon.map(physical) as [
      PagePoint,
      PagePoint,
      PagePoint,
      PagePoint,
    ]
    const along = { x: b.x - a.x, y: b.y - a.y }
    const across = { x: d.x - a.x, y: d.y - a.y }
    const baselineStart = physical(item.baselineStart)
    const baselineEnd = physical(item.baselineEnd)
    const baseline = { x: baselineEnd.x - baselineStart.x, y: baselineEnd.y - baselineStart.y }
    const length = Math.hypot(along.x, along.y)
    const depth = Math.hypot(across.x, across.y)
    const baselineLength = Math.hypot(baseline.x, baseline.y)
    if (
      length === 0 ||
      depth === 0 ||
      baselineLength === 0 ||
      Math.hypot(c.x - (b.x + d.x - a.x), c.y - (b.y + d.y - a.y)) > 1e-7 ||
      Math.abs(along.x * across.x + along.y * across.y) / (length * depth) > 1e-7 ||
      Math.abs(along.x * baseline.y - along.y * baseline.x) / (length * baselineLength) > 1e-7 ||
      along.x * baseline.x + along.y * baseline.y <= 0
    )
      return 'invalid-native-caption-context'
  }
  return undefined
}

/** Exact source-run geometry; no nearest-caption choice or replacement dimension calculation. */
export function createNativeCaptionMatcher(
  work: PdfLinework,
  source: PdfPlanSource,
  spans: readonly NativeCaptionRail[],
  context: NativeDimensionCaptionContext,
  axis: 'width' | 'depth',
): (label: CaptionLabel) => NativeCaptionMatch {
  const fail = (
    reason: string,
    status: 'unresolved' | 'ambiguous' = 'unresolved',
  ): NativeCaptionMatch => ({ status, reason })
  const invalid = () => fail('invalid-native-caption-context')
  const pointValid = (point: PagePoint) =>
    [point.x, point.y].every((value) => Number.isFinite(value) && value >= 0 && value <= 1000)
  const directionMatches = (item: NativeDimensionCaptionContext['items'][number]) => {
    const dx = ((item.baselineEnd.x - item.baselineStart.x) * work.pageWidth) / 1000
    const dy = ((item.baselineEnd.y - item.baselineStart.y) * work.pageHeight) / 1000
    if (!Number.isFinite(dx) || !Number.isFinite(dy) || (dx === 0 && dy === 0)) return false
    const degrees = (-Math.atan2(dy, dx) * 180) / Math.PI
    const delta = Math.abs((degrees - item.rotation) % 360)
    return Math.min(delta, 360 - delta) <= 0.5 + 1e-9
  }
  const parallelRotation = (rotation: number) => {
    const expected = axis === 'width' ? 0 : 90
    const delta = Math.abs((((rotation - expected) % 180) + 180) % 180)
    return Math.min(delta, 180 - delta) <= 1e-6
  }
  if (
    ![work.pageWidth, work.pageHeight].every((value) => Number.isFinite(value) && value > 0) ||
    !/^[a-f0-9]{64}$/.test(source.sha256) ||
    !Number.isSafeInteger(source.pdfPage) ||
    source.pdfPage < 1 ||
    context.complete !== true ||
    context.source.sha256 !== source.sha256 ||
    context.source.pdfPage !== source.pdfPage ||
    context.source.pageWidth !== work.pageWidth ||
    context.source.pageHeight !== work.pageHeight ||
    context.items.length > 1000 ||
    new Set(context.items.map((item) => item.index)).size !== context.items.length ||
    context.items.some(
      (item) =>
        !Number.isSafeInteger(item.index) ||
        item.index < 0 ||
        nativeDimensionCaptionMillimetres(item.text) === undefined ||
        !Number.isFinite(item.rotation) ||
        ![item.origin, item.baselineStart, item.baselineEnd].every(pointValid) ||
        !directionMatches(item) ||
        Math.abs(item.origin.x - item.baselineStart.x) > 0.51 ||
        Math.abs(item.origin.y - item.baselineStart.y) > 0.51,
    )
  ) {
    return invalid
  }
  if (nativeCaptionInkIssue(context, work)) return invalid
  if (context.items.some((item) => item.inkRefusal !== undefined))
    return () => fail('caption-ink-context-incomplete')
  const along = (point: PagePoint) => (axis === 'width' ? point.x : point.y)
  const across = (point: PagePoint) => (axis === 'width' ? point.y : point.x)
  const alongScale = (axis === 'width' ? work.pageWidth : work.pageHeight) / 1000
  const acrossScale = (axis === 'width' ? work.pageHeight : work.pageWidth) / 1000
  const captions = context.items.filter((item) => parallelRotation(item.rotation))
  const length = (span: NativeCaptionRail) => (along(span.end) - along(span.start)) * alongScale
  if (
    spans.length > 5000 ||
    spans.some(
      (span) =>
        ![span.start, span.end].every(pointValid) ||
        ![span.operationIndex, span.subpathIndex].every(
          (value) => Number.isSafeInteger(value) && value >= 0,
        ) ||
        length(span) <= 0 ||
        Math.abs(across(span.start) - across(span.end)) * acrossScale > 0.12 ||
        (span.outboard &&
          (![span.outboard.start, span.outboard.end].every(pointValid) ||
            along(span.outboard.start) > along(span.start) ||
            along(span.outboard.end) < along(span.end))),
    )
  )
    return () => fail('invalid-native-caption-rails')
  const railCounts = new Map<string, number>()
  const railKey = (span: NativeCaptionRail) => `${span.operationIndex}:${span.subpathIndex}`
  for (const span of spans) railCounts.set(railKey(span), (railCounts.get(railKey(span)) ?? 0) + 1)
  const overlaps = new Set<NativeCaptionRail>()
  const contested = (span: NativeCaptionRail) =>
    span.branched || (railCounts.get(railKey(span)) ?? 0) > 1 || overlaps.has(span)
  const samePoint = (left: PagePoint, right: PagePoint) =>
    Math.hypot(
      ((left.x - right.x) * work.pageWidth) / 1000,
      ((left.y - right.y) * work.pageHeight) / 1000,
    ) <= 0.12
  const onRow = (caption: (typeof captions)[number], span: NativeCaptionRail) => {
    const degrees = (caption.rotation * Math.PI) / 180
    const forward = axis === 'width' ? Math.cos(degrees) : Math.sin(degrees)
    const gap =
      (across(span.start) - across(caption.baselineStart)) * acrossScale * Math.sign(forward)
    return (
      gap >= 0 &&
      gap <= 4 &&
      Math.abs(across(caption.baselineEnd) - across(caption.baselineStart)) * acrossScale <= 0.12
    )
  }
  const captionInterval = (caption: (typeof captions)[number]) => {
    const points = caption.inkPolygon ?? [caption.baselineStart, caption.baselineEnd]
    return { low: Math.min(...points.map(along)), high: Math.max(...points.map(along)) }
  }
  let budget = 200_000
  for (let i = 0; i < spans.length; i++) {
    const first = spans[i]
    if (!first) continue
    for (let j = i + 1; j < spans.length; j++) {
      if (--budget < 0) return () => fail('caption-binding-budget-exceeded')
      const second = spans[j]
      if (!second) continue
      const rows = [first.start, first.end, second.start, second.end].map(across)
      const intersection =
        Math.min(along(first.end), along(second.end)) -
        Math.max(along(first.start), along(second.start))
      if (
        (Math.max(...rows) - Math.min(...rows)) * acrossScale <= 0.12 &&
        intersection * alongScale > 0.12
      ) {
        overlaps.add(first)
        overlaps.add(second)
      }
    }
  }
  const outboardMatch = (caption: (typeof captions)[number], span: NativeCaptionRail) => {
    if (!span.outboard || !onRow(caption, span)) return false
    const { low, high } = captionInterval(caption)
    if ((high - low) * alongScale <= length(span)) return false
    return (
      (high < along(span.start) &&
        Math.abs(high - along(span.outboard.start)) * alongScale <= 0.12) ||
      (low > along(span.end) && Math.abs(low - along(span.outboard.end)) * alongScale <= 0.12)
    )
  }
  const centred = new Map<NativeCaptionRail, typeof captions>()
  const outboardClaims = new Map<NativeCaptionRail, typeof captions>()
  const centredByLabel = new Map<number, NativeCaptionRail[]>()
  for (const span of spans) {
    const matches: typeof captions = []
    const offsetClaims: typeof captions = []
    for (const caption of captions) {
      if (--budget < 0) return () => fail('caption-binding-budget-exceeded')
      if (outboardMatch(caption, span)) offsetClaims.push(caption)
      const { low, high } = captionInterval(caption)
      const midpoint = (low + high) / 2
      if (
        onRow(caption, span) &&
        Math.abs(midpoint - (along(span.start) + along(span.end)) / 2) * alongScale <= 0.12
      ) {
        matches.push(caption)
        const found = centredByLabel.get(caption.index) ?? []
        found.push(span)
        centredByLabel.set(caption.index, found)
      }
    }
    centred.set(span, matches)
    outboardClaims.set(span, offsetClaims)
  }
  const captionByIndex = new Map(context.items.map((item) => [item.index, item]))
  const cache = new Map<number, NativeCaptionMatch>()
  return (label) => {
    const caption = captionByIndex.get(label.index)
    if (
      !caption ||
      caption.text !== label.text ||
      caption.rotation !== label.rotation ||
      caption.origin.x !== label.x ||
      caption.origin.y !== label.y
    )
      return invalid()
    const prior = cache.get(label.index)
    if (prior) return prior
    const remember = (result: NativeCaptionMatch) => {
      cache.set(label.index, result)
      return result
    }
    const ordinary = centredByLabel.get(label.index) ?? []
    if (ordinary.length > 1) return remember(fail('multiple-caption-rails', 'ambiguous'))
    const ordinarySpan = ordinary[0]
    if (ordinarySpan) {
      if (contested(ordinarySpan)) return remember(fail('branched-dimension-line', 'ambiguous'))
      if (
        centred.get(ordinarySpan)?.length !== 1 ||
        (outboardClaims.get(ordinarySpan)?.length ?? 0) > 0
      )
        return remember(fail('competing-native-captions', 'ambiguous'))
      return remember({ status: 'candidate', span: ordinarySpan, basis: 'centered-caption' })
    }
    const resolved: NativeCaptionRail[] = []
    const printed = nativeDimensionCaptionMillimetres(caption.text) ?? 0
    for (const span of spans) {
      if (--budget < 0) return remember(fail('caption-binding-budget-exceeded'))
      if (!outboardMatch(caption, span)) continue
      if (contested(span)) return remember(fail('branched-dimension-line', 'ambiguous'))
      if ((centred.get(span)?.length ?? 0) > 0 || outboardClaims.get(span)?.length !== 1)
        return remember(fail('competing-native-captions', 'ambiguous'))
      const left: NativeCaptionRail[] = [],
        right: NativeCaptionRail[] = []
      for (const other of spans) {
        if (--budget < 0) return remember(fail('caption-binding-budget-exceeded'))
        if (
          contested(other) ||
          other === span ||
          centred.get(other)?.length !== 1 ||
          (outboardClaims.get(other)?.length ?? 0) > 0
        )
          continue
        if (samePoint(other.end, span.start)) left.push(other)
        if (samePoint(other.start, span.end)) right.push(other)
      }
      if (left.length !== 1 || right.length !== 1) continue
      const leftRail = left[0],
        rightRail = right[0]
      const leftCaption = leftRail && centred.get(leftRail)?.[0]
      const rightCaption = rightRail && centred.get(rightRail)?.[0]
      if (
        !leftRail ||
        !rightRail ||
        !leftCaption ||
        !rightCaption ||
        leftCaption.index === rightCaption.index ||
        leftCaption.index === caption.index ||
        rightCaption.index === caption.index ||
        centredByLabel.get(leftCaption.index)?.length !== 1 ||
        centredByLabel.get(rightCaption.index)?.length !== 1
      )
        continue
      const leftValue = nativeDimensionCaptionMillimetres(leftCaption.text) ?? 0
      const rightValue = nativeDimensionCaptionMillimetres(rightCaption.text) ?? 0
      // Confirm the printed value against two independently captioned connected neighbours.
      // Never emit a value derived from this graphic ratio.
      if (
        Math.abs((length(span) / length(leftRail)) * leftValue - printed) > 1 ||
        Math.abs((length(span) / length(rightRail)) * rightValue - printed) > 1 ||
        Math.abs((length(rightRail) / length(leftRail)) * leftValue - rightValue) > 1
      )
        continue
      resolved.push(span)
    }
    if (resolved.length > 1) return remember(fail('multiple-outboard-caption-rails', 'ambiguous'))
    const offsetSpan = resolved[0]
    if (offsetSpan)
      return remember({ status: 'candidate', span: offsetSpan, basis: 'outboard-caption' })
    const branched = spans.some(
      (span) =>
        span.branched &&
        onRow(caption, span) &&
        along(label) > along(span.start) &&
        along(label) < along(span.end),
    )
    return remember(
      fail(
        branched ? 'branched-dimension-line' : 'caption-rail-unresolved',
        branched ? 'ambiguous' : 'unresolved',
      ),
    )
  }
}
