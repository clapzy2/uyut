import type { PlanMeasurementTextItem } from './floor-plan-measurements'

type ScheduleRoom = { name: string; areaM2: number }

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

/** Только явно озаглавленная таблица с несколькими строками в одинаковых колонках. */
export function planRoomSchedule(
  items: readonly PlanMeasurementTextItem[] | undefined,
): Map<number, ScheduleRoom> | undefined {
  if (!items) return undefined
  const located = items.filter(positioned)
  const headings = located.filter((item) => /экспликац.*помещен/iu.test(item.text))
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
  if (!first || rows.length < 2) return undefined
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
