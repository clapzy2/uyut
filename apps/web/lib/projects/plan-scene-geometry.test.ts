import { BufferGeometry, Vector3 } from 'three'
import { describe, expect, it, vi } from 'vitest'
import { buildPlanScene, type PlanScene } from './plan-scene-geometry'
import { type PlanVolume, planVolume } from './plan-volume'

function rectangle(x: number, y: number, width: number, depth: number) {
  return [
    { xCm: x, yCm: y },
    { xCm: x + width, yCm: y },
    { xCm: x + width, yCm: y + depth },
    { xCm: x, yCm: y + depth },
  ]
}

function model(overrides: Partial<PlanVolume> = {}): PlanVolume {
  return {
    floor: rectangle(100, 200, 400, 300),
    voids: [],
    walls: [],
    openings: [],
    wallSource: 'centerline',
    solidFaces: [],
    joinedSolids: false,
    issues: [],
    ...overrides,
  }
}

function required<T>(value: T | null | undefined): T {
  if (value === null || value === undefined) throw new Error('Missing expected scene element')
  return value
}

function positions(geometry: BufferGeometry): [number, number, number][] {
  const attribute = geometry.getAttribute('position')
  return Array.from({ length: attribute.count }, (_, index) => [
    attribute.getX(index),
    attribute.getY(index),
    attribute.getZ(index),
  ])
}

function area(geometry: BufferGeometry): number {
  const indices = geometry.getIndex()
  const attribute = geometry.getAttribute('position')
  if (!indices) throw new Error('Missing triangle indices')
  let total = 0
  for (let index = 0; index < indices.count; index += 3) {
    const a = new Vector3().fromBufferAttribute(attribute, indices.getX(index))
    const b = new Vector3().fromBufferAttribute(attribute, indices.getX(index + 1))
    const c = new Vector3().fromBufferAttribute(attribute, indices.getX(index + 2))
    total += b.sub(a).cross(c.sub(a)).length() / 2
  }
  return total
}

function dispose(scene: PlanScene) {
  for (const item of [...scene.surfaces, ...scene.lines]) item.geometry.dispose()
}

