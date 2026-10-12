import {
  isPlanRoomSourceNumber,
  planRoomSourceNumbersInScheduleOrder,
} from '@uyut/db/source-room-number'
import type { PlanMeasurementTextItem } from './floor-plan-measurements'

type ScheduleRoom = { name: string; areaM2: number }
export type PlanTabularRoomEvidence = ScheduleRoom & {
  /** Positions in the caller's items array, not original PDF text indexes. */
  numberItemIndex: number
  nameItemIndex: number
  areaItemIndex: number
}

function combinedScheduleRows(
  items: readonly (PlanMeasurementTextItem & { x: number; y: number })[],
  heading: PlanMeasurementTextItem & { x: number; y: number },
): Map<number, ScheduleRoom> | undefined {
  const aligned = items.filter(
    (item) => item.rotation === 0 && item.y > heading.y && Math.abs(item.x - heading.x) <= 30,
  )
  const numbered = aligned.filter((item) => /^\s*\d+(?:[.,]\d+)?\s*[-–—.]/u.test(item.text))
  const rows = numbered
    .flatMap((item) => {
      const match =
        /^\s*(\d{1,2}(?:\.\d{1,3})?)\s*(?:[-–—]|\.(?!\d))\s*(.{1,80}?)\s*[-–—]\s*(\d{1,3}[,.]\d{1,2})\s*[мm]/iu.exec(
          item.text,
        )
      if (!match?.[1] || !match[2] || !match[3]) return []
      const numberText = match[1]
      const separator = item.text.trimStart().slice(numberText.length).trimStart()
      if (
        numberText.includes('.') &&
        (String(Number(numberText)) !== numberText || separator.startsWith('.'))
      )
        return []
      return [
        {
          number: Number(numberText),
          name: match[2].trim(),
          areaM2: Number(match[3].replace(',', '.')),
          y: item.y,
        },
      ]
    })
    .sort((left, right) => left.y - right.y)
  if (rows.length < 2 || rows.length !== numbered.length) return undefined
  if (
    !planRoomSourceNumbersInScheduleOrder(rows.map((row) => row.number)) ||
    rows.some((row) => !row.name || row.areaM2 <= 0)
  )
    return undefined
  return new Map(rows.map((row) => [row.number, { name: row.name, areaM2: row.areaM2 }]))
}

function positioned(
  item: PlanMeasurementTextItem,
): item is PlanMeasurementTextItem & { x: number; y: number } {
  return (
    typeof item.x === 'number' &&
    typeof item.y === 'number' &&
    Number.isFinite(item.x) &&
    Number.isFinite(item.y) &&
    item.x >= 0 &&
    item.x <= 1000 &&
    item.y >= 0 &&
    item.y <= 1000
  )
}

export function planTabularScheduleEvidence(
  raw: readonly PlanMeasurementTextItem[] | undefined,
): Map<number, PlanTabularRoomEvidence> | undefined {
  if (!raw) return undefined
  const items = raw.flatMap((item, inputIndex) =>
    positioned(item) ? [{ ...item, inputIndex }] : [],
  )
  const header = (text: string) =>
    items.filter((item) => item.rotation === 0 && item.text.trim().toLocaleLowerCase('ru') === text)
  const numbers = header('№')
  const names = header('наименование')
  const areas = header('площадь')
  if (numbers.length !== 1 || names.length !== 1 || areas.length !== 1) return undefined

  const numberHeader = numbers[0]
  const nameHeader = names[0]
  const areaHeader = areas[0]
  if (!numberHeader || !nameHeader || !areaHeader) return undefined
  if (
    Math.abs(numberHeader.y - nameHeader.y) > 2 ||
    Math.abs(numberHeader.y - areaHeader.y) > 2 ||
    nameHeader.x - numberHeader.x < 12 ||
    areaHeader.x - nameHeader.x < 40
  )
    return undefined

  const numericRows = items
    .filter(
      (item) =>
        item.rotation === 0 &&
        Math.abs(item.x - numberHeader.x) <= 15 &&
        item.y > numberHeader.y &&
        /^\d+(?:[.,]\d+)?$/.test(item.text.trim()),
    )
    .sort((left, right) => left.y - right.y)
  if (
    numericRows.some(
      (item) =>
        !/^0?[1-9]\d?(?:\.\d{1,3})?$/.test(item.text.trim()) ||
        !isPlanRoomSourceNumber(Number(item.text)) ||
        (item.text.includes('.') && String(Number(item.text)) !== item.text.trim()),
    )
  )
    return undefined
  const rowNumbers = numericRows
  if (rowNumbers.length < 3 || rowNumbers.length > 50) return undefined

  const rooms: Array<{ number: number; room: PlanTabularRoomEvidence }> = []
  for (const rowNumber of rowNumbers) {
    const sameLine = items.filter(
      (item) => item.rotation === 0 && Math.abs(item.y - rowNumber.y) <= 2,
    )
    const rowNames = sameLine.filter(
      (item) =>
        item.x > numberHeader.x + 8 &&
        item.x < areaHeader.x - 15 &&
        item.text.trim().length > 0 &&
        item.text.trim().length <= 80 &&
        !/^\d+[,.]?\d*$/.test(item.text.trim()),
    )
    const rowAreas = sameLine.filter(
      (item) =>
        Math.abs(item.x - areaHeader.x) <= 40 &&
        /^\d{1,3}[,.]\d{1,2}(?:\s*м²)?$/iu.test(item.text.trim()),
    )
    if (rowNames.length !== 1 || rowAreas.length !== 1) return undefined
    const name = rowNames[0]?.text.trim()
    const areaText = rowAreas[0]?.text.trim()
    if (!name || !areaText) return undefined
    const areaM2 = Number(areaText.replace(/\s*м²$/iu, '').replace(',', '.'))
    if (areaM2 <= 0) return undefined
    const nameItem = rowNames[0],
      areaItem = rowAreas[0]
    if (!nameItem || !areaItem) return undefined
    rooms.push({
      number: Number(rowNumber.text),
      room: {
        name,
        areaM2,
        numberItemIndex: rowNumber.inputIndex,
        nameItemIndex: nameItem.inputIndex,
        areaItemIndex: areaItem.inputIndex,
      },
    })
  }
  if (!planRoomSourceNumbersInScheduleOrder(rooms.map((row) => row.number))) return undefined
  return new Map(rooms.map(({ number, room }) => [number, room]))
}

