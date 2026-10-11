import {
  compareDecimalSums,
  dot,
  exactSegmentContains,
  integerPoints,
  vector,
} from '@uyut/catalog/plan-exact-geometry'
import {
  inspectPlanThresholdSurfaces,
  planOpeningEndpoints,
} from '@uyut/catalog/plan-threshold-geometry'
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
import { inspectPlanVerticalDimensions, openingFloorLevel } from './plan-vertical-dimensions'
import { signedPlanFloors } from './plan-vertical-floor-geometry'
import { openingOnVerticalFloorBoundary } from './plan-vertical-reference'

export type RouteVertical = {
  referenceId: string
  elevationCm: number
  heldTransitions: Array<{ openingIds: string[]; reason: string }>
}

export function withRouteElevation(
  result: ReturnType<typeof inspectSourceClearanceRoutes>,
  vertical?: RouteVertical,
): Omit<ReturnType<typeof inspectSourceClearanceRoutes>, 'routes'> & {
  footprintCm?: { widthCm: number; depthCm: number }
  turnPolicy?: 'conservative-square'
  turnSweepCm?: number
  vertical?: RouteVertical
  routes: Array<{
    roomId: string
    points: Array<PlanPoint & { zCm?: number; orientation?: 0 | 90 }>
  }>
} {
  if (!vertical) return result
  return {
    ...result,
    vertical,
    routes: result.routes.map((route) => ({
      ...route,
      points: route.points.map((point) => ({ ...point, zCm: vertical.elevationCm })),
    })),
  }
}

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
function openZoneEdges(geometry: PlanGeometry, elevations?: Map<number, number>) {
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
      owners[0] === undefined ||
      !Number.isInteger(proof.edgeIndex) ||
      proof.edgeIndex < 0 ||
      proof.edgeIndex >= proof.polygon.length ||
      !start ||
      !end ||
      proof.sourceEdge?.length !== 2 ||
      !proof.sourceEdge.every((point) => Number.isFinite(point.x) && Number.isFinite(point.y)) ||
      samePoint(start, end) ||
      (geometry.verticalReference === undefined && start.xCm !== end.xCm && start.yCm !== end.yCm)
    )
      return undefined
    const along = start.xCm !== end.xCm ? 'xCm' : 'yCm'
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
          (!elevations ||
            (elevations.has(edge.roomIndex) &&
              elevations.get(edge.roomIndex) === elevations.get(other.roomIndex))) &&
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

type Face = {
  roomIndex: number
  edgeIndex: number
  wallId: string
  cut: [PlanPoint, PlanPoint]
  legacy?: {
    along: 'xCm' | 'yCm'
    low: number
    high: number
    coordinate: number
    side: number
  }
}

function face(binding: PlanOpeningBinding, geometry: PlanGeometry): Face | undefined {
  const { opening, wall, cut } = binding
  if (
    !Array.isArray(cut) ||
    cut.length !== 2 ||
    !cut[0] ||
    !cut[1] ||
    opening.type === 'window' ||
    (opening.type === 'balcony' && geometry.verticalReference === undefined)
  )
    return undefined
  if (geometry.verticalReference !== undefined) {
    const preserved = planOpeningEndpoints(geometry, opening.id)
    if (!preserved) return undefined
    const owners = geometry.rooms.flatMap((room, roomIndex) =>
      room.polygon.flatMap((start, edgeIndex) => {
        const end = room.polygon[(edgeIndex + 1) % room.polygon.length]
        return end && exactSegmentContains(start, end, preserved) ? [{ roomIndex, edgeIndex }] : []
      }),
    )
    const owner = owners[0]
    return owners.length === 1 && owner ? { ...owner, wallId: wall.id, cut: preserved } : undefined
  }
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
    roomIndex: owners[0].roomIndex,
    edgeIndex: owners[0].edgeIndex,
    wallId: wall.id,
    cut,
    legacy: { along, low, high, coordinate: wall.start[across], side: owners[0].side },
  }
}

