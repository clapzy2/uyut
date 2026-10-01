// Независимый локальный прогон открытой метрической геометрии. Не импортирует проект пользователя.

import { createHash } from 'node:crypto'
import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { validatePlanGeometryEdit } from '@uyut/ai'
import { estimateProject, type LayoutItem } from '@uyut/catalog'
import { layoutWithMeasurements } from '@uyut/catalog/layout-with-measurements'
import type { PlanGeometry, PlanPoint } from '@uyut/db'
import { fontFaceCss, type PdfData, renderProjectHtml } from '@uyut/pdf'
import { intersection, type MultiPolygon, type Polygon, union } from 'polygon-clipping'
import {
  inspectManualPlanCompleteness,
  inspectPlanGeometry,
} from '../../apps/web/lib/projects/plan-geometry-inspection'
import { inspectSourceClearanceRoutes } from '../../apps/web/lib/projects/plan-source-clearance-route'
import { inspectSourceDoorConnectivity } from '../../apps/web/lib/projects/plan-source-door-connectivity'
import { printPdf } from '../src/lib/print-pdf'

const DATASET = 'philippds/modified-swiss-dwellings-enriched'
const APARTMENT_ID = 'a5266a0d0a3628c0d381f64a9b5aa977'
const SOURCE_URL = `https://datasets-server.huggingface.co/rows?dataset=${DATASET}&config=geometries&split=test&offset=0&length=57`
const outputDir = resolve(dirname(fileURLToPath(import.meta.url)), '../../output/pdf')
const fixturePath = resolve(
  dirname(fileURLToPath(import.meta.url)),
  '../fixtures/open-swiss-apartment-35063.json',
)
const geometryFixturePath = resolve(
  dirname(fileURLToPath(import.meta.url)),
  '../fixtures/open-swiss-apartment-35063-geometry.json',
)
const EXPECTED_SOURCE_SHA256 = '64cc131632e6cc15cbef566c98fad8eb8db00b876fb65197f0446fe7931eafbc'

type SourceRow = {
  apartment_id: string
  unit_id: number
  area_id: number | null
  entity_type: 'area' | 'separator' | 'opening'
  entity_subtype: string
  geom: string
  roomtype: string
}

type SourceResponse = { rows: Array<{ row: SourceRow }>; num_rows_total: number }

let rotationRadians = 0

function polygonFromWkt(wkt: string): PlanPoint[] {
  const coordinateText = /^POLYGON \(\((.*)\)\)$/.exec(wkt)?.[1]
  if (!coordinateText) throw new Error(`Ожидался POLYGON, получено: ${wkt.slice(0, 30)}`)
  const points = coordinateText.split(', ').map((pair) => {
    const [x, y] = pair.trim().split(/\s+/).map(Number)
    if (x === undefined || y === undefined || !Number.isFinite(x) || !Number.isFinite(y)) {
      throw new Error('Некорректная точка WKT')
    }
    const xCm = x * 100
    const yCm = y * 100
    return {
      xCm: xCm * Math.cos(rotationRadians) + yCm * Math.sin(rotationRadians),
      yCm: -xCm * Math.sin(rotationRadians) + yCm * Math.cos(rotationRadians),
    }
  })
  if (points.length < 4) throw new Error('Контур слишком короткий')
  return points.slice(0, -1)
}

function length(a: PlanPoint, b: PlanPoint): number {
  return Math.hypot(b.xCm - a.xCm, b.yCm - a.yCm)
}

function areaM2(polygon: PlanPoint[]): number {
  let twiceArea = 0
  for (let index = 0; index < polygon.length; index += 1) {
    const a = polygon[index]
    const b = polygon[(index + 1) % polygon.length]
    if (!a || !b) continue
    twiceArea += a.xCm * b.yCm - b.xCm * a.yCm
  }
  return Math.abs(twiceArea) / 20_000
}

function sourcePolygon(row: SourceRow): Polygon {
  // Match the product parser's 0.1 cm grid when comparing source polygons.
  // This avoids floating-point seams after rotation without changing source measurements.
  const ring = polygonFromWkt(row.geom).map(
    (point) =>
      [Math.round(point.xCm * 10) / 10, Math.round(point.yCm * 10) / 10] as [number, number],
  )
  const first = ring[0]
  if (!first) throw new Error('Пустой исходный полигон')
  return [[...ring, first]]
}

