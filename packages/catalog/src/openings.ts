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
}

const DEFAULT_WIDTH: Record<WallReservationKind, number> = {
  door: 90,
  window: 120,
  balcony: 160,
  radiator: 120,
  ventilation: 60,
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
  if (/(нижн|снизу|bottom)/i.test(wallText)) return 'bottom'
  if (/(верхн|сверху|top)/i.test(wallText)) return 'top'
  if (/(лев|слева|left)/i.test(wallText)) return 'left'
  if (/(прав|справа|right)/i.test(wallText)) return 'right'
  return null
}

function explicitWidth(text: string): number | null {
  const match = text.match(/(?:ширин[а-яёa-z]*\s*)?(\d{2,3})\s*(?:см|cm)(?![а-яёa-z])/i)
  if (!match) return null
  const width = Number(match[1])
  return width >= 40 && width <= 300 ? width : null
}

function positionOf(text: string, wall: LayoutWall): 'start' | 'center' | 'end' {
  const corner = text.match(/(?:у|возле)\s*(верхн|нижн|лев|прав)[а-яёa-z]*\s*угл/i)?.[1]
  if (!corner) return 'center'
  if (wall === 'top' || wall === 'bottom') {
    if (corner.startsWith('лев')) return 'start'
    if (corner.startsWith('прав')) return 'end'
  } else {
    if (corner.startsWith('верх')) return 'start'
    if (corner.startsWith('ниж')) return 'end'
  }
  return 'center'
}

/**
 * Извлекает только уверенно описанные проёмы. Если сторона стены не названа, ничего не угадываем.
 * Размер без числа берём консервативный типовой, а в интерфейсе всё равно показываем, что это
 * участок из текстового описания, не исполнительный чертёж.
 */
export function parseWallReservations(
  notes: string | null | undefined,
  room: { widthCm: number; depthCm: number },
): WallReservation[] {
  if (!notes?.trim()) return []
  const result: WallReservation[] = []
  let lastWindowWall: LayoutWall | null = null
  for (const clause of notes.split(/[,;.\n]+/)) {
    const kind = kindOf(clause)
    if (!kind) continue
    const wall: LayoutWall | null =
      wallOf(clause) ?? (kind === 'radiator' && /под\s+окн/i.test(clause) ? lastWindowWall : null)
    if (!wall) continue
    if (kind === 'window') lastWindowWall = wall
    const wallLength = wall === 'top' || wall === 'bottom' ? room.widthCm : room.depthCm
    const width = Math.min(wallLength, explicitWidth(clause) ?? DEFAULT_WIDTH[kind])
    const position = positionOf(clause, wall)
    const fromCm =
      position === 'start' ? 0 : position === 'end' ? wallLength - width : (wallLength - width) / 2
    result.push({
      kind,
      wall,
      fromCm: Math.round(Math.max(0, fromCm)),
      toCm: Math.round(Math.min(wallLength, fromCm + width)),
      clearanceCm: kind === 'door' || kind === 'balcony' ? 90 : 0,
    })
  }
  return result
}