function closedSpans(start: PlanPoint, end: PlanPoint, cuts: Face[]) {
  if (samePoint(start, end)) return []
  if (!cuts.length) return [{ start, end }]
  const along = start.xCm !== end.xCm ? 'xCm' : 'yCm'
  const last = start[along] > end[along] ? start : end
  let cursor = start[along] < end[along] ? start : end
  const remaining: Array<{ start: PlanPoint; end: PlanPoint }> = []
  const ordered = cuts
    .map(({ cut }): [PlanPoint, PlanPoint] =>
      cut[0][along] < cut[1][along] ? [cut[0], cut[1]] : [cut[1], cut[0]],
    )
    .sort((a, b) => a[0][along] - b[0][along])
  for (const [cutStart, cutEnd] of ordered) {
    if (cutStart[along] < cursor[along])
      throw new Error('Дверные участки одной грани перекрываются')
    if (cutStart[along] > cursor[along]) remaining.push({ start: cursor, end: cutStart })
    cursor = cutEnd
  }
  if (cursor[along] < last[along]) remaining.push({ start: cursor, end: last })
  return remaining
}

function cutsOverlap(first: Face, second: Face): boolean {
  const [a, b, c, d] = integerPoints([...first.cut, ...second.cut])
  if (!a || !b || !c || !d) return true
  const along = vector(a, b)
  const length = dot(along, along)
  const projections: [bigint, bigint] = [dot(vector(a, c), along), dot(vector(a, d), along)]
  const low = projections[0] < projections[1] ? projections[0] : projections[1]
  const high = projections[0] > projections[1] ? projections[0] : projections[1]
  return low < length && high > 0n
}

/** Keep the existing rectangle/swing zone, but anchor it to the preserved source ends. */
function entryZone(geometry: PlanGeometry, opening: PlanGeometry['openings'][number], face: Face) {
  if (geometry.verticalReference === undefined) return doorClearanceZone(opening, geometry)
  const wall = geometry.walls.find((wall) => wall.id === opening.wallId)
  if (!wall) return undefined
  const [a, b, c, d] = integerPoints([wall.start, wall.end, ...face.cut])
  if (!a || !b || !c || !d) return undefined
  const forward = dot(vector(a, b), vector(c, d)) > 0n
  const [start, end] = forward ? face.cut : [face.cut[1], face.cut[0]]
  if (!start || !end) return undefined
  return doorClearanceZone(
    { ...opening, offsetCm: 0, widthCm: Math.hypot(end.xCm - start.xCm, end.yCm - start.yCm) },
    {
      ...geometry,
      walls: geometry.walls.map((candidate) =>
        candidate.id === wall.id ? { ...candidate, start, end } : candidate,
      ),
    },
  )
}

/** Только доказанные комнаты и дверные переходы; остальной PDF не объявляется полом. */
export type FurnitureRouteBody = {
  widthCm: number
  depthCm: number
  heightCm: number
  allowQuarterTurns?: boolean
  /** Explicit absolute base elevation for a prescribed carried crossing, not a stair model. */
  carryElevationCm?: number
  /** Internal start/landing maneuver proof; never accepted from serialized user input. */
  endpointCheck?: (point: PlanPoint, roomId?: string) => boolean
  /** Internal connector only: the start is still on one current finished floor. */
  origin?: { point: PlanPoint; floorId: string }
  goal?: { roomId: string; point?: PlanPoint }
  extraSolids?: Polygon[]
  maxNodes?: number
}

