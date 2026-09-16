import type { PlanObstacle } from '@uyut/db'
import { z } from 'zod'

export const obstacleLabels: Record<PlanObstacle['kind'], string> = {
  column: 'Колонна',
  shaft: 'Вентшахта или короб',
  fixed: 'Несдвигаемый элемент',
}

export const planObstaclesSchema = z
  .array(
    z.object({
      id: z
        .string()
        .min(1)
        .max(40)
        .regex(/^[a-zA-Z0-9_-]+$/),
      kind: z.enum(['column', 'shaft', 'fixed']),
      xCm: z.number().finite().min(0).max(10_000),
      yCm: z.number().finite().min(0).max(10_000),
      widthCm: z.number().finite().min(5).max(2_000),
      depthCm: z.number().finite().min(5).max(2_000),
      label: z.string().trim().max(80).optional(),
    }),
  )
  .max(100)
  .refine(
    (items) => new Set(items.map((item) => item.id)).size === items.length,
    'У препятствий должны быть разные идентификаторы',
  )

export function obstacleTitle(obstacle: PlanObstacle): string {
  return obstacle.label?.trim() || obstacleLabels[obstacle.kind]
}
