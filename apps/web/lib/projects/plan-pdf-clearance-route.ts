import type { PlanGeometry, PlanOpeningBinding, PlanPoint } from '@uyut/db'
import polygonClipping, { type Polygon } from 'polygon-clipping'
import { doorClearanceZone } from './clearance-zones'
import {
  currentOpeningFacePairs,
  currentOpeningWidthProofs,
  currentWallFacePairs,
} from './plan-opening-face-pairs'
import { pdfPolygonIsValid } from './plan-pdf-room-binding'
import { inspectSourceClearanceRoutes } from './plan-source-clearance-route'

const samePoint = (a: PlanPoint, b: PlanPoint) => a.xCm === b.xCm && a.yCm === b.yCm
const samePagePoint = (a: { x: number; y: number }, b: { x: number; y: number }) =>
  a.x === b.x && a.y === b.y
const body = (points: PlanPoint[]): Polygon => [points.map(({ xCm, yCm }) => [xCm, yCm])]

function polygonWinding(polygon: PlanPoint[]) {
  return Math.sign(
    polygon.reduce((sum, point, index) => {
      const next = polygon[(index + 1) % polygon.length]
      return next ? sum + point.xCm * next.yCm - next.xCm * point.yCm : sum
    }, 0),
  )
}

/** Only reciprocal, coincident source dividers join open zones; gaps stay unknown. */
function openZoneEdges(geometry: PlanGeometry) {
  const edges = (geometry.pdfCalibration?.sourceOpenZoneBoundaries ?? []).map((proof) => {
    const owners = geometry.rooms.flatMap((room, roomIndex) =>
      room.polygon.length === proof.polygon.length &&
      room.polygon.every((point, index) => {
        const saved = proof.polygon[index]
        return saved !== undefined && samePoint(point, saved)
      })
        ? [roomIndex]
        : [],
    )
    const start = proof.polygon[proof.edgeIndex]
    const end = proof.polygon[(proof.edgeIndex + 1) % proof.polygon.length]
    if (
      owners.length !== 1 ||
      !Number.isInteger(proof.edgeIndex) ||
      proof.edgeIndex < 0 ||
      proof.edgeIndex >= proof.polygon.length ||
      !start ||
      !end ||
      proof.sourceEdge?.length !== 2 ||
      !proof.sourceEdge.every((point) => Number.isFinite(point.x) && Number.isFinite(point.y)) ||
      samePoint(start, end) ||
      (start.xCm !== end.xCm && start.yCm !== end.yCm)
    )
      return undefined
    const along = start.yCm === end.yCm ? 'xCm' : 'yCm'
    return {
      roomIndex: owners[0],
      edgeIndex: proof.edgeIndex,
      start,
      end,
      sourceEdge: proof.sourceEdge,
      side: polygonWinding(proof.polygon) * Math.sign(end[along] - start[along]),
    }
  })
  const keys = edges.map((edge) => `${edge?.roomIndex}:${edge?.edgeIndex}`)
  if (edges.some((edge) => !edge) || new Set(keys).size !== keys.length) return undefined
  return new Set(
    edges.flatMap((edge, index) => {
      if (!edge) return []
      const opposite = edges.filter(
        (other, otherIndex) =>
          otherIndex !== index &&
          other &&
          other.roomIndex !== edge.roomIndex &&
          other.side === -edge.side &&
          ((samePagePoint(edge.sourceEdge[0], other.sourceEdge[0]) &&
            samePagePoint(edge.sourceEdge[1], other.sourceEdge[1])) ||
            (samePagePoint(edge.sourceEdge[0], other.sourceEdge[1]) &&
              samePagePoint(edge.sourceEdge[1], other.sourceEdge[0]))) &&
          ((samePoint(edge.start, other.start) && samePoint(edge.end, other.end)) ||
            (samePoint(edge.start, other.end) && samePoint(edge.end, other.start))),
      )
      return opposite.length === 1 ? [keys[index]] : []
    }),
  )
}

