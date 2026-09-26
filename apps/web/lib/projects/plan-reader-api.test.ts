import { describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({ queue: vi.fn() }))
vi.mock('../../../../packages/ai/src/fal-queue', () => ({
  FalError: class FalError extends Error {},
  falQueue: mocks.queue,
  toDataUri: () => 'data:image/jpeg;base64,test',
}))

import { createFalPlanReader } from '../../../../packages/ai/src/floor-plan'

describe('fal vision contract', () => {
  const image = { body: Buffer.from('test'), contentType: 'image/jpeg' }

  it('sends image_urls, deterministic temperature and a token limit', async () => {
    mocks.queue.mockResolvedValue({ output: '{"rooms":[{"name":"Кухня","areaM2":12.35}]}' })
    const reading = await createFalPlanReader('test-key')(image)
    expect(reading.rooms[0]?.areaM2).toBe(12.35)
    const input = mocks.queue.mock.calls.at(-1)?.[2]
    expect(input).toMatchObject({
      image_urls: ['data:image/jpeg;base64,test'],
      temperature: 0,
      max_tokens: 12000,
    })
    expect(input).not.toHaveProperty('image_url')
  })

  it.each([
    { output: '{}', partial: true },
    { output: '{}', error: 'model failure' },
    { output: '' },
  ])('rejects unusable responses without retry', async (response) => {
    mocks.queue.mockClear().mockResolvedValue(response)
    await expect(createFalPlanReader('test-key')(image)).rejects.toThrow('план не прочитан')
    expect(mocks.queue).toHaveBeenCalledTimes(1)
  })
})
