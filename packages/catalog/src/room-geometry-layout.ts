import type { PlanGeometry, PlanOpening, PlanPoint, PlanWall, RoomMeasurements } from '@uyut/db'
import { doorClearanceZone, openingDisplayLabel } from './door-clearance'
import type { FloorKeepClearZone, FloorReservation, RoomLayoutInput } from './layout'
import { WALKWAY_CM } from './layout'
import type { WallReservation } from './openings'

const BOUNDARY_TOLERANCE_CM = 20
const GEOMETRY_ALIGNMENT_TOLERANCE_CM = 2

export type GeometryRoomLayoutInput = RoomLayoutInput & {
  widthCm: number
  depthCm: number
  reservations: WallReservation[]
  floorReservations: FloorReservation[]
  keepClearZones: FloorKeepClearZone[]
  missingSafetyData: string[]
}

function normalizedName(value: string): string {
  return value.trim().toLocaleLowerCase('ru').replaceAll('ё', 'е')
}

function pointAlongWall(wall: PlanWall, distanceCm: number): PlanPoint {
  const length = Math.hypot(wall.end.xCm - wall.start.xCm, wall.end.yCm - wall.start.yCm)
  const ratio = length > 0 ? distanceCm / length : 0
  return {
    xCm: wall.start.xCm + (wall.end.xCm - wall.start.xCm) * ratio,
    yCm: wall.start.yCm + (wall.end.yCm - wall.start.yCm) * ratio,
  }
}

function openingPoints(opening: PlanOpening, wall: PlanWall): [PlanPoint, PlanPoint] {
  return [
    pointAlongWall(wall, opening.offsetCm),
    pointAlongWall(wall, opening.offsetCm + opening.widthCm),
  ]
}

function reservationKind(type: PlanOpening['type']): WallReservation['kind'] {
  return type
}

function pointInPolygon(point: PlanPoint, polygon: readonly PlanPoint[]): boolean {
  let inside = false
  for (let index = 0; index < polygon.length; index += 1) {
    const start = polygon[index]
    const end = polygon[(index + 1) % polygon.length]
    if (!start || !end) continue
    if (
      start.yCm > point.yCm !== end.yCm > point.yCm &&
      point.xCm <
        ((end.xCm - start.xCm) * (point.yCm - start.yCm)) / (end.yCm - start.yCm) + start.xCm
    )
      inside = !inside
  }
  return inside
}

function pointDistanceToSegment(point: PlanPoint, start: PlanPoint, end: PlanPoint): number {
  const dx = end.xCm - start.xCm
  const dy = end.yCm - start.yCm
  const lengthSquared = dx * dx + dy * dy
  if (lengthSquared === 0) return Math.hypot(point.xCm - start.xCm, point.yCm - start.yCm)
  const ratio = Math.max(
    0,
    Math.min(1, ((point.xCm - start.xCm) * dx + (point.yCm - start.yCm) * dy) / lengthSquared),
  )
  return Math.hypot(point.xCm - (start.xCm + dx * ratio), point.yCm - (start.yCm + dy * ratio))
}

function openingBelongsToRoom(
  start: PlanPoint,
  end: PlanPoint,
  polygon: readonly PlanPoint[],
  toleranceCm: number,
): boolean {
  const dx = end.xCm - start.xCm
  const dy = end.yCm - start.yCm
  const length = Math.hypot(dx, dy)
  if (length === 0) return false
  const along = (point: PlanPoint) =>
    ((point.xCm - start.xCm) * dx + (point.yCm - start.yCm) * dy) / length
  const offset = (point: PlanPoint) =>
    Math.abs((point.xCm - start.xCm) * dy - (point.yCm - start.yCm) * dx) / length
  const covered: Array<[number, number]> = []
  for (let index = 0; index < polygon.length; index += 1) {
    const edgeStart = polygon[index]
    const edgeEnd = polygon[(index + 1) % polygon.length]
    if (!edgeStart || !edgeEnd) continue
    if (offset(edgeStart) > toleranceCm || offset(edgeEnd) > toleranceCm) continue
    const from = Math.max(0, Math.min(along(edgeStart), along(edgeEnd)))
    const to = Math.min(length, Math.max(along(edgeStart), along(edgeEnd)))
    if (to > from) covered.push([from, to])
  }
  covered.sort((a, b) => a[0] - b[0])
  let endOfCoverage = 0
  for (const [from, to] of covered) {
    if (from > endOfCoverage + toleranceCm) return false
    endOfCoverage = Math.max(endOfCoverage, to)
    if (endOfCoverage >= length - toleranceCm) return true
  }
  return false
}

