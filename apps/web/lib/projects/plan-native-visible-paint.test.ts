import { createHash } from 'node:crypto'
import { existsSync, readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'
import { preparePlanPage } from './plan-document'
import { nativeVisiblePaintRegions } from './plan-native-visible-paint'
import type { PagePoint, PdfVectorPath } from './plan-pdf-linework'

type Input = Parameters<typeof nativeVisiblePaintRegions>[0]
const rectangle = (left: number, top: number, right: number, bottom: number): PagePoint[] => [
  { x: left, y: top },
  { x: right, y: top },
  { x: right, y: bottom },
  { x: left, y: bottom },
]
const paint = (operationIndex: number, points = rectangle(100, 100, 200, 200)): PdfVectorPath => ({
  operationIndex,
  subpathIndex: 0,
  paint: 'fill',
  closed: true,
  fillColor: '#ffffff',
  points,
})
function fixture(paths = [paint(10)]): Input {
  const source = { sha256: 'a'.repeat(64), page: 3, width: 1000, height: 1000 }
  return {
    native: {
      source,
      originalPdfSha256: 'b'.repeat(64),
      complete: true,
      labels: [],
      pageNormalizedScale: { x: 1, y: 1 },
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
const region = (input: Input) => {
  const result = nativeVisiblePaintRegions(input).regions.find(
    (item) => item.candidateId === 'native-fill-10:0',
  )
  if (!result) throw new Error('Expected source candidate')
  return result
}
const area = (polygon: PagePoint[]) =>
  Math.abs(
    polygon.reduce((sum, point, index) => {
      const next = polygon[(index + 1) % polygon.length]
      if (!next) throw new Error('Invalid test ring')
      return sum + point.x * next.y - next.x * point.y
    }, 0) / 2,
  )
describe('source-decimal positive paint subtraction, not free floor', () => {
  it('preserves source geometry and has no metric or floor authority', () => {
    const input = fixture()
    const before = structuredClone(input)
    const result = nativeVisiblePaintRegions(input)
    expect(result.regions[0]?.pieces[0]?.polygon).toEqual(input.work.paths[0]?.points)
    expect(input).toEqual(before)
    expect(result).toMatchObject({
      readyFor2D: false,
      readyFor3D: false,
      roomOwnershipConfirmed: false,
      physicalFloorConfirmed: false,
    })
  })
  it('subtracts later same-colour small columns despite candidate size filtering', () => {
    const result = region(fixture([paint(10), paint(20, rectangle(120, 120, 130, 130))]))
    expect(result.status).toBe('diagnostic')
    expect(result.pieces[0]?.holes).toEqual([rectangle(120, 120, 130, 130)])
    expect(result.masks).toEqual([{ operationIndex: 20, subpathIndex: 0 }])
  })
  it('does not subtract earlier paint or equal shared borders', () => {
    const result = region(fixture([paint(2), paint(10), paint(20, rectangle(200, 100, 220, 200))]))
    expect(result.masks).toEqual([])
    expect(result.pieces).toHaveLength(1)
  })
  it('represents fully overpainted source as no surviving pieces', () => {
    const result = region(fixture([paint(10), paint(20, rectangle(90, 90, 210, 210))]))
    expect(result.status).toBe('diagnostic')
    expect(result.pieces).toEqual([])
  })
  it('cuts a crossing column with source references and exact rational intersections', () => {
    const result = region(
      fixture([
        paint(10),
        paint(20, [
          { x: 150, y: 80 },
          { x: 210, y: 110 },
          { x: 170, y: 140 },
        ]),
      ]),
    )
    expect(result.refusalReason).toBeNull()
    expect(result.pieces.length).toBeGreaterThan(0)
    expect(result.intersections.length).toBeGreaterThan(0)
    expect(
      result.intersections.every((proof) => proof.arithmetic === 'source-decimal-rational'),
    ).toBe(true)
    expect(result.pieces.reduce((sum, piece) => sum + area(piece.polygon), 0)).toBeLessThan(10_000)
    expect(
      result.pieces.flatMap((piece) => piece.edges).every((edge) => edge.sourceRefs.length > 0),
    ).toBe(true)
  })
  it('does not lose an interior column when another mask crosses the exterior', () => {
    const result = region(
      fixture([
        paint(10),
        paint(20, rectangle(120, 120, 130, 130)),
        paint(30, rectangle(180, 150, 220, 180)),
      ]),
    )
    expect(result.refusalReason).toBe('mixed-disconnected-mask-topology')
    expect(result.pieces).toEqual([])
  })
  it('holds unsupported compound fill touching a candidate', () => {
    const compound = paint(20, rectangle(180, 150, 220, 180))
    const result = region(fixture([paint(10), compound, { ...paint(20), subpathIndex: 1 }]))
    expect(result.refusalReason).toBe('unsupported-later-paint-topology')
  })
  it('holds omitted geometry and never claims fake zero omissions', () => {
    const input = fixture()
    input.work.clippedPaths = 1
    input.work.clippedPathBounds = [
      { operationIndex: 30, bounds: { left: 120, right: 130, top: 120, bottom: 130 } },
    ]
    expect(region(input)?.refusalReason).toBe('omitted-native-evidence-contact')
    expect(input.work.clippedPaths).toBe(1)
  })
  it('keeps source indexes even when canonical ring order differs from original', () => {
    const original = [
      { x: 200, y: 200 },
      { x: 200, y: 100 },
      { x: 100, y: 100 },
      { x: 100, y: 200 },
    ]
    const result = region(fixture([paint(10, original)]))
    const piece = result.pieces[0]
    if (!piece) throw new Error('Expected source piece')
    for (const edge of piece.edges) {
      const ref = edge.sourceRefs[0]
      if (!ref) throw new Error('Missing original edge')
      expect(ref.start).toEqual(original[ref.segmentIndex])
      expect(ref.end).toEqual(original[(ref.segmentIndex + 1) % original.length])
    }
  })
  it.each(['fill', 'fill-stroke', undefined] as const)(
    'holds unknown or filled omitted paint: %s',
    (omittedPaint) => {
      const input = fixture()
      input.work.clippedPaths = 1
      input.work.clippedPathBounds = [
        {
          operationIndex: 30,
          bounds: { left: 120, right: 130, top: 120, bottom: 130 },
          ...(omittedPaint ? { paint: omittedPaint } : {}),
        },
      ]
      expect(region(input).refusalReason).toBe('omitted-native-evidence-contact')
    },
  )
  it('retains stroke omission diagnostics while doing fill-only subtraction', () => {
    const input = fixture([paint(10), paint(20, rectangle(120, 120, 130, 130))])
    input.work.clippedPaths = 1
    input.work.clippedPathBounds = [
      {
        operationIndex: 30,
        paint: 'stroke',
        bounds: { left: 120, right: 130, top: 120, bottom: 130 },
      },
    ]
    const result = nativeVisiblePaintRegions(input)
    expect(result.visibilityConfirmed).toBe(false)
    expect(region(input)).toMatchObject({
      status: 'diagnostic',
      omittedStrokeCount: 1,
      boundaryInkComplete: false,
    })
    expect(region(input).pieces[0]?.holes).toHaveLength(1)
    expect(result.omissionCounts.clippedPaths).toBe(1)
  })

  it('excludes full omitted ink confined to the interior, not from a raw path box', () => {
    const input = fixture()
    input.work.clippedPaths = 1
    input.work.clippedPathBounds = [
      {
        operationIndex: 30,
        paint: 'stroke',
        bounds: { left: 120, right: 130, top: 120, bottom: 130 },
      },
    ]
    expect(region(input).boundaryInkComplete).toBe(false)
    input.work.paintBounds = {
      complete: true,
      refusalReason: null,
      events: [
        {
          operationIndex: 30,
          kind: 'vector',
          reason: null,
          bounds: { left: 119, right: 131, top: 119, bottom: 131 },
        },
      ],
    }
    const result = region(input)
    expect(result).toMatchObject({ omittedStrokeCount: 0, boundaryInkComplete: true })
    expect(result.pieces[0]?.polygon).toEqual(rectangle(100, 100, 200, 200))
    expect(nativeVisiblePaintRegions(input)).toMatchObject({
      visibilityConfirmed: false,
      physicalFloorConfirmed: false,
      readyFor2D: false,
      readyFor3D: false,
      omissionCounts: { clippedPaths: 1 },
    })
  })

  it('checks hole boundaries even when an omitted stroke misses the original perimeter', () => {
    const input = fixture([paint(10), paint(20, rectangle(120, 120, 130, 130))])
    input.work.clippedPaths = 1
    input.work.clippedPathBounds = [
      {
        operationIndex: 30,
        paint: 'stroke',
        bounds: { left: 125, right: 125, top: 118, bottom: 122 },
      },
    ]
    input.work.paintBounds = {
      complete: true,
      refusalReason: null,
      events: [
        {
          operationIndex: 30,
          kind: 'vector',
          reason: null,
          bounds: { left: 124, right: 126, top: 117, bottom: 123 },
        },
      ],
    }
    expect(region(input)).toMatchObject({ omittedStrokeCount: 1, boundaryInkComplete: false })
  })

  it.each(['stroke', 'fill-stroke', undefined] as const)(
    'holds unknown pens even when the omitted control box is far away: %s',
    (paint) => {
      const input = fixture()
      input.work.clippedPaths = 1
      input.work.clippedPathBounds = [
        {
          operationIndex: 30,
          bounds: { left: 800, right: 810, top: 800, bottom: 810 },
          ...(paint ? { paint } : {}),
        },
      ]
      expect(region(input)).toMatchObject({ omittedStrokeCount: 1, boundaryInkComplete: false })
    },
  )

  it('keeps a thick pen touching the boundary despite its disjoint control box', () => {
    const input = fixture()
    input.work.clippedPaths = 1
    input.work.clippedPathBounds = [
      {
        operationIndex: 30,
        paint: 'stroke',
        bounds: { left: 210, right: 210, top: 120, bottom: 130 },
      },
    ]
    input.work.paintBounds = {
      complete: true,
      refusalReason: null,
      events: [
        {
          operationIndex: 30,
          kind: 'vector',
          reason: null,
          bounds: { left: 199, right: 221, top: 109, bottom: 141 },
        },
      ],
    }
    expect(region(input)).toMatchObject({ omittedStrokeCount: 1, boundaryInkComplete: false })
  })
  it('holds overlapping contained holes rather than XOR-ing occupied paint', () => {
    const result = region(
      fixture([
        paint(10),
        paint(20, rectangle(120, 120, 140, 140)),
        paint(30, rectangle(130, 130, 150, 150)),
      ]),
    )
    expect(result.refusalReason).toBe('overlapping-or-touching-inner-masks')
    expect(result.pieces).toEqual([])
  })
  it('refuses an entire report exceeding the per-region client piece limit', () => {
    const paths = [paint(10, rectangle(100, 100, 900, 900))]
    // Ten full-height and nine full-width masks leave 11 * 10 = 110
    // separate source-backed cells, below the global limit but above the DTO limit.
    for (let index = 0; index < 10; index++) {
      const left = 150 + index * 70
      paths.push(paint(20 + index, rectangle(left, 90, left + 10, 910)))
    }
    for (let index = 0; index < 9; index++) {
      const top = 150 + index * 75
      paths.push(paint(40 + index, rectangle(90, top, 910, top + 10)))
    }
    const result = nativeVisiblePaintRegions(fixture(paths))
    expect(result.refusalReason).toBe('visible-paint-output-limit')
    expect(result.regions).toEqual([])
    expect(result.status).toBe('unresolved')
    expect(result.readyFor2D).toBe(false)
    expect(result.readyFor3D).toBe(false)
  })
})

const original = resolve('../../output/pdf/source-search-20261003/rebrina-original.pdf')
it.skipIf(!existsSync(original))(
  'fresh real survey never exposes a held region as accepted floor',
  async () => {
    const bytes = readFileSync(original)
    expect(createHash('sha256').update(bytes).digest('hex')).toBe(
      '2e141c135812c81719e1f4783173cb5202e20041ac494d3cc799eb37ad62ad4e',
    )
    const page = await preparePlanPage(bytes, true, 3, true, true)
    if (!page.nativeTextAnchors || !page.lineworkRasterSource || !page.linework)
      throw new Error('Missing source extraction')
    const result = nativeVisiblePaintRegions({
      native: page.nativeTextAnchors,
      lineworkSource: page.lineworkRasterSource,
      work: page.linework,
    })
    expect(result.readyFor2D).toBe(false)
    expect(result.readyFor3D).toBe(false)
    const recovered = result.regions.find((item) => item.sourceRef.operationIndex === 1527)
    expect(recovered).toMatchObject({
      status: 'diagnostic',
      refusalReason: null,
      boundaryInkComplete: false,
      omittedStrokeCount: 71,
    })
    expect(recovered?.pieces).toHaveLength(1)
    expect(recovered?.intersections).toHaveLength(3)
    const kitchen = result.regions.find((item) => item.sourceRef.operationIndex === 1462)
    expect(kitchen?.masks).toContainEqual({ operationIndex: 13501, subpathIndex: 0 })
    expect(kitchen).toMatchObject({ status: 'diagnostic', refusalReason: null })
    expect(kitchen?.pieces).toHaveLength(1)
    expect(kitchen?.intersections).toHaveLength(118)
    const roomOperations = [1462, 1491, 1527, 1563, 1591, 1611, 1631, 1651]
    const roomPaint = result.regions.filter((item) =>
      roomOperations.includes(item.sourceRef.operationIndex),
    )
    expect(roomPaint).toHaveLength(8)
    expect(
      roomPaint.every((item) => item.status === 'diagnostic' && item.refusalReason === null),
    ).toBe(true)
    expect(roomPaint.reduce((count, item) => count + item.pieces.length, 0)).toBe(9)
    expect(roomPaint.every((item) => !item.boundaryInkComplete)).toBe(true)
    expect(result.omissionCounts.clippedPaths).toBe(532)
    for (const item of result.regions) if (item.status === 'held') expect(item.pieces).toEqual([])
  },
  60_000,
)
