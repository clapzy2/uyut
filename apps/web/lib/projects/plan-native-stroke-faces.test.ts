import { describe, expect, it } from 'vitest'
import { boundedNativeStrokeFaces } from './plan-native-stroke-faces'
import type { NativePageSegment } from './plan-pdf-opening-endpoint'

const segment = (
  operationIndex: number,
  x1: number,
  y1: number,
  x2: number,
  y2: number,
): NativePageSegment => ({
  operationIndex,
  subpathIndex: 0,
  segmentIndex: 0,
  start: { x: x1, y: y1 },
  end: { x: x2, y: y2 },
})
describe('computed bounded crossings and numerical ambiguity', () => {
  const unrelatedRows = Array.from({ length: 720 }, (_, index) =>
    segment(index + 100, 0, 200 + index / 2, 1000, 200 + index / 2),
  )

  it('does not spend the exact contact budget on disjoint annotation rows', () => {
    const outline = [
      segment(0, 100, 100, 150, 100),
      segment(1, 150, 100, 150, 150),
      segment(2, 150, 150, 100, 150),
      segment(3, 100, 150, 100, 100),
    ]
    const result = boundedNativeStrokeFaces([...outline, ...unrelatedRows])
    expect(result.refusalReason).toBeNull()
    expect(result.faces).toHaveLength(1)
    expect(result.faces[0]?.edges.flatMap((edge) => edge.sourceRefs)).toEqual(outline)
    expect(result.intersections).toEqual([])
  })

  it('still holds dense overlapping source boxes at the unchanged contact budget', () => {
    const input = Array.from({ length: 720 }, (_, index) => segment(index, 0, 200, 1000, 200))
    expect(boundedNativeStrokeFaces(input)).toMatchObject({
      refusalReason: 'intersection-budget',
      faces: [],
      intersections: [],
    })
  })

  it('preserves the nearby-cut refusal among unrelated annotation rows', () => {
    expect(
      boundedNativeStrokeFaces([
        ...unrelatedRows,
        segment(0, 0, 5, 10, 5),
        segment(1, 0, 0, 10, 9.9999999999998),
        segment(2, 5, 5, 5, 10),
      ]),
    ).toMatchObject({
      refusalReason: 'ambiguous-nearby-intersections',
      faces: [],
      intersections: [],
    })
  })

  it('refuses distinct rational vertices that alias to one floating point coordinate', () => {
    expect(
      boundedNativeStrokeFaces([
        segment(0, 0, 1, 3, 1),
        segment(1, 1, 0, 1.0000000000000002, 2),
        segment(2, 1, 1, 1, 2),
      ]),
    ).toMatchObject({ refusalReason: 'unrepresentable-intersection', faces: [] })
  })
  it('keeps faces exactly at the caller area threshold', () => {
    const result = boundedNativeStrokeFaces(
      [
        segment(0, 100, 100, 400, 100),
        segment(1, 400, 100, 400, 400),
        segment(2, 400, 400, 100, 400),
        segment(3, 100, 400, 100, 100),
      ],
      90000,
    )
    expect(result.faces).toHaveLength(1)
  })
  it('reuses exactly equal rational native endpoints without a floating conversion gap', () => {
    const value = 100.23456790012347
    const result = boundedNativeStrokeFaces([
      segment(0, 0, 200, 300, 200),
      segment(1, value - 1, 199, value + 1, 201),
      segment(2, value, 200, value, 300),
    ])
    expect(result.refusalReason).toBeNull()
    expect(result.intersections[0]?.point).toEqual({ x: value, y: 200 })
  })
  it('refuses unsupported precision rather than rounding the source coordinate', () => {
    expect(boundedNativeStrokeFaces([segment(0, 1e-20, 100, 400, 100)])).toMatchObject({
      refusalReason: 'unsupported-coordinate-precision',
      faces: [],
    })
  })
  it('preserves geometry when source order and stroke directions are reversed', () => {
    const input = [
      segment(0, 100, 100, 400, 100),
      segment(1, 400, 100, 400, 400),
      segment(2, 400, 400, 100, 400),
      segment(3, 100, 400, 100, 100),
      segment(4, 50, 150, 450, 350),
    ]
    const before = structuredClone(input)
    const first = boundedNativeStrokeFaces(input)
    const second = boundedNativeStrokeFaces(
      [...input].reverse().map((edge) => ({ ...edge, start: edge.end, end: edge.start })),
    )
    expect(first.refusalReason).toBeNull()
    expect(second.refusalReason).toBeNull()
    const areas = (result: typeof first) =>
      result.faces
        .map(
          (face) =>
            face.polygon.reduce((sum, point, index) => {
              const next = face.polygon[(index + 1) % face.polygon.length]
              return next ? sum + point.x * next.y - next.x * point.y : sum
            }, 0) / 2,
        )
        .sort((a, b) => a - b)
    expect(areas(first)).toEqual([45000, 45000])
    expect(areas(second)).toEqual(areas(first))
    for (const proof of [...first.intersections, ...second.intersections])
      proof.sourceRefs.forEach((ref, index) => {
        const t = proof.parameters[index] as number
        expect(
          Math.hypot(
            ref.start.x + t * (ref.end.x - ref.start.x) - proof.point.x,
            ref.start.y + t * (ref.end.y - ref.start.y) - proof.point.y,
          ),
        ).toBeLessThan(1e-9)
      })
    expect(input).toEqual(before)
  })
  it('refuses a later exact cut near an earlier computed cut instead of snapping', () => {
    const input = [
      segment(0, 0, 5, 10, 5),
      segment(1, 0, 0, 10, 9.9999999999998),
      segment(2, 5, 5, 5, 10),
    ]
    const result = boundedNativeStrokeFaces(input)
    expect(result).toMatchObject({
      refusalReason: 'ambiguous-nearby-intersections',
      faces: [],
      intersections: [],
    })
    expect(boundedNativeStrokeFaces([...input].reverse()).refusalReason).toBe(result.refusalReason)
  })
  it('refuses ill-conditioned near-parallel crossings', () => {
    expect(
      boundedNativeStrokeFaces([
        segment(0, 100, 100, 900, 900),
        segment(1, 100, 100 + 1e-10, 900, 900 - 1e-10),
      ]),
    ).toMatchObject({ refusalReason: 'ill-conditioned-intersection', faces: [] })
  })
  it('splits exact collinear diagonal overlaps without losing either source support', () => {
    const input = [
      segment(0, 100, 100, 400, 250),
      segment(1, 400, 250, 100, 400),
      segment(2, 100, 400, 100, 100),
      segment(3, 200, 150, 300, 200),
    ]
    const result = boundedNativeStrokeFaces(input)
    expect(result.refusalReason).toBeNull()
    expect(result.faces).toHaveLength(1)
    expect(result.faces[0]?.edges.some((edge) => edge.sourceRefs.length === 2)).toBe(true)
  })
})