/** A measured wall axis can sit half a wall thickness behind the room's floor edge. */
function openingOnRoomBoundary(
  start: PlanPoint,
  end: PlanPoint,
  wall: PlanWall,
  polygon: readonly PlanPoint[],
): [PlanPoint, PlanPoint] | null {
  if (openingBelongsToRoom(start, end, polygon, GEOMETRY_ALIGNMENT_TOLERANCE_CM)) {
    return [start, end]
  }
  if (wall.thicknessCm === undefined || wall.thicknessCm < 5) return null

  const openingLength = Math.hypot(end.xCm - start.xCm, end.yCm - start.yCm)
  if (openingLength === 0) return null
  const expectedFaceOffset = wall.thicknessCm / 2
  const candidates: Array<{ start: PlanPoint; end: PlanPoint; faceError: number }> = []
  for (let index = 0; index < polygon.length; index += 1) {
    const edgeStart = polygon[index]
    const edgeEnd = polygon[(index + 1) % polygon.length]
    if (!edgeStart || !edgeEnd) continue
    const edgeLength = Math.hypot(edgeEnd.xCm - edgeStart.xCm, edgeEnd.yCm - edgeStart.yCm)
    if (edgeLength === 0) continue
    const dx = (edgeEnd.xCm - edgeStart.xCm) / edgeLength
    const dy = (edgeEnd.yCm - edgeStart.yCm) / edgeLength
    const alongStart = (start.xCm - edgeStart.xCm) * dx + (start.yCm - edgeStart.yCm) * dy
    const alongEnd = (end.xCm - edgeStart.xCm) * dx + (end.yCm - edgeStart.yCm) * dy
    const overlap =
      Math.min(edgeLength, Math.max(alongStart, alongEnd)) -
      Math.max(0, Math.min(alongStart, alongEnd))
    if (overlap <= GEOMETRY_ALIGNMENT_TOLERANCE_CM) continue
    const parallel = Math.abs(
      ((end.xCm - start.xCm) * dx + (end.yCm - start.yCm) * dy) / openingLength,
    )
    if (parallel < 0.999) continue
    const offsetStart = (start.xCm - edgeStart.xCm) * dy - (start.yCm - edgeStart.yCm) * dx
    const offsetEnd = (end.xCm - edgeStart.xCm) * dy - (end.yCm - edgeStart.yCm) * dx
    const faceError = Math.max(
      Math.abs(Math.abs(offsetStart) - expectedFaceOffset),
      Math.abs(Math.abs(offsetEnd) - expectedFaceOffset),
    )
    if (
      faceError > GEOMETRY_ALIGNMENT_TOLERANCE_CM ||
      Math.abs(offsetStart - offsetEnd) > GEOMETRY_ALIGNMENT_TOLERANCE_CM
    ) {
      continue
    }
    const projectedStart = {
      xCm: start.xCm - offsetStart * dy,
      yCm: start.yCm + offsetStart * dx,
    }
    const projectedEnd = {
      xCm: end.xCm - offsetEnd * dy,
      yCm: end.yCm + offsetEnd * dx,
    }
    if (
      openingBelongsToRoom(projectedStart, projectedEnd, polygon, GEOMETRY_ALIGNMENT_TOLERANCE_CM)
    ) {
      candidates.push({
        start: projectedStart,
        end: projectedEnd,
        faceError,
      })
    }
  }
  candidates.sort((first, second) => first.faceError - second.faceError)
  const nearest = candidates[0]
  const other = candidates[1]
  if (!nearest || (other && Math.abs(other.faceError - nearest.faceError) < 0.5)) return null
  return [nearest.start, nearest.end]
}

/**
 * Переводит глобальный контур и проёмы плана в локальные координаты комнаты.
 * Размеры ручного обмера имеют приоритет, поэтому вместе с рамкой масштабируется и сам контур.
 */
