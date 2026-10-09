import { describe, expect, it } from 'vitest'
import {
  createNativeCaptionMatcher,
  type NativeCaptionRail,
  type NativeDimensionCaptionContext,
} from './plan-pdf-caption-binding'
import type { PdfLinework } from './plan-pdf-linework'

const source = { sha256: 'a'.repeat(64), pdfPage: 3, state: 'existing' as const }
const work: PdfLinework = {
  coordinateSystem: 'page-0-1000',
  pageWidth: 500,
  pageHeight: 500,
  paths: [],
  skippedCurves: 0,
  clippedPaths: 0,
  unsupportedPaths: 0,
  unsupportedContexts: 0,
  truncated: false,
}
function fixture(side: 'before' | 'after' = 'after', axis: 'width' | 'depth' = 'width') {
  const point = (along: number, across: number) =>
    axis === 'width' ? { x: along, y: across } : { x: across, y: along }
  const rails: NativeCaptionRail[] = [
    [10, 110],
    [110, 120],
    [120, 320],
  ].map(([start = 0, end = 0], index) => ({
    start: point(start, 100),
    end: point(end, 100),
    operationIndex: index,
    subpathIndex: 0,
    branched: false,
  }))
  if (rails[1]) rails[1].outboard = { start: point(106, 100), end: point(124, 100) }
  const caption = (index: number, text: string, low: number, high: number) => {
    const first = axis === 'width' ? low : high
    const last = axis === 'width' ? high : low
    return {
      index,
      text,
      rotation: axis === 'width' ? 0 : 90,
      origin: point(first, 96),
      baselineStart: point(first, 96),
      baselineEnd: point(last, 96),
    }
  }
  const context: NativeDimensionCaptionContext = {
    source: { ...source, pageWidth: 500, pageHeight: 500 },
    complete: true,
    items: [
      caption(0, '1000', 50, 70),
      caption(1, '100', side === 'after' ? 124 : 76, side === 'after' ? 154 : 106),
      caption(2, '2000', 210, 230),
    ],
  }
  const target = context.items[1]
  if (!target) throw new Error('Missing caption')
  const label = () => ({
    index: target.index,
    text: target.text,
    rotation: target.rotation,
    ...target.origin,
  })
  return { rails, context, target, label, axis }
}

