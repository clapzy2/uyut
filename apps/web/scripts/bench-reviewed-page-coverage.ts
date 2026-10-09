// Same-source, fresh PDF extraction; no synthetic clearing of omitted native geometry.
// bun --no-env-file run apps/web/scripts/bench-reviewed-page-coverage.ts PDF_PATH FRESH_DIR
import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { join, resolve } from 'node:path'
import type { PlanPageContours, PlanReading } from '@uyut/db'
import page from '../../../docs/qa/fixtures/apartment-74-77-complete-page.json'
import { preparePlanPage } from '../lib/projects/plan-document'
import { planPageContoursSchema } from '../lib/projects/plan-page-review'
import { inspectReviewedPageCoverage } from '../lib/projects/plan-page-reviewed-coverage'

const [pdfPath, outputPath] = process.argv.slice(2)
if (!pdfPath || !outputPath)
  throw new Error('Supply the original source PDF and a fresh output directory')
const body = await readFile(resolve(pdfPath))
assert.equal(createHash('sha256').update(body).digest('hex'), page.source.sha256)
const source = {
  sha256: page.source.sha256,
  pdfPage: page.source.pdfPage,
  state: 'existing' as const,
}
const contours = planPageContoursSchema.parse({
  source,
  coordinateSystem: 'page-0-1000',
  review: 'manual-source-review',
  pageWidth: page.pageWidth,
  pageHeight: page.pageHeight,
  exterior: {
    polygon: structuredClone(page.apartmentEnvelope.polygon),
    boundaryRole: 'outer-wall-envelope',
  },
  rooms: page.rooms.map((room) => ({
    ...(room.roomSourceNumbers
      ? { roomSourceNumbers: [...room.roomSourceNumbers] }
      : { roomSourceNumber: room.roomSourceNumber }),
    polygon: structuredClone(room.polygon),
    openings: room.openings.map((opening) => ({
      id: opening.id,
      kind: opening.kind,
      wallEdgeIndex: opening.wallEdgeIndex,
      start: { ...opening.start },
      end: { ...opening.end },
      ...('endpointProofs' in opening
        ? { endpointProofs: structuredClone(opening.endpointProofs) }
        : {}),
    })),
  })),
}) as PlanPageContours
// Only identities are needed here, not fabricated heights, metric dimensions or room kinds.
// 'living' is a schema placeholder and is never used by this source-space inspector.
const reading: PlanReading = {
  readAt: new Date().toISOString(),
  sourcePage: source.pdfPage,
  planState: 'existing',
  rooms: Array.from({ length: 8 }, (_, index) => ({
    sourceNumber: index + 1,
    name: `Источник ${index + 1}`,
    kind: 'living',
  })),
}
const prepared = await preparePlanPage(body, true, source.pdfPage, true, true)
if (!prepared.linework) throw new Error('Fresh native layer unavailable')
assert.equal(prepared.pageNumber, source.pdfPage)
const input = { source, reading, contours, linework: prepared.linework }
const original = structuredClone(input)
const report = inspectReviewedPageCoverage(input)
assert.deepEqual(input, original)
assert.deepEqual(report.readiness, { readOnly: true, readyFor2D: false, readyFor3D: false })
assert.equal(report.status, 'partial', report.refusalReason)
assert.equal(report.extractionComplete, false)
assert.equal(report.floorBoundary, 'envelope-only')
assert.ok(report.issues.includes('native-extraction-incomplete'))
assert.ok(report.issues.includes('complete-opening-inventory-unverified'))
const output = resolve(outputPath)
await mkdir(output, { recursive: false })
await writeFile(join(output, 'source-page.jpg'), prepared.image.body)
await writeFile(join(output, 'coverage.json'), JSON.stringify(report, null, 2))
const summary = {
  source,
  status: report.status,
  extractionComplete: report.extractionComplete,
  skippedCurves: prepared.linework.skippedCurves,
  clippedPaths: prepared.linework.clippedPaths,
  floorBoundary: report.floorBoundary,
  wallPairs: report.wallPairs,
  wallSource: report.wallSource,
  wallSpans: report.wallSpans,
  openings: report.openings,
  issues: report.issues,
  projectWrites: 0,
  paidRequests: 0,
}
await writeFile(join(output, 'summary.json'), JSON.stringify(summary, null, 2))
console.log(JSON.stringify(summary, null, 2))
