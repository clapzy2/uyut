import type { PlanGeometry, PlanPoint } from '@uyut/db'
import polygonClipping, { type Polygon } from 'polygon-clipping'
import { doorClearanceZone } from './clearance-zones'
import { inspectSourceClearanceRoutes } from './plan-source-clearance-route'

function body(start: PlanPoint, end: PlanPoint, thicknessCm: number): Polygon {
  const length = Math.hypot(end.xCm - start.xCm, end.yCm - start.yCm)
  const nx = (-(end.yCm - start.yCm) * thicknessCm) / (2 * length)
  const ny = ((end.xCm - start.xCm) * thicknessCm) / (2 * length)
  return [
    [
      [start.xCm + nx, start.yCm + ny],
      [end.xCm + nx, end.yCm + ny],
      [end.xCm - nx, end.yCm - ny],
      [start.xCm - nx, start.yCm - ny],
    ],
  ]
}

/** Explicit wall-axis model only. PDF face pairs must not be expanded as wall centre lines. */
export function inspectMetricClearanceRoutes(geometry: PlanGeometry) {
  if (geometry.pdfCalibration)
    return {
      missing: 'Для этой PDF-схемы сначала подтвердите физические тела стен.',
      result: undefined,
    }
  if (!geometry.footprint || geometry.footprint.length < 3)
    return { missing: 'Укажите границу пола квартиры для проверки переходов.', result: undefined }
  if (!geometry.rooms.length || !geometry.walls.length)
    return { missing: 'Добавьте контуры комнат и физические стены.', result: undefined }
  const wallIds = new Set(geometry.walls.map((wall) => wall.id))
  if (
    wallIds.size !== geometry.walls.length ||
    geometry.openings.some((opening) => !wallIds.has(opening.wallId))
  )
    return { missing: 'Проверьте привязку проёмов к существующим стенам.', result: undefined }
  const width = geometry.routeWidthCm
  if (!width || width < 40 || width > 200)
    return { missing: 'Задайте ширину прохода от 40 до 200 см.', result: undefined }
  const entry = geometry.openings.find(
    (opening) => opening.id === geometry.routeStartOpeningId && opening.type !== 'window',
  )
  const zone = entry && doorClearanceZone(entry, geometry)
  if (!entry || !zone)
    return { missing: 'Выберите стартовую дверь и задайте её внутреннюю зону.', result: undefined }
  if (entry.widthCm < width)
    return { missing: 'Стартовая дверь уже выбранной ширины прохода.', result: undefined }
  const wallBodies: Polygon[] = []
  for (const wall of geometry.walls) {
    const thickness = wall.thicknessCm
    const length = Math.hypot(wall.end.xCm - wall.start.xCm, wall.end.yCm - wall.start.yCm)
    if (
      !thickness ||
      !Number.isFinite(thickness) ||
      thickness <= 0 ||
      !Number.isFinite(length) ||
      length <= 0
    )
      return { missing: 'Укажите толщину и физическую ось каждой стены.', result: undefined }
    const cuts: Polygon[] = []
    for (const opening of geometry.openings.filter(
      (opening) => opening.wallId === wall.id && opening.type !== 'window',
    )) {
      if (
        !Number.isFinite(opening.offsetCm) ||
        !Number.isFinite(opening.widthCm) ||
        opening.widthCm <= 0 ||
        opening.offsetCm < 0 ||
        opening.offsetCm + opening.widthCm > length
      )
        return { missing: 'Проверьте положение дверных проёмов на стенах.', result: undefined }
      const point = (distance: number) => ({
        xCm: wall.start.xCm + ((wall.end.xCm - wall.start.xCm) * distance) / length,
        yCm: wall.start.yCm + ((wall.end.yCm - wall.start.yCm) * distance) / length,
      })
      cuts.push(body(point(opening.offsetCm), point(opening.offsetCm + opening.widthCm), thickness))
    }
    const wallBody = body(wall.start, wall.end, thickness)
    wallBodies.push(...(cuts.length ? polygonClipping.difference(wallBody, ...cuts) : [wallBody]))
  }
  const floor: Polygon = [geometry.footprint.map(({ xCm, yCm }) => [xCm, yCm])]
  const freeFloor = polygonClipping.difference(floor, ...wallBodies)
  const start = zone.polygon.reduce(
    (sum, point) => ({
      xCm: sum.xCm + point.xCm / zone.polygon.length,
      yCm: sum.yCm + point.yCm / zone.polygon.length,
    }),
    { xCm: 0, yCm: 0 },
  )
  const furniture = (geometry.kitchenItems ?? []).map((item) => ({
    ...item,
    kind: 'fixed' as const,
  }))
  return {
    missing: undefined,
    result: inspectSourceClearanceRoutes({
      freeFloor,
      rooms: geometry.rooms.map((room, index) => ({ id: String(index), polygon: room.polygon })),
      start,
      widthCm: width,
      stepCm: 10,
      maxNodes: 6000,
      metricObstacles: {
        voids: geometry.voids,
        obstacles: [...(geometry.obstacles ?? []), ...furniture],
      },
    }),
  }
}
