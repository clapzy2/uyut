import { describe, expect, it } from 'vitest'
import {
  createNativeSourceSpanVisibility,
  NativeSourceVisibilityLimit,
} from './plan-native-source-span-visibility'
import type { PdfLinework, PdfPaintBounds } from './plan-pdf-linework'

const ref = { operationIndex: 10, subpathIndex: 0, segmentIndex: 0 }
const bounds = { left: 100, top: 100, right: 300, bottom: 300 }
type Event = PdfPaintBounds['events'][number]

function fixture(): PdfLinework {
  return {
    coordinateSystem: 'page-0-1000',
    pageWidth: 1000,
    pageHeight: 1000,
    paths: [
      {
        ...ref,
        paint: 'fill',
        closed: false,
        points: [
          { x: 100, y: 100 },
          { x: 300, y: 300 },
        ],
      },
    ],
    skippedCurves: 0,
    clippedPaths: 0,
    unsupportedPaths: 0,
    unsupportedContexts: 0,
    truncated: false,
    paintBounds: {
      complete: true,
      refusalReason: null,
      events: [{ operationIndex: 10, kind: 'vector', bounds, reason: null, subpathCount: 1 }],
    },
  }
}

function addPaint(work: PdfLinework, event: Partial<Event> = {}) {
  if (!work.paintBounds) throw new Error('Missing fixture paint inventory')
  work.paintBounds.events.push({
    operationIndex: 20,
    kind: 'image',
    bounds,
    reason: null,
    ...event,
  })
}

const inspect = (work: PdfLinework, start = '301/3:301/3', end = '899/3:899/3') =>
  createNativeSourceSpanVisibility(work)(ref, start, end)

