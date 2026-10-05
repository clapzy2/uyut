import { roomArchitectureFromPlan } from '@uyut/ai'
import type { PlanGeometry } from '@uyut/db'
import { describe, expect, it } from 'vitest'

const geometry: PlanGeometry = {
  version: 1,
  status: 'confirmed',
  widthCm: 700,
  heightCm: 400,
  walls: [
    { id: 'top', kind: 'outer', start: { xCm: 0, yCm: 0 }, end: { xCm: 700, yCm: 0 } },
    { id: 'left', kind: 'outer', start: { xCm: 0, yCm: 0 }, end: { xCm: 0, yCm: 400 } },
    { id: 'far', kind: 'outer', start: { xCm: 700, yCm: 0 }, end: { xCm: 700, yCm: 400 } },
  ],
  openings: [
    { id: 'living-window', type: 'window', wallId: 'top', offsetCm: 100, widthCm: 120 },
    { id: 'living-door', type: 'door', wallId: 'left', offsetCm: 200, widthCm: 80 },
    { id: 'other-window', type: 'window', wallId: 'top', offsetCm: 500, widthCm: 120 },
  ],
  rooms: [
    {
      name: 'Гостиная',
      polygon: [
        { xCm: 0, yCm: 0 },
        { xCm: 350, yCm: 0 },
        { xCm: 350, yCm: 400 },
        { xCm: 0, yCm: 400 },
      ],
    },
    {
      name: 'Кухня',
      polygon: [
        { xCm: 350, yCm: 0 },
        { xCm: 700, yCm: 0 },
        { xCm: 700, yCm: 400 },
        { xCm: 350, yCm: 400 },
      ],
    },
  ],
  warnings: [],
}

describe('факты архитектуры комнаты', () => {
  it.each(['window', 'door', 'balcony'] as const)(
    'сохраняет %s через промежуточные точки одной прямой грани',
    (type) => {
      const polygon = [
        { xCm: 0, yCm: 0 },
        { xCm: 180, yCm: 0 },
        { xCm: 200, yCm: 0 },
        { xCm: 400, yCm: 0 },
        { xCm: 400, yCm: 300 },
        { xCm: 0, yCm: 300 },
      ]
      for (const points of [polygon, [...polygon].reverse()]) {
        const plan: PlanGeometry = {
          ...geometry,
          walls: [
            { id: 'top', kind: 'outer', start: { xCm: 0, yCm: 0 }, end: { xCm: 400, yCm: 0 } },
          ],
          openings: [{ id: 'opening', type, wallId: 'top', offsetCm: 150, widthCm: 120 }],
          rooms: [{ name: 'Гостиная', polygon: points }],
        }
        expect(roomArchitectureFromPlan(plan, 'Гостиная')?.openings).toEqual([
          { type, side: 'top' },
        ])
      }
    },
  )

  it('не соединяет проём через настоящий поворот или нишу', () => {
    const plan: PlanGeometry = {
      ...geometry,
      walls: [{ id: 'top', kind: 'outer', start: { xCm: 0, yCm: 0 }, end: { xCm: 400, yCm: 0 } }],
      openings: [{ id: 'opening', type: 'window', wallId: 'top', offsetCm: 150, widthCm: 120 }],
      rooms: [
        {
          name: 'Гостиная',
          polygon: [
            { xCm: 0, yCm: 0 },
            { xCm: 180, yCm: 0 },
            { xCm: 180, yCm: 70 },
            { xCm: 250, yCm: 70 },
            { xCm: 250, yCm: 0 },
            { xCm: 400, yCm: 0 },
            { xCm: 400, yCm: 300 },
            { xCm: 0, yCm: 300 },
          ],
        },
      ],
    }
    expect(roomArchitectureFromPlan(plan, 'Гостиная')?.openings).toEqual([])
  })

  it('берёт только проёмы выбранной комнаты из подтверждённого плана', () => {
    expect(roomArchitectureFromPlan(geometry, 'гостиная')).toEqual({
      shape: 'rectangular',
      openings: [
        { type: 'window', side: 'top' },
        { type: 'door', side: 'left' },
      ],
    })
  })

  it('различает комнату с нишей и прямоугольник', () => {
    const room = geometry.rooms[0]
    if (!room) throw new Error('missing room')
    const withNiche = {
      ...geometry,
      rooms: [
        {
          ...room,
          polygon: [
            { xCm: 0, yCm: 0 },
            { xCm: 350, yCm: 0 },
            { xCm: 350, yCm: 150 },
            { xCm: 250, yCm: 150 },
            { xCm: 250, yCm: 400 },
            { xCm: 0, yCm: 400 },
          ],
        },
      ],
    } satisfies PlanGeometry
    expect(roomArchitectureFromPlan(withNiche, 'Гостиная')?.shape).toBe('nonrectangular')
  })

  it('не выдаёт черновик или неоднозначную комнату за подтверждённую архитектуру', () => {
    const room = geometry.rooms[0]
    if (!room) throw new Error('missing room')
    expect(roomArchitectureFromPlan({ ...geometry, status: 'draft' }, 'Гостиная')).toBeNull()
    expect(roomArchitectureFromPlan({ ...geometry, rooms: [room, room] }, 'Гостиная')).toBeNull()
    expect(roomArchitectureFromPlan(geometry, 'Спальня')).toBeNull()
  })

  it('узнаёт прямоугольник независимо от поворота и промежуточных точек на гранях', () => {
    for (const polygon of [
      [
        { xCm: 200, yCm: 0 },
        { xCm: 400, yCm: 200 },
        { xCm: 200, yCm: 400 },
        { xCm: 0, yCm: 200 },
      ],
      [
        { xCm: 0, yCm: 0 },
        { xCm: 200, yCm: 0 },
        { xCm: 400, yCm: 0 },
        { xCm: 400, yCm: 300 },
        { xCm: 0, yCm: 300 },
      ],
    ]) {
      const plan = { ...geometry, rooms: [{ name: 'Гостиная', polygon }] }
      expect(roomArchitectureFromPlan(plan, 'Гостиная')?.shape).toBe('rectangular')
      expect(
        roomArchitectureFromPlan(
          { ...plan, rooms: [{ name: 'Гостиная', polygon: [...polygon].reverse() }] },
          'Гостиная',
        )?.shape,
      ).toBe('rectangular')
    }
  })

  it('не принимает трапецию или самопересечение за прямоугольник', () => {
    for (const polygon of [
      [
        { xCm: 0, yCm: 0 },
        { xCm: 400, yCm: 0 },
        { xCm: 350, yCm: 300 },
        { xCm: 0, yCm: 300 },
      ],
      [
        { xCm: 0, yCm: 0 },
        { xCm: 400, yCm: 300 },
        { xCm: 400, yCm: 0 },
        { xCm: 0, yCm: 300 },
      ],
    ]) {
      expect(
        roomArchitectureFromPlan(
          { ...geometry, rooms: [{ name: 'Гостиная', polygon }] },
          'Гостиная',
        )?.shape,
      ).toBe('nonrectangular')
    }
  })
})
