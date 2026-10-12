import { describe, expect, it } from 'vitest'
import { nativeFaceRationalPredicates } from './plan-native-face-rational'

const diagonal = ['1/3:1/3', '2/3:2/3', '4/3:4/3', '7/3:7/3'] as const
const span = (startKey: string, endKey: string) => ({ startKey, endKey })

describe('exact rational boundary span predicates', () => {
  it('computes orientation without reducing thirds to display coordinates', () => {
    const exact = nativeFaceRationalPredicates()
    expect(exact.orientation(diagonal[0], diagonal[3], diagonal[1])).toBe(0)
    expect(exact.orientation(diagonal[0], diagonal[3], '2/3:4/3')).toBe(1)
    expect(exact.orientation(diagonal[0], diagonal[3], '4/3:2/3')).toBe(-1)
    expect(exact.orientation(diagonal[3], diagonal[0], '2/3:4/3')).toBe(-1)
    expect(
      exact.orientation(diagonal[0], diagonal[3], '2/3:666666666666666667/1000000000000000000'),
    ).toBe(1)
  })

  it.each([
    [diagonal[0], diagonal[3], diagonal[1], '8/3:8/3'],
    [diagonal[3], diagonal[0], diagonal[1], '8/3:8/3'],
    [diagonal[0], diagonal[3], '8/3:8/3', diagonal[1]],
    [diagonal[3], diagonal[0], '8/3:8/3', diagonal[1]],
  ])('keeps the same canonical overlap for reversed endpoints %s → %s', (a, b, c, d) => {
    expect(nativeFaceRationalPredicates().sharedSpan(a, b, c, d)).toEqual(
      span(diagonal[1], diagonal[3]),
    )
  })

  it('retains complete and contained diagonal spans without introducing new endpoints', () => {
    const exact = nativeFaceRationalPredicates()
    expect(exact.sharedSpan(diagonal[0], diagonal[3], diagonal[3], diagonal[0])).toEqual(
      span(diagonal[0], diagonal[3]),
    )
    expect(exact.sharedSpan(diagonal[0], diagonal[3], diagonal[2], diagonal[1])).toEqual(
      span(diagonal[1], diagonal[2]),
    )
  })

  it('orders vertical overlap by Y and negative-slope overlap by X', () => {
    const exact = nativeFaceRationalPredicates()
    expect(exact.sharedSpan('1/3:7/3', '1/3:1/3', '1/3:2/3', '1/3:8/3')).toEqual(
      span('1/3:2/3', '1/3:7/3'),
    )
    expect(exact.sharedSpan('1/3:7/3', '7/3:1/3', '4/3:4/3', '8/3:0/1')).toEqual(
      span('4/3:4/3', '7/3:1/3'),
    )
  })

  it.each([
    [diagonal[0], diagonal[1], diagonal[1], diagonal[3]],
    [diagonal[0], diagonal[1], diagonal[2], diagonal[3]],
    [diagonal[0], diagonal[3], '1/3:2/3', '7/3:8/3'],
    [diagonal[0], diagonal[3], '1/3:7/3', '7/3:1/3'],
    [diagonal[0], diagonal[0], diagonal[0], diagonal[3]],
    [diagonal[0], diagonal[3], diagonal[1], diagonal[1]],
  ])(
    'does not turn endpoint-only, disjoint, displaced or crossing lines into a span',
    (a, b, c, d) => {
      expect(nativeFaceRationalPredicates().sharedSpan(a, b, c, d)).toBeNull()
    },
  )

  it('does not widen an almost coincident diagonal into an exact contact', () => {
    expect(
      nativeFaceRationalPredicates().sharedSpan(
        diagonal[0],
        diagonal[3],
        '2/3:666666666666666667/1000000000000000000',
        '4/3:1333333333333333334/1000000000000000000',
      ),
    ).toBeNull()
  })

  it('joins adjacent reversed diagonal spans in any order', () => {
    const exact = nativeFaceRationalPredicates()
    const spans = [
      span(diagonal[3], diagonal[2]),
      span(diagonal[0], diagonal[1]),
      span(diagonal[2], diagonal[1]),
    ]
    const before = structuredClone(spans)
    expect(exact.coversSpan(diagonal[0], diagonal[3], spans)).toBe(true)
    expect(exact.coversSpan(diagonal[3], diagonal[0], spans)).toBe(true)
    expect(spans).toEqual(before)
  })

  it('allows redundant overlap as geometric coverage, not a uniqueness proof', () => {
    expect(
      nativeFaceRationalPredicates().coversSpan(diagonal[0], diagonal[3], [
        span(diagonal[0], diagonal[2]),
        span(diagonal[1], diagonal[3]),
      ]),
    ).toBe(true)
  })

  it('clips supplied coverage to the bounded target, including vertical thirds', () => {
    const exact = nativeFaceRationalPredicates()
    expect(exact.coversSpan(diagonal[1], diagonal[2], [span(diagonal[0], diagonal[3])])).toBe(true)
    expect(
      exact.coversSpan('1/3:1/3', '1/3:7/3', [
        span('1/3:0/1', '1/3:2/3'),
        span('1/3:8/3', '1/3:2/3'),
      ]),
    ).toBe(true)
  })

  it.each(
    [
      [],
      [span(diagonal[1], diagonal[3])],
      [span(diagonal[0], diagonal[2])],
      [span(diagonal[0], diagonal[1]), span(diagonal[2], diagonal[3])],
      [span(diagonal[0], diagonal[0]), span(diagonal[3], diagonal[3])],
      [span('1/3:2/3', '7/3:8/3')],
      [span('1/3:7/3', '7/3:1/3')],
    ].map((spans) => ({ spans })),
  )('keeps missing, partial, gapped and noncollinear support incomplete', ({ spans }) => {
    expect(nativeFaceRationalPredicates().coversSpan(diagonal[0], diagonal[3], spans)).toBe(false)
  })

  it('keeps a sub-double rational gap open', () => {
    const afterThird =
      '666666666666666667/1000000000000000000:666666666666666667/1000000000000000000'
    expect(
      nativeFaceRationalPredicates().coversSpan(diagonal[0], diagonal[3], [
        span(diagonal[0], diagonal[1]),
        span(afterThird, diagonal[3]),
      ]),
    ).toBe(false)
  })

  it('does not call a zero-length target covered', () => {
    expect(
      nativeFaceRationalPredicates().coversSpan(diagonal[1], diagonal[1], [
        span(diagonal[0], diagonal[3]),
      ]),
    ).toBe(false)
  })
})

