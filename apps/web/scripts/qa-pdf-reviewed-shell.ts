import type { PagePoint, PdfLinework } from '../lib/projects/plan-pdf-linework'
import { pdfBoundaryDistance, pdfPolygonIsValid } from '../lib/projects/plan-pdf-room-binding'
import type { MeasuredOpening } from './qa-pdf-perimeter'

type EdgeSource = { wallFillOperation: number } | { openingLabelIndex: number }

export type ReviewedShell = {
  polygon: PagePoint[]
  edgeSources: EdgeSource[]
}

/** A traced source draft, never a certified free-floor contour. */
export function verifyReviewedPdfShell(
  sourceFile: string,
  work: PdfLinework,
  shell: ReviewedShell,
  openings: readonly MeasuredOpening[],
  scale: { widthCmPerPt: number; depthCmPerPt: number },
  signedAreaM2: number,
) {
  if (
    !pdfPolygonIsValid(shell.polygon) ||
    shell.edgeSources.length !== shell.polygon.length ||
    !Number.isFinite(scale.widthCmPerPt) ||
    !Number.isFinite(scale.depthCmPerPt) ||
    scale.widthCmPerPt <= 0 ||
    scale.depthCmPerPt <= 0 ||
    !Number.isFinite(signedAreaM2) ||
    signedAreaM2 <= 0
  ) {
    throw new Error(`${sourceFile}: invalid reviewed shell draft`)
  }

  const usedOpenings = new Set<number>()
  let wallEdges = 0
  for (const [index, edgeSource] of shell.edgeSources.entries()) {
    const start = shell.polygon[index]
    const end = shell.polygon[(index + 1) % shell.polygon.length]
    if (!start || !end) throw new Error(`${sourceFile}: missing shell edge`)

    if ('wallFillOperation' in edgeSource) {
      const matches = work.paths.filter(
        (path) => path.operationIndex === edgeSource.wallFillOperation,
      )
      const path = matches[0]
      if (matches.length !== 1 || path?.paint !== 'fill' || !path.closed) {
        throw new Error(`${sourceFile}: reviewed shell wall body is missing or ambiguous`)
      }
      for (const fraction of [0, 0.25, 0.5, 0.75, 1]) {
        const point = {
          x: start.x + (end.x - start.x) * fraction,
          y: start.y + (end.y - start.y) * fraction,
        }
        if (pdfBoundaryDistance(work, point, path.points) > 0.12) {
          throw new Error(`${sourceFile}: reviewed shell edge leaves its native wall face`)
        }
      }
      wallEdges++
      continue
    }

    const opening = openings.find((item) => item.labelIndex === edgeSource.openingLabelIndex)
    if (!opening || usedOpenings.has(opening.labelIndex)) {
      throw new Error(`${sourceFile}: reviewed shell opening is missing or repeated`)
    }
    const along = opening.axis === 'width' ? 'x' : 'y'
    const across = opening.axis === 'width' ? 'y' : 'x'
    const pageSize = opening.axis === 'width' ? work.pageWidth : work.pageHeight
    const expected = opening.ends.map((point) => point[along]).sort((a, b) => a - b)
    const actual = [start[along], end[along]].sort((a, b) => a - b)
    // Dimension lines can be offset from the wall. A closure must still sit on
    // one of the reviewed wall-face levels, including a stepped wall face.
    const faceLevels = opening.wallFaceAcross
    if (
      start[across] !== end[across] ||
      !faceLevels?.some(
        (level) =>
          (Math.abs(start[across] - level) *
            (opening.axis === 'width' ? work.pageHeight : work.pageWidth)) /
            1000 <=
          0.12,
      ) ||
      actual.some(
        (value, position) =>
          expected[position] === undefined ||
          (Math.abs(value - expected[position]) * pageSize) / 1000 > 0.12,
      )
    ) {
      throw new Error(`${sourceFile}: reviewed shell closure disagrees with measured opening`)
    }
    usedOpenings.add(opening.labelIndex)
  }
  if (usedOpenings.size !== openings.length) {
    throw new Error(`${sourceFile}: reviewed shell omits a measured perimeter opening`)
  }

  let twiceAreaPdfPoints = 0
  for (const [index, first] of shell.polygon.entries()) {
    const second = shell.polygon[(index + 1) % shell.polygon.length]
    if (!second) continue
    const firstX = (first.x * work.pageWidth) / 1000
    const firstY = (first.y * work.pageHeight) / 1000
    const secondX = (second.x * work.pageWidth) / 1000
    const secondY = (second.y * work.pageHeight) / 1000
    twiceAreaPdfPoints += firstX * secondY - secondX * firstY
  }
  const draftAreaM2 =
    (Math.abs(twiceAreaPdfPoints) * scale.widthCmPerPt * scale.depthCmPerPt) / 20_000
  const differenceFromSignedM2 = draftAreaM2 - signedAreaM2
  return {
    vertices: shell.polygon.length,
    wallEdges,
    measuredOpeningEdges: usedOpenings.size,
    draftAreaM2,
    differenceFromSignedM2,
    areaStatus: Math.abs(differenceFromSignedM2) > 0.01 ? 'mismatch' : 'within-rounding',
    contourStatus: 'review-draft' as const,
  }
}
