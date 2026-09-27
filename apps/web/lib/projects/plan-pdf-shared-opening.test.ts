import type { PlanPageContours, PlanPageOpening, PlanPageRoomIdentity } from '@uyut/db'
import { describe, expect, it } from 'vitest'
import page from '../../../../docs/qa/fixtures/apartment-74-77-complete-page.json'
import { verifyPlanPageOpenings } from './plan-page-feature-checks'
import { createPdfOpeningSpanVerifier } from './plan-pdf-dimension-chain'
import type { PdfLinework, PdfVectorPath } from './plan-pdf-linework'
import { pdfRoomAtPoint } from './plan-pdf-room-binding'

function sharedSheet() {
  const contours: PlanPageContours = {
    source: { ...page.source, state: 'existing' },
    coordinateSystem: 'page-0-1000',
    review: 'manual-source-review',
    pageWidth: page.pageWidth,
    pageHeight: page.pageHeight,
    rooms: page.rooms.map((room) => ({
      ...(room.roomSourceNumbers
        ? { roomSourceNumbers: [...room.roomSourceNumbers] }
        : { roomSourceNumber: room.roomSourceNumber as number }),
      polygon: structuredClone(room.polygon),
      openings: room.openings.map((opening) => ({
        id: opening.id,
        kind: opening.kind as PlanPageOpening['kind'],
        wallEdgeIndex: opening.wallEdgeIndex,
        start: { ...opening.start },
        end: { ...opening.end },
        ...('endpointProofs' in opening
          ? { endpointProofs: opening.endpointProofs as PlanPageOpening['endpointProofs'] }
          : {}),
      })),
    })),
  }
  const work: PdfLinework = {
    coordinateSystem: 'page-0-1000',
    pageWidth: page.pageWidth,
    pageHeight: page.pageHeight,
    paths: structuredClone(page.nativePaths) as PdfVectorPath[],
    ...page.nativeLayer,
  }
  const labels = Array.from({ length: 192 }, () => ({ text: '', x: 0, y: 0, rotation: 0 }))
  for (const { index, ...label } of page.nativeLabels) labels[index] = { ...label }
  const group = contours.rooms.find((room) => room.roomSourceNumbers)
  const opening = group?.openings?.find((value) => value.id === 'zone-1-5-to-kitchen')
  const label = page.nativeLabels.find((value) => value.index === 36)
  if (!group || !opening || !label) throw new Error('Incomplete shared-zone source fixture')
  return { contours, work, labels, group, opening, label }
}

const widths = [
  { id: 'zone-1-5-entrance', labelIndex: 21, widthMm: 1048, rail: 1419 },
  { id: 'zone-1-5-to-kitchen', labelIndex: 36, widthMm: 900, rail: 1810 },
  { id: 'zone-1-5-to-living', labelIndex: 29, widthMm: 1300, rail: 1628 },
  { id: 'zone-1-5-to-bedroom-4', labelIndex: 31, widthMm: 896, rail: 1680 },
  { id: 'zone-1-5-to-wc', labelIndex: 78, widthMm: 911, rail: 2919 },
  { id: 'zone-1-5-to-bath', labelIndex: 81, widthMm: 905, rail: 3000 },
]

