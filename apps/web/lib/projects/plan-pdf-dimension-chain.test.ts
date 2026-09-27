import { describe, expect, it } from 'vitest'
import nativeLabels from '../../../../docs/qa/fixtures/apartment-74-77-native-labels.json'
import annotated from '../../../../docs/qa/fixtures/apartment-74-77-page-contours.json'
import { pdfWidthChain } from './plan-pdf-dimension-chain'
import type { PdfLinework, PdfVectorPath } from './plan-pdf-linework'
import type { PdfRoomContours } from './plan-pdf-room-binding'

const contours = annotated as PdfRoomContours
const work: PdfLinework = {
  coordinateSystem: 'page-0-1000',
  pageWidth: 842,
  pageHeight: 1191,
  paths: annotated.dimensionPaths as PdfVectorPath[],
  skippedCurves: 0,
  unsupportedPaths: 0,
  unsupportedContexts: 0,
  clippedPaths: 0,
  truncated: false,
}
const labelsFor = (number: number) => {
  const room = annotated.rooms.find((r) => r.roomSourceNumber === number)
  if (!room) throw new Error('Missing annotated room')
  return room.widthLabels.map((index) => {
    const label = nativeLabels.items.find((l) => l.index === index)
    if (!label) throw new Error('Missing native label')
    return { ...label }
  })
}
const labels = labelsFor(4)
const [firstLabel, middleLabel, lastLabel] = labels
const bedroom = contours.rooms[0]
const otherBedroom = contours.rooms[1]
const firstCorner = bedroom?.polygon[0]
const firstLine = work.paths[0]
if (
  !firstLabel ||
  !middleLabel ||
  !lastLabel ||
  !bedroom ||
  !otherBedroom ||
  !firstCorner ||
  !firstLine
)
  throw new Error('Incomplete dimension fixture')
const check = (
  paths: PdfVectorPath[] = work.paths,
  input = labels,
  total = 2985,
  rooms = contours.rooms,
) => pdfWidthChain({ ...work, paths }, contours.source, { ...contours, rooms }, 4, input, total)

describe('native horizontal dimension chains against page contours', () => {
  it.each([
    [4, 2985, [2310, 2338, 2364]],
    [6, 2945, [3159, 3133, 3185]],
  ] as const)(
    'verifies printed width of bedroom %i without deriving mm from page scale',
    (number, totalMm, operations) => {
      expect(
        pdfWidthChain(work, contours.source, contours, number, labelsFor(number), totalMm),
      ).toMatchObject({
        status: 'candidate',
        roomSourceNumber: number,
        totalMm,
        lineOperations: operations,
      })
    },
  )
  it('sorts spatially rather than using text extraction order', () => {
    expect(check(work.paths, [...labels].reverse())).toMatchObject({
      status: 'candidate',
      labelIndexes: [55, 56, 57],
    })
  })
  it('does not fit a bedroom 4 chain to bedroom 6 even with its original correct sum', () => {
    expect(pdfWidthChain(work, contours.source, contours, 6, labels, 2985)).toMatchObject({
      status: 'unresolved',
      reason: 'dimension-outside-room',
    })
  })
  it.each([2310, 2314, 2319])('does not bridge a missing stem or arrow %i', (operation) => {
    expect(check(work.paths.filter((p) => p.operationIndex !== operation)).status).toBe(
      'unresolved',
    )
  })
  it('does not choose one of two connected dimension lines', () => {
    const duplicate = { ...firstLine, operationIndex: 9000 }
    expect(check([...work.paths, duplicate])).toMatchObject({
      status: 'ambiguous',
      reason: 'multiple-dimension-lines',
    })
  })
  it('does not choose one of two arrowheads connected at the same base', () => {
    const arrow = work.paths.find((p) => p.operationIndex === 2314)
    if (!arrow) throw new Error('Missing arrow')
    expect(check([...work.paths, { ...arrow, operationIndex: 9001 }]).status).toBe('ambiguous')
  })
  it('does not ignore a branch at an arrow base', () => {
    const branch: PdfVectorPath = {
      operationIndex: 9002,
      subpathIndex: 0,
      closed: false,
      paint: 'stroke',
      points: [
        { x: 648.577, y: 96.555 },
        { x: 648.577, y: 120 },
      ],
    }
    expect(check([...work.paths, branch])).toMatchObject({
      status: 'ambiguous',
      reason: 'branched-dimension-line',
    })
  })
  it('does not connect an interior crossing as an endpoint branch', () => {
    const crossing: PdfVectorPath = {
      operationIndex: 9003,
      subpathIndex: 0,
      closed: false,
      paint: 'stroke',
      points: [
        { x: 660, y: 90 },
        { x: 660, y: 120 },
      ],
    }
    expect(check([...work.paths, crossing]).status).toBe('candidate')
  })
  it('does not turn a window segment into full room width', () => {
    expect(check(work.paths, [middleLabel], 1344)).toMatchObject({
      reason: 'dimension-does-not-span-room',
    })
  })
  it('rejects a correct arithmetic sum assembled from disconnected intervals', () => {
    const selected = [firstLabel, lastLabel]
    expect(check(work.paths, selected, 1641)).toMatchObject({
      reason: 'disconnected-dimension-chain',
    })
  })
  it('rejects a different arithmetic sum', () => {
    expect(check(work.paths, labels, 3000)).toMatchObject({ reason: 'dimension-sum-conflict' })
  })
  it('does not reuse the same label index', () => {
    expect(check(work.paths, [firstLabel, firstLabel], 1878)).toMatchObject({
      reason: 'invalid-dimension-labels',
    })
  })
  it.each([{ rotation: 90 }, { text: 'h-939' }, { x: Number.NaN }, { index: -1 }, { text: '0' }])(
    'rejects unsupported or invalid label %j',
    (change) => {
      expect(check(work.paths, [{ ...firstLabel, ...change }, ...labels.slice(1)]).status).toBe(
        'unresolved',
      )
    },
  )
  it('does not choose a nearby row outside the bounded label-to-line gap', () => {
    expect(
      check(
        work.paths,
        labels.map((label) => ({ ...label, y: 85 })),
      ).status,
    ).toBe('unresolved')
  })
  it('does not accept a notch between segment midpoints', () => {
    const room = bedroom
    const polygon = [
      firstCorner,
      { x: 730, y: 82.328 },
      { x: 730, y: 110 },
      { x: 735, y: 110 },
      { x: 735, y: 82.328 },
      ...room.polygon.slice(1),
    ]
    expect(check(work.paths, labels, 2985, [{ ...room, polygon }, otherBedroom])).toMatchObject({
      reason: 'dimension-outside-room',
    })
  })
  it('does not silently scale a source contour to make dimension tips fit', () => {
    const rooms = contours.rooms.map((room) => ({
      ...room,
      polygon: room.polygon.map((p) => ({ ...p, x: p.x - 2 })),
    }))
    expect(check(work.paths, labels, 2985, rooms)).toMatchObject({
      reason: 'dimension-does-not-span-room',
    })
  })
  it('refuses another source state', () => {
    expect(
      pdfWidthChain(work, { ...contours.source, state: 'proposed' }, contours, 4, labels, 2985),
    ).toMatchObject({ reason: 'different-plan-source' })
  })
})
