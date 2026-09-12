import { describe, expect, it } from 'vitest'
import type { RoomWithConcepts } from '@/lib/projects/repository'
import { APARTMENT_COUNT, apartmentPlan } from './apartment'

function room(over: Partial<RoomWithConcepts> & { name: string }): RoomWithConcepts {
  return {
    id: over.name,
    projectId: 'p1',
    kind: 'living',
    areaM2: null,
    condition: 'bare',
    refreshFinish: false,
    photoUrl: null,
    planUrl: null,
    notes: null,
    measurements: null,
    orderIndex: 0,
    generationRunId: null,
    generationStartedAt: null,
    generationBatchId: null,
    conceptCount: 0,
    ...over,
  } as RoomWithConcepts
}

describe('apartmentPlan', () => {
  it('считает картинки по комнатам, где ещё пусто', () => {
    const plan = apartmentPlan([room({ name: 'Гостиная' }), room({ name: 'Спальня' })])
    expect(plan.ready).toHaveLength(2)
    expect(plan.renders).toBe(2 * APARTMENT_COUNT)
  })

  it('комнату с концептами второй раз не запускаем', () => {
    const plan = apartmentPlan([room({ name: 'Гостиная', conceptCount: 5 })])
    expect(plan.ready).toEqual([])
    expect(plan.rooms[0]?.skip).toBe('done')
  })

  it('идущую генерацию не трогаем', () => {
    const plan = apartmentPlan([room({ name: 'Кухня', generationRunId: 'run_1' })])
    expect(plan.rooms[0]?.skip).toBe('busy')
  })

  it('«оставить как есть» без заметки дало бы пять копий фотографии', () => {
    const plan = apartmentPlan([room({ name: 'Спальня', condition: 'keep' })])
    expect(plan.rooms[0]?.skip).toBe('needsNote')
    expect(
      apartmentPlan([room({ name: 'Спальня', condition: 'keep', notes: 'убрать шкаф' })]).ready,
    ).toHaveLength(1)
  })
})