describe('printed opening dimensions belong to a whole shared physical zone', () => {
  it('checks six source widths with whole-group metadata, without claiming room 1 or 5', () => {
    const { contours, work, labels } = sharedSheet()
    const before = structuredClone(contours)
    const checks = verifyPlanPageOpenings(work, contours.source, contours, JSON.stringify(labels))
    for (const { id, labelIndex, widthMm } of widths) {
      expect(checks.find((value) => value.openingId === id)).toEqual({
        roomSourceNumbers: [1, 5],
        openingId: id,
        status: 'candidate',
        labelIndex,
        widthMm,
      })
    }
    expect(checks.find((value) => value.openingId === 'zone-1-5-to-bedroom-6')).toMatchObject({
      roomSourceNumbers: [1, 5],
      status: 'candidate',
      widthMm: 903,
      labelIndex: 84,
      sameOpeningAs: { roomSourceNumber: 6, openingId: 'room-6-door' },
    })
    expect(contours).toEqual(before)
  })

  it('matches the exact member set independent of member or contour ordering', () => {
    const { contours, work, opening, label } = sharedSheet()
    contours.rooms.reverse()
    const verify = createPdfOpeningSpanVerifier(work, contours.source, contours)
    expect(verify({ roomSourceNumbers: [5, 1] }, label, opening)).toMatchObject({
      status: 'candidate',
      roomSourceNumbers: [1, 5],
      widthMm: 900,
    })
  })

  it.each([
    1,
    5,
    { roomSourceNumber: 1 },
    { roomSourceNumber: 5 },
    { roomSourceNumbers: [1, 6] },
    { roomSourceNumbers: [1, 5, 6] },
    { roomSourceNumbers: [1, 1] },
    { roomSourceNumbers: [1] },
  ] as Array<number | PlanPageRoomIdentity>)(
    'does not substitute incomplete or different identity %j',
    (identity) => {
      const { contours, work, opening, label } = sharedSheet()
      expect(
        createPdfOpeningSpanVerifier(work, contours.source, contours)(identity, label, opening),
      ).toMatchObject({ status: 'unresolved', reason: 'no-annotated-room' })
    },
  )

  it.each(widths)('refuses $id after native dimension rail $rail disappears', ({ id, rail }) => {
    const { contours, work, labels } = sharedSheet()
    work.paths = work.paths.filter((path) => path.operationIndex !== rail)
    const checks = verifyPlanPageOpenings(work, contours.source, contours, JSON.stringify(labels))
    expect(checks.find((value) => value.openingId === id)?.status).toBe('unresolved')
  })

  it('does not borrow the kitchen-side 900 label for the shared side', () => {
    const { contours, work, opening } = sharedSheet()
    const label = page.nativeLabels.find((value) => value.index === 10)
    if (!label) throw new Error('Missing kitchen-side source label')
    expect(
      createPdfOpeningSpanVerifier(work, contours.source, contours)(
        { roomSourceNumbers: [1, 5] },
        label,
        opening,
      ),
    ).toMatchObject({ status: 'unresolved', reason: 'opening-label-outside-room' })
  })

  it('keeps direct group ownership strict even when the exact opposite cut has proof', () => {
    const { contours, work, group } = sharedSheet()
    const opening = group.openings?.find((value) => value.id === 'zone-1-5-to-bedroom-6')
    const label = page.nativeLabels.find((value) => value.index === 84)
    if (!opening || !label) throw new Error('Missing bedroom threshold source')
    expect(
      createPdfOpeningSpanVerifier(work, contours.source, contours)(
        { roomSourceNumbers: [1, 5] },
        label,
        opening,
      ),
    ).toMatchObject({ status: 'unresolved', reason: 'opening-label-outside-room' })
  })

  it.each(['missing-label', 'missing-rail', 'different-cut', 'duplicate-cut'] as const)(
    'does not transfer a bedroom width with %s',
    (mutation) => {
      const { contours, work, labels, group } = sharedSheet()
      const target = group.openings?.find((opening) => opening.id === 'zone-1-5-to-bedroom-6')
      if (!target) throw new Error('Missing shared threshold')
      if (mutation === 'missing-label') labels[84] = { text: '', x: 0, y: 0, rotation: 0 }
      if (mutation === 'missing-rail')
        work.paths = work.paths.filter((path) => path.operationIndex !== 3078)
      if (mutation === 'different-cut') target.end.x += 0.001
      if (mutation === 'duplicate-cut')
        group.openings?.push({ ...structuredClone(target), id: 'duplicate-threshold' })
      const checks = verifyPlanPageOpenings(work, contours.source, contours, JSON.stringify(labels))
      expect(checks.find((value) => value.openingId === target.id)?.status).not.toBe('candidate')
    },
  )

  it('works for other room numbers and contour order without special-casing bedroom 6', () => {
    const { contours, work, labels } = sharedSheet()
    const common = contours.rooms.find((room) => room.roomSourceNumbers)
    const bedroom = contours.rooms.find((room) => room.roomSourceNumber === 6)
    if (!common || !bedroom) throw new Error('Missing two-sided threshold')
    common.roomSourceNumbers = [10, 11]
    bedroom.roomSourceNumber = 12
    contours.rooms.reverse()
    const checks = verifyPlanPageOpenings(work, contours.source, contours, JSON.stringify(labels))
    expect(checks.find((value) => value.openingId === 'zone-1-5-to-bedroom-6')).toMatchObject({
      roomSourceNumbers: [10, 11],
      status: 'candidate',
      widthMm: 903,
      sameOpeningAs: { roomSourceNumber: 12, openingId: 'room-6-door' },
    })
  })

  it('checks every dimension interval, not just its label and midpoint', () => {
    const { contours, work, opening, label } = sharedSheet()
    contours.rooms.push({
      roomSourceNumber: 99,
      polygon: [
        { x: 340, y: 290 },
        { x: 341, y: 290 },
        { x: 341, y: 295 },
        { x: 340, y: 295 },
      ],
    })
    expect(
      createPdfOpeningSpanVerifier(work, contours.source, contours)(
        { roomSourceNumbers: [1, 5] },
        label,
        opening,
      ),
    ).toMatchObject({ status: 'unresolved', reason: 'opening-dimension-outside-room' })
  })

  it('refuses overlapping physical owners and near-boundary labels', () => {
    const { contours, work, group, opening, label } = sharedSheet()
    const nearBoundary = { ...label, y: group.polygon[0]?.y ?? 0 }
    const verify = createPdfOpeningSpanVerifier(work, contours.source, contours)
    expect(verify({ roomSourceNumbers: [1, 5] }, nearBoundary, opening)).toMatchObject({
      status: 'unresolved',
      reason: 'opening-label-outside-room',
    })
    contours.rooms.push({ roomSourceNumber: 99, polygon: structuredClone(group.polygon) })
    expect(
      createPdfOpeningSpanVerifier(work, contours.source, contours)(
        { roomSourceNumbers: [1, 5] },
        label,
        opening,
      ),
    ).toMatchObject({ status: 'unresolved', reason: 'opening-label-outside-room' })
  })

  it('keeps competing source labels ambiguous for shared zones too', () => {
    const { contours, work, labels, label } = sharedSheet()
    labels.push({ text: label.text, x: label.x, y: label.y, rotation: label.rotation })
    const checks = verifyPlanPageOpenings(work, contours.source, contours, JSON.stringify(labels))
    expect(checks.find((value) => value.openingId === 'zone-1-5-to-kitchen')).toMatchObject({
      status: 'ambiguous',
      reason: 'competing-opening-dimensions',
    })
  })

  it('does not reuse grouped proof from another file or another plan state', () => {
    const { contours, work, opening, label } = sharedSheet()
    for (const source of [
      { ...contours.source, sha256: 'a'.repeat(64) },
      { ...contours.source, state: 'proposed' as const },
    ]) {
      expect(
        createPdfOpeningSpanVerifier(work, source, contours)(
          { roomSourceNumbers: [1, 5] },
          label,
          opening,
        ),
      ).toMatchObject({ status: 'unresolved', reason: 'different-plan-source' })
    }
  })

  it('leaves legacy single-room ownership ambiguous for grouped areas', () => {
    const { contours, work, label } = sharedSheet()
    expect(pdfRoomAtPoint(work, contours.source, contours, label)).toMatchObject({
      status: 'ambiguous',
      reason: 'shared-room-zone',
    })
  })
})
