export type MarkerBox = { id: string; x: number; y: number; w: number; h: number }
export type MarkerPoint = { id: string; x: number; y: number }

/** Ближе этого метки читаются как одна: доля от ширины картинки */
const MIN_GAP = 0.06
/** На сколько отодвигаем за один шаг */
const STEP = 0.045
const MAX_ROUNDS = 12

/**
 * Точки для номерных меток на рендере.
 *
 * Метка ставится в середину найденного предмета, и у соседних предметов эти середины
 * сходятся в одну точку: кресло и тумба под столом стоят вплотную, кружки накладываются,
 * и выходит, будто один предмет назван двумя разными словами. Владелец так и прочитал:
 * «под цифрой пять кресло, а под единицей почему-то хранение».
 *
 * Поэтому расставляем: слипшиеся метки расходятся по кругу вокруг общего места, оставаясь
 * внутри картинки и рядом со своим предметом.
 */
export function spreadMarkers(boxes: readonly MarkerBox[]): MarkerPoint[] {
  const points = boxes.map((box) => ({
    id: box.id,
    x: box.x + box.w / 2,
    y: box.y + box.h / 2,
  }))
  for (let round = 0; round < MAX_ROUNDS; round += 1) {
    let moved = false
    for (let i = 0; i < points.length; i += 1) {
      for (let j = i + 1; j < points.length; j += 1) {
        const left = points[i] as MarkerPoint
        const right = points[j] as MarkerPoint
        const dx = right.x - left.x
        const dy = right.y - left.y
        const distance = Math.hypot(dx, dy)
        if (distance >= MIN_GAP) {
          continue
        }
        // Совпали точь-в-точь — расталкиваем по диагонали, иначе делить будет не на что
        const nx = distance === 0 ? 0.7 : dx / distance
        const ny = distance === 0 ? 0.7 : dy / distance
        left.x = clamp(left.x - nx * STEP)
        left.y = clamp(left.y - ny * STEP)
        right.x = clamp(right.x + nx * STEP)
        right.y = clamp(right.y + ny * STEP)
        moved = true
      }
    }
    if (!moved) {
      break
    }
  }
  return points
}

/** Метка не должна уехать за край картинки: отступ под её собственный размер */
function clamp(value: number): number {
  return Math.min(0.96, Math.max(0.04, value))
}
