import { describe, expect, it } from 'vitest'
import { volumeSection } from './plan-volume-section'

const face = [
  { xCm: 0, yCm: 0, zCm: 0 },
  { xCm: 300, yCm: 0, zCm: 0 },
  { xCm: 300, yCm: 0, zCm: 270 },
  { xCm: 0, yCm: 0, zCm: 270 },
]

describe('срез только для просмотра', () => {
  it('обрезает по высоте без сжатия координат и изменения исходника', () => {
    const before = structuredClone(face)
    expect(volumeSection(face, 90)).toEqual([
      { xCm: 0, yCm: 0, zCm: 0 },
      { xCm: 300, yCm: 0, zCm: 0 },
      { xCm: 300, yCm: 0, zCm: 90 },
      { xCm: 0, yCm: 0, zCm: 90 },
    ])
    expect(face).toEqual(before)
    expect(volumeSection(face, 300)).toEqual(face)
  })
  it('убирает грани выше среза и сохраняет горизонтальную грань на его уровне', () => {
    const top = face.map((point) => ({ ...point, zCm: 150 }))
    expect(volumeSection(top, 90)).toEqual([])
    expect(volumeSection(top, 150)).toEqual(top)
  })

  it('не дублирует вершины, лежащие точно на линии среза', () => {
    const triangle = [
      { xCm: 0, yCm: 0, zCm: 0 },
      { xCm: 300, yCm: 0, zCm: 90 },
      { xCm: 0, yCm: 0, zCm: 270 },
    ]
    expect(volumeSection(triangle, 90)).toEqual([
      { xCm: 0, yCm: 0, zCm: 0 },
      { xCm: 300, yCm: 0, zCm: 90 },
      { xCm: 0, yCm: 0, zCm: 90 },
    ])
    expect(volumeSection(face, 0)).toEqual(face.slice(0, 2))
  })
})
