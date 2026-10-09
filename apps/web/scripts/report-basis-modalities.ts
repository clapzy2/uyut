// Offline scoring of saved paid answers. Never calls a model or writes a project.
// bun --no-env-file run scripts/report-basis-modalities.ts BASELINE_DIR RETEST_DIR [--reparse]
import { createHash } from 'node:crypto'
import { readFile, writeFile } from 'node:fs/promises'
import { basename, join, resolve } from 'node:path'
import { type PlanReading, parseFloorPlan, reconcileRasterReadings } from '@uyut/ai'
import reference from '../../../docs/qa/fixtures/basis-existing-reader-reference.json'
import { compareBasisReadings, evaluateBasisReader } from './basis-reader-evaluation'

const [baselineDirectory, retestDirectory, flag, ...extra] = process.argv.slice(2)
if (!baselineDirectory || !retestDirectory || (flag && flag !== '--reparse') || extra.length)
  throw new Error('Supply baseline and retest directories, optionally --reparse')
const directories = [baselineDirectory, retestDirectory]
const reparse = flag === '--reparse'

const sha256 = (body: string | Buffer) => createHash('sha256').update(body).digest('hex')
const reports = []
for (const directory of directories) {
  const output = resolve(directory)
  const manifest = JSON.parse(await readFile(join(output, 'manifest.json'), 'utf8'))
  const image = await readFile(join(output, 'input.jpg'))
  if (
    manifest.sourceSha256 !== reference.source.sha256 ||
    manifest.page !== reference.source.pdfPage ||
    manifest.imageSha256 !== sha256(image) ||
    manifest.projectWrites !== 0 ||
    !manifest.identicalImageBytesAcrossModes
  ) {
    throw new Error(`Unexpected source/frame/mutation manifest: ${basename(output)}`)
  }
  const modes = []
  for (const mode of ['native-text', 'image-only'] as const) {
    const planText =
      mode === 'native-text' ? await readFile(join(output, 'native-text.json'), 'utf8') : undefined
    const readings: PlanReading[] = []
    const runs = []
    for (let run = 1; run <= 2; run++) {
      const parsedBody = await readFile(join(output, `${mode}-${run}-parsed.json`), 'utf8')
      const rawBody = await readFile(join(output, `${mode}-${run}-raw.json`), 'utf8')
      const reading: PlanReading = reparse
        ? parseFloorPlan(JSON.parse(rawBody).output, { requireMeasurementEvidence: true, planText })
        : JSON.parse(parsedBody)
      readings.push(reading)
      runs.push({
        run,
        rawSha256: sha256(rawBody),
        parsedSha256: sha256(parsedBody),
        ...(reparse ? { replayedSha256: sha256(JSON.stringify(reading)) } : {}),
        rawMetadata: rawMetadata(rawBody),
        evaluation: evaluateBasisReader(reading),
        geometry: geometrySummary(reading),
      })
    }
    const first = readings[0]
    const second = readings[1]
    if (!first || !second) throw new Error('Expected two saved readings')
    const applicationBody = await readFile(join(output, `${mode}-application.json`), 'utf8')
    const application: PlanReading = reparse
      ? mode === 'image-only'
        ? reconcileRasterReadings(first, second)
        : structuredClone(first)
      : JSON.parse(applicationBody)
    if (reparse && mode === 'native-text' && application.geometry)
      delete application.geometry.footprint
    modes.push({
      mode,
      runs,
      repeatability: compareBasisReadings(first, second),
      application: {
        sha256: sha256(applicationBody),
        ...(reparse ? { replayedSha256: sha256(JSON.stringify(application)) } : {}),
        evaluation: evaluateBasisReader(application),
        geometry: geometrySummary(application),
      },
    })
  }
  const report = {
    batch: basename(output),
    manifest,
    modes,
    parserReplayed: reparse,
    reportPaidCalls: 0,
    projectWrites: 0,
  }
  const reportFile = reparse ? 'evaluation-current-parser.json' : 'evaluation.json'
  await writeFile(join(output, reportFile), JSON.stringify(report, null, 2))
  reports.push(report)
}
const [baseline, retest] = reports
if (
  !baseline ||
  !retest ||
  baseline.manifest.imageSha256 !== retest.manifest.imageSha256 ||
  baseline.manifest.model !== retest.manifest.model ||
  baseline.manifest.width !== retest.manifest.width ||
  baseline.manifest.height !== retest.manifest.height
) {
  throw new Error('Baseline and retest do not use the same image/model/frame')
}
console.log(
  JSON.stringify(
    reports.map((report) => ({
      batch: report.batch,
      parserReplayed: report.parserReplayed,
      modes: report.modes.map((mode) => ({
        mode: mode.mode,
        inventoryPass: mode.runs.map((run) => run.evaluation.inventoryPass),
        roomAreaLabels: mode.runs.map(
          (run) => run.evaluation.rooms.filter((room) => room.areaLabelPass).length,
        ),
        mainWidthDeltasCm: mode.runs.map((run) => run.evaluation.mainEnvelope.widthDeltaCm),
        mainDepthDeltasCm: mode.runs.map((run) => run.evaluation.mainEnvelope.depthDeltaCm),
        ceilingPass: mode.runs.map((run) => run.evaluation.ceilingPass),
        conflictWithheld: mode.runs.map((run) => run.evaluation.totalArea.conflictWithheld),
        repeatability: mode.repeatability,
        applicationGeometry: mode.application.geometry,
      })),
    })),
    null,
    2,
  ),
)

function geometrySummary(reading: PlanReading) {
  const geometry = reading.geometry
  return geometry
    ? {
        walls: geometry.walls.length,
        openings: geometry.openings.length,
        rooms: geometry.rooms.length,
        widthCm: geometry.widthCm,
        heightCm: geometry.heightCm,
        footprint: !!geometry.footprint,
        status: geometry.status,
        warnings: geometry.warnings,
      }
    : null
}

function rawMetadata(body: string) {
  const response = JSON.parse(body)
  if (response.partial || response.error || typeof response.output !== 'string') {
    throw new Error('Incomplete saved provider response')
  }
  const output: string = response.output
  // Use the same outer JSON boundary as parseFloorPlan, but do not validate away model errors.
  const raw = JSON.parse(output.slice(output.indexOf('{'), output.lastIndexOf('}') + 1))
  return {
    planState: raw.planState,
    totalAreaM2: raw.totalAreaM2,
    ceilingMm: raw.ceilingMm,
    rooms: raw.rooms.map((room: Record<string, unknown>) => ({
      sourceNumber: room.sourceNumber,
      name: room.name,
      areaM2: room.areaM2,
      widthMm: room.widthMm,
      depthMm: room.depthMm,
      ceilingMm: room.ceilingMm,
    })),
  }
}