function footprint(rows: SourceRow[]): MultiPolygon {
  const [first, second, ...rest] = rows.map(sourcePolygon)
  if (!first) throw new Error('Нет исходных полигонов для внешнего контура')
  if (!second) return [first]
  return union(first, second, ...rest)
}

function footprintSummary(body: MultiPolygon) {
  return {
    components: body.length,
    holes: body.reduce((sum, polygon) => sum + polygon.length - 1, 0),
    outerVertices: body.map((polygon) => (polygon[0]?.length ?? 1) - 1),
    outerAreasM2: body.map((polygon) =>
      areaM2((polygon[0] ?? []).slice(0, -1).map(([xCm, yCm]) => ({ xCm, yCm }))),
    ),
  }
}

function clippedAreaM2(body: MultiPolygon): number {
  return body.reduce(
    (total, polygon) =>
      total +
      polygon.reduce((area, ring, index) => {
        const points = ring.slice(0, -1).map(([xCm, yCm]) => ({ xCm, yCm }))
        return area + (index === 0 ? 1 : -1) * areaM2(points)
      }, 0),
    0,
  )
}

function sourceVoid(row: SourceRow, body: MultiPolygon) {
  const shape = sourcePolygon(row)
  const area = clippedAreaM2([shape])
  const holes = body.flatMap((polygon) => polygon.slice(1))
  const containingHole = holes.findIndex((ring) => {
    const coveredArea = clippedAreaM2(intersection(shape, [ring]))
    return Math.abs(coveredArea - area) < 0.0001
  })
  if (containingHole < 0 || clippedAreaM2(intersection(shape, body)) > 0.0001) {
    throw new Error(`Техническая шахта ${row.area_id}: форма не лежит в пустоте плана`)
  }
  return {
    sourceId: row.area_id,
    areaM2: area,
    vertices: polygonFromWkt(row.geom)
      .slice(0)
      .map((point) => ({
        xCm: Math.round(point.xCm * 10) / 10,
        yCm: Math.round(point.yCm * 10) / 10,
      })),
    holeIndex: containingHole,
  }
}

function distanceToEdge(point: PlanPoint, start: PlanPoint, end: PlanPoint): number {
  const dx = end.xCm - start.xCm
  const dy = end.yCm - start.yCm
  const squaredLength = dx * dx + dy * dy
  if (squaredLength === 0) return length(point, start)
  const ratio = Math.max(
    0,
    Math.min(1, ((point.xCm - start.xCm) * dx + (point.yCm - start.yCm) * dy) / squaredLength),
  )
  return length(point, { xCm: start.xCm + dx * ratio, yCm: start.yCm + dy * ratio })
}

function boundaryEvidence(body: MultiPolygon, sources: SourceRow[]) {
  const outerRing = body[0]?.[0]
  if (!outerRing) throw new Error('Внешний контур исходной квартиры не найден')
  const sourceEdges = sources.flatMap((row) => {
    const ring = sourcePolygon(row)[0] ?? []
    return ring.slice(0, -1).flatMap(([xCm, yCm], index) => {
      const next = ring[index + 1]
      if (!next) return []
      return [
        {
          type: row.entity_type,
          subtype: row.entity_subtype,
          sourceId: row.area_id,
          start: { xCm, yCm },
          end: { xCm: next[0], yCm: next[1] },
        },
      ]
    })
  })
  const sourcePriority = { separator: 0, opening: 1, area: 2 }
  sourceEdges.sort((first, second) => sourcePriority[first.type] - sourcePriority[second.type])
  const byType = { separator: 0, opening: 0, area: 0, unsupported: 0 }
  const areaOnly: Array<{
    sourceId: number | null
    subtype: string
    lengthCm: number
    start: PlanPoint
    end: PlanPoint
  }> = []
  const unsupported: Array<{ start: PlanPoint; end: PlanPoint }> = []
  for (const [index, [xCm, yCm]] of outerRing.slice(0, -1).entries()) {
    const next = outerRing[index + 1]
    if (!next) continue
    const start = { xCm, yCm }
    const end = { xCm: next[0], yCm: next[1] }
    const segmentLength = length(start, end)
    const fractions = [0, 1]
    for (const edge of sourceEdges) {
      for (const point of [edge.start, edge.end]) {
        if (distanceToEdge(point, start, end) > 0.05) continue
        const fraction =
          ((point.xCm - start.xCm) * (end.xCm - start.xCm) +
            (point.yCm - start.yCm) * (end.yCm - start.yCm)) /
          (segmentLength * segmentLength)
        if (fraction > 0 && fraction < 1) fractions.push(fraction)
      }
    }
    fractions.sort((first, second) => first - second)
    for (let part = 0; part < fractions.length - 1; part += 1) {
      const from = fractions[part]
      const to = fractions[part + 1]
      if (from === undefined || to === undefined || to - from < 0.000001) continue
      const pointAt = (fraction: number): PlanPoint => ({
        xCm: start.xCm + (end.xCm - start.xCm) * fraction,
        yCm: start.yCm + (end.yCm - start.yCm) * fraction,
      })
      const partStart = pointAt(from)
      const partEnd = pointAt(to)
      const support = sourceEdges.find(
        (edge) =>
          distanceToEdge(partStart, edge.start, edge.end) <= 0.05 &&
          distanceToEdge(partEnd, edge.start, edge.end) <= 0.05,
      )
      if (support) {
        const partLength = length(partStart, partEnd)
        byType[support.type] += partLength
        if (support.type === 'area') {
          areaOnly.push({
            sourceId: support.sourceId,
            subtype: support.subtype,
            lengthCm: partLength,
            start: partStart,
            end: partEnd,
          })
        }
      } else {
        byType.unsupported += length(partStart, partEnd)
        unsupported.push({ start: partStart, end: partEnd })
      }
    }
  }
  return { lengthCmBySourceType: byType, areaOnly, unsupported }
}

