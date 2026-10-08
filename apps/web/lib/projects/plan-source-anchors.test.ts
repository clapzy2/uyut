import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({ queue: vi.fn() }))
vi.mock('../../../../packages/ai/src/fal-queue', () => ({
  FalError: class FalError extends Error {},
  falQueue: mocks.queue,
  toDataUri: (image: { body: Buffer }) => `data:image/png;base64,${image.body.toString('base64')}`,
}))

import {
  parseAnchoredSourceTopology,
  readAnchoredSourceTopology,
  type SourcePlanAnchors,
} from '../../../../packages/ai/src/floor-plan-source-anchors'

const image = { body: Buffer.from('original'), contentType: 'image/png' }
const overlay = { body: Buffer.from('overlay'), contentType: 'image/png' }
const source: SourcePlanAnchors = {
  width: 800,
  height: 400,
  anchors: [
    { id: 'a', x: 0, y: 0 },
    { id: 'b', x: 800, y: 0 },
    { id: 'c', x: 800, y: 300 },
    { id: 'd', x: 600, y: 400 },
    { id: 'e', x: 0, y: 400 },
  ],
  segments: [{ startId: 'a', endId: 'b' }],
}

function response() {
  return {
    footprint: ['a', 'b', 'c', 'd', 'e'],
    rooms: [{ name: 'Балкон', spaceKind: 'balcony', pointIds: ['a', 'b', 'c', 'd', 'e'] }],
    openings: [{ type: 'balcony', startId: 'c', endId: 'd' }],
    uncertainties: [],
  }
}

beforeEach(() => mocks.queue.mockReset())

