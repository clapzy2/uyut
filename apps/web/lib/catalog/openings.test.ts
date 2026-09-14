import { parseWallReservations } from '@uyut/catalog'
import { describe, expect, it } from 'vitest'

describe('parseWallReservations', () => {
  it('понимает стену отдельно от уточнения угла', () => {
    const reservations = parseWallReservations('Окно на нижней стене, дверь слева у нижнего угла', {
      widthCm: 300,
      depthCm: 400,
    })

    expect(reservations).toEqual([
      { kind: 'window', wall: 'bottom', fromCm: 90, toCm: 210, clearanceCm: 0 },
      { kind: 'door', wall: 'left', fromCm: 310, toCm: 400, clearanceCm: 90 },
    ])
  })

  it('использует явно указанную ширину', () => {
    expect(
      parseWallReservations('Дверь шириной 80 см на правой стене', {
        widthCm: 300,
        depthCm: 400,
      }),
    ).toEqual([{ kind: 'door', wall: 'right', fromCm: 160, toCm: 240, clearanceCm: 90 }])
  })

  it('не угадывает стену, если она не названа', () => {
    expect(
      parseWallReservations('Дверь открывается внутрь', { widthCm: 300, depthCm: 400 }),
    ).toEqual([])
  })

  it('относит батарею под окном к той же стене', () => {
    expect(
      parseWallReservations('Окно снизу, батарея под окном', {
        widthCm: 300,
        depthCm: 400,
      }).map(({ kind, wall }) => ({ kind, wall })),
    ).toEqual([
      { kind: 'window', wall: 'bottom' },
      { kind: 'radiator', wall: 'bottom' },
    ])
  })
})
