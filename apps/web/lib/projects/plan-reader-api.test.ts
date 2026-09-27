import { describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({ queue: vi.fn() }))
vi.mock('../../../../packages/ai/src/fal-queue', () => ({
  FalError: class FalError extends Error {},
  falQueue: mocks.queue,
  toDataUri: () => 'data:image/jpeg;base64,test',
}))

import {
  createFalPlanReader,
  PLAN_READER_ENDPOINT,
  parseFloorPlan,
  planReaderPrompt,
} from '../../../../packages/ai/src/floor-plan'

describe('fal vision contract', () => {
  const image = { body: Buffer.from('test'), contentType: 'image/jpeg' }

  it('sends image_urls, deterministic temperature and a token limit', async () => {
    mocks.queue.mockResolvedValue({ output: '{"rooms":[{"name":"Кухня","areaM2":12.35}]}' })
    const reading = await createFalPlanReader('test-key')(image)
    expect(reading.rooms[0]?.areaM2).toBe(12.35)
    expect(PLAN_READER_ENDPOINT).toBe('openrouter/router/vision')
    expect(mocks.queue.mock.calls.at(-1)?.[1]).toBe(PLAN_READER_ENDPOINT)
    const input = mocks.queue.mock.calls.at(-1)?.[2]
    expect(input).toMatchObject({
      image_urls: ['data:image/jpeg;base64,test'],
      temperature: 0,
      max_tokens: 12000,
    })
    expect(input).not.toHaveProperty('image_url')
  })

  it('does not retry or fall back to a deprecated paid endpoint on network failure', async () => {
    mocks.queue.mockClear().mockRejectedValueOnce(new Error('request failed'))
    await expect(createFalPlanReader('test-key')(image)).rejects.toThrow('request failed')
    expect(mocks.queue).toHaveBeenCalledTimes(1)
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

describe('indexed native text contract', () => {
  it('preserves source positions, duplicates and coordinates without trusting an input index', () => {
    const items = [
      { text: '1344', x: 10.25, y: 20.5, rotation: 0, index: 99 },
      null,
      { text: '1344', x: 30.5, y: 42, rotation: 90 },
    ]
    const prompt = planReaderPrompt(JSON.stringify(items))
    const payload = JSON.parse(prompt.slice(prompt.indexOf('\n') + 1))
    expect(payload).toEqual([
      { index: 0, text: '1344', x: 10.25, y: 20.5, rotation: 0 },
      { index: 1, text: '', rotation: null },
      { index: 2, text: '1344', x: 30.5, y: 42, rotation: 90 },
    ])
    expect(prompt).toContain('не сдвигай индексы')
    expect(items[0]?.index).toBe(99)
  })

  it('does not silently renumber or truncate a long array', () => {
    const items = Array.from({ length: 193 }, (_, index) => ({ text: `${index}`, rotation: 0 }))
    const prompt = planReaderPrompt(JSON.stringify(items))
    const payload = JSON.parse(prompt.slice(prompt.indexOf('\n') + 1))
    expect(payload).toHaveLength(193)
    expect(payload[192]).toEqual({ index: 192, text: '192', rotation: 0 })
    expect(planReaderPrompt('[invalid')).not.toContain('[invalid')
    expect(planReaderPrompt('x'.repeat(30_001))).not.toContain('xxx')
    expect(planReaderPrompt()).toBe('Прочитай план.')
  })
})

describe('free-text measurement isolation', () => {
  it.each([
    'Высота потолка 2649 мм',
    'Размер 2735×4205 мм',
    'Высота 2,65 м.',
    'Площадь 14 м²',
    'Проём 896mm',
    'Габариты комнаты 3389×4244',
    'Ширина 3389, глубина 4244',
    'Окно шириной 1344',
    'Height 2649',
  ])('keeps quantitative claims out of the room brief: %s', (layoutNotes) => {
    const reading = parseFloorPlan(
      JSON.stringify({ rooms: [{ name: 'Кухня', areaM2: 12, widthMm: 2735, layoutNotes }] }),
      { requireMeasurementEvidence: true },
    )
    expect(reading.rooms[0]?.widthCm).toBeUndefined()
    expect(reading.rooms[0]?.layoutNotes).toBeUndefined()
    expect(reading.rooms[0]?.measurementWarnings).toContain(
      'Описание архитектуры содержит размеры — уточните их в отдельных полях перед сохранением.',
    )
  })

  it('preserves qualitative architecture and the number of openings', () => {
    const layoutNotes = '2 окна сверху, выступ слева'
    const reading = parseFloorPlan(
      JSON.stringify({ rooms: [{ name: 'Кухня', areaM2: 12, layoutNotes }] }),
    )
    expect(reading.rooms[0]?.layoutNotes).toBe(layoutNotes)
  })
})