function openingAxis(polygon: PlanPoint[]): [PlanPoint, PlanPoint] {
  if (polygon.length !== 4) throw new Error('Проём должен иметь четыре угла')
  const [a, b, c, d] = polygon as [PlanPoint, PlanPoint, PlanPoint, PlanPoint]
  const midpoint = (first: PlanPoint, second: PlanPoint): PlanPoint => ({
    xCm: (first.xCm + second.xCm) / 2,
    yCm: (first.yCm + second.yCm) / 2,
  })
  return length(a, b) < length(b, c)
    ? [midpoint(a, b), midpoint(c, d)]
    : [midpoint(b, c), midpoint(d, a)]
}

function rectangularBody(polygon: PlanPoint[]): {
  axis: [PlanPoint, PlanPoint]
  thicknessCm: number
  areaM2: number
} {
  if (polygon.length !== 4) throw new Error('Тело стены должно иметь четыре угла')
  const [a, b, c, d] = polygon as [PlanPoint, PlanPoint, PlanPoint, PlanPoint]
  const first = length(a, b)
  const second = length(b, c)
  const third = length(c, d)
  const fourth = length(d, a)
  const thicknessCm = Math.min(first, second)
  const bodyAreaM2 = areaM2(polygon)
  const expectedAreaM2 = (thicknessCm * Math.max(first, second)) / 10_000
  if (
    Math.abs(first - third) > 0.01 ||
    Math.abs(second - fourth) > 0.01 ||
    Math.abs(bodyAreaM2 - expectedAreaM2) > 0.0001
  ) {
    throw new Error('Полигон стены не является прямоугольником; центрлиния не доказана')
  }
  return { axis: openingAxis(polygon), thicknessCm, areaM2: bodyAreaM2 }
}

function openingOnEdge(
  axis: [PlanPoint, PlanPoint],
  start: PlanPoint,
  end: PlanPoint,
): { offsetCm: number; widthCm: number; distanceCm: number } | null {
  const edgeLength = length(start, end)
  const openingLength = length(axis[0], axis[1])
  if (edgeLength === 0 || openingLength === 0) return null
  const dx = (end.xCm - start.xCm) / edgeLength
  const dy = (end.yCm - start.yCm) / edgeLength
  const axisDx = (axis[1].xCm - axis[0].xCm) / openingLength
  const axisDy = (axis[1].yCm - axis[0].yCm) / openingLength
  if (Math.abs(dx * axisDx + dy * axisDy) < 0.995) return null
  const along = axis.map((point) => (point.xCm - start.xCm) * dx + (point.yCm - start.yCm) * dy)
  const offsetCm = Math.min(...along)
  const widthCm = Math.max(...along) - offsetCm
  if (offsetCm < -2 || offsetCm + widthCm > edgeLength + 2) return null
  const distanceCm = Math.max(
    ...axis.map((point) => Math.abs((point.xCm - start.xCm) * dy - (point.yCm - start.yCm) * dx)),
  )
  return { offsetCm: Math.max(0, offsetCm), widthCm, distanceCm }
}

