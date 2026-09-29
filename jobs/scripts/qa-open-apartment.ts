// Независимый локальный прогон открытой метрической геометрии. Не импортирует проект пользователя.

import { createHash } from 'node:crypto'
import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { estimateProject, type LayoutItem } from '@uyut/catalog'
import { layoutWithMeasurements } from '@uyut/catalog/layout-with-measurements'
import type { PlanGeometry, PlanPoint } from '@uyut/db'
import { fontFaceCss, type PdfData, renderProjectHtml } from '@uyut/pdf'
import { printPdf } from '../src/lib/print-pdf'

const DATASET = 'philippds/modified-swiss-dwellings-enriched'
const APARTMENT_ID = 'a5266a0d0a3628c0d381f64a9b5aa977'
const SOURCE_URL = `https://datasets-server.huggingface.co/rows?dataset=${DATASET}&config=geometries&split=test&offset=0&length=57`
const outputDir = resolve(dirname(fileURLToPath(import.meta.url)), '../../output/pdf')
const fixturePath = resolve(
  dirname(fileURLToPath(import.meta.url)),
  '../fixtures/open-swiss-apartment-35063.json',
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
if (!entrance) throw new Error('Не найдена входная дверь для нормализации осей')
const entranceAxis = openingAxis(polygonFromWkt(entrance.geom))
rotationRadians = Math.atan2(
  entranceAxis[1].yCm - entranceAxis[0].yCm,
  entranceAxis[1].xCm - entranceAxis[0].xCm,
)

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
const allPoints = areaRows.flatMap((row) => polygonFromWkt(row.geom))
const minX = Math.min(...allPoints.map((point) => point.xCm))
const minY = Math.min(...allPoints.map((point) => point.yCm))
const shift = (point: PlanPoint): PlanPoint => ({ xCm: point.xCm - minX, yCm: point.yCm - minY })

const geometry: PlanGeometry = {
  version: 1,
  status: 'confirmed',
  widthCm: Math.max(...allPoints.map((point) => point.xCm)) - minX,
  heightCm: Math.max(...allPoints.map((point) => point.yCm)) - minY,
  walls: [],
  openings: [],
  rooms: polygons.map(({ name, polygon }) => ({ name, polygon: polygon.map(shift) })),
  warnings: [
    'Открытая модельная геометрия Swiss Dwellings, не обмер реальной квартиры.',
    'Высоты подоконников и зоны распахивания не представлены в источнике.',
  ],
}

const openingMatches: string[] = []
for (const [openingIndex, openingRow] of openingRows.entries()) {
  const axis = openingAxis(polygonFromWkt(openingRow.geom))
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
    const wallId = `${room.name}-opening-wall-${openingIndex}`
    geometry.walls.push({
      id: wallId,
      start: shift(match.start),
      end: shift(match.end),
      kind: 'inner',
    })
    geometry.openings.push({
      id: `${openingRow.entity_subtype.toLowerCase()}-${openingIndex}-${room.name}`,
      type: openingRow.entity_subtype === 'WINDOW' ? 'window' : 'door',
      wallId,
      offsetCm: match.offsetCm,
      widthCm: match.widthCm,
    })
    openingMatches.push(`${openingIndex}:${room.name}:${match.distanceCm.toFixed(1)}cm`)
  }
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
    ? layoutWithMeasurements(name, null, geometry, examples[name], kind)
    : null
  if (examples[name] && !plan) throw new Error(`Схема комнаты ${name} не построена`)
  if (plan) {
    if (plan.placed.length !== 1 || plan.problems.length > 0) {
      throw new Error(`Тестовый предмет не размещён в комнате ${name}`)
    }
    if (plan.safetySummary.status !== 'needs-data') {
      throw new Error(`Неожиданный статус достоверности комнаты ${name}`)
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
    projectUrl: 'archilyse.standfest.science/swiss-dwellings',
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
  apartmentId: APARTMENT_ID,
  unitId: rows[0]?.unit_id,
  sourceCounts: { areas: areaRows.length, walls: wallRows.length, openings: openingRows.length },
  mappedOpeningHosts: openingMatches,
  rooms: rooms.map((room) => ({
    name: room.name,
    sourceAreaM2: room.areaM2,
    status: room.plan?.safetySummary.status,
    placements: room.plan?.placed.length,
    problems: room.plan?.problems,
  })),
  caveat:
    'Open model geometry, not an as-built survey. Source wall polygons are not converted to thickness-bearing walls. Furniture dimensions are test inputs. Door swing and window sill data are absent.',
}
await writeFile(resolve(outputDir, 'qa-open-swiss-apartment.json'), JSON.stringify(report, null, 2))
console.log(`PDF: ${pdfPath}`)
