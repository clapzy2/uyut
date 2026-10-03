import { describe, expect, it } from 'vitest'
import { type WallElevationPanel, wallElevationPanels } from './wall-elevation'

function area(panels: WallElevationPanel[]) {
  return panels.reduce(
    (sum, panel) => sum + (panel.endCm - panel.startCm) * (panel.topCm - panel.bottomCm),
    0,
  )
}

describe('вертикальные вырезы стены', () => {
  it('сохраняет подоконную часть и перемычку по эталону buildingSMART', () => {
    // Derived from buildingSMART's wall-with-opening-and-window.ifc, CC BY 4.0.
    // #8: mm; #71: wall height 2000; #76: length 3000; #83: opening at (1000,0,500);
    // #87: opening height 1000; #92: opening width 1000. Values below are in cm.
    // https://github.com/buildingSMART/Certification-datasets/blob/main/IFC%204.0.2.1%20%28IFC%204%20ADD2%20TC1%29/ISO%20Spec%20-%20ReferenceView_V1.2/wall-with-opening-and-window.ifc
    const panels = wallElevationPanels(300, 200, [
      { startCm: 100, endCm: 200, bottomCm: 50, heightCm: 100 },
    ])
    expect(panels).toEqual([
      { startCm: 0, endCm: 100, bottomCm: 0, topCm: 200 },
      { startCm: 100, endCm: 200, bottomCm: 0, topCm: 50 },
      { startCm: 100, endCm: 200, bottomCm: 150, topCm: 200 },
      { startCm: 200, endCm: 300, bottomCm: 0, topCm: 200 },
    ])
    expect(area(panels ?? [])).toBe(50_000)
  })

  it('для двери до пола оставляет перемычку и обе боковые части', () => {
    const panels = wallElevationPanels(400, 270, [
      { startCm: 100, endCm: 190, bottomCm: 0, heightCm: 210 },
    ])
    expect(panels).toEqual([
      { startCm: 0, endCm: 100, bottomCm: 0, topCm: 270 },
      { startCm: 100, endCm: 190, bottomCm: 210, topCm: 270 },
      { startCm: 190, endCm: 400, bottomCm: 0, topCm: 270 },
    ])
  })

  it('вычитает объединение пересекающихся вырезов без двойного счёта', () => {
    const panels = wallElevationPanels(300, 200, [
      { startCm: 50, endCm: 150, bottomCm: 30, heightCm: 100 },
      { startCm: 100, endCm: 200, bottomCm: 80, heightCm: 100 },
    ])
    expect(area(panels ?? [])).toBe(60_000 - 10_000 - 10_000 + 2_500)
  })

  it('сохраняет дробные мерки и допускает проём на всю высоту', () => {
    const panels = wallElevationPanels(300.4, 270.2, [
      { startCm: 0, endCm: 90.3, bottomCm: 0, heightCm: 270.2 },
    ])
    expect(panels).toEqual([{ startCm: 90.3, endCm: 300.4, bottomCm: 0, topCm: 270.2 }])
    // Decimal arithmetic must not create a sliver above the wall or reject a touching edge.
    expect(
      wallElevationPanels(300, 0.3, [{ startCm: 100, endCm: 200, bottomCm: 0.1, heightCm: 0.2 }]),
    ).toEqual([
      { startCm: 0, endCm: 100, bottomCm: 0, topCm: 0.3 },
      { startCm: 100, endCm: 200, bottomCm: 0, topCm: 0.1 },
      { startCm: 200, endCm: 300, bottomCm: 0, topCm: 0.3 },
    ])
  })

  it('не строит геометрию по недопустимым высотам и вырезам за пределами стены', () => {
    expect(wallElevationPanels(300, Number.NaN, [])).toBeNull()
    expect(wallElevationPanels(300, 0, [])).toBeNull()
    for (const opening of [
      { startCm: -1, endCm: 100, bottomCm: 0, heightCm: 100 },
      { startCm: 100, endCm: 301, bottomCm: 0, heightCm: 100 },
      { startCm: 100, endCm: 200, bottomCm: -1, heightCm: 100 },
      { startCm: 100, endCm: 200, bottomCm: 101, heightCm: 100 },
      { startCm: 100, endCm: 200, bottomCm: 0, heightCm: Number.POSITIVE_INFINITY },
    ]) {
      expect(wallElevationPanels(300, 200, [opening])).toBeNull()
    }
  })
})
