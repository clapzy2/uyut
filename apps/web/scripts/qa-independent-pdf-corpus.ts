/** Local-only check of independently reviewed existing-state PDF pages. */
import { createHash } from 'node:crypto'
import { readFile } from 'node:fs/promises'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { preparePlanPage } from '../lib/projects/plan-document'
import { pdfNativePageDimensionChain } from '../lib/projects/plan-pdf-dimension-chain'

type Label = { index: number; text: string }
type Chain = {
  axis: 'width' | 'depth'
  total: Label
  parts: Label[]
  expectedNativeIssue?: string
}
type StandaloneDimension = {
  axis: 'width' | 'depth'
  label: Label
  expectedNativeIssue?: string
}
type Source = {
  file: string
  sha256: string
  pages: number
  existingPage: number
  minNativePaths: number
  textLayer: 'extractable' | 'outlined'
  labels: Label[]
  chains?: Chain[]
  standaloneDimensions?: StandaloneDimension[]
}

const sourceDirectory = process.argv[2]
if (!sourceDirectory) {
  throw new Error('Usage: bun run scripts/qa-independent-pdf-corpus.ts <PDF directory>')
}

const scriptDirectory = dirname(fileURLToPath(import.meta.url))
const fixturePath = resolve(
  scriptDirectory,
  '../../../docs/qa/fixtures/independent-pdf-corpus.json',
)
const sources = JSON.parse(await readFile(fixturePath, 'utf8')) as Source[]

function dimension(label: Label): number {
  if (!/^\d[\d ]*$/.test(label.text)) {
    throw new Error(`Not a millimetre dimension: ${label.text}`)
  }
  return Number(label.text.replaceAll(' ', ''))
}

const results = []
for (const source of sources) {
  if (!/^[a-z0-9_-]+\.pdf$/.test(source.file)) {
    throw new Error(`Invalid corpus filename: ${source.file}`)
  }
  const body = await readFile(join(sourceDirectory, source.file))
  const hash = createHash('sha256').update(body).digest('hex')
  if (hash !== source.sha256) {
    throw new Error(`${source.file}: source hash changed; review the PDF again`)
  }

  const page = await preparePlanPage(body, true, source.existingPage, true)
  const linework = page.linework
  if (
    page.pageCount !== source.pages ||
    !linework ||
    linework.truncated ||
    linework.unsupportedPaths > 0 ||
    linework.paths.length < source.minNativePaths
  ) {
    throw new Error(`${source.file}: native existing-page extraction is incomplete or changed`)
  }

  const text = JSON.parse(page.image.planText ?? '[]') as Array<{
    text: string
    x: number
    y: number
    rotation: number
  }>
  if (source.textLayer === 'outlined' && text.length !== 0) {
    throw new Error(`${source.file}: outlined text assumption changed; review the page again`)
  }
  if (source.textLayer === 'extractable' && text.length === 0) {
    throw new Error(`${source.file}: the measured page has no extractable text`)
  }

  const checkLabel = (label: Label) => {
    if (text[label.index]?.text !== label.text) {
      throw new Error(`${source.file}: native label ${label.index} changed`)
    }
  }
  for (const label of source.labels) checkLabel(label)
  const nativeProofs: Array<{
    scale: number
    segments: Array<{
      valueMm: number
      start: { x: number; y: number }
      end: { x: number; y: number }
    }>
  }> = []
  const nativeIssues: string[] = []
  const sourceRef = {
    sha256: source.sha256,
    pdfPage: source.existingPage,
    state: 'existing' as const,
  }
  const labelWithPosition = (label: Label) => {
    const position = text[label.index]
    if (!position) throw new Error(`${source.file}: native label ${label.index} is missing`)
    return { ...position, index: label.index }
  }
  const pointLength = (start: { x: number; y: number }, end: { x: number; y: number }) =>
    Math.hypot(
      ((end.x - start.x) * linework.pageWidth) / 1000,
      ((end.y - start.y) * linework.pageHeight) / 1000,
    )
  for (const chain of source.chains ?? []) {
    checkLabel(chain.total)
    for (const part of chain.parts) checkLabel(part)
    const sum = chain.parts.reduce((total, part) => total + dimension(part), 0)
    if (sum !== dimension(chain.total)) {
      throw new Error(`${source.file}: printed dimension chain does not close`)
    }

    const native = pdfNativePageDimensionChain(
      linework,
      sourceRef,
      chain.parts.map(labelWithPosition),
      sum,
      chain.axis,
    )
    if (chain.expectedNativeIssue) {
      if (native.status === 'candidate' || native.reason !== chain.expectedNativeIssue) {
        throw new Error(`${source.file}: expected native chain issue changed`)
      }
      nativeIssues.push(native.reason)
      continue
    }
    const overall = pdfNativePageDimensionChain(
      linework,
      sourceRef,
      [labelWithPosition(chain.total)],
      sum,
      chain.axis,
    )
    if (native.status !== 'candidate' || overall.status !== 'candidate') {
      throw new Error(`${source.file}: a printed chain has no unique native dimension lines`)
    }
    const along = chain.axis === 'width' ? 'x' : 'y'
    const pointSize = chain.axis === 'width' ? linework.pageWidth : linework.pageHeight
    for (const endpoint of [0, 1] as const) {
      const endpointGapPt =
        (Math.abs(native.ends[endpoint][along] - overall.ends[endpoint][along]) * pointSize) / 1000
      if (endpointGapPt > 0.12) {
        throw new Error(`${source.file}: the total label spans different native endpoints`)
      }
    }
    nativeProofs.push({
      scale: sum / 10 / pointLength(...native.ends),
      segments: native.segments,
    })
  }
  for (const dimensionLabel of source.standaloneDimensions ?? []) {
    checkLabel(dimensionLabel.label)
    const millimetres = dimension(dimensionLabel.label)
    const native = pdfNativePageDimensionChain(
      linework,
      sourceRef,
      [labelWithPosition(dimensionLabel.label)],
      millimetres,
      dimensionLabel.axis,
    )
    if (dimensionLabel.expectedNativeIssue) {
      if (native.status === 'candidate' || native.reason !== dimensionLabel.expectedNativeIssue) {
        throw new Error(`${source.file}: expected native dimension issue changed`)
      }
      nativeIssues.push(native.reason)
      continue
    }
    if (native.status !== 'candidate') {
      throw new Error(`${source.file}: standalone dimension lacks a unique native line`)
    }
    nativeProofs.push({
      scale: millimetres / 10 / pointLength(...native.ends),
      segments: native.segments,
    })
  }

  const referenceScale = nativeProofs[0]?.scale
  if (
    referenceScale &&
    nativeProofs.some(
      (proof) =>
        Math.abs(proof.scale - referenceScale) / referenceScale > 0.005 ||
        proof.segments.some(
          (segment) =>
            Math.abs(
              pointLength(segment.start, segment.end) * referenceScale - segment.valueMm / 10,
            ) > 0.5,
        ),
    )
  ) {
    throw new Error(`${source.file}: native dimension segments disagree on one page scale`)
  }

  results.push({
    file: source.file,
    page: source.existingPage,
    nativePaths: linework.paths.length,
    nativeLabels: text.length,
    closedPrintedChains: source.chains?.length ?? 0,
    nativeDimensionChains: nativeProofs.length,
    nativeDimensionIssues: nativeIssues,
    clippedPaths: linework.clippedPaths,
    skippedCurves: linework.skippedCurves,
  })
}

console.log(JSON.stringify({ checked: results.length, results }, null, 2))
