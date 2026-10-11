import { createHash } from 'node:crypto'
import { existsSync } from 'node:fs'
import { readFile } from 'node:fs/promises'
import { describe, expect, it } from 'vitest'
import { preparePlanPage } from './plan-document'
import {
  nativePaintedFloorReview,
  type ReviewedNativePaintedFloors,
} from './plan-native-painted-floor-review'
import { nativeVisiblePaintRegions } from './plan-native-visible-paint'
import type { PagePoint, PdfVectorPath } from './plan-pdf-linework'

type Common = Parameters<typeof nativeVisiblePaintRegions>[0]
const rectangle = (left: number, top: number, right: number, bottom: number): PagePoint[] => [
  { x: left, y: top },
  { x: right, y: top },
  { x: right, y: bottom },
  { x: left, y: bottom },
]
const paint = (operationIndex: number, points: PagePoint[]): PdfVectorPath => ({
  operationIndex,
  subpathIndex: 0,
  paint: 'fill',
  closed: true,
  points,
})
function common(paths = [paint(10, rectangle(100, 100, 300, 300))]): Common {
  const source = { sha256: 'a'.repeat(64), page: 3, width: 1000, height: 1000 }
  return {
    native: {
      source,
      originalPdfSha256: 'b'.repeat(64),
      complete: true,
      pageNormalizedScale: { x: 1, y: 1 },
      labels: [
        {
          id: 'native-text-1',
          nativeIndex: 1,
          name: 'Гардероб',
          point: { x: 150, y: 160 },
          pagePoint: { x: 150, y: 160 },
          rotation: 0,
        },
        {
          id: 'native-text-2',
          nativeIndex: 2,
          name: '3.1',
          point: { x: 150, y: 180 },
          pagePoint: { x: 150, y: 180 },
          rotation: 0,
        },
      ],
    },
    lineworkSource: source,
    work: {
      coordinateSystem: 'page-0-1000',
      pageWidth: 1000,
      pageHeight: 1000,
      paths,
      skippedCurves: 0,
      clippedPaths: 0,
      unsupportedPaths: 0,
      unsupportedContexts: 0,
      truncated: false,
    },
  }
}
function selection(
  input: Common,
  candidateId = 'native-fill-10:0',
  pieceIndex = 0,
): ReviewedNativePaintedFloors {
  const region = nativeVisiblePaintRegions(input).regions.find(
    (region) => region.candidateId === candidateId,
  )
  const piece = region?.pieces[pieceIndex]
  if (!piece) throw new Error('Missing fixture piece')
  return {
    review: 'manual-native-painted-floor-review',
    source: { sha256: required(input.native.originalPdfSha256), pdfPage: 3, state: 'existing' },
    rasterSource: input.native.source,
    floors: [
      {
        candidateId,
        pieceIndex,
        polygon: structuredClone(piece.polygon),
        holes: structuredClone(piece.holes),
        owner: {
          sourceRoomKey: '3.1',
          nameLabelId: 'native-text-1',
          numberLabelId: 'native-text-2',
        },
        boundaryRoles: piece.polygon.map((_, edgeIndex) => ({ edgeIndex, kind: 'unresolved' })),
      },
    ],
  }
}
const required = <T>(value: T | undefined): T => {
  if (value === undefined) throw new Error('Missing fixture')
  return value
}

