import type { PlanRoomReading } from '@uyut/db'
import { describe, expect, it } from 'vitest'
import {
  finiteContourPoint,
  nativeContourPoint,
  nativePointsFromResponse,
  numberedContourRooms,
  pageContourPoint,
  previewFromHeaders,
  samePlanPage,
  snapPageContourPoint,
} from './plan-page-contour-editor-model'

const preview = { sha256: 'a'.repeat(64), page: 6, pageCount: 48, width: 842, height: 1191 }
const rect = { left: 20, top: 40, width: 400, height: 600 }

describe('page contour editor model', () => {
  it('maps the actual displayed page independently along each axis without inventing millimetres', () => {
    expect(pageContourPoint({ x: 220, y: 190 }, rect)).toEqual({ x: 500, y: 250 })
    expect(pageContourPoint({ x: 420, y: 640 }, rect)).toEqual({ x: 1000, y: 1000 })
  })

  it('rejects points outside the rendered page, nonfinite input and zero-sized previews', () => {
    expect(pageContourPoint({ x: 19, y: 40 }, rect)).toBeNull()
    expect(pageContourPoint({ x: 20, y: 641 }, rect)).toBeNull()
    expect(pageContourPoint({ x: Number.NaN, y: 40 }, rect)).toBeNull()
    expect(pageContourPoint({ x: 20, y: 40 }, { ...rect, width: 0 })).toBeNull()
  })

  it('selects only positive unique printed numbers, never matching by a repeated room name', () => {
    const rooms: PlanRoomReading[] = [
      { name: 'Спальня', kind: 'bedroom', sourceNumber: 4 },
      { name: 'Спальня', kind: 'bedroom', sourceNumber: 6 },
      { name: 'Кухня', kind: 'kitchen', sourceNumber: 2 },
      { name: 'Другая кухня', kind: 'kitchen', sourceNumber: 2 },
      { name: 'Без номера', kind: 'living' },
      { name: 'Нулевой номер', kind: 'living', sourceNumber: 0 },
      { name: 'Дробный номер', kind: 'living', sourceNumber: 1.5 },
    ]
    expect(numberedContourRooms(rooms).map((room) => room.sourceNumber)).toEqual([4, 6])
  })

  it('makes hash, page and physical format part of draft source identity', () => {
    expect(samePlanPage(preview, { ...preview, pageCount: 49 })).toBe(true)
    expect(samePlanPage(preview, { ...preview, sha256: 'b'.repeat(64) })).toBe(false)
    expect(samePlanPage(preview, { ...preview, page: 12 })).toBe(false)
    expect(samePlanPage(preview, { ...preview, height: 842 })).toBe(false)
  })

  it('accepts verified page headers and rejects missing or inconsistent metadata', () => {
    const headers = new Headers({
      'X-Plan-Sha256': preview.sha256,
      'X-Plan-Page': '6',
      'X-Plan-Page-Count': '48',
      'X-Plan-Page-Width': '842',
      'X-Plan-Page-Height': '1191',
    })
    expect(previewFromHeaders(headers, 6)).toEqual(preview)
    expect(previewFromHeaders(headers, 12)).toBeNull()
    headers.delete('X-Plan-Sha256')
    expect(previewFromHeaders(headers, 6)).toBeNull()
  })

  it('rejects malformed physical formats and page bounds', () => {
    const headers = new Headers({
      'X-Plan-Sha256': preview.sha256,
      'X-Plan-Page': '6',
      'X-Plan-Page-Count': '5',
      'X-Plan-Page-Width': '842',
      'X-Plan-Page-Height': '1191',
    })
    expect(previewFromHeaders(headers, 6)).toBeNull()
    headers.set('X-Plan-Page-Count', '48')
    headers.set('X-Plan-Page-Height', 'Infinity')
    expect(previewFromHeaders(headers, 6)).toBeNull()
    headers.set('X-Plan-Page-Height', '0')
    expect(previewFromHeaders(headers, 6)).toBeNull()
  })

  it('keeps unfinished or out-of-bounds numeric editing separate from drawable points', () => {
    expect(finiteContourPoint({ x: 0, y: 1000 })).toBe(true)
    expect(finiteContourPoint({ x: Number.NaN, y: 1 })).toBe(false)
    expect(finiteContourPoint({ x: 1000.1, y: 1 })).toBe(false)
    expect(finiteContourPoint({ x: 1, y: -0.1 })).toBe(false)
  })

  it('proposes the exact native vertex for an imprecise click without rounding its original coordinates', () => {
    const native = { x: 123.45678912345, y: 345.6789123456 }
    const result = snapPageContourPoint({ x: native.x + 0.1, y: native.y - 0.1 }, [native], preview)
    expect(result.kind).toBe('candidate')
    if (result.kind !== 'candidate') throw new Error('Expected candidate')
    expect(result.point).toEqual(native)
    expect(result.point.x).toBe(native.x)
    expect(result.distance).toBeGreaterThan(0)
    expect(nativeContourPoint(result.point, [native])).toBe(true)
    expect(nativeContourPoint({ x: 123.5, y: 345.7 }, [native])).toBe(false)
  })

  it('measures the candidate radius in physical PDF points on both axes', () => {
    const native = { x: 100, y: 200 }
    expect(snapPageContourPoint({ x: 103.5, y: 200 }, [native], preview).kind).toBe('candidate')
    expect(snapPageContourPoint({ x: 100, y: 203.5 }, [native], preview).kind).toBe('none')
    expect(snapPageContourPoint({ x: 104, y: 200 }, [native], preview).kind).toBe('none')
  })

  it('refuses equally close competing nodes and keeps the user click unbound', () => {
    const click = { x: 100, y: 200 }
    const nodes = [
      { x: 99, y: 200 },
      { x: 101, y: 200 },
    ]
    expect(snapPageContourPoint(click, nodes, preview)).toEqual({ kind: 'ambiguous' })
    expect(nativeContourPoint(click, nodes)).toBe(false)
  })

  it('deduplicates native vertices and permits an explicit exact numeric node beside other nearby features', () => {
    const native = { x: 100, y: 200 }
    expect(snapPageContourPoint(native, [native, native, { x: 100.1, y: 200 }], preview)).toEqual({
      kind: 'candidate',
      point: native,
      distance: 0,
    })
  })

  it('refuses invalid source format and nonfinite candidates instead of freely accepting coordinates', () => {
    const point = { x: 100, y: 200 }
    expect(snapPageContourPoint(point, [], preview)).toEqual({ kind: 'none' })
    expect(snapPageContourPoint(point, [point], { ...preview, width: 0 })).toEqual({ kind: 'none' })
    expect(snapPageContourPoint(point, [{ x: Number.NaN, y: 200 }], preview)).toEqual({
      kind: 'none',
    })
    expect(snapPageContourPoint({ x: -1, y: 200 }, [point], preview)).toEqual({ kind: 'none' })
  })

  it('accepts only a bounded finite normalized vector payload and deduplicates without changing native precision', () => {
    const point = { x: 123.45678912345, y: 234.5678912345 }
    expect(nativePointsFromResponse({ points: [point, point] })).toEqual([point])
    expect(nativePointsFromResponse({ points: [] })).toBeNull()
    expect(nativePointsFromResponse({ points: [null] })).toBeNull()
    expect(nativePointsFromResponse({ points: [{ x: '100', y: 100 }] })).toBeNull()
    expect(nativePointsFromResponse({ points: [{ x: 1001, y: 100 }] })).toBeNull()
    expect(nativePointsFromResponse({ points: [{ x: 100, y: Number.NaN }] })).toBeNull()
    expect(
      nativePointsFromResponse({ points: Array.from({ length: 20_001 }, () => point) }),
    ).toBeNull()
  })
})