function tabularScheduleRows(
  items: readonly (PlanMeasurementTextItem & { x: number; y: number })[],
): Map<number, ScheduleRoom> | undefined {
  const evidence = planTabularScheduleEvidence(items)
  return evidence
    ? new Map(
        [...evidence].map(([number, room]) => [number, { name: room.name, areaM2: room.areaM2 }]),
      )
    : undefined
}

/** Two independently qualified printed totals can differ in scope; never choose between them. */
export function planTotalAreaConflict(
  items: readonly PlanMeasurementTextItem[] | undefined,
): { scheduleAreaM2: number; apartmentAreaM2: number } | undefined {
  const table = planTabularScheduleEvidence(items)
  if (!items || !table) return undefined
  const rows = [...table.values()]
    .flatMap((row) => {
      const item = items[row.areaItemIndex]
      return item && positioned(item) ? [item] : []
    })
    .sort((left, right) => left.y - right.y)
  const last = rows.at(-1)
  const previous = rows.at(-2)
  const header = items.find(
    (item) =>
      positioned(item) &&
      item.rotation === 0 &&
      item.text.trim().toLocaleLowerCase('ru') === 'площадь',
  )
  if (!last || !previous || !header || !positioned(header)) return undefined
  const rowStep = last.y - previous.y
  if (rowStep <= 2) return undefined

  const quantity = String.raw`(\d{1,4}(?:[,.]\d{1,2})?)`
  const unit = String.raw`(?:м[²2]|кв\.\s*м\.?)`
  const footerPattern = new RegExp(String.raw`^(?:итого\s*[:=]?\s*)?${quantity}\s*${unit}$`, 'iu')
  const numericPattern = new RegExp(
    String.raw`^(?:итого\s*[:=]?\s*)?${quantity}(?:\s*${unit})?$`,
    'iu',
  )
  const footers = items.filter(
    (item) =>
      positioned(item) &&
      item.rotation === 0 &&
      item.y > last.y + 2 &&
      item.y <= last.y + rowStep * 1.5 &&
      Math.abs(item.x - header.x) <= 40 &&
      numericPattern.test(item.text.trim()),
  )
  const footer = footers.length === 1 ? footers[0] : undefined
  const footerMatch = footer?.text.trim().match(footerPattern)
  if (!footer || !positioned(footer) || !footerMatch?.[1]) return undefined
  const firstRow = [...table.values()][0]
  const number = firstRow && items[firstRow.numberItemIndex]
  if (!number || !positioned(number)) return undefined
  // A unit-bearing room row is not a table total. Allow only an explicit total caption on its left.
  if (
    items.some(
      (item) =>
        positioned(item) &&
        item.rotation === 0 &&
        item.x >= number.x - 15 &&
        item.x < header.x - 15 &&
        Math.abs(item.y - footer.y) <= 2 &&
        item.text.trim() !== '' &&
        !/^(?:итого|всего)\s*:?$/iu.test(item.text.trim()),
    )
  ) {
    return undefined
  }

  const apartmentPattern = new RegExp(
    String.raw`^(?:объект\s+по\s+адресу\s*:[^\n]{1,200}[,;]\s*)?(?:квартира|(?:общая\s+)?площадь\s+квартиры)\s*[:=]?\s*${quantity}\s*${unit}\s*[.;]?\s*$`,
    'iu',
  )
  const apartmentAreas = new Set(
    items.flatMap((item) => {
      if (!positioned(item) || item.rotation !== 0) return []
      const match = item.text.trim().match(apartmentPattern)
      return match?.[1] ? [Number(match[1].replace(',', '.'))] : []
    }),
  )
  const apartmentAreaM2 = apartmentAreas.size === 1 ? [...apartmentAreas][0] : undefined
  const scheduleAreaM2 = Number(footerMatch[1].replace(',', '.'))
  if (
    apartmentAreaM2 === undefined ||
    apartmentAreaM2 <= 0 ||
    scheduleAreaM2 <= 0 ||
    Math.abs(apartmentAreaM2 - scheduleAreaM2) <= 0.005
  ) {
    return undefined
  }
  return { scheduleAreaM2, apartmentAreaM2 }
}

