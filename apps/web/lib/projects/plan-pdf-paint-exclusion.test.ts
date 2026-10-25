import { describe, expect, it } from 'vitest'
import type { PagePoint, PdfPaintBounds } from './plan-pdf-linework'
import { pdfPaintInventoryIsComplete, pdfPaintMayTouchSpan } from './plan-pdf-paint-exclusion'

type Event = PdfPaintBounds['events'][number]
type Matrix = [number, number, number, number, number, number]
const point = (x: number, y: number): PagePoint => ({ x, y })
const map = (p: PagePoint, m: Matrix) =>
  point(m[0] * p.x + m[2] * p.y + m[4], m[1] * p.x + m[3] * p.y + m[5])

function stroke(matrix: Matrix = [1, 0, 0, 1, 0, 0], radius = 1): Event {
  const start = point(0, 0)
  const end = point(10, 10)
  const points = [map(start, matrix), map(end, matrix)]
  const padX = radius * Math.hypot(matrix[0], matrix[2])
  const padY = radius * Math.hypot(matrix[1], matrix[3])
  return {
    operationIndex: 12,
    kind: 'vector',
    subpathCount: 1,
    reason: null,
    bounds: {
      left: Math.min(...points.map((p) => p.x)) - padX,
      right: Math.max(...points.map((p) => p.x)) + padX,
      top: Math.min(...points.map((p) => p.y)) - padY,
      bottom: Math.max(...points.map((p) => p.y)) + padY,
    },
    straightStrokeRegion: { start, end, sourceToPage: matrix, radius },
  }
}

const query = (x: number, y: number): [PagePoint, PagePoint] => [point(x, y), point(x, y)]
const inventory = (events: Event[]): PdfPaintBounds => ({
  complete: true,
  refusalReason: null,
  events,
})