const source = JSON.parse(await readFile(fixturePath, 'utf8')) as SourceResponse
const rows = source.rows.map(({ row }) => row)
const sourceSha256 = createHash('sha256').update(JSON.stringify(rows)).digest('hex')
if (sourceSha256 !== EXPECTED_SOURCE_SHA256) {
  throw new Error('Контрольная сумма геометрии не совпала с сохранённым источником')
}
if (rows.length !== 57 || rows.some((row) => row.apartment_id !== APARTMENT_ID)) {
  throw new Error('Состав выбранной квартиры изменился: не смешиваем её с другими объектами')
}
const areaRows = rows.filter((row) => row.entity_type === 'area')
const wallRows = rows.filter((row) => row.entity_type === 'separator')
const openingRows = rows.filter((row) => row.entity_type === 'opening')
if (areaRows.length !== 10 || wallRows.length !== 38 || openingRows.length !== 9) {
  throw new Error('Типы объектов открытого источника изменились')
}
const entrance = openingRows.find((row) => row.entity_subtype === 'ENTRANCE_DOOR')
// Raw source coordinates: no rotation, rounding or proximity-based attachment.
const doorConnectivity = inspectSourceDoorConnectivity({
  rooms: areaRows
    .filter((row) => row.entity_subtype !== 'SHAFT')
    .map((row) => ({ id: String(row.area_id), polygon: polygonFromWkt(row.geom) })),
  walls: wallRows.map((row, index) => ({ id: `wall-${index}`, polygon: polygonFromWkt(row.geom) })),
  voids: areaRows
    .filter((row) => row.entity_subtype === 'SHAFT')
    .map((row) => ({ id: String(row.area_id), polygon: polygonFromWkt(row.geom) })),
  openings: openingRows.map((row, index) => {
    const polygon = polygonFromWkt(row.geom)
    return {
      id: `opening-${index}`,
      polygon,
      axis: rectangularBody(polygon).axis,
      kind:
        row.entity_subtype === 'WINDOW'
          ? 'window'
          : row.entity_subtype === 'ENTRANCE_DOOR'
            ? 'entrance'
            : 'door',
    }
  }),
})
if (
  doorConnectivity.status !== 'connected-topology' ||
  doorConnectivity.doors.length !== 8 ||
  doorConnectivity.reachedRoomIds.length !== 8
) {
  throw new Error('Исходные дверные переходы не подтвердили связность восьми зон')
}
const narrowSourceDoors = doorConnectivity.doors.filter((door) => door.widthCm < 70)
if (!entrance) throw new Error('Не найдена входная дверь для проверки маршрута')
const entryBody = rectangularBody(polygonFromWkt(entrance.geom))
const [entryA, entryB] = entryBody.axis
const angle = Math.atan2(entryB.yCm - entryA.yCm, entryB.xCm - entryA.xCm)
const rotate = (point: PlanPoint): PlanPoint => ({
  xCm: point.xCm * Math.cos(angle) + point.yCm * Math.sin(angle),
  yCm: -point.xCm * Math.sin(angle) + point.yCm * Math.cos(angle),
})
const entryRoomId = doorConnectivity.doors.find((door) => door.kind === 'entrance')?.roomIds[0]
const entryRoom = areaRows.find((row) => String(row.area_id) === entryRoomId)
if (!entryRoom) throw new Error('Не найден пол входной зоны')
const rotatedEntry = rotate({
  xCm: (entryA.xCm + entryB.xCm) / 2,
  yCm: (entryA.yCm + entryB.yCm) / 2,
})
const entryRoomPoints = polygonFromWkt(entryRoom.geom).map(rotate)
const insideSign = Math.sign(
  entryRoomPoints.reduce((sum, point) => sum + point.yCm - rotatedEntry.yCm, 0),
)
const sourceClearanceRoutes = inspectSourceClearanceRoutes({
  freeFloor: doorConnectivity.freeFloor.map((body) =>
    body.map((ring) =>
      ring.map(([xCm, yCm]) => {
        const point = rotate({ xCm, yCm })
        return [point.xCm, point.yCm]
      }),
    ),
  ),
  rooms: areaRows
    .filter((row) => row.entity_subtype !== 'SHAFT')
    .map((row) => ({ id: String(row.area_id), polygon: polygonFromWkt(row.geom).map(rotate) })),
  start: {
    xCm: rotatedEntry.xCm,
    yCm: rotatedEntry.yCm + insideSign * (35 + entryBody.thicknessCm / 2),
  },
  widthCm: 70,
  stepCm: 5,
})
if (process.argv.includes('--topology-only')) {
  const { freeFloor: _freeFloor, ...connectivitySummary } = doorConnectivity
  console.log(
    JSON.stringify(
      {
        sourceSha256,
        doorConnectivity: connectivitySummary,
        narrowSourceDoors,
        sourceClearanceRoutes: {
          ...sourceClearanceRoutes,
          routes: sourceClearanceRoutes.routes.map((route) => ({
            roomId: route.roomId,
            pointCount: route.points.length,
            start: route.points[0],
            end: route.points.at(-1),
          })),
        },
        minimumWidthCm: 70,
        widthClearanceCertified: false,
      },
      null,
      2,
    ),
  )
  process.exit(0)
}
if (!entrance) throw new Error('Не найдена входная дверь для нормализации осей')
const entranceAxis = openingAxis(polygonFromWkt(entrance.geom))
rotationRadians = Math.atan2(
  entranceAxis[1].yCm - entranceAxis[0].yCm,
  entranceAxis[1].xCm - entranceAxis[0].xCm,
)

