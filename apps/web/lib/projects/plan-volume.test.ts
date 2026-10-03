import type { PlanGeometry, PlanWallFacePair } from '@uyut/db'
import { describe, expect, it } from 'vitest'
import openApartment from '../../../../jobs/fixtures/open-swiss-apartment-35063-geometry.json'
import { buildPlanScene } from './plan-scene-geometry'
import { planVolume } from './plan-volume'

const geometry: PlanGeometry = {
  version: 1,
  status: 'confirmed',
  widthCm: 400,
  heightCm: 300,
  walls: [
    {
      id: 'wall-1',
      kind: 'outer',
      start: { xCm: 0, yCm: 0 },
      end: { xCm: 400, yCm: 0 },
    },
  ],
  openings: [
    { id: 'door-1', type: 'door', wallId: 'wall-1', offsetCm: 100, widthCm: 90 },
    { id: 'window-1', type: 'window', wallId: 'wall-1', offsetCm: 250, widthCm: 100 },
  ],
  rooms: [],
  footprint: [
    { xCm: 0, yCm: 0 },
    { xCm: 400, yCm: 0 },
    { xCm: 400, yCm: 300 },
    { xCm: 0, yCm: 300 },
  ],
  voids: [
    {
      id: 'shaft',
      polygon: [
        { xCm: 10, yCm: 10 },
        { xCm: 20, yCm: 10 },
        { xCm: 20, yCm: 20 },
        { xCm: 10, yCm: 20 },
      ],
    },
  ],
  warnings: [],
}