describe('conservative whole-span paint exclusion', () => {
  it('excludes an exterior AABB even without a straight region', () => {
    const event = stroke()
    delete event.straightStrokeRegion
    expect(pdfPaintMayTouchSpan(event, query(20, 20), 0)).toBe(false)
    expect(pdfPaintMayTouchSpan(event, query(2, 8), 0)).toBe(true)
  })

  it('excludes inside the loose box but outside the diagonal capsule', () => {
    expect(pdfPaintMayTouchSpan(stroke(), query(2, 8), 0)).toBe(false)
  })

  it('excludes a diagonal span whose box overlaps a disjoint paint rectangle', () => {
    const event: Event = {
      operationIndex: 12,
      kind: 'vector',
      reason: null,
      bounds: { left: 1, right: 2, top: 8, bottom: 9 },
    }
    expect(pdfPaintMayTouchSpan(event, [point(0, 0), point(10, 10)], 0)).toBe(false)
    expect(pdfPaintMayTouchSpan(event, [point(10, 10), point(0, 0)], 0)).toBe(false)
    expect(pdfPaintMayTouchSpan(event, [point(0, 0), point(10, 10)], 4)).toBe(true)
  })

  it('keeps rectangle corner contact and a crossing through its interior', () => {
    const event: Event = {
      operationIndex: 12,
      kind: 'unknown',
      reason: 'unsupported-shape-with-known-envelope',
      bounds: { left: 4, right: 6, top: 6, bottom: 8 },
    }
    expect(pdfPaintMayTouchSpan(event, [point(0, 0), point(10, 10)], 0)).toBe(true)
    expect(pdfPaintMayTouchSpan(event, [point(0, 7), point(10, 7)], 0)).toBe(true)
  })

  it.each([
    { span: query(5, 5) },
    { span: query(-0.5, -0.5) },
    { span: query(10.5, 10.5) },
    { span: query(5 + 1 / Math.SQRT2, 5 - 1 / Math.SQRT2) },
  ])('keeps true contacts, round caps and exact capsule boundaries %#', ({ span }) => {
    expect(pdfPaintMayTouchSpan(stroke(), span, 0)).toBe(true)
  })

  it('keeps a span crossing the middle despite both endpoints being outside', () => {
    expect(pdfPaintMayTouchSpan(stroke(), [point(0, 10), point(10, 0)], 0)).toBe(true)
  })

  it('includes square-cap corners in the producer-enlarged capsule', () => {
    const event = stroke([1, 0, 0, 1, 0, 0], Math.SQRT2)
    expect(pdfPaintMayTouchSpan(event, query(10 + Math.SQRT2, 10), 0)).toBe(true)
  })

  it('keeps query uncertainty that reaches a stroke', () => {
    expect(pdfPaintMayTouchSpan(stroke(), query(2, 8), 5)).toBe(true)
  })

  it('does not depend on colour, operation aliases, or claimed dash gaps', () => {
    const event = { ...stroke(), reason: 'dashed-source-pen' }
    expect(pdfPaintMayTouchSpan(event, query(5, 5), 0)).toBe(true)
    expect(pdfPaintMayTouchSpan({ ...event, operationIndex: 98 }, query(5, 5), 0)).toBe(true)
  })

  const transforms: Matrix[] = [
    [2, 0, 0, 0.5, 4, 7],
    [1, 0.4, 0.7, 1, 30, 40],
    [-1, 0, 0, 1, 10, 0],
    [0, -2, 3, 0, 100, 100],
    [1000 / 841, 0, 0, 1000 / 595, 0, 0],
  ]
  it.each(transforms)('uses the actual affine source frame %#', (...matrix) => {
    const transform = matrix as Matrix
    const event = stroke(transform)
    const away = map(point(2, 8), transform)
    const middle = map(point(5, 5), transform)
    expect(pdfPaintMayTouchSpan(event, [away, away], 0)).toBe(false)
    expect(pdfPaintMayTouchSpan(event, [middle, middle], 0)).toBe(true)
  })

  it('keeps near-boundary arithmetic uncertainty, without snapping coordinates', () => {
    const q = query(5 + (1 + 1e-14) / Math.SQRT2, 5 - (1 + 1e-14) / Math.SQRT2)
    expect(pdfPaintMayTouchSpan(stroke(), q, 0)).toBe(true)
  })

  it.each([
    [0, 0, 0, 0, 0, 0],
    [1, 1, 1, 1, 0, 0],
    [1, 0, 0, 1e-12, 0, 0],
    [Number.MAX_VALUE, 0, 0, Number.MAX_VALUE, 0, 0],
  ] as Matrix[])(
    'does not refine a singular, unstable, or overflowing transform %#',
    (...values) => {
      const event = stroke()
      if (event.straightStrokeRegion) event.straightStrokeRegion.sourceToPage = values as Matrix
      expect(pdfPaintMayTouchSpan(event, query(2, 8), 0)).toBe(true)
    },
  )

  it('holds enormous cancellation at large translated coordinates', () => {
    const m: Matrix = [1, 0, 0, 1, 1e16, 1e16]
    const event = stroke(m)
    const q = map(point(2, 8), m)
    expect(pdfPaintMayTouchSpan(event, [q, q], 0)).toBe(true)
  })

  it('refuses determinant-scale multiplication overflow with finite endpoints', () => {
    const event = stroke()
    event.bounds = { left: -10, right: 10, top: -10, bottom: 10 }
    event.straightStrokeRegion = {
      start: point(1e-308, 1e-308),
      end: point(2e-308, 1e-308),
      sourceToPage: [1e308, 1e308, -1e308, 1e308, 0, 0],
      radius: 1e-310,
    }
    expect(pdfPaintMayTouchSpan(event, query(0.5, 2.5), 0)).toBe(true)
  })

  it('does not exclude a tiny valid source span because of arithmetic cancellation', () => {
    const event = stroke()
    event.bounds = { left: 0, right: 10, top: 0, bottom: 10 }
    event.straightStrokeRegion = {
      start: point(1e-12, 1e-12),
      end: point(2e-12, 1e-12),
      sourceToPage: [1e12, 0, 0, 1e12, 0, 0],
      radius: 1e-14,
    }
    expect(pdfPaintMayTouchSpan(event, query(1.5, 1), 0)).toBe(true)
  })

  it('keeps enormous query uncertainty rather than overflow-excluding', () => {
    expect(pdfPaintMayTouchSpan(stroke(), query(2, 8), Number.MAX_VALUE)).toBe(true)
  })

  it.each(['text', 'image', 'unknown'] as const)('never capsule-refines %s paint', (kind) => {
    expect(pdfPaintMayTouchSpan({ ...stroke(), kind }, query(2, 8), 0)).toBe(true)
  })

  it('holds null envelopes except verified empty source text', () => {
    for (const kind of ['text', 'image', 'unknown', 'vector'] as const) {
      expect(pdfPaintMayTouchSpan({ ...stroke(), kind, bounds: null }, query(20, 20), 0)).toBe(true)
    }
    expect(
      pdfPaintMayTouchSpan(
        { ...stroke(), kind: 'text', bounds: null, reason: 'empty-source-text-paint' },
        query(20, 20),
        0,
      ),
    ).toBe(false)
    expect(
      pdfPaintMayTouchSpan(
        { ...stroke(), kind: 'image', bounds: null, reason: 'empty-source-text-paint' },
        query(20, 20),
        0,
      ),
    ).toBe(true)
  })

  it.each([0, 2, undefined])('holds unknown or compound subpath count %s', (subpathCount) => {
    expect(pdfPaintMayTouchSpan({ ...stroke(), subpathCount }, query(2, 8), 0)).toBe(true)
  })

  it.each([0, -1, Number.NaN, Number.POSITIVE_INFINITY])(
    'holds invalid region radius %s',
    (radius) => {
      const event = stroke()
      if (event.straightStrokeRegion) event.straightStrokeRegion.radius = radius
      expect(pdfPaintMayTouchSpan(event, query(2, 8), 0)).toBe(true)
    },
  )

  it('does not mutate events, coordinates, aliases or matrices', () => {
    const event = stroke(transforms[1])
    const span: [PagePoint, PagePoint] = [point(2, 8), point(3, 9)]
    const before = structuredClone({ event, span })
    pdfPaintMayTouchSpan(event, span, 0.01)
    expect({ event, span }).toEqual(before)
  })

  it.each([-1, Number.NaN, Number.POSITIVE_INFINITY])('holds invalid uncertainty %s', (error) => {
    expect(pdfPaintMayTouchSpan(stroke(), query(20, 20), error)).toBe(true)
  })

  it('holds invalid query and envelope coordinates', () => {
    expect(pdfPaintMayTouchSpan(stroke(), query(Number.NaN, 5), 0)).toBe(true)
    const event = stroke()
    event.bounds = { left: 10, right: 5, top: 0, bottom: 10 }
    expect(pdfPaintMayTouchSpan(event, query(20, 20), 0)).toBe(true)
  })
})

