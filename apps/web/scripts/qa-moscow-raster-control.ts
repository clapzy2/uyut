/** Read-only source control: an embedded plan image must not become native geometry. */
import { createHash } from 'node:crypto'
import { readFile } from 'node:fs/promises'
import { isDeepStrictEqual } from 'node:util'
import type { PlanPageContours, PlanReading } from '@uyut/db'
import fixture from '../../../docs/qa/fixtures/moscow-page14-raster-native.json'
import { preparePlanPage } from '../lib/projects/plan-document'
import { planPageMetricDraft } from '../lib/projects/plan-page-metric-draft'
import { planPageReviewIssue } from '../lib/projects/plan-page-review'

const [pdfPath] = process.argv.slice(2)
if (!pdfPath) throw new Error('Usage: bun run scripts/qa-moscow-raster-control.ts <PDF>')
const body = await readFile(pdfPath)
const sha256 = createHash('sha256').update(body).digest('hex')
if (sha256 !== fixture.source.sha256) throw new Error('The reviewed source PDF changed.')
const source = { ...fixture.source, state: 'existing' as const }
const page = await preparePlanPage(body, true, source.pdfPage, true)
const linework = page.linework
if (!linework || !page.image.planText) throw new Error('Missing page evidence.')
const text = JSON.parse(page.image.planText) as Array<{ text: string }>
// The archived negative control predates colour extraction; only compare its saved fields.
const nativePaths = linework.paths.map(
  ({ fillColor: _fill, strokeColor: _stroke, ...path }) => path,
)
if (
  !isDeepStrictEqual({ ...linework, paths: nativePaths }, fixture.linework) ||
  text.length !== fixture.text.length ||
  fixture.text.some((saved) => {
    const current = text[saved.index] as typeof saved | undefined
    return (
      !current ||
      current.x !== saved.x ||
      current.y !== saved.y ||
      current.rotation !== saved.rotation ||
      (saved.text !== '[redacted]' && current.text !== saved.text)
    )
  })
)
  throw new Error('The native layer no longer matches the reviewed raster control.')

const [width, , , height, x, y] = fixture.raster.transform
if (width === undefined || height === undefined || x === undefined || y === undefined)
  throw new Error('Missing source image placement.')
const left = (x / linework.pageWidth) * 1000
const right = ((x + width) / linework.pageWidth) * 1000
const top = ((linework.pageHeight - y - height) / linework.pageHeight) * 1000
const bottom = ((linework.pageHeight - y) / linework.pageHeight) * 1000
// Deliberately invalid candidate, not a traced room or a source room identity.
const contours: PlanPageContours = {
  source,
  coordinateSystem: 'page-0-1000',
  review: 'manual-source-review',
  pageWidth: linework.pageWidth,
  pageHeight: linework.pageHeight,
  rooms: [
    {
      roomSourceNumber: 1,
      polygon: [
        { x: left, y: top },
        { x: right, y: top },
        { x: right, y: bottom },
        { x: left, y: bottom },
      ],
    },
  ],
}
const reading: PlanReading = {
  readAt: new Date().toISOString(),
  sourcePage: source.pdfPage,
  planState: 'existing',
  rooms: [{ sourceNumber: 1, name: 'Тест границы изображения', kind: 'living' }],
}
const issue = planPageReviewIssue(contours, reading, source, linework)
const result = planPageMetricDraft(
  reading,
  { source, contours, linework, planText: page.image.planText },
  [1],
)
if (issue !== 'non-native-contour-vertex' || result.ok)
  throw new Error('The raster image boundary was incorrectly accepted as a native room.')
console.log(
  JSON.stringify({
    sourceSha256: sha256,
    sourcePage: source.pdfPage,
    pageCount: page.pageCount,
    nativePaths: linework.paths.length,
    textItems: text.length,
    sourceIssue: issue,
    metricDraft: 'rejected',
    route: 'not-created',
  }),
)
