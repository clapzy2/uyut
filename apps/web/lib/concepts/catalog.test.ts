import { budgetShares, detectorCaption, priceWindow, selectObjects } from '@uyut/ai'
import {
  categoryFromText,
  parseAdmitadCsv,
  parseAdmitadCsvStream,
  parseCsv,
  parseCsvDump,
  parseRubles,
  parseYml,
} from '@uyut/catalog'
import { describe, expect, it } from 'vitest'

describe('categoryFromText', () => {
  it('диван-кровать это диван, а прикроватная тумба это хранение', () => {
    expect(categoryFromText('Диван-кровать угловой')).toBe('sofa')
    expect(categoryFromText('Тумба прикроватная')).toBe('storage')
    expect(categoryFromText('Журнальный столик')).toBe('table')
    expect(categoryFromText('Стол письменный «Сити 4», с тумбой')).toBe('table')
    expect(categoryFromText('Бра настенное')).toBe('lamp')
    expect(categoryFromText('Торшер напольный')).toBe('lamp')
    // Слово «подвес» без границ утаскивало в светильники подвесные шкафы и тумбы под ТВ
    expect(categoryFromText('Шкаф подвесной в гостиную «Флэш»')).toBe('storage')
    expect(categoryFromText('Тумба под ТВ подвесная «Инфинити»')).toBe('storage')
    expect(categoryFromText('Светильник подвесной')).toBe('lamp')
    expect(categoryFromText('Подвес стеклянный над стол')).toBe('lamp')
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
    expect(parseRubles('49 990.45 руб.')).toBe(4_999_045)
    expect(parseRubles('0.45')).toBe(45)
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
    expect(item?.attributes?.dimensionsCm).toEqual({
      width: 220,
      depth: 95,
      height: 85,
    })
    expect(item?.attributes?.dimensionsSource).toEqual({
      width: 'store-parameters',
      depth: 'store-parameters',
      height: 'store-parameters',
    })
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

describe('parseAdmitadCsv', () => {
  const header =
    'available;categoryId;currencyId;description;id;name;oldprice;param;picture;price;type;url;vendor'

  it('объединяет sku тканей Askona только при одинаковых явных габаритах', () => {
    const line = (id: number, width: string) => {
      const destination = encodeURIComponent(
        `https://www.askona.ru/divany/test.htm?skuId=${id}&productId=100&SELECTED_FABRIC_ID=${id}`,
      )
      return `true;Диваны;RUB;;${id};Диван Тест;;${width ? `Ширина:${width}|` : ''}Глубина:95|Высота:85|Цвет:${id};https://cdn/${id}.jpg;${49990 + id};Диван;https://partner/?ulp=${destination};Askona\n`
    }
    const csv = `${header}\n${[line(1, '210,5'), line(2, '210,5'), line(3, '190'), line(4, ''), line(5, '')].join('')}`
    const items = parseAdmitadCsv(csv, 'askona').items
    expect(items).toHaveLength(4)
    expect(items[0]?.variants).toHaveLength(2)
    expect(items[0]?.attributes?.dimensionsCm).toMatchObject({ width: 210.5 })
    expect(items[1]?.attributes?.dimensionsCm).toMatchObject({ width: 190 })
    expect(items[2]?.variants).toHaveLength(1)
    expect(items[3]?.variants).toHaveLength(1)
  })

  it('сохраняет дробные габариты из параметров, не переопределяя явную единицу', () => {
    const csv = `${header}\ntrue;Диваны;RUB;;sofa-1;Диван Тест;;Ширина:2105мм|Глубина:94,6 см|Высота:852 мм;https://cdn/sofa.jpg;49990;Диван;https://shop/sofa-1;Askona\ntrue;Столы;RUB;;table-1;Стол Тест;;Ширина:399mm|Глубина:900 см;https://cdn/table.jpg;10000;Стол;https://shop/table-1;Askona\n`
    const { items } = parseAdmitadCsv(csv, 'askona')
    expect(items[0]?.attributes?.dimensionsCm).toEqual({ width: 210.5, depth: 94.6, height: 85.2 })
    expect(items[1]?.attributes?.dimensionsCm).toEqual({
      width: 39.9,
      depth: undefined,
      height: undefined,
    })
  })

  it.each([1, 2, 3, 7, 31, 128])(
    'сохраняет CSV при размере чанка %i и пустых чанках',
    async (size) => {
      const csv = `\uFEFF${header}\r\ntrue;Диваны;RUB;"Описание; в две\r\nстроки и ""кавычках""";sofa-1;Диван Тест;;Ширина:210,5|Глубина:95;https://cdn/sofa.jpg;49990;Диван;https://shop/sofa-1;Askona\r\ntrue;Столы;RUB;"Финальное поле";table-1;Стол Тест;;;https://cdn/table.jpg;10000;Стол;https://shop/table-1;"Askona"`
      async function* chunks() {
        yield ''
        for (let index = 0; index < csv.length; index += size) {
          yield csv.slice(index, index + size)
          yield ''
        }
      }
      expect(await parseAdmitadCsvStream(chunks(), 'askona')).toEqual(
        parseAdmitadCsv(csv, 'askona'),
      )
    },
  )

  it('сохраняет готовую пометку рекламы целиком в обычном и потоковом CSV', async () => {
    const disclosure = 'Реклама. Рекламодатель ООО "Мебель"; ИНН 1234567890\nerid audit-token'
    const escapedDisclosure = disclosure.replaceAll('"', '""')
    const csv = `${header};ad_disclosure\ntrue;Диваны;RUB;;sofa-1;Диван Тест;;Ширина:210|Глубина:95;https://cdn/sofa.jpg;49990;Диван;https://shop/sofa-1;Askona;"${escapedDisclosure}"\n`
    async function* chunks() {
      for (let index = 0; index < csv.length; index += 7) {
        yield csv.slice(index, index + 7)
      }
    }

    const parsed = parseAdmitadCsv(csv, 'askona')
    const streamed = await parseAdmitadCsvStream(chunks(), 'askona')

    expect(parsed.items).toHaveLength(1)
    expect(parsed.items[0]?.attributes?.adDisclosure).toBe(disclosure)
    expect(streamed).toEqual(parsed)
  })

  it('не придумывает маркировку из ссылки или описания при отсутствии отдельного поля', () => {
    const csv = `${header}\ntrue;Диваны;RUB;Реклама. erid description-token;sofa-1;Диван Тест;;;https://cdn/sofa.jpg;49990;Диван;https://shop/sofa-1?erid=url-token;Askona\n`

    expect(parseAdmitadCsv(csv, 'askona').items[0]?.attributes?.adDisclosure).toBeUndefined()
  })

  it('понимает размеры Askona и объединяет ткани одной кровати', () => {
    const destination = encodeURIComponent(
      'https://askona.ru/krovati/mario/?SELECTED_HASH_SIZE=90x200&SELECTED_FABRIC_ID=1',
    )
    const secondDestination = encodeURIComponent(
      'https://askona.ru/krovati/mario/?SELECTED_HASH_SIZE=90x200&SELECTED_FABRIC_ID=2',
    )
    const csv = `${header}\ntrue;Кровати;RUB;Мягкая кровать;bed-1;Кровать Марио;59990;Длина:200|Ширина:90|Высота:90|Цвет:Синий|Материал обивки:Велюр;https://cdn/bed-blue.jpg;49990;Кровать;https://ad.admitad.com/g/x/?ulp=${destination};Askona\ntrue;Кровати;RUB;Мягкая кровать;bed-2;Кровать Марио;59990;Длина:200|Ширина:90|Высота:90|Цвет:Бежевый|Материал обивки:Велюр;https://cdn/bed-beige.jpg;49990;Кровать;https://ad.admitad.com/g/x/?ulp=${secondDestination};Askona\n`
    const { items, skipped } = parseAdmitadCsv(csv, 'askona')

    expect(skipped).toEqual([])
    expect(items).toHaveLength(1)
    expect(items[0]).toMatchObject({
      category: 'bed',
      brand: 'Askona',
      priceKopecks: 4_999_000,
      attributes: {
        color: 'Синий',
        material: 'Велюр',
        dimensionsCm: { width: 90, depth: 200, height: 90 },
      },
    })
    expect(items[0]?.variants).toHaveLength(2)
    expect(items[0]?.variants).toEqual([
      expect.objectContaining({ color: 'Синий', imageUrl: 'https://cdn/bed-blue.jpg' }),
      expect.objectContaining({ color: 'Бежевый', imageUrl: 'https://cdn/bed-beige.jpg' }),
    ])
  })

  it('не смешивает мебель с матрасами и текстилем', () => {
    const csv = `${header}\ntrue;Матрасы;RUB;;m-1;Матрас Balance;;;https://cdn/mattress.jpg;19990;Матрас;https://shop/m-1;Askona\ntrue;Подушки;RUB;;p-1;Подушка Sleep;;;https://cdn/pillow.jpg;3990;Подушка;https://shop/p-1;Askona\ntrue;Диваны/Пуфы;RUB;;seat-1;Пуф Марио;;Ширина:60|Глубина:60|Высота:42;https://cdn/pouf.jpg;9990;Пуф;https://shop/seat-1;Askona\n`
    const { items, skipped } = parseAdmitadCsv(csv, 'askona')

    expect(items).toHaveLength(1)
    expect(items[0]).toMatchObject({
      category: 'chair',
      subcategory: 'stool',
      attributes: { dimensionsCm: { width: 60, depth: 60, height: 42 } },
    })
    expect(skipped.map((row) => row.reason)).toEqual(['не мебель', 'не мебель'])
  })

  it('для комбинированных размеров кровати меняет Д×Ш на Ш×Г', () => {
    const csv = `${header}\ntrue;Кровати;RUB;;bed-3;Кровать Nova;;Габаритные размеры:200x90x90|Цвет:Серый;https://cdn/bed.jpg;39990;Кровать;https://shop/bed-3;Askona\n`
    expect(parseAdmitadCsv(csv, 'askona').items[0]?.attributes?.dimensionsCm).toEqual({
      width: 90,
      depth: 200,
      height: 90,
    })
    expect(parseAdmitadCsv(csv, 'askona').items[0]?.attributes?.dimensionsSource).toEqual({
      width: 'store-text',
      depth: 'store-text',
      height: 'store-text',
    })
  })

  it('не показывает служебное значение цвета как вариант товара', () => {
    const csv = `${header}\ntrue;Столы;RUB;;table-1;Стол Коби;;Цвет:Неизвестно|Материал:Нет данных;https://cdn/table.jpg;58099;Стол;https://shop/table-1;Askona\n`
    const item = parseAdmitadCsv(csv, 'askona').items[0]

    expect(item?.attributes?.color).toBeUndefined()
    expect(item?.attributes?.material).toBeUndefined()
    expect(item?.variants?.[0]?.color).toBeUndefined()
  })

  it('сохраняет разные варианты без цвета при одинаковой цене', () => {
    const firstDestination = encodeURIComponent(
      'https://askona.ru/divany/otto/?SELECTED_FABRIC_ID=1',
    )
    const secondDestination = encodeURIComponent(
      'https://askona.ru/divany/otto/?SELECTED_FABRIC_ID=2',
    )
    const csv = `${header}\ntrue;Диваны;RUB;;sofa-1;Диван Отто;;Ширина:210|Глубина:95;https://cdn/otto-1.jpg;49990;Диван;https://ad.admitad.com/g/x/?ulp=${firstDestination};Askona\ntrue;Диваны;RUB;;sofa-2;Диван Отто;;Ширина:210|Глубина:95;https://cdn/otto-2.jpg;49990;Диван;https://ad.admitad.com/g/x/?ulp=${secondDestination};Askona\n`

    const item = parseAdmitadCsv(csv, 'askona').items[0]

    expect(item?.variants).toHaveLength(2)
    expect(item?.variants?.map((variant) => variant.imageUrl)).toEqual([
      'https://cdn/otto-1.jpg',
      'https://cdn/otto-2.jpg',
    ])
  })

  it('потоково разбирает кавычки и переносы строк на границах сетевых чанков', async () => {
    const csv = `${header}\r\ntrue;Диваны;RUB;"Описание; в две\nстроки и ""кавычках""";sofa-1;Диван Море;;Ширина:210|Глубина:95;https://cdn/sofa.jpg;49990;Диван;https://shop/sofa-1;Askona\r\n`
    async function* chunks() {
      for (let index = 0; index < csv.length; index += 7) {
        yield csv.slice(index, index + 7)
      }
    }

    const streamed = await parseAdmitadCsvStream(chunks(), 'askona')
    expect(streamed).toEqual(parseAdmitadCsv(csv, 'askona'))
    expect(streamed.items[0]?.description).toBe('Описание; в две\nстроки и "кавычках"')
  })
})

describe('parseYml', () => {
  it('сохраняет дробные миллиметровые и сантиметровые параметры', () => {
    const xml =
      '<yml_catalog><shop><offers><offer id="1"><url>https://shop/1</url><price>49990</price><picture>https://cdn/1.jpg</picture><name>Диван Тест</name><param name="Ширина мм">2105</param><param name="Глубина">94,6 см</param><param name="Высота">852 мм</param></offer><offer id="2"><url>https://shop/2</url><price>10000</price><picture>https://cdn/2.jpg</picture><name>Стол Тест</name><param name="Ширина см">900</param></offer></offers></shop></yml_catalog>'
    const { items } = parseYml(xml, 'askona')
    expect(items[0]?.attributes?.dimensionsCm).toEqual({ width: 210.5, depth: 94.6, height: 85.2 })
    expect(items[1]?.attributes?.dimensionsCm).toBeUndefined()
  })

  it('сохраняет готовую пометку рекламы из явного поля ad_disclosure целиком', () => {
    const disclosure = 'Реклама. Рекламодатель ООО "Мебель & Дом"\nИНН 1234567890 erid audit-token'
    const xml = `<yml_catalog><shop><offers><offer id="1"><url>https://shop/1</url><price>49990</price><picture>https://cdn/1.jpg</picture><name>Диван Тест</name><ad_disclosure><![CDATA[${disclosure}]]></ad_disclosure></offer></offers></shop></yml_catalog>`

    const { items } = parseYml(xml, 'askona')

    expect(items).toHaveLength(1)
    expect(items[0]?.attributes?.adDisclosure).toBe(disclosure)
  })

  it('не придумывает маркировку из ссылки или описания при отсутствии отдельного поля', () => {
    const xml =
      '<yml_catalog><shop><offers><offer id="1"><url>https://shop/1?erid=url-token</url><price>49990</price><picture>https://cdn/1.jpg</picture><name>Диван Тест</name><description>Реклама. erid description-token</description></offer></offers></shop></yml_catalog>'

    const { items } = parseYml(xml, 'askona')

    expect(items).toHaveLength(1)
    expect(items[0]?.attributes?.adDisclosure).toBeUndefined()
  })

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
      // В подкатегории теперь вид предмета для подбора, а не название раздела фида.
      // У диванов видов нет: делить их не на что и незачем.
      subcategory: undefined,
      brand: 'Hoff',
      priceKopecks: 3_999_000,
      oldPriceKopecks: 4_500_000,
    })
    expect(items[0]?.attributes?.color).toBe('молочный')
    expect(items[0]?.attributes?.dimensionsCm?.width).toBe(210)
    expect(items[0]?.attributes?.dimensionsSource?.width).toBe('store-parameters')
    expect(skipped[0]?.reason).toContain('не мебель')
  })

  it('берёт габариты из комбинированного параметра, текста и миллиметров', () => {
    const xml = `<?xml version="1.0"?><yml_catalog><shop>
      <categories><category id="1">Мебель</category><category id="2" parentId="1">Диваны</category></categories>
      <offers>
        <offer id="combined"><url>https://shop/combined</url><price>39990</price><categoryId>2</categoryId><picture>https://cdn/combined.jpg</picture><name>Диван</name><param name="Габариты ШхГхВ, мм">2100 × 950 × 850</param></offer>
        <offer id="text"><url>https://shop/text</url><price>29990</price><categoryId>2</categoryId><picture>https://cdn/text.jpg</picture><name>Диван 220 × 90 × 85 см</name></offer>
      </offers></shop></yml_catalog>`
    const { items } = parseYml(xml, 'hoff')
    expect(items).toHaveLength(2)
    expect(items[0]?.attributes?.dimensionsCm).toEqual({
      width: 210,
      depth: 95,
      height: 85,
    })
    expect(items[1]?.attributes?.dimensionsCm).toEqual({
      width: 220,
      depth: 90,
      height: 85,
    })
    expect(items[0]?.attributes?.dimensionsSource).toEqual({
      width: 'store-text',
      depth: 'store-text',
      height: 'store-text',
    })
  })
})

