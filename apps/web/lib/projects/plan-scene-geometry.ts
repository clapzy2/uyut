import type { PlanPoint } from '@uyut/db'
import { BufferGeometry, Float32BufferAttribute, ShapeUtils, Vector2, Vector3 } from 'three'
import type { PlanVolume } from './plan-volume'
import { furnitureFaces } from './room-volume'

export type PlanSceneSurface = {
  id: string
  kind: 'floor' | 'room' | 'wall' | 'furniture' | 'zone'
  geometry: BufferGeometry
  roomId?: string
  furnitureId?: string
  preliminary?: boolean
  footprintOnly?: boolean
}

export type PlanSceneLine = {
  id: string
  kind: 'wall' | 'opening'
  geometry: BufferGeometry
  unknown: boolean
}

export type PlanScene = {
  surfaces: PlanSceneSurface[]
  lines: PlanSceneLine[]
}

type HeightPoint = PlanPoint & { zCm: number }
const EPSILON = 1e-8

/** The scene uses metres, with Y vertical. The original 2D origin stays unchanged. */
function scenePoint(point: HeightPoint): Vector3 {
  if (![point.xCm, point.yCm, point.zCm].every(Number.isFinite)) {
    throw new Error('Scene coordinates must be finite')
  }
  const position = new Vector3(point.xCm / 100, point.zCm / 100, point.yCm / 100)
  if (!position.toArray().every((value) => Number.isFinite(Math.fround(value)))) {
    throw new Error('Scene coordinates exceed the rendering precision range')
  }
  return position
}

function floorPoints(points: readonly PlanPoint[]): HeightPoint[] {
  return points.map((point) => ({ ...point, zCm: 0 }))
}

function openRing(points: readonly HeightPoint[]): Vector3[] {
  const ring = points.map(scenePoint)
  while (ring.length > 1 && ring[0]?.distanceTo(ring[ring.length - 1] as Vector3) === 0) {
    ring.pop()
  }
  if (ring.length < 3) throw new Error('A scene surface needs at least three vertices')
  for (let index = 0; index < ring.length; index++) {
    const point = ring[index] as Vector3
    const next = ring[(index + 1) % ring.length] as Vector3
    if (point.distanceTo(next) <= EPSILON) throw new Error('A scene surface has a zero-length edge')
  }
  return ring
}

function surfaceNormal(ring: readonly Vector3[]): Vector3 {
  const normal = new Vector3()
  for (let index = 0; index < ring.length; index++) {
    const point = ring[index] as Vector3
    const next = ring[(index + 1) % ring.length] as Vector3
    normal.x += (point.y - next.y) * (point.z + next.z)
    normal.y += (point.z - next.z) * (point.x + next.x)
    normal.z += (point.x - next.x) * (point.y + next.y)
  }
  if (!Number.isFinite(normal.length()) || normal.length() <= EPSILON) {
    throw new Error('A scene surface has no measurable area')
  }
  return normal.normalize()
}

function cross(a: Vector2, b: Vector2, c: Vector2): number {
  return (b.x - a.x) * (c.y - a.y) - (b.y - a.y) * (c.x - a.x)
}

function onSegment(point: Vector2, start: Vector2, end: Vector2): boolean {
  return (
    Math.abs(cross(start, end, point)) <= EPSILON &&
    point.x >= Math.min(start.x, end.x) - EPSILON &&
    point.x <= Math.max(start.x, end.x) + EPSILON &&
    point.y >= Math.min(start.y, end.y) - EPSILON &&
    point.y <= Math.max(start.y, end.y) + EPSILON
  )
}

function segmentsMeet(a: Vector2, b: Vector2, c: Vector2, d: Vector2): boolean {
  const first = cross(a, b, c)
  const second = cross(a, b, d)
  const third = cross(c, d, a)
  const fourth = cross(c, d, b)
  return (
    (((first > EPSILON && second < -EPSILON) || (first < -EPSILON && second > EPSILON)) &&
      ((third > EPSILON && fourth < -EPSILON) || (third < -EPSILON && fourth > EPSILON))) ||
    onSegment(c, a, b) ||
    onSegment(d, a, b) ||
    onSegment(a, c, d) ||
    onSegment(b, c, d)
  )
}

function ringIsSimple(ring: readonly Vector2[]): boolean {
  for (let first = 0; first < ring.length; first++) {
    const nextFirst = (first + 1) % ring.length
    const previous = ring[(first + ring.length - 1) % ring.length] as Vector2
    const current = ring[first] as Vector2
    const next = ring[nextFirst] as Vector2
    if (
      Math.abs(cross(previous, current, next)) <= EPSILON &&
      previous.clone().sub(current).dot(next.clone().sub(current)) > EPSILON
    )
      return false
    for (let second = first + 1; second < ring.length; second++) {
      const nextSecond = (second + 1) % ring.length
      if (nextFirst === second || nextSecond === first) continue
      if (
        segmentsMeet(
          ring[first] as Vector2,
          ring[nextFirst] as Vector2,
          ring[second] as Vector2,
          ring[nextSecond] as Vector2,
        )
      )
        return false
    }
  }
  return true
}

