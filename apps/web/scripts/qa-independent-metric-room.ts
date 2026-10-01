/** Local-only source check for manually reviewed rooms; no AI or database calls. */
import { createHash } from 'node:crypto'
import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { dirname, resolve } from 'node:path'
import { estimateProject } from '@uyut/catalog'
import { layoutWithMeasurements } from '@uyut/catalog/layout-with-measurements'
import type { PlanOpening, PlanPageContours, PlanReading } from '@uyut/db'
import { fontFaceCss, type PdfData, renderProjectHtml } from '@uyut/pdf'
import sharp from 'sharp'
import { printPdf } from '../../../jobs/src/lib/print-pdf'
import { preparePlanPage } from '../lib/projects/plan-document'
import {
  inspectManualPlanCompleteness,
  inspectPlanGeometry,
} from '../lib/projects/plan-geometry-inspection'
import { planPageAreaConflicts } from '../lib/projects/plan-page-area-conflicts'
import {
  planPageGeometryElementId,
  planPageMetricDraft,
} from '../lib/projects/plan-page-metric-draft'
import { planPageContoursSchema, planPageReviewIssue } from '../lib/projects/plan-page-review'
import { planPageRoomInventory } from '../lib/projects/plan-page-room-inventory'
import { inspectPdfClearanceRoutes } from '../lib/projects/plan-pdf-clearance-route'
import { pdfDepthChain, pdfWidthChain } from '../lib/projects/plan-pdf-dimension-chain'
import { verifyPlanPageOpeningFaces } from '../lib/projects/plan-pdf-opening-faces'
import { pdfPointDistance } from '../lib/projects/plan-pdf-room-binding'
import {
  classifyPlanPageWallSpans,
  planPageWallReviewQueue,
} from '../lib/projects/plan-pdf-wall-coverage'
import { pairPlanPageWallFaces } from '../lib/projects/plan-pdf-wall-faces'
import { inspectPlanPageWallSolids } from '../lib/projects/plan-pdf-wall-solids'

type Chain = { textItemIndexes: number[]; segmentsMm: number[] }
type ReviewedRoom = {
  sourceNumber: number
  name: string
  kind: PlanReading['rooms'][number]['kind']
  utility?: boolean
  areaM2?: number
  polygon: PlanPageContours['rooms'][number]['polygon']
  conditionalEdges?: PlanPageContours['rooms'][number]['conditionalEdges']
  openings?: PlanPageContours['rooms'][number]['openings']
  widthMm?: number
  depthMm?: number
  width?: Chain
  depth?: Chain
}
type Fixture = {
  source: { sha256: string; pdfPage: number; state: 'existing' }
  room?: ReviewedRoom
  rooms?: ReviewedRoom[]
  calibrationRoomNumbers?: number[]
  sourceRoomNumbers?: number[]
  exterior?: PlanPageContours['exterior']
  expectedDimensionIssues?: Array<{ sourceNumber: number; side: 'width' | 'depth'; reason: string }>
  areaConflicts?: Array<{
    sourceNumber: number
    planTextItemIndex: number
    legendTextItemIndex: number
    planAreaM2: number
    legendAreaM2: number
  }>
  routeCheck?: {
    startRoomNumber: number
    startOpeningId: string
    clearance: NonNullable<PlanOpening['clearance']>
    widthsCm: number[]
  }
}

