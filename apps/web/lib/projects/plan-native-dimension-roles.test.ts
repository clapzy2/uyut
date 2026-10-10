import { describe, expect, it } from 'vitest'
import type { NativeTextAnchors } from './plan-document'
import { automaticNativeDimensionRoles } from './plan-native-dimension-roles'
import { pdfNativePageDimensionChain } from './plan-pdf-dimension-chain'
import type { PdfLinework, PdfVectorPath } from './plan-pdf-linework'

function fixture() {
  const source = { sha256: 'b'.repeat(64), pdfPage: 1, state: 'existing' as const }
  const frame = { sha256: 'a'.repeat(64), page: 1, width: 1000, height: 1000 }
  const native: NativeTextAnchors = {
    source: frame,
    originalPdfSha256: source.sha256,
    complete: true,
    pageNormalizedScale: { x: 1, y: 1 },
    labels: [
      {
        id: 'native-text-10',
        nativeIndex: 10,
        name: '200',
        rotation: 0,
        pagePoint: { x: 200, y: 168 },
        point: { x: 200, y: 168 },
      },
    ],
  }
  const stroke = (operationIndex: number, points: PdfVectorPath['points']): PdfVectorPath => ({
    operationIndex,
    subpathIndex: 0,
    paint: 'stroke',
    closed: false,
    points,
  })
  const work: PdfLinework = {
    coordinateSystem: 'page-0-1000',
    pageWidth: 1000,
    pageHeight: 1000,
    paths: [
      stroke(1, [
        { x: 100, y: 170 },
        { x: 300, y: 170 },
      ]),
      stroke(2, [
        { x: 95, y: 175 },
        { x: 105, y: 165 },
      ]),
      stroke(3, [
        { x: 295, y: 175 },
        { x: 305, y: 165 },
      ]),
    ],
    skippedCurves: 0,
    clippedPaths: 0,
    unsupportedPaths: 0,
    unsupportedContexts: 0,
    truncated: false,
  }
  return { native, source, work, lineworkSource: frame }
}
describe('automatic printed dimension roles, not permission to erase lines', () => {
  it.each([180, -90, 270])(
    'checks cardinal rotation %s without changing source text',
    (rotation) => {
      const input = fixture()
      const label = input.native.labels[0]
      if (!label) throw new Error('Missing test label')
      label.rotation = rotation
      if (rotation !== 180) {
        input.work.paths = input.work.paths.map((path) => ({
          ...path,
          points: path.points.map((point) => ({ x: point.y, y: point.x })),
        }))
        label.point = { x: 168, y: 200 }
        label.pagePoint = { ...label.point }
      }
      expect(automaticNativeDimensionRoles(input).candidates).toHaveLength(1)
      expect(label.rotation).toBe(rotation)
    },
  )
  it('discovers a unique labelled rail and both source ticks without selected label IDs', () => {
    const input = fixture(),
      before = structuredClone(input.work)
    const result = automaticNativeDimensionRoles(input)
    expect(result.refusalReason).toBeNull()
    expect(result.candidates).toHaveLength(1)
    expect(result.candidates[0]).toMatchObject({
      labelId: 'native-text-10',
      valueMm: 200,
      rail: { operationIndex: 1 },
    })
    expect(result.candidates[0]?.ticks.map((tick) => tick.operationIndex)).toEqual([2, 3])
    expect(result.mayEraseSourceStrokes).toBe(false)
    expect(input.work).toEqual(before)
  })
  it('does not mark arbitrary numbers or an unmarked line as a dimension', () => {
    const input = fixture()
    input.work.paths = input.work.paths.slice(0, 1)
    expect(automaticNativeDimensionRoles(input).candidates).toEqual([])
  })
  it('refuses duplicate or shifted ticks rather than choosing one', () => {
    const input = fixture(),
      tick = input.work.paths[1]
    if (!tick) throw new Error('Missing test tick')
    input.work.paths.push({ ...tick, operationIndex: 4 })
    expect(automaticNativeDimensionRoles(input).candidates).toEqual([])
    input.work.paths.pop()
    tick.points = tick.points.map((point) => ({ x: point.x + 1, y: point.y }))
    expect(automaticNativeDimensionRoles(input).candidates).toEqual([])
  })
  it('requires the selected existing page and native coordinate provenance', () => {
    const input = fixture()
    expect(
      automaticNativeDimensionRoles({ ...input, source: { ...input.source, pdfPage: 2 } })
        .refusalReason,
    ).toBe('unverified-or-mismatched-page-state')
    expect(
      automaticNativeDimensionRoles({ ...input, source: { ...input.source, state: 'proposed' } })
        .candidates,
    ).toEqual([])
    const label = input.native.labels[0]
    if (!label) throw new Error('Missing test label')
    label.point.x++
    expect(automaticNativeDimensionRoles(input).refusalReason).toBe(
      'invalid-native-text-provenance',
    )
  })
  it('refuses incomplete extraction and malformed source path references', () => {
    const input = fixture()
    expect(
      automaticNativeDimensionRoles({ ...input, native: { ...input.native, complete: false } })
        .candidates,
    ).toEqual([])
    const path = input.work.paths[0]
    if (!path) throw new Error('Missing test path')
    path.operationIndex = -1
    expect(automaticNativeDimensionRoles(input).refusalReason).toBe(
      'invalid-native-path-provenance',
    )
  })
  it('retains all 101 competing numeric captions rather than imposing an arbitrary label cap', () => {
    const input = fixture()
    input.native.labels = Array.from({ length: 101 }, (_, index) => ({
      ...(input.native.labels[0] as NativeTextAnchors['labels'][number]),
      id: `native-text-${index}`,
      nativeIndex: index,
    }))
    const result = automaticNativeDimensionRoles(input)
    expect(result).toMatchObject({
      refusalReason: null,
      candidates: [],
    })
    expect(result.unresolved).toHaveLength(101)
    expect(result.unresolved.every((entry) => entry.reason === 'competing-dimension-labels')).toBe(
      true,
    )
  })
  it('keeps competing labels unresolved rather than assigning the same rail twice', () => {
    const input = fixture(),
      label = input.native.labels[0]
    if (!label) throw new Error('Missing test label')
    input.native.labels.push({ ...label, id: 'native-text-20', nativeIndex: 20, name: '201' })
    const result = automaticNativeDimensionRoles(input)
    expect(result.candidates).toEqual([])
    expect(
      result.unresolved.filter((entry) => entry.reason === 'competing-dimension-labels'),
    ).toHaveLength(2)
  })

  it('checks 108 additional numeric captions without losing an independently supported rail', () => {
    const input = fixture()
    for (let index = 0; index < 108; index++) {
      const point = { x: 500 + index, y: 10 }
      input.native.labels.push({
        id: `native-text-${100 + index}`,
        nativeIndex: 100 + index,
        name: String(1000 + index),
        rotation: 0,
        pagePoint: { ...point },
        point: { ...point },
      })
    }
    const before = structuredClone(input)
    const result = automaticNativeDimensionRoles(input)
    expect(result.refusalReason).toBeNull()
    expect(result.candidates).toHaveLength(1)
    expect(result.candidates[0]).toMatchObject({ labelId: 'native-text-10', valueMm: 200 })
    expect(result.unresolved).toHaveLength(108)
    expect(result.unresolved.every((entry) => entry.reason === 'no-connected-dimension-line')).toBe(
      true,
    )
    expect(input).toEqual(before)
  })

  it.each(['width', 'depth'] as const)(
    'preserves the strict legacy %s endpoints and rail evidence',
    (axis) => {
      const input = fixture()
      const label = input.native.labels[0]
      if (!label?.pagePoint) throw new Error('Missing dimension caption')
      if (axis === 'depth') {
        for (const path of input.work.paths)
          path.points = path.points.map((point) => ({ x: point.y, y: point.x }))
        label.pagePoint = { x: 168, y: 200 }
        label.point = { ...label.pagePoint }
        label.rotation = 90
      }
      const legacy = pdfNativePageDimensionChain(
        input.work,
        input.source,
        [
          {
            index: label.nativeIndex as number,
            text: label.name,
            ...label.pagePoint,
            rotation: label.rotation as number,
          },
        ],
        200,
        axis,
      )
      if (legacy.status !== 'candidate') throw new Error(legacy.reason)
      const result = automaticNativeDimensionRoles(input)
      expect(result.refusalReason).toBeNull()
      expect(result.candidates[0]?.spanEnds).toEqual(legacy.ends)
      expect(result.candidates[0]?.rail.operationIndex).toBe(legacy.lineOperations[0])
      expect(result.candidates[0]?.ticks.map((tick) => tick.operationIndex)).toEqual([2, 3])
    },
  )

  it('keeps the old strict competing-rail result on the prepared verifier', () => {
    const input = fixture()
    const rail = input.work.paths[0]
    const label = input.native.labels[0]
    if (!rail || !label?.pagePoint) throw new Error('Missing native control')
    input.work.paths.push({ ...structuredClone(rail), operationIndex: 4 })
    const legacy = pdfNativePageDimensionChain(
      input.work,
      input.source,
      [{ index: label.nativeIndex as number, text: label.name, ...label.pagePoint, rotation: 0 }],
      200,
      'width',
    )
    expect(legacy.status).not.toBe('candidate')
    const result = automaticNativeDimensionRoles(input)
    expect(result.candidates).toEqual([])
    if (legacy.status === 'candidate') throw new Error('Unexpected legacy candidate')
    expect(result.unresolved).toEqual([{ labelId: label.id, reason: legacy.reason }])
  })

  it('does not fabricate native caption context from an injected compact-index snapshot', () => {
    const input = fixture()
    const expected = automaticNativeDimensionRoles(input)
    Object.assign(input, {
      captionContext: {
        complete: true,
        items: [
          {
            index: 0,
            text: '9999',
            origin: { x: 200, y: 168 },
            baselineStart: { x: 200, y: 168 },
            baselineEnd: { x: 250, y: 168 },
          },
        ],
      },
    })
    expect(automaticNativeDimensionRoles(input)).toEqual(expected)
    expect(expected.mayEraseSourceStrokes).toBe(false)
  })

  it('returns detached point and source snapshots without modifying the prepared input', () => {
    const input = fixture()
    const before = structuredClone(input)
    const result = automaticNativeDimensionRoles(input)
    const candidate = result.candidates[0]
    if (!candidate) throw new Error('Missing dimension candidate')
    candidate.rail.start.x = 999
    candidate.spanEnds[0].y = 999
    const tick = candidate.ticks[0]
    if (tick) tick.end.x = 999
    result.source.sha256 = 'c'.repeat(64)
    result.rasterSource.page = 5
    expect(input).toEqual(before)
  })

  it('refuses more than the supported native text inventory before discovery', () => {
    const input = fixture()
    const label = input.native.labels[0]
    if (!label) throw new Error('Missing native label')
    input.native.labels = Array.from({ length: 1001 }, (_, index) => ({
      ...structuredClone(label),
      id: `native-text-${index}`,
      nativeIndex: index,
    }))
    expect(automaticNativeDimensionRoles(input)).toMatchObject({
      refusalReason: 'invalid-native-text-provenance',
      candidates: [],
      unresolved: [],
    })
  })

  it('withholds the whole report after bounded second-axis preparation exhausts discovery work', () => {
    const input = fixture()
    input.native.labels.push({
      id: 'native-text-20',
      nativeIndex: 20,
      name: '200',
      rotation: 90,
      pagePoint: { x: 168, y: 200 },
      point: { x: 168, y: 200 },
    })
    const depth: PdfVectorPath[] = [
      {
        operationIndex: 10,
        subpathIndex: 0,
        paint: 'stroke',
        closed: false,
        points: [
          { x: 170, y: 100 },
          { x: 170, y: 300 },
        ],
      },
      {
        operationIndex: 11,
        subpathIndex: 0,
        paint: 'stroke',
        closed: false,
        points: [
          { x: 175, y: 95 },
          { x: 165, y: 105 },
        ],
      },
      {
        operationIndex: 12,
        subpathIndex: 0,
        paint: 'stroke',
        closed: false,
        points: [
          { x: 175, y: 295 },
          { x: 165, y: 305 },
        ],
      },
    ]
    input.work.paths.push(...depth)
    expect(automaticNativeDimensionRoles(input).candidates).toHaveLength(2)
    for (let index = 0; index < 1100; index++)
      input.work.paths.push({
        operationIndex: 100 + index,
        subpathIndex: 0,
        paint: 'stroke',
        closed: false,
        points: [
          { x: 500, y: 10 + index * 0.75 },
          { x: 700, y: 10 + index * 0.75 },
        ],
      })
    const before = structuredClone(input)
    expect(automaticNativeDimensionRoles(input)).toMatchObject({
      refusalReason: 'dimension-discovery-budget',
      candidates: [],
      unresolved: [],
    })
    expect(input).toEqual(before)
  })
})
