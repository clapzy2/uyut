import type { LayoutWall } from './layout'

export type WallReservationKind = 'door' | 'window' | 'balcony' | 'radiator' | 'ventilation'

/** Участок стены, который нельзя занимать мебелью, и зона доступа перед ним. */
export type WallReservation = {
  kind: WallReservationKind
  wall: LayoutWall
  fromCm: number
  toCm: number
  /** Глубина свободной зоны внутрь комнаты; нужна дверям и балконным выходам. */
  clearanceCm: number
  /** Если высота мебели ниже подоконника, участок стены под окном можно использовать. */
  sillHeightCm?: number
}

function kindOf(text: string): WallReservationKind | null {
  if (/(балкон|лоджи)/i.test(text)) return 'balcony'
  if (/(двер|вход|про[её]м)/i.test(text)) return 'door'
  if (/(батар|радиатор)/i.test(text)) return 'radiator'
  if (/(окн)/i.test(text)) return 'window'
  if (/(вентиляц|вентканал)/i.test(text)) return 'ventilation'
  return null
}

function wallOf(text: string): LayoutWall | null {
  // «Дверь слева у нижнего угла» — это левая стена, а «нижнего» задаёт только край.
  // Убираем уточнение угла, прежде чем искать саму сторону стены.
  const wallText = text.replace(
    /(?:у|возле)\s*(?:верхн|нижн|лев|прав)[а-яёa-z]*\s*угл[а-яёa-z]*/gi,
    '',
  )
  const matches = (
    [
      ['bottom', /нижн|снизу|bottom/i],
      ['top', /верхн|сверху|top/i],
      ['left', /лев|слева|left/i],
      ['right', /прав|справа|right/i],
    ] as const
  ).filter(([, pattern]) => pattern.test(wallText))
  return matches.length === 1 ? (matches[0]?.[0] ?? null) : null
}

function explicitWidth(text: string): number | null {
  const match =
    text.match(/ширин[а-яёa-z]*\s*(\d+(?:[.,]\d+)?)\s*(?:см|cm)(?![а-яёa-z])/i) ??
    (/высот|глубин|отступ|подокон|расстояни|длин|(?:от|до)\s*\d/i.test(text)
      ? null
      : text.match(/(\d+(?:[.,]\d+)?)\s*(?:см|cm)(?![а-яёa-z])/i))
  if (!match) return null
  const width = Number(match[1]?.replace(',', '.'))
  return Number.isFinite(width) && width > 0 ? width : null
}

function positionOf(text: string, wall: LayoutWall): 'start' | 'center' | 'end' | null {
  const corner = text.match(/(?:у|возле)\s*(верхн|нижн|лев|прав)[а-яёa-z]*\s*угл/i)?.[1]
  if (!corner) {
    if (/(?:^|\s)не\s+(?:(?:по|в)\s+)?(?:центр|середин|посередин)/i.test(text)) return null
    return /центр|посередин|середин/i.test(text) ? 'center' : null
  }
  if (wall === 'top' || wall === 'bottom') {
    if (corner.startsWith('лев')) return 'start'
    if (corner.startsWith('прав')) return 'end'
  } else {
    if (corner.startsWith('верх')) return 'start'
    if (corner.startsWith('ниж')) return 'end'
  }
  return null
}

type WallReservationDescription = {
  reservations: WallReservation[]
  missingSafetyData: string[]
}

const LABELS: Record<WallReservationKind, string> = {
  door: 'Дверь',
  window: 'Окно',
  balcony: 'Балконный выход',
  radiator: 'Радиатор',
  ventilation: 'Вентиляция',
}

function descriptions(notes: string): string[] {
  const result: string[] = []
  // Preserve decimal commas and join a following width/range to its opening.
  for (const clause of notes.split(
    /(?<!\d)[,.]|[,.](?!\d)|[;\n]|\s+и\s+(?=(?:двер|вход|про[её]м|окн|балкон|лоджи|радиатор|батар|вентиляц|вентканал))/i,
  )) {
    const previous = result[result.length - 1]
    if (previous && !kindOf(clause) && /^\s*(?:ширин|от\s*\d)/i.test(clause)) {
      result[result.length - 1] = `${previous} ${clause}`
    } else if (clause.trim()) {
      result.push(clause.trim())
    }
  }
  return result
}