function face(binding: PlanOpeningBinding, geometry: PlanGeometry) {
  const { opening, wall, cut } = binding
  if (cut?.length !== 2 || opening.type !== 'door') return undefined
  const along: 'xCm' | 'yCm' = wall.start.yCm === wall.end.yCm ? 'xCm' : 'yCm'
  const across: 'xCm' | 'yCm' = along === 'xCm' ? 'yCm' : 'xCm'
  if (wall.start[across] !== wall.end[across] || samePoint(wall.start, wall.end)) return undefined
  const low = Math.min(cut[0][along], cut[1][along])
  const high = Math.max(cut[0][along], cut[1][along])
  if (
    !cut.every((point) => Number.isFinite(point.xCm) && Number.isFinite(point.yCm)) ||
    cut.some((point) => point[across] !== wall.start[across]) ||
    low >= high ||
    low < Math.min(wall.start[along], wall.end[along]) ||
    high > Math.max(wall.start[along], wall.end[along])
  )
    return undefined
  // Только проверка связи с округлённой записью; концы проёма не сдвигаются.
  const offset = Math.min(...cut.map((point) => Math.abs(point[along] - wall.start[along])))
  if (Math.abs(offset - opening.offsetCm) > 0.2 || Math.abs(high - low - opening.widthCm) > 0.2)
    return undefined
  const owners = geometry.rooms.flatMap((room, roomIndex) =>
    room.polygon.flatMap((start, edgeIndex) => {
      const end = room.polygon[(edgeIndex + 1) % room.polygon.length]
      if (
        !end ||
        !(
          (samePoint(start, wall.start) && samePoint(end, wall.end)) ||
          (samePoint(start, wall.end) && samePoint(end, wall.start))
        )
      )
        return []
      const winding = polygonWinding(room.polygon)
      return [{ roomIndex, edgeIndex, side: winding * Math.sign(end[along] - start[along]) }]
    }),
  )
  if (owners.length !== 1 || !owners[0]) return undefined
  return {
    ...owners[0],
    wallId: wall.id,
    along,
    across,
    low,
    high,
    coordinate: wall.start[across],
    cut,
  }
}

type Face = NonNullable<ReturnType<typeof face>>

function closedSpans(start: PlanPoint, end: PlanPoint, cuts: Face[]) {
  if (!cuts.length) return [{ start, end }]
  const along = cuts[0]?.along ?? 'xCm'
  const high = Math.max(start[along], end[along])
  let cursor = Math.min(start[along], end[along])
  const remaining: Array<{ start: PlanPoint; end: PlanPoint }> = []
  const at = (value: number): PlanPoint => ({ ...start, [along]: value })
  for (const cut of [...cuts].sort((a, b) => a.low - b.low)) {
    if (cut.low < cursor) throw new Error('Дверные участки одной грани перекрываются')
    if (cut.low > cursor) remaining.push({ start: at(cursor), end: at(cut.low) })
    cursor = cut.high
  }
  if (cursor < high) remaining.push({ start: at(cursor), end: at(high) })
  return remaining
}

