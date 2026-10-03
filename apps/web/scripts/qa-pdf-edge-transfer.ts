/** Local existing-state PDF control. No AI, downloads or project writes. */
import { createHash } from 'node:crypto'
import { existsSync } from 'node:fs'
import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { dirname } from 'node:path'
import { planMeasurementTextItems } from '@uyut/ai'
import type { PlanPageContours, PlanReading } from '@uyut/db'
import sharp from 'sharp'
import { preparePlanPage } from '../lib/projects/plan-document'
import {
  inspectManualPlanCompleteness,
  inspectPlanGeometry,
} from '../lib/projects/plan-geometry-inspection'
import {
  planPageGeometryElementId,
  planPageMetricDraft,
} from '../lib/projects/plan-page-metric-draft'
import { planPageContoursSchema, planPageReviewIssue } from '../lib/projects/plan-page-review'
import { planPageRoomInventory } from '../lib/projects/plan-page-room-inventory'
import { pdfDimensionForEdge } from '../lib/projects/plan-pdf-edge-dimension'

type ReviewedRoom = {
  sourceNumber: number
  name: string
  kind: PlanReading['rooms'][number]['kind']
  polygon: PlanPageContours['rooms'][number]['polygon']
  conditionalEdges?: PlanPageContours['rooms'][number]['conditionalEdges']
  openings?: PlanPageContours['rooms'][number]['openings']
  width?: { textItemIndexes: number[] }
  depth?: { textItemIndexes: number[] }
}
type Fixture = {
  source: PlanPageContours['source']
  room?: ReviewedRoom
  rooms?: ReviewedRoom[]
  exterior?: PlanPageContours['exterior']
}
type Control = {
  source: PlanPageContours['source']
  anchors: Array<{
    roomSourceNumber: number
    wallEdgeIndex: number
    labelIndexes: number[]
    totalMm: number
    wallOperation: number
    lineOperations: number[]
    endpointOperations: number[]
  }>
  expectedRooms: number[]
  expectedOpenings: number
  expectedCompletenessIssues: string[]
  expectedMissingRooms: number[]
}

const [pdfPath, fixturePath, controlPath, outputPath, overlayPath] = process.argv.slice(2)
if (!pdfPath || !fixturePath)
  throw new Error(
    'Usage: bun scripts/qa-pdf-edge-transfer.ts <source.pdf> <reviewed-fixture.json> [control.json] [report.json] [overlay.png]',
  )
const body = await readFile(pdfPath)
const fixture = JSON.parse(await readFile(fixturePath, 'utf8')) as Fixture
if (createHash('sha256').update(body).digest('hex') !== fixture.source.sha256)
  throw new Error('Source hash differs from the independently reviewed fixture')
if (fixture.source.state !== 'existing') throw new Error('Existing-state source required')
const rooms = fixture.rooms ?? (fixture.room ? [fixture.room] : [])
if (!rooms.length) throw new Error('No reviewed room contours')
const page = await preparePlanPage(body, true, fixture.source.pdfPage, true)
if (!page.linework || page.pageNumber !== fixture.source.pdfPage)
  throw new Error('No native evidence for the reviewed page')
const work = page.linework
const labels = planMeasurementTextItems(page.image.planText)
if (!labels) throw new Error('No native text')
const contours: PlanPageContours = planPageContoursSchema.parse({
  source: fixture.source,
  coordinateSystem: 'page-0-1000',
  review: 'manual-source-review',
  pageWidth: work.pageWidth,
  pageHeight: work.pageHeight,
  ...(fixture.exterior ? { exterior: fixture.exterior } : {}),
  rooms: rooms.map((room) => ({
    roomSourceNumber: room.sourceNumber,
    polygon: room.polygon,
    ...(room.conditionalEdges ? { conditionalEdges: room.conditionalEdges } : {}),
    ...(room.openings ? { openings: room.openings } : {}),
  })),
})
const control = controlPath
  ? (JSON.parse(await readFile(controlPath, 'utf8')) as Control)
  : undefined
