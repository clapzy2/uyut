import { describe, expect, it } from 'vitest'
import { obstacleTitle, planObstaclesSchema } from './plan-obstacles'

const obstacle = {
  id: 'manual_0123456789abcdef01234567',
  kind: 'column' as const,
  xCm: 120,
  yCm: 80,
  widthCm: 30,
  depthCm: 30,
}

describe('неподвижные препятствия', () => {
  it('принимает точный прямоугольник с ручным идентификатором', () => {
    expect(planObstaclesSchema.parse([obstacle])).toEqual([obstacle])
  })

  it('не принимает нулевой размер и произвольный идентификатор', () => {
    expect(planObstaclesSchema.safeParse([{ ...obstacle, widthCm: 0 }]).success).toBe(false)
    expect(planObstaclesSchema.safeParse([{ ...obstacle, id: 'column-1' }]).success).toBe(false)
  })

  it('показывает пользовательскую подпись, если она задана', () => {
    expect(obstacleTitle({ ...obstacle, label: 'Несущая колонна' })).toBe('Несущая колонна')
    expect(obstacleTitle(obstacle)).toBe('Колонна')
  })
})
