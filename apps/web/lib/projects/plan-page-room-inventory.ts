import { planMeasurementTextItems } from '@uyut/ai'

export type SourceRoom = { sourceNumber: number; name: string }

/** Numbered room rows from the same PDF page, with no inferred gaps. */
export function planPageRoomInventory(planText: string | undefined): SourceRoom[] | undefined {
  const items = planMeasurementTextItems(planText)
  if (!items) return undefined
  const headings = items.filter(
    (item) =>
      /экспликаци[яи]\s+помещен/i.test(item.text) &&
      Number.isFinite(item.x) &&
      Number.isFinite(item.y) &&
      item.rotation === 0,
  )
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
  const numbered = aligned.filter((item) => /^\s*\d{1,2}\s*[-–—.]/u.test(item.text))
  const rows = numbered
    .flatMap((item) => {
      const match =
        /^\s*(\d{1,2})\s*[-–—.]\s*(.{1,80}?)\s*[-–—]\s*\d{1,3}[,.]\d{1,2}\s*[мm]/iu.exec(item.text)
      return match?.[1] && match[2] && item.y !== undefined
        ? [{ sourceNumber: Number(match[1]), name: match[2].trim(), y: item.y }]
        : []
    })
    .sort((left, right) => left.y - right.y)

  if (rows.length < 3 || rows.length > 50 || rows.length !== numbered.length) return undefined
  if (rows.some((row, index) => row.sourceNumber !== index + 1 || !row.name)) return undefined
  return rows.map(({ sourceNumber, name }) => ({ sourceNumber, name }))
}
