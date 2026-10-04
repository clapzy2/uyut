import { createVoyageEmbedder, type Embedder } from '@uyut/ai'
import { itemsNeedingEmbedding, saveEmbeddings } from '@uyut/catalog'
import type { Database } from '@uyut/db'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { embedPendingCatalog } from '../../../../jobs/src/lib/embed-catalog'

vi.mock('@uyut/catalog', () => ({ itemsNeedingEmbedding: vi.fn(), saveEmbeddings: vi.fn() }))
const db = {} as Database
const item = {
  id: 'qa-item',
  title: 'Стул',
  contentHash: 'hash',
  images: [{ url: 'https://cdn.example/1.jpg' }],
}
afterEach(() => {
  vi.unstubAllGlobals()
  vi.clearAllMocks()
})

describe('срок векторизации действует внутри сетевой пачки', () => {
  it('по истечении срока картинки не выдаёт её отсутствие за готовый результат', async () => {
    vi.mocked(itemsNeedingEmbedding).mockResolvedValue([item] as never)
    vi.stubGlobal(
      'fetch',
      vi.fn(
        (_input, options) =>
          new Promise((_resolve, reject) => {
            options.signal.addEventListener('abort', () => reject(options.signal.reason), {
              once: true,
            })
          }),
      ),
    )
    const embedder = { embed: vi.fn() } as unknown as Embedder
    expect(await embedPendingCatalog(db, embedder, { maxMs: 50 })).toEqual({
      processed: 0,
      withImage: 0,
      failedImages: 0,
    })
    expect(embedder.embed).not.toHaveBeenCalled()
    expect(saveEmbeddings).not.toHaveBeenCalled()
  })

  it('передаёт срок в расчёт и не фиксирует хеш прерванного запроса', async () => {
    vi.mocked(itemsNeedingEmbedding).mockResolvedValue([{ ...item, images: [] }] as never)
    const embedder = {
      embed: vi.fn(
        (_inputs, options) =>
          new Promise((_resolve, reject) => {
            options.signal.addEventListener('abort', () => reject(options.signal.reason), {
              once: true,
            })
          }),
      ),
    } as unknown as Embedder
    const result = await embedPendingCatalog(db, embedder, { maxMs: 50, source: 'gdeslon' })
    expect(result.processed).toBe(0)
    expect(itemsNeedingEmbedding).toHaveBeenCalledWith(db, 20, 'gdeslon')
    expect(saveEmbeddings).not.toHaveBeenCalled()
  })

  it('нулевой бюджет не читает базу и не вызывает расчёт', async () => {
    const embedder = { embed: vi.fn() } as unknown as Embedder
    expect((await embedPendingCatalog(db, embedder, { maxMs: 0 })).processed).toBe(0)
    expect(itemsNeedingEmbedding).not.toHaveBeenCalled()
    expect(embedder.embed).not.toHaveBeenCalled()
  })

  it('отменяет длинное ожидание повторного запроса после лимита Voyage', async () => {
    const fetcher = vi.fn(
      async () => new Response('', { status: 429, headers: { 'retry-after': '3600' } }),
    )
    vi.stubGlobal('fetch', fetcher)
    const embedder = createVoyageEmbedder('qa-key')
    await expect(
      embedder.embed([{ text: 'Стул' }], { signal: AbortSignal.timeout(50) }),
    ).rejects.toMatchObject({ name: 'TimeoutError' })
    expect(fetcher).toHaveBeenCalledTimes(1)
  })
})
