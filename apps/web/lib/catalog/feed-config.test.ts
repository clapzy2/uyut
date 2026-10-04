import { describe, expect, it, vi } from 'vitest'

vi.mock('@trigger.dev/sdk', () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() },
  schedules: { task: vi.fn((definition) => definition) },
  task: vi.fn((definition) => definition),
}))

import { configuredFeeds } from '../../../../jobs/src/index-catalog'

describe('настройки партнёрских фидов', () => {
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
})