/** Только явная экспликация или нумерованная таблица помещений с проверенными колонками. */
export function planRoomSchedule(
  items: readonly PlanMeasurementTextItem[] | undefined,
): Map<number, ScheduleRoom> | undefined {
  if (!items) return undefined
  const located = items.filter(positioned)
  const headings = located.filter((item) => /экспликац.*помещен/iu.test(item.text))
  if (headings.length === 0) return tabularScheduleRows(located)
  if (headings.length !== 1) return undefined
  const heading = headings[0]
  if (!heading) return undefined
  const roomName =
    /^(?:прихожая|кухня(?:[- ]гостиная)?|гостиная|спальня|коридор|ванная|санузел|комната|детская|кабинет|гардероб|гардеробная|кладовая)(?:\s+\d+)?$/iu
  const rows: Array<{
    number: number
    name: string
    areaM2: number
    columns: [number, number, number]
  }> = []
  for (const name of located) {
    if (name.y <= heading.y || !roomName.test(name.text.trim())) continue
    const aligned = located.filter((item) => Math.abs(item.y - name.y) <= 2)
    const numbers = aligned.filter(
      (item) => item.x < name.x && /^\d+(?:[.,]\d+)?$/.test(item.text.trim()),
    )
    const areas = aligned.filter(
      (item) => item.x > name.x && /^\d{1,3}[.,]\d{1,2}$/.test(item.text),
    )
    if (numbers.length !== 1 || areas.length !== 1) continue
    const number = numbers[0]
    const area = areas[0]
    if (!number || !area) continue
    if (
      !/^[1-9]\d{0,2}(?:\.\d{1,3})?$/.test(number.text.trim()) ||
      !isPlanRoomSourceNumber(Number(number.text)) ||
      String(Number(number.text)) !== number.text.trim()
    )
      return undefined
    const areaM2 = Number(area.text.replace(',', '.'))
    if (areaM2 <= 0) continue
    rows.push({
      number: Number(number.text),
      name: name.text.trim(),
      areaM2,
      columns: [number.x, name.x, area.x],
    })
  }
  const first = rows[0]
  if (!first || rows.length < 2) return combinedScheduleRows(located, heading)
  // Не соединяем строки разных таблиц или подписи внутри самой планировки.
  if (
    rows.some((row) =>
      ([0, 1, 2] as const).some((index) => Math.abs(row.columns[index] - first.columns[index]) > 5),
    )
  )
    return undefined
  if (new Set(rows.map((row) => row.number)).size !== rows.length) return undefined
  // Whole-room rows in this legacy heading profile may be a partial printed
  // inventory. A subroom must still follow its literal parent, never a guessed one.
  for (const [index, row] of rows.entries()) {
    if (Number.isInteger(row.number)) continue
    const precedingParent = rows.slice(0, index).findLast((row) => Number.isInteger(row.number))
    if (precedingParent?.number !== Math.floor(row.number)) return undefined
  }
  return new Map(rows.map((row) => [row.number, { name: row.name, areaM2: row.areaM2 }]))
}

export function scheduleRoomNameMatches(
  name: string,
  sourceNumber: number,
  expected: string,
): boolean {
  const normalize = (value: string) => value.trim().toLocaleLowerCase('ru').replaceAll('ё', 'е')
  const candidate = normalize(name)
  const canonical = normalize(expected)
  return candidate === canonical || candidate === `${canonical} ${sourceNumber}`
}