function ringsMeet(first: readonly Vector2[], second: readonly Vector2[]): boolean {
  return first.some((point, index) =>
    second.some((other, otherIndex) =>
      segmentsMeet(
        point,
        first[(index + 1) % first.length] as Vector2,
        other,
        second[(otherIndex + 1) % second.length] as Vector2,
      ),
    ),
  )
}

function insideRing(point: Vector2, ring: readonly Vector2[]): boolean {
  let inside = false
  for (let index = 0; index < ring.length; index++) {
    const start = ring[index] as Vector2
    const end = ring[(index + 1) % ring.length] as Vector2
    if (onSegment(point, start, end)) return false
    if (
      start.y > point.y !== end.y > point.y &&
      point.x < ((end.x - start.x) * (point.y - start.y)) / (end.y - start.y) + start.x
    )
      inside = !inside
  }
  return inside
}

function polygonGeometry(
  source: readonly HeightPoint[],
  sourceHoles: readonly (readonly HeightPoint[])[] = [],
): BufferGeometry {
  const rings = [openRing(source), ...sourceHoles.map(openRing)]
  const outer = rings[0] as Vector3[]
  const normal = surfaceNormal(outer)
  const origin = outer[0] as Vector3
  const flatPoints = rings.flat()
  if (flatPoints.some((point) => Math.abs(point.clone().sub(origin).dot(normal)) > 1e-6)) {
    throw new Error('A scene surface is not coplanar')
  }
  // Drop the dominant normal axis: the remaining coordinates retain the most area.
  const dominant = [Math.abs(normal.x), Math.abs(normal.y), Math.abs(normal.z)]
  const axis = dominant.indexOf(Math.max(...dominant))
  const projected = rings.map((ring) =>
    ring.map((point) =>
      axis === 0
        ? new Vector2(point.y, point.z)
        : axis === 1
          ? new Vector2(point.x, point.z)
          : new Vector2(point.x, point.y),
    ),
  )
  if (projected.some((ring) => !ringIsSimple(ring) || Math.abs(ShapeUtils.area(ring)) <= EPSILON)) {
    throw new Error('A scene surface has an invalid contour')
  }
  const contour = projected[0] as Vector2[]
  const holes = projected.slice(1)
  for (const [index, hole] of holes.entries()) {
    if (!insideRing(hole[0] as Vector2, contour) || ringsMeet(contour, hole)) {
      throw new Error('A surface hole must be strictly inside its contour')
    }
    for (const previous of holes.slice(0, index)) {
      if (
        ringsMeet(hole, previous) ||
        insideRing(hole[0] as Vector2, previous) ||
        insideRing(previous[0] as Vector2, hole)
      )
        throw new Error('Surface holes cannot intersect or contain one another')
    }
  }
  const triangles = ShapeUtils.triangulateShape(contour, holes)
  const flatProjected = projected.flat()
  const expectedArea =
    Math.abs(ShapeUtils.area(contour)) -
    holes.reduce((sum, hole) => sum + Math.abs(ShapeUtils.area(hole)), 0)
  const triangleArea = triangles.reduce((sum, triangle) => {
    const [first, second, third] = triangle
    const a = flatProjected[first as number] as Vector2
    const b = flatProjected[second as number] as Vector2
    const c = flatProjected[third as number] as Vector2
    return sum + Math.abs(cross(a, b, c)) / 2
  }, 0)
  if (
    triangles.length === 0 ||
    expectedArea <= EPSILON ||
    Math.abs(triangleArea - expectedArea) > Math.max(EPSILON, expectedArea * 1e-7)
  )
    throw new Error('Triangulation did not preserve the surface area')

  const indices = triangles.flatMap((triangle) => {
    const [first, second, third] = triangle as [number, number, number]
    const a = flatPoints[first] as Vector3
    const b = flatPoints[second] as Vector3
    const c = flatPoints[third] as Vector3
    const orientation = b.clone().sub(a).cross(c.clone().sub(a)).dot(normal)
    return orientation < 0 ? [first, third, second] : [first, second, third]
  })
  const geometry = new BufferGeometry()
  try {
    geometry.setAttribute(
      'position',
      new Float32BufferAttribute(
        flatPoints.flatMap((point) => point.toArray()),
        3,
      ),
    )
    geometry.setIndex(indices)
    geometry.computeVertexNormals()
    geometry.computeBoundingBox()
    geometry.computeBoundingSphere()
    return geometry
  } catch (error) {
    geometry.dispose()
    throw error
  }
}