const [pdfPath, fixturePath, overlayPath, layoutPdfPath, geometryPath] = process.argv.slice(2)
if (!pdfPath || !fixturePath) {
  throw new Error(
    'Usage: bun run scripts/qa-independent-metric-room.ts <PDF> <fixture.json> [overlay.png] [layout.pdf] [geometry.json]',
  )
}
const fixture = JSON.parse(await readFile(fixturePath, 'utf8')) as Fixture
const rooms = fixture.rooms ?? (fixture.room ? [fixture.room] : [])
if (
  rooms.length < 1 ||
  rooms.length > 12 ||
  new Set(rooms.map((room) => room.sourceNumber)).size !== rooms.length ||
  rooms.some((room) => !['living', 'bedroom', 'kitchen', 'bath', 'kid'].includes(room.kind))
) {
  throw new Error('Fixture needs distinct numbered rooms with supported room kinds.')
}
const body = await readFile(pdfPath)
const sha256 = createHash('sha256').update(body).digest('hex')
if (fixture.source.state !== 'existing' || sha256 !== fixture.source.sha256) {
  throw new Error('The PDF does not match the reviewed existing-state fixture.')
}
const page = await preparePlanPage(body, true, fixture.source.pdfPage, true)
if (!page.linework || !page.image.planText) throw new Error('Native geometry or text is missing.')
const linework = page.linework
const textItems = JSON.parse(page.image.planText) as Array<{
  text: string
  x: number
  y: number
  rotation: number
}>
const sourceRooms = planPageRoomInventory(page.image.planText)
if (
  fixture.sourceRoomNumbers &&
  JSON.stringify(sourceRooms?.map((room) => room.sourceNumber)) !==
    JSON.stringify(fixture.sourceRoomNumbers)
) {
  throw new Error('The numbered source schedule no longer matches the reviewed fixture.')
}
const areaConflicts = (fixture.areaConflicts ?? []).map((conflict) => {
  const planText = textItems[conflict.planTextItemIndex]?.text ?? ''
  const legendText = textItems[conflict.legendTextItemIndex]?.text ?? ''
  const planMatch = /^\s*(\d{1,3},\d{1,2})\s*$/.exec(planText)
  const legendMatch = /^\s*0?(\d+)\s*-.+?-\s*(\d{1,3},\d{1,2})\s*м/i.exec(legendText)
  const parseArea = (value: string) => Number(value.replace(',', '.'))
  if (
    !planMatch?.[1] ||
    !legendMatch?.[1] ||
    !legendMatch[2] ||
    Number(legendMatch[1]) !== conflict.sourceNumber ||
    parseArea(planMatch[1]) !== conflict.planAreaM2 ||
    parseArea(legendMatch[2]) !== conflict.legendAreaM2 ||
    conflict.planAreaM2 === conflict.legendAreaM2
  ) {
    throw new Error(`Room ${conflict.sourceNumber}: area conflict evidence changed.`)
  }
  return {
    sourceNumber: conflict.sourceNumber,
    planAreaM2: conflict.planAreaM2,
    legendAreaM2: conflict.legendAreaM2,
  }
})
const { source } = fixture
for (const room of rooms) {
  const conflict = areaConflicts.find((item) => item.sourceNumber === room.sourceNumber)
  if (conflict && room.areaM2 !== undefined)
    throw new Error(
      `Room ${room.sourceNumber}: conflicting source areas must not be resolved by the fixture.`,
    )
  if (!conflict && room.areaM2 === undefined)
    throw new Error(
      `Room ${room.sourceNumber}: missing signed area without a documented source conflict.`,
    )
}
const contours = planPageContoursSchema.parse({
  source,
  coordinateSystem: 'page-0-1000',
  review: 'manual-source-review',
  pageWidth: page.linework.pageWidth,
  pageHeight: page.linework.pageHeight,
  ...(fixture.exterior ? { exterior: fixture.exterior } : {}),
  rooms: rooms.map((room) => ({
    roomSourceNumber: room.sourceNumber,
    polygon: room.polygon,
    ...(room.conditionalEdges ? { conditionalEdges: room.conditionalEdges } : {}),
    ...(room.openings ? { openings: room.openings } : {}),
  })),
})
const detectedAreaConflicts = planPageAreaConflicts({
  source,
  linework,
  contours,
  planText: page.image.planText,
})
// The source text can document a conflict outside the contours selected for this run.
// Product detection is expected only for a room whose contour was actually reviewed.
const reviewedNumbers = new Set(rooms.map((room) => room.sourceNumber))
if (
  JSON.stringify(detectedAreaConflicts) !==
  JSON.stringify(
    areaConflicts
      .filter(({ sourceNumber }) => reviewedNumbers.has(sourceNumber))
      .map(({ sourceNumber, planAreaM2, legendAreaM2 }) => ({
        sourceNumber,
        planAreaM2,
        scheduleAreaM2: legendAreaM2,
      })),
  )
) {
  throw new Error('Product area conflict check disagrees with the reviewed source evidence.')
}
const evidence = (
  kind: 'horizontal-chain' | 'vertical-chain',
  room: ReviewedRoom,
  chain: Chain,
) => ({
  kind,
  scope: 'room' as const,
  sourceNumber: room.sourceNumber,
  complete: true as const,
  ...chain,
})
const reading: PlanReading = {
  readAt: new Date().toISOString(),
  sourcePage: source.pdfPage,
  planState: 'existing',
  rooms: rooms.map((room) => ({
    sourceNumber: room.sourceNumber,
    name: room.name,
    kind: room.kind,
    ...(room.utility ? { utility: true } : {}),
    ...(room.areaM2 === undefined ? {} : { areaM2: room.areaM2 }),
    ...(room.widthMm === undefined ? {} : { widthCm: room.widthMm / 10 }),
    ...(room.depthMm === undefined ? {} : { depthCm: room.depthMm / 10 }),
    measurementEvidence: {
      ...(room.width ? { width: evidence('horizontal-chain', room, room.width) } : {}),
      ...(room.depth ? { depth: evidence('vertical-chain', room, room.depth) } : {}),
    },
  })),
}
const sourceIssue = planPageReviewIssue(contours, reading, source, page.linework)
if (sourceIssue) throw new Error(`Source contour review failed: ${sourceIssue}`)
const dimensionChecks = rooms.flatMap((room) =>
  (['width', 'depth'] as const).map((side) => {
    const chain = room[side]
    const value = side === 'width' ? room.widthMm : room.depthMm
    if (!chain || value === undefined) {
      if (chain || value !== undefined)
        throw new Error(`Room ${room.sourceNumber}: incomplete dimension evidence.`)
      return { sourceNumber: room.sourceNumber, side, status: 'not-supplied' }
    }
    const labels = chain.textItemIndexes.map((index) => {
      const label = textItems[index]
      if (!label) throw new Error(`Missing text item ${index}`)
      return { ...label, index }
    })
    const verify = side === 'width' ? pdfWidthChain : pdfDepthChain
    const checked = verify(linework, source, contours, room.sourceNumber, labels, value)
    const expectedIssue = fixture.expectedDimensionIssues?.find(
      (issue) => issue.sourceNumber === room.sourceNumber && issue.side === side,
    )
    if (checked.status !== 'candidate') {
      if (expectedIssue?.reason !== checked.reason)
        throw new Error(`Room ${room.sourceNumber}, ${side}: ${checked.reason}`)
      const roomReading = reading.rooms.find((item) => item.sourceNumber === room.sourceNumber)
      if (roomReading) {
        delete roomReading.measurementEvidence?.[side]
        if (side === 'width') delete roomReading.widthCm
        else delete roomReading.depthCm
      }
      return {
        sourceNumber: room.sourceNumber,
        side,
        status: checked.status,
        reason: checked.reason,
      }
    }
    if (expectedIssue)
      throw new Error(`Room ${room.sourceNumber}, ${side}: expected issue changed.`)
    return {
      sourceNumber: room.sourceNumber,
      side,
      status: checked.status,
      totalMm: checked.totalMm,
    }
  }),
)
const result = planPageMetricDraft(
  reading,
  {
    source,
    contours,
    linework: page.linework,
    planText: page.image.planText,
    ...(fixture.calibrationRoomNumbers
      ? { calibrationRoomNumbers: fixture.calibrationRoomNumbers }
      : {}),
  },
  rooms.map((room) => room.sourceNumber),
)
if (!result.ok) throw new Error(result.error)
const verifiedWidth = dimensionChecks.find(
  (check) => check.side === 'width' && check.status === 'candidate',
)
const widthRoom = rooms.find((room) => room.sourceNumber === verifiedWidth?.sourceNumber)
const widthChain = widthRoom?.width
const widthLabels = widthChain?.textItemIndexes.map((index) => {
  const label = textItems[index]
  if (!label) throw new Error(`Missing text item ${index}`)
  return { ...label, index }
})
const widthCandidate =
  widthRoom?.widthMm && widthLabels
    ? pdfWidthChain(
        linework,
        source,
        contours,
        widthRoom.sourceNumber,
        widthLabels,
        widthRoom.widthMm,
      )
    : null
