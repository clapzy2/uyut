import type { PlanGeometry, PlanPoint } from '@uyut/db'
import polygonClipping, { type MultiPolygon, type Polygon } from 'polygon-clipping'
import { BufferGeometry, Vector3 } from 'three'
import { describe, expect, it, vi } from 'vitest'
import openApartment from '../../../../jobs/fixtures/open-swiss-apartment-35063-geometry.json'
import { buildPlanScene, type PlanScene } from './plan-scene-geometry'
import { planVolume } from './plan-volume'

function confirmedSource(): PlanGeometry {
  // This enables the structured test route, not a claim of a verified on-site measurement.
  return { ...structuredClone(openApartment.geometry as PlanGeometry), status: 'confirmed' }
}

function required<T>(value: T | null | undefined): T {
  if (value === null || value === undefined) throw new Error('Missing expected source geometry')
  return value
}

function polygonArea(points: readonly PlanPoint[]): number {
  return Math.abs(
    points.reduce((sum, point, index) => {
      const next = required(points[(index + 1) % points.length])
      return sum + point.xCm * next.yCm - next.xCm * point.yCm
    }, 0) / 2,
  )
}

function triangles(geometry: BufferGeometry): Vector3[][] {
  const positions = geometry.getAttribute('position')
  const indices = required(geometry.getIndex())
  return Array.from({ length: indices.count / 3 }, (_, triangle) =>
    [0, 1, 2].map((offset) =>
      new Vector3().fromBufferAttribute(positions, indices.getX(triangle * 3 + offset)),
    ),
  )
}

function triangleArea(geometry: BufferGeometry): number {
  return triangles(geometry).reduce((sum, triangle) => {
    const [a, b, c] = triangle.map((point) => point.clone())
    return (
      sum +
      required(b)
        .sub(required(a))
        .cross(required(c).sub(required(a)))
        .length() /
        2
    )
  }, 0)
}

function intersectionArea(polygons: MultiPolygon): number {
  return polygons.reduce(
    (total, polygon) =>
      total +
      polygon.reduce((area, ring, index) => {
        const ringArea = polygonArea(ring.map(([xCm, yCm]) => ({ xCm, yCm })))
        return area + (index === 0 ? ringArea : -ringArea)
      }, 0),
    0,
  )
}

function dispose(scene: PlanScene): void {
  for (const element of [...scene.surfaces, ...scene.lines]) element.geometry.dispose()
}

