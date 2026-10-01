import type { PagePoint, PdfLinework } from '../lib/projects/plan-pdf-linework'
import { pdfPointInside } from '../lib/projects/plan-pdf-room-binding'

type Axis = 'width' | 'depth'
export type PerimeterProbe = {
  side: string
  axis: Axis
  at: number
  from: number
  to: number
  wallFillOperations: number[]
  openingLabelIndexes: number[]
  gapBoundaryTolerance: number
}
export type MeasuredOpening = {
  labelIndex: number
  axis: Axis
  ends: [PagePoint, PagePoint]
  /** Reviewed transverse coordinates of the two existing wall faces at the gap. */
  wallFaceAcross?: [number, number]
}
export type InteriorSpan = {
  axis: Axis
  ends: [PagePoint, PagePoint]
  freeProbeAcross: number
  blockedProbeAcross: number
  blockerWallFillOperation: number
}
type Gap = { from: number; to: number }

/** A printed clear span does not prove a through-route when a wall closes its side. */
export function verifyPdfBlockedInteriorSpan(
  sourceFile: string,
  work: PdfLinework,
  span: InteriorSpan,
): void {
  const along = span.axis === 'width' ? 'x' : 'y'
  const across = span.axis === 'width' ? 'y' : 'x'
  const from = Math.min(span.ends[0][along], span.ends[1][along])
  const to = Math.max(span.ends[0][along], span.ends[1][along])
  const blockers = work.paths.filter(
    (path) => path.operationIndex === span.blockerWallFillOperation,
  )
  const blocker = blockers[0]
  if (
    blockers.length !== 1 ||
    blocker?.paint !== 'fill' ||
    !blocker.closed ||
    !Number.isFinite(span.freeProbeAcross) ||
    !Number.isFinite(span.blockedProbeAcross) ||
    span.freeProbeAcross === span.blockedProbeAcross ||
    to <= from
  ) {
    throw new Error(`${sourceFile}: invalid reviewed interior span`)
  }

  const fills = work.paths.filter((path) => path.paint === 'fill' && path.closed)
  const cuts = [from, to]
  for (const path of fills) {
    for (const probeAcross of [span.freeProbeAcross, span.blockedProbeAcross]) {
      for (let index = 0; index < path.points.length; index++) {
        const first = path.points[index]
        const second = path.points[(index + 1) % path.points.length]
        if (!first || !second) continue
        const firstOffset = first[across] - probeAcross
        const secondOffset = second[across] - probeAcross
        if (firstOffset === 0 && secondOffset === 0) {
          if (
            Math.max(first[along], second[along]) > from &&
            Math.min(first[along], second[along]) < to
          ) {
            throw new Error(`${sourceFile}: reviewed interior probe follows a fill boundary`)
          }
          continue
        }
        if (firstOffset * secondOffset > 0 || firstOffset === secondOffset) continue
        const ratio = -firstOffset / (secondOffset - firstOffset)
        if (ratio < 0 || ratio > 1) continue
        const cut = first[along] + ratio * (second[along] - first[along])
        if (cut > from && cut < to) cuts.push(cut)
      }
    }
  }
  cuts.sort((a, b) => a - b)
  for (let index = 1; index < cuts.length; index++) {
    const left = cuts[index - 1]
    const right = cuts[index]
    if (left === undefined || right === undefined || right - left < 1e-8) continue
    const position = (left + right) / 2
    const free = { [along]: position, [across]: span.freeProbeAcross } as PagePoint
    const blocked = { [along]: position, [across]: span.blockedProbeAcross } as PagePoint
    if (
      fills.some((path) => pdfPointInside(free, path.points)) ||
      !pdfPointInside(blocked, blocker.points)
    ) {
      throw new Error(`${sourceFile}: reviewed interior span is not clear beside a continuous wall`)
    }
  }
}

