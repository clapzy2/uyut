import type { PlanReading } from '@uyut/db'
import { describe, expect, it } from 'vitest'
import { planRows } from './plan-rows'

function reading(rooms: PlanReading['rooms']): PlanReading {
  return { ceilingCm: 270, rooms, readAt: '2026-09-12T00:00:00.000Z' }
}

describe('planRows', () => {
  it('числа становятся текстом полей, площадь через запятую', () => {
    const [row] = planRows(
      reading([{ name: 'Гостиная', kind: 'living', widthCm: 383, depthCm: 425, areaM2: 16.3 }]),
    )
    expect(row).toMatchObject({ include: true, width: '383', depth: '425', area: '16,3' })
    // Желание человек пишет сам: с плана его взять неоткуда
    expect(row?.wish).toBe('')
  })

  it('чего не прочитали, то пустое поле, а не ноль', () => {
    const [row] = planRows(reading([{ name: 'Кухня', kind: 'kitchen', widthCm: 245 }]))
    expect(row?.depth).toBe('')
    expect(row?.area).toBe('')
  })

  it('санузел показываем, но снятым: таких комнат сервис пока не делает', () => {
    const [row] = planRows(reading([{ name: 'Санузел', kind: 'bath', widthCm: 168 }]))
    expect(row?.unsupported).toBe(true)
    expect(row?.include).toBe(false)
  })

  it('несходящуюся строку передаём дальше с пометкой', () => {
    const [row] = planRows(
      reading([
        {
          name: 'Спальня',
          kind: 'bedroom',
          widthCm: 290,
          depthCm: 425,
          areaM2: 25,
          suspicious: true,
        },
      ]),
    )
    expect(row?.suspicious).toBe(true)
    expect(row?.include).toBe(true)
  })

  it('комнату из анкеты план дополняет, а не задваивает', () => {
    const rows = planRows(
      reading([
        { name: 'Гостиная', kind: 'living', widthCm: 383 },
        { name: 'Спальня', kind: 'bedroom', widthCm: 290 },
      ]),
      [{ id: 'r1', name: 'Гостиная', kind: 'living', hasMeasurements: false }],
    )
    expect(rows[0]?.roomId).toBe('r1')
    expect(rows[0]?.roomName).toBe('Гостиная')
    expect(rows[1]?.roomId).toBeUndefined()
  })

  it('промеренную рулеткой комнату прочитанным не перетираем', () => {
    const rows = planRows(reading([{ name: 'Гостиная', kind: 'living', widthCm: 383 }]), [
      { id: 'r1', name: 'Гостиная', kind: 'living', hasMeasurements: true },
    ])
    expect(rows[0]?.roomId).toBeUndefined()
  })

  it('две спальни с плана не достаются одной и той же комнате', () => {
    const rows = planRows(
      reading([
        { name: 'Спальня', kind: 'bedroom', widthCm: 290 },
        { name: 'Спальня 2', kind: 'bedroom', widthCm: 310 },
      ]),
      [{ id: 'r1', name: 'Спальня', kind: 'bedroom', hasMeasurements: false }],
    )
    expect(rows[0]?.roomId).toBe('r1')
    expect(rows[1]?.roomId).toBeUndefined()
  })
})
