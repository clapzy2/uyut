import type { PlanMeasurementTextItem } from './floor-plan-measurements'

type ScheduleRoom = { name: string; areaM2: number }

function combinedScheduleRows(
  items: readonly (PlanMeasurementTextItem & { x: number; y: number })[],
  heading: PlanMeasurementTextItem & { x: number; y: number },
): Map<number, ScheduleRoom> | undefined {
  const aligned = items.filter(
    (item) => item.rotation === 0 && item.y > heading.y && Math.abs(item.x - heading.x) <= 30,
  )
  const numbered = aligned.filter((item) => /^\s*\d{1,2}\s*[-–—.]/u.test(item.text))
  const rows = numbered
    .flatMap((item) => {
      const match =
        /^\s*(\d{1,2})\s*[-–—.]\s*(.{1,80}?)\s*[-–—]\s*(\d{1,3}[,.]\d{1,2})\s*[мm]/iu.exec(
          item.text,
        )
      return match?.[1] && match[2] && match[3]
        ? [
            {
              number: Number(match[1]),
              name: match[2].trim(),
              areaM2: Number(match[3].replace(',', '.')),
              y: item.y,
            },
          ]
        : []
    })
    .sort((left, right) => left.y - right.y)
  if (rows.length < 2 || rows.length !== numbered.length) return undefined
  if (rows.some((row, index) => row.number !== index + 1 || !row.name || row.areaM2 <= 0))
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

function tabularScheduleRows(
  items: readonly (PlanMeasurementTextItem & { x: number; y: number })[],
): Map<number, ScheduleRoom> | undefined {
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

  const rowNumbers = items
    .filter(
      (item) =>
        item.rotation === 0 &&
        Math.abs(item.x - numberHeader.x) <= 15 &&
        item.y > numberHeader.y &&
        /^0?[1-9]\d?$/.test(item.text.trim()),
    )
    .sort((left, right) => left.y - right.y)
  if (rowNumbers.length < 3 || rowNumbers.length > 50) return undefined

  const rooms: Array<{ number: number; room: ScheduleRoom }> = []
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
    rooms.push({ number: Number(rowNumber.text), room: { name, areaM2 } })
  }
  if (rooms.some((row, index) => row.number !== index + 1)) return undefined
  return new Map(rooms.map(({ number, room }) => [number, room]))
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
    /^(?:прихожая|кухня(?:[- ]гостиная)?|гостиная|спальня|коридор|ванная|санузел|комната|детская|кабинет|гардеробная|кладовая)(?:\s+\d+)?$/iu
  const rows: Array<{
    number: number
    name: string
    areaM2: number
    columns: [number, number, number]
  }> = []
  for (const name of located) {
    if (name.y <= heading.y || !roomName.test(name.text.trim())) continue
    const aligned = located.filter((item) => Math.abs(item.y - name.y) <= 2)
    const numbers = aligned.filter((item) => item.x < name.x && /^[1-9]\d{0,2}$/.test(item.text))
    const areas = aligned.filter(
      (item) => item.x > name.x && /^\d{1,3}[.,]\d{1,2}$/.test(item.text),
    )
    if (numbers.length !== 1 || areas.length !== 1) continue
    const number = numbers[0]
    const area = areas[0]
    if (!number || !area) continue
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
