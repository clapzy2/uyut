import { layoutRoom, type RoomLayout } from '@uyut/catalog'
import type { PlanGeometry } from '@uyut/db'
import type { BufferGeometry } from 'three'
import { describe, expect, it } from 'vitest'
import { apartmentVolume } from './apartment-volume'
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

// Все мерки заданы для синтетического контроля, а не взяты из обмера квартиры.
function sourceGeometry(): PlanGeometry {
  return {
    version: 1,
    status: 'confirmed',
    widthCm: 900,
    heightCm: 700,
    footprint: rectangle(0, 0, 900, 700),
    rooms: [{ name: 'Гостиная', polygon: rectangle(100, 200, 400, 300) }],
    walls: [
      {
        id: 'top',
        kind: 'outer',
        start: { xCm: 0, yCm: 0 },
        end: { xCm: 900, yCm: 0 },
        heightCm: 270,
      },
    ],
    openings: [
      {
        id: 'window',
        type: 'window',
        wallId: 'top',
        offsetCm: 100,
        widthCm: 120,
        bottomCm: 90,
        heightCm: 130,
      },
    ],
    warnings: [],
  }
}

function sourceLayout(): RoomLayout {
  return {
    ...layoutRoom({ widthCm: 400, depthCm: 300 }, []),
    floorPolygon: rectangle(0, 0, 400, 300),
    placed: [
      {
        id: 'chair-placement',
        itemId: 'chair',
        title: 'Контрольный стул',
        xCm: 25,
        yCm: 30,
        widthCm: 60,
        depthCm: 60,
        wall: 'center',
      },
    ],
    placementInputs: [
      {
        id: 'chair',
        title: 'Контрольный стул',
        widthCm: 60,
        depthCm: 60,
        heightCm: 85,
        rotation: 0,
      },
    ],
  }
}

function required<T>(value: T | null | undefined): T {
  if (value === null || value === undefined) throw new Error('Нет элемента контрольного сценария')
  return value
}

// Проверяется только JSON-сериализация. Подключения и сохранения в БД здесь нет.
function reopenJson<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T
}

function positions(geometry: BufferGeometry) {
  const attribute = geometry.getAttribute('position')
  return Array.from({ length: attribute.count }, (_, index) => ({
    x: attribute.getX(index),
    y: attribute.getY(index),
    z: attribute.getZ(index),
  }))
}

function checkScene(model: PlanVolume, check: (scene: PlanScene) => void) {
  const before = structuredClone(model)
  const scene = buildPlanScene(model)
  try {
    check(scene)
    expect(model).toEqual(before)
  } finally {
    for (const item of [...scene.surfaces, ...scene.lines]) item.geometry.dispose()
  }
}

