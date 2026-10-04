import { afterEach, describe, expect, it, vi } from 'vitest'
import { collectGdeslon } from '../../../../jobs/src/lib/gdeslon-catalog'

function xml(id = '1', disclosure = 'Реклама. Тест erid qa-only') {
  return `<offers><offer id="${id}" article="model" available="true">
    <merchant_id>qa</merchant_id><name>Диван Тест</name><price>30000.45</price>
    <url>https://shop.example/${id}</url><picture>https://cdn.example/${id}.jpg</picture>
    <tagging_ads><info>${disclosure}</info></tagging_ads>
  </offer></offers>`
}

afterEach(() => vi.useRealTimers())

describe('ограниченное обновление Gdeslon', () => {
  it('останавливает пагинацию на пустой выдаче и различает SKU между запросами', async () => {
    const seen: URL[] = []
    const fetcher = vi.fn(async (input: Parameters<typeof fetch>[0]) => {
      const url = new URL(String(input))
      seen.push(url)
      return new Response(
        url.searchParams.get('p') === '1' ? xml(url.searchParams.get('q') ?? '') : '<offers/>',
      )
    }) as unknown as typeof fetch
    const result = await collectGdeslon('qa-key', { queries: ['a', 'b'], pages: 3, fetcher })
    expect(result.items).toHaveLength(2)
    expect(result.failedPages).toBe(0)
    expect(result.requestedPages).toBe(4)
    expect(seen.every((url) => url.searchParams.get('_gs_at') === 'qa-key')).toBe(true)
    expect(result.items[0]?.priceKopecks).toBe(3_000_045)
  })

  it('не публикует товары без готовой рекламной пометки', async () => {
    const fetcher = vi.fn(async () => new Response(xml('1', ''))) as unknown as typeof fetch
    const result = await collectGdeslon('qa-key', { queries: ['диван'], pages: 1, fetcher })
    expect(result.items).toEqual([])
    expect(result.withoutDisclosure).toBe(1)
  })

  it('дедуплицирует один SKU, но не уничтожает разные варианты общего артикула', async () => {
    const fetcher = vi.fn(async (input: Parameters<typeof fetch>[0]) => {
      const page = new URL(String(input)).searchParams.get('p')
      return new Response(page === '2' ? xml('2') : xml('1'))
    }) as unknown as typeof fetch
    const result = await collectGdeslon('qa-key', { queries: ['a', 'b'], pages: 2, fetcher })
    expect(result.items.map((item) => item.externalId).sort()).toEqual(['qa-model-1', 'qa-model-2'])
  })

  it('выражает отказ авторизации счётчиком без ключа и URL в результате', async () => {
    const fetcher = vi.fn(
      async () => new Response('forbidden', { status: 403 }),
    ) as unknown as typeof fetch
    const result = await collectGdeslon('private-key', { queries: ['диван'], fetcher })
    expect(result.failedPages).toBe(1)
    expect(fetcher).toHaveBeenCalledTimes(1)
    expect(JSON.stringify(result)).not.toContain('private-key')
  })

  it('не принимает сетевой обрыв за пустую страницу, ограничивает повторы', async () => {
    vi.useFakeTimers()
    const fetcher = vi.fn(async () => {
      throw new Error('URL with private-key')
    }) as unknown as typeof fetch
    const pending = collectGdeslon('private-key', { queries: ['диван'], fetcher })
    await vi.runAllTimersAsync()
    const result = await pending
    expect(result.failedPages).toBe(1)
    expect(fetcher).toHaveBeenCalledTimes(3)
    expect(JSON.stringify(result)).not.toContain('private-key')
  })

  it('истечение срока не вызывает новых сетевых запросов', async () => {
    const fetcher = vi.fn() as unknown as typeof fetch
    const result = await collectGdeslon('qa-key', { queries: ['a', 'b'], maxMs: 0, fetcher })
    expect(result.failedPages).toBe(2)
    expect(fetcher).not.toHaveBeenCalled()
  })

  it('отвергает необоснованный размер пачки до сети', async () => {
    const fetcher = vi.fn() as unknown as typeof fetch
    await expect(collectGdeslon('qa-key', { pages: 100, fetcher })).rejects.toThrow('от 1 до 12')
    expect(fetcher).not.toHaveBeenCalled()
  })
})