const sourceFootprints = {
  allBodies: footprint(rows),
  withoutShafts: footprint(rows.filter((row) => row.entity_subtype !== 'SHAFT')),
  floorsAndWalls: footprint([...areaRows, ...wallRows]),
  wallsOnly: footprint(wallRows),
  roomFloors: footprint(areaRows.filter((row) => row.entity_subtype !== 'SHAFT')),
}
const continuousFootprint = footprintSummary(sourceFootprints.withoutShafts)
const allSourceBodies = footprintSummary(sourceFootprints.allBodies)
if (
  continuousFootprint.components !== 1 ||
  allSourceBodies.components !== 3 ||
  footprintSummary(sourceFootprints.wallsOnly).components !== 1
) {
  throw new Error('Топология открытой квартиры изменилась: внешний контур нужно проверить заново')
}
const sourceVoids = areaRows
  .filter((row) => row.entity_subtype === 'SHAFT')
  .map((row) => sourceVoid(row, sourceFootprints.withoutShafts))
const outerBoundaryEvidence = boundaryEvidence(sourceFootprints.withoutShafts, rows)
if (outerBoundaryEvidence.unsupported.length > 0) {
  throw new Error('Часть внешнего контура не подтверждена ни одним исходным полигоном')
}

const zoneNames = [
  'Коридор',
  'Спальня',
  'Кладовая',
  'Шахта 1',
  'Гостиная',
  'Балкон 1',
  'Ванная',
  'Балкон 2',
  'Шахта 2',
  'Кухня',
] as const
const roomKinds = {
  Спальня: 'bedroom',
  Гостиная: 'living',
  Ванная: 'bath',
  Кухня: 'kitchen',
} as const
const polygons = areaRows.map((row, index) => {
  const name = zoneNames[index]
  if (!name) throw new Error('Неизвестная зона в открытом источнике')
  return {
    name,
    kind: roomKinds[name as keyof typeof roomKinds],
    polygon: polygonFromWkt(row.geom),
    sourceId: row.area_id,
    subtype: row.entity_subtype,
  }
})
const allPoints = rows.flatMap((row) => polygonFromWkt(row.geom))
const footprintPoints = (sourceFootprints.withoutShafts[0]?.[0] ?? [])
  .slice(0, -1)
  .map(([xCm, yCm]) => ({ xCm, yCm }))
const wallBodies = wallRows.map((row, index) => ({
  sourceIndex: index + areaRows.length,
  ...rectangularBody(polygonFromWkt(row.geom)),
}))
const physicalOpeningSupports = openingRows.map((row, openingIndex) => {
  const axis = openingAxis(polygonFromWkt(row.geom))
  const supportedBy = wallBodies.flatMap((wall) => {
    const match = openingOnEdge(axis, wall.axis[0], wall.axis[1])
    return match && match.distanceCm <= (wall.thicknessCm + 2) / 2 ? [wall.sourceIndex] : []
  })
  return { openingIndex, supportedBy }
})
const envelopePoints = [...allPoints, ...footprintPoints]
const minX = Math.floor(Math.min(...envelopePoints.map((point) => point.xCm)) * 10) / 10
const minY = Math.floor(Math.min(...envelopePoints.map((point) => point.yCm)) * 10) / 10
const shift = (point: PlanPoint): PlanPoint => ({ xCm: point.xCm - minX, yCm: point.yCm - minY })
const topologyPoint = (point: PlanPoint): PlanPoint =>
  shift({
    xCm: Math.round(point.xCm * 10) / 10,
    yCm: Math.round(point.yCm * 10) / 10,
  })

