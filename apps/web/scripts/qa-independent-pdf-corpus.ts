/** Local-only check of independently reviewed existing-state PDF pages. */
import { createHash } from 'node:crypto'
import { readFile } from 'node:fs/promises'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { preparePlanPage } from '../lib/projects/plan-document'
import { pdfNativePageDimensionChain } from '../lib/projects/plan-pdf-dimension-chain'
import type { PagePoint } from '../lib/projects/plan-pdf-linework'
import { pdfBoundaryDistance, pdfPointInside } from '../lib/projects/plan-pdf-room-binding'
import {
  type MeasuredOpening,
  type PerimeterProbe,
  verifyPdfPerimeterProbes,
} from './qa-pdf-perimeter'

type Label = { index: number; text: string }
type Axis = 'width' | 'depth'
type WallAnchor = { operationIndex: number; point: PagePoint }
type Chain = {
  axis: Axis
  total: Label
  parts: Label[]
  expectedNativeIssue?: string
  wallAnchors?: [WallAnchor, WallAnchor]
}
type StandaloneDimension = {
  axis: Axis
  label: Label
  expectedNativeIssue?: string
  wallAnchors?: [WallAnchor, WallAnchor]
  opening?: {
    kind: 'window' | 'door'
    probeAcross: number
    ignoredAnnotationFills?: number[]
  }
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
  perimeterProbes?: PerimeterProbe[]
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
  const openingSpans: MeasuredOpening[] = []
  let wallAnchoredDimensions = 0
  let sampledOpeningGaps = 0
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
  const checkWallAnchors = (
    ends: [PagePoint, PagePoint],
    axis: Axis,
    anchors: [WallAnchor, WallAnchor] | undefined,
  ) => {
    if (!anchors) return
    const along = axis === 'width' ? 'x' : 'y'
    const pageSize = axis === 'width' ? linework.pageWidth : linework.pageHeight
    for (const [index, anchor] of anchors.entries()) {
      const path = linework.paths.find(
        (candidate) => candidate.operationIndex === anchor.operationIndex,
      )
      const end = ends[index]
      if (
        !path ||
        !end ||
        path.paint !== 'fill' ||
        !path.closed ||
        pdfBoundaryDistance(linework, anchor.point, path.points) > 0.12 ||
        (Math.abs(anchor.point[along] - end[along]) * pageSize) / 1000 > 0.12
      ) {
        throw new Error(`${source.file}: printed dimension no longer reaches a reviewed wall face`)
      }
    }
    wallAnchoredDimensions++
  }
  const checkOpeningGap = (
    ends: [PagePoint, PagePoint],
    axis: Axis,
    opening: StandaloneDimension['opening'],
    anchors: StandaloneDimension['wallAnchors'],
  ) => {
    if (!opening) return
    if (axis !== 'width' || !anchors || anchors[0].operationIndex === anchors[1].operationIndex) {
      throw new Error(`${source.file}: an opening needs two separate wall bodies on one axis`)
    }
    for (const anchor of anchors) {
      const path = linework.paths.find(
        (candidate) => candidate.operationIndex === anchor.operationIndex,
      )
      const across = path?.points.map((point) => point.y) ?? []
      if (
        across.length === 0 ||
        opening.probeAcross <= Math.min(...across) ||
        opening.probeAcross >= Math.max(...across)
      ) {
        throw new Error(`${source.file}: opening probe misses an adjacent wall body`)
      }
    }
    const ignored = new Set(opening.ignoredAnnotationFills ?? [])
    for (const operationIndex of ignored) {
      const path = linework.paths.find((candidate) => candidate.operationIndex === operationIndex)
      if (path?.paint !== 'fill' || !path.closed) {
        throw new Error(`${source.file}: ignored annotation mark is no longer a native fill`)
      }
      const xs = path.points.map((point) => point.x)
      const ys = path.points.map((point) => point.y)
      if (Math.max(...xs) - Math.min(...xs) > 8 || Math.max(...ys) - Math.min(...ys) > 8) {
        throw new Error(`${source.file}: ignored annotation mark is too large to exclude`)
      }
    }
    for (const fraction of [0.1, 0.3, 0.5, 0.7, 0.9]) {
      const point = {
        x: ends[0].x + (ends[1].x - ends[0].x) * fraction,
        y: opening.probeAcross,
      }
      if (
        linework.paths.some(
          (path) =>
            path.paint === 'fill' &&
            path.closed &&
            !ignored.has(path.operationIndex) &&
            pdfPointInside(point, path.points),
        )
      ) {
        throw new Error(`${source.file}: a reviewed ${opening.kind} gap contains native fill`)
      }
    }
    sampledOpeningGaps++
  }
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
    checkWallAnchors(native.ends, chain.axis, chain.wallAnchors)
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
    if (dimensionLabel.opening && !dimensionLabel.wallAnchors) {
      throw new Error(`${source.file}: an opening review needs both wall-face anchors`)
    }
    checkWallAnchors(native.ends, dimensionLabel.axis, dimensionLabel.wallAnchors)
    checkOpeningGap(
      native.ends,
      dimensionLabel.axis,
      dimensionLabel.opening,
      dimensionLabel.wallAnchors,
    )
    if (dimensionLabel.opening) {
      openingSpans.push({
        labelIndex: dimensionLabel.label.index,
        axis: dimensionLabel.axis,
        ends: native.ends,
      })
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

  const perimeterGaps = verifyPdfPerimeterProbes(
    source.file,
    linework,
    source.perimeterProbes ?? [],
    openingSpans,
  )

  results.push({
    file: source.file,
    page: source.existingPage,
    nativePaths: linework.paths.length,
    nativeLabels: text.length,
    closedPrintedChains: source.chains?.length ?? 0,
    nativeDimensionProofs: nativeProofs.length,
    nativeDimensionIssues: nativeIssues,
    wallAnchoredDimensions,
    sampledOpeningGaps,
    perimeterGaps,
    clippedPaths: linework.clippedPaths,
    skippedCurves: linework.skippedCurves,
  })
}

console.log(JSON.stringify({ checked: results.length, results }, null, 2))
