import type { PlanKitchenItem } from '@uyut/db'
import { z } from 'zod'

export const kitchenItemsSchema = z
  .array(
    z.object({
      id: z.string().min(1).max(80),
      kind: z.enum(['sink', 'hob', 'fridge', 'cabinet']),
      xCm: z.number().finite().min(0).max(10000),
      yCm: z.number().finite().min(0).max(10000),
      widthCm: z.number().finite().min(10).max(600),
      depthCm: z.number().finite().min(10).max(600),
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
  fridge: 'Холодильник',
  cabinet: 'Гарнитур',
}

export function kitchenItemIssues(
  items: readonly PlanKitchenItem[],
  widthCm: number,
  heightCm: number,
) {
  const result: string[] = []
  for (const [index, item] of items.entries()) {
    if (item.xCm + item.widthCm > widthCm || item.yCm + item.depthCm > heightCm) {
      result.push(`${kitchenLabels[item.kind]} ${index + 1} выходит за границы плана.`)
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