const cmPerPoint =
  result.geometry.pdfCalibration?.cmPerPoint ??
  (widthCandidate?.status === 'candidate'
    ? widthCandidate.totalMm / 10 / pdfPointDistance(linework, ...widthCandidate.ends)
    : undefined)
if (!cmPerPoint || !Number.isFinite(cmPerPoint)) throw new Error('Missing verified PDF scale.')
const wallCoverage = classifyPlanPageWallSpans(
  contours,
  pairPlanPageWallFaces(linework, source, contours),
)
const wallReviewQueue = planPageWallReviewQueue(contours, wallCoverage, cmPerPoint)
const exteriorWallReviewQueue = planPageWallReviewQueue(
  contours,
  wallCoverage,
  cmPerPoint,
  'exterior',
)
const geometryIssues = inspectPlanGeometry(result.geometry)
if (geometryIssues.length > 0) throw new Error(`Geometry issues: ${JSON.stringify(geometryIssues)}`)
if (result.geometry.rooms.length !== rooms.length)
  throw new Error('Not every room was transferred.')
const expectedWalls =
  (fixture.exterior?.polygon.length ?? 0) +
  rooms.reduce(
    (count, room) => count + room.polygon.length - (room.conditionalEdges?.length ?? 0),
    0,
  )
if (result.geometry.walls.length !== expectedWalls)
  throw new Error('A conditional zone divider was transferred as a physical wall.')
