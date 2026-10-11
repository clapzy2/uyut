import type { PagePoint } from './plan-pdf-linework'
import type { NativeNumericTextInk } from './plan-pdf-text-ink'

type Item = NativeNumericTextInk['items'][number]
export const sourceResetNoteLiteral =
  /^(?:[1-9]\d?\. )?(?:Размеры указаны в миллиметрах|Все отметки высот на замере даны от чистового пола)$/iu
const near = (left: number, right: number) => Math.abs(left - right) <= 1e-7
const matrix = (value: unknown): value is [number, number, number, number, number, number] =>
  Array.isArray(value) && value.length === 6 && value.every(Number.isFinite)
const pointValid = (point: PagePoint | undefined) =>
  !!point && [point.x, point.y].every(Number.isFinite)

function floatCell(value: number): [number, number] | null {
  if (!Number.isFinite(value) || Math.fround(value) !== value) return null
  if (value === 0) return [-(2 ** -150), 2 ** -150]
  const buffer = new ArrayBuffer(4)
  const floats = new Float32Array(buffer),
    bits = new Uint32Array(buffer)
  floats[0] = value
  const stored = bits[0] as number
  bits[0] = stored + (value > 0 ? -1 : 1)
  const lower = floats[0] as number
  bits[0] = stored + (value > 0 ? 1 : -1)
  const upper = floats[0] as number
  if (![lower, upper].every(Number.isFinite)) return null
  return [(lower + value) / 2, (upper + value) / 2]
}

/** Documentary note grouping through explicit source Tm resets and TJ values.
 * Generated spaces are PDF.js layout evidence, never painted space glyphs.
 * The envelope includes Float32 operand cells; it is not an exact text box.
 */