describe('native caption-run to rail binding, not room measurement acceptance', () => {
  it.each(['before', 'after'] as const)(
    'binds an outboard short caption %s using exact tick and two neighbours',
    (side) => {
      const data = fixture(side)
      const before = structuredClone({ rails: data.rails, context: data.context })
      const match = createNativeCaptionMatcher(
        work,
        source,
        data.rails,
        data.context,
        data.axis,
      )(data.label())
      expect(match).toMatchObject({
        status: 'candidate',
        basis: 'outboard-caption',
        span: data.rails[1],
      })
      expect(data.rails).toEqual(before.rails)
      expect(data.context).toEqual(before.context)
    },
  )
  it('supports the same structural rule along the vertical axis', () => {
    const data = fixture('before', 'depth')
    expect(
      createNativeCaptionMatcher(work, source, data.rails, data.context, data.axis)(data.label()),
    ).toMatchObject({ status: 'candidate', span: data.rails[1] })
  })
  it('binds a normal caption by its baseline midpoint rather than the text origin', () => {
    const data = fixture()
    const target = data.context.items[2]
    if (!target) throw new Error('Missing caption')
    expect(
      createNativeCaptionMatcher(
        work,
        source,
        data.rails,
        data.context,
        'width',
      )({ index: target.index, text: target.text, rotation: 0, ...target.origin }),
    ).toMatchObject({ status: 'candidate', basis: 'centered-caption', span: data.rails[2] })
  })
  it.each([
    'missing-marker',
    'marker-moved',
    'missing-left',
    'missing-right',
    'bad-ratio',
    'fits-inside',
  ] as const)('does not choose the long rail or invent a dimension for %s', (failure) => {
    const data = fixture()
    const short = data.rails[1]
    if (!short) throw new Error('Missing short rail')
    if (failure === 'missing-marker') delete short.outboard
    if (failure === 'marker-moved' && short.outboard) short.outboard.end.x += 1
    if (failure === 'missing-left') data.rails.shift()
    if (failure === 'missing-right') data.rails.pop()
    if (failure === 'bad-ratio') data.target.text = '125'
    if (failure === 'fits-inside') data.target.baselineEnd.x = 125
    expect(
      createNativeCaptionMatcher(work, source, data.rails, data.context, 'width')(data.label())
        .status,
    ).toBe('unresolved')
    if (failure === 'bad-ratio') expect(data.target.text).toBe('125')
  })
  it('refuses ambiguous reference captions even when one rail is adjacent', () => {
    const data = fixture()
    data.rails.push({
      start: { x: 20, y: 100 },
      end: { x: 100, y: 100 },
      operationIndex: 9,
      subpathIndex: 0,
      branched: false,
    })
    expect(
      createNativeCaptionMatcher(work, source, data.rails, data.context, 'width')(data.label())
        .status,
    ).toBe('unresolved')
  })
  it('does not select among competing definitions of one rail', () => {
    const data = fixture()
    const other = data.rails[2]
    const target = data.context.items[2]
    if (!other || !target) throw new Error('Missing control')
    data.rails.push({ ...other, end: { ...other.end, x: 330 } })
    expect(
      createNativeCaptionMatcher(
        work,
        source,
        data.rails,
        data.context,
        'width',
      )({ index: target.index, text: target.text, rotation: 0, ...target.origin }).status,
    ).toBe('ambiguous')
  })
  it('does not discard a branch merely because another matching rail is clean', () => {
    const data = fixture()
    if (data.rails[1]) data.rails[1].branched = true
    expect(
      createNativeCaptionMatcher(work, source, data.rails, data.context, 'width')(data.label())
        .status,
    ).toBe('ambiguous')
  })
  it.each(['outboard', 'centered'] as const)(
    'refuses a competing %s caption on the short target',
    (kind) => {
      const data = fixture()
      const extra = structuredClone(data.target)
      extra.index = 50
      if (kind === 'centered') {
        extra.origin = { x: 114, y: 96 }
        extra.baselineStart = { x: 114, y: 96 }
        extra.baselineEnd = { x: 116, y: 96 }
      }
      data.context.items.push(extra)
      expect(
        createNativeCaptionMatcher(work, source, data.rails, data.context, 'width')(data.label())
          .status,
      ).toBe('ambiguous')
      expect(
        createNativeCaptionMatcher(
          work,
          source,
          data.rails,
          data.context,
          'width',
        )({ index: extra.index, text: extra.text, rotation: extra.rotation, ...extra.origin })
          .status,
      ).toBe('ambiguous')
    },
  )
  it('does not hide a collinear overlapping alternative behind uniquely centered neighbours', () => {
    const data = fixture()
    data.rails.push({
      start: { x: 110, y: 100 },
      end: { x: 320, y: 100 },
      operationIndex: 99,
      subpathIndex: 0,
      branched: false,
    })
    expect(
      createNativeCaptionMatcher(work, source, data.rails, data.context, 'width')(data.label())
        .status,
    ).toBe('ambiguous')
  })
  it.each([
    'hash',
    'page',
    'frame',
    'incomplete',
    'duplicate-index',
    'changed-origin',
    'nonfinite',
    'zero-rail',
    'wrong-direction',
  ] as const)('refuses corrupted or unavailable native context %s', (failure) => {
    const data = fixture()
    if (failure === 'hash') data.context.source.sha256 = 'b'.repeat(64)
    if (failure === 'page') data.context.source.pdfPage = 4
    if (failure === 'frame') data.context.source.pageWidth = 400
    if (failure === 'incomplete') data.context.complete = false
    if (failure === 'duplicate-index') data.context.items.push(structuredClone(data.target))
    if (failure === 'changed-origin') data.target.origin.x += 3
    if (failure === 'nonfinite') data.target.baselineEnd.x = Number.NaN
    if (failure === 'wrong-direction') data.target.rotation = 180
    if (failure === 'zero-rail' && data.rails[1]) data.rails[1].end = { ...data.rails[1].start }
    expect(
      createNativeCaptionMatcher(work, source, data.rails, data.context, 'width')(data.label())
        .status,
    ).toBe('unresolved')
  })
  it('does not use another native run with the same text after an index mismatch', () => {
    const data = fixture()
    const label = data.label()
    label.index = 20
    expect(
      createNativeCaptionMatcher(work, source, data.rails, data.context, 'width')(label).status,
    ).toBe('unresolved')
  })
  it('caps search work before a crowded caption/rail context becomes accepted', () => {
    const data = fixture()
    data.rails = Array.from({ length: 5000 }, (_, index) => ({
      ...(data.rails[0] as NativeCaptionRail),
      operationIndex: index,
    }))
    data.context.items = Array.from({ length: 1000 }, (_, index) => ({ ...data.target, index }))
    expect(
      createNativeCaptionMatcher(work, source, data.rails, data.context, 'width')(data.label()),
    ).toMatchObject({ status: 'unresolved', reason: 'caption-binding-budget-exceeded' })
  })
})