if (control && JSON.stringify(control.source) !== JSON.stringify(fixture.source))
  throw new Error('Control source differs from the reviewed fixture')
const bindings = []
for (const room of rooms) {
  for (const side of ['width', 'depth'] as const) {
    const labelIndexes = room[side]?.textItemIndexes
    if (!labelIndexes?.length) continue
    const selected = labelIndexes.flatMap((index) => {
      const label = labels[index]
      return label && label.x !== undefined && label.y !== undefined
        ? [{ ...label, index, x: label.x, y: label.y }]
        : []
    })
    for (let wallEdgeIndex = 0; wallEdgeIndex < room.polygon.length; wallEdgeIndex++) {
      const result = pdfDimensionForEdge(
        work,
        fixture.source,
        contours,
        { roomSourceNumber: room.sourceNumber },
        { wallEdgeIndex, labelIndexes },
        selected,
      )
      bindings.push({ room: room.sourceNumber, side, wallEdgeIndex, labelIndexes, result })
      if (result.status === 'candidate' && !control) {
        const contour = contours.rooms.find((item) => item.roomSourceNumber === room.sourceNumber)
        if (!contour) throw new Error('Missing reviewed contour')
        contour.dimensionEdges ??= []
        contour.dimensionEdges.push({ wallEdgeIndex, labelIndexes })
      }
    }
  }
}
for (const anchor of control?.anchors ?? []) {
  const room = contours.rooms.find((item) => item.roomSourceNumber === anchor.roomSourceNumber)
  if (!room) throw new Error('Control room is absent from the reviewed source')
  const selected = anchor.labelIndexes.flatMap((index) => {
    const label = labels[index]
    return label && label.x !== undefined && label.y !== undefined
      ? [{ ...label, index, x: label.x, y: label.y }]
      : []
  })
  const result = pdfDimensionForEdge(work, fixture.source, contours, anchor, anchor, selected)
  if (
    result.status !== 'candidate' ||
    result.totalMm !== anchor.totalMm ||
    result.wallRef.operationIndex !== anchor.wallOperation ||
    JSON.stringify(result.lineOperations) !== JSON.stringify(anchor.lineOperations) ||
    JSON.stringify(result.endpointRefs.map((ref) => ref.operationIndex)) !==
      JSON.stringify(anchor.endpointOperations)
  )
    throw new Error(
      `Room ${anchor.roomSourceNumber}, edge ${anchor.wallEdgeIndex}: source anchor proof changed`,
    )
  room.dimensionEdges ??= []
  room.dimensionEdges.push({
    wallEdgeIndex: anchor.wallEdgeIndex,
    labelIndexes: anchor.labelIndexes,
  })
}
const reading: PlanReading = {
  sourcePage: fixture.source.pdfPage,
  planState: 'existing',
  readAt: '2026-10-03',
  rooms: rooms.map(({ sourceNumber, name, kind }) => ({ sourceNumber, name, kind })),
}
const reviewIssue = planPageReviewIssue(contours, reading, fixture.source, work)
if (reviewIssue) throw new Error(`Source page review would refuse this input: ${reviewIssue}`)
const savedContours: PlanPageContours = planPageContoursSchema.parse(
  JSON.parse(JSON.stringify(contours)),
)
const sourceRooms = planPageRoomInventory(page.image.planText)
const missingRooms =
  sourceRooms
    ?.filter((item) => !rooms.some((room) => room.sourceNumber === item.sourceNumber))
    .map((room) => room.sourceNumber) ?? []