describe('experimental anchored source reader', () => {
  it('decodes source pixels independently per axis and preserves the diagonal', () => {
    const result = parseAnchoredSourceTopology(JSON.stringify(response()), source)
    expect(result.footprint).toEqual([
      { x: 0, y: 0 },
      { x: 1000, y: 0 },
      { x: 1000, y: 750 },
      { x: 750, y: 1000 },
      { x: 0, y: 1000 },
    ])
    expect(result.openings[0]).toEqual({
      type: 'balcony',
      start: { x: 1000, y: 750 },
      end: { x: 750, y: 1000 },
    })
  })

  it('does not import model coordinates, dimensions, source numbers or confirmation status', () => {
    const input = response()
    const result = parseAnchoredSourceTopology(
      JSON.stringify({
        ...input,
        status: 'confirmed',
        widthMm: 6000,
        rooms: [{ ...input.rooms[0], sourceNumber: 5, polygon: [{ x: 50, y: 50 }] }],
      }),
      source,
    )
    expect(result.status).toBe('draft')
    expect(result).not.toHaveProperty('widthMm')
    expect(result.rooms[0]).not.toHaveProperty('sourceNumber')
    expect(result.rooms[0]?.polygon).toEqual(result.footprint)
  })

  it('allows unknown contours without closing them', () => {
    const input = response()
    const result = parseAnchoredSourceTopology(
      JSON.stringify({
        ...input,
        footprint: null,
        rooms: [{ ...input.rooms[0], pointIds: null }],
        uncertainties: ['Край обрезан'],
      }),
      source,
    )
    expect(result.footprint).toBeNull()
    expect(result.rooms[0]?.polygon).toBeNull()
    expect(result.uncertainties).toEqual(['Край обрезан'])
  })

  it('rejects unknown IDs instead of falling back to model coordinates', () => {
    expect(() =>
      parseAnchoredSourceTopology(
        JSON.stringify({ ...response(), footprint: ['a', 'b', 'missing'] }),
        source,
      ),
    ).toThrow('Неизвестный идентификатор')
  })

  it.each([
    ['a', 'b'],
    ['a', 'b', 'c', 'b'],
    ['a', 'b', 'a'],
  ])('rejects short or repeated non-closing polygon vertices: %j', (...ids) => {
    expect(() =>
      parseAnchoredSourceTopology(JSON.stringify({ ...response(), footprint: ids }), source),
    ).toThrow()
  })

  it('accepts only the conventional repeated closing vertex', () => {
    const input = response()
    expect(
      parseAnchoredSourceTopology(
        JSON.stringify({ ...input, footprint: [...input.footprint, 'a'] }),
        source,
      ).footprint,
    ).toEqual(parseAnchoredSourceTopology(JSON.stringify(input), source).footprint)
  })

  it('rejects crossing contour joins even when their endpoint IDs are valid', () => {
    expect(() =>
      parseAnchoredSourceTopology(
        JSON.stringify({ ...response(), footprint: ['a', 'c', 'b', 'e'] }),
        source,
      ),
    ).toThrow('пересекает сам себя')
  })

  it('rejects zero-area contours made from valid collinear anchors', () => {
    const input = { ...source, anchors: [...source.anchors, { id: 'middle', x: 400, y: 0 }] }
    expect(() =>
      parseAnchoredSourceTopology(
        JSON.stringify({ ...response(), footprint: ['a', 'middle', 'b'] }),
        input,
      ),
    ).toThrow('нулевую площадь')
  })

  it('rejects zero-length openings, even when different IDs share one position', () => {
    const input = { ...source, anchors: [...source.anchors, { id: 'alias', x: 0, y: 0 }] }
    expect(() =>
      parseAnchoredSourceTopology(
        JSON.stringify({
          ...response(),
          openings: [{ type: 'door', startId: 'a', endId: 'alias' }],
        }),
        input,
      ),
    ).toThrow('нулевую длину')
  })

  it.each([
    { ...source, width: 0 },
    { ...source, height: 4001 },
    { ...source, width: 800.5 },
    { ...source, anchors: [{ id: 'a', x: Number.NaN, y: 0 }] },
    { ...source, anchors: [{ id: 'a', x: 801, y: 0 }] },
    { ...source, anchors: [...source.anchors, source.anchors[0]] },
    { ...source, anchors: [] },
    { ...source, anchors: Array.from({ length: 501 }, (_, i) => ({ id: `${i}`, x: 0, y: 0 })) },
    { ...source, segments: [{ startId: 'a', endId: 'missing' }] },
    { ...source, segments: [{ startId: 'a', endId: 'a' }] },
  ])('rejects invalid input before making a request', async (input) => {
    await expect(
      readAnchoredSourceTopology('test', image, input as SourcePlanAnchors),
    ).rejects.toThrow()
    expect(mocks.queue).not.toHaveBeenCalled()
  })

  it('uses one configured vision request with original and overlay images', async () => {
    mocks.queue.mockResolvedValue({ output: JSON.stringify(response()) })
    await readAnchoredSourceTopology('test', image, source, overlay)
    expect(mocks.queue).toHaveBeenCalledTimes(1)
    expect(mocks.queue.mock.calls[0]?.[1]).toBe('openrouter/router/vision')
    expect(mocks.queue.mock.calls[0]?.[2]).toMatchObject({
      model: 'anthropic/claude-sonnet-4.5',
      image_urls: [
        `data:image/png;base64,${image.body.toString('base64')}`,
        `data:image/png;base64,${overlay.body.toString('base64')}`,
      ],
      temperature: 0,
      max_tokens: 12000,
    })
  })

  it.each([
    { output: '{"rooms":[]}' },
    { output: '{}', partial: true },
    { output: '{}', error: 'failure' },
  ])('captures raw failed replies and never retries', async (reply) => {
    const capture = vi.fn().mockResolvedValue(undefined)
    mocks.queue.mockResolvedValue(reply)
    await expect(
      readAnchoredSourceTopology('test', image, source, overlay, capture),
    ).rejects.toThrow()
    expect(capture).toHaveBeenCalledWith(reply.output)
    expect(mocks.queue).toHaveBeenCalledTimes(1)
  })
})
