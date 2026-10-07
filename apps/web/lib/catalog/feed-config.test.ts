import { afterEach, describe, expect, it, vi } from 'vitest'

vi.mock('@trigger.dev/sdk', () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() },
  schedules: { task: vi.fn((definition) => definition) },
  task: vi.fn((definition) => definition),
}))

import { configuredFeeds, refreshPartnerCatalog } from '../../../../jobs/src/index-catalog'

afterEach(() => vi.unstubAllEnvs())

describe('настройки партнёрских фидов', () => {
  it('не запускает обновление Divan при паузе или отсутствии адреса', async () => {
    const run = (
      refreshPartnerCatalog as unknown as { run(payload: { source: string }): Promise<unknown> }
    ).run
    vi.stubEnv('ADMITAD_FEED_DIVAN_URL', '')
    await expect(run({ source: 'divan' })).rejects.toThrow('не настроен')
    vi.stubEnv('ADMITAD_FEED_DIVAN_URL', 'https://partner.test/divan.csv')
    vi.stubEnv('ADMITAD_FEED_DIVAN_PAUSED', '1')
    await expect(run({ source: 'divan' })).rejects.toThrow('паузе')
    await expect(run({ source: 'unknown' })).rejects.toThrow('Неизвестный источник')
  })
  it('подключает только известные источники с непустым адресом', () => {
    expect(
      configuredFeeds({
        ADMITAD_FEED_ASKONA_URL: 'https://partner.test/askona.csv',
        ADMITAD_FEED_HOFF_URL: '',
        ADMITAD_FEED_UNKNOWN_URL: 'https://partner.test/unknown.csv',
        ADMITAD_FEED_GDESLON_URL: 'https://partner.test/old-search.csv',
      }),
    ).toEqual([{ source: 'askona', url: 'https://partner.test/askona.csv' }])
  })

  it('останавливает только выбранный источник и сохраняет его адрес', () => {
    const env = {
      ADMITAD_FEED_ASKONA_URL: 'https://partner.test/askona.csv',
      ADMITAD_FEED_ASKONA_PAUSED: '1',
      ADMITAD_FEED_HOFF_URL: 'https://partner.test/hoff.csv',
    }
    expect(configuredFeeds(env)).toEqual([{ source: 'hoff', url: 'https://partner.test/hoff.csv' }])
    expect(env.ADMITAD_FEED_ASKONA_URL).toBe('https://partner.test/askona.csv')
  })

  it('возобновляет импорт после снятия паузы', () => {
    expect(
      configuredFeeds({
        ADMITAD_FEED_ASKONA_URL: 'https://partner.test/askona.csv',
        ADMITAD_FEED_ASKONA_PAUSED: '0',
      }),
    ).toEqual([{ source: 'askona', url: 'https://partner.test/askona.csv' }])
  })

  it('распознаёт отдельный фид Bestmebelshop и позволяет держать его на паузе', () => {
    const env = {
      ADMITAD_FEED_BESTMEBELSHOP_URL: 'https://partner.test/bestmebelshop.csv',
      ADMITAD_FEED_BESTMEBELSHOP_PAUSED: '1',
    }

    expect(configuredFeeds(env)).toEqual([])
    expect(configuredFeeds({ ...env, ADMITAD_FEED_BESTMEBELSHOP_PAUSED: '0' })).toEqual([
      { source: 'bestmebelshop', url: env.ADMITAD_FEED_BESTMEBELSHOP_URL },
    ])
  })
})
