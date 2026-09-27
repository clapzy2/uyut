import type { PlanPageContours } from '@uyut/db'
import { describe, expect, it } from 'vitest'
import page from '../../../../docs/qa/fixtures/apartment-74-77-complete-page.json'
import { planPageContoursSchema } from './plan-page-review'
import type { PdfLinework, PdfVectorPath } from './plan-pdf-linework'
import { classifyPlanPageWallSpans } from './plan-pdf-wall-coverage'
import { type PdfWallFacePair, pairPlanPageWallFaces } from './plan-pdf-wall-faces'

const source = { sha256: 'a'.repeat(64), pdfPage: 1, state: 'existing' as const }

function rectangle(left: number, top: number, right: number, bottom: number) {
  return [
    { x: left, y: top },
    { x: right, y: top },
    { x: right, y: bottom },
    { x: left, y: bottom },
  ]
}

function sample() {
  const contours: PlanPageContours = {
    source,
    coordinateSystem: 'page-0-1000',
    review: 'manual-source-review',
    pageWidth: 1000,
    pageHeight: 1000,
    rooms: [
      {
        roomSourceNumber: 1,
        polygon: rectangle(100, 100, 200, 200),
        openings: [
          {
            id: 'door',
            kind: 'door',
            wallEdgeIndex: 1,
            start: { x: 200, y: 120 },
            end: { x: 200, y: 140 },
          },
        ],
      },
      { roomSourceNumber: 2, polygon: rectangle(220, 100, 320, 200) },
    ],
  }
  const pair: PdfWallFacePair = {
    faces: [
      {
        contourKey: '1',
        wallEdgeIndex: 1,
        start: { x: 200, y: 160 },
        end: { x: 200, y: 180 },
        nativeSegment: { operationIndex: 1, subpathIndex: 0, segmentIndex: 0 },
      },
      {
        contourKey: '2',
        wallEdgeIndex: 3,
        start: { x: 220, y: 160 },
        end: { x: 220, y: 180 },
        nativeSegment: { operationIndex: 1, subpathIndex: 0, segmentIndex: 1 },
      },
    ],
  }
  return { contours, pair }
}

describe('diagnostic coverage of annotated PDF boundary spans', () => {
  it('distinguishes gaps, declared openings and local pairs without filling missing segments', () => {
    const { contours, pair } = sample()
    const before = structuredClone(contours)
    const spans = classifyPlanPageWallSpans(contours, [pair]).filter(
      (span) => span.contourKey === '1' && span.wallEdgeIndex === 1,
    )
    expect(spans.map(({ start, end, status }) => [start.y, end.y, status])).toEqual([
      [100, 120, 'unmatched'],
      [120, 140, 'opening'],
      [140, 160, 'unmatched'],
      [160, 180, 'paired'],
      [180, 200, 'unmatched'],
    ])
    expect(contours).toEqual(before)
  })

  it('marks competing proofs or a pair crossing an opening as ambiguous', () => {
    const { contours, pair } = sample()
    const overlapping = structuredClone(pair)
    overlapping.faces[0].start.y = 120
    overlapping.faces[0].end.y = 170
    overlapping.faces[1].start.y = 120
    overlapping.faces[1].end.y = 170
    const spans = classifyPlanPageWallSpans(contours, [pair, overlapping]).filter(
      (span) => span.contourKey === '1' && span.wallEdgeIndex === 1,
    )
    expect(spans.map(({ start, end, status }) => [start.y, end.y, status])).toContainEqual([
      120,
      140,
      'ambiguous',
    ])
    expect(spans.map(({ start, end, status }) => [start.y, end.y, status])).toContainEqual([
      160,
      170,
      'ambiguous',
    ])
  })

  it('keeps diagonal edges explicitly unsupported rather than projecting them', () => {
    const { contours } = sample()
    const room = contours.rooms[0]
    if (!room) throw new Error('Missing room')
    room.polygon[0] = { x: 110, y: 100 }
    const spans = classifyPlanPageWallSpans(contours, []).filter(
      (span) => span.contourKey === '1' && span.wallEdgeIndex === 3,
    )
    expect(spans).toHaveLength(1)
    expect(spans[0]).toMatchObject({ status: 'unsupported-angle' })
  })

  it('reports current fixture boundaries as local evidence, not a complete wall model', () => {
    const currentSource = {
      sha256: page.source.sha256,
      pdfPage: page.source.pdfPage,
      state: 'existing' as const,
    }
    const contours = planPageContoursSchema.parse({
      source: currentSource,
      coordinateSystem: 'page-0-1000',
      review: 'manual-source-review',
      pageWidth: page.pageWidth,
      pageHeight: page.pageHeight,
      exterior: { polygon: structuredClone(page.apartmentEnvelope.polygon) },
      rooms: page.rooms.map((room) => ({
        ...(room.roomSourceNumbers
          ? { roomSourceNumbers: [...room.roomSourceNumbers] }
          : { roomSourceNumber: room.roomSourceNumber as number }),
        polygon: structuredClone(room.polygon),
        openings: room.openings.map((opening) => ({
          id: opening.id,
          kind: opening.kind as 'door' | 'window' | 'balcony',
          wallEdgeIndex: opening.wallEdgeIndex,
          start: { ...opening.start },
          end: { ...opening.end },
          ...('endpointProofs' in opening ? { endpointProofs: opening.endpointProofs } : {}),
        })),
      })),
    })
    const work: PdfLinework = {
      coordinateSystem: 'page-0-1000',
      pageWidth: page.pageWidth,
      pageHeight: page.pageHeight,
      paths: structuredClone(page.nativePaths) as PdfVectorPath[],
      ...page.nativeLayer,
    }
    const before = structuredClone(contours)
    const pairs = pairPlanPageWallFaces(work, currentSource, contours)
    const counts = classifyPlanPageWallSpans(contours, pairs).reduce<Record<string, number>>(
      (total, { status }) => {
        total[status] = (total[status] ?? 0) + 1
        return total
      },
      {},
    )
    expect(pairs).toHaveLength(51)
    expect(counts).toEqual({ paired: 102, opening: 19, unmatched: 38, 'unsupported-angle': 3 })
    expect(contours).toEqual(before)
  })
})
