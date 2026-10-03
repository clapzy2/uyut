/** Local, source-specific survey controls. No guessed room polygons or production writes. */
import { createHash } from 'node:crypto'
import { readFile } from 'node:fs/promises'
import { pdfNativePageDimensionChain } from '../lib/projects/plan-pdf-dimension-chain'
import type { PagePoint, PdfLinework } from '../lib/projects/plan-pdf-linework'
import { pdfPointDistance } from '../lib/projects/plan-pdf-room-binding'

export const sourceSha256 = '2e141c135812c81719e1f4783173cb5202e20041ac494d3cc799eb37ad62ad4e'
type Label = PagePoint & { text: string; rotation: number }
type Span = {
  labelIndex: number
  operationIndex: number
  valueMm: number
  ends: [PagePoint, PagePoint]
}

// Each endpoint below is copied from the extracted source path, not traced from pixels.
const span = (
  labelIndex: number,
  operationIndex: number,
  valueMm: number,
  start: [number, number],
  end: [number, number],
): Span => ({
  labelIndex,
  operationIndex,
  valueMm,
  ends: [
    { x: start[0], y: start[1] },
    { x: end[0], y: end[1] },
  ],
})

export const reviewedSpans = [
  span(56, 6702, 5586, [381.491, 79.258], [651.006, 194.12]),
  span(57, 6748, 3882, [644.959, 174.129], [600.785, 443.618]),
  span(68, 7159, 6965, [384.237, 63.406], [607.321, 446.602]),
  span(79, 7585, 7278, [655.235, 179.953], [307.989, 346.805]),
  span(80, 7631, 1841, [308.484, 337.569], [398.608, 368.758]),
  span(81, 7651, 886, [398.608, 368.758], [441.975, 383.765]),
  span(82, 7667, 3383, [441.975, 383.765], [607.566, 441.071]),
  span(62, 6946, 1458, [322.375, 372.3], [393.722, 396.99]),
  span(63, 6966, 886, [393.722, 396.99], [437.089, 412.001]),
  span(64, 6982, 952, [437.089, 412.001], [483.685, 428.125]),
  span(65, 7053, 262, [481.582, 414.068], [478.627, 432.28]),
  span(66, 7073, 886, [478.627, 432.28], [468.639, 493.815]),
  span(67, 7089, 1616, [468.639, 493.815], [450.425, 606.045]),
  span(85, 7829, 2124, [455.908, 599.469], [351.208, 568.216]),
  span(86, 7849, 1137, [351.208, 568.216], [295.136, 551.479]),
  span(87, 7905, 2869, [335.691, 363.044], [305.072, 562.856]),
  span(95, 8210, 926, [336.577, 571.836], [347.913, 507.842]),
  span(96, 8256, 920, [365.46, 514.058], [354.194, 577.664]),
  span(61, 6900, 2292, [490.996, 427.287], [603.187, 466.112]),
  span(58, 6794, 1613, [466.911, 611.213], [485.099, 499.159]),
  span(59, 6814, 886, [485.099, 499.159], [495.085, 437.62]),
  span(60, 6830, 390, [495.085, 437.62], [499.485, 410.519]),
  span(97, 8302, 2700, [600.282, 455.001], [566.92, 641.536]),
  span(113, 8990, 2232, [462.406, 604.385], [572.33, 638.078]),
]

export const reviewedChains = [
  { room: 5, side: 'lower', indexes: [80, 81, 82], totalMm: 6110, axis: 'width' },
  { room: 6, side: 'upper', indexes: [62, 63, 64], totalMm: 3296, axis: 'width' },
  { room: 6, side: 'right', indexes: [65, 66, 67], totalMm: 2764, axis: 'depth' },
  { room: 6, side: 'lower reference', indexes: [85, 86], totalMm: 3261, axis: 'width' },
  { room: 7, side: 'left', indexes: [58, 59, 60], totalMm: 2889, axis: 'depth' },
] as const

function requireEvidence(condition: boolean, message: string): asserts condition {
  if (!condition) throw new Error(message)
}

