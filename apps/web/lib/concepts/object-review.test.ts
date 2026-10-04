import {
  type DetectedObject,
  parseObjectReview,
  reviewDetectedObjects,
  selectObjects,
} from '@uyut/ai'
import { afterEach, describe, expect, it, vi } from 'vitest'

const candidates: DetectedObject[] = [
  { label: 'a rug', category: 'rug', bbox: { x: 0.1, y: 0.7, w: 0.6, h: 0.2 }, area: 0.12 },
  { label: 'an armchair', category: 'chair', bbox: { x: 0.2, y: 0.5, w: 0.4, h: 0.3 }, area: 0.12 },
  {
    label: 'a framed picture',
    category: 'decor',
    bbox: { x: 0.1, y: 0.1, w: 0.2, h: 0.3 },
    area: 0.06,
  },
]
const answers = [
  { index: 0, label: null, reason: 'Здесь только паркет, ковра нет.' },
  { index: 1, label: 'a sofa', reason: 'Видны несколько мест и общая спинка дивана.' },
  { index: 2, label: null, reason: 'Это окно с рамой, а не картина.' },
]
const json = (objects: unknown) => JSON.stringify({ objects })

afterEach(() => vi.restoreAllMocks())

describe('проверка предметов до подбора', () => {
  it.each([
    ['living', 'a sofa', 'sofa'],
    ['bedroom', 'a bed', 'bed'],
    ['kitchen', 'a dining table', 'table'],
    ['bath', 'a mirror', 'decor'],
    ['kid', 'a desk', 'table'],
  ] as const)('применяет словарь комнаты %s, не общий список мебели', (kind, label, category) => {
    const result = parseObjectReview(
      json([{ index: 0, label, reason: 'Тип предмета различим в вырезке.' }]),
      [candidates[0] as DetectedObject],
      kind,
    )
    expect(result[0]).toMatchObject({ label, category, bbox: candidates[0]?.bbox })
  })

  it('исключает пол и окно и исправляет кресло на диван без смены координат', () => {
    const result = parseObjectReview(json(answers), candidates, 'living')
    expect(result).toEqual([{ ...candidates[1], label: 'a sofa', category: 'sofa' }])
    expect(candidates[1]?.label).toBe('an armchair')
  })

  it('сопоставляет ответы по index, а не по их порядку', () => {
    expect(parseObjectReview(json([...answers].reverse()), candidates, 'living')).toHaveLength(1)
  })

  it('может отклонить все рамки и не сочиняет замену', () => {
    expect(
      parseObjectReview(
        json(answers.map((item) => ({ ...item, label: null }))),
        candidates,
        'living',
      ),
    ).toEqual([])
  })

  it.each([
    '',
    'null',
    '{}',
    '[]',
    '{"objects":null}',
    json(answers.slice(0, 2)),
    json([...answers, answers[0]]),
    json([answers[0], answers[0], answers[2]]),
    json([{ ...answers[0], index: -1 }, answers[1], answers[2]]),
    json([{ ...answers[0], index: 0.5 }, answers[1], answers[2]]),
    json([{ ...answers[0], index: 3 }, answers[1], answers[2]]),
    json([{ ...answers[0], label: 'a window' }, answers[1], answers[2]]),
    json([{ ...answers[0], label: 'a bed' }, answers[1], answers[2]]),
    json([{ ...answers[0], reason: '' }, answers[1], answers[2]]),
    json([{ ...answers[0], reason: 'x'.repeat(601) }, answers[1], answers[2]]),
    json([{ ...answers[0], label: undefined }, answers[1], answers[2]]),
  ])('не пропускает непроверенные рамки при неверном ответе: %s', (raw) => {
    expect(() => parseObjectReview(raw, candidates, 'living')).toThrow('Проверка предметов')
  })

  it('повторно убирает дубли после исправления класса', () => {
    const duplicates = [
      { ...(candidates[1] as DetectedObject) },
      { ...(candidates[1] as DetectedObject) },
    ]
    const result = parseObjectReview(
      json(duplicates.map((_, index) => ({ index, label: 'a sofa', reason: 'Один диван.' }))),
      duplicates,
      'living',
    )
    expect(result).toHaveLength(1)
  })

  it('не пускает численно неверные и внешние рамки к вырезке', () => {
    for (const bbox of [
      { x: Number.NaN, y: 0.1, w: 0.4, h: 0.4 },
      { x: 0.9, y: 0.1, w: 0.4, h: 0.4 },
      { x: -0.1, y: 0.1, w: 0.4, h: 0.4 },
      { x: 0.1, y: 0.1, w: -0.4, h: -0.4 },
    ]) {
      expect(selectObjects([{ label: 'a sofa', category: 'sofa', bbox }], 6)).toEqual([])
    }
  })

  it('отправляет один полный кадр и вырезки в одном платном запросе', async () => {
    const fetchMock = vi
      .spyOn(globalThis, 'fetch')
      .mockResolvedValueOnce(
        Response.json({
          status_url: 'https://queue.fal.run/status',
          response_url: 'https://queue.fal.run/result',
        }),
      )
      .mockResolvedValueOnce(Response.json({ status: 'COMPLETED' }))
      .mockResolvedValueOnce(Response.json({ output: json(answers) }))
    const image = { body: Buffer.from('room'), contentType: 'image/jpeg' }
    const crops = candidates.map((_, index) => ({
      body: Buffer.from(`crop-${index}`),
      contentType: 'image/jpeg',
    }))
    const result = await reviewDetectedObjects('test-only', image, candidates, crops, 'living')
    expect(result[0]?.category).toBe('sofa')
    const requests = fetchMock.mock.calls.filter((call) => call[1]?.method === 'POST')
    expect(requests).toHaveLength(1)
    const body = JSON.parse(String(requests[0]?.[1]?.body))
    expect(body.image_urls).toEqual(
      [image, ...crops].map(
        (item) => `data:${item.contentType};base64,${item.body.toString('base64')}`,
      ),
    )
    expect(body.system_prompt).toContain('Подпись кандидата — гипотеза, не факт')
  })

  it('не запускает запрос для пустого списка', async () => {
    const fetchMock = vi.spyOn(globalThis, 'fetch')
    expect(
      await reviewDetectedObjects(
        'test-only',
        { body: Buffer.alloc(0), contentType: 'image/jpeg' },
        [],
        [],
        'living',
      ),
    ).toEqual([])
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('при отказе сервиса не повторяет оплату и не возвращает сырые метки', async () => {
    const fetchMock = vi
      .spyOn(globalThis, 'fetch')
      .mockResolvedValue(new Response('unavailable', { status: 503 }))
    const image = { body: Buffer.from('room'), contentType: 'image/jpeg' }
    await expect(
      reviewDetectedObjects(
        'test-only',
        image,
        candidates,
        candidates.map(() => image),
        'living',
      ),
    ).rejects.toThrow('503')
    expect(fetchMock).toHaveBeenCalledTimes(1)
  })
})
