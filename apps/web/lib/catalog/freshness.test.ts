import { catalogFreshnessNotice } from '@uyut/catalog/freshness'
import { describe, expect, it } from 'vitest'

const now = new Date('2026-09-26T12:00:00Z')
describe('catalog freshness notices', () => {
  it('warns for absent, invalid and future dates rather than assuming freshness', () => {
    for (const date of [null, undefined, new Date('invalid'), new Date('2026-09-27T12:00:00Z')]) {
      expect(catalogFreshnessNotice(date, now)).toContain('неизвестна')
    }
  })
  it('keeps the 48-hour boundary and warns after it', () => {
    expect(catalogFreshnessNotice(new Date('2026-09-24T12:00:00Z'), now)).toBeNull()
    expect(catalogFreshnessNotice(new Date('2026-09-24T11:59:59Z'), now)).toContain('48 часов')
  })
})
