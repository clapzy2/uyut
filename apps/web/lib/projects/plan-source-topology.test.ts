import { describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({ queue: vi.fn() }))
vi.mock('../../../../packages/ai/src/fal-queue', () => ({
  FalError: class FalError extends Error {},
  falQueue: mocks.queue,
  toDataUri: () => 'data:image/png;base64,test',
}))

import {
  parseSourcePlanTopology,
  readSourcePlanTopology,
} from '../../../../packages/ai/src/floor-plan-source'

function source() {
  const polygon = [
    { x: 500, y: 600 },
    { x: 800, y: 600 },
    { x: 800, y: 800 },
    { x: 750, y: 850 },
    { x: 500, y: 850 },
  ]
  return {
    footprint: polygon,
    rooms: [{ name: 'Балкон', sourceNumber: 5, spaceKind: 'balcony', polygon }],
    openings: [{ type: 'window', start: { x: 600, y: 600 }, end: { x: 700, y: 600 } }],
    uncertainties: [],
  }
}

describe('experimental source-space tracing', () => {
  it('preserves the diagonal and visible openings without inventing metric dimensions', () => {
    const input = { ...source(), status: 'confirmed', widthCm: 800 }
    const result = parseSourcePlanTopology(JSON.stringify(input))
    expect(result.status).toBe('draft')
    expect(result.coordinateSpace).toBe('image-1000')
    expect(result.rooms[0]?.polygon).toEqual(input.footprint)
    expect(result.openings).toEqual(input.openings)
    expect(result).not.toHaveProperty('widthCm')
    expect(result.openings[0]).not.toHaveProperty('widthCm')
  })

  it('keeps an unreadable contour unknown instead of closing it', () => {
    const input = source()
    const result = parseSourcePlanTopology(
      JSON.stringify({
        ...input,
        footprint: null,
        rooms: [{ ...input.rooms[0], polygon: null }],
        uncertainties: ['Нижний край обрезан'],
      }),
    )
    expect(result.footprint).toBeNull()
    expect(result.rooms[0]?.polygon).toBeNull()
    expect(result.uncertainties).toHaveLength(1)
  })

  it('normalizes only a repeated closing vertex without changing the diagonal', () => {
    const input = source()
    expect(
      parseSourcePlanTopology(
        JSON.stringify({ ...input, footprint: [...input.footprint, input.footprint[0]] }),
      ).footprint,
    ).toEqual(input.footprint)
  })

  it('captures the raw response before rejecting a malformed trace', async () => {
    const capture = vi.fn().mockResolvedValue(undefined)
    mocks.queue.mockReset().mockResolvedValue({ output: '{"rooms":[]}' })
    await expect(
      readSourcePlanTopology(
        'test-key',
        { body: Buffer.from('test'), contentType: 'image/png' },
        capture,
      ),
    ).rejects.toThrow()
    expect(capture).toHaveBeenCalledWith('{"rooms":[]}')
    expect(mocks.queue).toHaveBeenCalledTimes(1)
  })

  it.each([
    {
      ...source(),
      footprint: [
        { x: 0, y: 0 },
        { x: 1001, y: 0 },
        { x: 0, y: 1 },
      ],
    },
    {
      ...source(),
      footprint: [
        { x: 0, y: 0 },
        { x: 1, y: 0 },
        { x: 0, y: 0 },
      ],
    },
    { ...source(), openings: [{ type: 'window', start: { x: 1, y: 1 }, end: { x: 1, y: 1 } }] },
    { ...source(), openings: [{ type: 'window', start: { x: '1', y: 1 }, end: { x: 2, y: 1 } }] },
    { ...source(), rooms: [{ ...source().rooms[0], sourceNumber: 0 }] },
    { ...source(), rooms: Array.from({ length: 51 }, () => source().rooms[0]) },
  ])('rejects invalid source positions/structures without silently dropping objects', (input) => {
    expect(() => parseSourcePlanTopology(JSON.stringify(input))).toThrow()
  })

  it('makes exactly one request and does not send the metric candidate back as evidence', async () => {
    mocks.queue.mockReset().mockResolvedValue({ output: JSON.stringify(source()) })
    const result = await readSourcePlanTopology('test-key', {
      body: Buffer.from('test'),
      contentType: 'image/png',
    })
    expect(result.status).toBe('draft')
    expect(mocks.queue).toHaveBeenCalledTimes(1)
    expect(mocks.queue.mock.calls[0]?.[2]).toMatchObject({
      image_urls: ['data:image/png;base64,test'],
      temperature: 0,
      max_tokens: 12000,
    })
  })

  it.each([{ output: '{}', partial: true }, { output: '{}', error: 'failure' }, { output: '' }])(
    'does not retry partial or failed answers',
    async (response) => {
      mocks.queue.mockReset().mockResolvedValue(response)
      await expect(
        readSourcePlanTopology('test-key', { body: Buffer.from('test'), contentType: 'image/png' }),
      ).rejects.toThrow()
      expect(mocks.queue).toHaveBeenCalledTimes(1)
    },
  )
})