const areaM2 = (polygon: NonNullable<(typeof result.geometry.rooms)[number]['polygon']>) =>
  Math.abs(
    polygon.reduce((sum, point, index) => {
      const next = polygon[(index + 1) % polygon.length]
      return next ? sum + point.xCm * next.yCm - next.xCm * point.yCm : sum
    }, 0),
  ) / 20_000
const verifiedRooms = result.geometry.rooms.map((geometryRoom) => {
  const reviewedRoom = rooms.find((room) => room.sourceNumber === geometryRoom.sourceNumber)
  const polygon = geometryRoom.polygon
  if (!reviewedRoom || !polygon) throw new Error('A reviewed room has no transferred contour.')
  const calculatedAreaM2 = areaM2(polygon)
  const signedArea = reviewedRoom.areaM2
  if (
    signedArea !== undefined &&
    Math.abs(calculatedAreaM2 - signedArea) > Math.max(0.1, signedArea * 0.02)
  ) {
    throw new Error(
      `Room ${reviewedRoom.sourceNumber}: contour ${calculatedAreaM2.toFixed(2)} m2 and signed ${signedArea.toFixed(2)} m2 disagree.`,
    )
  }
  return {
    sourceNumber: reviewedRoom.sourceNumber,
    acceptedWidthMm:
      reading.rooms.find((room) => room.sourceNumber === reviewedRoom.sourceNumber)?.widthCm ===
      undefined
        ? undefined
        : reviewedRoom.widthMm,
    acceptedDepthMm:
      reading.rooms.find((room) => room.sourceNumber === reviewedRoom.sourceNumber)?.depthCm ===
      undefined
        ? undefined
        : reviewedRoom.depthMm,
    signedAreaM2: reviewedRoom.areaM2,
    areaStatus: signedArea === undefined ? 'source-conflict' : 'within-tolerance',
    calculatedAreaM2: Math.round(calculatedAreaM2 * 100) / 100,
    polygon,
  }
})

