import { rectInsideFloor } from '@uyut/catalog/layout'
import type { PlanGeometry, PlanKitchenItem, PlanPoint } from '@uyut/db'
import { z } from 'zod'

export const kitchenItemsSchema = z
  .array(
    z.object({
      id: z.string().min(1).max(80),
      kind: z.enum(['sink', 'hob', 'oven', 'dishwasher', 'fridge', 'cabinet']),
      xCm: z.number().finite().min(0).max(10000),
      yCm: z.number().finite().min(0).max(10000),
      widthCm: z.number().finite().min(10).max(600),
      depthCm: z.number().finite().min(10).max(600),
      heightCm: z.number().finite().min(1).max(600).optional(),
      front: z.enum(['top', 'right', 'bottom', 'left']).optional(),
      openingDepthCm: z.number().finite().min(0).max(600).optional(),
      passageCm: z.number().finite().min(0).max(600).optional(),
      installationGaps: z
        .object({
          top: z.number().finite().min(0).max(100),
          right: z.number().finite().min(0).max(100),
          bottom: z.number().finite().min(0).max(100),
          left: z.number().finite().min(0).max(100),
        })
        .optional(),
    }),
  )
  .max(50)
  .refine(
    (items) => new Set(items.map((item) => item.id)).size === items.length,
    'У элементов должны быть разные идентификаторы',
  )

export const kitchenLabels: Record<PlanKitchenItem['kind'], string> = {
  sink: 'Мойка',
  hob: 'Плита',
  oven: 'Духовка',
  dishwasher: 'Посудомоечная машина',
  fridge: 'Холодильник',
  cabinet: 'Гарнитур',
}

export function kitchenItemIssues(
  items: readonly PlanKitchenItem[],
  widthCm: number,
  heightCm: number,
  geometry?: PlanGeometry,
) {
  const result: string[] = []
  for (const [index, item] of items.entries()) {
    if (
      item.xCm < 0 ||
      item.yCm < 0 ||
      item.xCm + item.widthCm > widthCm ||
      item.yCm + item.depthCm > heightCm
    ) {
      result.push(`${kitchenLabels[item.kind]} ${index + 1} выходит за границы плана.`)
    }
    if (geometry) {
      const label = `${kitchenLabels[item.kind]} ${index + 1}`
      if (
        !geometry.rooms.some(
          (room) => room.polygon.length >= 3 && rectInsideFloor(item, room.polygon),
        )
      ) {
        result.push(
          `${label}: не найден контур комнаты, полностью содержащий модуль. Проверьте контуры и положение.`,
        )
      }
      for (const wall of geometry.walls) {
        if (segmentTouchesItem(item, wall.start, wall.end, -1e-7)) {
          result.push(`${label} пересекает линию стены ${wall.id}.`)
        }
      }
      for (const opening of geometry.openings) {
        const wall = geometry.walls.find((candidate) => candidate.id === opening.wallId)
        if (!wall) continue
        const dx = wall.end.xCm - wall.start.xCm
        const dy = wall.end.yCm - wall.start.yCm
        const length = Math.hypot(dx, dy)
        if (length <= 0) continue
        const at = (offset: number) => ({
          xCm: wall.start.xCm + (dx * offset) / length,
          yCm: wall.start.yCm + (dy * offset) / length,
        })
        if (
          segmentTouchesItem(
            item,
            at(opening.offsetCm),
            at(opening.offsetCm + opening.widthCm),
            1e-7,
          )
        ) {
          if (opening.type === 'window') {
            if (opening.sillHeightCm === undefined || item.heightCm === undefined)
              result.push(
                `${label} касается окна ${opening.id}: укажите высоту модуля и высоту подоконника.`,
              )
            else if (item.heightCm >= opening.sillHeightCm)
              result.push(`${label} не помещается под подоконником окна ${opening.id}.`)
          } else result.push(`${label} перекрывает линию дверного проёма ${opening.id}.`)
        }
      }
    }
    for (let otherIndex = index + 1; otherIndex < items.length; otherIndex += 1) {
      const other = items[otherIndex]
      if (
        other &&
        item.xCm < other.xCm + other.widthCm &&
        other.xCm < item.xCm + item.widthCm &&
        item.yCm < other.yCm + other.depthCm &&
        other.yCm < item.yCm + item.depthCm
      ) {
        result.push(
          `${kitchenLabels[item.kind]} ${index + 1} пересекается с элементом ${otherIndex + 1}.`,
        )
      }
    }
  }
  return result
}

/** Clipping handles diagonal segments too; negative margin excludes mere wall contact. */
function segmentTouchesItem(
  item: PlanKitchenItem,
  start: PlanPoint,
  end: PlanPoint,
  margin: number,
) {
  let from = 0
  let to = 1
  for (const [origin, delta, low, high] of [
    [start.xCm, end.xCm - start.xCm, item.xCm - margin, item.xCm + item.widthCm + margin],
    [start.yCm, end.yCm - start.yCm, item.yCm - margin, item.yCm + item.depthCm + margin],
  ] as const) {
    if (Math.abs(delta) < 1e-10) {
      if (origin < low || origin > high) return false
    } else {
      const a = (low - origin) / delta
      const b = (high - origin) / delta
      from = Math.max(from, Math.min(a, b))
      to = Math.min(to, Math.max(a, b))
      if (from > to) return false
    }
  }
  return true
}