export function nativeResetNoteBounds(
  item: Item,
  label: { name: string; pagePoint?: PagePoint; rotation?: number },
  frame: { pageWidth: number; pageHeight: number },
): PagePoint[] | null {
  const caption = item.sourceResetCaption
  if (
    !caption ||
    item.sourceGroup ||
    !sourceResetNoteLiteral.test(item.text) ||
    item.text !== label.name ||
    !label.pagePoint ||
    label.rotation !== 0 ||
    ![frame.pageWidth, frame.pageHeight].every((value) => Number.isFinite(value) && value > 0) ||
    !matrix(caption.sourceCtm) ||
    !matrix(caption.textContentTransform) ||
    !Array.isArray(caption.shows) ||
    caption.shows.length < 2 ||
    caption.shows.length > 50 ||
    !Array.isArray(caption.generatedSpacesBefore) ||
    new Set(caption.generatedSpacesBefore).size !== caption.generatedSpacesBefore.length ||
    caption.generatedSpacesBefore.some(
      (index) => !Number.isSafeInteger(index) || index <= 0 || index >= caption.shows.length,
    ) ||
    !Number.isFinite(caption.fontSize) ||
    caption.fontSize <= 0 ||
    caption.horizontalScale !== 1 ||
    !Number.isFinite(caption.textContentWidth) ||
    caption.textContentWidth <= 0 ||
    !Array.isArray(item.quad) ||
    item.quad.length !== 4 ||
    !item.quad.every(pointValid) ||
    !pointValid(item.baselineStart) ||
    !pointValid(item.baselineEnd)
  )
    return null
  const [a, b, c, d, e, f] = caption.sourceCtm
  const raw = caption.textContentTransform,
    size = caption.fontSize
  if (
    a <= 0 ||
    b !== 0 ||
    c !== 0 ||
    d <= 0 ||
    raw[1] !== 0 ||
    raw[2] !== 0 ||
    !near(raw[0], a * size) ||
    !near(raw[3], d * size) ||
    !near((raw[4] / frame.pageWidth) * 1000, label.pagePoint.x) ||
    !near(((frame.pageHeight - raw[5]) / frame.pageHeight) * 1000, label.pagePoint.y)
  )
    return null
  let literal = '',
    previousOperation = -1
  let firstOrigin:
    | { x: number; y: number; minX: number; maxX: number; minY: number; maxY: number }
    | undefined
  let previousEnd: { minX: number; maxX: number } | undefined
  let lastEnd: { x: number; minX: number; maxX: number } | undefined
  const quads: PagePoint[] = [],
    conservative: PagePoint[] = []
  for (const [index, show] of caption.shows.entries()) {
    const packed = show?.packedOrigin
    if (
      !show ||
      !packed ||
      !Number.isSafeInteger(show.operationIndex) ||
      show.operationIndex <= previousOperation ||
      !Number.isSafeInteger(packed.operationIndex) ||
      packed.operationIndex < 0 ||
      packed.operationIndex >= show.operationIndex ||
      !matrix(packed.matrix) ||
      packed.matrix.slice(0, 4).some((value, index) => value !== [1, 0, 0, 1][index]) ||
      !Array.isArray(packed.cursorOffset) ||
      packed.cursorOffset.length !== 2 ||
      !packed.cursorOffset.every(Number.isFinite) ||
      !matrix(show.textMatrix) ||
      show.textMatrix.slice(0, 4).some((value, index) => value !== [1, 0, 0, 1][index]) ||
      !near(show.textMatrix[4], packed.matrix[4] + packed.cursorOffset[0]) ||
      !near(show.textMatrix[5], packed.matrix[5] + packed.cursorOffset[1]) ||
      typeof show.text !== 'string' ||
      !show.text ||
      literal.length + show.text.length > 200 ||
      !Array.isArray(show.glyphWidths) ||
      show.glyphWidths.length !== Array.from(show.text).length ||
      !show.glyphWidths.every((width) => Number.isFinite(width) && width > 0) ||
      !Number.isFinite(show.charSpacing) ||
      show.wordSpacing !== 0 ||
      !Array.isArray(show.adjustments) ||
      show.adjustments.length > 1000 ||
      !Array.isArray(show.quad) ||
      show.quad.length !== 4 ||
      !show.quad.every(pointValid) ||
      !near((show.quad[0] as PagePoint).x, (show.quad[3] as PagePoint).x) ||
      !near((show.quad[1] as PagePoint).x, (show.quad[2] as PagePoint).x) ||
      !near((show.quad[0] as PagePoint).y, (show.quad[1] as PagePoint).y) ||
      !near((show.quad[2] as PagePoint).y, (show.quad[3] as PagePoint).y)
    )
      return null
    const xCell = floatCell(packed.matrix[4]),
      yCell = floatCell(packed.matrix[5])
    const oneCell = floatCell(1)
    if (!xCell || !yCell || !oneCell) return null
    const linearError = Math.max(1 - oneCell[0], oneCell[1] - 1)
    const offsetErrorX = Math.abs(packed.cursorOffset[0]) * linearError
    const offsetErrorY = Math.abs(packed.cursorOffset[1]) * linearError
    const origin = {
      x: a * show.textMatrix[4] + e,
      y: d * show.textMatrix[5] + f,
      minX: a * (xCell[0] + packed.cursorOffset[0] - offsetErrorX) + e,
      maxX: a * (xCell[1] + packed.cursorOffset[0] + offsetErrorX) + e,
      minY: d * (yCell[0] + packed.cursorOffset[1] - offsetErrorY) + f,
      maxY: d * (yCell[1] + packed.cursorOffset[1] + offsetErrorY) + f,
    }
    if (!firstOrigin) {
      firstOrigin = origin
      if (
        item.operationIndex !== show.operationIndex ||
        raw[4] < origin.minX ||
        raw[4] > origin.maxX ||
        raw[5] < origin.minY ||
        raw[5] > origin.maxY
      )
        return null
    } else if (previousEnd) {
      const minGap = (origin.minX - previousEnd.maxX) / a
      const maxGap = (origin.maxX - previousEnd.minX) / a
      if (
        minGap < -0.2 * size ||
        Math.max(
          Math.abs(origin.minY - firstOrigin.maxY),
          Math.abs(origin.maxY - firstOrigin.minY),
        ) /
          d >
          0.25 * size
      )
        return null
      if (caption.generatedSpacesBefore.includes(index)) {
        if (minGap < 0.102 * size || maxGap > 0.6 * size) return null
        literal += ' '
      } else if (maxGap > 0.102 * size) return null
    }
    let advance = 0,
      adjustmentPosition = -1
    for (const adjustment of show.adjustments) {
      if (
        !adjustment ||
        !Number.isSafeInteger(adjustment.glyphIndex) ||
        adjustment.glyphIndex < adjustmentPosition ||
        adjustment.glyphIndex < 0 ||
        adjustment.glyphIndex >= show.glyphWidths.length ||
        !Number.isFinite(adjustment.value)
      )
        return null
      adjustmentPosition = adjustment.glyphIndex
    }
    for (const [glyphIndex, width] of show.glyphWidths.entries()) {
      for (const adjustment of show.adjustments.filter((row) => row.glyphIndex === glyphIndex))
        advance -= (adjustment.value / 1000) * size
      advance += (width / 1000) * size + show.charSpacing
    }
    advance -= show.charSpacing
    if (advance <= 0 || !Number.isFinite(advance)) return null
    const advanceError = Math.abs(advance) * linearError
    lastEnd = {
      x: origin.x + a * advance,
      minX: origin.minX + a * (advance - advanceError),
      maxX: origin.maxX + a * (advance + advanceError),
    }
    previousEnd = { minX: lastEnd.minX, maxX: lastEnd.maxX }
    for (const point of show.quad) {
      quads.push(point)
      const localX = (point.x - e) / a - packed.matrix[4]
      const localY = (point.y - f) / d - packed.matrix[5]
      const errorX =
        a *
        (Math.max(packed.matrix[4] - xCell[0], xCell[1] - packed.matrix[4]) +
          Math.abs(localX) * linearError)
      const errorY =
        d *
        (Math.max(packed.matrix[5] - yCell[0], yCell[1] - packed.matrix[5]) +
          Math.abs(localY) * linearError)
      conservative.push(
        { x: point.x - errorX, y: point.y - errorY },
        { x: point.x + errorX, y: point.y + errorY },
      )
    }
    literal += show.text
    previousOperation = show.operationIndex
  }
  if (
    !firstOrigin ||
    !lastEnd ||
    literal !== item.text ||
    raw[4] + caption.textContentWidth < lastEnd.minX ||
    raw[4] + caption.textContentWidth > lastEnd.maxX ||
    !near((firstOrigin.x / frame.pageWidth) * 1000, item.baselineStart.x) ||
    !near(((frame.pageHeight - firstOrigin.y) / frame.pageHeight) * 1000, item.baselineStart.y) ||
    !near((lastEnd.x / frame.pageWidth) * 1000, item.baselineEnd.x) ||
    !near(item.baselineEnd.y, item.baselineStart.y)
  )
    return null
  const min = (points: PagePoint[], key: 'x' | 'y') =>
    Math.min(...points.map((point) => point[key]))
  const max = (points: PagePoint[], key: 'x' | 'y') =>
    Math.max(...points.map((point) => point[key]))
  if (
    !near((min(quads, 'x') / frame.pageWidth) * 1000, min(item.quad, 'x')) ||
    !near((max(quads, 'x') / frame.pageWidth) * 1000, max(item.quad, 'x')) ||
    !near(((frame.pageHeight - max(quads, 'y')) / frame.pageHeight) * 1000, min(item.quad, 'y')) ||
    !near(((frame.pageHeight - min(quads, 'y')) / frame.pageHeight) * 1000, max(item.quad, 'y'))
  )
    return null
  const left = (min(conservative, 'x') / frame.pageWidth) * 1000,
    right = (max(conservative, 'x') / frame.pageWidth) * 1000
  const top = ((frame.pageHeight - max(conservative, 'y')) / frame.pageHeight) * 1000,
    bottom = ((frame.pageHeight - min(conservative, 'y')) / frame.pageHeight) * 1000
  if (
    [left, right, top, bottom].some((value) => !Number.isFinite(value) || value < 0 || value > 1000)
  )
    return null
  return [
    { x: left, y: top },
    { x: right, y: top },
    { x: right, y: bottom },
    { x: left, y: bottom },
  ]
}

