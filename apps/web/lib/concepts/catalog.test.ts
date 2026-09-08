import { budgetShares, detectorCaption, priceWindow, selectObjects } from '@uyut/ai'
import { categoryFromText, parseCsv, parseCsvDump, parseRubles, parseYml } from '@uyut/catalog'
import { describe, expect, it } from 'vitest'

describe('categoryFromText', () => {
  it('диван-кровать это диван, а прикроватная тумба это хранение', () => {
    expect(categoryFromText('Диван-кровать угловой')).toBe('sofa')
    expect(categoryFromText('Тумба прикроватная')).toBe('storage')
    expect(categoryFromText('Журнальный столик')).toBe('table')
    expect(categoryFromText('Стол письменный «Сити 4», с тумбой')).toBe('table')
    expect(categoryFromText('Бра настенное')).toBe('lamp')
    expect(categoryFromText('Торшер напольный')).toBe('lamp')
    expect(categoryFromText('Ковёр 160×230')).toBe('rug')
  })

  it('понимает английские названия из фидов и путь категорий', () => {
    expect(categoryFromText('Furniture / Living room / Sofas', 'Oslo 3-seater')).toBe('sofa')
    expect(categoryFromText('Home / Lighting / Floor lamps')).toBe('lamp')
  })

  it('слово «стол» внутри другого слова столом не считается', () => {
    expect(categoryFromText('Мебель / Столовая / Шкафы', 'Шкаф-витрина Осло')).toBe('storage')
    expect(categoryFromText('Комод со столешницей из дуба')).toBe('storage')
    expect(categoryFromText('Тумба под ТВ со столешницей')).toBe('storage')
    expect(categoryFromText('Полка настольная для книг')).toBe('storage')
    expect(categoryFromText('Portable wardrobe')).toBe('storage')
  })

  it('не мебель остаётся без категории', () => {
    expect(categoryFromText('Смартфон 128 ГБ')).toBeNull()
    expect(categoryFromText('', undefined, null)).toBeNull()
  })
})

describe('parseCsv', () => {
  it('разбирает кавычки, запятые внутри поля и точку с запятой', () => {
    const comma = parseCsv('a,b\n1,"x, y"\n2,"он сказал ""да"""\n')
    expect(comma).toEqual([
      { a: '1', b: 'x, y' },
      { a: '2', b: 'он сказал "да"' },
    ])
    const semicolon = parseCsv('a;b\r\n1;два\r\n')
    expect(semicolon).toEqual([{ a: '1', b: 'два' }])
  })

  it('цена принимает пробелы, запятую и знак рубля', () => {
    expect(parseRubles('42 990')).toBe(4_299_000)
    expect(parseRubles('1 200,50 ₽')).toBe(120_050)
    expect(parseRubles('')).toBeNull()
    expect(parseRubles('дорого')).toBeNull()
  })
})

describe('parseCsvDump', () => {
  const header =
    'external_id,category,title,price_rub,url,image_url,subcategory,brand,description,old_price_rub,color,material,width_cm,depth_cm,height_cm'

  it('собирает товар из обязательных и необязательных колонок', () => {
    const csv = `${header}\n123,sofa,"Диван Осло",42990,https://shop/1,https://cdn/1.jpg,прямой,Divan.ru,"Рогожка, бук",55990,бежевый,рогожка,220,95,85\n`
    const { items, skipped } = parseCsvDump(csv)
    expect(skipped).toEqual([])
    expect(items).toHaveLength(1)
    const item = items[0]
    expect(item?.category).toBe('sofa')
    expect(item?.priceKopecks).toBe(4_299_000)
    expect(item?.oldPriceKopecks).toBe(5_599_000)
    expect(item?.attributes?.dimensionsCm).toEqual({ width: 220, depth: 95, height: 85 })
    expect(item?.images[0]?.url).toBe('https://cdn/1.jpg')
  })

  it('категорию угадывает по названию, если колонка заполнена не по списку', () => {
    const csv = `${header}\n7,мебель,"Кресло Ротанг",9990,https://shop/7,https://cdn/7.jpg\n`
    expect(parseCsvDump(csv).items[0]?.category).toBe('chair')
  })

  it('строки без цены или картинки идут в пропуски с причиной', () => {
    const csv = `${header}\n8,sofa,"Без цены",,https://shop/8,https://cdn/8.jpg\n9,sofa,"Без фото",1000,https://shop/9,\n`
    const { items, skipped } = parseCsvDump(csv)
    expect(items).toEqual([])
    expect(skipped.map((row) => row.reason)).toEqual(['нет цены', 'нет ссылки или картинки'])
  })
})