describe('геометрия настоящей 3D-сцены', () => {
  it('переводит сантиметры в метры и переносит высоту на ось Y, не сдвигая начало плана', () => {
    const scene = buildPlanScene(
      model({
        walls: [
          {
            id: 'wall',
            wallId: 'wall',
            kind: 'outer',
            start: { xCm: 100, yCm: 200 },
            end: { xCm: 500, yCm: 200 },
            bottomCm: 90,
            topCm: 270,
          },
        ],
      }),
    )
    expect(positions(required(scene.surfaces[0]).geometry)).toEqual([
      [1, 0, 2],
      [5, 0, 2],
      [5, 0, 5],
      [1, 0, 5],
    ])
    const wall = required(scene.surfaces.find((item) => item.id === 'wall'))
    const points = positions(wall.geometry)
    expect(points[0]?.[0]).toBe(1)
    expect(points[0]?.[1]).toBeCloseTo(0.9)
    expect(points[0]?.[2]).toBe(2)
    expect(points[2]?.[1]).toBeCloseTo(2.7)
    expect(area(wall.geometry)).toBeCloseTo(7.2)
    dispose(scene)
  })

  it('вырезает техническое отверстие из пола и сохраняет его точную площадь', () => {
    const scene = buildPlanScene(model({ voids: [rectangle(200, 300, 100, 100)] }))
    expect(area(required(scene.surfaces[0]).geometry)).toBeCloseTo(11)
    // No triangle centroid can sit in the shaft.
    const geometry = required(scene.surfaces[0]).geometry
    const attribute = geometry.getAttribute('position')
    const indices = required(geometry.getIndex())
    for (let index = 0; index < indices.count; index += 3) {
      const vertices = [0, 1, 2].map((offset) =>
        new Vector3().fromBufferAttribute(attribute, indices.getX(index + offset)),
      )
      const centre = vertices
        .reduce((sum, vertex) => sum.add(vertex), new Vector3())
        .divideScalar(3)
      expect(centre.x > 2 && centre.x < 3 && centre.z > 3 && centre.z < 4).toBe(false)
    }
    dispose(scene)
  })

  it('вырезает отверстие в вертикальной грани и не дублирует её плоской стеной', () => {
    const scene = buildPlanScene(
      model({
        walls: [
          {
            id: 'solid-wall',
            wallId: 'wall',
            kind: 'outer',
            start: { xCm: 100, yCm: 200 },
            end: { xCm: 500, yCm: 200 },
            bottomCm: 0,
            topCm: 300,
            solid: true,
            thicknessCm: 20,
          },
        ],
        solidFaces: [
          {
            id: 'solid-face',
            kind: 'outer',
            role: 'face',
            points: [
              { xCm: 100, yCm: 200, zCm: 0 },
              { xCm: 500, yCm: 200, zCm: 0 },
              { xCm: 500, yCm: 200, zCm: 300 },
              { xCm: 100, yCm: 200, zCm: 300 },
            ],
            holes: [
              [
                { xCm: 200, yCm: 200, zCm: 100 },
                { xCm: 300, yCm: 200, zCm: 100 },
                { xCm: 300, yCm: 200, zCm: 200 },
                { xCm: 200, yCm: 200, zCm: 200 },
              ],
            ],
          },
        ],
      }),
    )
    const walls = scene.surfaces.filter((item) => item.kind === 'wall')
    expect(walls).toHaveLength(1)
    expect(walls[0]?.id).toBe('solid-face')
    expect(area(required(walls[0]).geometry)).toBeCloseTo(11)
    expect(scene.lines).toEqual([])
    dispose(scene)
  })

  it('принимает настоящие объединённые грани стен из 2D-модели с дверью и окном', () => {
    const volume = required(
      planVolume({
        version: 1,
        status: 'confirmed',
        widthCm: 400,
        heightCm: 300,
        footprint: rectangle(0, 0, 400, 300),
        rooms: [],
        warnings: [],
        walls: [
          {
            id: 'top',
            kind: 'outer',
            start: { xCm: 0, yCm: 0 },
            end: { xCm: 400, yCm: 0 },
            heightCm: 270,
            measuredThicknessCm: 20,
          },
          {
            id: 'right',
            kind: 'outer',
            start: { xCm: 400, yCm: 0 },
            end: { xCm: 400, yCm: 300 },
            heightCm: 270,
            measuredThicknessCm: 20,
          },
        ],
        openings: [
          {
            id: 'door',
            type: 'door',
            wallId: 'top',
            offsetCm: 100,
            widthCm: 90,
            bottomCm: 0,
            heightCm: 210,
          },
          {
            id: 'window',
            type: 'window',
            wallId: 'right',
            offsetCm: 100,
            widthCm: 100,
            bottomCm: 90,
            heightCm: 120,
          },
        ],
      }),
    )
    expect(volume.joinedSolids).toBe(true)
    const scene = buildPlanScene(volume)
    const wallSurfaces = scene.surfaces.filter((item) => item.kind === 'wall')
    expect(wallSurfaces).toHaveLength(volume.solidFaces.length)
    expect(wallSurfaces.every((item) => area(item.geometry) > 0)).toBe(true)
    expect(scene.lines.filter((item) => item.kind === 'opening')).toHaveLength(2)
    expect(scene.lines.every((item) => item.geometry.getAttribute('position').count === 8)).toBe(
      true,
    )
    dispose(scene)
  })

  it('строит вогнутый пол при любом направлении и замкнутом исходном кольце', () => {
    const floor = [
      { xCm: 0, yCm: 0 },
      { xCm: 400, yCm: 0 },
      { xCm: 400, yCm: 100 },
      { xCm: 200, yCm: 100 },
      { xCm: 200, yCm: 300 },
      { xCm: 0, yCm: 300 },
    ]
    for (const ring of [
      floor,
      [...floor].reverse(),
      [...floor, required(floor[0]), required(floor[0])],
    ]) {
      const scene = buildPlanScene(model({ floor: ring }))
      expect(area(required(scene.surfaces[0]).geometry)).toBeCloseTo(8)
      dispose(scene)
    }
  })

  it('поддерживает наклонные плоскости, а не только горизонтальные и вертикальные', () => {
    const scene = buildPlanScene(
      model({
        solidFaces: [
          {
            id: 'sloped',
            kind: 'outer',
            role: 'cap',
            points: [
              { xCm: 0, yCm: 0, zCm: 0 },
              { xCm: 200, yCm: 0, zCm: 200 },
              { xCm: 200, yCm: 200, zCm: 200 },
              { xCm: 0, yCm: 200, zCm: 0 },
            ],
          },
        ],
      }),
    )
    expect(
      area(required(scene.surfaces.find((item) => item.id === 'sloped')).geometry),
    ).toBeCloseTo(4 * Math.SQRT2)
    dispose(scene)
  })

  it('сохраняет плоскими мебель, стены и проёмы с неизвестной высотой', () => {
    const scene = buildPlanScene(
      model({
        walls: [
          {
            id: 'unknown-wall',
            wallId: 'wall',
            kind: 'outer',
            start: { xCm: 100, yCm: 200 },
            end: { xCm: 500, yCm: 200 },
            bottomCm: 0,
          },
        ],
        furniture: [{ id: 'chair', title: 'Стул', floor: rectangle(200, 300, 50, 50) }],
        openings: [
          {
            id: 'unknown',
            type: 'door',
            start: { xCm: 100, yCm: 200 },
            end: { xCm: 200, yCm: 200 },
            cut: false,
          },
          {
            id: 'only-bottom',
            type: 'window',
            start: { xCm: 300, yCm: 200 },
            end: { xCm: 400, yCm: 200 },
            bottomCm: 90,
            cut: false,
          },
          {
            id: 'only-height',
            type: 'balcony',
            start: { xCm: 400, yCm: 200 },
            end: { xCm: 500, yCm: 200 },
            heightCm: 210,
            cut: false,
          },
        ],
      }),
    )
    const item = required(scene.surfaces.find((surface) => surface.kind === 'furniture'))
    expect(item.footprintOnly).toBe(true)
    expect(scene.surfaces.filter((surface) => surface.kind === 'furniture')).toHaveLength(1)
    expect(scene.surfaces.some((surface) => surface.kind === 'wall')).toBe(false)
    expect(scene.lines).toHaveLength(4)
    expect(scene.lines.every((line) => line.unknown)).toBe(true)
    expect(
      [
        ...positions(item.geometry),
        ...scene.lines.flatMap((line) => positions(line.geometry)),
      ].every((point) => point[1] === 0),
    ).toBe(true)
    dispose(scene)
  })

  it('строит замкнутый контур проёма только по двум известным вертикальным меркам', () => {
    const scene = buildPlanScene(
      model({
        openings: [
          {
            id: 'window',
            type: 'window',
            start: { xCm: 200, yCm: 200 },
            end: { xCm: 300, yCm: 200 },
            bottomCm: 100,
            heightCm: 150,
            cut: true,
          },
        ],
      }),
    )
    const opening = required(scene.lines[0])
    expect(opening.unknown).toBe(false)
    expect(positions(opening.geometry)).toEqual([
      [2, 1, 2],
      [3, 1, 2],
      [3, 1, 2],
      [3, 2.5, 2],
      [3, 2.5, 2],
      [2, 2.5, 2],
      [2, 2.5, 2],
      [2, 1, 2],
    ])
    dispose(scene)
  })

  it('сохраняет идентификаторы комнат, каждой копии мебели и предварительных рабочих зон', () => {
    const scene = buildPlanScene(
      model({
        rooms: [{ id: 'living', title: 'Гостиная', floor: rectangle(100, 200, 400, 300) }],
        furniture: [
          {
            id: 'chair-1',
            itemId: 'chair',
            roomId: 'living',
            title: 'Стул',
            floor: rectangle(200, 300, 50, 50),
            heightCm: 80,
          },
          {
            id: 'chair-2',
            itemId: 'chair',
            roomId: 'living',
            title: 'Стул',
            floor: rectangle(300, 300, 50, 50),
          },
        ],
        floorZones: [
          {
            id: 'zone',
            roomId: 'living',
            title: 'Рабочая зона',
            kind: 'operation',
            floor: rectangle(200, 350, 50, 60),
            preliminary: true,
          },
        ],
      }),
    )
    expect(scene.surfaces.find((item) => item.kind === 'room')).toMatchObject({ roomId: 'living' })
    const first = scene.surfaces.filter((item) => item.furnitureId === 'chair-1')
    const second = scene.surfaces.filter((item) => item.furnitureId === 'chair-2')
    expect(first).toHaveLength(6)
    expect(first.every((item) => item.roomId === 'living' && item.footprintOnly === false)).toBe(
      true,
    )
    expect(
      Math.max(...first.flatMap((item) => positions(item.geometry).map((point) => point[1]))),
    ).toBeCloseTo(0.8)
    expect(second).toHaveLength(1)
    expect(second[0]).toMatchObject({ roomId: 'living', footprintOnly: true })
    expect(scene.surfaces.find((item) => item.id === 'zone')).toMatchObject({
      roomId: 'living',
      preliminary: true,
      kind: 'zone',
    })
    dispose(scene)
  })

  it('не меняет исходные полигоны, отверстия и метаданные при триангуляции', () => {
    const source = model({ voids: [rectangle(200, 300, 100, 100).reverse()] })
    const before = structuredClone(source)
    const scene = buildPlanScene(source)
    expect(source).toEqual(before)
    required(scene.surfaces[0]).geometry.getAttribute('position').setXYZ(0, 0, 0, 0)
    expect(source).toEqual(before)
    dispose(scene)
  })

  it('вырезает подтверждённые отверстия и в полу комнаты, не закрывая шахту подсветкой', () => {
    const scene = buildPlanScene(
      model({
        voids: [rectangle(200, 300, 100, 100)],
        rooms: [
          { id: 'with-void', title: 'Комната с шахтой', floor: rectangle(100, 200, 250, 300) },
          { id: 'without-void', title: 'Другая комната', floor: rectangle(350, 200, 150, 300) },
        ],
      }),
    )
    expect(
      area(required(scene.surfaces.find((item) => item.roomId === 'with-void')).geometry),
    ).toBeCloseTo(6.5)
    expect(
      area(required(scene.surfaces.find((item) => item.roomId === 'without-void')).geometry),
    ).toBeCloseTo(4.5)
    dispose(scene)
  })

  it('отклоняет комнату, пересекающую отверстие либо целиком находящуюся в нём', () => {
    for (const floor of [rectangle(100, 200, 150, 300), rectangle(220, 320, 20, 20)]) {
      expect(() =>
        buildPlanScene(
          model({
            voids: [rectangle(200, 300, 100, 100)],
            rooms: [{ id: 'invalid', title: 'Комната', floor }],
          }),
        ),
      ).toThrow('intersects a floor void')
    }
  })

  it('отклоняет самопересечения, вырожденные и нечисловые контуры', () => {
    for (const floor of [
      [
        { xCm: 0, yCm: 0 },
        { xCm: 400, yCm: 300 },
        { xCm: 0, yCm: 300 },
        { xCm: 400, yCm: 0 },
      ],
      [
        { xCm: 0, yCm: 0 },
        { xCm: 100, yCm: 0 },
        { xCm: 200, yCm: 0 },
      ],
      rectangle(0, 0, Number.NaN, 300),
      rectangle(0, 0, Number.POSITIVE_INFINITY, 300),
      rectangle(0, 0, Number.MAX_VALUE, 300),
      [],
    ])
      expect(() => buildPlanScene(model({ floor }))).toThrow()
  })

  it('не рисует выходящие наружу, касающиеся и взаимно вложенные отверстия', () => {
    for (const voids of [
      [rectangle(0, 0, 100, 100)],
      [rectangle(100, 300, 100, 100)],
      [rectangle(200, 300, 100, 100), rectangle(250, 350, 100, 100)],
      [rectangle(200, 300, 200, 100), rectangle(250, 320, 50, 50)],
    ])
      expect(() => buildPlanScene(model({ voids }))).toThrow()
  })

  it('отклоняет неплоские грани и некорректные известные высоты', () => {
    expect(() =>
      buildPlanScene(
        model({
          solidFaces: [
            {
              id: 'warped',
              kind: 'outer',
              role: 'face',
              points: [
                { xCm: 0, yCm: 0, zCm: 0 },
                { xCm: 100, yCm: 0, zCm: 0 },
                { xCm: 100, yCm: 100, zCm: 10 },
                { xCm: 0, yCm: 100, zCm: 0 },
              ],
            },
          ],
        }),
      ),
    ).toThrow('not coplanar')
    for (const heightCm of [0, -1, Number.NaN, Number.POSITIVE_INFINITY]) {
      expect(() =>
        buildPlanScene(
          model({
            furniture: [
              { id: 'invalid', title: 'Стул', floor: rectangle(200, 300, 50, 50), heightCm },
            ],
          }),
        ),
      ).toThrow()
    }
    expect(() =>
      buildPlanScene(
        model({
          walls: [
            {
              id: 'wall',
              wallId: 'wall',
              kind: 'outer',
              start: { xCm: 100, yCm: 200 },
              end: { xCm: 200, yCm: 200 },
              bottomCm: 100,
              topCm: 90,
            },
          ],
        }),
      ),
    ).toThrow()
    expect(() =>
      buildPlanScene(
        model({
          openings: [
            {
              id: 'zero-width',
              type: 'door',
              start: { xCm: 200, yCm: 200 },
              end: { xCm: 200, yCm: 200 },
              bottomCm: 0,
              heightCm: 210,
              cut: true,
            },
          ],
        }),
      ),
    ).toThrow('measurable span')
  })

  it('освобождает уже построенные поверхности и линии, если последующий элемент неверен', () => {
    const disposeSpy = vi.spyOn(BufferGeometry.prototype, 'dispose')
    try {
      expect(() =>
        buildPlanScene(
          model({
            walls: [
              {
                id: 'wall',
                wallId: 'wall',
                kind: 'outer',
                start: { xCm: 100, yCm: 200 },
                end: { xCm: 200, yCm: 200 },
                bottomCm: 0,
              },
            ],
            openings: [
              {
                id: 'bad',
                type: 'window',
                start: { xCm: 200, yCm: 200 },
                end: { xCm: 300, yCm: 200 },
                heightCm: -1,
                cut: false,
              },
            ],
          }),
        ),
      ).toThrow()
      expect(disposeSpy).toHaveBeenCalledTimes(2)
    } finally {
      disposeSpy.mockRestore()
    }
  })
})
