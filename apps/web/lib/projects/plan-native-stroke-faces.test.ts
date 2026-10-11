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
