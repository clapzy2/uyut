import { afterEach, describe, expect, it, vi } from 'vitest'
import type { NativeTextAnchors } from './plan-document'
import { nativeCaptionBindings } from './plan-native-caption-bindings'
import * as chains from './plan-pdf-dimension-chain'
import type { PdfLinework, PdfVectorPath } from './plan-pdf-linework'

function fixture(axis: 'width' | 'depth' = 'width') {
  const source = { sha256: 'b'.repeat(64), pdfPage: 1, state: 'existing' as const }
  const frame = { sha256: 'a'.repeat(64), page: 1, width: 1000, height: 1000 }
  const point = (along: number, across: number) =>
    axis === 'width' ? { x: along, y: across } : { x: across, y: along }
  const origin = point(axis === 'width' ? 191 : 209, 168)
  const end = point(axis === 'width' ? 209 : 191, 168)
  const rotation = axis === 'width' ? 0 : 90
  const native: NativeTextAnchors = {
    source: frame,
    originalPdfSha256: source.sha256,
    complete: true,
    pageNormalizedScale: { x: 1, y: 1 },
    labels: [
      {
        id: 'native-text-2',
        nativeIndex: 2,
        compactIndex: 0,
        name: 'Кухня',
        rotation: 0,
        point: { x: 50, y: 50 },
        pagePoint: { x: 50, y: 50 },
      },
      {
        id: 'native-text-10',
        nativeIndex: 10,
        compactIndex: 1,
        name: '200',
        rotation,
        point: { ...origin },
        pagePoint: { ...origin },
      },
    ],
    compactCaptionGeometry: {
      source: { sha256: source.sha256, pdfPage: 1, pageWidth: 1000, pageHeight: 1000 },
      complete: true,
      items: [
        {
          index: 1,
          text: '200',
          rotation,
          origin: { ...origin },
          baselineStart: { ...origin },
          baselineEnd: end,
        },
      ],
    },
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
      stroke(1, [point(100, 170), point(300, 170)]),
      stroke(2, [point(95, 175), point(105, 165)]),
      stroke(3, [point(295, 175), point(305, 165)]),
    ],
    skippedCurves: 0,
    clippedPaths: 0,
    unsupportedPaths: 0,
    unsupportedContexts: 0,
    truncated: false,
  }
  return { native, work, source, lineworkSource: frame }
}
function present<T>(value: T | undefined): T {
  if (value === undefined) throw new Error('Missing fixture value')
  return value
}
const label = (input: ReturnType<typeof fixture>) => present(input.native.labels[1])
const compact = (input: ReturnType<typeof fixture>) => present(input.native.compactCaptionGeometry)
const caption = (input: ReturnType<typeof fixture>) => present(compact(input).items[0])

function outboardFixture() {
  const input = fixture()
  input.work.pageWidth = 500
  input.work.pageHeight = 500
  compact(input).source.pageWidth = 500
  compact(input).source.pageHeight = 500
  const runs = [
    { text: '1000', low: 50, high: 70 },
    { text: '100', low: 124, high: 154 },
    { text: '2000', low: 210, high: 230 },
  ]
  compact(input).items = runs.map((run, index) => ({
    index,
    text: run.text,
    rotation: 0,
    origin: { x: run.low, y: 96 },
    baselineStart: { x: run.low, y: 96 },
    baselineEnd: { x: run.high, y: 96 },
  }))
  input.native.labels = runs.map((run, index) => ({
    id: `native-text-${10 + index}`,
    nativeIndex: 10 + index,
    compactIndex: index,
    name: run.text,
    rotation: 0,
    point: { x: run.low, y: 96 },
    pagePoint: { x: run.low, y: 96 },
  }))
  const stroke = (operationIndex: number, points: PdfVectorPath['points']): PdfVectorPath => ({
    operationIndex,
    subpathIndex: 0,
    paint: 'stroke',
    closed: false,
    points,
  })
  input.work.paths = [
    stroke(1, [
      { x: 10, y: 100 },
      { x: 110, y: 100 },
    ]),
    stroke(2, [
      { x: 110, y: 100 },
      { x: 120, y: 100 },
    ]),
    stroke(3, [
      { x: 120, y: 100 },
      { x: 320, y: 100 },
    ]),
    ...[10, 110, 120, 320].map((x, index) =>
      stroke(4 + index, [
        { x: x - 4, y: 104 },
        { x: x + 4, y: 96 },
      ]),
    ),
  ]
  return input
}

afterEach(() => vi.restoreAllMocks())