describe('planVolume', () => {
  it('сохраняет заданные кухонные рабочие зоны без списка покупок', () => {
    const source: PlanGeometry = {
      ...geometry,
      kitchenItems: [
        {
          id: 'cabinet',
          kind: 'cabinet',
          xCm: 100,
          yCm: 100,
          widthCm: 60,
          depthCm: 60,
          front: 'bottom',
          openingDepthCm: 40,
          passageCm: 70,
          installationGaps: { top: 0, right: 5, bottom: 0, left: 0 },
        },
      ],
    }
    const before = structuredClone(source)
    const model = planVolume(source)
    expect(model?.floorZones).toEqual([
      {
        id: 'kitchen-zone:cabinet-access',
        title: 'Модуль 1: открывание и проход',
        kind: 'operation',
        floor: [
          { xCm: 100, yCm: 160 },
          { xCm: 160, yCm: 160 },
          { xCm: 160, yCm: 270 },
          { xCm: 100, yCm: 270 },
        ],
      },
      {
        id: 'kitchen-zone:cabinet-mount',
        title: 'Модуль 1: монтажный габарит',
        kind: 'operation',
        floor: [
          { xCm: 100, yCm: 100 },
          { xCm: 165, yCm: 100 },
          { xCm: 165, yCm: 160 },
          { xCm: 100, yCm: 160 },
        ],
      },
    ])
    if (!model) throw new Error('Missing kitchen model')
    const scene = buildPlanScene(model)
    try {
      expect(scene.surfaces.filter((surface) => surface.kind === 'zone')).toHaveLength(2)
    } finally {
      for (const item of [...scene.surfaces, ...scene.lines]) item.geometry.dispose()
    }
    delete source.kitchenItems?.[0]?.passageCm
    expect(planVolume(source)?.floorZones?.[0]?.preliminary).toBe(true)
    expect(planVolume(source)?.floorZones?.[0]?.floor[2]?.yCm).toBe(200)
    expect(before.kitchenItems?.[0]?.passageCm).toBe(70)
    delete source.kitchenItems
    expect(planVolume(source)?.floorZones).toBeUndefined()
  })

  it.each([90, undefined])('переносит кухонный модуль с явной высотой %s', (heightCm) => {
    const source: PlanGeometry = {
      ...geometry,
      rooms: [{ name: 'Кухня', polygon: geometry.footprint ?? [] }],
      kitchenItems: [
        {
          id: 'cabinet',
          kind: 'cabinet',
          xCm: 100,
          yCm: 100,
          widthCm: 60,
          depthCm: 80,
          ...(heightCm === undefined ? {} : { heightCm }),
        },
      ],
    }
    const before = structuredClone(source)
    const model = planVolume(source)
    if (!model) throw new Error('Missing kitchen volume')
    expect(model.furniture).toEqual([
      {
        id: 'kitchen:cabinet',
        title: 'Гарнитур',
        floor: [
          { xCm: 100, yCm: 100 },
          { xCm: 160, yCm: 100 },
          { xCm: 160, yCm: 180 },
          { xCm: 100, yCm: 180 },
        ],
        ...(heightCm === undefined ? {} : { heightCm }),
      },
    ])
    const scene = buildPlanScene(model)
    try {
      const surfaces = scene.surfaces.filter((surface) => surface.kind === 'furniture')
      expect(surfaces).toHaveLength(heightCm === undefined ? 1 : 6)
      expect(surfaces.every((surface) => surface.footprintOnly === (heightCm === undefined))).toBe(
        true,
      )
      const heights = surfaces.flatMap((surface) => {
        const positions = surface.geometry.getAttribute('position')
        return Array.from({ length: positions.count }, (_, index) => positions.getY(index))
      })
      expect(Math.max(...heights)).toBeCloseTo(heightCm === undefined ? 0 : heightCm / 100)
    } finally {
      for (const item of [...scene.surfaces, ...scene.lines]) item.geometry.dispose()
    }
    expect(source).toEqual(before)
  })

  it('после JSON-перечитывания меняет кухонный модуль и удаляет старую высоту и сам модуль', () => {
    const source: PlanGeometry = {
      ...geometry,
      kitchenItems: [
        {
          id: 'cabinet',
          kind: 'cabinet',
          xCm: 100,
          yCm: 100,
          widthCm: 60,
          depthCm: 60,
          heightCm: 90,
        },
      ],
    }
    const changed = JSON.parse(JSON.stringify(source)) as PlanGeometry
    const module = changed.kitchenItems?.[0]
    if (!module) throw new Error('Missing kitchen source module')
    module.xCm = 180
    module.widthCm = 80
    delete module.heightCm
    expect(planVolume(changed)?.furniture?.[0]).toMatchObject({
      id: 'kitchen:cabinet',
      floor: [
        { xCm: 180, yCm: 100 },
        { xCm: 260, yCm: 100 },
        { xCm: 260, yCm: 160 },
        { xCm: 180, yCm: 160 },
      ],
    })
    expect(planVolume(changed)?.furniture?.[0]?.heightCm).toBeUndefined()
    changed.kitchenItems = []
    expect(planVolume(changed)?.furniture).toBeUndefined()
    expect(planVolume(source)?.furniture?.[0]?.heightCm).toBe(90)
  })

  it('сохраняет предупреждение пересечения модулей и отклоняет неверные мерки', () => {
    const item = {
      id: 'cabinet',
      kind: 'cabinet' as const,
      xCm: 100,
      yCm: 100,
      widthCm: 60,
      depthCm: 60,
    }
    const model = planVolume({ ...geometry, kitchenItems: [item, { ...item, id: 'fridge' }] })
    expect(model?.furniture).toHaveLength(2)
    expect(model?.issues).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          severity: 'warning',
          message: expect.stringContaining('пересекается'),
        }),
      ]),
    )
    expect(planVolume({ ...geometry, kitchenItems: [{ ...item, heightCm: -1 }] })).toBeNull()
    expect(planVolume({ ...geometry, kitchenItems: [{ ...item, widthCm: Number.NaN }] })).toBeNull()
  })

  it('строит толщину перпендикулярно наклонной оси в обоих направлениях', () => {
    const sourceWall = geometry.walls[0]
    if (!sourceWall) throw new Error('Missing source wall')
    for (const reverse of [false, true]) {
      const start = { xCm: 50, yCm: 40 }
      const end = { xCm: 290, yCm: 220 }
      const wall = {
        ...sourceWall,
        start: reverse ? end : start,
        end: reverse ? start : end,
        heightCm: 200,
        measuredThicknessCm: 30,
      }
      const model = planVolume({ ...geometry, walls: [wall], openings: [] })
      expect(model?.solidFaces).toHaveLength(6)
      for (const face of model?.solidFaces ?? []) {
        for (const point of face.points) {
          const perpendicular =
            ((point.xCm - start.xCm) * 180 - (point.yCm - start.yCm) * 240) / 300
          expect(Math.abs(perpendicular)).toBeCloseTo(15, 6)
        }
      }
    }
  })
  it('не превращает прежнюю распознанную толщину в объём без отдельной мерки', () => {
    const source = {
      ...geometry,
      walls: geometry.walls.map((wall) => ({ ...wall, heightCm: 270, thicknessCm: 20 })),
    }
    expect(planVolume(source)?.solidFaces).toHaveLength(0)
    const measured = {
      ...source,
      walls: source.walls.map((wall) => ({ ...wall, measuredThicknessCm: 20 })),
    }
    const model = planVolume(measured)
    expect(model?.solidFaces).toHaveLength(6)
    expect(model?.walls.every((wall) => wall.solid)).toBe(true)
    expect(model?.solidFaces.flatMap((face) => face.points.map((point) => point.yCm))).toContain(
      -10,
    )
    expect(
      planVolume({
        ...measured,
        walls: measured.walls.map((wall) => ({ ...wall, heightCm: undefined })),
      })?.solidFaces,
    ).toHaveLength(0)
  })

  it('проводит всю структурированную квартиру через объём, не меняя её 2D-координаты', () => {
    // Test-only vertical values: the dataset does not prove measured heights.
    const source = openApartment.geometry as PlanGeometry
    const measured: PlanGeometry = {
      ...source,
      status: 'confirmed',
      walls: source.walls.map((wall) => ({
        ...wall,
        heightCm: 270,
        measuredThicknessCm: wall.thicknessCm,
      })),
      openings: source.openings.map((opening) => ({
        ...opening,
        bottomCm: opening.type === 'window' ? 80 : 0,
        heightCm: opening.type === 'window' ? 140 : 210,
      })),
    }
    const before = structuredClone(measured)
    const model = planVolume(measured)
    expect(model).not.toBeNull()
    expect(model?.floor).toEqual(source.footprint)
    expect(model?.voids).toHaveLength(source.voids?.length ?? 0)
    expect(model?.openings).toHaveLength(source.openings.length)
    expect(model?.openings.every((opening) => opening.cut)).toBe(true)
    expect(model?.walls.every((wall) => wall.solid)).toBe(true)
    expect(model?.solidFaces.length).toBeGreaterThan(source.walls.length * 6)
    expect(
      model?.solidFaces.every((face) =>
        face.points.every(
          (point) =>
            Number.isFinite(point.xCm) &&
            Number.isFinite(point.yCm) &&
            point.zCm >= 0 &&
            point.zCm <= 270,
        ),
      ),
    ).toBe(true)
    expect(measured).toEqual(before)
  })
  it('keeps the floor and walls intact when opening heights are unknown', () => {
    const result = planVolume(geometry)

    expect(result?.floor).toEqual(geometry.footprint)
    expect(result?.voids).toEqual([geometry.voids?.[0]?.polygon])
    expect(result?.walls.map(({ start, end }) => [start.xCm, end.xCm])).toEqual([[0, 400]])
    expect(result?.openings.map(({ start, end }) => [start.xCm, end.xCm])).toEqual([
      [100, 190],
      [250, 350],
    ])
  })

  it('does not promote an unfinished or unverified PDF plan to wall volume', () => {
    expect(planVolume({ ...geometry, status: 'draft' })).toBeNull()
    expect(planVolume({ ...geometry, footprint: undefined })).toBeNull()
    expect(
      planVolume({
        ...geometry,
        pdfCalibration: { sourceSha256: 'source', pdfPage: 1 } as NonNullable<
          PlanGeometry['pdfCalibration']
        >,
      }),
    ).toBeNull()
  })

  it('строит оконный вырез с подоконной частью и перемычкой только при всех мерках', () => {
    const window = geometry.openings[1]
    if (!window) throw new Error('Missing test window')
    const measured = {
      ...geometry,
      walls: geometry.walls.map((wall) => ({ ...wall, heightCm: 200 })),
      openings: [{ ...window, bottomCm: 50, heightCm: 100 }],
    }
    const result = planVolume(measured)
    expect(
      result?.walls.map((wall) => [wall.start.xCm, wall.end.xCm, wall.bottomCm, wall.topCm]),
    ).toEqual([
      [0, 250, 0, 200],
      [250, 350, 0, 50],
      [250, 350, 150, 200],
      [350, 400, 0, 200],
    ])
    expect(result?.openings[0]?.cut).toBe(true)

    const incomplete = { ...measured, openings: [{ ...window, heightCm: 100, sillHeightCm: 50 }] }
    expect(planVolume(incomplete)?.walls).toHaveLength(1)
    expect(planVolume(incomplete)?.openings[0]?.cut).toBe(false)
    expect(planVolume({ ...measured, walls: geometry.walls })?.openings[0]?.cut).toBe(false)
    expect(
      planVolume({ ...measured, openings: [{ ...window, heightCm: 100, bottomCm: 150 }] }),
    ).toBeNull()
  })

  it('shows only source-proven PDF face intervals and marks opening positions', () => {
    const firstWall = geometry.walls[0]
    const firstOpening = geometry.openings[0]
    const footprint = geometry.footprint
    if (!firstWall || !firstOpening || !footprint) throw new Error('Missing test geometry')
    const secondWall = {
      ...firstWall,
      id: 'wall-2',
      start: { xCm: 0, yCm: 20 },
      end: { xCm: 400, yCm: 20 },
    }
    const secondOpening = { ...firstOpening, id: 'door-2', wallId: secondWall.id }
    const room = { name: 'Комната', polygon: footprint }
    const segment = { operationIndex: 1, subpathIndex: 1, segmentIndex: 1 }
    const pair: PlanWallFacePair = {
      faces: [
        {
          wall: structuredClone(firstWall),
          start: { xCm: 50, yCm: 0 },
          end: { xCm: 350, yCm: 0 },
          nativeSegment: segment,
        },
        {
          wall: structuredClone(secondWall),
          start: { xCm: 50, yCm: 20 },
          end: { xCm: 350, yCm: 20 },
          nativeSegment: segment,
        },
      ],
      openings: [structuredClone(firstOpening), structuredClone(secondOpening)],
    }
    const pdfGeometry: PlanGeometry = {
      ...geometry,
      walls: [firstWall, secondWall],
      openings: [firstOpening, secondOpening],
      rooms: [room],
      pdfCalibration: {
        sourceSha256: 'source',
        pdfPage: 1,
        exteriorBoundaryRole: 'floor',
        cmPerPoint: 1,
        origin: { x: 0, y: 0 },
        anchorRoomNumbers: [],
        labelIndexes: [],
        derivedOpeningIds: [],
        sourceWallFacePairs: [pair],
        wallFaceRoomPolygons: [room.polygon],
      },
    }

    const result = planVolume(pdfGeometry)
    expect(result?.wallSource).toBe('pdf-faces')
    expect(result?.walls.map(({ start, end }) => [start.xCm, end.xCm])).toEqual([
      [50, 350],
      [50, 350],
    ])
    expect(result?.openings).toHaveLength(2)

    // Real PDF proof strips stop at the opening. Neither strip includes its gap.
    const split: PlanGeometry = structuredClone(pdfGeometry)
    if (!split.pdfCalibration) throw new Error('Missing PDF calibration')
    split.pdfCalibration.sourceWallFacePairs = [
      {
        ...structuredClone(pair),
        faces: pair.faces.map((face) => ({
          ...structuredClone(face),
          end: { ...face.end, xCm: 100 },
        })) as PlanWallFacePair['faces'],
      },
      {
        ...structuredClone(pair),
        faces: pair.faces.map((face) => ({
          ...structuredClone(face),
          start: { ...face.start, xCm: 190 },
        })) as PlanWallFacePair['faces'],
      },
    ]
    const splitBefore = structuredClone(split)
    const splitVolume = planVolume(split)
    expect(splitVolume?.walls.map((wall) => [wall.start.xCm, wall.end.xCm])).toEqual([
      [50, 100],
      [50, 100],
      [190, 350],
      [190, 350],
    ])
    expect(splitVolume?.openings).toHaveLength(2)
    expect(splitVolume?.openings.map((opening) => [opening.start.xCm, opening.end.xCm])).toEqual([
      [100, 190],
      [100, 190],
    ])
    expect(new Set(splitVolume?.openings.map((opening) => opening.id)).size).toBe(2)
    if (!splitVolume) throw new Error('Missing split PDF volume')
    const splitScene = buildPlanScene(splitVolume)
    try {
      expect(splitScene.lines.filter((line) => line.kind === 'opening')).toHaveLength(2)
    } finally {
      for (const item of [...splitScene.surfaces, ...splitScene.lines]) item.geometry.dispose()
    }
    expect(split).toEqual(splitBefore)
    const editedOpening = split.openings[0]
    if (!editedOpening) throw new Error('Missing PDF opening')
    editedOpening.widthCm += 1
    expect(planVolume(split)).toBeNull()

    // Vertical user measurements do not alter the source-proven horizontal face relation.
    pdfGeometry.walls = pdfGeometry.walls.map((wall) => ({
      ...wall,
      heightCm: 270,
      measuredThicknessCm: 20,
    }))
    pdfGeometry.openings = pdfGeometry.openings.map((opening) => ({
      ...opening,
      bottomCm: 0,
      heightCm: 210,
    }))
    const vertical = planVolume(pdfGeometry)
    expect(vertical?.openings.every((opening) => opening.cut)).toBe(true)
    expect(vertical?.walls.filter((wall) => wall.bottomCm === 210)).toHaveLength(2)
    expect(vertical?.solidFaces).toHaveLength(0)

    const editedWall = pdfGeometry.walls[0]
    const calibration = pdfGeometry.pdfCalibration
    if (!editedWall || !calibration) throw new Error('Missing PDF proof')
    editedWall.end.xCm += 1
    expect(planVolume(pdfGeometry)).toBeNull()
    editedWall.end.xCm -= 1
    calibration.exteriorBoundaryRole = 'outer-wall-envelope'
    expect(planVolume(pdfGeometry)).toBeNull()
  })
})
