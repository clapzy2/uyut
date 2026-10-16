import { planMeasurementTextItems, planRoomSchedule } from '@uyut/ai'
import {
  isPlanRoomSourceNumber,
  planRoomSourceNumbersInScheduleOrder,
} from '@uyut/db/source-room-number'
import type { preparePlanPage } from './plan-document'
import { nativeRoomScheduleEvidence } from './plan-native-room-schedule'

export type SourceRoom = { sourceNumber: number; name: string }

/** Numbered room rows from the same PDF page, with no inferred gaps. */
export function planPageRoomInventory(
  planText: string | undefined,
  page?: Pick<
    Awaited<ReturnType<typeof preparePlanPage>>,
    'nativeTextAnchors' | 'linework' | 'lineworkRasterSource'
  >,
): SourceRoom[] | undefined {
  if (page?.nativeTextAnchors && page.linework && page.lineworkRasterSource) {
    const schedule = nativeRoomScheduleEvidence({
      native: page.nativeTextAnchors,
      work: page.linework,
      lineworkSource: page.lineworkRasterSource,
    })
    if (schedule.status !== 'draft') return undefined
    return schedule.rows.map(({ sourceNumber, name }) => ({ sourceNumber, name }))
  }
  const items = planMeasurementTextItems(planText)
  if (!items) return undefined
  const headings = items.filter(
    (item) =>
      /экспликаци[яи]\s+помещен/i.test(item.text) &&
      Number.isFinite(item.x) &&
      Number.isFinite(item.y) &&
      item.rotation === 0,
  )
  if (headings.length === 0) {
    const schedule = planRoomSchedule(items)
    if (!schedule) return undefined
    return [...schedule].map(([sourceNumber, room]) => ({ sourceNumber, name: room.name }))
  }
  if (headings.length !== 1) return undefined
  const heading = headings[0]
  if (heading?.x === undefined || heading.y === undefined) return undefined
  const { x: headingX, y: headingY } = heading

  const aligned = items.filter(
    (item) =>
      item.x !== undefined &&
      item.y !== undefined &&
      item.rotation === 0 &&
      Math.abs(item.x - headingX) <= 30 &&
      item.y > headingY &&
      item.y <= 1000,
  )
  const numbered = aligned.filter((item) => /^\s*\d{1,5}(?:[.,]\d+)?\s*[-–—.]/u.test(item.text))
  const rows = numbered
    .flatMap((item) => {
      const match =
        /^\s*(\d{1,5}(?:\.\d{1,3})?)\s*[-–—]\s*(.{1,80}?)\s*[-–—]\s*\d{1,3}[,.]\d{1,2}\s*[мm]/iu.exec(
          item.text,
        ) ??
        /^\s*(\d{1,5})\s*\.\s*([^\d\s].{0,79}?)\s*[-–—]\s*\d{1,3}[,.]\d{1,2}\s*[мm]/iu.exec(
          item.text,
        )
      return match?.[1] &&
        match[2] &&
        item.y !== undefined &&
        (!match[1].includes('.') || String(Number(match[1])) === match[1])
        ? [{ sourceNumber: Number(match[1]), name: match[2].trim(), y: item.y }]
        : []
    })
    .sort((left, right) => left.y - right.y)

  if (rows.length < 3 || rows.length > 50 || rows.length !== numbered.length) return undefined
  if (
    rows.some((row) => !isPlanRoomSourceNumber(row.sourceNumber) || !row.name) ||
    !planRoomSourceNumbersInScheduleOrder(rows.map((row) => row.sourceNumber))
  )
    return undefined
  return rows.map(({ sourceNumber, name }) => ({ sourceNumber, name }))
}
