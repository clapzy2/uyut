import { createHash } from 'node:crypto'
import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { resolve } from 'node:path'
import sharp from 'sharp'
import { preparePlanPage } from '../lib/projects/plan-document'

const sourcePath = process.argv[2]
if (!sourcePath) throw new Error('Provide the source apartment PDF path as the first argument')
const output = resolve('../../tmp/pdfs/complete-page')
await mkdir(output, { recursive: true })
const body = await readFile(sourcePath)
const page = await preparePlanPage(body, true, 6, true)
if (!page.linework || !page.image.planText) throw new Error('Missing native source evidence')
const labels = JSON.parse(page.image.planText) as Array<{
  text: string
  x: number
  y: number
  rotation: number
}>
type Point = { x: number; y: number }
type Span = { start: Point; end: Point }
type Boundary = { polygon: Point[]; wallOperations: number[] }
type Fixture = {
  source: { sha256: string }
  rooms: Array<
    Boundary & {
      openings?: Array<Span & { printedWidth: { widthMm: number; labelIndex: number } }>
      observedCompoundOpening?: Span
    }
  >
  apartmentEnvelope: Boundary & { logicalOpeningClosures: Span[] }
  nativePaths: NonNullable<typeof page.linework>['paths']
  nativeLabels: Array<{ index: number; text: string; x: number; y: number; rotation: number }>
}
const fixture = JSON.parse(
  await readFile(resolve('../../docs/qa/fixtures/apartment-74-77-complete-page.json'), 'utf8'),
) as Fixture
if (fixture.source.sha256 !== createHash('sha256').update(body).digest('hex')) {
  throw new Error('Reference source SHA does not match the fresh PDF')
}
if (JSON.stringify(fixture.nativePaths) !== JSON.stringify(page.linework.paths)) {
  throw new Error('Embedded native paths differ from the fresh extraction')
}
for (const label of fixture.nativeLabels) {
  const actual = labels[label.index]
  if (
    !actual ||
    actual.text !== label.text ||
    actual.x !== label.x ||
    actual.y !== label.y ||
    actual.rotation !== label.rotation
  ) {
    throw new Error(`Embedded native label ${label.index} differs from the fresh extraction`)
  }
}
const nativeKeys = new Set(
  page.linework.paths.flatMap((path) => path.points.map((point) => `${point.x}:${point.y}`)),
)
const points: Point[] = []
function collectPoints(value: unknown) {
  if (Array.isArray(value)) {
    for (const item of value) collectPoints(item)
  } else if (value && typeof value === 'object') {
    if (
      'x' in value &&
      'y' in value &&
      typeof value.x === 'number' &&
      typeof value.y === 'number'
    ) {
      points.push({ x: value.x, y: value.y })
    } else {
      for (const [key, item] of Object.entries(value)) {
        if (key !== 'nativePaths' && key !== 'nativeLabels') collectPoints(item)
      }
    }
  }
}
collectPoints(fixture)
if (points.some((point) => !nativeKeys.has(`${point.x}:${point.y}`))) {
  throw new Error('An annotation point is not an exact fresh native source vertex')
}
function boundaryChecks(boundary: Boundary, closures: Span[]): boolean[] {
  const segments: Array<[Point, Point]> = []
  for (const path of page.linework?.paths ?? []) {
    if (!boundary.wallOperations.includes(path.operationIndex)) continue
    for (let index = 1; index < path.points.length; index++) {
      segments.push([path.points[index - 1] as Point, path.points[index] as Point])
    }
    if (path.closed && path.points.length > 1) {
      segments.push([path.points[path.points.length - 1] as Point, path.points[0] as Point])
    }
  }
  segments.push(...closures.map((span): [Point, Point] => [span.start, span.end]))
  return boundary.polygon.map((a, index) => {
    const b = boundary.polygon[(index + 1) % boundary.polygon.length] as Point
    const dx = b.x - a.x
    const dy = b.y - a.y
    const lengthSquared = dx * dx + dy * dy
    if (!lengthSquared) return false
    const intervals: Array<[number, number]> = []
    for (const [start, end] of segments) {
      const distance = (point: Point) =>
        Math.abs(dx * (point.y - a.y) - dy * (point.x - a.x)) / Math.sqrt(lengthSquared)
      // Source vector extraction rounds native nodes to 0.001 page units.
      if (distance(start) > 0.002 || distance(end) > 0.002) continue
      const position = (point: Point) =>
        ((point.x - a.x) * dx + (point.y - a.y) * dy) / lengthSquared
      const left = Math.max(0, Math.min(position(start), position(end)))
      const right = Math.min(1, Math.max(position(start), position(end)))
      if (right > left) intervals.push([left, right])
    }
    intervals.sort((left, right) => left[0] - right[0])
    let covered = 0
    for (const [left, right] of intervals) {
      if (left > covered + 0.00001) return false
      covered = Math.max(covered, right)
    }
    return covered >= 0.99999
  })
}
const roomChecks = fixture.rooms.flatMap((room) =>
  boundaryChecks(room, [
    ...(room.openings ?? []),
    ...(room.observedCompoundOpening ? [room.observedCompoundOpening] : []),
  ]),
)
const exteriorChecks = boundaryChecks(
  fixture.apartmentEnvelope,
  fixture.apartmentEnvelope.logicalOpeningClosures,
)
const openings = fixture.rooms.flatMap((room) => room.openings ?? [])
if (roomChecks.some((valid) => !valid) || exteriorChecks.some((valid) => !valid)) {
  throw new Error('A contour edge lacks native wall lines or an explicit logical opening closure')
}
if (
  openings.some(
    (opening) =>
      Number(labels[opening.printedWidth.labelIndex]?.text) !== opening.printedWidth.widthMm,
  )
) {
  throw new Error('An annotated printed opening width differs from its source label')
}
console.log(
  JSON.stringify({
    exactNativeAnnotationPoints: points.length,
    uniqueAnnotationPoints: new Set(points.map((point) => `${point.x}:${point.y}`)).size,
    roomEdges: roomChecks.length,
    exteriorEdges: exteriorChecks.length,
    printedOpeningWidths: openings.length,
    qualification:
      'Native lines plus explicitly declared logical opening closures; no inferred centimetre scale or unresolved kitchen split',
  }),
)
await writeFile(
  resolve(output, 'fresh-native.json'),
  `${JSON.stringify(
    {
      source: {
        sha256: createHash('sha256').update(body).digest('hex'),
        pdfPage: 6,
        state: 'existing',
      },
      linework: page.linework,
      labels: labels.map((label, index) => ({ index, ...label })),
    },
    null,
    2,
  )}\n`,
)
await writeFile(resolve(output, 'source-page-6.jpg'), page.image.body)
const metadata = await sharp(page.image.body).metadata()
if (!metadata.width || !metadata.height) throw new Error('Missing image size')
const width = metadata.width
const height = metadata.height
await sharp(page.image.body)
  .extract({
    left: Math.floor(width * 0.17),
    top: Math.floor(height * 0.04),
    width: Math.floor(width * 0.71),
    height: Math.floor(height * 0.73),
  })
  .resize({ width: 1800 })
  .png()
  .toFile(resolve(output, 'apartment-page-6.png'))
console.log(JSON.stringify({ paths: page.linework.paths.length, labels: labels.length, output }))
for (const [name, left, top, cropWidth, cropHeight] of [
  ['top-openings', 0.39, 0.05, 0.26, 0.14],
  ['service-entry', 0.64, 0.32, 0.23, 0.23],
] as const) {
  await sharp(page.image.body)
    .extract({
      left: Math.floor(width * left),
      top: Math.floor(height * top),
      width: Math.floor(width * cropWidth),
      height: Math.floor(height * cropHeight),
    })
    .resize({ width: 1600 })
    .png()
    .toFile(resolve(output, `${name}.png`))
}