const geometry: PlanGeometry = {
  version: 1,
  // Controlled downstream fixture only. The server gate below must still approve a real project.
  status: 'confirmed',
  widthCm: Math.ceil((Math.max(...envelopePoints.map((point) => point.xCm)) - minX) * 10) / 10,
  heightCm: Math.ceil((Math.max(...envelopePoints.map((point) => point.yCm)) - minY) * 10) / 10,
  walls: wallBodies.map((body) => ({
    id: `source-wall-${body.sourceIndex}`,
    start: shift(body.axis[0]),
    end: shift(body.axis[1]),
    kind: 'inner',
    thicknessCm: body.thicknessCm,
  })),
  openings: [],
  rooms: polygons
    .filter(({ subtype }) => subtype !== 'SHAFT')
    .map(({ name, polygon }) => ({ name, polygon: polygon.map(topologyPoint) })),
  footprint: (sourceFootprints.withoutShafts[0]?.[0] ?? [])
    .slice(0, -1)
    .map(([xCm, yCm]) => shift({ xCm, yCm })),
  voids: sourceVoids.map((voidShape) => ({
    id: `source-void-${voidShape.sourceId}`,
    polygon: voidShape.vertices.map(shift),
  })),
  warnings: [
    'Открытая модельная геометрия Swiss Dwellings, не обмер реальной квартиры.',
    'Высоты подоконников и зоны распахивания не представлены в источнике.',
  ],
}

const openingMatches: string[] = []
for (const [openingIndex, openingRow] of openingRows.entries()) {
  const axis = openingAxis(polygonFromWkt(openingRow.geom))
  const supports = physicalOpeningSupports[openingIndex]?.supportedBy
  if (supports?.length !== 1) {
    throw new Error(`Проём ${openingIndex}: нет единственного исходного тела стены`)
  }
  const host = wallBodies.find((body) => body.sourceIndex === supports[0])
  const hostMatch = host && openingOnEdge(axis, host.axis[0], host.axis[1])
  if (!hostMatch) throw new Error(`Проём ${openingIndex}: нет привязки к оси стены`)
  geometry.openings.push({
    id: `${openingRow.entity_subtype.toLowerCase()}-${openingIndex}`,
    type: openingRow.entity_subtype === 'WINDOW' ? 'window' : 'door',
    wallId: `source-wall-${host.sourceIndex}`,
    offsetCm: hostMatch.offsetCm,
    widthCm: hostMatch.widthCm,
  })
  for (const room of polygons) {
    const candidates = room.polygon.flatMap((start, edgeIndex) => {
      const end = room.polygon[(edgeIndex + 1) % room.polygon.length]
      if (!end) return []
      const match = openingOnEdge(axis, start, end)
      return match && match.distanceCm <= 20 ? [{ start, end, edgeIndex, ...match }] : []
    })
    candidates.sort((a, b) => a.distanceCm - b.distanceCm)
    const match = candidates[0]
    if (!match) continue
    openingMatches.push(`${openingIndex}:${room.name}:${match.distanceCm.toFixed(1)}cm`)
  }
}

const parsedGeometry = validatePlanGeometryEdit(geometry)
const serverParsed: PlanGeometry | undefined = parsedGeometry
  ? { ...parsedGeometry, footprint: geometry.footprint, voids: geometry.voids }
  : undefined
const serverIssues = serverParsed
  ? [...inspectPlanGeometry(serverParsed), ...inspectManualPlanCompleteness(serverParsed)]
  : []
if (serverIssues.some((issue) => issue.id === 'manual-disconnected-walls')) {
  throw new Error('Исходные тела стен касаются друг друга, но проверка считает их разорванными')
}
if (
  !serverParsed ||
  serverParsed.walls.length !== geometry.walls.length ||
  serverParsed.openings.length !== geometry.openings.length ||
  serverParsed.rooms.length !== geometry.rooms.length ||
  serverIssues.some((issue) => issue.severity === 'error')
) {
  throw new Error('Структурный 2D-допуск открытой квартиры не пройден')
}
// Match the action's confirmed state after validation; downstream never sees the raw WKT object.
const confirmedGeometry: PlanGeometry = { ...serverParsed, status: 'confirmed' }