describe('complete source paint inventory validation', () => {
  it('accepts bounded unique operations including unknown/null envelopes', () => {
    expect(pdfPaintInventoryIsComplete(inventory([]))).toBe(true)
    expect(pdfPaintInventoryIsComplete(inventory([stroke()]))).toBe(true)
    expect(
      pdfPaintInventoryIsComplete(
        inventory([{ ...stroke(), operationIndex: 99999, bounds: null }]),
      ),
    ).toBe(true)
  })

  it.each([-1, 100000, 12.5, Number.NaN, Number.POSITIVE_INFINITY])(
    'rejects operation %s',
    (index) => {
      expect(pdfPaintInventoryIsComplete(inventory([{ ...stroke(), operationIndex: index }]))).toBe(
        false,
      )
    },
  )

  it.each([6001, 15000])('accepts a complete bounded inventory with %i paint events', (count) => {
    expect(
      pdfPaintInventoryIsComplete(
        inventory(
          Array.from({ length: count }, (_, operationIndex) => ({ ...stroke(), operationIndex })),
        ),
      ),
    ).toBe(true)
  })

  it('rejects missing, refused, duplicate, oversized and malformed inventories', () => {
    expect(pdfPaintInventoryIsComplete(undefined)).toBe(false)
    expect(pdfPaintInventoryIsComplete({ ...inventory([]), complete: false })).toBe(false)
    expect(pdfPaintInventoryIsComplete({ ...inventory([]), refusalReason: 'truncated' })).toBe(
      false,
    )
    expect(pdfPaintInventoryIsComplete(inventory([stroke(), stroke()]))).toBe(false)
    expect(
      pdfPaintInventoryIsComplete(
        inventory(Array.from({ length: 15001 }, (_, i) => ({ ...stroke(), operationIndex: i }))),
      ),
    ).toBe(false)
    expect(
      pdfPaintInventoryIsComplete(inventory([{ ...stroke(), kind: 'bad' } as unknown as Event])),
    ).toBe(false)
    expect(
      pdfPaintInventoryIsComplete(
        inventory([{ ...stroke(), bounds: { left: 0, top: 0, right: 1, bottom: Number.NaN } }]),
      ),
    ).toBe(false)
  })

  it('ignores malformed optional regions but does not use them to exclude', () => {
    const event = { ...stroke(), straightStrokeRegion: {} } as Event
    expect(pdfPaintInventoryIsComplete(inventory([event]))).toBe(true)
    expect(pdfPaintMayTouchSpan(event, query(2, 8), 0)).toBe(true)
  })
})
