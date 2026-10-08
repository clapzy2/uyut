// Offline floor-only math/scene control; never saves or confirms a project geometry.
// bun --no-env-file run apps/web/scripts/bench-native-metric-cycles.ts PDF FRESH_DIR
import assert from 'node:assert/strict'
import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { resolve } from 'node:path'
import type { PlanGeometry } from '@uyut/db'
import sharp from 'sharp'
import { preparePlanPage } from '../lib/projects/plan-document'
import {
  nativeDimensionEvidence,
  type ReviewedNativeDimensions,
} from '../lib/projects/plan-native-dimension-evidence'
import { nativeFaceCycle, type ReviewedNativeFaces } from '../lib/projects/plan-native-face-cycle'
import {
  metricNativeCycles,
  type ReviewedMetricAnchors,
} from '../lib/projects/plan-native-metric-cycles'
import { buildPlanScene } from '../lib/projects/plan-scene-geometry'
import { type PlanVolume, planVolume } from '../lib/projects/plan-volume'

const [pdfPath, outputPath] = process.argv.slice(2)
if (!pdfPath || !outputPath) throw new Error('Supply controlled PDF and fresh output directory')
const fixture = async (name: string) =>
  JSON.parse(await readFile(resolve('docs/qa/fixtures', name), 'utf8'))
const reviewed: ReviewedMetricAnchors = await fixture(
  'apartment-native-reviewed-metric-anchors.json',
)
const dimensionsReview: ReviewedNativeDimensions = await fixture(
  'apartment-native-reviewed-dimensions.json',
)
const page = await preparePlanPage(
  await readFile(resolve(pdfPath)),
  true,
  reviewed.source.pdfPage,
  true,
  true,
)
if (!page.nativeTextAnchors || !page.linework || !page.lineworkRasterSource)
  throw new Error('Missing native evidence')
const native = page.nativeTextAnchors,
  work = page.linework,
  lineworkSource = page.lineworkRasterSource
const dimensions = nativeDimensionEvidence({
  native,
  work,
  lineworkSource,
  reviewed: dimensionsReview,
})
const cycles = []
for (const id of ['bedroom', 'balcony']) {
  const faces: ReviewedNativeFaces = await fixture(`apartment-native-reviewed-${id}-faces.json`)
  const cycle = nativeFaceCycle({ native, work, lineworkSource, dimensions, reviewed: faces })
  if (cycle.status !== 'candidate') throw new Error(cycle.reason)
  cycles.push({ id, cycle })
}
const input = { native, work, lineworkSource, dimensions, cycles, reviewed }
const metric = metricNativeCycles(input)
if (metric.status !== 'draft') throw new Error(metric.reason)
const reports = []
for (const contour of metric.contours) {
  const expected = await fixture(
    `chigintseva-existing-${contour.id === 'bedroom' ? 'bedroom-02' : 'balcony-08'}.json`,
  )
  assert.ok(Math.abs(contour.areaM2 - expected.room.areaM2) <= 0.05, 'printed area rounding check')
  const draft: PlanGeometry = {
    version: 1,
    status: 'draft',
    source: 'manual',
    widthCm: metric.pageSizeCm.width,
    heightCm: metric.pageSizeCm.height,
    walls: [],
    openings: [],
    rooms: [],
    footprint: contour.polygonCm,
    warnings: [],
  }
  assert.equal(planVolume(draft), null, 'application confirmation gate must remain intact')
  // This explicit scene primitive tests triangulation only, not an approved apartment volume.
  const model: PlanVolume = {
    floor: contour.polygonCm,
    voids: [],
    walls: [],
    openings: [],
    solidFaces: [],
    wallSource: 'centerline',
    joinedSolids: false,
    issues: [],
  }
  const scene = buildPlanScene(model)
  const floor = scene.surfaces.find((surface) => surface.kind === 'floor')
  assert.ok(floor)
  const positions = floor.geometry.getAttribute('position')
  const indices = floor.geometry.getIndex()
  const vertexIndex = (index: number) => (indices ? indices.getX(index) : index)
  const count = indices?.count ?? positions.count
  let areaM2 = 0
  for (let index = 0; index < count; index += 3) {
    const a = vertexIndex(index),
      b = vertexIndex(index + 1),
      c = vertexIndex(index + 2)
    areaM2 +=
      Math.abs(
        (positions.getX(b) - positions.getX(a)) * (positions.getZ(c) - positions.getZ(a)) -
          (positions.getZ(b) - positions.getZ(a)) * (positions.getX(c) - positions.getX(a)),
      ) / 2
  }
  assert.ok(
    Math.abs(areaM2 - contour.areaM2) < 0.0001,
    'same floor area in cm polygon and metre scene',
  )
  for (const point of contour.polygonCm) {
    assert.ok(
      Array.from({ length: positions.count }, (_, index) => index).some(
        (index) =>
          Math.abs(positions.getX(index) - point.xCm / 100) < 0.00001 &&
          Math.abs(positions.getZ(index) - point.yCm / 100) < 0.00001 &&
          positions.getY(index) === 0,
      ),
      'each original 2D vertex must survive the floor scene',
    )
  }
  reports.push({
    id: contour.id,
    area2dM2: contour.areaM2,
    areaSceneM2: areaM2,
    vertexCount: contour.polygonCm.length,
    appDraftVolumeRefused: true,
  })
  for (const surface of scene.surfaces) surface.geometry.dispose()
  for (const line of scene.lines) line.geometry.dispose()
}
const incomplete = metricNativeCycles({
  ...input,
  reviewed: {
    ...reviewed,
    anchors: reviewed.anchors.filter((anchor) => anchor.cycleId !== 'balcony'),
  },
})
assert.equal(incomplete.status, 'unresolved')
const directory = resolve(outputPath)
await mkdir(directory, { recursive: false })
await writeFile(
  resolve(directory, 'result.json'),
  JSON.stringify(
    {
      aiRequests: 0,
      metric,
      reports,
      missingContourCalibration: incomplete,
      caveat:
        'Floor-scene primitive only; no app confirmation, walls, openings, heights, WebGL UI or installation acceptance.',
    },
    null,
    2,
  ),
)
const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="1000" height="750" viewBox="0 0 ${metric.pageSizeCm.width} ${metric.pageSizeCm.height}">
  <rect width="100%" height="100%" fill="#ffffff"/>
  ${metric.contours.map((contour) => `<polygon points="${contour.polygonCm.map(({ xCm, yCm }) => `${xCm},${yCm}`).join(' ')}" fill="#d0efed" stroke="#008888" stroke-width="3"/>`).join('')}
</svg>`
await writeFile(resolve(directory, 'metric-2d.svg'), svg)
await sharp(Buffer.from(svg))
  .flatten({ background: '#ffffff' })
  .png()
  .toFile(resolve(directory, 'metric-2d.png'))
console.log(
  JSON.stringify(
    {
      aiRequests: 0,
      status: metric.status,
      cmPerPoint: metric.cmPerPoint,
      reports,
      missingContourCalibration: incomplete.status,
    },
    null,
    2,
  ),
)