/** Narrow source-backed translation envelope, never an exact original glyph box.
 * Rotated/sheared groups, whitespace inference and missing lineage remain held.
 */
export function nativeHeightGroupBounds(
  item: Item,
  label: { name: string; pagePoint?: PagePoint; rotation?: number },
  frame: { pageWidth: number; pageHeight: number },
): PagePoint[] | null {
  const group = item.sourceGroup
  if (!group || !label.pagePoint || label.rotation !== 0) return null
  const {
    packedTextMatrix: packed,
    sourceCtm: ctm,
    textContentTransform: text,
    cursorOffset: offset,
  } = group
  if (
    !matrix(packed) ||
    !matrix(ctm) ||
    !matrix(text) ||
    !Array.isArray(offset) ||
    offset.length !== 2 ||
    !offset.every(Number.isFinite) ||
    !Array.isArray(group.shows) ||
    group.shows.length < 2 ||
    group.shows.length > 50 ||
    !Array.isArray(group.operationIndexes) ||
    group.operationIndexes.length !== group.shows.length ||
    !Number.isSafeInteger(group.packedTextMatrixOperationIndex) ||
    (group.packedTextMatrixOperationIndex ?? -1) < 0 ||
    group.horizontalScale !== 1 ||
    !Number.isFinite(group.fontSize) ||
    (group.fontSize ?? 0) <= 0 ||
    packed[0] !== 1 ||
    packed[1] !== 0 ||
    packed[2] !== 0 ||
    packed[3] !== 1 ||
    ctm[0] <= 0 ||
    ctm[1] !== 0 ||
    ctm[2] !== 0 ||
    ctm[3] <= 0 ||
    text[1] !== 0 ||
    text[2] !== 0 ||
    ![frame.pageWidth, frame.pageHeight].every((value) => Number.isFinite(value) && value > 0) ||
    !pointValid(item.baselineStart) ||
    !pointValid(item.baselineEnd) ||
    !Array.isArray(item.quad) ||
    item.quad.length !== 4 ||
    !item.quad.every(pointValid)
  )
    return null
  const size = group.fontSize as number
  if (!near(text[0], ctm[0] * size) || !near(text[3], ctm[3] * size)) return null
  const rawOrigin = [(text[4] - ctm[4]) / ctm[0], (text[5] - ctm[5]) / ctm[3]]
  if (
    Math.fround((rawOrigin[0] as number) - offset[0]) !== packed[4] ||
    Math.fround((rawOrigin[1] as number) - offset[1]) !== packed[5] ||
    !Array.isArray(group.packedTranslation) ||
    group.packedTranslation.length !== 2 ||
    group.packedTranslation[0] !== packed[4] ||
    group.packedTranslation[1] !== packed[5] ||
    !near((text[4] / frame.pageWidth) * 1000, label.pagePoint.x) ||
    !near(((frame.pageHeight - text[5]) / frame.pageHeight) * 1000, label.pagePoint.y)
  )
    return null
  let cursorX = packed[4] + offset[0]
  const cursorY = packed[5] + offset[1]
  const startX = cursorX
  let lastSpacing = 0
  let literal = ''
  let previousOperation = group.packedTextMatrixOperationIndex as number
  for (const [index, show] of group.shows.entries()) {
    if (
      !show ||
      !Number.isSafeInteger(show.operationIndex) ||
      show.operationIndex <= previousOperation ||
      show.operationIndex !== group.operationIndexes[index] ||
      !matrix(show.textMatrix) ||
      show.textMatrix.slice(0, 4).some((value, index) => value !== packed[index]) ||
      !near(show.textMatrix[4], cursorX) ||
      !near(show.textMatrix[5], cursorY) ||
      typeof show.text !== 'string' ||
      !show.text ||
      /\s/u.test(show.text) ||
      !Array.isArray(show.glyphWidths) ||
      show.glyphWidths.length !== Array.from(show.text).length ||
      !show.glyphWidths.every((width) => Number.isFinite(width) && width > 0) ||
      !Number.isFinite(show.charSpacing) ||
      show.wordSpacing !== 0
    )
      return null
    for (const width of show.glyphWidths) cursorX += (width / 1000) * size + show.charSpacing
    lastSpacing = show.charSpacing
    literal += show.text
    previousOperation = show.operationIndex
  }
  if (
    literal !== label.name ||
    literal !== item.text ||
    item.operationIndex !== group.operationIndexes[0]
  )
    return null
  const renderStart = {
    x: ((ctm[0] * startX + ctm[4]) / frame.pageWidth) * 1000,
    y: ((frame.pageHeight - (ctm[3] * cursorY + ctm[5])) / frame.pageHeight) * 1000,
  }
  if (
    !near(renderStart.x, item.baselineStart.x) ||
    !near(renderStart.y, item.baselineStart.y) ||
    !near(
      ((ctm[0] * (cursorX - lastSpacing) + ctm[4]) / frame.pageWidth) * 1000,
      item.baselineEnd.x,
    ) ||
    !near(renderStart.y, item.baselineEnd.y)
  )
    return null
  const delta = { x: label.pagePoint.x - renderStart.x, y: label.pagePoint.y - renderStart.y }
  const points = [
    ...item.quad,
    ...item.quad.map((point) => ({ x: point.x + delta.x, y: point.y + delta.y })),
  ]
  const left = Math.min(...points.map((point) => point.x)),
    right = Math.max(...points.map((point) => point.x))
  const top = Math.min(...points.map((point) => point.y)),
    bottom = Math.max(...points.map((point) => point.y))
  if ([left, right, top, bottom].some((value) => value < 0 || value > 1000)) return null
  return [
    { x: left, y: top },
    { x: right, y: top },
    { x: right, y: bottom },
    { x: left, y: bottom },
  ]
}