describe('source-span paint exclusion without physical boundary authority', () => {
  it('checks a clipped rational diagonal, including reversed endpoints, without mutation', () => {
    const work = fixture()
    const before = structuredClone(work)
    const result = inspect(work)
    expect(result).toEqual({
      status: 'unoccluded',
      reason: null,
      sourceRef: ref,
      blockerOperations: [],
    })
    expect(inspect(work, '899/3:899/3', '301/3:301/3')).toEqual(result)
    expect(work).toEqual(before)
    expect(Object.keys(result).sort()).toEqual([
      'blockerOperations',
      'reason',
      'sourceRef',
      'status',
    ])
  })

  it('checks rational vertical subspans without replacing them by the whole source segment', () => {
    const work = fixture()
    const path = work.paths[0]
    if (!path) throw new Error('Missing fixture source')
    path.points = [
      { x: 100, y: 100 },
      { x: 100, y: 300 },
    ]
    addPaint(work, { bounds: { left: 90, top: 250, right: 110, bottom: 260 } })
    expect(inspect(work, '100/1:301/3', '100/1:599/3')).toMatchObject({
      status: 'unoccluded',
      blockerOperations: [],
    })
    expect(inspect(work, '100/1:899/3', '100/1:301/3')).toMatchObject({
      status: 'held',
      blockerOperations: [20],
    })
  })

  it.each(['image', 'text', 'unknown', 'vector'] as const)(
    'holds a later %s envelope that may cover the source span',
    (kind) => {
      const work = fixture()
      addPaint(work, { kind })
      expect(inspect(work)).toEqual({
        status: 'held',
        reason: 'later-paint-may-cover-source-span',
        sourceRef: ref,
        blockerOperations: [20],
      })
    },
  )

  it.each(['image', 'text', 'unknown', 'vector'] as const)(
    'cannot exclude a later %s with an unknown envelope',
    (kind) => {
      const work = fixture()
      addPaint(work, { kind, bounds: null })
      expect(inspect(work)).toMatchObject({ status: 'held', blockerOperations: [20] })
    },
  )

  it('excludes explicit empty text, earlier paint, and a distant later paint envelope', () => {
    const work = fixture()
    addPaint(work, { operationIndex: 2 })
    addPaint(work, {
      operationIndex: 20,
      kind: 'text',
      bounds: null,
      reason: 'empty-source-text-paint',
    })
    addPaint(work, {
      operationIndex: 30,
      bounds: { left: 400, top: 400, right: 450, bottom: 450 },
    })
    expect(inspect(work)).toMatchObject({ status: 'unoccluded', blockerOperations: [] })
  })

  it('excludes a box off the diagonal even when its enclosing query box overlaps', () => {
    const work = fixture()
    addPaint(work, { bounds: { left: 110, top: 200, right: 130, bottom: 220 } })
    expect(inspect(work)).toMatchObject({ status: 'unoccluded', blockerOperations: [] })
  })

  it('retains near-boundary uncertainty as possible paint, not proof of coverage', () => {
    const work = fixture()
    addPaint(work, {
      bounds: { left: 150, top: 150.0001, right: 151, bottom: 151.0001 },
    })
    expect(inspect(work)).toMatchObject({ status: 'held', blockerOperations: [20] })
  })

  it.each([
    ['extension', '99/1:99/1', '200/1:200/1'],
    ['endpoint-only', '300/1:300/1', '301/1:301/1'],
    ['zero-length', '200/1:200/1', '200/1:200/1'],
    ['shifted-line', '100/1:101/1', '200/1:201/1'],
    ['invalid-key', '100/0:100/1', '200/1:200/1'],
    ['outside-page', '100/1:100/1', '1001/1:1001/1'],
  ])('refuses %s rather than extending or snapping source membership', (_name, start, end) => {
    expect(inspect(fixture(), start, end)).toEqual({
      status: 'held',
      reason: 'source-span-snapshot-mismatch',
      sourceRef: null,
      blockerOperations: [],
    })
  })

  it.each(['missing', 'incomplete', 'duplicate', 'refusal'] as const)(
    'holds a %s whole paint inventory',
    (kind) => {
      const work = fixture()
      if (kind === 'missing') delete work.paintBounds
      else {
        if (!work.paintBounds) throw new Error('Missing fixture paint inventory')
        if (kind === 'incomplete') work.paintBounds.complete = false
        if (kind === 'refusal') work.paintBounds.refusalReason = 'paint-budget-exceeded'
        if (kind === 'duplicate') addPaint(work, { operationIndex: 10 })
      }
      expect(inspect(work)).toEqual({
        status: 'held',
        reason: 'paint-envelope-inventory-unavailable',
        sourceRef: null,
        blockerOperations: [],
      })
    },
  )

  it.each([
    'missing-event',
    'non-vector-event',
    'null-envelope',
    'multi-event',
    'multi-path',
    'omitted',
  ] as const)('holds %s own paint provenance', (kind) => {
    const work = fixture()
    const own = work.paintBounds?.events[0]
    const path = work.paths[0]
    if (!own || !path || !work.paintBounds) throw new Error('Missing fixture provenance')
    if (kind === 'missing-event') work.paintBounds.events = []
    if (kind === 'non-vector-event') own.kind = 'image'
    if (kind === 'null-envelope') own.bounds = null
    if (kind === 'multi-event') own.subpathCount = 2
    if (kind === 'multi-path') work.paths.push({ ...path, subpathIndex: 1 })
    if (kind === 'omitted') {
      work.skippedCurves = 1
      work.skippedCurveBounds = [{ operationIndex: 10, bounds, paint: 'stroke' }]
    }
    expect(inspect(work)).toEqual({
      status: 'held',
      reason:
        kind === 'missing-event' || kind === 'non-vector-event'
          ? 'paint-envelope-inventory-unavailable'
          : 'source-span-provenance-unavailable',
      sourceRef: null,
      blockerOperations: [],
    })
  })

  it.each([false, true])(
    'preserves the source closing segment with explicit return %s',
    (explicit) => {
      const work = fixture()
      const path = work.paths[0]
      if (!path) throw new Error('Missing fixture path')
      path.closed = true
      path.points = [
        { x: 100, y: 100 },
        { x: 300, y: 100 },
        { x: 300, y: 300 },
      ]
      if (explicit) path.points.push({ x: 100, y: 100 })
      const check = createNativeSourceSpanVisibility(work)
      expect(check({ ...ref, segmentIndex: 2 }, '301/3:301/3', '899/3:899/3')).toMatchObject({
        status: 'unoccluded',
        sourceRef: { ...ref, segmentIndex: 2 },
      })
      expect(check({ ...ref, segmentIndex: 3 }, '100/1:100/1', '300/1:300/1')).toMatchObject({
        status: 'held',
        reason: 'source-span-snapshot-mismatch',
        sourceRef: null,
      })
    },
  )

  it('holds when another retained or omitted path is missing from the whole paint inventory', () => {
    for (const omitted of [false, true]) {
      const work = fixture()
      if (omitted) {
        work.skippedCurves = 1
        work.skippedCurveBounds = [{ operationIndex: 100, bounds, paint: 'stroke' }]
      } else {
        const path = work.paths[0]
        if (!path) throw new Error('Missing fixture source')
        work.paths.push({ ...path, operationIndex: 100 })
      }
      expect(inspect(work)).toMatchObject({
        status: 'held',
        reason: 'paint-envelope-inventory-unavailable',
        sourceRef: null,
      })
    }
  })

  it('keeps sorted unique blocker references and returns detached result objects', () => {
    const work = fixture()
    addPaint(work, { operationIndex: 30 })
    addPaint(work, { operationIndex: 20 })
    const check = createNativeSourceSpanVisibility(work)
    const first = check(ref, '100/1:100/1', '300/1:300/1')
    expect(first.blockerOperations).toEqual([20, 30])
    if (!first.sourceRef) throw new Error('Missing result provenance')
    first.sourceRef.segmentIndex = 99
    first.blockerOperations.push(1000)
    expect(check(ref, '100/1:100/1', '300/1:300/1')).toMatchObject({
      sourceRef: ref,
      blockerOperations: [20, 30],
    })
  })

  it('shares the blocker budget across calls and allows an atomic caller to discard partial output', () => {
    const work = fixture()
    for (let operationIndex = 20; operationIndex < 4020; operationIndex++)
      addPaint(work, { operationIndex })
    const check = createNativeSourceSpanVisibility(work)
    let observations: ReturnType<typeof check>[] = []
    let held = false
    try {
      for (let index = 0; index < 6; index++)
        observations.push(check(ref, '100/1:100/1', '300/1:300/1'))
    } catch (error) {
      expect(error).toBeInstanceOf(NativeSourceVisibilityLimit)
      expect(observations).toHaveLength(5)
      observations = []
      held = true
    }
    expect(held).toBe(true)
    expect(observations).toEqual([])
  })

  it('shares the work budget even when every later envelope is distant', () => {
    const work = fixture()
    for (let operationIndex = 20; operationIndex < 6019; operationIndex++) {
      addPaint(work, {
        operationIndex,
        bounds: { left: 700, top: 700, right: 710, bottom: 710 },
      })
    }
    const check = createNativeSourceSpanVisibility(work)
    for (let index = 0; index < 333; index++)
      expect(check(ref, '100/1:100/1', '300/1:300/1').status).toBe('unoccluded')
    expect(() => check(ref, '100/1:100/1', '300/1:300/1')).toThrow(NativeSourceVisibilityLimit)
    // Recreating the per-request scanner is a separate caller budget, not stale proof reuse.
    expect(inspect(work).status).toBe('unoccluded')
  })
})