describe('синтетические правки 2D после JSON-сериализации в 3D', () => {
  it('после повторного чтения меняет высоту стены и положение, низ и высоту окна', () => {
    const source = sourceGeometry()
    const original = structuredClone(source)
    const edited = reopenJson(source)
    required(edited.walls[0]).heightCm = 300
    Object.assign(required(edited.openings[0]), {
      offsetCm: 350,
      bottomCm: 100,
      heightCm: 150,
    })
    const restored = reopenJson(edited)
    const restoredBefore = structuredClone(restored)
    const initialVolume = required(planVolume(source))
    const revisedVolume = required(planVolume(restored))

    checkScene(initialVolume, (scene) => {
      const window = required(scene.lines.find((line) => line.kind === 'opening'))
      const points = positions(window.geometry)
      expect(Math.min(...points.map((point) => point.x))).toBeCloseTo(1)
      expect(Math.max(...points.map((point) => point.x))).toBeCloseTo(2.2)
      expect(Math.min(...points.map((point) => point.y))).toBeCloseTo(0.9)
      expect(Math.max(...points.map((point) => point.y))).toBeCloseTo(2.2)
    })
    checkScene(revisedVolume, (scene) => {
      const window = required(scene.lines.find((line) => line.kind === 'opening'))
      const points = positions(window.geometry)
      expect(window.unknown).toBe(false)
      expect(Math.min(...points.map((point) => point.x))).toBeCloseTo(3.5)
      expect(Math.max(...points.map((point) => point.x))).toBeCloseTo(4.7)
      expect(Math.min(...points.map((point) => point.y))).toBe(1)
      expect(Math.max(...points.map((point) => point.y))).toBe(2.5)
      expect(points.every((point) => point.z === 0)).toBe(true)
      const walls = scene.surfaces.filter((surface) => surface.kind === 'wall')
      const wallPoints = walls.flatMap((wall) => positions(wall.geometry))
      expect(Math.max(...wallPoints.map((point) => point.y))).toBe(3)
      expect(revisedVolume.openings[0]?.cut).toBe(true)
    })
    expect(source).toEqual(original)
    expect(restored).toEqual(restoredBefore)
  })

  it('не сохраняет прежние объёмы после удаления неизвестных высот стены и окна', () => {
    const source = sourceGeometry()
    const original = structuredClone(source)
    const edited = reopenJson(source)
    delete required(edited.walls[0]).heightCm
    delete required(edited.openings[0]).heightCm
    delete required(edited.openings[0]).bottomCm
    const restored = reopenJson(edited)
    const volume = required(planVolume(restored))

    checkScene(volume, (scene) => {
      expect(scene.surfaces.filter((surface) => surface.kind === 'wall')).toEqual([])
      expect(scene.lines.map((line) => line.kind).sort()).toEqual(['opening', 'wall'])
      for (const line of scene.lines) {
        expect(line.unknown).toBe(true)
        expect(positions(line.geometry).every((point) => point.y === 0)).toBe(true)
      }
      expect(volume.openings[0]?.cut).toBe(false)
      expect(volume.walls[0]?.topCm).toBeUndefined()
    })
    expect(source).toEqual(original)
    expect(restored).toEqual(edited)
  })

  it('при удалении только высоты окна сохраняет стену целой и окно плоским', () => {
    const edited = sourceGeometry()
    delete required(edited.openings[0]).heightCm
    const original = structuredClone(edited)
    const restored = reopenJson(edited)
    const volume = required(planVolume(restored))

    checkScene(volume, (scene) => {
      const walls = scene.surfaces.filter((surface) => surface.kind === 'wall')
      expect(walls).toHaveLength(1)
      expect(
        Math.max(...positions(required(walls[0]).geometry).map((point) => point.y)),
      ).toBeCloseTo(2.7)
      const window = required(scene.lines.find((line) => line.kind === 'opening'))
      expect(window.unknown).toBe(true)
      expect(positions(window.geometry).every((point) => point.y === 0)).toBe(true)
      expect(volume.openings[0]?.cut).toBe(false)
    })
    expect(edited).toEqual(original)
    expect(restored).toEqual(original)
  })

  it('исключает прежнюю расстановку при правке контура с тем же габаритом и принимает актуальную', () => {
    const source = sourceGeometry()
    const layout = sourceLayout()
    const original = structuredClone({ source, layout })
    const edited = reopenJson(source)
    required(edited.rooms[0]).polygon = [
      { xCm: 100, yCm: 200 },
      { xCm: 500, yCm: 200 },
      { xCm: 500, yCm: 450 },
      { xCm: 450, yCm: 500 },
      { xCm: 100, yCm: 500 },
    ]
    const restored = reopenJson(edited)
    const room = { roomId: 'living', roomName: 'Гостиная', layout }
    const outdated = apartmentVolume(restored, [room])
    expect(outdated.notes).toHaveLength(1)
    expect(outdated.notes[0]).toContain('контур или масштаб')
    checkScene(required(outdated.model), (scene) => {
      expect(scene.surfaces.some((surface) => surface.kind === 'furniture')).toBe(false)
      expect(scene.surfaces.some((surface) => surface.kind === 'room')).toBe(false)
    })

    const currentLayout = reopenJson(layout)
    currentLayout.floorPolygon = required(restored.rooms[0]).polygon.map((point) => ({
      xCm: point.xCm - 100,
      yCm: point.yCm - 200,
    }))
    const currentBefore = structuredClone({ restored, currentLayout })
    const current = apartmentVolume(restored, [{ ...room, layout: currentLayout }])
    expect(current.notes).toEqual([])
    const model = required(current.model)
    expect(model.rooms?.[0]?.floor).toEqual(restored.rooms[0]?.polygon)
    expect(model.furniture?.[0]?.floor).toEqual(rectangle(125, 230, 60, 60))
    checkScene(model, (scene) => {
      expect(scene.surfaces.filter((surface) => surface.kind === 'room')).toHaveLength(1)
      expect(scene.surfaces.some((surface) => surface.kind === 'furniture')).toBe(true)
      const chair = required(scene.surfaces.find((surface) => surface.kind === 'furniture'))
      expect(chair.roomId).toBe('living')
      expect(chair.footprintOnly).toBe(false)
    })
    expect({ source, layout }).toEqual(original)
    expect({ restored, currentLayout }).toEqual(currentBefore)
  })

  it('после удаления высоты мебели показывает только её текущий габарит на полу', () => {
    const source = sourceGeometry()
    const layout = sourceLayout()
    const original = structuredClone({ source, layout })
    const editedLayout = reopenJson(layout)
    delete required(editedLayout.placementInputs?.[0]).heightCm
    const restoredLayout = reopenJson(editedLayout)
    const result = apartmentVolume(reopenJson(source), [
      { roomId: 'living', roomName: 'Гостиная', layout: restoredLayout },
    ])
    expect(result.notes).toEqual([])
    const model = required(result.model)
    expect(model.furniture?.[0]?.heightCm).toBeUndefined()
    checkScene(model, (scene) => {
      const furniture = scene.surfaces.filter((surface) => surface.kind === 'furniture')
      expect(furniture).toHaveLength(1)
      expect(furniture[0]?.footprintOnly).toBe(true)
      expect(positions(required(furniture[0]).geometry).every((point) => point.y === 0)).toBe(true)
    })
    expect({ source, layout }).toEqual(original)
    expect(restoredLayout).toEqual(editedLayout)
  })
})