describe('parseYml', () => {
  it('восстанавливает категорию по дереву фида и берёт параметры', () => {
    const xml = `<?xml version="1.0"?><yml_catalog><shop>
      <categories><category id="1">Мебель</category><category id="2" parentId="1">Диваны</category></categories>
      <offers><offer id="42" available="true"><url>https://shop/42</url><price>39990</price><oldprice>45000</oldprice>
      <categoryId>2</categoryId><picture>https://cdn/42.jpg</picture><name>Диван Мелвин</name><vendor>Hoff</vendor>
      <param name="Цвет">молочный</param><param name="Ширина">210</param></offer>
      <offer id="43"><url>https://shop/43</url><price>990</price><categoryId>1</categoryId><picture>https://cdn/43.jpg</picture><name>Чайник</name></offer>
      </offers></shop></yml_catalog>`
    const { items, skipped } = parseYml(xml, 'hoff')
    expect(items).toHaveLength(1)
    expect(items[0]).toMatchObject({
      source: 'hoff',
      externalId: '42',
      category: 'sofa',
      subcategory: 'Диваны',
      brand: 'Hoff',
      priceKopecks: 3_999_000,
      oldPriceKopecks: 4_500_000,
    })
    expect(items[0]?.attributes?.color).toBe('молочный')
    expect(items[0]?.attributes?.dimensionsCm?.width).toBe(210)
    expect(skipped[0]?.reason).toContain('не мебель')
  })
})

describe('selectObjects', () => {
  const box = (x: number, y: number, w: number, h: number) => ({ x, y, w, h })

  it('отбрасывает рамку на всю картинку и дубли одной категории, оставляет крупные', () => {
    const objects = selectObjects(
      [
        { label: 'a sofa', category: 'sofa', bbox: box(0, 0, 1, 1) },
        { label: 'a sofa', category: 'sofa', bbox: box(0.05, 0.6, 0.4, 0.35) },
        { label: 'a sofa', category: 'sofa', bbox: box(0.06, 0.62, 0.38, 0.33) },
        { label: 'a rug', category: 'rug', bbox: box(0.3, 0.7, 0.5, 0.25) },
        { label: 'a plant', category: 'decor', bbox: box(0.9, 0.5, 0.02, 0.02) },
      ],
      6,
    )
    expect(objects.map((object) => object.label)).toEqual(['a sofa', 'a rug'])
  })

  it('обрезает список до лимита по площади', () => {
    const objects = selectObjects(
      [
        { label: 'a rug', category: 'rug', bbox: box(0, 0, 0.5, 0.5) },
        { label: 'a sofa', category: 'sofa', bbox: box(0, 0, 0.4, 0.4) },
        { label: 'a lamp', category: 'lamp', bbox: box(0, 0, 0.1, 0.3) },
      ],
      2,
    )
    expect(objects.map((object) => object.category)).toEqual(['rug', 'sofa'])
  })
})

describe('detectorCaption и priceWindow', () => {
  it('подпись для гостиной перечисляет предметы и заканчивается точкой', () => {
    const caption = detectorCaption('living')
    expect(caption.startsWith('a sofa, ')).toBe(true)
    expect(caption.endsWith(' in a room.')).toBe(true)
    expect(detectorCaption('bedroom')).toContain('a bed')
  })

  it('окно цены считается от доли категории, без бюджета окна нет', () => {
    const window = priceWindow(800_000_00, 'sofa')
    expect(window?.shareKopecks).toBe(Math.round(800_000_00 * budgetShares.sofa))
    expect(window?.minKopecks).toBeLessThan(window?.shareKopecks ?? 0)
    expect(window?.maxKopecks).toBeGreaterThan(window?.shareKopecks ?? 0)
    expect(priceWindow(null, 'sofa')).toBeNull()
    expect(priceWindow(0, 'lamp')).toBeNull()
  })
})
