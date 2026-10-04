import { FalError, falQueue } from '@uyut/ai'
import { afterEach, describe, expect, it, vi } from 'vitest'

const endpoint = 'fal-ai/test'
const queueUrls = {
  status_url: 'https://queue.fal.run/status',
  response_url: 'https://queue.fal.run/result',
}

afterEach(() => {
  vi.restoreAllMocks()
  vi.useRealTimers()
})

describe('проверка ответов очереди fal', () => {
  it('возвращает готовый результат и использует общий дедлайн для запросов', async () => {
    const timeout = vi.spyOn(AbortSignal, 'timeout')
    const fetchMock = vi
      .spyOn(globalThis, 'fetch')
      .mockResolvedValueOnce(Response.json(queueUrls))
      .mockResolvedValueOnce(Response.json({ status: 'COMPLETED' }))
      .mockResolvedValueOnce(Response.json({ output: 'ready' }))

    await expect(falQueue('test-key', endpoint, { prompt: 'test' })).resolves.toEqual({
      output: 'ready',
    })

    expect(timeout).toHaveBeenCalledWith(180_000)
    expect(fetchMock).toHaveBeenCalledTimes(3)
    const signal = fetchMock.mock.calls[0]?.[1]?.signal
    expect(signal).toBeInstanceOf(AbortSignal)
    expect(fetchMock.mock.calls.every((call) => call[1]?.signal === signal)).toBe(true)
    expect(fetchMock.mock.calls.filter((call) => call[1]?.method === 'POST')).toHaveLength(1)
  })

  it.each([401, 429, 500])(
    'сразу останавливается при HTTP %s во время опроса, не раскрывая тело ответа',
    async (httpStatus) => {
      const fetchMock = vi
        .spyOn(globalThis, 'fetch')
        .mockResolvedValueOnce(Response.json(queueUrls))
        .mockResolvedValueOnce(
          Response.json(
            { status: 'COMPLETED', detail: 'test-key https://private.example/result' },
            { status: httpStatus },
          ),
        )

      await expect(falQueue('test-key', endpoint, {})).rejects.toEqual(
        new FalError(`${endpoint}: проверка статуса очереди — HTTP ${httpStatus}`),
      )
      expect(fetchMock).toHaveBeenCalledTimes(2)
      expect(fetchMock.mock.calls.filter((call) => call[1]?.method === 'POST')).toHaveLength(1)
    },
  )

  it.each([
    null,
    [],
    'IN_PROGRESS',
    {},
    { status: null },
    { status: 1 },
    { status: '' },
    { status: 'UNKNOWN' },
  ])('отклоняет некорректный ответ при опросе: %j', async (status) => {
    const fetchMock = vi
      .spyOn(globalThis, 'fetch')
      .mockResolvedValueOnce(Response.json(queueUrls))
      .mockResolvedValueOnce(Response.json(status))

    await expect(falQueue('test-key', endpoint, {})).rejects.toEqual(
      new FalError(`${endpoint}: проверка статуса очереди — отсутствует корректный статус`),
    )
    expect(fetchMock).toHaveBeenCalledTimes(2)
  })

  it.each([
    null,
    [],
    {},
    { status_url: queueUrls.status_url },
    { response_url: queueUrls.response_url },
    { ...queueUrls, status_url: '' },
    { ...queueUrls, status_url: '/status' },
    { ...queueUrls, response_url: null },
    { ...queueUrls, response_url: 'not-a-url' },
  ])('отклоняет неполный ответ на отправку до начала опроса: %j', async (submitted) => {
    const fetchMock = vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce(Response.json(submitted))

    await expect(falQueue('test-key', endpoint, {})).rejects.toEqual(
      new FalError(`${endpoint}: отправка задания — отсутствуют корректные адреса очереди`),
    )
    expect(fetchMock).toHaveBeenCalledTimes(1)
  })

  it.each(['FAILED', 'ERROR', 'CANCELLED'])('останавливается при статусе %s', async (status) => {
    const fetchMock = vi
      .spyOn(globalThis, 'fetch')
      .mockResolvedValueOnce(Response.json(queueUrls))
      .mockResolvedValueOnce(Response.json({ status, detail: 'provider failure' }))

    await expect(falQueue('test-key', endpoint, {})).rejects.toThrow(`${endpoint}: ${status}`)
    expect(fetchMock).toHaveBeenCalledTimes(2)
  })

  it.each([
    { stage: 'отправка задания', completedRequests: 0 },
    { stage: 'проверка статуса очереди', completedRequests: 1 },
    { stage: 'получение результата', completedRequests: 2 },
  ])('сообщает о некорректном JSON на стадии «$stage»', async ({ stage, completedRequests }) => {
    const fetchMock = vi.spyOn(globalThis, 'fetch')
    if (completedRequests >= 1) {
      fetchMock.mockResolvedValueOnce(Response.json(queueUrls))
    }
    if (completedRequests >= 2) {
      fetchMock.mockResolvedValueOnce(Response.json({ status: 'COMPLETED' }))
    }
    fetchMock.mockResolvedValueOnce(new Response('invalid JSON test-key https://private.example'))

    await expect(falQueue('test-key', endpoint, {})).rejects.toEqual(
      new FalError(`${endpoint}: ${stage} — некорректный JSON`),
    )
    expect(fetchMock).toHaveBeenCalledTimes(completedRequests + 1)
  })

  it.each(['AbortError', 'TimeoutError'])(
    'сохраняет ошибку %s при чтении ответа на опрос',
    async (name) => {
      const statusResponse = Response.json({ status: 'IN_PROGRESS' })
      const error = new DOMException('Request stopped', name)
      vi.spyOn(statusResponse, 'json').mockRejectedValue(error)
      const fetchMock = vi
        .spyOn(globalThis, 'fetch')
        .mockResolvedValueOnce(Response.json(queueUrls))
        .mockResolvedValueOnce(statusResponse)

      await expect(falQueue('test-key', endpoint, {})).rejects.toBe(error)
      expect(fetchMock).toHaveBeenCalledTimes(2)
    },
  )

  it.each([
    { stage: 'отправка задания', completedRequests: 0 },
    { stage: 'получение результата', completedRequests: 2 },
  ])(
    'сообщает об ошибке HTTP на стадии «$stage», не раскрывая текст провайдера',
    async ({ stage, completedRequests }) => {
      const fetchMock = vi.spyOn(globalThis, 'fetch')
      if (completedRequests === 2) {
        fetchMock
          .mockResolvedValueOnce(Response.json(queueUrls))
          .mockResolvedValueOnce(Response.json({ status: 'COMPLETED' }))
      }
      fetchMock.mockResolvedValueOnce(
        new Response('test-key https://private.example/result', { status: 502 }),
      )

      await expect(falQueue('test-key', endpoint, {})).rejects.toEqual(
        new FalError(`${endpoint}: ${stage} — HTTP 502`),
      )
      expect(fetchMock).toHaveBeenCalledTimes(completedRequests + 1)
    },
  )

  it('дожидается готовности через статусы ожидания без повторной отправки', async () => {
    vi.useFakeTimers()
    const fetchMock = vi
      .spyOn(globalThis, 'fetch')
      .mockResolvedValueOnce(Response.json(queueUrls))
      .mockResolvedValueOnce(Response.json({ status: 'IN_QUEUE' }))
      .mockResolvedValueOnce(Response.json({ status: 'IN_PROGRESS' }))
      .mockResolvedValueOnce(Response.json({ status: 'COMPLETED' }))
      .mockResolvedValueOnce(Response.json({ output: 'ready' }))

    const pending = falQueue('test-key', endpoint, {})
    await vi.advanceTimersByTimeAsync(3000)
    await expect(pending).resolves.toEqual({ output: 'ready' })
    expect(fetchMock.mock.calls.filter((call) => call[1]?.method === 'POST')).toHaveLength(1)
  })

  it('сохраняет прежний тайм-аут для корректной очереди, которая продолжает работать', async () => {
    vi.useFakeTimers()
    const fetchMock = vi
      .spyOn(globalThis, 'fetch')
      .mockResolvedValueOnce(Response.json(queueUrls))
      .mockImplementation(async () => Response.json({ status: 'IN_PROGRESS' }))

    const rejection = expect(falQueue('test-key', endpoint, {}, 3000)).rejects.toEqual(
      new FalError(`${endpoint}: не дождались ответа`),
    )
    await vi.advanceTimersByTimeAsync(3000)
    await rejection
    expect(fetchMock.mock.calls.filter((call) => call[1]?.method === 'POST')).toHaveLength(1)
  })
})