function lineGeometry(source: readonly HeightPoint[]): BufferGeometry {
  const points = source.map(scenePoint)
  if (
    points.length < 2 ||
    points.some(
      (point, index) => index > 0 && point.distanceTo(points[index - 1] as Vector3) <= EPSILON,
    )
  ) {
    throw new Error('A scene line needs a measurable span')
  }
  const geometry = new BufferGeometry()
  try {
    geometry.setAttribute(
      'position',
      new Float32BufferAttribute(
        points
          .slice(1)
          .flatMap((point, index) => [...(points[index] as Vector3).toArray(), ...point.toArray()]),
        3,
      ),
    )
    geometry.computeBoundingBox()
    geometry.computeBoundingSphere()
    return geometry
  } catch (error) {
    geometry.dispose()
    throw error
  }
}

function checkHeight(height: number | undefined, allowZero: boolean): void {
  if (
    height !== undefined &&
    (!Number.isFinite(height) || (allowZero ? height < 0 : height <= 0))
  ) {
    throw new Error('A measured scene height must be finite and positive')
  }
}

/** Render measured surfaces, not invented wall thicknesses, furniture shapes or opening heights. */
export function buildPlanScene(model: PlanVolume): PlanScene {
  const scene: PlanScene = { surfaces: [], lines: [] }
  try {
    scene.surfaces.push({
      id: 'floor',
      kind: 'floor',
      geometry: polygonGeometry(floorPoints(model.floor), model.voids.map(floorPoints)),
    })
    for (const room of model.rooms ?? []) {
      const roomRing = room.floor.map((point) => new Vector2(point.xCm / 100, point.yCm / 100))
      const roomVoids = model.voids.filter((hole) => {
        const holeRing = hole.map((point) => new Vector2(point.xCm / 100, point.yCm / 100))
        if (ringsMeet(roomRing, holeRing) || insideRing(roomRing[0] as Vector2, holeRing)) {
          throw new Error('A room contour intersects a floor void')
        }
        return insideRing(holeRing[0] as Vector2, roomRing)
      })
      scene.surfaces.push({
        id: `room-${room.id}`,
        kind: 'room',
        roomId: room.id,
        geometry: polygonGeometry(floorPoints(room.floor), roomVoids.map(floorPoints)),
      })
    }
    for (const face of model.solidFaces) {
      scene.surfaces.push({
        id: face.id,
        kind: 'wall',
        geometry: polygonGeometry(face.points, face.holes),
      })
    }
    for (const wall of model.walls) {
      checkHeight(wall.bottomCm, true)
      checkHeight(wall.topCm, false)
      if (wall.topCm !== undefined && wall.topCm <= wall.bottomCm) {
        throw new Error('A wall top must be above its bottom')
      }
      if (wall.solid) {
        if (model.solidFaces.length === 0)
          throw new Error('A solid wall needs measured solid faces')
        continue
      }
      if (wall.topCm === undefined) {
        scene.lines.push({
          id: wall.id,
          kind: 'wall',
          unknown: true,
          geometry: lineGeometry(floorPoints([wall.start, wall.end])),
        })
      } else {
        scene.surfaces.push({
          id: wall.id,
          kind: 'wall',
          geometry: polygonGeometry([
            { ...wall.start, zCm: wall.bottomCm },
            { ...wall.end, zCm: wall.bottomCm },
            { ...wall.end, zCm: wall.topCm },
            { ...wall.start, zCm: wall.topCm },
          ]),
        })
      }
    }
    for (const item of model.furniture ?? []) checkHeight(item.heightCm, false)
    const furnitureRooms = new Map((model.furniture ?? []).map((item) => [item.id, item.roomId]))
    for (const face of furnitureFaces(model.furniture ?? [])) {
      scene.surfaces.push({
        id: face.id,
        kind: 'furniture',
        furnitureId: face.furnitureId,
        roomId: furnitureRooms.get(face.furnitureId),
        footprintOnly: face.footprintOnly,
        geometry: polygonGeometry(face.points, face.holes),
      })
    }
    for (const zone of model.floorZones ?? []) {
      scene.surfaces.push({
        id: zone.id,
        kind: 'zone',
        roomId: zone.roomId,
        preliminary: zone.preliminary,
        geometry: polygonGeometry(floorPoints(zone.floor)),
      })
    }
    for (const opening of model.openings) {
      checkHeight(opening.bottomCm, true)
      checkHeight(opening.heightCm, false)
      const measured = opening.bottomCm !== undefined && opening.heightCm !== undefined
      const bottom = opening.bottomCm ?? 0
      const top = bottom + (opening.heightCm ?? 0)
      const outline = measured
        ? [
            { ...opening.start, zCm: bottom },
            { ...opening.end, zCm: bottom },
            { ...opening.end, zCm: top },
            { ...opening.start, zCm: top },
            { ...opening.start, zCm: bottom },
          ]
        : floorPoints([opening.start, opening.end])
      scene.lines.push({
        id: opening.id,
        kind: 'opening',
        unknown: !measured,
        geometry: lineGeometry(outline),
      })
    }
    return scene
  } catch (error) {
    for (const surface of scene.surfaces) surface.geometry.dispose()
    for (const line of scene.lines) line.geometry.dispose()
    throw error
  }
}
