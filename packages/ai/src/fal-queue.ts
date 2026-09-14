// Очередь fal: отправить задание, дождаться, забрать ответ. Общая для рендера, детектора и масок.

export class FalError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'FalError'
  }
}

type QueueSubmit = { status_url: string; response_url: string }
type QueueStatus = { status?: string; detail?: unknown }

const TERMINAL_FAILURES = new Set(['FAILED', 'ERROR', 'CANCELLED'])

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
  if (!submit.ok) {
    throw new FalError(`${endpoint}: ${submit.status} ${(await submit.text()).slice(0, 200)}`)
  }
  const { status_url, response_url } = (await submit.json()) as QueueSubmit
  while (Date.now() < deadline) {
    const status = (await fetch(status_url, { headers, signal }).then((response) =>
      response.json(),
    )) as QueueStatus
    if (status.status === 'COMPLETED') {
      const response = await fetch(response_url, { headers, signal })
      if (!response.ok) {
        throw new FalError(
          `${endpoint}: ${response.status} ${(await response.text()).slice(0, 200)}`,
        )
      }
      return (await response.json()) as T
    }
    if (status.status && TERMINAL_FAILURES.has(status.status)) {
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
  const response = await fetch(url)
  if (!response.ok) {
    throw new FalError(`файл не скачался (${response.status})`)
  }
  return {
    body: Buffer.from(await response.arrayBuffer()),
    contentType: response.headers.get('content-type') ?? 'application/octet-stream',
  }
}
