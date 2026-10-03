import { describe, expect, it } from 'vitest'
import { wallElevationPanels } from './wall-elevation'
import { type WallSolidFace, wallSolidFaces } from './wall-solid'

// Signed tetrahedra verify the closed surface independently of the panel area sum.
function volume(faces: WallSolidFace[]): number {
  let result = 0
  for (const face of faces) {
    const a = face.points[0]
    if (!a) continue
    for (let index = 1; index < face.points.length - 1; index++) {
      const b = face.points[index]
      const c = face.points[index + 1]
      if (!b || !c) continue
      result +=
        (a.distanceCm * (b.depthCm * c.heightCm - b.heightCm * c.depthCm) -
          a.depthCm * (b.distanceCm * c.heightCm - b.heightCm * c.distanceCm) +
          a.heightCm * (b.distanceCm * c.depthCm - b.depthCm * c.distanceCm)) /
        6
    }
  }
  return result
}

describe('объём стены с толщиной', () => {
  it('совпадает с телом стены и оконным вырезом из контрольного IFC buildingSMART', () => {
    // Official wall-with-opening-and-window.ifc: 3000 × 300 × 2000 mm,
    // opening 1000 × 300 × 1000 mm, bottom 500 mm. This is not an apartment survey.
    const panels = wallElevationPanels(300, 200, [
      { startCm: 100, endCm: 200, bottomCm: 50, heightCm: 100 },
    ])
    if (!panels) throw new Error('Missing control panels')
    const faces = wallSolidFaces(panels, 300, 200, 30)
    expect(volume(faces)).toBeCloseTo(1_500_000, 6)
    const reveals = faces.filter((face) => face.role === 'reveal')
    expect(reveals).toHaveLength(4)
    expect(
      reveals.every((face) => new Set(face.points.map((point) => point.depthCm)).size === 2),
    ).toBe(true)
    // No cap seals the material on either side of the window, above/below its hole.
    expect(
      faces.filter((face) => face.points.every((point) => point.distanceCm === 100)),
    ).toHaveLength(1)
    expect(
      faces.filter((face) => face.points.every((point) => point.distanceCm === 200)),
    ).toHaveLength(1)
  })

  it('сохраняет перемычку двери, но не создаёт порог в проёме от пола', () => {
    const panels = wallElevationPanels(300, 270, [
      { startCm: 100, endCm: 190, bottomCm: 0, heightCm: 210 },
    ])
    if (!panels) throw new Error('Missing door panels')
    const faces = wallSolidFaces(panels, 300, 270, 12)
    expect(volume(faces)).toBeCloseTo((300 * 270 - 90 * 210) * 12, 6)
    expect(faces.filter((face) => face.role === 'reveal')).toHaveLength(3)
    expect(faces.filter((face) => face.points.every((point) => point.heightCm === 0))).toHaveLength(
      2,
    )
  })

  it('вырезает объединение соседних и перекрывающихся проёмов без внутренних откосов', () => {
    const panels = wallElevationPanels(300, 270, [
      { startCm: 50, endCm: 150, bottomCm: 0, heightCm: 200 },
      { startCm: 100, endCm: 200, bottomCm: 50, heightCm: 150 },
      { startCm: 200, endCm: 250, bottomCm: 50, heightCm: 150 },
    ])
    if (!panels) throw new Error('Missing union panels')
    const faces = wallSolidFaces(panels, 300, 270, 9.5)
    expect(volume(faces)).toBeCloseTo((300 * 270 - 35_000) * 9.5, 6)
    expect(faces.some((face) => face.points.every((point) => point.distanceCm === 200))).toBe(false)
  })
})