describe('3D-маршрут независимой структурированной квартиры Swiss 35063', () => {
  it('не принимает исходный черновик за подтверждённый план', () => {
    expect(openApartment.geometry.status).toBe('draft')
    expect(planVolume(openApartment.geometry as PlanGeometry)).toBeNull()
  })

  it('переносит весь план без выдуманных высот, толщин и изменений исходника', () => {
    const source = confirmedSource()
    const before = structuredClone(source)
    const volume = required(planVolume(source))
    const scene = buildPlanScene(volume)
    try {
      expect(source.walls).toHaveLength(38)
      expect(source.openings).toHaveLength(9)
      expect(source.footprint).toHaveLength(80)
      expect(source.voids).toHaveLength(2)
      expect(scene.surfaces).toHaveLength(1)
      expect(scene.lines.filter((line) => line.kind === 'wall')).toHaveLength(38)
      expect(scene.lines.filter((line) => line.kind === 'opening')).toHaveLength(9)
      expect(volume.solidFaces).toHaveLength(0)
      expect(volume.walls.every((wall) => wall.topCm === undefined && !wall.solid)).toBe(true)
      expect(volume.openings.every((opening) => !opening.cut)).toBe(true)
      expect(scene.lines.every((line) => line.unknown)).toBe(true)
      for (const element of [...scene.surfaces, ...scene.lines]) {
        const positions = element.geometry.getAttribute('position')
        for (let index = 0; index < positions.count; index++) {
          expect(positions.getY(index)).toBe(0)
          expect(Number.isFinite(positions.getX(index))).toBe(true)
          expect(Number.isFinite(positions.getZ(index))).toBe(true)
        }
      }
      expect(source).toEqual(before)
      expect(openApartment.geometry.status).toBe('draft')
    } finally {
      dispose(scene)
    }
  })

  it('сохраняет площадь сложного пола и не заполняет две исходные пустоты треугольниками', () => {
    const source = confirmedSource()
    const scene = buildPlanScene(required(planVolume(source)))
    try {
      const floor = required(scene.surfaces.find((surface) => surface.kind === 'floor')).geometry
      const expectedAreaM2 =
        (polygonArea(required(source.footprint)) -
          required(source.voids).reduce((area, hole) => area + polygonArea(hole.polygon), 0)) /
        10_000
      expect(triangleArea(floor)).toBeCloseTo(expectedAreaM2, 5)
      const positions = floor.getAttribute('position')
      const sourcePoints = [
        required(source.footprint),
        ...required(source.voids).map((v) => v.polygon),
      ].flat()
      expect(positions.count).toBe(sourcePoints.length)
      sourcePoints.forEach((point, index) => {
        expect(positions.getX(index)).toBeCloseTo(point.xCm / 100, 5)
        expect(positions.getZ(index)).toBeCloseTo(point.yCm / 100, 5)
      })
      for (const hole of required(source.voids)) {
        const holePolygon: Polygon = [
          hole.polygon.map((point) => [point.xCm / 100, point.yCm / 100]),
        ]
        const filledArea = triangles(floor).reduce((area, triangle) => {
          const polygon: Polygon = [triangle.map((point) => [point.x, point.z])]
          return area + intersectionArea(polygonClipping.intersection(polygon, holePolygon))
        }, 0)
        expect(filledArea).toBeLessThan(0.000001)
      }
    } finally {
      dispose(scene)
    }
  })

  it('сохраняет девять проёмов с исходной шириной и привязкой к конкретной стене', () => {
    const source = confirmedSource()
    const volume = required(planVolume(source))
    const scene = buildPlanScene(volume)
    try {
      for (const opening of source.openings) {
        const wall = required(source.walls.find((candidate) => candidate.id === opening.wallId))
        const span = required(
          volume.openings.find((candidate) => candidate.id === `${opening.id}-0`),
        )
        const line = required(scene.lines.find((candidate) => candidate.id === span.id))
        const positions = line.geometry.getAttribute('position')
        const direction = new Vector3(
          wall.end.xCm - wall.start.xCm,
          0,
          wall.end.yCm - wall.start.yCm,
        ).normalize()
        const start = new Vector3(wall.start.xCm / 100, 0, wall.start.yCm / 100).addScaledVector(
          direction,
          opening.offsetCm / 100,
        )
        const end = start.clone().addScaledVector(direction, opening.widthCm / 100)
        expect(positions.count).toBe(2)
        expect(new Vector3().fromBufferAttribute(positions, 0).distanceTo(start)).toBeLessThan(
          0.000001,
        )
        expect(new Vector3().fromBufferAttribute(positions, 1).distanceTo(end)).toBeLessThan(
          0.000001,
        )
      }
    } finally {
      dispose(scene)
    }
  })

  it('строит восемь комнат из существующих полигонов без высот и новых координат', () => {
    const source = confirmedSource()
    const volume = required(planVolume(source))
    volume.rooms = source.rooms.map((room, index) => ({
      id: `source-room-${index}`,
      title: room.name,
      floor: room.polygon,
    }))
    const before = structuredClone(volume)
    const scene = buildPlanScene(volume)
    try {
      expect(scene.surfaces.filter((surface) => surface.kind === 'room')).toHaveLength(8)
      for (const room of volume.rooms) {
        const surface = required(scene.surfaces.find((candidate) => candidate.roomId === room.id))
        expect(triangleArea(surface.geometry)).toBeCloseTo(polygonArea(room.floor) / 10_000, 5)
        const positions = surface.geometry.getAttribute('position')
        for (let index = 0; index < positions.count; index++) expect(positions.getY(index)).toBe(0)
      }
      expect(volume).toEqual(before)
    } finally {
      dispose(scene)
    }
  })

  it('освобождает все созданные ресурсы при ошибке в последнем проёме', () => {
    const volume = required(planVolume(confirmedSource()))
    required(volume.openings.at(-1)).heightCm = Number.NaN
    const release = vi.spyOn(BufferGeometry.prototype, 'dispose')
    try {
      expect(() => buildPlanScene(volume)).toThrow(
        'A measured scene height must be finite and positive',
      )
      expect(release).toHaveBeenCalledTimes(47)
      expect(new Set(release.mock.contexts).size).toBe(47)
    } finally {
      release.mockRestore()
    }
  })
})
