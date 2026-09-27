import type { PlanPageContours } from '@uyut/db'
import { describe, expect, it } from 'vitest'
import fixture from '../../../../docs/qa/fixtures/apartment-74-77-page-features.json'
import { verifyPlanPageOpenings } from './plan-page-feature-checks'
import { planPageContoursSchema } from './plan-page-review'
import type { PdfLinework, PdfVectorPath } from './plan-pdf-linework'

const contours: PlanPageContours = {
  ...fixture,
  source: { ...fixture.source, state: 'existing' },
  coordinateSystem: 'page-0-1000',
  review: 'manual-source-review',
  rooms: fixture.rooms.map((room) => ({
    roomSourceNumber: room.roomSourceNumber,
    polygon: room.polygon,
    openings: room.openings.map(({ id, wallEdgeIndex, start, end }) => ({
      id,
      kind: 'door',
      wallEdgeIndex,
      start,
      end,
    })),
  })),
}
const work: PdfLinework = {
  coordinateSystem: 'page-0-1000',
  pageWidth: fixture.pageWidth,
  pageHeight: fixture.pageHeight,
  paths: [...fixture.wallPaths, ...fixture.dimensionPaths] as PdfVectorPath[],
  skippedCurves: 0,
  unsupportedContexts: 0,
  unsupportedPaths: 0,
  clippedPaths: 0,
  truncated: false,
}
const labels = Array.from({ length: 170 }, () => ({ text: '', x: 0, y: 0, rotation: 0 }))
for (const { index, ...label } of fixture.labels) labels[index] = label
const planText = JSON.stringify(labels)

describe('server-derived opening checks on the original sheet', () => {
  it('derives all four printed widths from actual native labels without metric page conversion', () => {
    const checks = verifyPlanPageOpenings(work, contours.source, contours, planText)
    expect(checks).toEqual(
      fixture.rooms.flatMap((room) =>
        room.openings.map((opening) => ({
          roomSourceNumber: room.roomSourceNumber,
          openingId: opening.id,
          status: 'candidate',
          widthMm: opening.widthMm,
          labelIndex: opening.labelIndex,
        })),
      ),
    )
    expect(
      checks.every(
        (check) => !('offsetMm' in check) && !('heightMm' in check) && !('swing' in check),
      ),
    ).toBe(true)
  })

  it('preserves unknown widths when source text or arrow evidence is missing', () => {
    const absent = verifyPlanPageOpenings(work, contours.source, contours, undefined)
    expect(absent.every((check) => check.status === 'unresolved' && !('widthMm' in check))).toBe(
      true,
    )
    const missingArrow = {
      ...work,
      paths: work.paths.filter((path) => ![1134, 1168].includes(path.operationIndex)),
    }
    expect(
      verifyPlanPageOpenings(missingArrow, contours.source, contours, planText)[0]?.status,
    ).toBe('unresolved')
  })

  it('refuses competing native labels, rather than choosing one plausible number', () => {
    const duplicate = [...labels]
    const label = duplicate[10]
    if (!label) throw new Error('Missing source label')
    duplicate[169] = { ...label }
    expect(
      verifyPlanPageOpenings(work, contours.source, contours, JSON.stringify(duplicate))[0],
    ).toMatchObject({ status: 'ambiguous' })
  })

  it('does not use the other plan state or a modified hash as evidence', () => {
    for (const source of [
      { ...contours.source, state: 'proposed' as const },
      { ...contours.source, sha256: 'a'.repeat(64) },
    ]) {
      expect(
        verifyPlanPageOpenings(work, source, contours, planText).every(
          (check) => check.status !== 'candidate',
        ),
      ).toBe(true)
    }
  })

  it('does not accept dimensions or statuses submitted by a browser inside annotation', () => {
    const input = structuredClone(contours)
    const room = input.rooms[0]
    if (!room?.openings?.[0]) throw new Error('Missing source opening')
    Object.assign(room.openings[0], { widthMm: 3000, labelIndex: 10, status: 'candidate' })
    expect(planPageContoursSchema.safeParse(input).success).toBe(false)
  })
  it('bounds competing labels without truncating them into a false successful width', () => {
    const crowded = [...labels]
    const original = labels[10]
    if (!original) throw new Error('Missing original label')
    for (let index = 150; index < 159; index++) crowded[index] = { ...original }
    expect(
      verifyPlanPageOpenings(work, contours.source, contours, JSON.stringify(crowded))[0],
    ).toMatchObject({ status: 'ambiguous', reason: 'too-many-opening-labels' })
  })

  it('leaves source annotations untouched and does not create layout geometry', () => {
    const before = structuredClone(contours)
    verifyPlanPageOpenings(work, contours.source, contours, planText)
    expect(contours).toEqual(before)
    expect(contours).not.toHaveProperty('geometry')
  })
})