/** Source-reviewed wall bodies only; one section per side is not full-contour certification. */
export function verifyPdfPerimeterProbes(
  sourceFile: string,
  work: PdfLinework,
  probes: readonly PerimeterProbe[],
  openings: readonly MeasuredOpening[],
): Record<string, Gap[]> {
  const result: Record<string, Gap[]> = {}
  for (const probe of probes) {
    if (
      result[probe.side] ||
      !(probe.from < probe.to) ||
      !Number.isFinite(probe.at) ||
      !Number.isFinite(probe.gapBoundaryTolerance) ||
      probe.gapBoundaryTolerance < 0 ||
      probe.wallFillOperations.length === 0
    ) {
      throw new Error(`${sourceFile}: invalid perimeter probe`)
    }
    const along = probe.axis === 'width' ? 'x' : 'y'
    const across = probe.axis === 'width' ? 'y' : 'x'
    const bodies = probe.wallFillOperations.map((operationIndex) => {
      const matches = work.paths.filter((path) => path.operationIndex === operationIndex)
      const path = matches[0]
      if (matches.length !== 1 || path?.paint !== 'fill' || !path.closed) {
        throw new Error(`${sourceFile}: ${probe.side} wall body is missing or ambiguous`)
      }
      const transverse = path.points.map((point) => point[across])
      if (probe.at <= Math.min(...transverse) || probe.at >= Math.max(...transverse)) {
        throw new Error(`${sourceFile}: ${probe.side} probe misses a selected wall body`)
      }
      return path
    })

    const cuts = [probe.from, probe.to]
    for (const body of bodies) {
      for (const [index, first] of body.points.entries()) {
        const second = body.points[(index + 1) % body.points.length]
        if (!second) continue
        const firstOffset = first[across] - probe.at
        const secondOffset = second[across] - probe.at
        if (Math.abs(firstOffset) < 1e-6 || Math.abs(secondOffset) < 1e-6) {
          throw new Error(`${sourceFile}: ${probe.side} probe touches a wall vertex`)
        }
        if (firstOffset * secondOffset >= 0) continue
        const ratio = -firstOffset / (second[across] - first[across])
        const cut = first[along] + ratio * (second[along] - first[along])
        if (cut > probe.from && cut < probe.to) cuts.push(cut)
      }
    }
    const sortedCuts = [
      ...new Set(cuts.map((cut) => Math.round(cut * 1_000_000) / 1_000_000)),
    ].sort((a, b) => a - b)
    const gaps: Gap[] = []
    for (let index = 1; index < sortedCuts.length; index++) {
      const from = sortedCuts[index - 1]
      const to = sortedCuts[index]
      if (from === undefined || to === undefined || to - from < 1e-6) continue
      const middle = (from + to) / 2
      const point = { [along]: middle, [across]: probe.at } as PagePoint
      if (bodies.some((body) => pdfPointInside(point, body.points))) continue
      const previous = gaps.at(-1)
      if (previous && Math.abs(previous.to - from) < 1e-6) previous.to = to
      else gaps.push({ from, to })
    }
    const expected = probe.openingLabelIndexes.map((labelIndex) => {
      const span = openings.find((opening) => opening.labelIndex === labelIndex)
      if (!span || span.axis !== probe.axis) {
        throw new Error(`${sourceFile}: ${probe.side} opening lacks a reviewed dimension`)
      }
      return { from: span.ends[0][along], to: span.ends[1][along] }
    })
    if (
      gaps.length !== expected.length ||
      gaps.some((gap, index) => {
        const opening = expected[index]
        return (
          !opening ||
          Math.abs(gap.from - opening.from) > probe.gapBoundaryTolerance ||
          Math.abs(gap.to - opening.to) > probe.gapBoundaryTolerance
        )
      })
    ) {
      throw new Error(`${sourceFile}: ${probe.side} wall coverage disagrees with openings`)
    }
    result[probe.side] = gaps
  }
  return result
}