if (process.argv.includes('--write-geometry-fixture')) {
  await writeFile(
    geometryFixturePath,
    `${JSON.stringify(
      {
        sourceSha256,
        // Exercise the same reviewed/manual confirmation gate used for metric PDF drafts.
        geometry: { ...confirmedGeometry, source: 'manual', status: 'draft' },
        rooms: polygons
          .filter(({ subtype }) => subtype !== 'SHAFT')
          .map(({ name, kind, polygon }) => ({
            name,
            kind: kind ?? 'living',
            areaM2: areaM2(polygon),
            ...(kind ? {} : { utility: true }),
          })),
      },
      null,
      2,
    )}\n`,
  )
}

const examples: Record<string, LayoutItem[]> = {
  Спальня: [
    {
      id: 'bed',
      title: 'Кровать — тестовый габарит',
      category: 'bed',
      quantity: 1,
      dimensions: { width: 160, depth: 200 },
    },
  ],
  Гостиная: [
    {
      id: 'sofa',
      title: 'Диван — тестовый габарит',
      category: 'sofa',
      quantity: 1,
      dimensions: { width: 210, depth: 90 },
    },
  ],
  Кухня: [
    {
      id: 'table',
      title: 'Стол — тестовый габарит',
      category: 'table',
      quantity: 1,
      dimensions: { width: 100, depth: 70 },
    },
  ],
}
const rooms: PdfData['rooms'] = polygons.map(({ name, kind, polygon, sourceId, subtype }) => {
  const plan = examples[name]
    ? layoutWithMeasurements(name, null, confirmedGeometry, examples[name], kind)
    : null
  if (examples[name] && !plan) throw new Error(`Схема комнаты ${name} не построена`)
  if (plan) {
    if (plan.placed.length !== 1 || plan.problems.length > 0) {
      throw new Error(`Тестовый предмет не размещён в комнате ${name}`)
    }
    if (plan.safetySummary.status !== 'needs-data') {
      throw new Error(`Неожиданный статус достоверности комнаты ${name}`)
    }
    const sourceOpeningCount = openingMatches.filter((match) => match.includes(`:${name}:`)).length
    if (plan.floorReservations.length !== sourceOpeningCount) {
      throw new Error(
        `${name}: из ${sourceOpeningCount} исходных проёмов учтено ${plan.floorReservations.length}; ${plan.missingSafetyData.join('; ')}`,
      )
    }
    console.log(
      `${name}: ${plan.safetySummary.status}; предметов: ${plan.placed.length}; проблемы: ${plan.problems.length}`,
    )
  }
  return {
    id: String(sourceId),
    name,
    areaM2: areaM2(polygon),
    conditionLabel: 'Открытый тестовый набор',
    hasConcept: false,
    render: null,
    before: null,
    alternates: [],
    note: plan
      ? 'Контур и проёмы из открытой модели. Габарит мебели — тестовое условие, не данные источника.'
      : subtype === 'SHAFT'
        ? 'Техническая шахта из открытой модели; расстановка мебели не применяется.'
        : 'Зона учтена в составе квартиры; расстановка мебели не проверялась.',
    objects: [],
    plan,
  }
})
// Этот прогон проверяет геометрию, не цену ремонта. Нулевые ставки не создают фиктивную смету.
const rates = { roughRubPerM2: 0, finishRubPerM2: 0 }
const data: PdfData = {
  kind: 'free',
  generatedAt: new Date('2026-09-30T10:00:00Z'),
  project: {
    title: 'Независимый тест 2D — Swiss Dwellings',
    subtitle: 'Одна открытая квартира. Геометрия из WKT; мебель задана отдельно для испытания.',
    facts: [
      { label: 'Источник', value: `Swiss Dwellings, apartment_id ${APARTMENT_ID}` },
      { label: 'Оговорка', value: 'Не исполнительный обмер и не проект к ремонту' },
      { label: 'Смета', value: 'Не тестируется; 0 ₽ — техническое значение, не цена ремонта' },
    ],
    contact: null,
    projectUrl: null,
  },
  summary: null,
  cover: null,
  band: null,
  rooms,
  roomsWithoutConcept: rooms.filter((room) => room.plan).map((room) => room.name),
  shopping: [],
  estimate: estimateProject({
    rooms: rooms.map((room) => ({
      id: room.id,
      name: room.name,
      areaM2: room.areaM2,
      condition: 'bare' as const,
      refreshFinish: false,
    })),
    items: [],
    budgetKopecks: null,
    rates,
  }),
  rates,
  brief: null,
}

