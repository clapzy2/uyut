import { createHash } from 'node:crypto'
import { existsSync } from 'node:fs'
import { readFile } from 'node:fs/promises'
import { fileURLToPath } from 'node:url'
import { afterEach, describe, expect, it, vi } from 'vitest'
import * as captions from './plan-native-caption-bindings'
import { nativeDimensionStrokeContacts as nativeStrokeContacts } from './plan-native-stroke-contacts'
import type { PagePoint, PdfPaintBounds, PdfStrokeInk, PdfVectorPath } from './plan-pdf-linework'

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

function paintInventory(input: Input): PdfPaintBounds {
  input.work.paintBounds = {
    complete: true,
    refusalReason: null,
    events: input.work.paths.map((path) => ({
      operationIndex: path.operationIndex,
      kind: 'vector',
      subpathCount: 1,
      bounds: {
        left: Math.min(...path.points.map((point) => point.x)) - 1,
        right: Math.max(...path.points.map((point) => point.x)) + 1,
        top: Math.min(...path.points.map((point) => point.y)) - 1,
        bottom: Math.max(...path.points.map((point) => point.y)) + 1,
      },
      reason: null,
    })),
  }
  return input.work.paintBounds
}

const coveringBounds = { left: 99, top: 99, right: 101, bottom: 101 }
describe('straight third-paint region refinement at source contacts', () => {
  function diagonalEvent(input: Input) {
    const event: PdfPaintBounds['events'][number] = {
      operationIndex: 4,
      kind: 'vector',
      bounds: coveringBounds,
      reason: null,
      subpathCount: 1,
      straightStrokeRegion: {
        start: { x: 99, y: 99.5 },
        end: { x: 101, y: 101.5 },
        sourceToPage: [...identity],
        radius: 0.075,
      },
    }
    paintInventory(input).events.push(event)
    return event
  }

  it('removes only an AABB false positive without changing source contacts or accepting geometry', () => {
    const { input } = fixture()
    const event = diagonalEvent(input)
    const before = structuredClone(input)
    expect(first(input).tips[0]).toMatchObject({
      status: 'ink-overlap',
      visibility: { status: 'unoccluded', blockerOperations: [] },
    })
    expect(input).toEqual(before)
    delete event.straightStrokeRegion
    expect(first(input).tips[0].visibility).toMatchObject({
      status: 'held',
      blockerOperations: [4],
    })
    expect(nativeStrokeContacts(input)).toMatchObject({
      physicalTargetsAccepted: false,
      mayTransfer2D: false,
      mayTransfer3D: false,
    })
  })

  it.each(['#888888', '#000000', '#ffffff'])(
    'keeps an actual later tick of color %s held',
    (color) => {
      const { input } = fixture()
      const event = diagonalEvent(input)
      event.straightStrokeRegion = {
        start: { x: 100, y: 99 },
        end: { x: 100, y: 101 },
        sourceToPage: [...identity],
        radius: 0.075,
      }
      input.work.paths.push({
        ...stroke(4, [
          { x: 100, y: 99 },
          { x: 100, y: 101 },
        ]),
        strokeColor: color,
      })
      const before = structuredClone(input)
      expect(first(input).tips[0].visibility).toMatchObject({
        status: 'held',
        blockerOperations: color === '#000000' ? [2, 4] : [4],
      })
      expect(input).toEqual(before)
    },
  )

  it('does not exclude round-cap coverage beyond the literal third stroke endpoint', () => {
    const { input } = fixture()
    const event = diagonalEvent(input)
    event.straightStrokeRegion = {
      start: { x: 100.05, y: 100 },
      end: { x: 101, y: 100 },
      sourceToPage: [...identity],
      radius: 0.075,
    }
    expect(first(input).tips[0].visibility).toMatchObject({
      status: 'held',
      blockerOperations: [4],
    })
  })

  it('holds a zero-length round stroke at the contact instead of treating it as absent ink', () => {
    const { input } = fixture()
    const event = diagonalEvent(input)
    event.straightStrokeRegion = {
      start: { x: 100, y: 100 },
      end: { x: 100, y: 100 },
      sourceToPage: [...identity],
      radius: 0.075,
    }
    expect(first(input).tips[0].visibility).toMatchObject({
      status: 'held',
      blockerOperations: [4],
    })
  })

  it.each(['negative-radius', 'nonfinite-point', 'singular-transform', 'nonfinite-transform'])(
    'falls back to the conservative bounds for %s region',
    (kind) => {
      const { input } = fixture()
      const event = diagonalEvent(input)
      const region = event.straightStrokeRegion
      if (!region) throw new Error('Missing region')
      if (kind === 'negative-radius') region.radius = -1
      if (kind === 'nonfinite-point') region.start.x = Number.NaN
      if (kind === 'singular-transform') region.sourceToPage = [0, 0, 0, 0, 0, 0]
      if (kind === 'nonfinite-transform') region.sourceToPage[0] = Number.POSITIVE_INFINITY
      const before = structuredClone(input)
      expect(first(input).tips[0].visibility).toMatchObject({
        status: 'held',
        blockerOperations: [4],
      })
      expect(input).toEqual(before)
    },
  )
})

