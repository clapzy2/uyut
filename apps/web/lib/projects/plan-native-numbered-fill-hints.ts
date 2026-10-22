import type { NativeTextAnchors } from './plan-document'
import type { nativeFillCandidates } from './plan-native-fill-candidates'
import type { nativeRoomScheduleEvidence } from './plan-native-room-schedule'
import type { PagePoint } from './plan-pdf-linework'
import { pdfPointInside } from './plan-pdf-room-binding'

type FillInventory = ReturnType<typeof nativeFillCandidates>
type RoomSchedule = ReturnType<typeof nativeRoomScheduleEvidence>

/** Both PDF page axes must independently agree before a painted area gets metric context. */
export function printedDimensionScale(
  candidates: readonly { valueMm: number; spanEnds: readonly [PagePoint, PagePoint] }[],
  pageWidth: number,
  pageHeight: number,
) {
  if (
    !Number.isFinite(pageWidth) ||
    !Number.isFinite(pageHeight) ||
    pageWidth <= 0 ||
    pageHeight <= 0
  )
    return null
  const axisValues = { x: [] as number[], y: [] as number[] }
  for (const candidate of candidates) {
    const [a, b] = candidate.spanEnds
    const dx = Math.abs(b.x - a.x)
    const dy = Math.abs(b.y - a.y)
    const major = Math.max(dx, dy)
    const minor = Math.min(dx, dy)
    if (
      !Number.isFinite(candidate.valueMm) ||
      candidate.valueMm <= 0 ||
      !major ||
      minor > major * 0.01
    )
      continue
    axisValues[dx > dy ? 'x' : 'y'].push(candidate.valueMm / major)
  }
  const median = (values: number[]) => {
    const sorted = [...values].sort((a, b) => a - b)
    return sorted[Math.floor(sorted.length / 2)]
  }
  const x = median(axisValues.x)
  const y = median(axisValues.y)
  if (!x || !y || axisValues.x.length < 2 || axisValues.y.length < 2) return null
  const spread = (values: number[], center: number) =>
    (Math.max(...values) - Math.min(...values)) / center
  const pdfPointGap = Math.abs((x * 1000) / pageWidth - (y * 1000) / pageHeight)
  const smallestPdfScale = Math.min((x * 1000) / pageWidth, (y * 1000) / pageHeight)
  if (
    spread(axisValues.x, x) > 0.01 ||
    spread(axisValues.y, y) > 0.01 ||
    pdfPointGap / smallestPdfScale > 0.005
  )
    return null
  return { xMmPerUnit: x, yMmPerUnit: y }
}

export function calibratedFillAreaM2(
  polygon: readonly PagePoint[],
  scale: {
    xMmPerUnit: number
    yMmPerUnit: number
  },
) {
  const twiceArea = polygon.reduce((sum, point, index) => {
    const next = polygon[(index + 1) % polygon.length]
    return next ? sum + point.x * next.y - next.x * point.y : sum
  }, 0)
  return (Math.abs(twiceArea) * scale.xMmPerUnit * scale.yMmPerUnit) / 2_000_000
}

/** Diagnostic proximity only: a printed number inside PDF paint is not a floor boundary. */
export function nativeNumberedFillHints(input: {
  native: NativeTextAnchors
  inventory: FillInventory
  schedule: RoomSchedule
}) {
  const { native, inventory, schedule } = input
  const empty = () => ({ status: 'held' as const, rows: [] })
  if (
    inventory.refusalReason ||
    inventory.truncated ||
    inventory.originalPdfSha256 !== native.originalPdfSha256 ||
    inventory.source.sha256 !== native.source.sha256 ||
    inventory.source.page !== native.source.page ||
    schedule.reason ||
    !schedule.tableBounds ||
    schedule.originalPdfSha256 !== native.originalPdfSha256 ||
    schedule.source.sha256 !== native.source.sha256 ||
    schedule.source.page !== native.source.page
  )
    return empty()

  const tableIds = new Set([
    ...schedule.headerLabelIds,
    ...schedule.rows.flatMap((row) => [
      row.numberLabelId,
      row.nameLabelId,
      row.areaLabelId,
      ...(row.areaUnitLabelId ? [row.areaUnitLabelId] : []),
    ]),
  ])
  const table = schedule.tableBounds
  const labels = native.labels.filter((label) => label.pagePoint)
  const outsideTable = labels.filter((label) => {
    const point = label.pagePoint
    return (
      point &&
      !tableIds.has(label.id) &&
      (point.x < table.left ||
        point.x > table.right ||
        point.y < table.top ||
        point.y > table.bottom)
    )
  })
  const superscriptTwo = (label: (typeof labels)[number]) =>
    label.name === '2' &&
    outsideTable.some((other) => {
      const point = label.pagePoint
      const preceding = other.pagePoint
      return (
        point &&
        preceding &&
        /[мm]\s*$/iu.test(other.name) &&
        Math.abs(point.y - preceding.y) <= 5 &&
        point.x > preceding.x &&
        point.x - preceding.x < 45
      )
    })
  const markers = outsideTable.filter(
    (label) => /^\d{1,2}$/u.test(label.name) && !superscriptTwo(label),
  )
  const sourceNumbers = new Set(schedule.rows.map((row) => row.sourceNumber))
  const singleRoomFills = inventory.candidates.filter((fill) => {
    const numbersInside = new Set(
      markers
        .filter(
          (label) =>
            label.pagePoint &&
            sourceNumbers.has(Number(label.name)) &&
            pdfPointInside(label.pagePoint, fill.polygon),
        )
        .map((label) => Number(label.name)),
    )
    return numbersInside.size <= 1
  })

  return {
    status: 'diagnostic' as const,
    rows: schedule.rows.map((row) => {
      const matches = markers
        .filter((label) => Number(label.name) === row.sourceNumber)
        .map((label) => ({
          labelId: label.id,
          fillIds: singleRoomFills
            .filter((fill) => label.pagePoint && pdfPointInside(label.pagePoint, fill.polygon))
            .map((fill) => fill.id),
        }))
        .filter((match) => match.fillIds.length > 0)
      return {
        sourceNumber: row.sourceNumber,
        name: row.name,
        markerLabelIds: matches.map((match) => match.labelId),
        fillIds: [...new Set(matches.flatMap((match) => match.fillIds))],
        // Extra same-number text elsewhere prevents a unique marker claim.
        otherSameNumberLabels:
          markers.filter((label) => Number(label.name) === row.sourceNumber).length -
          matches.length,
      }
    }),
  }
}