function explicitlyAbsent(text: string): boolean {
  return (
    /(?:^|\s)(?:нет|без)\s+(?:двер|вход|про[её]м|окон|окн|балкон|радиатор|батар|вентиляц)/i.test(
      text,
    ) ||
    /(?:двер|вход|про[её]м|окон|окн|балкон|радиатор|батар|вентиляц)[^;.!]*\sнет\s*$/i.test(text)
  )
}

/** Text can supply a draft opening, but missing dimensions and positions remain unknown. */
export function parseWallReservationDescription(
  notes: string | null | undefined,
  room: { widthCm: number; depthCm: number },
): WallReservationDescription {
  const reservations: WallReservation[] = []
  const missingSafetyData: string[] = []
  if (!notes?.trim()) return { reservations, missingSafetyData }
  let lastWindowWall: LayoutWall | null = null
  for (const clause of descriptions(notes)) {
    const kind = kindOf(clause)
    if (!kind) continue
    if (explicitlyAbsent(clause)) continue
    const label = LABELS[kind]
    const wall: LayoutWall | null =
      wallOf(clause) ?? (kind === 'radiator' && /под\s+окн/i.test(clause) ? lastWindowWall : null)
    if (!wall) {
      missingSafetyData.push(`${label}: укажите одну однозначную стену в описании.`)
      continue
    }
    if (kind === 'window') lastWindowWall = wall
    const wallLength = wall === 'top' || wall === 'bottom' ? room.widthCm : room.depthCm
    const range = clause.match(
      /от\s*(\d+(?:[.,]\d+)?)\s*(?:см|cm)?\s*до\s*(\d+(?:[.,]\d+)?)\s*(?:см|cm)/i,
    )
    const rangeStart = range ? Number(range[1]?.replace(',', '.')) : undefined
    const rangeEnd = range ? Number(range[2]?.replace(',', '.')) : undefined
    const widthText = range ? clause.replace(range[0], '') : clause
    const statedWidth = explicitWidth(widthText)
    const width =
      statedWidth ??
      (rangeStart !== undefined && rangeEnd !== undefined ? rangeEnd - rangeStart : null)
    const position = positionOf(clause, wall)
    if (width === null || (position === null && !range)) {
      missingSafetyData.push(
        `${label}: укажите ${width === null ? 'ширину и положение' : 'положение'} на стене; типовые размеры и положение по центру не подставляются.`,
      )
      continue
    }
    const fromCm =
      rangeStart ??
      (position === 'start'
        ? 0
        : position === 'end'
          ? wallLength - width
          : (wallLength - width) / 2)
    const toCm = fromCm + width
    if (
      !Number.isFinite(wallLength) ||
      wallLength <= 0 ||
      width <= 0 ||
      fromCm < 0 ||
      toCm > wallLength ||
      (rangeEnd !== undefined && Math.abs(rangeEnd - toCm) > 1e-7)
    ) {
      missingSafetyData.push(
        `${label}: ширина или положение противоречат указанному участку стены. Уточните описание.`,
      )
      continue
    }
    reservations.push({
      kind,
      wall,
      fromCm,
      toCm,
      clearanceCm: kind === 'door' || kind === 'balcony' ? 90 : 0,
    })
    if (kind === 'door' || kind === 'balcony') {
      missingSafetyData.push(
        `${label}: для открывания использован предварительный запас 90 см, а не обмер створки. Уточните направление и свободную зону открывания.`,
      )
    }
  }
  return { reservations, missingSafetyData }
}

/** Compatibility API: returns only openings with explicit dimensions and positions. */
export function parseWallReservations(
  notes: string | null | undefined,
  room: { widthCm: number; depthCm: number },
): WallReservation[] {
  return parseWallReservationDescription(notes, room).reservations
}