await mkdir(outputDir, { recursive: true })
const pdf = await printPdf(renderProjectHtml(data, { fontCss: fontFaceCss() }), data.project.title)
const pdfPath = resolve(outputDir, 'qa-open-swiss-apartment.pdf')
await writeFile(pdfPath, pdf)
const report = {
  source: SOURCE_URL,
  sourceSha256,
  doorConnectivity,
  narrowSourceDoors,
  sourceClearanceRoutes,
  apartmentId: APARTMENT_ID,
  unitId: rows[0]?.unit_id,
  sourceCounts: { areas: areaRows.length, walls: wallRows.length, openings: openingRows.length },
  wallBodies: {
    rectangular: wallBodies.length,
    minThicknessCm: Math.min(...wallBodies.map((wall) => wall.thicknessCm)),
    maxThicknessCm: Math.max(...wallBodies.map((wall) => wall.thicknessCm)),
    totalAreaM2: wallBodies.reduce((sum, wall) => sum + wall.areaM2, 0),
  },
  physicalOpeningSupports,
  sourceFootprints: {
    allBodies: footprintSummary(sourceFootprints.allBodies),
    withoutShafts: footprintSummary(sourceFootprints.withoutShafts),
    floorsAndWalls: footprintSummary(sourceFootprints.floorsAndWalls),
    wallsOnly: footprintSummary(sourceFootprints.wallsOnly),
    wallFloorOverlapM2: clippedAreaM2(
      intersection(sourceFootprints.wallsOnly, sourceFootprints.roomFloors),
    ),
  },
  outerBoundaryEvidence: {
    ...outerBoundaryEvidence,
    contourCm: (sourceFootprints.withoutShafts[0]?.[0] ?? [])
      .slice(0, -1)
      .map(([xCm, yCm]) => shift({ xCm, yCm })),
    areaOnly: outerBoundaryEvidence.areaOnly.map((segment) => ({
      ...segment,
      start: shift(segment.start),
      end: shift(segment.end),
    })),
  },
  structuralVoidsNotRepresented: sourceVoids.map((voidShape) => ({
    ...voidShape,
    vertices: voidShape.vertices.map(shift),
  })),
  serverGate: {
    parsed: Boolean(serverParsed),
    parsedWalls: serverParsed?.walls.length ?? 0,
    parsedOpenings: serverParsed?.openings.length ?? 0,
    parsedRooms: serverParsed?.rooms.length ?? 0,
    rejectedWalls: geometry.walls.length - (serverParsed?.walls.length ?? 0),
    rejectedOpenings: geometry.openings.length - (serverParsed?.openings.length ?? 0),
    rejectedRooms: geometry.rooms.length - (serverParsed?.rooms.length ?? 0),
    canConfirm:
      Boolean(serverParsed) &&
      serverParsed?.walls.length === geometry.walls.length &&
      serverParsed?.openings.length === geometry.openings.length &&
      serverParsed?.rooms.length === geometry.rooms.length &&
      !serverIssues.some((issue) => issue.severity === 'error'),
    issues: serverIssues.filter((issue) => issue.severity === 'error').slice(0, 20),
  },
  mappedOpeningHosts: openingMatches,
  rooms: rooms.map((room) => ({
    name: room.name,
    sourceAreaM2: room.areaM2,
    status: room.plan?.safetySummary.status,
    placements: room.plan?.placed.length,
    roomOpenings: room.plan?.floorReservations.length,
    problems: room.plan?.problems,
  })),
  caveat:
    'Открытая модельная геометрия, не обмер квартиры. Тела стен перенесены как прямоугольники с толщиной; внешние стены пока не классифицированы. Мебель задана для теста. Зоны открывания дверей и высоты подоконников отсутствуют.',
}
await writeFile(resolve(outputDir, 'qa-open-swiss-apartment.json'), JSON.stringify(report, null, 2))
console.log(`PDF: ${pdfPath}`)
