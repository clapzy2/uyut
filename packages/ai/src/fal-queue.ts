// Очередь fal: отправить задание, дождаться, забрать ответ. Общая для рендера, детектора и масок.

export class FalError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'FalError'
  }
}

const TERMINAL_FAILURES = new Set(['FAILED', 'ERROR', 'CANCELLED'])
const PENDING_STATUSES = new Set(['IN_QUEUE', 'IN_PROGRESS'])

async function readQueueJson(
  response: Response,
  endpoint: string,
  stage: string,
): Promise<unknown> {
  if (!response.ok) {
    throw new FalError(`${endpoint}: ${stage} — HTTP ${response.status}`)
  }
  try {
    return await response.json()
  } catch (error) {
    if (!(error instanceof SyntaxError)) {
      throw error
    }
    throw new FalError(`${endpoint}: ${stage} — некорректный JSON`)
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

export async function falQueue<T = Record<string, unknown>>(
  apiKey: string,
  endpoint: string,
  body: Record<string, unknown>,
  timeoutMs = 180_000,
): Promise<T> {
  const headers = { Authorization: `Key ${apiKey}` }
  // Общий дедлайн включает отправку и зависшие HTTP-запросы, не только опрос очереди.
  const signal = AbortSignal.timeout(timeoutMs)
  const deadline = Date.now() + timeoutMs
  const submit = await fetch(`https://queue.fal.run/${endpoint}`, {
    method: 'POST',
    headers: { ...headers, 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
    signal,
  })
  const queued = await readQueueJson(submit, endpoint, 'отправка задания')
  if (
    !isRecord(queued) ||
    typeof queued.status_url !== 'string' ||
    !URL.canParse(queued.status_url) ||
    typeof queued.response_url !== 'string' ||
    !URL.canParse(queued.response_url)
  ) {
    throw new FalError(`${endpoint}: отправка задания — отсутствуют корректные адреса очереди`)
  }
  const { status_url, response_url } = queued
  while (Date.now() < deadline) {
    const statusResponse = await fetch(status_url, { headers, signal })
    const status = await readQueueJson(statusResponse, endpoint, 'проверка статуса очереди')
    if (
      !isRecord(status) ||
      typeof status.status !== 'string' ||
      !(
        status.status === 'COMPLETED' ||
        PENDING_STATUSES.has(status.status) ||
        TERMINAL_FAILURES.has(status.status)
      )
    ) {
      throw new FalError(`${endpoint}: проверка статуса очереди — отсутствует корректный статус`)
    }
    if (status.status === 'COMPLETED') {
      const response = await fetch(response_url, { headers, signal })
      return (await readQueueJson(response, endpoint, 'получение результата')) as T
    }
    if (TERMINAL_FAILURES.has(status.status)) {
      throw new FalError(`${endpoint}: ${status.status} ${JSON.stringify(status.detail ?? {})}`)
    }
    await new Promise((resolve) => setTimeout(resolve, 1500))
  }
  throw new FalError(`${endpoint}: не дождались ответа`)
}

/** Картинка в теле запроса: fal принимает data URI наравне с https-ссылкой. */
export function toDataUri(image: { body: Buffer; contentType: string }): string {
  return `data:${image.contentType};base64,${image.body.toString('base64')}`
}

export async function downloadFalFile(url: string): Promise<{ body: Buffer; contentType: string }> {
  // The render is already paid for when its file URL arrives. Retry only this GET so a
  // dropped connection cannot turn a completed render into a failed concept.
  for (let attempt = 1; attempt <= 3; attempt += 1) {
    try {
      const response = await fetch(url, { signal: AbortSignal.timeout(60_000) })
      if (!response.ok) {
        const retryable =
          response.status === 408 || response.status === 429 || response.status >= 500
        if (!retryable || attempt === 3) {
          throw new FalError(`файл не скачался (${response.status})`)
        }
      } else {
        return {
          body: Buffer.from(await response.arrayBuffer()),
          contentType: response.headers.get('content-type') ?? 'application/octet-stream',
        }
      }
    } catch (error) {
      if (error instanceof FalError || attempt === 3) throw error
    }
    await new Promise((resolve) => setTimeout(resolve, 300 * attempt))
  }
  throw new FalError('файл не скачался')
}
