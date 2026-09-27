import { describe, expect, it } from 'vitest'
import nativeLabels from '../../../../docs/qa/fixtures/apartment-74-77-native-labels.json'
import annotated from '../../../../docs/qa/fixtures/apartment-74-77-page-contours.json'
import nativeFeatures from '../../../../docs/qa/fixtures/apartment-74-77-page-features.json'
import {
  createPdfOpeningSpanVerifier,
  type PdfOpeningAnnotation,
  pdfDepthChain,
  pdfOpeningFromNativeSpan,
  pdfOpeningFromWidthChain,
  pdfWidthChain,
} from './plan-pdf-dimension-chain'
import type { PdfLinework, PdfVectorPath } from './plan-pdf-linework'
import { type PdfRoomContours, pdfRoomAtPoint } from './plan-pdf-room-binding'

const contours: PdfRoomContours = {
  ...annotated,
  source: { ...annotated.source, state: 'existing' },
  coordinateSystem: 'page-0-1000',
  review: 'manual-source-review',
  rooms: annotated.rooms.map((room) => ({
    roomSourceNumber: room.roomSourceNumber,
    polygon: room.polygon,
  })),
}
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
const labelsFor = (number: number, axis: 'width' | 'depth' = 'width') => {
  const room = annotated.rooms.find((r) => r.roomSourceNumber === number)
  if (!room) throw new Error('Missing annotated room')
  return (axis === 'width' ? room.widthLabels : room.depthLabels).map((index) => {
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
const firstLine = work.paths.find((path) => path.operationIndex === 2310)
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
    [2, 2964, [1050, 1367, 1078, 1104]],
    [3, 3389, [1894, 1920, 1946, 1972, 1998]],
  ] as const)(
    'verifies printed width of room %i without deriving mm from page scale',
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

describe('individual native opening spans', () => {
  const spanContours: PdfRoomContours = {
    source: contours.source,
    coordinateSystem: 'page-0-1000',
    review: 'manual-source-review',
    pageWidth: 1000,
    pageHeight: 1000,
    rooms: [
      {
        roomSourceNumber: 1,
        polygon: [
          { x: 100, y: 100 },
          { x: 400, y: 100 },
          { x: 400, y: 400 },
          { x: 100, y: 400 },
        ],
      },
    ],
  }
  const spanPaths: PdfVectorPath[] = [
    {
      operationIndex: 1,
      subpathIndex: 0,
      closed: false,
      paint: 'stroke',
      points: [
        { x: 204, y: 390 },
        { x: 296, y: 390 },
      ],
    },
    {
      operationIndex: 2,
      subpathIndex: 0,
      closed: true,
      paint: 'fill',
      points: [
        { x: 200, y: 390 },
        { x: 204, y: 389.5 },
        { x: 204, y: 390.5 },
      ],
    },
    {
      operationIndex: 3,
      subpathIndex: 0,
      closed: true,
      paint: 'fill',
      points: [
        { x: 300, y: 390 },
        { x: 296, y: 389.5 },
        { x: 296, y: 390.5 },
      ],
    },
    {
      operationIndex: 4,
      subpathIndex: 0,
      closed: false,
      paint: 'stroke',
      points: [
        { x: 200, y: 400 },
        { x: 200, y: 420 },
      ],
    },
    {
      operationIndex: 5,
      subpathIndex: 0,
      closed: false,
      paint: 'stroke',
      points: [
        { x: 300, y: 400 },
        { x: 300, y: 420 },
      ],
    },
  ]
  const spanWork = { ...work, pageWidth: 1000, pageHeight: 1000, paths: spanPaths }
  const spanLabel = { index: 1, text: '905', x: 250, y: 388, rotation: 0 }
  const opening = {
    id: 'door-1',
    kind: 'door' as const,
    wallEdgeIndex: 2,
    start: { x: 200, y: 400 },
    end: { x: 300, y: 400 },
  }
  const checkSpan = (
    annotation = opening,
    paths = spanPaths,
    label = spanLabel,
    reviewed = spanContours,
  ) =>
    pdfOpeningFromNativeSpan(
      { ...spanWork, paths },
      contours.source,
      reviewed,
      1,
      label,
      annotation,
    )

  it.each(['door', 'window', 'balcony'] as const)(
    'accepts a manually classified partial %s span without deriving dimensions from scale',
    (kind) => {
      const result = checkSpan({ ...opening, kind } as typeof opening)
      expect(result).toMatchObject({
        status: 'candidate',
        roomSourceNumber: 1,
        kind,
        widthMm: 905,
        axis: 'width',
        start: opening.start,
        end: opening.end,
      })
      for (const property of ['offsetMm', 'heightMm', 'sillHeightMm', 'swing', 'geometry'])
        expect(result).not.toHaveProperty(property)
    },
  )
  it('keeps printed 905 mm even though the page span is 100 PDF points', () => {
    expect(checkSpan()).toMatchObject({ status: 'candidate', widthMm: 905 })
  })
  it('accepts a vertical partial span using a rotated printed width', () => {
    const swap = (point: { x: number; y: number }) => ({ x: point.y, y: point.x })
    const result = checkSpan(
      { ...opening, wallEdgeIndex: 1, start: swap(opening.start), end: swap(opening.end) },
      spanPaths.map((path) => ({ ...path, points: path.points.map(swap) })),
      { ...spanLabel, ...swap(spanLabel), rotation: 90 },
    )
    expect(result).toMatchObject({ status: 'candidate', widthMm: 905, axis: 'depth' })
  })
  it('sorts reversed manually selected jambs along the declared wall', () => {
    expect(checkSpan({ ...opening, start: opening.end, end: opening.start })).toMatchObject({
      status: 'candidate',
      start: opening.start,
      end: opening.end,
    })
  })
  it('refuses a free endpoint, even if only 0.01 PDF points from a native jamb', () => {
    expect(checkSpan({ ...opening, start: { ...opening.start, x: 200.01 } })).toMatchObject({
      reason: 'non-native-opening-endpoint',
    })
  })
  it('refuses an endpoint on a different wall face', () => {
    expect(checkSpan({ ...opening, start: { x: 200, y: 420 } })).toMatchObject({
      reason: 'opening-span-not-on-declared-edge',
    })
  })
  it.each([1, 2, 3])('refuses a missing stem or arrow operation %i', (operation) => {
    expect(
      checkSpan(
        opening,
        spanPaths.filter((path) => path.operationIndex !== operation),
      ),
    ).toMatchObject({
      status: 'unresolved',
      reason: 'no-connected-opening-dimension',
    })
  })
  it.each([{ rotation: 90 }, { text: 'h-905' }, { text: '0' }, { index: -1 }, { x: Number.NaN }])(
    'refuses an invalid printed label %j',
    (change) => {
      expect(checkSpan(opening, spanPaths, { ...spanLabel, ...change })).toMatchObject({
        reason: 'invalid-dimension-labels',
      })
    },
  )
  it('refuses a nearby number outside the annotated room', () => {
    expect(checkSpan(opening, spanPaths, { ...spanLabel, y: 425 })).toMatchObject({
      reason: 'opening-label-outside-room',
    })
  })
  it('refuses a printed span not aligned with both jamb coordinates', () => {
    const shifted = spanPaths.map((path) =>
      path.operationIndex <= 3
        ? { ...path, points: path.points.map((point) => ({ ...point, x: point.x + 0.13 })) }
        : path,
    )
    expect(checkSpan(opening, shifted)).toMatchObject({ reason: 'no-connected-opening-dimension' })
  })
  it('does not choose duplicate native stems or competing opposing arrows', () => {
    for (const operation of [1, 2]) {
      const duplicate = spanPaths.find((path) => path.operationIndex === operation)
      if (!duplicate) throw new Error('Missing synthetic span path')
      expect(
        checkSpan(opening, [
          ...spanPaths,
          {
            ...duplicate,
            operationIndex: 99,
            points: duplicate.points.map((point) => ({
              ...point,
              x: point.x + (operation === 2 ? 0.05 : 0),
            })),
          },
        ]),
      ).toMatchObject({
        status: 'ambiguous',
        reason: operation === 1 ? 'multiple-dimension-lines' : 'branched-dimension-line',
      })
    }
  })
  it('collapses only exact repeated arrow paint in the individual-span proof', () => {
    const duplicate = spanPaths.find((path) => path.operationIndex === 2)
    if (!duplicate) throw new Error('Missing synthetic arrow')
    expect(checkSpan(opening, [...spanPaths, { ...duplicate, operationIndex: 99 }])).toMatchObject({
      status: 'candidate',
      widthMm: 905,
    })
  })
  it('fails closed on many distinct arrowheads without enumerating their endpoint pairings', () => {
    const left = spanPaths.find((path) => path.operationIndex === 2)
    const right = spanPaths.find((path) => path.operationIndex === 3)
    if (!left || !right) throw new Error('Missing synthetic opposing arrowheads')
    const competing = Array.from({ length: 1000 }, (_, index) => {
      const halfHeight = 0.2 + index * 0.0004
      return [left, right].map((arrow, side) => ({
        ...arrow,
        operationIndex: 100 + index * 2 + side,
        points: arrow.points.map((point, pointIndex) => ({
          ...point,
          y: pointIndex === 0 ? 390 : 390 + (pointIndex === 1 ? -halfHeight : halfHeight),
        })),
      }))
    }).flat()
    const paths = [
      ...spanPaths.filter((path) => path.operationIndex !== 2 && path.operationIndex !== 3),
      ...competing,
    ]
    const verify = createPdfOpeningSpanVerifier(
      { ...spanWork, paths },
      spanContours.source,
      spanContours,
    )
    expect(verify(1, spanLabel, opening)).toMatchObject({
      status: 'ambiguous',
      reason: 'branched-dimension-line',
    })
    expect(verify(1, spanLabel, opening)).toMatchObject({ status: 'ambiguous' })
  })
  it('ignores only a provably collinear native retrace wholly inside the selected rail', () => {
    const retrace: PdfVectorPath = {
      operationIndex: 99,
      subpathIndex: 0,
      closed: false,
      paint: 'stroke',
      points: [
        { x: 204, y: 390 },
        { x: 210, y: 390 },
      ],
    }
    expect(checkSpan(opening, [...spanPaths, retrace])).toMatchObject({ status: 'candidate' })
    for (const end of [
      { x: 200, y: 390 },
      { x: 210, y: 390.001 },
    ]) {
      expect(
        checkSpan(opening, [...spanPaths, { ...retrace, points: [{ x: 204, y: 390 }, end] }]),
      ).toMatchObject({
        status: 'ambiguous',
        reason: 'branched-dimension-line',
      })
    }
  })
  it('does not ignore a stem endpoint branch', () => {
    const branch: PdfVectorPath = {
      operationIndex: 99,
      subpathIndex: 0,
      closed: false,
      paint: 'stroke',
      points: [
        { x: 204, y: 390 },
        { x: 204, y: 380 },
      ],
    }
    expect(checkSpan(opening, [...spanPaths, branch])).toMatchObject({
      status: 'ambiguous',
      reason: 'branched-dimension-line',
    })
  })
  it('does not project an opposite wall span onto the declared wall', () => {
    const shifted = spanPaths.map((path) =>
      path.operationIndex <= 3
        ? { ...path, points: path.points.map((point) => ({ ...point, y: point.y - 270 })) }
        : path,
    )
    expect(checkSpan(opening, shifted, { ...spanLabel, y: 118 })).toMatchObject({
      reason: 'opening-edge-not-near-dimension',
    })
  })
  it('does not choose equidistant parallel wall edges', () => {
    const centered = spanPaths.map((path) =>
      path.operationIndex <= 3
        ? { ...path, points: path.points.map((point) => ({ ...point, y: point.y - 140 })) }
        : path,
    )
    expect(checkSpan(opening, centered, { ...spanLabel, y: 248 })).toMatchObject({
      status: 'ambiguous',
      reason: 'opening-edge-equidistant',
    })
  })
  it('does not bridge a narrow concavity between the label and span midpoint', () => {
    const notched: PdfRoomContours = {
      ...spanContours,
      rooms: [
        {
          roomSourceNumber: 1,
          polygon: [
            { x: 100, y: 100 },
            { x: 210, y: 100 },
            { x: 210, y: 395 },
            { x: 215, y: 395 },
            { x: 215, y: 100 },
            { x: 400, y: 100 },
            { x: 400, y: 400 },
            { x: 100, y: 400 },
          ],
        },
      ],
    }
    expect(
      checkSpan({ ...opening, wallEdgeIndex: 6 }, spanPaths, spanLabel, notched),
    ).toMatchObject({
      status: 'unresolved',
      reason: 'opening-dimension-outside-room',
    })
  })
  it('refuses incomplete or another-state vectors', () => {
    expect(
      pdfOpeningFromNativeSpan(
        { ...spanWork, truncated: true },
        contours.source,
        spanContours,
        1,
        spanLabel,
        opening,
      ),
    ).toMatchObject({ reason: 'incomplete-vector-layer' })
    expect(
      checkSpan(opening, spanPaths, spanLabel, {
        ...spanContours,
        source: { ...contours.source, state: 'proposed' },
      }),
    ).toMatchObject({ reason: 'different-plan-source' })
  })
})

describe('native vertical dimension chains and nonrectangular rooms', () => {
  const depthLabels = labelsFor(2, 'depth')
  const checkDepth = (paths = work.paths, input = depthLabels, total = 4205) =>
    pdfDepthChain({ ...work, paths }, contours.source, contours, 2, input, total)

  it.each([
    [2, 4205, [1289, 1315]],
    [3, 5158, [2128]],
    [4, 5156, [2497]],
    [6, 4154, [3237]],
  ] as const)('verifies printed depth of room %i', (number, totalMm, operations) => {
    expect(
      pdfDepthChain(work, contours.source, contours, number, labelsFor(number, 'depth'), totalMm),
    ).toMatchObject({
      status: 'candidate',
      axis: 'depth',
      roomSourceNumber: number,
      totalMm,
      lineOperations: operations,
    })
  })
  it('keeps both kitchen intervals, including the projection depth', () => {
    expect(checkDepth(work.paths, [...depthLabels].reverse())).toMatchObject({
      status: 'candidate',
      labelIndexes: [16, 17],
      segments: [
        { labelIndex: 16, valueMm: 3718 },
        { labelIndex: 17, valueMm: 487 },
      ],
    })
  })
  it.each([1289, 1293, 1298, 1315, 1319, 1324])(
    'does not reconstruct missing vertical stem/arrow %i',
    (operation) => {
      expect(
        checkDepth(work.paths.filter((path) => path.operationIndex !== operation)).status,
      ).toBe('unresolved')
    },
  )
  it.each([0, -90, 89])('does not treat rotation %i as a supported depth label', (rotation) => {
    expect(
      checkDepth(
        work.paths,
        depthLabels.map((label) => ({ ...label, rotation })),
      ),
    ).toMatchObject({ reason: 'invalid-dimension-labels' })
  })
  it('rejects another room depth even when its arithmetic is correct', () => {
    expect(
      pdfDepthChain(work, contours.source, contours, 3, labelsFor(4, 'depth'), 5156),
    ).toMatchObject({ reason: 'dimension-outside-room' })
  })
  it('does not replace full kitchen depth with a single partial interval', () => {
    expect(checkDepth(work.paths, depthLabels.slice(0, 1), 3718)).toMatchObject({
      reason: 'dimension-does-not-span-room',
    })
  })
  it('rejects a contradictory depth total', () => {
    expect(checkDepth(work.paths, depthLabels, 4200)).toMatchObject({
      reason: 'dimension-sum-conflict',
    })
  })
  it('does not choose one of two vertical dimension lines', () => {
    const line = work.paths.find((path) => path.operationIndex === 1289)
    if (!line) throw new Error('Missing vertical line')
    expect(checkDepth([...work.paths, { ...line, operationIndex: 9100 }])).toMatchObject({
      status: 'ambiguous',
      reason: 'multiple-dimension-lines',
    })
  })
  it('rejects a vertical endpoint branch', () => {
    const line = work.paths.find((path) => path.operationIndex === 1289)
    const point = line?.points[0]
    if (!point) throw new Error('Missing vertical endpoint')
    const branch: PdfVectorPath = {
      operationIndex: 9101,
      subpathIndex: 0,
      closed: false,
      paint: 'stroke',
      points: [point, { x: point.x + 10, y: point.y }],
    }
    expect(checkDepth([...work.paths, branch])).toMatchObject({
      status: 'ambiguous',
      reason: 'branched-dimension-line',
    })
  })
  it('does not use a diagonal stem as a vertical dimension', () => {
    const paths = work.paths.map((path) =>
      path.operationIndex === 1289
        ? { ...path, points: path.points.map((point, index) => ({ ...point, x: point.x + index })) }
        : path,
    )
    expect(checkDepth(paths).status).toBe('unresolved')
  })
  it.each([
    [{ x: 210, y: 270 }, 'unresolved', null],
    [{ x: 230, y: 270 }, 'candidate', 2],
    [{ x: 425, y: 315 }, 'unresolved', null],
    [{ x: 490, y: 315 }, 'candidate', 3],
  ] as const)(
    'preserves the kitchen notch and living room slant at %j',
    (point, status, number) => {
      expect(pdfRoomAtPoint(work, contours.source, contours, point)).toMatchObject({
        status,
        roomSourceNumber: number,
      })
    },
  )
})

describe('manually annotated openings with native printed dimensions', () => {
  const opening: PdfOpeningAnnotation = {
    kind: 'window',
    wallEdgeIndex: 0,
    labelIndex: 56,
    widthMm: 1344,
    offsetMm: 939,
  }
  const checkOpening = (annotation = opening, paths = work.paths, inputContours = contours) =>
    pdfOpeningFromWidthChain(
      { ...work, paths },
      contours.source,
      inputContours,
      4,
      labels,
      2985,
      annotation,
    )
  const cases = annotated.rooms.flatMap((room) =>
    room.openings.map((annotation) => ({ room, annotation })),
  )
  it.each(cases)('verifies the declared opening $annotation.labelIndex', ({ room, annotation }) => {
    const result = pdfOpeningFromWidthChain(
      work,
      contours.source,
      contours,
      room.roomSourceNumber,
      labelsFor(room.roomSourceNumber),
      room.widthMm,
      annotation as PdfOpeningAnnotation,
    )
    expect(result).toMatchObject({
      status: 'candidate',
      roomSourceNumber: room.roomSourceNumber,
      kind: annotation.kind,
      widthMm: annotation.widthMm,
      offsetFromLeftMm: annotation.offsetMm,
      labelIndex: annotation.labelIndex,
      basis: 'manual-opening-annotation-with-native-dimension',
    })
    // Width and offset are not evidence of an unknown vertical/safety measurement.
    for (const key of ['heightMm', 'sillHeightMm', 'swing', 'clearanceChecked'])
      expect(result).not.toHaveProperty(key)
  })
  it('keeps offsets from the left for a bottom edge whose polygon runs right-to-left', () => {
    const room = annotated.rooms.find((item) => item.roomSourceNumber === 6)
    const annotation = room?.openings[0]
    if (!room || !annotation) throw new Error('Missing bottom window')
    expect(
      pdfOpeningFromWidthChain(
        work,
        contours.source,
        contours,
        6,
        labelsFor(6),
        2945,
        annotation as PdfOpeningAnnotation,
      ),
    ).toMatchObject({ offsetFromLeftMm: 866, start: { y: 724.752 }, end: { y: 724.752 } })
  })
  it.each([{ widthMm: 1400 }, { offsetMm: 1000 }])(
    'rejects contradictory annotation %j',
    (change) => {
      expect(checkOpening({ ...opening, ...change })).toMatchObject({
        reason: 'opening-dimension-conflict',
      })
    },
  )
  it.each([{ widthMm: 0 }, { offsetMm: -1 }, { wallEdgeIndex: -1 }, { wallEdgeIndex: 0.5 }])(
    'rejects invalid annotation %j',
    (change) => {
      expect(checkOpening({ ...opening, ...change })).toMatchObject({
        reason: 'invalid-opening-annotation',
      })
    },
  )
  it('rejects an opening label from a different chain', () => {
    expect(checkOpening({ ...opening, labelIndex: 86 })).toMatchObject({
      reason: 'opening-label-not-in-chain',
    })
  })
  it.each([1, 100])('rejects vertical or absent edge %i', (wallEdgeIndex) => {
    expect(checkOpening({ ...opening, wallEdgeIndex })).toMatchObject({
      reason: 'opening-edge-not-horizontal',
    })
  })
  it('does not move a top window onto the opposite wall', () => {
    expect(checkOpening({ ...opening, wallEdgeIndex: 2 })).toMatchObject({
      reason: 'opening-edge-not-near-chain',
    })
  })
  it('does not choose one of two equally distant wall edges', () => {
    const rooms = contours.rooms.map((room) =>
      room.roomSourceNumber === 4
        ? {
            ...room,
            polygon: room.polygon.map((point) => ({
              ...point,
              y: point.y === 327.76 ? 110.782 : point.y,
            })),
          }
        : room,
    )
    expect(checkOpening(opening, work.paths, { ...contours, rooms })).toMatchObject({
      status: 'ambiguous',
      reason: 'opening-edge-equidistant',
    })
  })
  it('does not infer an unsupported door or its opening direction', () => {
    expect(
      checkOpening({ ...opening, kind: 'door' } as unknown as PdfOpeningAnnotation),
    ).toMatchObject({
      reason: 'invalid-opening-annotation',
    })
  })
  it('does not stretch the kitchen projection edge to fit the full width chain', () => {
    expect(
      pdfOpeningFromWidthChain(work, contours.source, contours, 2, labelsFor(2), 2964, {
        kind: 'window',
        wallEdgeIndex: 2,
        labelIndex: 19,
        widthMm: 563,
        offsetMm: 525,
      }),
    ).toMatchObject({ reason: 'opening-edge-does-not-span-chain' })
  })
  it('does not accept an opening after its arrow has disappeared', () => {
    expect(
      checkOpening(
        opening,
        work.paths.filter((path) => path.operationIndex !== 2342),
      ).status,
    ).toBe('unresolved')
  })
  it('does not apply an existing-state opening to a proposed-state contour', () => {
    expect(
      checkOpening(opening, work.paths, {
        ...contours,
        source: { ...contours.source, state: 'proposed' },
      }),
    ).toMatchObject({ reason: 'different-plan-source' })
  })
})

describe('original sheet 03 native door-opening evidence', () => {
  const reviewed: PdfRoomContours = {
    ...nativeFeatures,
    source: { ...nativeFeatures.source, state: 'existing' },
    coordinateSystem: 'page-0-1000',
    review: 'manual-source-review',
    rooms: nativeFeatures.rooms.map((room) => ({
      roomSourceNumber: room.roomSourceNumber,
      polygon: room.polygon,
    })),
  }
  const nativeWork: PdfLinework = {
    ...work,
    paths: [...nativeFeatures.wallPaths, ...nativeFeatures.dimensionPaths] as PdfVectorPath[],
  }
  const cases = nativeFeatures.rooms.flatMap((room) =>
    room.openings.map((opening) => ({ room, opening })),
  )
  it.each(cases)(
    'checks the original printed $opening.widthMm mm opening in room $room.roomSourceNumber',
    ({ room, opening }) => {
      const label = nativeFeatures.labels.find((item) => item.index === opening.labelIndex)
      if (!label) throw new Error('Missing original opening width label')
      const result = pdfOpeningFromNativeSpan(
        nativeWork,
        reviewed.source,
        reviewed,
        room.roomSourceNumber,
        label,
        { ...opening, kind: 'door' },
      )
      expect(result).toMatchObject({
        status: 'candidate',
        widthMm: opening.widthMm,
        roomSourceNumber: room.roomSourceNumber,
        labelIndex: opening.labelIndex,
        start: opening.start,
        end: opening.end,
        axis: room.roomSourceNumber === 7 ? 'depth' : 'width',
      })
    },
  )
  it('returns identical evidence for an entire request batch without modifying native data', () => {
    const before = JSON.stringify({ work: nativeWork, reviewed })
    const verify = createPdfOpeningSpanVerifier(nativeWork, reviewed.source, reviewed)
    for (const { room, opening } of cases) {
      for (const label of nativeFeatures.labels) {
        expect(verify(room.roomSourceNumber, label, { ...opening, kind: 'door' })).toEqual(
          pdfOpeningFromNativeSpan(
            nativeWork,
            reviewed.source,
            reviewed,
            room.roomSourceNumber,
            label,
            { ...opening, kind: 'door' },
          ),
        )
      }
    }
    expect(JSON.stringify({ work: nativeWork, reviewed })).toBe(before)
  })
  it('keeps evidence request-local when another request has a changed vector layer', () => {
    const item = cases[0]
    if (!item) throw new Error('Missing original opening case')
    const label = nativeFeatures.labels.find(
      (candidate) => candidate.index === item.opening.labelIndex,
    )
    if (!label) throw new Error('Missing original opening label')
    const complete = createPdfOpeningSpanVerifier(nativeWork, reviewed.source, reviewed)
    const changed = createPdfOpeningSpanVerifier(
      { ...nativeWork, truncated: true },
      reviewed.source,
      reviewed,
    )
    expect(
      complete(item.room.roomSourceNumber, label, { ...item.opening, kind: 'door' }),
    ).toMatchObject({ status: 'candidate' })
    expect(
      changed(item.room.roomSourceNumber, label, { ...item.opening, kind: 'door' }),
    ).toMatchObject({ status: 'unresolved', reason: 'incomplete-vector-layer' })
  })
  it.each(cases)(
    'does not substitute the duplicate corridor width for room $room.roomSourceNumber',
    ({ room, opening }) => {
      const duplicate = nativeFeatures.labels.find(
        (item) => item.text === String(opening.widthMm) && item.index !== opening.labelIndex,
      )
      if (!duplicate) throw new Error('Missing duplicate corridor label')
      expect(
        pdfOpeningFromNativeSpan(
          nativeWork,
          reviewed.source,
          reviewed,
          room.roomSourceNumber,
          duplicate,
          { ...opening, kind: 'door' },
        ),
      ).toMatchObject({ status: 'unresolved', reason: 'opening-label-outside-room' })
    },
  )
  it.each(cases)(
    'refuses room $room.roomSourceNumber after its native dimension rail disappears',
    ({ room, opening }) => {
      const label = nativeFeatures.labels.find((item) => item.index === opening.labelIndex)
      if (!label) throw new Error('Missing original opening width label')
      expect(
        pdfOpeningFromNativeSpan(
          {
            ...nativeWork,
            paths: nativeWork.paths.filter(
              (path) => path.operationIndex !== opening.dimensionOperations[0],
            ),
          },
          reviewed.source,
          reviewed,
          room.roomSourceNumber,
          label,
          { ...opening, kind: 'door' },
        ),
      ).toMatchObject({ status: 'unresolved', reason: 'no-connected-opening-dimension' })
    },
  )
})
