import type { PagePoint } from './plan-pdf-linework'
import type { NativeNumericTextInk } from './plan-pdf-text-ink'

type Item = NativeNumericTextInk['items'][number]
const near = (left: number, right: number) => Math.abs(left - right) <= 1e-7
const matrix = (value: unknown): value is [number, number, number, number, number, number] =>
  Array.isArray(value) && value.length === 6 && value.every(Number.isFinite)
const pointValid = (point: PagePoint | undefined) =>
  !!point && [point.x, point.y].every(Number.isFinite)

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