describe('source-order paint visibility at contact points only', () => {
  it('checks both unoccluded pairs without changing input or accepting the whole rail', () => {
    const { input } = fixture()
    paintInventory(input)
    const before = structuredClone(input)
    const report = nativeStrokeContacts(input)
    expect(report.visibility).toBe('checked')
    for (const tip of report.observations[0]?.tips ?? []) {
      expect(tip.visibility).toEqual({
        status: 'unoccluded',
        reason: null,
        unoccludedSourceRefs: tip.sourceRefs,
        blockerOperations: [],
      })
    }
    expect(report).toMatchObject({
      physicalTargetsAccepted: false,
      mayTransfer2D: false,
      mayTransfer3D: false,
    })
    expect(report).not.toHaveProperty('railVisibility')
    expect(input).toEqual(before)
  })

  it.each(['vector', 'text', 'image', 'unknown'] as const)(
    'holds later %s paint even though source ink contact still exists',
    (kind) => {
      const { input } = fixture()
      paintInventory(input).events.push({
        operationIndex: 4,
        kind,
        bounds: coveringBounds,
        reason: null,
      })
      expect(first(input).tips[0]).toMatchObject({
        status: 'ink-overlap',
        visibility: {
          status: 'held',
          reason: 'later-paint-may-cover-contact',
          blockerOperations: [4],
        },
      })
      expect(first(input).tips[1].visibility?.status).toBe('unoccluded')
    },
  )

  it.each(['#ffffff', '#000000'])('does not exempt a later stroke of color %s', (color) => {
    const { input } = fixture()
    input.work.paths.push({
      ...stroke(4, [
        { x: 100, y: 99 },
        { x: 100, y: 101 },
      ]),
      strokeColor: color,
    })
    paintInventory(input)
    expect(first(input).tips[0].visibility).toMatchObject({
      status: 'held',
      blockerOperations: color === '#000000' ? [2, 4] : [4],
    })
  })

  it.each(['text', 'image', 'vector', 'unknown'] as const)('holds unbounded %s paint', (kind) => {
    const { input } = fixture()
    paintInventory(input).events.push({
      operationIndex: 4,
      kind,
      bounds: null,
      reason: 'unknown-envelope',
    })
    expect(first(input).tips.every((tip) => tip.visibility?.status === 'held')).toBe(true)
  })

  it('ignores paint before both pair members but not paint between them', () => {
    const { input } = fixture()
    const inventory = paintInventory(input)
    inventory.events.unshift({ operationIndex: 0, kind: 'unknown', bounds: null, reason: null })
    expect(first(input).tips[0].visibility?.status).toBe('unoccluded')
    const witness = input.work.paths[1]
    if (!witness) throw new Error('Missing witness')
    witness.operationIndex = 4
    const fresh = paintInventory(input)
    fresh.events.push({ operationIndex: 2, kind: 'vector', bounds: coveringBounds, reason: null })
    expect(first(input).tips[0].visibility).toMatchObject({
      status: 'held',
      blockerOperations: [2],
    })
  })

  it.each([1, 2])('does not exempt the other subpaths of source operation %i', (operationIndex) => {
    const { input } = fixture()
    const event = paintInventory(input).events.find(
      (item) => item.operationIndex === operationIndex,
    )
    if (!event) throw new Error('Missing source event')
    event.subpathCount = 2
    expect(first(input).tips[0].visibility).toMatchObject({
      status: 'held',
      reason: 'contact-paint-provenance-unavailable',
    })
  })

  it.each(['incomplete', 'duplicate', 'oversize', 'invalid-bounds'])(
    'holds %s inventory without dropping source contacts',
    (kind) => {
      const { input } = fixture()
      const inventory = paintInventory(input)
      const event = inventory.events[0]
      if (!event) throw new Error('Missing source event')
      if (kind === 'incomplete') inventory.complete = false
      if (kind === 'duplicate') inventory.events.push(structuredClone(event))
      if (kind === 'oversize')
        inventory.events = Array.from({ length: 15001 }, (_, operationIndex) => ({
          ...event,
          operationIndex,
        }))
      if (kind === 'invalid-bounds') event.bounds = { ...coveringBounds, left: Number.NaN }
      expect(first(input).tips[0]).toMatchObject({
        status: 'ink-overlap',
        visibility: { status: 'held', reason: 'paint-envelope-inventory-unavailable' },
      })
    },
  )

  it('preserves all alternatives and records a blocked early pair alongside an unoccluded later pair', () => {
    const { input, bindings } = fixture()
    const rail = input.work.paths[0]
    const candidate = bindings.candidates[0]
    if (!rail || !candidate) throw new Error('Missing rail')
    rail.operationIndex = 5
    candidate.rail.operationIndex = 5
    input.work.paths.push(
      stroke(7, [
        { x: 100.001, y: 90 },
        { x: 100.001, y: 110 },
      ]),
    )
    paintInventory(input).events.push({
      operationIndex: 4,
      kind: 'vector',
      bounds: coveringBounds,
      reason: null,
    })
    expect(first(input).tips[0]).toMatchObject({
      sourceRefs: [
        { operationIndex: 2, subpathIndex: 0, segmentIndex: 0 },
        { operationIndex: 7, subpathIndex: 0, segmentIndex: 0 },
      ],
      visibility: {
        status: 'unoccluded',
        blockerOperations: [4, 7],
        unoccludedSourceRefs: [{ operationIndex: 7, subpathIndex: 0, segmentIndex: 0 }],
      },
    })
  })

  it('returns no partial report after visibility scans exhaust the work budget', () => {
    const { input, bindings } = fixture()
    const candidate = bindings.candidates[0]
    if (!candidate) throw new Error('Missing candidate')
    bindings.candidates = Array.from({ length: 1000 }, (_, index) => ({
      ...candidate,
      labelId: `native-text-${index}`,
    }))
    const inventory = paintInventory(input)
    inventory.events.push(
      ...Array.from({ length: 5997 }, (_, index) => ({
        operationIndex: index + 4,
        kind: 'vector' as const,
        bounds: { left: 600, right: 610, top: 600, bottom: 610 },
        reason: null,
        straightStrokeRegion: {
          start: { x: 600, y: 600 },
          end: { x: 610, y: 610 },
          sourceToPage: [...identity] as PdfStrokeInk['sourceToPage'],
          radius: 0.075,
        },
      })),
    )
    expect(nativeStrokeContacts(input)).toMatchObject({
      status: 'unresolved',
      refusalReason: 'stroke-contact-work-or-output-limit',
      observations: [],
    })
  })

  it('clears all observations instead of returning a partial over-budget contact reference list', () => {
    const { input, bindings } = fixture()
    const rail = input.work.paths[0]
    const candidate = bindings.candidates[0]
    if (!rail || !candidate) throw new Error('Missing candidate')
    bindings.candidates = Array.from({ length: 1000 }, (_, index) => ({
      ...candidate,
      labelId: `native-text-${index}`,
    }))
    input.work.paths = [
      rail,
      ...Array.from({ length: 30 }, (_, index) =>
        stroke(index + 2, [
          { x: 100.001, y: 90 },
          { x: 100.001, y: 110 },
        ]),
      ),
    ]
    expect(nativeStrokeContacts(input)).toMatchObject({
      status: 'unresolved',
      refusalReason: 'stroke-contact-output-limit',
      observations: [],
    })
  })

  it('clears all observations when accumulated visibility blocker references exceed the limit', () => {
    const { input, bindings } = fixture()
    const candidate = bindings.candidates[0]
    if (!candidate) throw new Error('Missing candidate')
    bindings.candidates = Array.from({ length: 1000 }, (_, index) => ({
      ...candidate,
      labelId: `native-text-${index}`,
    }))
    const inventory = paintInventory(input)
    inventory.events.push(
      ...Array.from({ length: 25 }, (_, index) => ({
        operationIndex: index + 4,
        kind: 'vector' as const,
        bounds: coveringBounds,
        reason: null,
      })),
    )
    const before = structuredClone(input)
    expect(nativeStrokeContacts(input)).toMatchObject({
      status: 'unresolved',
      refusalReason: 'stroke-contact-work-or-output-limit',
      observations: [],
    })
    expect(input).toEqual(before)
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
    expect(result.visibility).toBe('checked')
    expect(result.observations.flatMap((row) => row.tips)).toHaveLength(10)
    for (const tip of result.observations.flatMap((row) => row.tips)) {
      expect(tip.visibility?.status).toBe('held')
    }
    for (const valueMm of [1506, 684]) {
      const observation = result.observations.find((row) => row.valueMm === valueMm)
      if (!observation) throw new Error(`Missing original ${valueMm} mm caption`)
      for (const tip of observation.tips) {
        expect(tip.visibility?.blockerOperations).not.toContain(7251)
      }
    }
    const column = result.observations.find((row) => row.valueMm === 530)
    if (!column) throw new Error('Missing original 530 mm caption')
    expect(column.tips[1].visibility?.blockerOperations).not.toContain(13680)
    expect(result.physicalTargetsAccepted).toBe(false)
    expect(result.mayTransfer2D).toBe(false)
    expect(result.mayTransfer3D).toBe(false)
    expect(input).toEqual(before)
  },
  30_000,
)