describe('opt-in exact positive-paint topology', () => {
  const options = { topology: 'source-decimal-rational' } as const
  const rectangle = [
    segment(0, 0, 0, 10, 0),
    segment(1, 10, 0, 10, 10),
    segment(2, 10, 10, 0, 10),
    segment(3, 0, 10, 0, 0),
  ]
  it('retains distinct nearby bounded rational cuts without snapping', () => {
    const input = [
      ...rectangle,
      segment(4, 0, 5, 10, 5),
      segment(5, 0, 0, 10, 9.9999999999998),
      segment(6, 5, 5, 5, 10),
    ]
    expect(boundedNativeStrokeFaces(input).refusalReason).toBe('ambiguous-nearby-intersections')
    const result = boundedNativeStrokeFaces(input, 0, options)
    expect(result.refusalReason).toBeNull()
    expect(result.faces.length).toBeGreaterThan(1)
    const nodes = new Set(result.faces.flatMap((face) => face.exactPointKeys ?? []))
    expect(nodes.has('5/1:5/1')).toBe(true)
    expect(nodes.has(result.intersections[0]?.exactPointKey as string)).toBe(true)
    expect(
      result.intersections.some((proof) => proof.point.x > 5 && proof.point.x < 5 + 1e-9),
    ).toBe(true)
    const canonical = (value: typeof result) =>
      value.faces.map((face) => [...(face.exactPointKeys ?? [])].sort().join('|')).sort()
    const reversed = boundedNativeStrokeFaces(
      [...input].reverse().map((edge) => ({ ...edge, start: edge.end, end: edge.start })),
      0,
      options,
    )
    expect(reversed.refusalReason).toBeNull()
    expect(canonical(reversed)).toEqual(canonical(result))
  })
  it('still refuses distinct rational vertices with identical display coordinates', () => {
    const result = boundedNativeStrokeFaces(
      [segment(0, 0, 1, 3, 1), segment(1, 1, 0, 1.0000000000000002, 2), segment(2, 1, 1, 1, 2)],
      0,
      options,
    )
    expect(result).toMatchObject({ refusalReason: 'unrepresentable-intersection', faces: [] })
  })
  it('preserves a representable tiny face and its exact area threshold', () => {
    const input = [
      segment(0, 100, 100, 100.0000000001, 100),
      segment(1, 100.0000000001, 100, 100.0000000001, 200),
      segment(2, 100.0000000001, 200, 100, 200),
      segment(3, 100, 200, 100, 100),
    ]
    expect(boundedNativeStrokeFaces(input, 1e-8, options).faces).toHaveLength(1)
    expect(boundedNativeStrokeFaces(input, 1.00000000001e-8, options).faces).toHaveLength(0)
  })
  it('orders almost parallel rays exactly while retaining the default physical guard', () => {
    const input = [
      ...rectangle,
      segment(4, 0, 0, 10, 10),
      segment(5, 0, 1e-13, 10, 9.9999999999999),
    ]
    expect(boundedNativeStrokeFaces(input.slice(4)).refusalReason).toBe(
      'ill-conditioned-intersection',
    )
    const result = boundedNativeStrokeFaces(input, 0, options)
    expect(result.refusalReason).toBeNull()
    expect(result.faces).toHaveLength(4)
    expect(result.intersections[0]?.exactPointKey).toBe('5/1:5/1')
  })
  it('does not accept a ring containing disconnected interior evidence as a holeless face', () => {
    const result = boundedNativeStrokeFaces([...rectangle, segment(4, 4, 4, 6, 6)], 0, options)
    expect(result.refusalReason).toBeNull()
    expect(result.faces).toHaveLength(0)
  })
  it('splits shared diagonal edges and keeps every supporting source reference', () => {
    const result = boundedNativeStrokeFaces(
      [
        segment(0, 100, 100, 400, 250),
        segment(1, 400, 250, 100, 400),
        segment(2, 100, 400, 100, 100),
        segment(3, 200, 150, 300, 200),
      ],
      0,
      options,
    )
    expect(result.refusalReason).toBeNull()
    expect(result.faces).toHaveLength(1)
    expect(result.faces[0]?.edges.some((edge) => edge.sourceRefs.length === 2)).toBe(true)
    expect(result.faces[0]?.exactPointKeys).toHaveLength(5)
  })
})
