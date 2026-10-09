// Real source replay, no provider calls, project writes, or metric contours supplied by the golden.
// bun --no-env-file run scripts/bench-basis-native-chain-gate.ts PDF BASELINE_DIR RETEST_DIR FRESH_DIR
import { createHash } from 'node:crypto'
import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { basename, join, resolve } from 'node:path'
import { parseFloorPlan, planMeasurementTextItems } from '@uyut/ai'
import reference from '../../../docs/qa/fixtures/basis-existing-reader-reference.json'
import { preparePlanPage } from '../lib/projects/plan-document'
import {
  nativeDimensionMillimetres,
  pdfNativePageDimensionChain,
} from '../lib/projects/plan-pdf-dimension-chain'
import { verifyPlanReadingNativeChains } from '../lib/projects/plan-reading-native-chains'
import { evaluateBasisReader } from './basis-reader-evaluation'

const [pdfPath, baselinePath, retestPath, outputPath, ...extra] = process.argv.slice(2)
if (!pdfPath || !baselinePath || !retestPath || !outputPath || extra.length)
  throw new Error('Supply source PDF, two archived batches and fresh output directory')
const body = await readFile(resolve(pdfPath))
const sha256 = (value: string | Buffer) => createHash('sha256').update(value).digest('hex')
if (sha256(body) !== reference.source.sha256) throw new Error('Wrong source PDF')
const page = await preparePlanPage(body, true, reference.source.pdfPage, true)
const work = page.linework
const items = planMeasurementTextItems(page.image.planText)
if (!work || !items) throw new Error('Missing fresh native layers')
const source = {
  sha256: reference.source.sha256,
  pdfPage: page.pageNumber,
  state: 'existing' as const,
}
const runs = []
for (const batchPath of [baselinePath, retestPath]) {
  const batch = resolve(batchPath)
  const manifest = JSON.parse(await readFile(join(batch, 'manifest.json'), 'utf8'))
  const archivedText = await readFile(join(batch, 'native-text.json'), 'utf8')
  if (
    manifest.sourceSha256 !== source.sha256 ||
    manifest.page !== source.pdfPage ||
    manifest.imageSha256 !== sha256(page.image.body) ||
    archivedText !== page.image.planText
  )
    throw new Error('Source/image/text frame differs from archived answers')
  for (const run of [1, 2]) {
    const rawBody = await readFile(join(batch, `native-text-${run}-raw.json`), 'utf8')
    const raw = JSON.parse(rawBody)
    if (raw.partial || raw.error || !raw.output) throw new Error('Incomplete archived response')
    const before = parseFloorPlan(raw.output, {
      requireMeasurementEvidence: true,
      planText: page.image.planText,
    })
    const started = performance.now()
    const after = verifyPlanReadingNativeChains(
      { ...before, sourcePage: page.pageNumber },
      { source, linework: work, planText: page.image.planText },
    )
    runs.push({
      batch: basename(batch),
      run,
      rawSha256: sha256(rawBody),
      elapsedMs: performance.now() - started,
      before: evaluateBasisReader(before),
      after: evaluateBasisReader(after),
      geometryHeld: after.geometry === undefined,
      rooms: after.rooms.map((room) => ({
        sourceNumber: room.sourceNumber,
        widthCm: room.widthCm,
        depthCm: room.depthCm,
        warnings: room.measurementWarnings,
      })),
    })
  }
}
// Manually selected native label controls are separate from the real model answers, not room assignments.
const controls = [
  { id: 'printed-overall-width', axis: 'width' as const, indexes: [45] },
  { id: 'composite-overall-width', axis: 'width' as const, indexes: [23, 24, 25, 26] },
  { id: 'main-depth-left', axis: 'depth' as const, indexes: [28, 27] },
  { id: 'wrong-main-plus-balcony', axis: 'depth' as const, indexes: [29, 28, 27] },
  { id: 'wrong-nested-sum', axis: 'depth' as const, indexes: [39, 44, 47] },
  { id: 'local-span-not-room-owner', axis: 'depth' as const, indexes: [37] },
  { id: 'small-offset-label-wrong-rail-caveat', axis: 'width' as const, indexes: [25] },
].map((control) => {
  const labels = control.indexes.map((index) => {
    const item = items[index]
    if (!item || item.x === undefined || item.y === undefined)
      throw new Error('Missing native label')
    return { ...item, index, x: item.x, y: item.y }
  })
  const totalMm = labels.reduce(
    (sum, label) => sum + (nativeDimensionMillimetres(label.text) ?? 0),
    0,
  )
  return {
    ...control,
    totalMm,
    result: pdfNativePageDimensionChain(work, source, labels, totalMm, control.axis),
    roomOwnershipVerified: false,
  }
})
const output = resolve(outputPath)
await mkdir(output, { recursive: false })
await writeFile(join(output, 'input.jpg'), page.image.body)
await writeFile(join(output, 'linework.json'), JSON.stringify(work, null, 2))
await writeFile(
  join(output, 'report.json'),
  JSON.stringify(
    {
      source,
      imageSha256: sha256(page.image.body),
      nativeTextSha256: sha256(page.image.planText ?? ''),
      runs,
      controls,
      providerCalls: 0,
      projectWrites: 0,
      metric2DAccepted: false,
      metric3DAccepted: false,
    },
    null,
    2,
  ),
)
console.log(
  JSON.stringify(
    {
      runs: runs.map((run) => ({
        batch: run.batch,
        run: run.run,
        elapsedMs: run.elapsedMs,
        geometryHeld: run.geometryHeld,
        rooms: run.rooms.map(({ warnings, ...room }) => room),
      })),
      controls: controls.map(({ id, result }) => ({ id, result })),
      providerCalls: 0,
      projectWrites: 0,
    },
    null,
    2,
  ),
)
