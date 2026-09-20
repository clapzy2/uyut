import { describe, expect, it } from 'vitest'
import {
  addRoomContourPoint,
  MAX_ROOM_CONTOUR_POINTS,
  removeRoomContourPoint,
} from './room-contour'

describe('room contour editing', () => {
  it('добавляет точку в середину самой длинной стороны без изменения формы', () => {
    expect(
      addRoomContourPoint([
        { xCm: 0, yCm: 0 },
        { xCm: 400, yCm: 0 },
        { xCm: 400, yCm: 250 },
        { xCm: 0, yCm: 250 },
      ]),
    ).toEqual([
      { xCm: 0, yCm: 0 },
      { xCm: 200, yCm: 0 },
      { xCm: 400, yCm: 0 },
      { xCm: 400, yCm: 250 },
      { xCm: 0, yCm: 250 },
    ])
  })

  it('не позволяет удалить ниже трёх углов', () => {
    const triangle = [
      { xCm: 0, yCm: 0 },
      { xCm: 100, yCm: 0 },
      { xCm: 0, yCm: 100 },
    ]
    expect(removeRoomContourPoint(triangle, 1)).toEqual(triangle)
  })

  it('ограничивает контур тем же числом точек, которое принимает сервер', () => {
    const points = Array.from({ length: MAX_ROOM_CONTOUR_POINTS }, (_, index) => ({
      xCm: index,
      yCm: 0,
    }))
    expect(addRoomContourPoint(points)).toHaveLength(MAX_ROOM_CONTOUR_POINTS)
  })
})
