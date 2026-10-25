import type {
  PlanGeometry,
  PlanPoint,
  PlanProjectedVerticalEvidence,
  PlanRoomShape,
} from '@uyut/db'
import { cross, integerPoints, onIntegerSegment, sign, vector } from './plan-exact-geometry'
import {
  currentProjectedVerticalEvidence,
  isPrintedProjectZero,
} from './plan-projected-vertical-evidence'

export type ProjectedFloorPreview = {
  kind: 'projected-floor-preview'
  sourcePage: number
  datum: { sha256: string; pdfPage: number; captionIndex: number; captionText: string }
  floors: Array<{
    id: string
    roomIndex: number
    name: string
    sourceNumbers: number[]
    polygon: PlanPoint[]
    elevationCm: number
    evidenceId: string
  }>
  heldRooms: Array<{
    id: string
    roomIndex: number
    name: string
    polygon: PlanPoint[]
    reason: string
    levels: Array<{
      evidenceId: string
      printedValue: string
      unit: PlanProjectedVerticalEvidence['unit']
      scopeLabel?: string
      pdfPage: number
      captionIndexes: number[]
      captionTexts: string[]
    }>
  }>
  floorScopeNote?: string
  warnings: string[]
}

function roomKey(room: PlanRoomShape): string {
  return JSON.stringify([
    room.name,
    room.spaceKind ?? null,
    room.sourceNumber ?? null,
    room.sourceNumbers ?? null,
    room.polygon.map(({ xCm, yCm }) => [xCm, yCm]),
  ])
}

/** Rendering guards only: this does not add physical source evidence. */
function validRoomPolygon(polygon: PlanPoint[], widthCm: number, heightCm: number): boolean {
  if (
    !Array.isArray(polygon) ||
    polygon.length < 3 ||
    polygon.length > 200 ||
    polygon.some(
      (point) =>
        !point ||
        !Number.isFinite(point.xCm) ||
        !Number.isFinite(point.yCm) ||
        point.xCm < 0 ||
        point.yCm < 0 ||
        point.xCm > widthCm ||
        point.yCm > heightCm,
    ) ||
    new Set(polygon.map(({ xCm, yCm }) => `${xCm}:${yCm}`)).size !== polygon.length
  )
    return false
  const points = integerPoints(polygon)
  let area = 0n
  for (let index = 0; index < points.length; index++) {
    const a = points[index]
    const b = points[(index + 1) % points.length]
    if (!a || !b) return false
    area += cross(a, b)
    for (let other = index + 1; other < points.length; other++) {
      if (other === index + 1 || (index === 0 && other === points.length - 1)) continue
      const c = points[other]
      const d = points[(other + 1) % points.length]
      if (!c || !d) return false
      const ab = vector(a, b)
      const cd = vector(c, d)
      const opposite =
        sign(cross(ab, vector(a, c))) * sign(cross(ab, vector(a, d))) < 0 &&
        sign(cross(cd, vector(c, a))) * sign(cross(cd, vector(c, b))) < 0
      if (
        opposite ||
        onIntegerSegment(c, a, b) ||
        onIntegerSegment(d, a, b) ||
        onIntegerSegment(a, c, d) ||
        onIntegerSegment(b, c, d)
      )
        return false
    }
  }
  return area !== 0n
}

function datumFor(
  entry: PlanProjectedVerticalEvidence,
): ProjectedFloorPreview['datum'] | undefined {
  const review = entry.floorContourReview
  if (!review || !isPrintedProjectZero(review.zeroCaptionText)) return undefined
  return {
    sha256: entry.source.sha256,
    pdfPage: entry.source.pdfPage,
    captionIndex: review.zeroCaptionIndex,
    captionText: review.zeroCaptionText,
  }
}