describe('explicit original-native caption bridge, not metric/room acceptance', () => {
  it.each(['width', 'depth'] as const)(
    'binds an actual %s run with distinct original and compact IDs',
    (axis) => {
      const input = fixture(axis)
      const before = structuredClone(input)
      const result = nativeCaptionBindings(input)
      expect(result).toMatchObject({
        status: 'draft',
        refusalReason: null,
        readOnly: true,
        mayTransfer2D: false,
        mayTransfer3D: false,
      })
      expect(result.candidates).toEqual([
        {
          labelId: 'native-text-10',
          compactIndex: 1,
          valueMm: 200,
          axis,
          rail: { operationIndex: 1, subpathIndex: 0 },
        },
      ])
      expect(result.unresolved).toEqual([])
      expect(input).toEqual(before)
      present(result.candidates[0]).rail.operationIndex = 99
      result.source.sha256 = 'f'.repeat(64)
      expect(input).toEqual(before)
    },
  )
  it('does not invent a compact context or fall back to an origin-only role', () => {
    const input = fixture()
    delete input.native.compactCaptionGeometry
    expect(nativeCaptionBindings(input)).toMatchObject({
      status: 'unresolved',
      refusalReason: 'native-caption-bridge-unavailable',
      candidates: [],
      unresolved: [],
    })
  })
  it.each(['sha256', 'pdfPage', 'pageWidth', 'pageHeight'] as const)(
    'rejects foreign compact %s metadata',
    (key) => {
      const input = fixture()
      const source = compact(input).source
      if (key === 'sha256') source[key] = 'c'.repeat(64)
      else source[key]++
      expect(nativeCaptionBindings(input).refusalReason).toBe('invalid-native-caption-bridge')
    },
  )
  it.each(['native', 'compact'] as const)('holds incomplete %s extraction', (layer) => {
    const input = fixture()
    if (layer === 'native') input.native.complete = false
    else compact(input).complete = false
    expect(nativeCaptionBindings(input).candidates).toEqual([])
    expect(nativeCaptionBindings(input).status).toBe('unresolved')
  })
  it.each([undefined, -1, 0, 2, 1.5, Number.NaN])(
    'rejects invalid or reused compact slot %s',
    (index) => {
      const input = fixture()
      label(input).compactIndex = index
      expect(nativeCaptionBindings(input).refusalReason).toBe('invalid-native-caption-bridge')
    },
  )
  it.each(['missing', 'extra', 'duplicate', 'nonnumeric'] as const)(
    'requires the entire numeric inventory: %s',
    (kind) => {
      const input = fixture()
      const items = compact(input).items
      if (kind === 'missing') items.pop()
      else if (kind === 'extra') items.push({ ...structuredClone(caption(input)), index: 5 })
      else if (kind === 'duplicate') items.push(structuredClone(caption(input)))
      else caption(input).text = 'Кухня'
      expect(nativeCaptionBindings(input).refusalReason).toBe('invalid-native-caption-bridge')
    },
  )
  it('rejects a moved native origin even inside the same rounded bucket', () => {
    const input = fixture()
    present(label(input).pagePoint).x += 0.4
    label(input).point.x += 0.4
    expect(Math.round(present(label(input).pagePoint).x)).toBe(caption(input).origin.x)
    expect(nativeCaptionBindings(input).refusalReason).toBe('invalid-native-caption-bridge')
  })
  it('permits only tiny floating transform arithmetic difference, without moving source points', () => {
    const input = fixture()
    present(label(input).pagePoint).x += 1e-10
    label(input).point.x += 1e-10
    const before = structuredClone(input)
    expect(nativeCaptionBindings(input).candidates).toHaveLength(1)
    expect(input).toEqual(before)
  })
  it.each([0.3, 180, -90])(
    'does not canonicalize raw angle %s into an accepted cardinal caption',
    (rotation) => {
      const input = fixture()
      label(input).rotation = rotation
      caption(input).rotation = Math.round(rotation)
      const radians = (-rotation * Math.PI) / 180
      caption(input).baselineEnd = {
        x: caption(input).baselineStart.x + 18 * Math.cos(radians),
        y: caption(input).baselineStart.y + 18 * Math.sin(radians),
      }
      expect(nativeCaptionBindings(input)).toMatchObject({
        status: 'draft',
        candidates: [],
        unresolved: [
          { labelId: 'native-text-10', reason: 'unsupported-source-caption-orientation' },
        ],
      })
      expect(label(input).rotation).toBe(rotation)
    },
  )
  it('rejects invented width, direction, origin or text rather than repairing the run', () => {
    for (const change of [
      (input: ReturnType<typeof fixture>) => {
        caption(input).baselineEnd = { ...caption(input).baselineStart }
      },
      (input: ReturnType<typeof fixture>) => {
        caption(input).baselineEnd.y += 1
      },
      (input: ReturnType<typeof fixture>) => {
        caption(input).origin.x += 1
      },
      (input: ReturnType<typeof fixture>) => {
        caption(input).text = '201'
      },
    ]) {
      const input = fixture()
      change(input)
      expect(nativeCaptionBindings(input).refusalReason).toBe('invalid-native-caption-bridge')
    }
  })
  it('retains a genuine offset caption as held, without adjusting text midpoint or enlarging tolerance', () => {
    const input = fixture()
    caption(input).baselineEnd.x += 1
    expect(nativeCaptionBindings(input)).toMatchObject({
      status: 'draft',
      candidates: [],
      unresolved: [{ labelId: 'native-text-10', reason: 'caption-rail-unresolved' }],
    })
  })
  it('does not lose a competing repeated number or match it by equal text', () => {
    const input = fixture()
    input.native.labels.push({
      ...structuredClone(label(input)),
      id: 'native-text-20',
      nativeIndex: 20,
      compactIndex: 2,
    })
    compact(input).items.push({
      ...structuredClone(caption(input)),
      index: 2,
    })
    const result = nativeCaptionBindings(input)
    expect(result.candidates).toEqual([])
    expect(result.unresolved.map(({ reason }) => reason)).toEqual([
      'competing-native-captions',
      'competing-native-captions',
    ])
    present(input.native.labels[2]).compactIndex = 1
    label(input).compactIndex = 2
    expect(nativeCaptionBindings(input).candidates).toEqual([])
  })
  it('rejects swapped repeated same-text slots when their actual baselines differ', () => {
    const input = fixture()
    const second = structuredClone(label(input))
    second.id = 'native-text-20'
    second.nativeIndex = 20
    second.compactIndex = 2
    present(second.pagePoint).x += 20
    second.point.x += 20
    input.native.labels.push(second)
    const secondCaption = structuredClone(caption(input))
    secondCaption.index = 2
    secondCaption.origin.x += 20
    secondCaption.baselineStart.x += 20
    secondCaption.baselineEnd.x += 20
    compact(input).items.push(secondCaption)
    label(input).compactIndex = 2
    second.compactIndex = 1
    expect(nativeCaptionBindings(input).refusalReason).toBe('invalid-native-caption-bridge')
  })
  it('holds a nearby unsupported caption instead of silently removing it as a competitor', () => {
    const input = fixture()
    const second = structuredClone(label(input))
    second.id = 'native-text-20'
    second.nativeIndex = 20
    second.compactIndex = 2
    second.rotation = 0.3
    second.pagePoint = { x: 200, y: 169 }
    second.point = { ...second.pagePoint }
    input.native.labels.push(second)
    const radians = (-0.3 * Math.PI) / 180
    compact(input).items.push({
      index: 2,
      text: '200',
      rotation: 0,
      origin: { x: 200, y: 169 },
      baselineStart: { x: 200, y: 169 },
      baselineEnd: { x: 200 + 18 * Math.cos(radians), y: 169 + 18 * Math.sin(radians) },
    })
    expect(nativeCaptionBindings(input).unresolved.map(({ reason }) => reason)).toEqual([
      'unsupported-caption-near-source-rail',
      'unsupported-source-caption-orientation',
    ])
    expect(nativeCaptionBindings(input).candidates).toEqual([])
  })
  it.each(['clippedPaths', 'unsupportedPaths', 'unsupportedContexts', 'truncated'] as const)(
    'does not ignore source omission %s',
    (key) => {
      const input = fixture()
      if (key === 'truncated') input.work[key] = true
      else input.work[key] = 1
      expect(nativeCaptionBindings(input).refusalReason).toBe('incomplete-native-dimension-layer')
    },
  )
  it('holds omitted ink near the rail but preserves remote curve evidence', () => {
    const input = fixture()
    input.work.skippedCurves = 1
    input.work.skippedCurveBounds = [
      { operationIndex: 30, bounds: { left: 90, right: 110, top: 160, bottom: 180 } },
    ]
    expect(nativeCaptionBindings(input).unresolved).toEqual([
      { labelId: 'native-text-10', reason: 'omitted-ink-near-source-caption-rail' },
    ])
    present(input.work.skippedCurveBounds[0]).bounds = {
      left: 700,
      right: 710,
      top: 700,
      bottom: 710,
    }
    expect(nativeCaptionBindings(input).candidates).toHaveLength(1)
    expect(input.work.skippedCurves).toBe(1)
  })
  it('requires two unobscured independently centred witnesses for an outboard caption', () => {
    const input = outboardFixture()
    const result = nativeCaptionBindings(input)
    expect(result.candidates.map(({ valueMm }) => valueMm)).toEqual([1000, 100, 2000])
    expect(result.unresolved).toEqual([])
  })
  it.each([
    { name: 'far end of target baseline', left: 150, right: 153, top: 95, bottom: 97 },
    { name: 'left reference rail', left: 20, right: 21, top: 99, bottom: 101 },
    { name: 'right reference rail', left: 250, right: 251, top: 99, bottom: 101 },
  ])(
    'withholds the outboard result when omitted ink covers $name',
    ({ left, right, top, bottom }) => {
      const input = outboardFixture()
      input.work.skippedCurves = 1
      input.work.skippedCurveBounds = [{ operationIndex: 30, bounds: { left, right, top, bottom } }]
      const result = nativeCaptionBindings(input)
      expect(result.candidates.some(({ valueMm }) => valueMm === 100)).toBe(false)
      expect(result.unresolved.find(({ labelId }) => labelId === 'native-text-11')).toBeDefined()
      input.native.labels.reverse()
      input.work.paths.reverse()
      const reversed = nativeCaptionBindings(input)
      expect(reversed.candidates.sort((a, b) => a.labelId.localeCompare(b.labelId))).toEqual(
        result.candidates.sort((a, b) => a.labelId.localeCompare(b.labelId)),
      )
      expect(reversed.unresolved.sort((a, b) => a.labelId.localeCompare(b.labelId))).toEqual(
        result.unresolved.sort((a, b) => a.labelId.localeCompare(b.labelId)),
      )
    },
  )
  it.each([150, 250])(
    'does not ignore an unsupported run at %s in the target/reference evidence',
    (x) => {
      const input = outboardFixture()
      const radians = (-0.3 * Math.PI) / 180
      input.native.labels.push({
        id: 'native-text-40',
        nativeIndex: 40,
        compactIndex: 3,
        name: '999',
        rotation: 0.3,
        point: { x, y: 96 },
        pagePoint: { x, y: 96 },
      })
      compact(input).items.push({
        index: 3,
        text: '999',
        rotation: 0,
        origin: { x, y: 96 },
        baselineStart: { x, y: 96 },
        baselineEnd: { x: x + 3, y: 96 + 3 * Math.tan(radians) },
      })
      expect(nativeCaptionBindings(input).candidates.some(({ valueMm }) => valueMm === 100)).toBe(
        false,
      )
    },
  )
  it.each([1, 'true', undefined])(
    'does not treat truthy complete=%s as extraction proof',
    (value) => {
      const input = fixture()
      input.native.complete = value as unknown as boolean
      expect(nativeCaptionBindings(input).status).toBe('unresolved')
      input.native.complete = true
      compact(input).complete = value as unknown as boolean
      expect(nativeCaptionBindings(input).status).toBe('unresolved')
    },
  )
  it.each(['caption-binding-budget-exceeded', 'dimension-span-budget-exceeded'])(
    'clears earlier candidates atomically on late %s',
    (reason) => {
      const input = fixture()
      input.native.labels.push({
        ...structuredClone(label(input)),
        id: 'native-text-20',
        nativeIndex: 20,
        compactIndex: 2,
      })
      compact(input).items.push({
        ...structuredClone(caption(input)),
        index: 2,
      })
      const verify = vi
        .fn()
        .mockReturnValueOnce({
          status: 'candidate',
          ends: [
            { x: 100, y: 170 },
            { x: 300, y: 170 },
          ],
          segments: [
            { labelIndex: 10, start: { x: 100, y: 170 }, end: { x: 300, y: 170 }, valueMm: 200 },
          ],
          linePaths: [{ operationIndex: 1, subpathIndex: 0 }],
        })
        .mockReturnValue({ status: 'unresolved', reason })
      vi.spyOn(chains, 'createPdfNativePageDimensionChainVerifier').mockReturnValue(verify)
      expect(nativeCaptionBindings(input)).toMatchObject({
        status: 'unresolved',
        refusalReason: reason,
        candidates: [],
        unresolved: [],
      })
    },
  )
  it('is independent of path and label traversal order', () => {
    const input = fixture()
    const before = nativeCaptionBindings(input)
    input.native.labels.reverse()
    input.work.paths.reverse()
    compact(input).items.reverse()
    expect(nativeCaptionBindings(input)).toEqual(before)
  })
})
