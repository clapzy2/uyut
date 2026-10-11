import type { PlanPageContours } from '@uyut/db'
import { describe, expect, it } from 'vitest'
import { exactNativePolygonsOverlap } from './plan-native-exact-intersections'
import { nativeRoomContacts } from './plan-native-room-contacts'
import type { PagePoint } from './plan-pdf-linework'

const rect = (left: number, top: number, right: number, bottom: number): PagePoint[] => [
  { x: left, y: top },
  { x: right, y: top },
  { x: right, y: bottom },
  { x: left, y: bottom },
]
function sample(polygons: PagePoint[][]) {
  return {
    source: { sha256: 'a'.repeat(64), pdfPage: 1, state: 'existing' as const },
    coordinateSystem: 'page-0-1000' as const,
    rooms: polygons.map((polygon, index) => ({ roomSourceNumber: index + 1, polygon })),
  }
}
describe('exact-decimal common boundaries, never physical passage proof', () => {
  it('retains both edge indexes and exact endpoints for a partial reversed shared edge', () => {
    const input = sample([rect(10, 10, 100, 100), rect(100, 30, 150, 70)])
    const before = structuredClone(input)
    const result = nativeRoomContacts(input)
    expect(result).toMatchObject({
      status: 'candidate',
      total: 1,
      truncated: false,
      physicalPassagesAccepted: false,
    })
    expect(result.spans[0]).toEqual({
      firstRoomKey: '1',
      secondRoomKey: '2',
      firstEdgeIndex: 1,
      secondEdgeIndex: 3,
      start: { x: 100, y: 30 },
      end: { x: 100, y: 70 },
    })
    const span = result.spans[0]
    if (!span) throw new Error('Missing contact')
    span.start.x = 99
    expect(input).toEqual(before)
  })
  it.each(['gap', 'corner'])('does not snap a %s into a boundary or a door', (kind) => {
    const input = sample([
      rect(10, 10, 100, 100),
      kind === 'gap' ? rect(100.000001, 10, 150, 100) : rect(100, 100, 150, 150),
    ])
    expect(nativeRoomContacts(input)).toMatchObject({
      status: 'candidate',
      total: 0,
      spans: [],
      physicalPassagesAccepted: false,
    })
  })
  it('handles true decimal diagonal adjacency regardless of winding order', () => {
    const first = [
      { x: 0.1, y: 0.3 },
      { x: 0.3, y: 0.9 },
      { x: 0.3, y: 0.3 },
    ]
    const second = [
      { x: 0.2, y: 0.6 },
      { x: 0.3, y: 0.9 },
      { x: 0.1, y: 0.9 },
    ]
    for (const a of [first, [...first].reverse()])
      for (const b of [second, [...second].reverse()]) {
        expect(exactNativePolygonsOverlap(a, b)).toBe(false)
        const result = nativeRoomContacts(sample([a, b]))
        expect(result.status).toBe('candidate')
        expect(result.spans.map(({ start, end }) => [start, end])).toEqual([
          [
            { x: 0.2, y: 0.6 },
            { x: 0.3, y: 0.9 },
          ],
        ])
      }
  })
  it('rejects positive overlap including identical and inscribed polygons with only boundary vertices', () => {
    const outer = rect(0, 0, 100, 100)
    const diamond = [
      { x: 50, y: 0 },
      { x: 100, y: 50 },
      { x: 50, y: 100 },
      { x: 0, y: 50 },
    ]
    for (const inner of [
      outer,
      [...outer].reverse(),
      diamond,
      rect(10, 10, 90, 90),
      rect(50, 50, 150, 150),
    ]) {
      expect(exactNativePolygonsOverlap(outer, inner)).toBe(true)
      expect(nativeRoomContacts(sample([outer, inner]))).toMatchObject({
        status: 'unresolved',
        reason: 'overlapping-contact-rooms',
        spans: [],
      })
    }
  })
  it('does not accept two decimal polygons occupying the same side of a common diagonal', () => {
    const a = [
      { x: 0.1, y: 0.3 },
      { x: 0.3, y: 0.9 },
      { x: 0.3, y: 0.3 },
    ]
    const b = [
      { x: 0.2, y: 0.6 },
      { x: 0.3, y: 0.9 },
      { x: 0.3, y: 0.6 },
    ]
    expect(exactNativePolygonsOverlap(a, b)).toBe(true)
    expect(nativeRoomContacts(sample([a, b])).status).toBe('unresolved')
  })
  it.each(['source', 'frame', 'identity', 'precision', 'budget'])(
    'refuses invalid %s without emitting partial contacts',
    (change) => {
      const input = sample([rect(10, 10, 100, 100), rect(100, 30, 150, 70)])
      if (change === 'source') input.source.sha256 = 'bad'
      if (change === 'frame') input.coordinateSystem = 'pixels' as 'page-0-1000'
      if (change === 'identity')
        input.rooms[1] = { roomSourceNumber: 1, polygon: rect(100, 30, 150, 70) }
      if (change === 'precision')
        input.rooms[0] = { roomSourceNumber: 1, polygon: rect(1e-19, 10, 100, 100) }
      if (change === 'budget')
        input.rooms = Array.from({ length: 126 }, (_, index) => ({
          roomSourceNumber: index + 1,
          polygon: rect(10, 10, 100, 100),
        }))
      expect(nativeRoomContacts(input)).toMatchObject({
        status: 'unresolved',
        total: 0,
        spans: [],
        physicalPassagesAccepted: false,
      })
    },
  )
  it('rejects empty grouped identities', () => {
    const input = sample([rect(10, 10, 100, 100)])
    const malformed = {
      ...input,
      rooms: [{ roomSourceNumbers: [], polygon: rect(10, 10, 100, 100) }],
    } as Pick<PlanPageContours, 'source' | 'coordinateSystem' | 'rooms'>
    expect(nativeRoomContacts(malformed).reason).toBe('ambiguous-contact-identities')
  })
  it('bounds displayed fragments but retains the full contact count', () => {
    const polygons = Array.from({ length: 64 }, (_, index) => {
      const x = (index % 8) * 10,
        y = Math.floor(index / 8) * 10
      if (index >= 58) return rect(x, y, x + 10, y + 10)
      return [
        { x, y },
        { x: x + 5, y },
        { x: x + 10, y },
        { x: x + 10, y: y + 5 },
        { x: x + 10, y: y + 10 },
        { x: x + 5, y: y + 10 },
        { x, y: y + 10 },
        { x, y: y + 5 },
      ]
    })
    const result = nativeRoomContacts(sample(polygons))
    expect(result.status).toBe('candidate')
    expect(result.total).toBeGreaterThan(200)
    expect(result.spans).toHaveLength(200)
    expect(result.truncated).toBe(true)
  })
})
