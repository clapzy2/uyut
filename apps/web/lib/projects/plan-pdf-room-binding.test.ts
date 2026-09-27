import { describe, expect, it } from 'vitest'
import native from '../../../../docs/qa/fixtures/apartment-74-77-native-leaders.json'
import annotated from '../../../../docs/qa/fixtures/apartment-74-77-page-contours.json'
import { pdfCalloutLeader } from './plan-pdf-leaders'
import type { PdfLinework, PdfVectorPath } from './plan-pdf-linework'
import { type PdfRoomContours, pdfRoomAtPoint } from './plan-pdf-room-binding'

const contours = annotated as PdfRoomContours
const work: PdfLinework = {
  coordinateSystem: 'page-0-1000',
  pageWidth: annotated.pageWidth,
  pageHeight: annotated.pageHeight,
  paths: native.paths as PdfVectorPath[],
  skippedCurves: 0,
  unsupportedPaths: 0,
  unsupportedContexts: 0,
  clippedPaths: 0,
  truncated: false,
}
const source = contours.source
const point = { x: 767.134, y: 225.308 }
const bedroom = contours.rooms[0]
if (!bedroom) throw new Error('Missing bedroom contour')

describe('candidate ownership against manually reviewed page contours', () => {
  it.each([
    [{ x: 672, y: 262 }, 4],
    [{ x: 526, y: 643 }, 6],
  ] as const)(
    'binds a connected ceiling arrow to bedroom %i even when the label is outside',
    (label, number) => {
      const leader = pdfCalloutLeader(work, label)
      expect(leader.status).toBe('candidate')
      if (leader.status !== 'candidate') throw new Error('Expected native leader')
      expect(pdfRoomAtPoint(work, source, contours, leader.arrow.tip)).toEqual({
        status: 'candidate',
        roomSourceNumber: number,
        basis: 'manual-page-contour',
      })
    },
  )
  it.each([
    { x: 691.008, y: 483.823 },
    { x: 525.277, y: 364.801 },
  ])('does not choose the nearest bedroom for an unannotated shared zone %j', (p) => {
    expect(pdfRoomAtPoint(work, source, contours, p)).toMatchObject({
      status: 'unresolved',
      roomSourceNumber: null,
      reason: 'no-annotated-room',
    })
  })
  it.each([
    { x: 643.528, y: 225 },
    { x: 643.8, y: 225 },
    { x: 844.512, y: 82.328 },
  ])('does not assign an arrow on or near a wall %j', (p) => {
    expect(pdfRoomAtPoint(work, source, contours, p).status).toBe('ambiguous')
  })
  it('does not choose the first overlapping room', () => {
    const rooms = [{ ...bedroom, roomSourceNumber: 10 }, ...contours.rooms]
    expect(pdfRoomAtPoint(work, source, { ...contours, rooms }, point)).toMatchObject({
      reason: 'overlapping-room-contours',
      status: 'ambiguous',
    })
  })
  it.each([
    { pdfPage: 12 },
    { state: 'proposed' as const },
    { sha256: 'a'.repeat(64) },
    { pdfPage: 0 },
  ])('does not mix another page, file or project state %j', (change) => {
    expect(pdfRoomAtPoint(work, { ...source, ...change }, contours, point)).toMatchObject({
      status: 'unresolved',
      reason: 'different-plan-source',
    })
  })
  it('does not silently accept a different page format', () => {
    expect(pdfRoomAtPoint({ ...work, pageWidth: 1191 }, source, contours, point).status).toBe(
      'unresolved',
    )
  })
  it('does not reinterpret local mm as page coordinates', () => {
    const wrong = { ...contours, coordinateSystem: 'room-mm' } as unknown as PdfRoomContours
    expect(pdfRoomAtPoint(work, source, wrong, point)).toMatchObject({
      reason: 'unreviewed-coordinate-space',
    })
  })
  it.each(
    [
      [
        { x: 1, y: 1 },
        { x: 5, y: 5 },
      ],
      [
        { x: 1, y: 1 },
        { x: 5, y: 5 },
        { x: 1, y: 5 },
        { x: 5, y: 1 },
      ],
      [
        { x: 1, y: 1 },
        { x: 5, y: 1 },
        { x: 1, y: 1 },
        { x: 1, y: 5 },
      ],
      [
        { x: 1, y: 1 },
        { x: 5, y: 1 },
        { x: Number.NaN, y: 5 },
      ],
      [
        { x: 1, y: 1 },
        { x: 2985, y: 1 },
        { x: 1, y: 5156 },
      ],
      [
        { x: 1, y: 1 },
        { x: 5, y: 5 },
        { x: 9, y: 9 },
      ],
    ].map((polygon) => ({ polygon })),
  )('rejects damaged / self-crossing / mm polygons without repairing vertices', ({ polygon }) => {
    const rooms = [{ roomSourceNumber: 4, polygon }]
    expect(pdfRoomAtPoint(work, source, { ...contours, rooms }, point)).toMatchObject({
      reason: 'invalid-room-contours',
    })
  })
  it('rejects duplicate printed room numbers', () => {
    expect(
      pdfRoomAtPoint(work, source, { ...contours, rooms: [...contours.rooms, bedroom] }, point)
        .status,
    ).toBe('unresolved')
  })
  it('respects a concave contour instead of its bounding box', () => {
    const rooms = [
      {
        roomSourceNumber: 4,
        polygon: [
          { x: 100, y: 100 },
          { x: 500, y: 100 },
          { x: 500, y: 500 },
          { x: 300, y: 500 },
          { x: 300, y: 300 },
          { x: 100, y: 300 },
        ],
      },
    ]
    expect(pdfRoomAtPoint(work, source, { ...contours, rooms }, { x: 200, y: 400 }).status).toBe(
      'unresolved',
    )
    expect(pdfRoomAtPoint(work, source, { ...contours, rooms }, { x: 400, y: 400 }).status).toBe(
      'candidate',
    )
  })
  it.each([{ truncated: true }, { unsupportedContexts: 1 }, { unsupportedPaths: 1 }])(
    'rejects incomplete linework %j',
    (change) => {
      expect(pdfRoomAtPoint({ ...work, ...change }, source, contours, point)).toMatchObject({
        reason: 'incomplete-vector-layer',
      })
    },
  )
})
