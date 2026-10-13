import { describe, expect, it } from 'vitest'
import { nativeCaptionKnownPaintBlockers } from './plan-native-caption-paint'
import type { PdfPaintBounds } from './plan-pdf-linework'

const caption = [
  { x: 150, y: 180 },
  { x: 200, y: 180 },
  { x: 200, y: 190 },
  { x: 150, y: 190 },
]

describe('known paint over native caption ink', () => {
  it('finds later bounded paint, including paint between grouped text operations', () => {
    const inventory: PdfPaintBounds = {
      complete: true,
      refusalReason: null,
      events: [
        {
          operationIndex: 9,
          kind: 'image',
          bounds: { left: 150, top: 180, right: 200, bottom: 190 },
          reason: null,
        },
        {
          operationIndex: 10,
          kind: 'text',
          bounds: null,
          reason: 'text-paint-envelope-unavailable',
        },
        {
          operationIndex: 11,
          kind: 'image',
          bounds: { left: 160, top: 182, right: 170, bottom: 188 },
          reason: null,
        },
        {
          operationIndex: 12,
          kind: 'text',
          bounds: null,
          reason: 'text-paint-envelope-unavailable',
        },
        {
          operationIndex: 13,
          kind: 'vector',
          bounds: { left: 190, top: 181, right: 210, bottom: 189 },
          reason: null,
        },
        {
          operationIndex: 14,
          kind: 'image',
          bounds: { left: 300, top: 300, right: 350, bottom: 350 },
          reason: null,
        },
      ],
    }
    expect(nativeCaptionKnownPaintBlockers(inventory, [10, 12], caption)).toEqual([11, 13])
  })

  it('does not turn missing envelopes or incomplete inventory into visible-ink proof', () => {
    const inventory: PdfPaintBounds = {
      complete: true,
      refusalReason: null,
      events: [
        {
          operationIndex: 10,
          kind: 'text',
          bounds: null,
          reason: 'text-paint-envelope-unavailable',
        },
        {
          operationIndex: 11,
          kind: 'text',
          bounds: null,
          reason: 'text-paint-envelope-unavailable',
        },
      ],
    }
    expect(nativeCaptionKnownPaintBlockers(inventory, [10], caption)).toEqual([])
    expect(nativeCaptionKnownPaintBlockers(undefined, [10], caption)).toBeNull()
    expect(
      nativeCaptionKnownPaintBlockers({ ...inventory, complete: false }, [10], caption),
    ).toBeNull()
  })

  it('withholds an unbounded later image even when its operator inventory is complete', () => {
    const inventory: PdfPaintBounds = {
      complete: true,
      refusalReason: null,
      events: [
        {
          operationIndex: 10,
          kind: 'text',
          bounds: null,
          reason: 'text-paint-envelope-unavailable',
        },
        {
          operationIndex: 11,
          kind: 'image',
          bounds: null,
          reason: 'image-paint-context-unavailable',
        },
      ],
    }
    expect(nativeCaptionKnownPaintBlockers(inventory, [10], caption)).toEqual([11])
  })
})