export function roomLayoutInputFromGeometry(
  geometry: PlanGeometry | undefined,
  roomName: string,
  measurements: RoomMeasurements | null | undefined,
): GeometryRoomLayoutInput | null {
  if (geometry?.status !== 'confirmed' || geometry.pdfCalibration?.derivedOpeningIds.length)
    return null
  const matchingRooms = geometry.rooms.filter(
    (candidate) => normalizedName(candidate.name) === normalizedName(roomName),
  )
  const room = matchingRooms.length === 1 ? matchingRooms[0] : undefined
  if (!room || room.sourceNumbers || room.polygon.length < 3) return null

  const xs = room.polygon.map((point) => point.xCm)
  const ys = room.polygon.map((point) => point.yCm)
  const minX = Math.min(...xs)
  const maxX = Math.max(...xs)
  const minY = Math.min(...ys)
  const maxY = Math.max(...ys)
  const geometryWidth = maxX - minX
  const geometryDepth = maxY - minY
  if (
    !Number.isFinite(geometryWidth) ||
    !Number.isFinite(geometryDepth) ||
    geometryWidth <= 0 ||
    geometryDepth <= 0
  )
    return null

  // A signed room side may measure only the rectangular body of a stepped contour.
  // Never stretch verified PDF coordinates to that side's bounding box.
  const widthCm = geometry.pdfCalibration
    ? geometryWidth
    : measurements?.widthCm && measurements.widthCm > 0
      ? measurements.widthCm
      : geometryWidth
  const depthCm = geometry.pdfCalibration
    ? geometryDepth
    : measurements?.depthCm && measurements.depthCm > 0
      ? measurements.depthCm
      : geometryDepth
  if (!Number.isFinite(widthCm) || !Number.isFinite(depthCm)) return null
  const scaleX = widthCm / geometryWidth
  const scaleY = depthCm / geometryDepth
  const floorPolygon = room.polygon.map((point) => ({
    xCm: (point.xCm - minX) * scaleX,
    yCm: (point.yCm - minY) * scaleY,
  }))
  const wallById = new Map(geometry.walls.map((wall) => [wall.id, wall]))
  const reservations: WallReservation[] = []
  const floorReservations: FloorReservation[] = []
  const keepClearZones: FloorKeepClearZone[] = []
  const missingSafetyData: string[] = []
  for (const [label, measured, outlined] of [
    ['Ширина', measurements?.widthCm, geometryWidth],
    ['Глубина', measurements?.depthCm, geometryDepth],
  ] as const) {
    if (measured && Math.abs(measured - outlined) > GEOMETRY_ALIGNMENT_TOLERANCE_CM) {
      missingSafetyData.push(
        `${label} комнаты: контур ${outlined.toFixed(1)} см, мерка ${measured.toFixed(1)} см. Уточните контур или мерку: масштабирование схемы не подтверждает точность проёмов.`,
      )
    }
  }
  const localPoint = (point: PlanPoint): PlanPoint => ({
    xCm: (point.xCm - minX) * scaleX,
    yCm: (point.yCm - minY) * scaleY,
  })

  for (const opening of geometry.openings) {
    const openingLabel = openingDisplayLabel(opening, geometry)
    const wall = wallById.get(opening.wallId)
    if (!wall) continue
    const [start, end] = openingPoints(opening, wall)
    const aligned = openingOnRoomBoundary(start, end, wall, room.polygon)
    if (!aligned) {
      if (!openingBelongsToRoom(start, end, room.polygon, BOUNDARY_TOLERANCE_CM)) continue
      missingSafetyData.push(
        `${openingLabel} не совпадает с границей комнаты. Уточните стену или контур, прежде чем учитывать его в расстановке.`,
      )
      continue
    }
    const [boundaryStart, boundaryEnd] = aligned
    if (opening.type !== 'window' && opening.widthCm < WALKWAY_CM) {
      missingSafetyData.push(
        `${openingLabel}: ширина проёма по плану ${opening.widthCm} см меньше принятого свободного прохода ${WALKWAY_CM} см. Уточните чистую ширину проёма перед покупкой мебели.`,
      )
    }
    if (opening.type === 'window' && opening.sillHeightCm === undefined) {
      missingSafetyData.push(
        `${openingLabel}: укажите высоту подоконника, чтобы проверить низкую мебель под ним.`,
      )
    }
    const clearance = doorClearanceZone(opening, geometry)
    if (opening.type !== 'window') {
      if (!clearance) {
        missingSafetyData.push(`${openingLabel}: задайте свободную зону открывания.`)
      } else {
        const alignedClearance = clearance.polygon.map((point) => ({
          xCm: point.xCm + boundaryStart.xCm - start.xCm,
          yCm: point.yCm + boundaryStart.yCm - start.yCm,
        }))
        const centre = alignedClearance.reduce(
          (sum, point) => ({
            xCm: sum.xCm + point.xCm / alignedClearance.length,
            yCm: sum.yCm + point.yCm / alignedClearance.length,
          }),
          { xCm: 0, yCm: 0 },
        )
        if (pointInPolygon(centre, room.polygon))
          keepClearZones.push({
            kind: opening.type,
            label: clearance.label,
            polygon: alignedClearance.map(localPoint),
          })
      }
    }
    floorReservations.push({
      kind: reservationKind(opening.type),
      start: localPoint(boundaryStart),
      end: localPoint(boundaryEnd),
      clearanceCm: 0,
      ...(opening.sillHeightCm === undefined ? {} : { sillHeightCm: opening.sillHeightCm }),
    })
    const horizontal =
      Math.abs(boundaryEnd.xCm - boundaryStart.xCm) >= Math.abs(boundaryEnd.yCm - boundaryStart.yCm)
    if (horizontal) {
      const y = (boundaryStart.yCm + boundaryEnd.yCm) / 2
      const wallSide =
        Math.abs(y - minY) <= BOUNDARY_TOLERANCE_CM
          ? 'top'
          : Math.abs(y - maxY) <= BOUNDARY_TOLERANCE_CM
            ? 'bottom'
            : null
      if (!wallSide) continue
      const clippedStart = Math.max(minX, Math.min(boundaryStart.xCm, boundaryEnd.xCm))
      const clippedEnd = Math.min(maxX, Math.max(boundaryStart.xCm, boundaryEnd.xCm))
      if (clippedEnd <= clippedStart) continue
      reservations.push({
        kind: reservationKind(opening.type),
        wall: wallSide,
        fromCm: (clippedStart - minX) * scaleX,
        toCm: (clippedEnd - minX) * scaleX,
        clearanceCm: 0,
        ...(opening.sillHeightCm === undefined ? {} : { sillHeightCm: opening.sillHeightCm }),
      })
      continue
    }

    const x = (boundaryStart.xCm + boundaryEnd.xCm) / 2
    const wallSide =
      Math.abs(x - minX) <= BOUNDARY_TOLERANCE_CM
        ? 'left'
        : Math.abs(x - maxX) <= BOUNDARY_TOLERANCE_CM
          ? 'right'
          : null
    if (!wallSide) continue
    const clippedStart = Math.max(minY, Math.min(boundaryStart.yCm, boundaryEnd.yCm))
    const clippedEnd = Math.min(maxY, Math.max(boundaryStart.yCm, boundaryEnd.yCm))
    if (clippedEnd <= clippedStart) continue
    reservations.push({
      kind: reservationKind(opening.type),
      wall: wallSide,
      fromCm: (clippedStart - minY) * scaleY,
      toCm: (clippedEnd - minY) * scaleY,
      clearanceCm: 0,
      ...(opening.sillHeightCm === undefined ? {} : { sillHeightCm: opening.sillHeightCm }),
    })
  }

  for (const point of geometry.utilityPoints ?? []) {
    if (point.kind !== 'radiator') continue
    const belongs =
      pointInPolygon(point, room.polygon) ||
      room.polygon.some((start, index) => {
        const end = room.polygon[(index + 1) % room.polygon.length]
        return end ? pointDistanceToSegment(point, start, end) <= BOUNDARY_TOLERANCE_CM : false
      })
    if (!belongs) continue
    if (point.reachCm === undefined) {
      missingSafetyData.push(`Радиатор ${point.id}: задайте свободный радиус.`)
      continue
    }
    const polygon: PlanPoint[] = []
    for (let index = 0; index < 24; index += 1) {
      const angle = (Math.PI * 2 * index) / 24
      polygon.push(
        localPoint({
          xCm: point.xCm + Math.cos(angle) * point.reachCm,
          yCm: point.yCm + Math.sin(angle) * point.reachCm,
        }),
      )
    }
    keepClearZones.push({ kind: 'radiator', label: `Радиатор ${point.id}`, polygon })
  }

  for (const obstacle of geometry.obstacles ?? []) {
    const corners: PlanPoint[] = [
      { xCm: obstacle.xCm, yCm: obstacle.yCm },
      { xCm: obstacle.xCm + obstacle.widthCm, yCm: obstacle.yCm },
      { xCm: obstacle.xCm + obstacle.widthCm, yCm: obstacle.yCm + obstacle.depthCm },
      { xCm: obstacle.xCm, yCm: obstacle.yCm + obstacle.depthCm },
    ]
    const roomTouchesObstacle =
      corners.some((corner) => pointInPolygon(corner, room.polygon)) ||
      room.polygon.some(
        (point) =>
          point.xCm >= obstacle.xCm &&
          point.xCm <= obstacle.xCm + obstacle.widthCm &&
          point.yCm >= obstacle.yCm &&
          point.yCm <= obstacle.yCm + obstacle.depthCm,
      )
    if (!roomTouchesObstacle) continue
    keepClearZones.push({
      kind: 'obstacle',
      label:
        obstacle.label?.trim() ||
        {
          column: 'Колонна',
          shaft: 'Вентшахта или короб',
          fixed: 'Несдвигаемый элемент',
        }[obstacle.kind],
      polygon: corners.map(localPoint),
    })
  }

  for (const voidShape of geometry.voids ?? []) {
    const touchesRoom =
      voidShape.polygon.some((point) => pointInPolygon(point, room.polygon)) ||
      room.polygon.some((point) => pointInPolygon(point, voidShape.polygon))
    if (!touchesRoom) continue
    keepClearZones.push({
      kind: 'obstacle',
      label: `Техническая пустота ${voidShape.id}`,
      polygon: voidShape.polygon.map(localPoint),
    })
  }

  return {
    widthCm,
    depthCm,
    floorPolygon,
    ...(measurements?.layoutNotes ? { layoutNotes: measurements.layoutNotes } : {}),
    reservations,
    floorReservations,
    keepClearZones,
    missingSafetyData: [...new Set(missingSafetyData)],
  }
}