export function verifySurveyControls(work: PdfLinework, labels: Label[]) {
  requireEvidence(
    !work.truncated &&
      work.skippedCurves === 0 &&
      work.unsupportedPaths === 0 &&
      work.unsupportedContexts === 0 &&
      work.clippedPaths === 532 &&
      work.clippedPathBoundsTruncated === false,
    'Source extraction diagnostics changed; review the bounded controls',
  )
  const toPoints = (point: PagePoint) => ({
    x: (point.x * work.pageWidth) / 1000,
    y: (point.y * work.pageHeight) / 1000,
  })
  const measurements = reviewedSpans.map((reviewed) => {
    const paths = work.paths.filter((path) => path.operationIndex === reviewed.operationIndex)
    const path = paths[0]
    requireEvidence(
      paths.length === 1 &&
        path?.paint === 'stroke' &&
        !path.closed &&
        path.points.length === 2 &&
        JSON.stringify(path.points) === JSON.stringify(reviewed.ends),
      `Native span ${reviewed.operationIndex} changed`,
    )
    const label = labels[reviewed.labelIndex]
    requireEvidence(
      !!label && Number(label.text.replace(/[ \u00a0\u202f]/g, '')) === reviewed.valueMm,
      `Dimension text ${reviewed.labelIndex} changed`,
    )
    const first = toPoints(reviewed.ends[0])
    const second = toPoints(reviewed.ends[1])
    const anchor = toPoints(label)
    const dx = second.x - first.x
    const dy = second.y - first.y
    const lengthPt = pdfPointDistance(work, ...reviewed.ends)
    const projection = ((anchor.x - first.x) * dx + (anchor.y - first.y) * dy) / lengthPt ** 2
    const perpendicularPt =
      Math.abs((anchor.x - first.x) * dy - (anchor.y - first.y) * dx) / lengthPt
    const rotationDifference = Math.abs(
      (((-Math.atan2(dy, dx) * 180) / Math.PI - label.rotation + 270) % 180) - 90,
    )
    requireEvidence(
      projection > 0 && projection < 1 && perpendicularPt <= 4,
      `Label ${reviewed.labelIndex} is not beside its reviewed span`,
    )
    requireEvidence(rotationDifference <= 1, `Label ${reviewed.labelIndex} direction changed`)
    return {
      ...reviewed,
      text: label.text,
      labelAnchor: { x: label.x, y: label.y, rotation: label.rotation },
      lengthPt,
      mmPerPoint: reviewed.valueMm / lengthPt,
      perpendicularPt,
    }
  })
  const diagonalScales = measurements.filter((item) => [68, 79].includes(item.labelIndex))
  const mmPerPoint = diagonalScales.reduce((sum, item) => sum + item.mmPerPoint, 0) / 2
  const spanChecks = measurements.map((item) => {
    const residualMm = item.lengthPt * mmPerPoint - item.valueMm
    requireEvidence(
      Math.abs(residualMm) <= 50,
      `Span ${item.operationIndex} disagrees with diagonal scale`,
    )
    return { ...item, residualMm }
  })
  const chainChecks = reviewedChains.map((chain) => {
    const parts = chain.indexes.map((index) => {
      const part = spanChecks.find((item) => item.labelIndex === index)
      requireEvidence(!!part, `Missing chain span ${index}`)
      return part
    })
    requireEvidence(
      parts.reduce((sum, item) => sum + item.valueMm, 0) === chain.totalMm,
      `Room ${chain.room}: printed chain sum changed`,
    )
    const junctionGapsPt = parts.slice(1).map((part, index) => {
      const before = parts[index]
      requireEvidence(!!before, 'Missing preceding chain segment')
      return pdfPointDistance(work, before.ends[1], part.ends[0])
    })
    requireEvidence(
      junctionGapsPt.every((gap) => gap <= 0.12),
      `Room ${chain.room}: disconnected chain`,
    )
    const chainLabels = chain.indexes.map((index) => {
      const label = labels[index]
      requireEvidence(!!label, `Missing label ${index}`)
      return { ...label, index }
    })
    const source = { sha256: sourceSha256, pdfPage: 3, state: 'existing' as const }
    const currentVerifier = pdfNativePageDimensionChain(
      work,
      source,
      chainLabels,
      chain.totalMm,
      chain.axis,
    )
    requireEvidence(
      currentVerifier.status === 'unresolved' &&
        currentVerifier.reason === 'invalid-dimension-labels',
      `Room ${chain.room}: tilted dimension support changed; review fixture`,
    )
    const alignedVerifier = pdfNativePageDimensionChain(
      work,
      source,
      chainLabels,
      chain.totalMm,
      'aligned',
    )
    requireEvidence(
      alignedVerifier.status === 'candidate',
      `Room ${chain.room}, ${chain.side}: aligned verification refused`,
    )
    const expectedOperations = parts.map((part) => part.operationIndex).sort((a, b) => a - b)
    requireEvidence(
      JSON.stringify([...alignedVerifier.lineOperations].sort((a, b) => a - b)) ===
        JSON.stringify(expectedOperations),
      `Room ${chain.room}: aligned verifier selected different strokes`,
    )
    for (const segment of alignedVerifier.segments) {
      const reviewed = parts.find((part) => part.labelIndex === segment.labelIndex)
      requireEvidence(
        !!reviewed && reviewed.valueMm === segment.valueMm,
        'Aligned segment text changed',
      )
      const native = work.paths.find((path) => path.operationIndex === reviewed.operationIndex)
      requireEvidence(
        !!native && native.points.includes(segment.start) && native.points.includes(segment.end),
        'Aligned verifier did not preserve original endpoint references',
      )
    }
    return { ...chain, junctionGapsPt, currentVerifier, alignedVerifier }
  })
  requireEvidence(
    labels[36]?.text === '12,7' && labels[160]?.text === 'S: 12,06 м',
    'Bedroom 1 area conflict evidence changed',
  )
  requireEvidence(
    labels[181]?.text.includes('+/- 50 мм') === true &&
      labels[181]?.text.includes('+/-5') === true &&
      labels[185]?.text.includes('миллиметрах') === true,
    'Source uncertainty or units changed',
  )
  // Bounding boxes of the selected control strokes, never asserted room contours.
  // Overlap warns that omitted paths may affect the room; it does not assign ownership.
  const clippedControlEnvelopes = [
    { room: 5, indexes: [56, 57, 68, 79, 80, 81, 82] },
    { room: 6, indexes: [62, 63, 64, 65, 66, 67, 85, 86, 87, 95, 96] },
    { room: 7, indexes: [61, 58, 59, 60, 97, 113] },
  ].map(({ room, indexes }) => {
    const points = reviewedSpans
      .filter((item) => indexes.includes(item.labelIndex))
      .flatMap((item) => item.ends)
    const bounds = {
      left: Math.min(...points.map((point) => point.x)),
      right: Math.max(...points.map((point) => point.x)),
      top: Math.min(...points.map((point) => point.y)),
      bottom: Math.max(...points.map((point) => point.y)),
    }
    const omittedOperations = (work.clippedPathBounds ?? [])
      .filter(
        ({ bounds: omitted }) =>
          omitted.left <= bounds.right &&
          omitted.right >= bounds.left &&
          omitted.top <= bounds.bottom &&
          omitted.bottom >= bounds.top,
      )
      .map((item) => item.operationIndex)
    return { room, bounds, overlappingClippedPaths: omittedOperations.length, omittedOperations }
  })
  return {
    source: { sha256: sourceSha256, pdfPage: 3, printedSheet: 2, state: 'existing' },
    status: 'partial-source-controls',
    extraction: {
      paths: work.paths.length,
      clippedPaths: work.clippedPaths,
      truncated: work.truncated,
    },
    mmPerPoint,
    spanChecks,
    chainChecks,
    clippedControlEnvelopes,
    areaConflict: { room: 3, scheduleM2: 12.7, inRoomM2: 12.06, differenceM2: 0.64 },
    tolerance: { linearMm: 50, angleDegrees: 5 },
    wholeRoomContours: 'not-reconstructed',
  }
}

async function main() {
  const path = process.argv[2]
  if (!path) throw new Error('Usage: bun run scripts/qa-rebrina-existing-control.ts <original.pdf>')
  const bytes = await readFile(path)
  requireEvidence(
    createHash('sha256').update(bytes).digest('hex') === sourceSha256,
    'PDF does not match the reviewed source',
  )
  const { preparePlanPage } = await import('../lib/projects/plan-document')
  const page = await preparePlanPage(bytes, true, 3, true)
  requireEvidence(!!page.linework && !!page.image.planText, 'Missing native page data')
  const report = verifySurveyControls(page.linework, JSON.parse(page.image.planText))
  console.log(JSON.stringify(report, null, 2))
}

if (import.meta.main) await main()