/** Только доказанные комнаты и дверные переходы; остальной PDF не объявляется полом. */
export function inspectPdfClearanceRoutes(geometry: PlanGeometry) {
  const missing = (message: string) => ({ missing: message, result: undefined })
  const calibration = geometry.pdfCalibration
  const width = geometry.routeWidthCm
  if (!calibration || !width || !Number.isFinite(width) || width < 40 || width > 200)
    return missing('Задайте ширину прохода от 40 до 200 см для исходной PDF-схемы.')
  if (
    geometry.rooms.length === 0 ||
    geometry.rooms.length > 100 ||
    geometry.walls.length > 200 ||
    geometry.openings.length > 200 ||
    new Set(geometry.walls.map((wall) => wall.id)).size !== geometry.walls.length ||
    new Set(geometry.openings.map((opening) => opening.id)).size !== geometry.openings.length ||
    geometry.rooms.some(
      (room) =>
        !pdfPolygonIsValid(room.polygon.map(({ xCm, yCm }) => ({ x: xCm / 5, y: yCm / 5 }))),
    )
  )
    return missing('Проверьте контуры комнат и уникальные привязки стен и проёмов.')
  if (geometry.walls.some((wall) => wall.thicknessCm !== undefined))
    return missing(
      'В PDF-схеме смешаны грани и стены с толщиной. Сверьте физическую модель перед расчётом.',
    )
  const openEdges = openZoneEdges(geometry)
  if (!openEdges)
    return missing('После правки открытых зон повторно сверьте их границы с исходным PDF.')
  const floors = geometry.rooms.map((room) => body(room.polygon))
  if (
    floors.some((floor, index) =>
      floors
        .slice(index + 1)
        .some((other) => polygonClipping.intersection(floor, other).length > 0),
    )
  )
    return missing('Контуры комнат перекрываются. Сверьте их с исходным планом.')

  const pairs = currentOpeningFacePairs(geometry)
  const sourcePairs = calibration.sourceOpeningFacePairs ?? calibration.openingFacePairs ?? []
  if (pairs.length !== sourcePairs.length)
    return missing('После правки проёмов или контуров повторно сверьте переходы с исходным PDF.')
  const widthProofs = currentOpeningWidthProofs(geometry)
  const entryProofs = widthProofs.filter(
    (proof) => proof.opening.id === geometry.routeStartOpeningId,
  )
  const entry = entryProofs[0]
  const entryFace = entry && face(entry, geometry)
  if (entryProofs.length !== 1 || !entry || !entryFace)
    return missing(
      'Выберите стартовую дверь с сохранёнными исходными концами и подтверждённой меркой.',
    )
  if (entryFace.high - entryFace.low < width)
    return missing('Стартовая дверь уже выбранной ширины прохода.')
  const entryOpening = geometry.openings.find((opening) => opening.id === entry.opening.id)
  const zone = entryOpening && doorClearanceZone(entryOpening, geometry)
  if (!zone) return missing('Задайте внутреннюю стартовую зону у выбранной двери.')
  const start = zone.polygon.reduce(
    (sum, point) => ({
      xCm: sum.xCm + point.xCm / zone.polygon.length,
      yCm: sum.yCm + point.yCm / zone.polygon.length,
    }),
    { xCm: 0, yCm: 0 },
  )
  const half = width / 2
  const startBody = body([
    { xCm: start.xCm - half, yCm: start.yCm - half },
    { xCm: start.xCm + half, yCm: start.yCm - half },
    { xCm: start.xCm + half, yCm: start.yCm + half },
    { xCm: start.xCm - half, yCm: start.yCm + half },
  ])
  const entryFloor = floors[entryFace.roomIndex]
  if (!entryFloor || polygonClipping.difference(startBody, entryFloor).length > 0)
    return missing('Стартовая свободная зона должна целиком лежать внутри комнаты у двери.')

  const candidates: Array<[PlanOpeningBinding, PlanOpeningBinding]> = pairs.map(
    (pair) => pair.bindings,
  )
  const pairKeys = new Set(
    candidates.map(([a, b]) => [a.opening.id, b.opening.id].sort().join('|')),
  )
  for (const proof of widthProofs) {
    if (!proof.sameOpeningAs || !proof.oppositeBinding) continue
    const key = [proof.opening.id, proof.oppositeBinding.opening.id].sort().join('|')
    if (!pairKeys.has(key)) {
      candidates.push([proof, proof.oppositeBinding])
      pairKeys.add(key)
    }
  }
  const usedOpenings = new Set<string>()
  const cuts: Face[] = []
  const portals: Polygon[] = []
  const currentStrips = currentWallFacePairs(geometry)
  const sourceStrips = calibration.sourceWallFacePairs ?? calibration.wallFacePairs ?? []
  if (currentStrips.length !== sourceStrips.length)
    return missing('После правки повторно сверьте сохранённые грани стен с исходным PDF.')
  const strips = currentStrips.map(({ faces: [a, b] }) => body([a.start, a.end, b.end, b.start]))
  for (const [a, b] of candidates) {
    const first = face(a, geometry)
    const second = face(b, geometry)
    if (
      !first ||
      !second ||
      first.roomIndex === second.roomIndex ||
      first.side === second.side ||
      first.along !== second.along ||
      first.low !== second.low ||
      first.high !== second.high ||
      usedOpenings.has(a.opening.id) ||
      usedOpenings.has(b.opening.id) ||
      a.opening.id === b.opening.id
    )
      return missing('Проверьте исходные концы дверей и однозначность соединения комнат.')
    if (first.coordinate !== second.coordinate) {
      // Полоса лежит снаружи обоих полов, между обращёнными друг к другу гранями.
      const direction = Math.sign(second.coordinate - first.coordinate)
      const expectedSide = first.along === 'xCm' ? -direction : direction
      if (first.side !== expectedSide)
        return missing('Дверные грани не обращены друг к другу. Сверьте их по исходному плану.')
      const point = (value: number, coordinate: number): PlanPoint =>
        first.along === 'xCm' ? { xCm: value, yCm: coordinate } : { xCm: coordinate, yCm: value }
      const portal = body([
        point(first.low, first.coordinate),
        point(first.high, first.coordinate),
        point(first.high, second.coordinate),
        point(first.low, second.coordinate),
      ])
      if (
        [...floors, ...strips, ...portals].some(
          (other) => polygonClipping.intersection(portal, other).length > 0,
        )
      )
        return missing('Дверной переход пересекает другой контур или доказанную стену.')
      portals.push(portal)
    }
    usedOpenings.add(a.opening.id)
    usedOpenings.add(b.opening.id)
    cuts.push(first, second)
  }

  // Нулевая толщина не открывает общую стену: каждый остаток её грани остаётся барьером.
  const boundaryBarriers = geometry.rooms.flatMap((room, roomIndex) =>
    room.polygon.flatMap((start, edgeIndex) => {
      const end = room.polygon[(edgeIndex + 1) % room.polygon.length]
      if (!end || openEdges.has(`${roomIndex}:${edgeIndex}`)) return []
      const edgeCuts = cuts.filter(
        (cut) => cut.roomIndex === roomIndex && cut.edgeIndex === edgeIndex,
      )
      return closedSpans(start, end, edgeCuts)
    }),
  )
  // Дополнительная стена не исчезает из расчёта лишь потому, что её нет в контуре комнаты.
  boundaryBarriers.push(
    ...geometry.walls.flatMap((wall) =>
      closedSpans(
        wall.start,
        wall.end,
        cuts.filter((cut) => cut.wallId === wall.id),
      ),
    ),
  )
  const firstFloor = floors[0]
  if (!firstFloor) return missing('Добавьте подтверждённый контур стартовой комнаты.')
  const floorAndPortals = polygonClipping.union(firstFloor, ...floors.slice(1), ...portals)
  const freeFloor = strips.length
    ? polygonClipping.difference(floorAndPortals, ...strips)
    : floorAndPortals
  return {
    missing: undefined,
    result: inspectSourceClearanceRoutes({
      freeFloor,
      rooms: geometry.rooms.map((room, index) => ({ id: String(index), polygon: room.polygon })),
      start,
      widthCm: width,
      stepCm: 10,
      maxNodes: 6000,
      boundaryBarriers,
      metricObstacles: {
        voids: geometry.voids,
        obstacles: [
          ...(geometry.obstacles ?? []),
          ...(geometry.kitchenItems ?? []).map((item) => ({ ...item, kind: 'fixed' as const })),
        ],
      },
    }),
  }
}