let routeGeometry = result.geometry
const routeChecks = fixture.routeCheck?.widthsCm.map((widthCm, index) => {
  const check = fixture.routeCheck
  if (!check) throw new Error('Missing route check')
  const geometry = structuredClone(result.geometry)
  geometry.routeStartOpeningId = planPageGeometryElementId(
    source,
    String(check.startRoomNumber),
    'opening',
    check.startOpeningId,
  )
  geometry.routeWidthCm = widthCm
  const entry = geometry.openings.find((opening) => opening.id === geometry.routeStartOpeningId)
  if (!entry) throw new Error('The reviewed starting opening is missing.')
  // QA search setup only: the source PDF does not certify a door swing or this depth.
  entry.clearance = structuredClone(check.clearance)
  if (index === 0) routeGeometry = geometry
  const checked = inspectPdfClearanceRoutes(geometry)
  const reloaded = inspectPdfClearanceRoutes(JSON.parse(JSON.stringify(geometry)))
  if (JSON.stringify(checked) !== JSON.stringify(reloaded))
    throw new Error('The route result changed after geometry serialization.')
  return {
    widthCm,
    missing: checked.missing,
    status: checked.result?.status,
    checkedNodes: checked.result?.checkedNodes,
    reachedRooms: checked.result?.routes.map((route) => geometry.rooms[Number(route.roomId)]?.name),
    unresolvedRooms: checked.result?.unresolvedRoomIds.map(
      (id) => geometry.rooms[Number(id)]?.name,
    ),
    serialization: 'unchanged',
  }
})

if (geometryPath) {
  if (
    !geometryPath.endsWith('.json') ||
    [pdfPath, fixturePath].some((path) => resolve(path) === resolve(geometryPath))
  )
    throw new Error('Geometry output must be a separate JSON, never the reviewed source.')
  await mkdir(dirname(resolve(geometryPath)), { recursive: true })
  await writeFile(
    geometryPath,
    JSON.stringify(
      {
        source,
        reading: {
          ...reading,
          pageReview: {
            version: 1,
            savedAt: new Date().toISOString(),
            contours,
            sourceRooms,
          },
        },
        geometry: routeGeometry,
      },
      null,
      2,
    ),
  )
}

if (overlayPath) {
  if (!overlayPath.endsWith('.png'))
    throw new Error('Overlay output must be a PNG, never the source PDF.')
  const metadata = await sharp(page.image.body).metadata()
  const shapes = rooms
    .map((room) => {
      const points = room.polygon.map((point) => `${point.x},${point.y}`).join(' ')
      const conditional =
        room.conditionalEdges
          ?.map((edge) => {
            const start = room.polygon[edge.wallEdgeIndex]
            const end = room.polygon[(edge.wallEdgeIndex + 1) % room.polygon.length]
            if (!start || !end) throw new Error('Missing conditional edge endpoints')
            return `<line x1="${start.x}" y1="${start.y}" x2="${end.x}" y2="${end.y}" stroke="#da2657" stroke-width="3" stroke-dasharray="6 4"/>`
          })
          .join('') ?? ''
      const color = room.areaM2 === undefined ? '#bf7500' : '#008080'
      return `<polygon points="${points}" fill="${color}" fill-opacity="0.12" stroke="${color}" stroke-width="1.5"/>${conditional}`
    })
    .join('')
  const exteriorPoints = fixture.exterior?.polygon.map((point) => `${point.x},${point.y}`).join(' ')
  const exterior = exteriorPoints
    ? `<polygon points="${exteriorPoints}" fill="none" stroke="#3546ac" stroke-width="2"/>`
    : ''
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${metadata.width}" height="${metadata.height}" viewBox="0 0 1000 1000" preserveAspectRatio="none">${shapes}${exterior}</svg>`
  await mkdir(dirname(resolve(overlayPath)), { recursive: true })
  await sharp(page.image.body)
    .composite([{ input: Buffer.from(svg) }])
    .png()
    .toFile(overlayPath)
}