describe('explicit source-painted floor review', () => {
  it('returns named untouched source geometry for decimal identities without metric acceptance', () => {
    const input = common(),
      reviewed = selection(input),
      before = structuredClone({ input, reviewed })
    const result = nativePaintedFloorReview({ ...input, reviewed })
    expect(result.status).toBe('reviewed-draft')
    expect(result.floors[0]?.owner).toEqual({
      sourceRoomKey: '3.1',
      nameLabelId: 'native-text-1',
      numberLabelId: 'native-text-2',
      name: 'Гардероб',
    })
    expect(result.floors[0]?.polygon).toEqual(reviewed.floors[0]?.polygon)
    expect(
      result.floors[0]?.edges.every(
        (edge) => edge.declaredRole === 'unresolved' && edge.sourceRefs.length > 0,
      ),
    ).toBe(true)
    expect(result).toMatchObject({
      physicalBoundariesAccepted: false,
      measurementsConfirmed: false,
      commonZeroConfirmed: false,
      readyFor2D: false,
      readyFor3D: false,
    })
    expect({ input, reviewed }).toEqual(before)
  })
  it('records declared wall/opening/level roles without treating them as physical proofs', () => {
    const input = common(),
      reviewed = selection(input)
    const floor = required(reviewed.floors[0])
    floor.boundaryRoles = ['wall-face', 'opening-boundary', 'level-separator', 'unresolved'].map(
      (kind, edgeIndex) => ({
        edgeIndex,
        kind: kind as (typeof floor.boundaryRoles)[number]['kind'],
      }),
    )
    const result = nativePaintedFloorReview({ ...input, reviewed })
    expect(result.floors[0]?.edges.map((edge) => edge.declaredRole)).toEqual(
      floor.boundaryRoles.map((role) => role.kind),
    )
    expect(result.physicalBoundariesAccepted).toBe(false)
  })
  it.each(['review', 'source', 'raster', 'floor', 'owner', 'role', 'point', 'hole-point'])(
    'rejects extra authority or metadata at the %s level on saved-review reload',
    (level) => {
      const input = common([
        paint(10, rectangle(100, 100, 300, 300)),
        paint(20, rectangle(200, 200, 230, 230)),
      ])
      const reviewed = selection(input)
      const floor = required(reviewed.floors[0])
      const targets: Record<string, object> = {
        review: reviewed,
        source: reviewed.source,
        raster: reviewed.rasterSource,
        floor,
        owner: floor.owner,
        role: required(floor.boundaryRoles[0]),
        point: required(floor.polygon[0]),
        'hole-point': required(required(floor.holes[0])[0]),
      }
      Object.assign(targets[level] as object, {
        physicalBoundariesAccepted: true,
        readyFor3D: true,
      })
      // The reload path passes parsed storage JSON to this core, without the action schema.
      const persisted = JSON.parse(JSON.stringify(reviewed)) as ReviewedNativePaintedFloors
      const result = nativePaintedFloorReview({ ...input, reviewed: persisted })
      expect(result.status).toBe('held')
      expect(result.floors).toEqual([])
      expect(result.physicalBoundariesAccepted).toBe(false)
      expect(result.readyFor3D).toBe(false)
    },
  )
  it.each([null, [], { review: 'manual-native-painted-floor-review' }])(
    'holds malformed saved-review envelopes without returning accepted objects',
    (reviewed) => {
      const result = nativePaintedFloorReview({
        ...common(),
        reviewed: reviewed as ReviewedNativePaintedFloors,
      })
      expect(result.status).toBe('held')
      expect(result.floors).toEqual([])
    },
  )
  it.each([
    'source',
    'page',
    'state',
    'raster',
    'geometry',
    'holes',
    'piece',
    'candidate',
    'owner',
    'noncanonical',
    'name',
    'number',
    'origin',
    'raster-point',
    'duplicate-label',
    'missing-role',
    'duplicate-role',
    'unknown-role',
    'duplicate-piece',
  ])('holds %s conflicts atomically', (mutation) => {
    const input = common(),
      reviewed = selection(input),
      floor = required(reviewed.floors[0])
    if (mutation === 'source') reviewed.source.sha256 = 'c'.repeat(64)
    if (mutation === 'page') reviewed.source.pdfPage = 2
    if (mutation === 'state') reviewed.source.state = 'proposed'
    if (mutation === 'raster') reviewed.rasterSource = { ...reviewed.rasterSource, width: 999 }
    if (mutation === 'geometry') required(floor.polygon[0]).x += 0.001
    if (mutation === 'holes') floor.holes.push(rectangle(120, 120, 130, 130))
    if (mutation === 'piece') floor.pieceIndex = 1
    if (mutation === 'candidate') floor.candidateId = 'native-fill-20:0'
    if (mutation === 'owner') floor.owner.sourceRoomKey = '3'
    if (mutation === 'noncanonical') floor.owner.sourceRoomKey = '3.10'
    if (mutation === 'name') required(input.native.labels[0]).name = 'Балка'
    if (mutation === 'number') required(input.native.labels[1]).name = '31'
    if (mutation === 'origin') {
      required(input.native.labels[0]).pagePoint = { x: 100, y: 160 }
      required(input.native.labels[0]).point = { x: 100, y: 160 }
    }
    if (mutation === 'raster-point') required(input.native.labels[0]).point.x = Number.NaN
    if (mutation === 'duplicate-label')
      input.native.labels.push(structuredClone(required(input.native.labels[0])))
    if (mutation === 'missing-role') floor.boundaryRoles.pop()
    if (mutation === 'duplicate-role') required(floor.boundaryRoles[1]).edgeIndex = 0
    if (mutation === 'unknown-role')
      required(floor.boundaryRoles[0]).kind =
        'accepted-wall' as (typeof floor.boundaryRoles)[number]['kind']
    if (mutation === 'duplicate-piece') reviewed.floors.push(structuredClone(floor))
    const result = nativePaintedFloorReview({ ...input, reviewed })
    expect(result.status).toBe('held')
    expect(result.floors).toEqual([])
  })
  it('does not allow a caption inside a subtracted source hole to own the floor', () => {
    const input = common([
      paint(10, rectangle(100, 100, 300, 300)),
      paint(20, rectangle(140, 140, 170, 190)),
    ])
    const result = nativePaintedFloorReview({ ...input, reviewed: selection(input) })
    expect(result.refusalReason).toBe('painted-floor-owner-outside-piece')
  })
  it('keeps safe original holes and their source masks without accepting their boundaries', () => {
    const input = common([
      paint(10, rectangle(100, 100, 300, 300)),
      paint(20, rectangle(200, 200, 230, 230)),
    ])
    const result = nativePaintedFloorReview({ ...input, reviewed: selection(input) })
    expect(result.status).toBe('reviewed-draft')
    expect(result.floors[0]?.holes).toEqual([rectangle(200, 200, 230, 230)])
    expect(result.floors[0]?.holeExactPointKeys).toHaveLength(1)
    expect(result.floors[0]?.masks).toEqual([{ operationIndex: 20, subpathIndex: 0 }])
    expect(result.physicalBoundariesAccepted).toBe(false)
  })
  it('does not give two source pieces the same reviewed owner', () => {
    const input = common([
      paint(10, rectangle(100, 100, 300, 300)),
      paint(30, rectangle(400, 100, 600, 300)),
    ])
    const reviewed = selection(input)
    reviewed.floors.push(required(selection(input, 'native-fill-30:0').floors[0]))
    expect(nativePaintedFloorReview({ ...input, reviewed }).refusalReason).toBe(
      'duplicate-painted-floor-owner',
    )
  })
  it('retains rational cut keys instead of treating the display coordinates as exact source vertices', () => {
    const input = common([
      paint(10, rectangle(100, 100, 300, 300)),
      paint(20, [
        { x: 250, y: 80 },
        { x: 310, y: 110 },
        { x: 270, y: 140 },
      ]),
    ])
    const reviewed = selection(input)
    const result = nativePaintedFloorReview({ ...input, reviewed })
    expect(result.status).toBe('reviewed-draft')
    expect(result.floors[0]?.intersections.length).toBeGreaterThan(0)
    expect(result.floors[0]?.exactPointKeys.length).toBe(result.floors[0]?.polygon.length)
  })
  it('bounds selections before searching', () => {
    const input = common(),
      reviewed = selection(input)
    reviewed.floors = Array.from({ length: 51 }, () =>
      structuredClone(required(reviewed.floors[0])),
    )
    expect(nativePaintedFloorReview({ ...input, reviewed }).refusalReason).toBe(
      'painted-floor-review-limit',
    )
  })

  const source = new URL(
    '../../../../output/pdf/source-search-20261003/rebrina-original.pdf',
    import.meta.url,
  )
  it.skipIf(!existsSync(source))(
    'reviews eight actual named source pieces including 3.1 without inventing a ninth owner',
    async () => {
      const body = await readFile(source)
      expect(createHash('sha256').update(body).digest('hex')).toBe(
        '2e141c135812c81719e1f4783173cb5202e20041ac494d3cc799eb37ad62ad4e',
      )
      const page = await preparePlanPage(body, true, 3, true, true)
      const input: Common = {
        native: required(page.nativeTextAnchors),
        work: required(page.linework),
        lineworkSource: required(page.lineworkRasterSource),
      }
      const map = [
        [1462, 179, 181, '2'],
        [1491, 187, 189, '5'],
        [1527, 193, 195, '6'],
        [1563, 199, 201, '3'],
        [1591, 205, 207, '7'],
        [1611, 211, 213, '4'],
        [1631, 217, 219, '3.1'],
        [1651, 223, 225, '1'],
      ] as const
      const paint = nativeVisiblePaintRegions(input)
      const reviewed: ReviewedNativePaintedFloors = {
        review: 'manual-native-painted-floor-review',
        source: { sha256: required(input.native.originalPdfSha256), pdfPage: 3, state: 'existing' },
        rasterSource: input.native.source,
        floors: map.map(([operation, nameIndex, numberIndex, sourceRoomKey]) => {
          const region = required(
            paint.regions.find((region) => region.sourceRef.operationIndex === operation),
          )
          const piece = required(region.pieces[0])
          return {
            candidateId: region.candidateId,
            pieceIndex: 0,
            polygon: piece.polygon,
            holes: piece.holes,
            owner: {
              sourceRoomKey,
              nameLabelId: `native-text-${nameIndex}`,
              numberLabelId: `native-text-${numberIndex}`,
            },
            boundaryRoles: piece.polygon.map((_, edgeIndex) => ({
              edgeIndex,
              kind: 'unresolved' as const,
            })),
          }
        }),
      }
      const result = nativePaintedFloorReview({ ...input, reviewed })
      expect(result.refusalReason).toBeNull()
      expect(result.floors).toHaveLength(8)
      expect(result.floors.map((floor) => floor.owner.sourceRoomKey)).toEqual(
        map.map((row) => row[3]),
      )
      expect(
        result.floors.every((floor) => !floor.boundaryInkComplete && floor.omittedStrokeCount > 0),
      ).toBe(true)
      expect(result.readyFor3D).toBe(false)
      const wardrobe = required(
        reviewed.floors.find((floor) => floor.owner.sourceRoomKey === '3.1'),
      )
      const region = required(
        paint.regions.find((region) => region.sourceRef.operationIndex === 1631),
      )
      const sliver = required(region.pieces[1])
      wardrobe.pieceIndex = 1
      wardrobe.polygon = sliver.polygon
      wardrobe.holes = sliver.holes
      wardrobe.boundaryRoles = sliver.polygon.map((_, edgeIndex) => ({
        edgeIndex,
        kind: 'unresolved',
      }))
      expect(nativePaintedFloorReview({ ...input, reviewed }).refusalReason).toBe(
        'painted-floor-owner-outside-piece',
      )
    },
    30_000,
  )
})