export function inspectPdfClearanceRoutes(geometry: PlanGeometry, transfer?: FurnitureRouteBody) {
  const missing = (message: string) => ({ missing: message, result: undefined })
  const signed = signedPlanFloors(geometry)
  if (signed && !signed.ok) return missing(signed.error)
  const reference = signed?.ok ? signed.reference : undefined
  if (
    transfer !== undefined &&
    (!transfer ||
      (transfer.allowQuarterTurns !== undefined &&
        typeof transfer.allowQuarterTurns !== 'boolean') ||
      (transfer.carryElevationCm !== undefined &&
        (!Number.isFinite(transfer.carryElevationCm) ||
          transfer.carryElevationCm < -600 ||
          transfer.carryElevationCm > 1200 ||
          typeof transfer.endpointCheck !== 'function')) ||
      (transfer.endpointCheck !== undefined && typeof transfer.endpointCheck !== 'function') ||
      (transfer.origin !== undefined &&
        (!transfer.origin.point ||
          ![transfer.origin.point.xCm, transfer.origin.point.yCm].every(Number.isFinite) ||
          !reference?.floors.some((floor) => floor.id === transfer.origin?.floorId))) ||
      (transfer.maxNodes !== undefined &&
        (!Number.isInteger(transfer.maxNodes) ||
          transfer.maxNodes < 1 ||
          transfer.maxNodes > 6000)) ||
      !reference ||
      ![transfer.widthCm, transfer.depthCm, transfer.heightCm].every(
        (value) => Number.isFinite(value) && value > 0,
      ) ||
      transfer.widthCm > 1200 ||
      transfer.depthCm > 1200 ||
      transfer.heightCm > 700)
  )
    return missing(
      'Для проверки габарита нужны явные конечные мерки и подтверждённые чистовые уровни.',
    )
  const elevations = reference
    ? new Map(
        geometry.rooms.flatMap((room, index) => {
          const floor = reference.floors.find(
            (value) =>
              value.room.name === room.name &&
              value.room.polygon.length === room.polygon.length &&
              value.room.polygon.every((point, vertex) => {
                const other = room.polygon[vertex]
                return other !== undefined && samePoint(point, other)
              }),
          )
          return floor?.surface === 'finished-floor' ? [[index, floor.elevationCm] as const] : []
        }),
      )
    : undefined
  const carried = transfer?.carryElevationCm !== undefined
  const carryElevation = transfer?.carryElevationCm
  const heldTransitions: RouteVertical['heldTransitions'] = []
  const usableFloors = reference?.floors.filter((floor) => {
    if (floor.surface !== 'finished-floor') return false
    if (!transfer) return true
    const ceiling = reference.ceilings?.find((ceiling) => ceiling.floorId === floor.id)
    const base = carryElevation ?? floor.elevationCm
    return (
      ceiling !== undefined &&
      base >= floor.elevationCm &&
      compareDecimalSums([base, transfer.heightCm], [ceiling.elevationCm]) <= 0
    )
  })
  const usableFloorIds = new Set(usableFloors?.map((floor) => floor.id))
  const routeElevations =
    transfer && elevations
      ? new Map(
          [...elevations].filter(([index]) => {
            const room = geometry.rooms[index]
            return usableFloors?.some(
              (floor) =>
                floor.room.name === room?.name &&
                floor.room.polygon.every((point, vertex) => {
                  const candidate = room?.polygon[vertex]
                  return candidate !== undefined && samePoint(point, candidate)
                }),
            )
          }),
        )
      : elevations
  if (transfer && reference)
    for (const floor of reference.floors) {
      if (!usableFloorIds.has(floor.id))
        heldTransitions.push({
          openingIds: [],
          reason: carried
            ? `${floor.room.name}: основание переноса ниже чистового пола либо отметка потолка неизвестна или недостаточна для габарита на этой высоте.`
            : `${floor.room.name}: отметка чистового потолка неизвестна либо габарит с запасом выше потолка.`,
        })
    }
  const calibration = geometry.pdfCalibration
  const width = transfer?.widthCm ?? geometry.routeWidthCm
  if (
    !calibration ||
    !width ||
    !Number.isFinite(width) ||
    (!transfer && (width < 40 || width > 200))
  )
    return missing('Задайте ширину прохода от 40 до 200 см для исходной PDF-схемы.')
  if (
    geometry.rooms.length === 0 ||
    geometry.rooms.length > 100 ||
    geometry.walls.length > 200 ||
    geometry.openings.length > 200 ||
    new Set(geometry.walls.map((wall) => wall.id)).size !== geometry.walls.length ||
    new Set(geometry.openings.map((opening) => opening.id)).size !== geometry.openings.length ||
    (!signed &&
      geometry.rooms.some(
        (room) =>
          !pdfPolygonIsValid(room.polygon.map(({ xCm, yCm }) => ({ x: xCm / 5, y: yCm / 5 }))),
      ))
  )
    return missing('Проверьте контуры комнат и уникальные привязки стен и проёмов.')
  const verticalIssue = inspectPlanVerticalDimensions(geometry)[0]
  if (verticalIssue) return missing(verticalIssue.message)
  if (geometry.walls.some((wall) => wall.thicknessCm !== undefined))
    return missing(
      'В PDF-схеме смешаны грани и стены с толщиной. Сверьте физическую модель перед расчётом.',
    )
  const openEdges = openZoneEdges(geometry, routeElevations)
  if (!openEdges)
    return missing('После правки открытых зон повторно сверьте их границы с исходным PDF.')
  if (reference) {
    const legacyOpenEdges = openZoneEdges(geometry)
    for (const key of legacyOpenEdges ?? []) {
      if (!openEdges.has(key))
        heldTransitions.push({
          openingIds: [],
          reason: transfer
            ? `Открытая граница ${key}: разные уровни либо неизвестный или недостаточный вертикальный просвет для габарита.`
            : `Открытая граница ${key}: разные или неизвестные отметки чистовых полов.`,
        })
    }
  }
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
  if (
    !transfer &&
    Math.hypot(
      entryFace.cut[1].xCm - entryFace.cut[0].xCm,
      entryFace.cut[1].yCm - entryFace.cut[0].yCm,
    ) < width
  )
    return missing('Стартовая дверь уже выбранной ширины прохода.')
  const entryOpening = geometry.openings.find((opening) => opening.id === entry.opening.id)
  const entryBase = reference?.wallBases.find((base) => base.wall.id === entry.wall.id)
  const originFloor = reference?.floors.find((floor) => floor.id === transfer?.origin?.floorId)
  const startRoomIndex = originFloor
    ? geometry.rooms.findIndex(
        (room) =>
          room.name === originFloor.room.name &&
          room.polygon.length === originFloor.room.polygon.length &&
          room.polygon.every((point, index) => {
            const other = originFloor.room.polygon[index]
            return other !== undefined && samePoint(point, other)
          }),
      )
    : entryFace.roomIndex
  const startFloorId = originFloor?.id ?? entryBase?.floorId
  const startElevation = elevations?.get(startRoomIndex)
  if (
    transfer &&
    !transfer.origin &&
    (!entryOpening ||
      entryOpening.bottomCm === undefined ||
      entryOpening.heightCm === undefined ||
      (carried
        ? startElevation === undefined ||
          carryElevation === undefined ||
          compareDecimalSums([carryElevation], [startElevation, entryOpening.bottomCm]) < 0 ||
          compareDecimalSums(
            [carryElevation, transfer.heightCm],
            [startElevation, entryOpening.bottomCm, entryOpening.heightCm],
          ) > 0
        : entryOpening.bottomCm !== 0 || entryOpening.heightCm < transfer.heightCm))
  )
    return missing(
      carried
        ? 'У стартового проёма неизвестны абсолютные грани либо габарит на выбранной отметке выходит за вертикальный просвет. Перенос не проверен.'
        : 'У стартового проёма неизвестна нижняя грань или высота, есть подъём либо габарит с запасом выше проёма. Перенос не проверен.',
    )
  if (!reference && entryOpening && ['raised', 'invalid'].includes(openingFloorLevel(entryOpening)))
    return missing(
      'У стартового проёма поднятая или некорректная нижняя грань. Непрерывный путь по полу через порог здесь не проверяется.',
    )
  const zone = entryOpening && entryZone(geometry, entryOpening, entryFace)
  let start = transfer?.origin?.point
  if (!start) {
    if (!zone) return missing('Задайте внутреннюю стартовую зону у выбранной двери.')
    start = zone.polygon.reduce(
      (sum, point) => ({
        xCm: sum.xCm + point.xCm / zone.polygon.length,
        yCm: sum.yCm + point.yCm / zone.polygon.length,
      }),
      { xCm: 0, yCm: 0 },
    )
  }
  const half = width / 2
  const halfDepth = (transfer?.depthCm ?? width) / 2
  const startBody = body([
    { xCm: start.xCm - half, yCm: start.yCm - halfDepth },
    { xCm: start.xCm + half, yCm: start.yCm - halfDepth },
    { xCm: start.xCm + half, yCm: start.yCm + halfDepth },
    { xCm: start.xCm - half, yCm: start.yCm + halfDepth },
  ])
  const entryFloor = floors[startRoomIndex]
  if (!entryFloor || polygonClipping.difference(startBody, entryFloor).length > 0)
    return missing('Стартовая свободная зона должна целиком лежать внутри комнаты у двери.')
  if (transfer && startFloorId && !usableFloorIds.has(startFloorId))
    return missing(
      carried
        ? 'Для стартового пола основание переноса ниже пола либо отметка потолка неизвестна или недостаточна на выбранной высоте. Перенос не проверен.'
        : 'Для стартового пола неизвестна отметка чистового потолка либо габарит с запасом выше потолка. Перенос не проверен.',
    )
  if (
    reference &&
    (!startFloorId ||
      startElevation === undefined ||
      (!transfer?.origin &&
        !openingOnVerticalFloorBoundary(geometry, entry.opening.id, startFloorId)))
  )
    return missing('Стартовая зона требует подтверждённого владельца чистового пола.')
  if (signed?.ok && startFloorId) {
    const owners = signed.surfaces.filter(
      (surface) =>
        surface.surface === 'finished-floor' &&
        polygonClipping.difference(startBody, [
          surface.floor.map(({ xCm, yCm }) => [xCm, yCm] as [number, number]),
          ...surface.voids.map((hole) =>
            hole.map(({ xCm, yCm }) => [xCm, yCm] as [number, number]),
          ),
        ]).length === 0,
    )
    if (owners.length !== 1 || owners[0]?.floorId !== startFloorId)
      return missing('Стартовая зона должна целиком лежать на одном подтверждённом чистовом полу.')
  }

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
  const claimedFaces: Face[] = []
  const cuts: Face[] = []
  const portals: Polygon[] = []
  const currentStrips = currentWallFacePairs(geometry)
  const sourceStrips = calibration.sourceWallFacePairs ?? calibration.wallFacePairs ?? []
  if (currentStrips.length !== sourceStrips.length)
    return missing('После правки повторно сверьте сохранённые грани стен с исходным PDF.')
  const strips = currentStrips.map(({ faces: [a, b] }) => body([a.start, a.end, b.end, b.start]))
  const thresholdSurfaces = reference ? inspectPlanThresholdSurfaces(geometry).surfaces : []
  for (const [a, b] of candidates) {
    const currentOpenings = [a, b].map((binding) =>
      geometry.openings.find((opening) => opening.id === binding.opening.id),
    )
    if (currentOpenings.some((opening) => !opening || openingFloorLevel(opening) === 'invalid'))
      return missing('Проверьте нижние грани обеих сторон дверного перехода.')
    let raised = currentOpenings.some(
      (opening) => opening && openingFloorLevel(opening) === 'raised',
    )
    const first = face(a, geometry)
    const second = face(b, geometry)
    if (
      !first ||
      !second ||
      first.roomIndex === second.roomIndex ||
      usedOpenings.has(a.opening.id) ||
      usedOpenings.has(b.opening.id) ||
      a.opening.id === b.opening.id
    )
      return missing('Проверьте исходные концы дверей и однозначность соединения комнат.')
    if (
      !reference &&
      (!first.legacy ||
        !second.legacy ||
        first.legacy.side === second.legacy.side ||
        first.legacy.along !== second.legacy.along ||
        first.legacy.low !== second.legacy.low ||
        first.legacy.high !== second.legacy.high)
    )
      return missing('Проверьте исходные концы дверей и однозначность соединения комнат.')
    if (
      [first, second].some((candidate) =>
        claimedFaces.some(
          (previous) =>
            previous.roomIndex === candidate.roomIndex &&
            previous.edgeIndex === candidate.edgeIndex &&
            cutsOverlap(previous, candidate),
        ),
      )
    )
      return missing(
        'Исходные дверные участки одной грани накладываются. Сверьте однозначность переходов.',
      )
    claimedFaces.push(first, second)
    if (reference) {
      const bases = [a, b].map((binding) =>
        reference.wallBases.find((base) => base.wall.id === binding.wall.id),
      )
      const owners = bases.map((base) =>
        reference.floors.find((floor) => floor.id === base?.floorId),
      )
      const threshold = reference.thresholds.find((value) =>
        value.bindings.every((side) => [a.opening.id, b.opening.id].includes(side.opening.id)),
      )
      let reason: string | undefined
      if (
        bases.some(
          (base, index) =>
            !base ||
            !openingOnVerticalFloorBoundary(
              geometry,
              currentOpenings[index]?.id ?? '',
              base.floorId,
            ),
        )
      )
        reason = 'Не подтверждён владелец стороны проёма.'
      else if (owners.some((owner) => owner?.surface !== 'finished-floor'))
        reason = 'Не подтверждён чистовой пол.'
      else if (!carried && owners[0]?.elevationCm !== owners[1]?.elevationCm)
        reason = 'Разные отметки полов: преодоление ступени не проверяется.'
      else if (
        currentOpenings.some((opening, index) => {
          const floor = owners[index]
          return (
            opening?.bottomCm === undefined ||
            (carried
              ? !floor ||
                carryElevation === undefined ||
                compareDecimalSums([carryElevation], [floor.elevationCm, opening.bottomCm]) < 0
              : opening.bottomCm !== 0)
          )
        })
      )
        reason = carried
          ? 'Нижняя грань проёма неизвестна либо основание переноса ниже неё.'
          : 'Нижняя грань проёма неизвестна или поднята над полом.'
      else if (!threshold) reason = 'Отметка верха порога не подтверждена.'
      else if (
        carried
          ? carryElevation === undefined || threshold.elevationCm > carryElevation
          : threshold.elevationCm !== owners[0]?.elevationCm
      )
        reason = carried
          ? 'Верх порога выше выбранного основания переноса.'
          : 'Верх порога выше пола: преодоление ступени не проверяется.'
      else if (!carried && owners[0]?.elevationCm !== startElevation)
        reason = 'Переход находится на другом уровне, чем стартовая зона.'
      else if (transfer && owners.some((owner) => !owner || !usableFloorIds.has(owner.id)))
        reason = 'Неизвестна отметка потолка либо габарит с запасом выше потолка.'
      else if (
        transfer &&
        currentOpenings.some((opening, index) => {
          const floor = owners[index]
          return (
            opening?.heightCm === undefined ||
            (carried
              ? !floor ||
                opening.bottomCm === undefined ||
                carryElevation === undefined ||
                compareDecimalSums(
                  [carryElevation, transfer.heightCm],
                  [floor.elevationCm, opening.bottomCm, opening.heightCm],
                ) > 0
              : opening.heightCm < transfer.heightCm)
          )
        })
      )
        reason = 'Высота проёма неизвестна либо габарит с запасом выше проёма.'
      else if (!thresholdSurfaces.some((surface) => surface.id === threshold.id))
        reason = 'Поверхность порога не подтверждена по исходным граням и косякам.'
      if (reason) heldTransitions.push({ openingIds: [a.opening.id, b.opening.id], reason })
      raised = reason !== undefined
    }
    if (reference) {
      const threshold = reference.thresholds.find((value) =>
        value.bindings.every((side) => [a.opening.id, b.opening.id].includes(side.opening.id)),
      )
      const surface = thresholdSurfaces.find((surface) => surface.id === threshold?.id)
      if (!raised && surface) portals.push(body(surface.floor))
    } else if (
      first.legacy &&
      second.legacy &&
      first.legacy.coordinate !== second.legacy.coordinate
    ) {
      const legacyFirst = first.legacy
      const legacySecond = second.legacy
      // Полоса лежит снаружи обоих полов, между обращёнными друг к другу гранями.
      const direction = Math.sign(legacySecond.coordinate - legacyFirst.coordinate)
      const expectedSide = legacyFirst.along === 'xCm' ? -direction : direction
      if (legacyFirst.side !== expectedSide)
        return missing('Дверные грани не обращены друг к другу. Сверьте их по исходному плану.')
      const point = (value: number, coordinate: number): PlanPoint =>
        legacyFirst.along === 'xCm'
          ? { xCm: value, yCm: coordinate }
          : { xCm: coordinate, yCm: value }
      const portal = body([
        point(legacyFirst.low, legacyFirst.coordinate),
        point(legacyFirst.high, legacyFirst.coordinate),
        point(legacyFirst.high, legacySecond.coordinate),
        point(legacyFirst.low, legacySecond.coordinate),
      ])
      if (
        [...floors, ...strips, ...portals].some(
          (other) => polygonClipping.intersection(portal, other).length > 0,
        )
      )
        return missing('Дверной переход пересекает другой контур или доказанную стену.')
      if (!raised) portals.push(portal)
    }
    usedOpenings.add(a.opening.id)
    usedOpenings.add(b.opening.id)
    // Source uniqueness is recorded even when a measured step prevents a cut.
    if (raised) continue
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
  const routeFloors = signed?.ok
    ? signed.surfaces
        .filter(
          (surface) =>
            surface.surface === 'finished-floor' &&
            (carried || surface.elevationCm === startElevation) &&
            (!transfer || usableFloorIds.has(surface.floorId)),
        )
        .map(
          (surface): Polygon => [
            surface.floor.map(({ xCm, yCm }) => [xCm, yCm]),
            ...surface.voids.map((hole) =>
              hole.map(({ xCm, yCm }) => [xCm, yCm] as [number, number]),
            ),
          ],
        )
    : floors
  const firstFloor = routeFloors[0]
  if (!firstFloor) return missing('Добавьте подтверждённый контур стартовой комнаты.')
  const floorAndPortals = polygonClipping.union(firstFloor, ...routeFloors.slice(1), ...portals)
  const occupied = [...strips, ...(transfer?.extraSolids ?? [])]
  const freeFloor = occupied.length
    ? polygonClipping.difference(floorAndPortals, ...occupied)
    : floorAndPortals
  return {
    missing: undefined,
    result: withRouteElevation(
      inspectSourceClearanceRoutes({
        freeFloor,
        rooms: geometry.rooms.map((room, index) => ({ id: String(index), polygon: room.polygon })),
        start,
        widthCm: width,
        ...(transfer
          ? {
              footprintCm: { widthCm: transfer.widthCm, depthCm: transfer.depthCm },
              ...(transfer.allowQuarterTurns ? { allowQuarterTurns: true } : {}),
              ...(transfer.endpointCheck ? { endpointCheck: transfer.endpointCheck } : {}),
              ...(transfer.goal ? { goal: transfer.goal } : {}),
            }
          : {}),
        stepCm: 10,
        maxNodes: transfer?.maxNodes ?? 6000,
        boundaryBarriers,
        metricObstacles: {
          voids: geometry.voids,
          obstacles: [
            ...(geometry.obstacles ?? []),
            ...(geometry.kitchenItems ?? []).map((item) => ({ ...item, kind: 'fixed' as const })),
          ],
        },
      }),
      reference && startElevation !== undefined
        ? {
            referenceId: reference.id,
            elevationCm: carryElevation ?? startElevation,
            heldTransitions,
          }
        : undefined,
    ),
  }
}
