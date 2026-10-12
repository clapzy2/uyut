import { createHash } from 'node:crypto'
import { existsSync } from 'node:fs'
import { readFile } from 'node:fs/promises'
import { fileURLToPath } from 'node:url'
import { afterEach, describe, expect, it, vi } from 'vitest'
import * as captions from './plan-native-caption-bindings'
import { nativeDimensionStrokeContacts as nativeStrokeContacts } from './plan-native-stroke-contacts'
import type { PagePoint, PdfStrokeInk, PdfVectorPath } from './plan-pdf-linework'

type Input = Parameters<typeof nativeStrokeContacts>[0]
const identity: PdfStrokeInk['sourceToPage'] = [1, 0, 0, 1, 0, 0]
const transformed = (p: PagePoint, m: PdfStrokeInk['sourceToPage']) => ({
  x: m[0] * p.x + m[2] * p.y + m[4],
  y: m[1] * p.x + m[3] * p.y + m[5],
})
function stroke(operationIndex: number, points: PagePoint[], m = identity): PdfVectorPath {
  return {
    operationIndex,
    subpathIndex: 0,
    paint: 'stroke',
    closed: false,
    strokeColor: '#000000',
    points: points.map((p) => {
      const mapped = transformed(p, m)
      return { x: Math.round(mapped.x * 1000) / 1000, y: Math.round(mapped.y * 1000) / 1000 }
    }),
    strokeInk: {
      points: structuredClone(points),
      sourceToPage: [...m],
      lineWidth: 0.15,
      lineCap: 1,
      lineJoin: 1,
      miterLimit: 10,
      dashArray: [],
      dashPhase: 0,
      refusalReason: null,
    },
  }
}
function fixture(m = identity) {
  const source = { sha256: 'b'.repeat(64), pdfPage: 1, state: 'existing' as const }
  const image = { sha256: 'a'.repeat(64), page: 1, width: 1000, height: 1000 }
  const paths = [
    stroke(
      1,
      [
        { x: 100, y: 100 },
        { x: 300, y: 100 },
      ],
      m,
    ),
    stroke(
      2,
      [
        { x: 100.001, y: 90 },
        { x: 100.001, y: 110 },
      ],
      m,
    ),
    stroke(
      3,
      [
        { x: 300.001, y: 90 },
        { x: 300.001, y: 110 },
      ],
      m,
    ),
  ]
  const input: Input = {
    source,
    lineworkSource: image,
    native: { source: image, originalPdfSha256: source.sha256, complete: true, labels: [] },
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
  const bindings: ReturnType<typeof captions.nativeCaptionBindings> = {
    status: 'draft',
    refusalReason: null,
    source,
    image,
    basis: 'original-native-run-to-source-dimension-rail',
    readOnly: true,
    mayTransfer2D: false,
    mayTransfer3D: false,
    unresolved: [],
    candidates: [
      {
        labelId: 'native-text-10',
        compactIndex: 0,
        valueMm: 200,
        axis: 'width',
        rail: { operationIndex: 1, subpathIndex: 0 },
        spanEnds: structuredClone(paths[0]?.points) as [PagePoint, PagePoint],
      },
    ],
  }
  vi.spyOn(captions, 'nativeCaptionBindings').mockImplementation(() => structuredClone(bindings))
  return { input, bindings, paths }
}
function ink(path: PdfVectorPath | undefined) {
  if (!path?.strokeInk) throw new Error('Missing synthetic pen')
  return path.strokeInk
}
function first(input: Input) {
  const row = nativeStrokeContacts(input).observations[0]
  if (!row) throw new Error('Missing contact observation')
  return row
}
afterEach(() => vi.restoreAllMocks())

describe('diagnostic straight PDF.js ink contacts', () => {
  it('finds actual strip overlap without changing source points or claiming physical targets', () => {
    const { input, bindings } = fixture()
    const before = structuredClone(input)
    const result = nativeStrokeContacts(input, bindings)
    expect(result).toMatchObject({
      status: 'diagnostic',
      refusalReason: null,
      visibility: 'not-checked',
      physicalTargetsAccepted: false,
      mayTransfer2D: false,
      mayTransfer3D: false,
    })
    expect(result.observations[0]?.tips).toEqual([
      {
        endpoint: 0,
        status: 'ink-overlap',
        reason: null,
        sourceRefs: [{ operationIndex: 2, subpathIndex: 0, segmentIndex: 0 }],
      },
      {
        endpoint: 1,
        status: 'ink-overlap',
        reason: null,
        sourceRefs: [{ operationIndex: 3, subpathIndex: 0, segmentIndex: 0 }],
      },
    ])
    expect(input).toEqual(before)
  })
  it.each(
    [
      [2, 0, 0, 0.5, 5, 7],
      [1, 0.2, 0.3, 1, 5, 7],
      [-1, 0, 0, 1, 500, 0],
      [0, 1, -1, 0, 500, 0],
    ].map((m) => ({ m: m as PdfStrokeInk['sourceToPage'] })),
  )('uses local pen geometry under affine transform $m', ({ m }) => {
    const { input } = fixture(m)
    expect(first(input).tips.every((tip) => tip.status === 'ink-overlap')).toBe(true)
  })
  it('is independent of normalized page aspect', () => {
    const { input } = fixture([1, 0, 0, 2, 0, 0])
    input.work.pageHeight = 500
    expect(first(input).tips.every((tip) => tip.status === 'ink-overlap')).toBe(true)
  })
  it('orders raw tips according to fresh caption span order', () => {
    const { input, bindings } = fixture()
    bindings.candidates[0]?.spanEnds.reverse()
    expect(first(input).tips[0]?.sourceRefs[0]?.operationIndex).toBe(3)
    expect(first(input).tips[1]?.sourceRefs[0]?.operationIndex).toBe(2)
  })
  it('holds a caption span that no longer equals either literal rail order', () => {
    const { input, bindings } = fixture()
    const candidate = bindings.candidates[0]
    if (!candidate) throw new Error('Missing caption')
    candidate.spanEnds[0].x += 0.001
    expect(
      first(input).tips.every((tip) => tip.reason === 'source-caption-rail-span-mismatch'),
    ).toBe(true)
  })
  it('preserves every repaint and competing source witness without choosing a winner', () => {
    const { input } = fixture()
    input.work.paths.push(
      stroke(4, [
        { x: 100, y: 90 },
        { x: 100, y: 110 },
      ]),
    )
    expect(first(input).tips[0].sourceRefs.map((ref) => ref.operationIndex)).toEqual([2, 4])
  })
  it.each([0, 1, 2])(
    'does not borrow cap type %s to turn an endpoint into interior contact',
    (cap) => {
      const { input, paths } = fixture()
      paths[1] = stroke(2, [
        { x: 100, y: 100 },
        { x: 100, y: 110 },
      ])
      ink(paths[1]).lineCap = cap as 0 | 1 | 2
      expect(first(input).tips[0].status).toBe('held')
    },
  )
  it.each([0.075, 0.075 + 1e-12, 0.075 - 1e-14])(
    'refuses boundary or machine-uncertain strip distance %s',
    (gap) => {
      const { input, paths } = fixture()
      paths[1] = stroke(2, [
        { x: 100 + gap, y: 90 },
        { x: 100 + gap, y: 110 },
      ])
      expect(first(input).tips[0].status).toBe('held')
    },
  )
  it('accepts a strict interior margin rather than expanding its half-width', () => {
    const { input, paths } = fixture()
    paths[1] = stroke(2, [
      { x: 100.07, y: 90 },
      { x: 100.07, y: 110 },
    ])
    expect(first(input).tips[0].status).toBe('ink-overlap')
  })
  it.each([
    'missing',
    'dash',
    'hairline',
    'negative',
    'infinite',
    'clip',
    'white',
    'unknown-color',
    'closed',
    'fill',
    'mismatch',
    'singular',
    'near-singular',
    'endpoint',
  ])('holds unsupported %s witness', (kind) => {
    const { input, paths } = fixture()
    const path = paths[1]
    if (!path) throw new Error('Missing witness')
    const pen = ink(path)
    if (kind === 'missing') delete path.strokeInk
    if (kind === 'dash') pen.dashArray = [1, 1]
    if (kind === 'hairline') pen.lineWidth = 0
    if (kind === 'negative') pen.lineWidth = -1
    if (kind === 'infinite') pen.lineWidth = Number.POSITIVE_INFINITY
    if (kind === 'clip') pen.refusalReason = 'unsupported-source-pen-clip'
    if (kind === 'white') path.strokeColor = '#FFFFFF'
    if (kind === 'unknown-color') delete path.strokeColor
    if (kind === 'closed') path.closed = true
    if (kind === 'fill') path.paint = 'fill-stroke'
    if (kind === 'mismatch') {
      const point = pen.points[0]
      if (!point) throw new Error('Missing pen endpoint')
      point.x += 1
    }
    if (kind === 'singular') pen.sourceToPage = [1, 1, 1, 1, 0, 0]
    if (kind === 'near-singular') pen.sourceToPage = [1, 1, 1, 1 + Number.EPSILON, 0, 0]
    if (kind === 'endpoint')
      paths[1] = stroke(2, [
        { x: 100, y: 100 },
        { x: 100, y: 110 },
      ])
    expect(first(input).tips[0].status).toBe('held')
  })
  it('holds legacy rails without fabricating default pen parameters', () => {
    const { input, paths } = fixture()
    delete paths[0]?.strokeInk
    expect(first(input).tips.every((tip) => tip.reason === 'source-stroke-ink-unavailable')).toBe(
      true,
    )
  })
  it('refuses supplied stale bindings after fresh recomputation', () => {
    const { input, bindings } = fixture()
    const stale = structuredClone(bindings)
    const candidate = stale.candidates[0]
    if (!candidate) throw new Error('Missing stale candidate')
    candidate.valueMm = 999
    expect(nativeStrokeContacts(input, stale)).toMatchObject({
      status: 'unresolved',
      refusalReason: 'stale-source-caption-bindings',
      observations: [],
    })
  })
  it.each(['vector', 'source', 'truncated', 'captions'])(
    'keeps %s source failures fail-closed',
    (kind) => {
      const { input, bindings } = fixture()
      if (kind === 'vector') input.native.vectorInkRefusal = 'hidden-native-vector-optional-content'
      if (kind === 'source') input.source.sha256 = 'invalid'
      if (kind === 'truncated') input.work.truncated = true
      if (kind === 'captions') {
        bindings.status = 'unresolved'
        bindings.refusalReason = 'source-caption-ink-incomplete'
      }
      expect(nativeStrokeContacts(input).status).toBe('unresolved')
      expect(nativeStrokeContacts(input).observations).toEqual([])
    },
  )
  it('returns no partial positive report when the bounded work budget is exhausted', () => {
    const { input, bindings } = fixture()
    const original = bindings.candidates[0]
    const rail = input.work.paths[0]
    if (!original || !rail) throw new Error('Missing budget fixture')
    const candidate = structuredClone(original)
    bindings.candidates = Array.from({ length: 1000 }, (_, index) => ({
      ...candidate,
      labelId: `native-text-${index}`,
    }))
    input.work.paths = [
      rail,
      ...Array.from({ length: 2999 }, (_, index) =>
        stroke(index + 2, [
          { x: 600, y: 600 },
          { x: 600, y: 610 },
        ]),
      ),
    ]
    expect(nativeStrokeContacts(input)).toMatchObject({
      status: 'unresolved',
      refusalReason: 'stroke-contact-work-limit',
      observations: [],
    })
  })
})

const originalSource = fileURLToPath(
  new URL('../../../../output/pdf/source-search-20261003/rebrina-original.pdf', import.meta.url),
)
it.skipIf(!existsSync(originalSource))(
  'replays original ink contacts while exact physical targets remain unaccepted',
  async () => {
    const bytes = await readFile(originalSource)
    const sha256 = createHash('sha256').update(bytes).digest('hex')
    expect(sha256).toBe('2e141c135812c81719e1f4783173cb5202e20041ac494d3cc799eb37ad62ad4e')
    const { preparePlanPage } = await import('./plan-document')
    const page = await preparePlanPage(bytes, true, 3, true, true)
    if (!page.nativeTextAnchors || !page.linework || !page.lineworkRasterSource)
      throw new Error('Missing native source')
    const input: Input = {
      source: { sha256, pdfPage: 3, state: 'existing' },
      native: page.nativeTextAnchors,
      work: page.linework,
      lineworkSource: page.lineworkRasterSource,
    }
    const before = structuredClone(input)
    const result = nativeStrokeContacts(input)
    expect(result.refusalReason).toBeNull()
    expect(result.observations).toHaveLength(5)
    expect(
      result.observations.flatMap((row) => row.tips).filter((tip) => tip.status === 'ink-overlap'),
    ).toHaveLength(10)
    expect(result.visibility).toBe('not-checked')
    expect(result.physicalTargetsAccepted).toBe(false)
    expect(result.mayTransfer2D).toBe(false)
    expect(result.mayTransfer3D).toBe(false)
    expect(input).toEqual(before)
  },
  30_000,
)