describe('exact rational ring winding', () => {
  const outer = ['1/3:1/3', '7/3:1/3', '7/3:7/3', '1/3:7/3']
  const hole = ['2/3:2/3', '4/3:2/3', '4/3:4/3', '2/3:4/3']

  it('distinguishes CW and CCW while retaining source ring order', () => {
    const exact = nativeFaceRationalPredicates()
    const before = [...outer]
    expect(exact.winding(outer)).toBe(1)
    expect(exact.winding([...outer].reverse())).toBe(-1)
    expect(outer).toEqual(before)
  })

  it('reports hole winding independently of its interior/exterior semantic role', () => {
    const exact = nativeFaceRationalPredicates()
    expect(exact.winding(hole)).toBe(1)
    expect(exact.winding([...hole].reverse())).toBe(-1)
    expect(exact.location(outer, hole[0] as string)).toBe('inside')
    // Whether free floor is on the hole exterior is the caller's explicit ring role,
    // not a deduction from this orientation alone.
    expect(exact.location(hole, '1/1:1/1')).toBe('inside')
  })

  it('keeps degenerate area neutral rather than inventing an interior side', () => {
    const exact = nativeFaceRationalPredicates()
    expect(exact.winding([diagonal[0], diagonal[1], diagonal[3]])).toBe(0)
    expect(exact.winding([])).toBe(0)
    expect(exact.winding([diagonal[0]])).toBe(0)
  })
})
