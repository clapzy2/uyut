import { parseWallReservations } from '@uyut/catalog'
import { describe, expect, it } from 'vitest'

describe('parseWallReservations', () => {
  it('понимает стену отдельно от уточнения угла', () => {
    const reservations = parseWallReservations(
      'Окно на нижней стене по центру 120 см, дверь слева у нижнего угла 90 см',
      {
        widthCm: 300,
        depthCm: 400,
      },
    )

    expect(reservations).toEqual([
      { kind: 'window', wall: 'bottom', fromCm: 90, toCm: 210, clearanceCm: 0 },
      { kind: 'door', wall: 'left', fromCm: 310, toCm: 400, clearanceCm: 90 },
    ])
  })

  it('использует явно указанную ширину', () => {
    expect(
      parseWallReservations('Дверь шириной 80 см на правой стене по центру', {
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
      parseWallReservations('Окно снизу по центру 120 см, батарея под окном по центру 100 см', {
        widthCm: 300,
        depthCm: 400,
      }).map(({ kind, wall }) => ({ kind, wall })),
    ).toEqual([
      { kind: 'window', wall: 'bottom' },
      { kind: 'radiator', wall: 'bottom' },
    ])
  })

  it('сохраняет ширину после запятой, не подменяя её типовой дверью', () => {
    const expected = [{ kind: 'door', wall: 'left', fromCm: 0, toCm: 150, clearanceCm: 90 }]
    for (const notes of [
      'Дверь слева у верхнего угла, ширина 150 см',
      'Дверь слева у верхнего угла ширина150см',
    ]) {
      expect(parseWallReservations(notes, { widthCm: 400, depthCm: 400 })).toEqual(expected)
    }
  })

  it('не создаёт отсутствующий проём', () => {
    for (const notes of [
      'Двери слева нет',
      'Нет двери слева',
      'Без двери слева',
      'Окна сверху нет',
    ]) {
      expect(parseWallReservations(notes, { widthCm: 400, depthCm: 400 })).toEqual([])
    }
  })

  it('не выдумывает ширину или расположение и не округляет дробные размеры', () => {
    for (const notes of ['Дверь слева', 'Дверь слева шириной 90 см', 'Окно сверху по центру']) {
      expect(parseWallReservations(notes, { widthCm: 400, depthCm: 400 })).toEqual([])
    }
    expect(
      parseWallReservations('Окно сверху у левого угла, ширина 150,5 см', {
        widthCm: 400,
        depthCm: 400,
      }),
    ).toEqual([{ kind: 'window', wall: 'top', fromCm: 0, toCm: 150.5, clearanceCm: 0 }])
  })

  it('не принимает высоту за ширину, отрицание центра или альтернативные стены за точную привязку', () => {
    const room = { widthCm: 400, depthCm: 400 }
    for (const notes of [
      'Окно слева по центру высота120см',
      'Окно слева по центру высотой 120 см',
      'Окно слева не по центру ширина 120 см',
      'Окно слева не в центре ширина 120 см',
      'Окно слева или справа по центру ширина 120 см',
    ])
      expect(parseWallReservations(notes, room)).toEqual([])
    expect(parseWallReservations('Окно слева по центру высота 120 см ширина 150 см', room)).toEqual(
      [{ kind: 'window', wall: 'left', fromCm: 125, toCm: 275, clearanceCm: 0 }],
    )
  })

  it('не теряет второй объект после союза и', () => {
    expect(
      parseWallReservations(
        'Окно сверху по центру ширина 120 см и дверь слева у верхнего угла, ширина 150 см',
        { widthCm: 400, depthCm: 400 },
      ),
    ).toEqual([
      { kind: 'window', wall: 'top', fromCm: 140, toCm: 260, clearanceCm: 0 },
      { kind: 'door', wall: 'left', fromCm: 0, toCm: 150, clearanceCm: 90 },
    ])
  })

  it('отдельно разбирает вторую дверь и не переносит её отрицание на первое окно', () => {
    const room = { widthCm: 400, depthCm: 400 }
    const window = { kind: 'window', wall: 'left', fromCm: 140, toCm: 260, clearanceCm: 0 }
    expect(
      parseWallReservations(
        'Окно слева по центру ширина120см и дверь справа по центру ширина90см',
        room,
      ),
    ).toEqual([window, { kind: 'door', wall: 'right', fromCm: 155, toCm: 245, clearanceCm: 90 }])
    expect(parseWallReservations('Окно слева по центру ширина120см и двери нет', room)).toEqual([
      window,
    ])
  })

  it('читает явный диапазон и удерживает противоречивую или выходящую за стену ширину', () => {
    const room = { widthCm: 400, depthCm: 400 }
    expect(parseWallReservations('Окно сверху от 100 до 220 см', room)).toEqual([
      { kind: 'window', wall: 'top', fromCm: 100, toCm: 220, clearanceCm: 0 },
    ])
    for (const notes of [
      'Окно сверху шириной 150 см от 100 до 220 см',
      'Окно сверху у левого угла шириной 450 см',
      'Окно сверху от 220 до 100 см',
    ])
      expect(parseWallReservations(notes, room)).toEqual([])
  })
})
