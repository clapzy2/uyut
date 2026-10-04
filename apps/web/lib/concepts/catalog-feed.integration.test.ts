import { parseAdmitadCsv, syncAdmitadCsvFeed, upsertFeedItems } from '@uyut/catalog'
import { catalogItems } from '@uyut/db'
import { eq } from 'drizzle-orm'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { getDb } from '@/lib/db'

const source = 'ikea' as const
const header =
  'available;categoryId;currencyId;description;id;name;param;picture;price;url;ad_disclosure\n'
const rows = Array.from({ length: 650 }, (_, index) => {
  const destination = encodeURIComponent(`https://shop.test/sofa?fabric=${index % 40}`)
  return `true;Диваны;RUB;Описание ${index};${index};Диван Тест;Ширина:2105мм|Глубина:94,6 см|Цвет:${index % 40};https://cdn.test/${index % 40}.jpg;${49990 + index};https://partner.test/?ulp=${destination};Реклама. Тестовый рекламодатель erid qa-only\n`
})
const csv = header + rows.join('')
let ownsSource = false

async function* chunks(value: string) {
  for (let index = 0; index < value.length; index += 8192) yield value.slice(index, index + 8192)
}

describe('атомарный потоковый импорт каталога', () => {
  beforeAll(async () => {
    const address = new URL(process.env.DATABASE_URL ?? '')
    if (
      !['127.0.0.1', 'localhost'].includes(address.hostname) ||
      address.pathname !== '/domitsa_ui_qa'
    ) {
      throw new Error('Этот контроль разрешён только в отдельной локальной QA-базе')
    }
    const existing = await getDb()
      .select()
      .from(catalogItems)
      .where(eq(catalogItems.source, source))
    if (existing.length > 0) throw new Error('Источник теста уже занят: не изменяем чужие товары')
    ownsSource = true
    await upsertFeedItems(getDb(), [
      {
        source,
        externalId: 'previous-feed-item',
        category: 'sofa',
        title: 'Предыдущий товар',
        priceKopecks: 3000000,
        affiliateUrl: 'https://shop.test/old',
        images: [{ url: 'https://cdn.test/old.jpg' }],
        inStock: true,
      },
    ])
  })

  afterAll(async () => {
    if (!ownsSource) return
    await getDb().delete(catalogItems).where(eq(catalogItems.source, source))
  })

  it('объединяет варианты через границы пачек и сохраняет точные первые данные', async () => {
    const expected = parseAdmitadCsv(csv, source).items[0]
    const result = await syncAdmitadCsvFeed(getDb(), chunks(csv), source)
    expect(result).toEqual({ inserted: 1, updated: 0, total: 1, hidden: 1, skipped: 0 })
    const imported = await getDb()
      .select()
      .from(catalogItems)
      .where(eq(catalogItems.source, source))
    const item = imported.find((row) => row.externalId === expected?.externalId)
    expect(item).toMatchObject({
      title: expected?.title,
      description: expected?.description,
      priceKopecks: expected?.priceKopecks,
      attributes: JSON.parse(JSON.stringify(expected?.attributes)),
      variants: JSON.parse(JSON.stringify(expected?.variants)),
      inStock: true,
    })
    expect(item?.variants).toHaveLength(24)
    expect(item?.attributes?.dimensionsCm).toMatchObject({ width: 210.5, depth: 94.6 })
    expect(imported.find((row) => row.externalId === 'previous-feed-item')?.inStock).toBe(false)
    expect(await syncAdmitadCsvFeed(getDb(), chunks(csv), source)).toMatchObject({
      inserted: 0,
      updated: 1,
    })
  })

  it('обрыв после нескольких пачек оставляет предыдущий каталог без изменений', async () => {
    const before = await getDb().select().from(catalogItems).where(eq(catalogItems.source, source))
    async function* broken() {
      yield header
      for (const row of rows.slice(0, 410)) yield row.replace('49990', '19990')
      throw new Error('Связь прервана')
    }
    await expect(syncAdmitadCsvFeed(getDb(), broken(), source)).rejects.toThrow('Связь прервана')
    const after = await getDb().select().from(catalogItems).where(eq(catalogItems.source, source))
    expect(after).toEqual(before)
  })

  it('пустой фид не скрывает товары и не оставляет временную таблицу', async () => {
    const before = await getDb().select().from(catalogItems).where(eq(catalogItems.source, source))
    await expect(syncAdmitadCsvFeed(getDb(), chunks(header), source)).rejects.toThrow(
      'каталог сохранён',
    )
    expect(
      await getDb().select().from(catalogItems).where(eq(catalogItems.source, source)),
    ).toEqual(before)
    expect(await syncAdmitadCsvFeed(getDb(), chunks(csv), source)).toMatchObject({ updated: 1 })
  })

  it('обрыв CSV внутри кавычек не принимается за полный фид', async () => {
    const before = await getDb().select().from(catalogItems).where(eq(catalogItems.source, source))
    const truncated = `${header}${rows.slice(0, 410).join('')}true;Диваны;RUB;"оборванное описание`
    await expect(syncAdmitadCsvFeed(getDb(), chunks(truncated), source)).rejects.toThrow(
      'CSV оборван',
    )
    expect(
      await getDb().select().from(catalogItems).where(eq(catalogItems.source, source)),
    ).toEqual(before)
  })
})