const context = {
  source: fixture.source,
  linework: work,
  contours: savedContours,
  planText: page.image.planText,
  useEdgeDimensions: true,
}
const selectedNumbers = rooms.map((room) => room.sourceNumber)
const draft = planPageMetricDraft(reading, context, selectedNumbers)
const negativeChecks = []
if (control) {
  if (!draft.ok) throw new Error(`Reviewed transfer failed: ${draft.error}`)
  const geometry = draft.geometry
  if (JSON.stringify(missingRooms) !== JSON.stringify(control.expectedMissingRooms))
    throw new Error('Missing source rooms changed')
  const calibration = geometry.pdfCalibration
  if (!calibration) throw new Error('No saved calibration proof')
  if (
    JSON.stringify(
      geometry.rooms.map((room) => room.sourceNumber).sort((a, b) => Number(a) - Number(b)),
    ) !== JSON.stringify([...control.expectedRooms].sort((a, b) => a - b)) ||
    geometry.openings.length !== control.expectedOpenings ||
    geometry.status !== 'draft' ||
    geometry.confirmedAt !== undefined
  )
    throw new Error('Room inventory, opening count or draft status changed')
  // Independent coordinate formula: inspect every vertex, not just a bounding rectangle.
  for (const room of savedContours.rooms) {
    const metric = geometry.rooms.find((item) => item.sourceNumber === room.roomSourceNumber)
    if (!metric || metric.polygon.length !== room.polygon.length)
      throw new Error('Room contour lost a vertex')
    room.polygon.forEach((point, index) => {
      const converted = metric.polygon[index]
      const x = ((point.x - calibration.origin.x) / 1000) * work.pageWidth * calibration.cmPerPoint
      const y = ((point.y - calibration.origin.y) / 1000) * work.pageHeight * calibration.cmPerPoint
      if (
        !converted ||
        Math.abs(converted.xCm - x) > 0.0500001 ||
        Math.abs(converted.yCm - y) > 0.0500001
      )
        throw new Error(
          `Room ${room.roomSourceNumber}: source coordinate changed beyond cm rounding`,
        )
    })
    for (const opening of room.openings ?? []) {
      const id = planPageGeometryElementId(
        fixture.source,
        String(room.roomSourceNumber),
        'opening',
        opening.id,
      )
      const metricOpening = geometry.openings.find((item) => item.id === id)
      const wallStart = room.polygon[opening.wallEdgeIndex]
      if (!wallStart) throw new Error('Source opening has no wall start')
      const distanceCm = (a: { x: number; y: number }, b: { x: number; y: number }) =>
        Math.hypot(((b.x - a.x) / 1000) * work.pageWidth, ((b.y - a.y) / 1000) * work.pageHeight) *
        calibration.cmPerPoint
      const offsetCm = Math.min(
        distanceCm(wallStart, opening.start),
        distanceCm(wallStart, opening.end),
      )
      const widthCm = distanceCm(opening.start, opening.end)
      if (
        !metricOpening ||
        metricOpening.type !== opening.kind ||
        metricOpening.wallId !==
          planPageGeometryElementId(
            fixture.source,
            String(room.roomSourceNumber),
            'wall',
            opening.wallEdgeIndex,
          ) ||
        Math.abs(metricOpening.offsetCm - offsetCm) > 0.0500001 ||
        Math.abs(metricOpening.widthCm - widthCm) > 0.0500001 ||
        metricOpening.heightCm !== undefined ||
        metricOpening.sillHeightCm !== undefined
      )
        throw new Error('An opening changed its wall, position, width or unknown vertical size')
    }
  }
  const completeness = inspectManualPlanCompleteness(geometry)
    .map((issue) => issue.id)
    .sort()
  if (
    JSON.stringify(completeness) !== JSON.stringify([...control.expectedCompletenessIssues].sort())
  )
    throw new Error('Expected confirmation blockers changed')
  if (JSON.stringify(JSON.parse(JSON.stringify(geometry))) !== JSON.stringify(geometry))
    throw new Error('Geometry proof changed during JSON round trip')
  const original = JSON.stringify({ reading, context })
  const changedLabels = labels.map((label, index) =>
    index === control.anchors[1]?.labelIndexes[0]
      ? { ...label, text: String((control.anchors[1]?.totalMm ?? 0) + 100) }
      : label,
  )
  const missingWall = {
    ...work,
    paths: work.paths.filter((path) => path.operationIndex !== control.anchors[0]?.wallOperation),
  }
  for (const [name, changed] of [
    ['scale-conflict', { ...context, planText: JSON.stringify(changedLabels) }],
    ['missing-wall', { ...context, linework: missingWall }],
  ] as const) {
    const result = planPageMetricDraft(reading, changed, selectedNumbers)
    if (result.ok) throw new Error(`Negative source control unexpectedly accepted: ${name}`)
    negativeChecks.push({ name, error: result.error })
  }
  if (JSON.stringify({ reading, context }) !== original)
    throw new Error('Negative controls mutated the source')
}
const report = {
  source: fixture.source,
  diagnostics: {
    paths: work.paths.length,
    clippedPaths: work.clippedPaths,
    skippedCurves: work.skippedCurves,
    truncated: work.truncated,
    unsupportedPaths: work.unsupportedPaths,
    unsupportedContexts: work.unsupportedContexts,
  },
  bindings,
  savedContours,
  draft,
  sourceRooms,
  missingRooms,
  negativeChecks,
  inspection: draft.ok ? inspectPlanGeometry(draft.geometry) : undefined,
  completeness: draft.ok ? inspectManualPlanCompleteness(draft.geometry) : undefined,
}
if (overlayPath) {
  const metadata = await sharp(page.image.body).metadata()
  const width = metadata.width
  const height = metadata.height
  if (!width || !height) throw new Error('No rendered page size')
  const point = (p: { x: number; y: number }) => `${(p.x * width) / 1000},${(p.y * height) / 1000}`
  const lines = savedContours.rooms.flatMap((room) =>
    room.polygon.map((start, index) => {
      const end = room.polygon[(index + 1) % room.polygon.length]
      if (!end) return ''
      const conditional = room.conditionalEdges?.some((edge) => edge.wallEdgeIndex === index)
      return `<polyline points="${point(start)} ${point(end)}" fill="none" stroke="#15803d" stroke-width="2" ${conditional ? 'stroke-dasharray="8 6"' : ''}/>`
    }),
  )
  const highlights = (control?.anchors ?? []).map((anchor) => {
    const room = savedContours.rooms.find(
      (item) => item.roomSourceNumber === anchor.roomSourceNumber,
    )
    const a = room?.polygon[anchor.wallEdgeIndex]
    const b = room?.polygon[(anchor.wallEdgeIndex + 1) % (room?.polygon.length ?? 1)]
    return a && b
      ? `<polyline points="${point(a)} ${point(b)}" fill="none" stroke="#2563eb" stroke-width="6"/>`
      : ''
  })
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}">${lines.join('')}${highlights.join('')}</svg>`
  if (!existsSync(dirname(overlayPath))) await mkdir(dirname(overlayPath), { recursive: true })
  await sharp(page.image.body)
    .composite([{ input: Buffer.from(svg) }])
    .png()
    .toFile(overlayPath)
}
if (outputPath) {
  if (!existsSync(dirname(outputPath))) await mkdir(dirname(outputPath), { recursive: true })
  await writeFile(outputPath, JSON.stringify(report, null, 2))
  console.log(
    JSON.stringify(
      {
        source: report.source,
        diagnostics: report.diagnostics,
        candidates: bindings.filter((item) => item.result.status === 'candidate').length,
        chosenAnchors: control?.anchors.length,
        draftOk: draft.ok,
        rooms: draft.ok ? draft.geometry.rooms.length : 0,
        openings: draft.ok ? draft.geometry.openings.length : 0,
        checkedVertices: contours.rooms.reduce((sum, room) => sum + room.polygon.length, 0),
        missingRooms,
        negativeChecks,
        inspection: report.inspection,
        completeness: report.completeness,
        outputPath,
      },
      null,
      2,
    ),
  )
} else console.log(JSON.stringify(report, null, 2))