/** A source-scoped design preview. It never grants measured geometry or route authority. */
export function projectedFloorPreview(geometry: PlanGeometry): ProjectedFloorPreview | undefined {
  const calibration = geometry.pdfCalibration
  if (
    calibration?.sourceState !== 'proposed' ||
    geometry.requiresSourceReviewReimport ||
    !Number.isFinite(geometry.widthCm) ||
    !Number.isFinite(geometry.heightCm) ||
    geometry.widthCm <= 0 ||
    geometry.heightCm <= 0 ||
    geometry.widthCm > 5000 ||
    geometry.heightCm > 5000 ||
    !Array.isArray(geometry.rooms) ||
    geometry.rooms.length < 1 ||
    geometry.rooms.length > 200 ||
    geometry.rooms.some(
      (room) =>
        !room ||
        typeof room.name !== 'string' ||
        !room.name.trim() ||
        room.name.length > 200 ||
        !Array.isArray(room.polygon) ||
        room.polygon.length > 200,
    ) ||
    geometry.rooms.reduce((count, room) => count + room.polygon.length, 0) > 2000 ||
    geometry.rooms.some(
      (room) => !validRoomPolygon(room.polygon, geometry.widthCm, geometry.heightCm),
    )
  )
    return undefined

  const entries = currentProjectedVerticalEvidence(geometry).filter(
    (entry) => entry.quantity === 'floor-level' && entry.target.kind === 'room',
  )
  const reviewed = entries.filter((entry) => entry.floorContourReview)
  const datums = reviewed.map(datumFor)
  const datum = datums[0]
  if (!datum || datums.some((candidate) => JSON.stringify(candidate) !== JSON.stringify(datum)))
    return undefined

  const floors: ProjectedFloorPreview['floors'] = []
  const heldRooms: ProjectedFloorPreview['heldRooms'] = []
  geometry.rooms.forEach((room, roomIndex) => {
    const key = roomKey(room)
    const roomEntries = entries.filter(
      (entry) => entry.target.kind === 'room' && roomKey(entry.target.room) === key,
    )
    const chosen = roomEntries.find((entry) => entry.floorContourReview)
    const conflicting = new Set(roomEntries.map((entry) => entry.valueCm)).size > 1
    const base = {
      id: `projected-room-${roomIndex}`,
      roomIndex,
      name: room.name,
      polygon: room.polygon.map((point) => ({ ...point })),
    }
    if (!chosen || conflicting) {
      heldRooms.push({
        ...base,
        reason: conflicting
          ? 'У одного контура указаны разные отметки. Геометрия перехода или уклона не определена; поверхность не построена. Одного разделения контура недостаточно, чтобы считать участки горизонтальными.'
          : 'Не подтверждено применение проектной отметки ко всему контуру. Пунктир показывает только проекцию комнаты, не пол на нуле.',
        levels: roomEntries.map((entry) => ({
          evidenceId: entry.id,
          printedValue: entry.printedValue,
          unit: entry.unit,
          ...(entry.scopeLabel ? { scopeLabel: entry.scopeLabel } : {}),
          pdfPage: entry.source.pdfPage,
          captionIndexes: [...entry.source.captionIndexes],
          captionTexts: [...entry.source.captionTexts],
        })),
      })
      return
    }
    floors.push({
      ...base,
      sourceNumbers: room.sourceNumbers
        ? [...room.sourceNumbers]
        : room.sourceNumber === undefined
          ? []
          : [room.sourceNumber],
      elevationCm: chosen.valueCm,
      evidenceId: chosen.id,
    })
  })
  if (!floors.some((floor) => floor.elevationCm === 0)) return undefined

  const floorScopeNote = calibration.floorScope?.note
  return {
    kind: 'projected-floor-preview',
    sourcePage: calibration.pdfPage,
    datum,
    floors,
    heldRooms,
    ...(floorScopeNote ? { floorScopeNote } : {}),
    warnings: [
      'Это проектный просмотр уровней, не подтверждённый обмер. Неизвестные стены, потолки, пороги и проходы не достроены; маршрут заноса не проверяется.',
      ...(floorScopeNote ? [`Пол проверен частично: ${floorScopeNote}`] : []),
      ...(heldRooms.length
        ? [
            `Областей без проектной поверхности: ${heldRooms.length}. Их контуры показаны только как ориентиры, не как пол на нулевой отметке.`,
          ]
        : []),
    ],
  }
}

/** Orthographic display coordinates; visual vertical scaling never changes stored centimetres. */
export function projectFloorPreviewPoint(
  point: PlanPoint,
  zCm: number,
  view: { azimuthDeg: number; elevationDeg: number; verticalScale: 1 | 10 },
): { x: number; y: number; depth: number } {
  if (
    ![point.xCm, point.yCm, zCm, view.azimuthDeg, view.elevationDeg].every(Number.isFinite) ||
    Math.abs(point.xCm) > 10000 ||
    Math.abs(point.yCm) > 10000 ||
    Math.abs(zCm) > 10000 ||
    view.elevationDeg < 0 ||
    view.elevationDeg > 90 ||
    (view.verticalScale !== 1 && view.verticalScale !== 10)
  )
    throw new Error('Invalid projected floor preview coordinate or camera')
  const azimuth = (((view.azimuthDeg % 360) + 360) % 360) * (Math.PI / 180)
  const elevation = view.elevationDeg * (Math.PI / 180)
  const horizontal = point.xCm * Math.cos(azimuth) - point.yCm * Math.sin(azimuth)
  const across = point.xCm * Math.sin(azimuth) + point.yCm * Math.cos(azimuth)
  const vertical = zCm * view.verticalScale
  return {
    x: horizontal,
    y: across * Math.sin(elevation) - vertical * Math.cos(elevation),
    depth: across * Math.cos(elevation) + vertical * Math.sin(elevation),
  }
}
