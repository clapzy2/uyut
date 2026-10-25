import { planTabularScheduleEvidence } from '@uyut/ai'
import { isWetRoomName } from '@uyut/db/room-purpose'
import {
  isPlanRoomSourceNumber,
  planRoomSourceNumbersInScheduleOrder,
} from '@uyut/db/source-room-number'
import type { NativeTextAnchors } from './plan-document'
import { nativeFillCandidates } from './plan-native-fill-candidates'
import type { Bounds, PagePoint, PdfLinework } from './plan-pdf-linework'
import { type NativePageSegment, nativePageSegments } from './plan-pdf-opening-endpoint'
import type { RegionLabelFrame } from './plan-raster-region-labels'

export type NativeRoomScheduleRow = {
  sourceNumber: number
  name: string
  documentaryAreaM2: number
  numberLabelId: string
  nameLabelId: string
  areaLabelId: string
  areaUnitLabelId?: string
}
type Label = NativeTextAnchors['labels'][number]
type Grid = { bounds: Bounds; columns: number[]; rows: number[]; edges: NativePageSegment[] }
const MAX_WORK = 200_000
const roomName =
  /^(?:помещение|прихожая(?:[-,]\s*коридор)?|кухня(?:[-–— ]гостиная)?|гостиная|(?:главная )?спальня|коридор|комната|жилая комната|детская|кабинет|гардероб|гардеробная|кладовая|балкон|лоджия)(?:\s+(?:#|№)?\s*\d{1,2})?$/iu
const isRoomName = (name: string) => isWetRoomName(name) || roomName.test(name)
const numberHeading = /^№(?:\s*п\/п)?$/u
const nameHeading = /^(?:наименование|помещение)$/iu
const areaHeading = /^площадь(?:,|,?\s+[мm][²2])?$/iu
const areaValue = /^\d{1,3}[,.]\d{1,2}(?:\s*[мm]²)?$/iu
const totalName = /^(?:общая площадь|итого|всего):?$/iu
const horizontalLabel = (label: Label) => Math.abs(label.rotation ?? Infinity) < 1e-7
const locatedLabel = (
  label: Label,
): label is Label & { pagePoint: PagePoint; pageEnd: PagePoint } =>
  Boolean(label.pagePoint && label.pageEnd)
function areaParts(labels: Label[]) {
  const first = labels[0]
  if (labels.length === 1 && first && areaValue.test(first.name)) return { area: first }
  if (labels.length !== 2) return undefined
  const area = labels.find((label) => /^\d{1,3}[,.]\d{1,2}\s+[мm]$/iu.test(label.name))
  const unit = labels.find((label) => label.name === '2' || label.name === '²')
  if (!area?.pageEnd || !area.pagePoint || !unit?.pagePoint || !unit.pageEnd) return undefined
  const width = unit.pageEnd.x - unit.pagePoint.x
  const rise = area.pagePoint.y - unit.pagePoint.y
  if (
    width <= 0 ||
    Math.abs(unit.pagePoint.x - area.pageEnd.x) > 0.05 ||
    rise <= 0 ||
    rise > width * 2
  )
    return undefined
  return { area, unit }
}
function raisedMetricArea(area: Label | undefined, unit: Label | undefined): number | undefined {
  const value = /^(\d{1,3}(?:[,.]\d{1,2})?)\s*[мm]$/iu.exec(area?.name ?? '')
  if (
    !value?.[1] ||
    unit?.name !== '2' ||
    !area?.pagePoint ||
    !area.pageEnd ||
    !unit.pagePoint ||
    !unit.pageEnd
  )
    return undefined
  const unitWidth = unit.pageEnd.x - unit.pagePoint.x
  const rise = area.pagePoint.y - unit.pagePoint.y
  if (
    Math.abs(area.pageEnd.x - unit.pagePoint.x) > 0.5 ||
    unitWidth <= 0 ||
    rise <= 0 ||
    rise > unitWidth * 2
  )
    return undefined
  return Number(value[1].replace(',', '.'))
}
const pointValid = (point: PagePoint) =>
  [point.x, point.y].every((value) => Number.isFinite(value) && value >= 0 && value <= 1000)
const overlaps = (a: Bounds, b: Bounds) =>
  a.left <= b.right && a.right >= b.left && a.top <= b.bottom && a.bottom >= b.top
const inside = (point: PagePoint, bounds: Bounds) =>
  point.x > bounds.left && point.x < bounds.right && point.y > bounds.top && point.y < bounds.bottom
const boundsOf = (points: PagePoint[]): Bounds => ({
  left: Math.min(...points.map((point) => point.x)),
  top: Math.min(...points.map((point) => point.y)),
  right: Math.max(...points.map((point) => point.x)),
  bottom: Math.max(...points.map((point) => point.y)),
})

/** PDF tables often paint each cell independently. Join only exactly touching source strokes. */
function continuousGridLines(segments: NativePageSegment[], vertical: boolean) {
  const grouped = new Map<number, NativePageSegment[]>()
  for (const segment of segments) {
    const fixed = vertical ? segment.start.x : segment.start.y
    const endFixed = vertical ? segment.end.x : segment.end.y
    const start = vertical ? segment.start.y : segment.start.x
    const end = vertical ? segment.end.y : segment.end.x
    if (fixed !== endFixed || start === end) continue
    grouped.set(fixed, [...(grouped.get(fixed) ?? []), segment])
  }
  const lines: Array<{ fixed: number; start: number; end: number; edges: NativePageSegment[] }> = []
  for (const [fixed, source] of grouped) {
    const ordered = source.sort((a, b) => {
      const aStart = vertical ? Math.min(a.start.y, a.end.y) : Math.min(a.start.x, a.end.x)
      const bStart = vertical ? Math.min(b.start.y, b.end.y) : Math.min(b.start.x, b.end.x)
      return aStart - bStart
    })
    for (const segment of ordered) {
      const start = vertical
        ? Math.min(segment.start.y, segment.end.y)
        : Math.min(segment.start.x, segment.end.x)
      const end = vertical
        ? Math.max(segment.start.y, segment.end.y)
        : Math.max(segment.start.x, segment.end.x)
      const previous = lines.at(-1)
      if (previous?.fixed === fixed && start <= previous.end) {
        previous.end = Math.max(previous.end, end)
        previous.edges.push(segment)
      } else {
        lines.push({ fixed, start, end, edges: [segment] })
      }
    }
  }
  return lines
}

/** A title, uniformly ruled rows and a checked total can identify a schedule without column headings. */
function titleAndRuledRoomRows(
  native: NativeTextAnchors,
  work: PdfLinework,
  operationCounts: Map<number, number>,
) {
  const titles = native.labels.filter((label) => label.name === 'Экспликация помещений')
  if (titles.length !== 1 || !titles[0]?.pagePoint) return
  const paths = new Map(
    work.paths.map((path) => [`${path.operationIndex}:${path.subpathIndex}`, path]),
  )
  const groups = new Map<string, NativePageSegment[]>()
  for (const segment of nativePageSegments(work)) {
    const path = paths.get(`${segment.operationIndex}:${segment.subpathIndex}`)
    const width = Math.abs(segment.end.x - segment.start.x)
    if (
      segment.start.y !== segment.end.y ||
      width < 100 ||
      path?.paint !== 'stroke' ||
      path.strokeColor?.toLowerCase() === '#ffffff' ||
      path.strokeInk?.refusalReason ||
      path.strokeInk?.dashArray.length ||
      operationCounts.get(segment.operationIndex) !== 1
    )
      continue
    const left = Math.min(segment.start.x, segment.end.x)
    const right = Math.max(segment.start.x, segment.end.x)
    const key = `${left}:${right}`
    groups.set(key, [...(groups.get(key) ?? []), segment])
  }
  const candidates: {
    rows: NativeRoomScheduleRow[]
    bounds: Bounds
    edges: NativePageSegment[]
    titleId: string
  }[] = []
  for (const edges of groups.values()) {
    if (edges.length < 4 || edges.length > 31) continue
    const ordered = [...edges].sort((a, b) => a.start.y - b.start.y)
    const first = ordered[0]
    const second = ordered[1]
    const last = ordered.at(-1)
    if (!first || !second || !last) continue
    const pitch = second.start.y - first.start.y
    if (pitch <= 0) continue
    if (
      ordered.some(
        (edge, index) =>
          index > 0 &&
          Math.abs(edge.start.y - (ordered[index - 1] as NativePageSegment).start.y - pitch) > 0.05,
      )
    )
      continue
    const left = Math.min(first.start.x, first.end.x)
    const right = Math.max(first.start.x, first.end.x)
    const title = titles[0]
    const titlePoint = title?.pagePoint
    const titleEnd = title?.pageEnd
    if (
      !titlePoint ||
      !titleEnd ||
      !horizontalLabel(title) ||
      titlePoint.x <= left ||
      titleEnd.x >= right ||
      titlePoint.y >= first.start.y ||
      first.start.y - titlePoint.y > pitch
    )
      continue
    const rows: NativeRoomScheduleRow[] = []
    let valid = true
    for (let index = 1; index < ordered.length; index++) {
      const upperEdge = ordered[index - 1]
      const lowerEdge = ordered[index]
      if (!upperEdge || !lowerEdge) {
        valid = false
        break
      }
      const top = upperEdge.start.y
      const bottom = lowerEdge.start.y
      const labels = native.labels.filter(
        (label) =>
          label.pagePoint &&
          label.pagePoint.x > left &&
          label.pagePoint.x < right &&
          label.pagePoint.y > top &&
          label.pagePoint.y < bottom,
      )
      if (
        labels.length !== 4 ||
        labels.some((label) => !horizontalLabel(label) || !locatedLabel(label))
      ) {
        valid = false
        break
      }
      const located = labels.filter(locatedLabel)
      const [number, name, area, unit] = located.sort((a, b) => a.pagePoint.x - b.pagePoint.x)
      if (!number || !name || !area || !unit) {
        valid = false
        break
      }
      const areaM2 = raisedMetricArea(area, unit)
      if (
        !/^\d{1,2}$/u.test(number.name) ||
        !isRoomName(name.name) ||
        areaM2 === undefined ||
        !planRoomSourceNumbersInScheduleOrder([
          ...rows.map((row) => row.sourceNumber),
          Number(number.name),
        ]) ||
        number.pageEnd.x >= name.pagePoint.x ||
        name.pageEnd.x >= area.pagePoint.x ||
        Math.abs(number.pagePoint.y - name.pagePoint.y) > pitch * 0.12 ||
        Math.abs(area.pagePoint.y - name.pagePoint.y) > pitch * 0.12
      ) {
        valid = false
        break
      }
      rows.push({
        sourceNumber: Number(number.name),
        name: name.name,
        documentaryAreaM2: areaM2,
        numberLabelId: number.id,
        nameLabelId: name.id,
        areaLabelId: area.id,
        areaUnitLabelId: unit.id,
      })
    }
    if (!valid || rows.length < 3) continue
    const totalLabels = native.labels.filter(
      (label) =>
        label.pagePoint &&
        label.pagePoint.x > left &&
        label.pagePoint.x < right &&
        label.pagePoint.y > last.start.y &&
        label.pagePoint.y < last.start.y + pitch,
    )
    if (totalLabels.length !== 2) continue
    const [total, totalUnit] = totalLabels.sort(
      (a, b) => (a.pagePoint as PagePoint).x - (b.pagePoint as PagePoint).x,
    )
    const totalM2 = raisedMetricArea(total, totalUnit)
    if (!total?.pagePoint) continue
    if (
      totalM2 === undefined ||
      Math.abs(
        Math.round(totalM2 * 100) -
          Math.round(rows.reduce((sum, row) => sum + row.documentaryAreaM2, 0) * 100),
      ) > 0
    )
      continue
    candidates.push({
      rows,
      bounds: { left, right, top: titlePoint.y, bottom: total.pagePoint.y },
      edges: ordered,
      titleId: title.id,
    })
  }
  return candidates.length === 1 ? candidates[0] : undefined
}

/** Documentary rows only. A source grid is not a room boundary or an area-derived polygon. */
export function nativeRoomScheduleEvidence(input: {
  native: NativeTextAnchors
  work: PdfLinework
  lineworkSource: RegionLabelFrame
}) {
  const { native, work } = input
  let rows: NativeRoomScheduleRow[] = []
  let tableBounds: Bounds | null = null
  let headerLabelIds: string[] = []
  let tableEdges: NativePageSegment[] = []
  let layoutBasis: 'strict-native-baselines' | 'exact-native-grid' | 'titled-ruled-rows' | null =
    null
  const finish = (reason: string | null) => ({
    status: reason ? ('unresolved' as const) : ('draft' as const),
    reason,
    rows: reason ? [] : structuredClone(rows),
    headerLabelIds: reason ? [] : [...headerLabelIds],
    tableBounds: reason ? null : tableBounds && { ...tableBounds },
    tableEdges: reason ? [] : structuredClone(tableEdges),
    layoutBasis: reason ? null : layoutBasis,
    basis: 'native-room-schedule-evidence' as const,
    source: { ...native.source },
    originalPdfSha256: native.originalPdfSha256,
    roomOwnershipConfirmed: false as const,
    closesFloorBoundary: false as const,
  })
  try {
    if (nativeFillCandidates(input).refusalReason === 'incomplete-native-layer')
      return finish('incomplete-native-layer')
  } catch {
    return finish('source-frame-unavailable')
  }
  const scale = native.pageNormalizedScale
  if (!scale || !native.complete || native.labels.length > 1000)
    return finish('incomplete-native-text')
  const labelIds = new Set<string>()
  for (const label of native.labels) {
    const point = label.pagePoint
    if (
      !Number.isSafeInteger(label.nativeIndex) ||
      (label.nativeIndex ?? -1) < 0 ||
      label.id !== `native-text-${label.nativeIndex}` ||
      labelIds.has(label.id) ||
      !label.name ||
      label.name !== label.name.trim() ||
      label.name.length > 200 ||
      !point ||
      !pointValid(point) ||
      !Number.isFinite(label.rotation) ||
      ![label.point.x, label.point.y].every(Number.isFinite) ||
      Math.abs(label.point.x - point.x * scale.x) > 1e-6 ||
      Math.abs(label.point.y - point.y * scale.y) > 1e-6
    )
      return finish('invalid-native-text-provenance')
    labelIds.add(label.id)
  }
  const omissions = [...(work.skippedCurveBounds ?? []), ...(work.clippedPathBounds ?? [])]
  if (
    ![work.skippedCurves, work.clippedPaths].every(
      (value) => Number.isSafeInteger(value) && value >= 0,
    ) ||
    (work.skippedCurveBounds?.length ?? 0) !== work.skippedCurves ||
    (work.clippedPathBounds?.length ?? 0) !== work.clippedPaths ||
    omissions.length > 6000 ||
    omissions.some(
      ({ operationIndex, bounds }) =>
        !Number.isSafeInteger(operationIndex) ||
        operationIndex < 0 ||
        ![bounds.left, bounds.top, bounds.right, bounds.bottom].every(Number.isFinite) ||
        bounds.left > bounds.right ||
        bounds.top > bounds.bottom,
    )
  )
    return finish('invalid-omission-provenance')
  const refs = new Set<string>()
  const operationCounts = new Map<number, number>()
  for (const path of work.paths) {
    const ref = `${path.operationIndex}:${path.subpathIndex}`
    if (
      refs.has(ref) ||
      ![path.operationIndex, path.subpathIndex].every(
        (value) => Number.isSafeInteger(value) && value >= 0,
      ) ||
      !['stroke', 'fill', 'fill-stroke'].includes(path.paint) ||
      typeof path.closed !== 'boolean' ||
      path.points.some((point) => !pointValid(point))
    )
      return finish('invalid-native-provenance')
    refs.add(ref)
    operationCounts.set(path.operationIndex, (operationCounts.get(path.operationIndex) ?? 0) + 1)
  }
  const titledRows = titleAndRuledRoomRows(native, work, operationCounts)
  if (titledRows) {
    if (omissions.some((item) => overlaps(item.bounds, titledRows.bounds)))
      return finish('table-native-geometry-incomplete')
    rows = titledRows.rows
    tableBounds = titledRows.bounds
    tableEdges = titledRows.edges
    headerLabelIds = [titledRows.titleId]
    layoutBasis = 'titled-ruled-rows'
    return finish(null)
  }
  const numbers = native.labels.filter((label) => numberHeading.test(label.name))
  const names = native.labels.filter((label) => nameHeading.test(label.name))
  const areas = native.labels.filter((label) => areaHeading.test(label.name))
  if (numbers.length !== 1 || names.length === 0 || areas.length !== 1)
    return finish('unsupported-or-ambiguous-room-table')
  const headings = [numbers[0], names[0], areas[0]] as Label[]
  const outerHeadings = [numbers[0], areas[0]] as Label[]
  if (outerHeadings.some((label) => label.rotation !== 0))
    return finish('unsupported-or-ambiguous-room-table')
  // A repeated name heading may belong to a separate wall legend. Only a complete
  // source grid can disambiguate it; never pick the first or nearest label.
  const table =
    names.length === 1 && names[0]?.rotation === 0
      ? planTabularScheduleEvidence(
          native.labels.map((label) => ({
            text: label.name,
            rotation: label.rotation as number,
            ...(label.pagePoint as PagePoint),
          })),
        )
      : undefined
  if (table) {
    rows = [...table].map(([sourceNumber, row]) => ({
      sourceNumber,
      name: row.name,
      documentaryAreaM2: row.areaM2,
      numberLabelId: native.labels[row.numberItemIndex]?.id ?? '',
      nameLabelId: native.labels[row.nameItemIndex]?.id ?? '',
      areaLabelId: native.labels[row.areaItemIndex]?.id ?? '',
    }))
    if (
      rows.some(
        (row) =>
          !isRoomName(row.name) || !row.numberLabelId || !row.nameLabelId || !row.areaLabelId,
      )
    )
      return finish('unsupported-or-ambiguous-room-table')
    const ids = new Set(
      rows.flatMap((row) => [row.numberLabelId, row.nameLabelId, row.areaLabelId]),
    )
    headerLabelIds = headings.map((label) => label.id)
    tableBounds = boundsOf(
      native.labels
        .filter((label) => ids.has(label.id) || headerLabelIds.includes(label.id))
        .map((label) => label.pagePoint as PagePoint),
    )
    if (omissions.some((item) => overlaps(item.bounds, tableBounds as Bounds)))
      return finish('table-native-geometry-incomplete')
    layoutBasis = 'strict-native-baselines'
  }

  // The alternate profile is a complete exact three-column grid, not wider text tolerances.
  let remainingWork = MAX_WORK
  const workLimit = Symbol('table-work-limit')
  const spend = (count = 1) => {
    remainingWork -= count
    if (remainingWork < 0) throw workLimit
  }
  const omittedOperations = new Set(omissions.map((item) => item.operationIndex))
  const paths = new Map(
    work.paths.map((path) => [`${path.operationIndex}:${path.subpathIndex}`, path]),
  )
  const rawSegments = nativePageSegments(work)
  const eligible = rawSegments.filter((segment) => {
    const path = paths.get(`${segment.operationIndex}:${segment.subpathIndex}`)
    return (
      path?.paint === 'stroke' &&
      operationCounts.get(segment.operationIndex) === 1 &&
      !omittedOperations.has(segment.operationIndex)
    )
  })
  const groups = new Map<
    string,
    { top: number; bottom: number; columns: Map<number, NativePageSegment[]> }
  >()
  // Only strokes spanning the known header can belong to this three-column grid.
  // Keep all raw segments for the later cell-ambiguity check, but do not let an
  // unrelated dense wall hatch exhaust the table search or its per-line limit.
  const outerHeaderBounds = boundsOf(outerHeadings.map((label) => label.pagePoint as PagePoint))
  const verticalLines = continuousGridLines(eligible, true).filter(
    (line) => line.start < outerHeaderBounds.top && line.end > outerHeaderBounds.bottom,
  )
  const horizontalLines = continuousGridLines(eligible, false).filter(
    (line) => line.start < outerHeaderBounds.left && line.end > outerHeaderBounds.right,
  )
  if ([...verticalLines, ...horizontalLines].some((line) => line.edges.length > 100))
    return finish('native-table-work-limit')
  for (const line of verticalLines) {
    const key = `${line.start}:${line.end}`
    const group = groups.get(key) ?? {
      top: line.start,
      bottom: line.end,
      columns: new Map<number, NativePageSegment[]>(),
    }
    group.columns.set(line.fixed, [...(group.columns.get(line.fixed) ?? []), ...line.edges])
    groups.set(key, group)
  }
  const grids: Grid[] = []
  let structuredGridPresent = false
  try {
    const horizontalGroups = new Map<string, { left: number; right: number; ys: Set<number> }>()
    for (const line of horizontalLines) {
      spend()
      const left = line.start,
        right = line.end
      const key = `${left}:${right}`
      const group = horizontalGroups.get(key) ?? { left, right, ys: new Set<number>() }
      group.ys.add(line.fixed)
      horizontalGroups.set(key, group)
    }
    // Full-width row strokes also retain evidence of a drawn schedule when an outer
    // vertical rail is missing. Do not let that absence downgrade it to bare baselines.
    for (const group of horizontalGroups.values()) {
      spend()
      if (group.ys.size < 4) continue
      const bounds = {
        left: group.left,
        right: group.right,
        top: Math.min(...group.ys),
        bottom: Math.max(...group.ys),
      }
      if (
        outerHeadings.every((label) => inside(label.pagePoint as PagePoint, bounds)) &&
        names.some((label) => inside(label.pagePoint as PagePoint, bounds))
      )
        structuredGridPresent = true
    }
    // A title band may extend only the outer rails above the room rows.
    // Use the drawn top row to include continuous rails covering the row span.
    for (const group of groups.values()) {
      spend()
      if (group.columns.size < 2) continue
      const topRows = horizontalLines.filter((line) => {
        spend()
        return (
          line.fixed === group.top &&
          outerHeadings.every((label) => {
            const point = label.pagePoint as PagePoint
            return point.x > line.start && point.x < line.end
          })
        )
      })
      for (const topRow of topRows) {
        spend()
        const rails = verticalLines.filter((line) => {
          spend()
          return (
            line.fixed >= topRow.start &&
            line.fixed <= topRow.end &&
            line.start <= group.top &&
            line.end >= group.bottom
          )
        })
        if (
          !rails.some((line) => line.fixed === topRow.start) ||
          !rails.some((line) => line.fixed === topRow.end)
        )
          continue
        for (const rail of rails) {
          spend()
          group.columns.set(rail.fixed, rail.edges)
        }
      }
    }
    for (const group of groups.values()) {
      spend()
      if (group.columns.size < 2) continue
      const columns = [...group.columns.keys()].sort((a, b) => a - b)
      const left = columns[0] as number,
        right = columns.at(-1) as number
      if (
        !outerHeadings.every((label) =>
          inside(label.pagePoint as PagePoint, {
            left,
            right,
            top: group.top,
            bottom: group.bottom,
          }),
        )
      )
        continue
      const horizontals = horizontalLines.filter((line) => {
        spend()
        return (
          line.fixed >= group.top &&
          line.fixed <= group.bottom &&
          line.start === left &&
          line.end === right
        )
      })
      const rowLines = [...new Set(horizontals.map((line) => line.fixed))].sort((a, b) => a - b)
      // Detect the enclosing drawn schedule before requiring the supported column count.
      // A missing/extra divider must not turn a damaged grid into baseline-only evidence.
      // A page border with only its top/bottom strokes is not a schedule grid.
      if (rowLines.length >= 4) structuredGridPresent = true
      if (
        group.columns.size !== 4 ||
        rowLines.length < 5 ||
        rowLines.length > 53 ||
        rowLines[0] !== group.top ||
        rowLines.at(-1) !== group.bottom
      )
        continue
      const headerBottom = rowLines[1] as number
      const nameLabels = names.filter((label) =>
        inside(label.pagePoint as PagePoint, {
          left: columns[1] as number,
          right: columns[2] as number,
          top: group.top,
          bottom: headerBottom,
        }),
      )
      if (nameLabels.length !== 1) continue
      const gridHeadings = [numbers[0], nameLabels[0], areas[0]] as Label[]
      if (
        !gridHeadings.every((label, index) =>
          inside(label.pagePoint as PagePoint, {
            left: columns[index] as number,
            right: columns[index + 1] as number,
            top: group.top,
            bottom: headerBottom,
          }),
        )
      )
        continue
      grids.push({
        bounds: { left, right, top: group.top, bottom: group.bottom },
        columns,
        rows: rowLines,
        edges: [...group.columns.values()].flat().concat(horizontals.flatMap((line) => line.edges)),
      })
    }
    // Экспликацию часто расчерчивают только горизонтальными линейками, без вертикальных
    // разделителей колонок. Границу столбца тогда берём не «на глаз по выравниванию», а
    // по настоящему пустому промежутку между подписями: если между заголовками нет ни
    // одного разрыва, колонку не выдумываем и таблицу не читаем. Все построчные проверки
    // ниже остаются прежними, и строки остаются документальными - ни контура, ни обмера.
    if (grids.length === 0) {
      for (const group of horizontalGroups.values()) {
        spend()
        if (group.ys.size < 4 || group.ys.size > 53) continue
        const allRows = [...group.ys].sort((a, b) => a - b)
        // У такой таблицы строки подчёркнуты снизу, а верхней линейки у шапки нет.
        // Берём самый длинный хвост линеек с одинаковым шагом и достраиваем шапку ровно
        // на один шаг вверх. Шаг обязан быть ровным: иначе высоту мы бы выдумывали.
        let start = allRows.length - 1
        const pitch = (allRows.at(-1) as number) - (allRows.at(-2) as number)
        if (!(pitch > 0)) continue
        while (
          start > 0 &&
          Math.abs((allRows[start] as number) - (allRows[start - 1] as number) - pitch) <= 0.05
        )
          start -= 1
        const run = allRows.slice(start)
        if (run.length < 3) continue
        // Prefer a drawn top edge above the regular row run. Header height can
        // differ from the data rows, as on the Remplanner survey sheet.
        const inferredHeaderTop = (run[0] as number) - pitch
        const precedingLine = allRows[start - 1]
        const headerTop =
          precedingLine !== undefined && precedingLine > inferredHeaderTop
            ? precedingLine
            : inferredHeaderTop
        // Линейка внутри достроенной шапки означала бы другую строку таблицы.
        if (allRows.some((value) => value > headerTop && value < (run[0] as number))) continue
        const rowLines = [headerTop, ...run]
        const bounds = {
          left: group.left,
          right: group.right,
          top: rowLines[0] as number,
          bottom: rowLines.at(-1) as number,
        }
        if (!outerHeadings.every((label) => inside(label.pagePoint as PagePoint, bounds))) continue
        // Вертикальная рейка внутри означает обычную сетку: её разбирает путь выше.
        if (
          verticalLines.some(
            (line) =>
              line.fixed > bounds.left &&
              line.fixed < bounds.right &&
              line.start <= bounds.bottom &&
              line.end >= bounds.top,
          )
        )
          continue
        const headerBottom = rowLines[1] as number
        const nameLabels = names.filter((label) =>
          inside(label.pagePoint as PagePoint, { ...bounds, bottom: headerBottom }),
        )
        if (nameLabels.length !== 1) continue
        const heading = [numbers[0], nameLabels[0], areas[0]] as Label[]
        if (
          !heading.every((label) =>
            inside(label.pagePoint as PagePoint, { ...bounds, bottom: headerBottom }),
          )
        )
          continue
        // Колонки считаем по самим строкам, а не по заголовкам: заголовок часто стоит
        // по центру столбца, а данные прижаты влево, и по нему границу не провести.
        // Берём настоящие границы текста, а не только его начало: длинное название
        // может заходить в колонку площади, и по одной начальной координате этого не
        // видно. Подпись без известного конца оставляет таблицу неоднозначной.
        const rowLabels = native.labels.filter(
          (label) =>
            label.pagePoint &&
            inside(label.pagePoint, { ...bounds, top: headerBottom }) &&
            label.pagePoint.y > headerBottom,
        )
        if (rowLabels.some((label) => !label.pageEnd || !horizontalLabel(label))) continue
        const spans = rowLabels
          .map((label) => {
            const start = label.pagePoint as PagePoint
            const end = label.pageEnd as PagePoint
            return { from: Math.min(start.x, end.x), to: Math.max(start.x, end.x) }
          })
          .sort((left, right) => left.from - right.from)
        if (spans.length < 3) continue
        // Зазор считаем от правого края одной подписи до левого края следующей.
        const gaps: { gap: number; at: number }[] = []
        let reach = spans[0]?.to as number
        for (const span of spans.slice(1)) {
          spend()
          if (span.from > reach) gaps.push({ gap: span.from - reach, at: (reach + span.from) / 2 })
          reach = Math.max(reach, span.to)
        }
        gaps.sort((left, right) => right.gap - left.gap)
        const [wide, next] = gaps
        if (!wide || !next) continue
        // Два самых широких разрыва должны быть именно разрывами, а не случайным
        // дрожанием: иначе столбцы мы бы выдумывали.
        const third = gaps[2]
        if (third && third.gap >= next.gap) continue
        const splits = [wide.at, next.at].sort((left, right) => left - right)
        const columns = [bounds.left, splits[0] as number, splits[1] as number, bounds.right]
        if (columns.some((value, index) => index > 0 && value <= (columns[index - 1] as number)))
          continue
        // Ни одна подпись строки не должна пересекать границу столбца.
        if (spans.some((span) => splits.some((edge) => span.from < edge && span.to > edge)))
          continue
        // Каждый заголовок обязан попасть в свой столбец и в правильном порядке.
        const columnOf = (x: number) =>
          columns.findIndex((edge, index) => index > 0 && x < edge) - 1
        if (heading.some((label, index) => columnOf((label.pagePoint as PagePoint).x) !== index))
          continue
        grids.push({
          bounds,
          columns,
          rows: rowLines,
          edges: horizontalLines
            .filter(
              (line) =>
                line.start === bounds.left && line.end === bounds.right && group.ys.has(line.fixed),
            )
            .flatMap((line) => line.edges),
        })
      }
    }
    // A generic "Помещение" caption is not a room type. Its ownership needs the
    // complete physical schedule grid, not merely aligned text baselines.
    if (
      grids.length === 0 &&
      table &&
      !structuredGridPresent &&
      !rows.some((row) => /^помещение(?:\s+\d{1,2})?$/iu.test(row.name))
    )
      return finish(null)
    if (grids.length !== 1) return finish('unsupported-or-ambiguous-room-table')
    const grid = grids[0] as Grid
    if (omissions.some((item) => overlaps(item.bounds, grid.bounds)))
      return finish('table-native-geometry-incomplete')
    const cells: Label[][][] = []
    for (let rowIndex = 0; rowIndex < grid.rows.length - 1; rowIndex++) {
      const row: Label[][] = [[], [], []]
      for (const label of native.labels) {
        spend()
        const point = label.pagePoint as PagePoint
        if (
          point.x < grid.bounds.left ||
          point.x > grid.bounds.right ||
          point.y < grid.bounds.top ||
          point.y > grid.bounds.bottom
        )
          continue
        if (grid.rows.includes(point.y) || grid.columns.includes(point.x))
          return finish('ambiguous-native-table-cell')
        if (
          point.y < (grid.rows[rowIndex] as number) ||
          point.y > (grid.rows[rowIndex + 1] as number)
        )
          continue
        for (let column = 0; column < 3; column++) {
          if (
            point.x > (grid.columns[column] as number) &&
            point.x < (grid.columns[column + 1] as number)
          )
            row[column]?.push(label)
        }
      }
      cells.push(row)
    }
    // Undeclared strokes partitioning a cell are not silently ignored as decorative text.
    for (const segment of rawSegments) {
      spend()
      const box = boundsOf([segment.start, segment.end])
      if (
        box.right <= grid.bounds.left ||
        box.left >= grid.bounds.right ||
        box.bottom <= grid.bounds.top ||
        box.top >= grid.bounds.bottom
      )
        continue
      const onRail = segment.start.x === segment.end.x && grid.columns.includes(segment.start.x)
      const onRow = segment.start.y === segment.end.y && grid.rows.includes(segment.start.y)
      const totalCell = cells.at(-1)
      const totalArea = totalCell && areaParts(totalCell[2] ?? [])
      const totalCaption = totalCell?.[1]?.[0]
      const underline =
        totalCaption &&
        totalName.test(totalCaption.name) &&
        totalArea &&
        [totalArea.area, totalArea.unit].some(
          (label) =>
            label?.pagePoint &&
            label.pageEnd &&
            segment.start.y === segment.end.y &&
            box.left >= label.pagePoint.x - 0.05 &&
            box.right <= label.pageEnd.x + 0.05 &&
            box.top > label.pagePoint.y &&
            box.top - label.pagePoint.y < 2,
        )
      if (!onRail && !onRow && !underline) return finish('ambiguous-native-table-grid')
    }
    const header = cells[0] as Label[][]
    const headerAllowed = [
      (label: Label) => numberHeading.test(label.name) || label.name === 'п/п',
      (label: Label) => nameHeading.test(label.name),
      (label: Label) =>
        areaHeading.test(label.name) || /^(?:[мm][²2]|[мm]|²|2)$/iu.test(label.name),
    ]
    if (
      header.some((cell, index) =>
        cell.some((label) => label.rotation !== 0 || !headerAllowed[index]?.(label)),
      )
    )
      return finish('unsupported-or-ambiguous-room-table')
    if ((header[0]?.length ?? 0) > 2 || header[1]?.length !== 1 || (header[2]?.length ?? 0) > 3)
      return finish('unsupported-or-ambiguous-room-table')
    const optionalNumber = header[0]?.filter((label) => !numberHeading.test(label.name)) ?? []
    const optionalArea = header[2]?.filter((label) => !areaHeading.test(label.name)) ?? []
    if (
      optionalNumber.length > 1 ||
      new Set(optionalArea.map((label) => label.name.toLocaleLowerCase('ru'))).size !==
        optionalArea.length ||
      (optionalArea.length === 1 && !/^[мm][²2]$/iu.test(optionalArea[0]?.name ?? '')) ||
      (optionalArea.length === 2 && !optionalArea.some((label) => /^[мm]$/iu.test(label.name))) ||
      (optionalArea.length === 2 && !optionalArea.some((label) => /^(?:²|2)$/u.test(label.name)))
    )
      return finish('unsupported-or-ambiguous-room-table')
    rows = []
    for (let index = 1; index < cells.length; index++) {
      const row = cells[index] as Label[][]
      const parsedArea = areaParts(row[2] ?? [])
      const number = row[0]?.[0],
        name = row[1]?.[0],
        area = parsedArea?.area
      if (row.flat().some((label) => !horizontalLabel(label)) || !area)
        return finish('unsupported-or-ambiguous-room-table')
      if (row[0]?.length === 0 && row[1]?.length === 0 && index === cells.length - 1) {
        const total = Number(area.name.replace(/\s*[мm]²?$/iu, '').replace(',', '.'))
        const sum = rows.reduce((value, item) => value + item.documentaryAreaM2, 0)
        if (Math.round(total * 100) !== Math.round(sum * 100))
          return finish('unsupported-or-ambiguous-room-table')
        continue
      }
      if (row[1]?.length !== 1 || !name) return finish('unsupported-or-ambiguous-room-table')
      if (totalName.test(name.name)) {
        const total = Number(area.name.replace(/\s*[мm]²?$/iu, '').replace(',', '.'))
        if (
          !Number.isFinite(total) ||
          total <= 0 ||
          row[0]?.length !== 0 ||
          index !== cells.length - 1
        )
          return finish('unsupported-or-ambiguous-room-table')
        continue
      }
      if (
        row[0]?.length !== 1 ||
        !number ||
        !/^0?[1-9]\d?(?:\.\d{1,3})?$/u.test(number.name) ||
        (number.name.includes('.') && String(Number(number.name)) !== number.name) ||
        !isPlanRoomSourceNumber(Number(number.name)) ||
        !isRoomName(name.name) ||
        !planRoomSourceNumbersInScheduleOrder([
          ...rows.map((row) => row.sourceNumber),
          Number(number.name),
        ])
      )
        return finish('unsupported-or-ambiguous-room-table')
      const documentaryAreaM2 = Number(area.name.replace(/\s*[мm]²?$/iu, '').replace(',', '.'))
      if (!Number.isFinite(documentaryAreaM2) || documentaryAreaM2 <= 0)
        return finish('unsupported-or-ambiguous-room-table')
      rows.push({
        sourceNumber: Number(number.name),
        name: name.name,
        documentaryAreaM2,
        numberLabelId: number.id,
        nameLabelId: name.id,
        areaLabelId: area.id,
        ...(parsedArea?.unit ? { areaUnitLabelId: parsedArea.unit.id } : {}),
      })
    }
    if (rows.length < 3 || rows.length > 50) return finish('unsupported-or-ambiguous-room-table')
    tableBounds = grid.bounds
    tableEdges = grid.edges
    headerLabelIds = header.flat().map((label) => label.id)
    layoutBasis = 'exact-native-grid'
    return finish(null)
  } catch (error) {
    if (error === workLimit) return finish('native-table-work-limit')
    throw error
  }
}