if (layoutPdfPath) {
  if (!layoutPdfPath.endsWith('.pdf') || resolve(layoutPdfPath) === resolve(pdfPath)) {
    throw new Error('The QA layout PDF must be a separate output file.')
  }
  if (rooms.length !== 1) {
    throw new Error('The partial-source PDF check requires exactly one reviewed room.')
  }
  const room = rooms[0]
  if (
    room?.kind !== 'bedroom' ||
    room.widthMm === undefined ||
    room.depthMm === undefined ||
    dimensionChecks.some((check) => check.status !== 'candidate')
  ) {
    throw new Error('The PDF check requires a bedroom with two source-verified dimensions.')
  }
  const layout = layoutWithMeasurements(
    room.name,
    { widthCm: room.widthMm / 10, depthCm: room.depthMm / 10 },
    result.geometry,
    [
      {
        id: 'qa-bed',
        title: 'Тестовая кровать 140 × 200 см',
        category: 'bed',
        quantity: 1,
        dimensions: { width: 140, depth: 200 },
      },
    ],
    'bedroom',
  )
  if (layout?.safetySummary.status !== 'needs-data') {
    throw new Error('A partial apartment must produce a needs-data layout preview.')
  }
  const rates = { roughRubPerM2: 15_000, finishRubPerM2: 5_000 }
  const data: PdfData = {
    kind: 'free',
    generatedAt: new Date(),
    project: {
      title: 'Проверка мерок фрагмента плана',
      subtitle: 'Не проект квартиры и не предложение мебели',
      facts: [{ label: 'Источник', value: `Существующее состояние, страница ${source.pdfPage}` }],
      contact: null,
      projectUrl: 'example.com/local-qa',
    },
    summary:
      'Размеры одной комнаты сверены с опубликованным обмерным планом. Внешний контур и остальные помещения не подтверждены. Смета и состояние отделки в этом тесте не определялись.',
    cover: null,
    band: null,
    rooms: [
      {
        id: 'source-room',
        name: room.name,
        areaM2: room.areaM2 ?? null,
        conditionLabel: 'Отделка не установлена по источнику',
        hasConcept: false,
        render: null,
        before: null,
        alternates: [],
        note: 'Кровать — только тестовый объект заданного размера, не товар из каталога.',
        objects: [],
        plan: layout,
      },
    ],
    roomsWithoutConcept: [room.name],
    shopping: [],
    estimate: estimateProject({
      rooms: [
        {
          id: 'source-room',
          name: room.name,
          areaM2: room.areaM2 ?? null,
          condition: 'keep',
          refreshFinish: false,
        },
      ],
      items: [],
      budgetKopecks: null,
      rates,
    }),
    rates,
    brief: null,
  }
  await mkdir(dirname(resolve(layoutPdfPath)), { recursive: true })
  await writeFile(
    layoutPdfPath,
    await printPdf(renderProjectHtml(data, { fontCss: fontFaceCss() }), data.project.title),
  )
}

console.log(
  JSON.stringify({
    sourcePage: source.pdfPage,
    sourceSha256: sha256,
    sourceRooms,
    missingRoomNumbers: fixture.sourceRoomNumbers?.filter(
      (number) => !rooms.some((room) => room.sourceNumber === number),
    ),
    unresolvedAreaRoomNumbers: rooms
      .filter((room) => room.areaM2 === undefined)
      .map((room) => room.sourceNumber),
    rooms: verifiedRooms,
    areaConflicts,
    dimensionChecks,
    wallBoundaryRecords: result.geometry.walls.length,
    conditionalEdges: rooms.reduce(
      (count, room) => count + (room.conditionalEdges?.length ?? 0),
      0,
    ),
    openings: result.geometry.openings.length,
    openingFacePairs: result.geometry.pdfCalibration?.openingFacePairs?.length ?? 0,
    wallFacePairs: result.geometry.pdfCalibration?.wallFacePairs?.length ?? 0,
    wallCoverage,
    wallReviewQueue,
    exteriorWallReviewQueue,
    wallSolids: inspectPlanPageWallSolids(linework, source, contours),
    openingFaceChecks: verifyPlanPageOpeningFaces(linework, source, contours),
    warnings: result.geometry.warnings,
    geometryIssues: geometryIssues.length,
    confirmationIssues: inspectManualPlanCompleteness(result.geometry),
    routeChecks,
    paidCalls: 0,
  }),
)
