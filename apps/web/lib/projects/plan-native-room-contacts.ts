import type { PlanPageContours } from '@uyut/db'
import {
  exactNativeOrientation,
  exactNativePointKey,
  exactNativePolygonsOverlap,
} from './plan-native-exact-intersections'
import type { PagePoint } from './plan-pdf-linework'
import { pdfContourKey, pdfContourRoomNumbers, pdfPolygonIsValid } from './plan-pdf-room-binding'

export type NativeRoomContacts = {
  status: 'candidate' | 'unresolved'
  reason?: string
  total: number
  truncated: boolean
  spans: {
    firstRoomKey: string
    secondRoomKey: string
    firstEdgeIndex: number
    secondEdgeIndex: number
    start: PagePoint
    end: PagePoint
  }[]
  physicalPassagesAccepted: false
}

/** Common source-space boundary only. A shared edge is not a wall, door or clear passage. */
export function nativeRoomContacts(
  contours: Pick<PlanPageContours, 'source' | 'coordinateSystem' | 'rooms'>,
): NativeRoomContacts {
  const fail = (reason: string): NativeRoomContacts => ({
    status: 'unresolved',
    reason,
    total: 0,
    truncated: false,
    spans: [],
    physicalPassagesAccepted: false,
  })
  if (
    contours.coordinateSystem !== 'page-0-1000' ||
    contours.source.state !== 'existing' ||
    !/^[a-f0-9]{64}$/.test(contours.source.sha256) ||
    !Number.isSafeInteger(contours.source.pdfPage) ||
    contours.source.pdfPage < 1 ||
    contours.source.pdfPage > 9999
  )
    return fail('invalid-contact-source')
  const rooms = contours.rooms
  if (
    rooms.length < 1 ||
    rooms.length > 100 ||
    rooms.reduce((sum, room) => sum + room.polygon.length, 0) > 500
  )
    return fail('room-contact-work-limit')
  const numbers = rooms.flatMap((room) => [...pdfContourRoomNumbers(room)])
  if (
    rooms.some(
      (room) =>
        room.roomSourceNumbers !== undefined &&
        (Object.hasOwn(room, 'roomSourceNumber') ||
          room.roomSourceNumbers.length < 2 ||
          room.roomSourceNumbers.length > 12),
    ) ||
    numbers.some((number) => !Number.isSafeInteger(number) || number < 1 || number > 10_000) ||
    new Set(numbers).size !== numbers.length
  )
    return fail('ambiguous-contact-identities')
  if (rooms.some((room) => !pdfPolygonIsValid(room.polygon))) return fail('invalid-contact-polygon')
  if (rooms.some((room) => room.polygon.some((point) => exactNativePointKey(point) === null)))
    return fail('unsupported-contact-coordinate-precision')
  const result: NativeRoomContacts = {
    status: 'candidate',
    total: 0,
    truncated: false,
    spans: [],
    physicalPassagesAccepted: false,
  }
  for (const [firstIndex, first] of rooms.entries()) {
    for (const second of rooms.slice(firstIndex + 1)) {
      const overlap = exactNativePolygonsOverlap(first.polygon, second.polygon)
      if (overlap === null) return fail('unsupported-contact-coordinate-precision')
      if (overlap) return fail('overlapping-contact-rooms')
      for (const [firstEdgeIndex, a] of first.polygon.entries()) {
        const b = first.polygon[(firstEdgeIndex + 1) % first.polygon.length]
        if (!b) return fail('invalid-contact-polygon')
        for (const [secondEdgeIndex, c] of second.polygon.entries()) {
          const d = second.polygon[(secondEdgeIndex + 1) % second.polygon.length]
          if (!d) return fail('invalid-contact-polygon')
          if (
            Math.max(a.x, b.x) < Math.min(c.x, d.x) ||
            Math.max(c.x, d.x) < Math.min(a.x, b.x) ||
            Math.max(a.y, b.y) < Math.min(c.y, d.y) ||
            Math.max(c.y, d.y) < Math.min(a.y, b.y) ||
            exactNativeOrientation(a, b, c) !== 0 ||
            exactNativeOrientation(a, b, d) !== 0
          )
            continue
          const axis = Math.abs(b.x - a.x) >= Math.abs(b.y - a.y) ? 'x' : 'y'
          const firstLow = a[axis] < b[axis] ? a : b
          const firstHigh = a[axis] < b[axis] ? b : a
          const secondLow = c[axis] < d[axis] ? c : d
          const secondHigh = c[axis] < d[axis] ? d : c
          const start = firstLow[axis] > secondLow[axis] ? firstLow : secondLow
          const end = firstHigh[axis] < secondHigh[axis] ? firstHigh : secondHigh
          if (start[axis] >= end[axis]) continue // A corner touch has no positive-length boundary.
          result.total++
          if (result.spans.length < 200)
            result.spans.push({
              firstRoomKey: pdfContourKey(first),
              secondRoomKey: pdfContourKey(second),
              firstEdgeIndex,
              secondEdgeIndex,
              start: { ...start },
              end: { ...end },
            })
        }
      }
    }
  }
  result.truncated = result.total > result.spans.length
  return result
}