describe('selectObjects', () => {
  const box = (x: number, y: number, w: number, h: number) => ({ x, y, w, h })

  it('отбрасывает рамку на всю картинку и дубли одной категории, оставляет крупные', () => {
    const objects = selectObjects(
      [
        { label: 'a sofa', category: 'sofa', bbox: box(0, 0, 1, 1) },
        { label: 'a sofa', category: 'sofa', bbox: box(0.05, 0.6, 0.4, 0.35) },
        {
          label: 'a sofa',
          category: 'sofa',
          bbox: box(0.06, 0.62, 0.38, 0.33),
        },
        { label: 'a rug', category: 'rug', bbox: box(0.3, 0.7, 0.5, 0.25) },
        {
          label: 'a plant',
          category: 'decor',
          bbox: box(0.9, 0.5, 0.02, 0.02),
        },
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

  it('не считает часть дивана отдельным креслом', () => {
    const objects = selectObjects(
      [
        { label: 'a sofa', category: 'sofa', bbox: box(0.2, 0.45, 0.6, 0.4) },
        {
          label: 'an armchair',
          category: 'chair',
          bbox: box(0.55, 0.52, 0.18, 0.24),
        },
      ],
      6,
    )
    expect(objects.map((object) => object.label)).toEqual(['a sofa'])
  })

  it('не угадывает тип светильника по пропорциям его рамки', () => {
    const objects = selectObjects(
      [
        {
          label: 'a pendant lamp',
          category: 'lamp',
          bbox: box(0.05, 0.2, 0.12, 0.65),
        },
      ],
      6,
    )
    expect(objects[0]?.label).toBe('a pendant lamp')
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
