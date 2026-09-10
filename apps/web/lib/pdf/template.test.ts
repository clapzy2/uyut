import { estimateProject } from '@uyut/catalog'
import { footerTemplate, type PdfData, renderProjectHtml } from '@uyut/pdf'
import { describe, expect, it } from 'vitest'

const rates = { roughRubPerM2: 15_000, finishRubPerM2: 5_000 }
const NBSP = ' '

function sample(kind: PdfData['kind']): PdfData {
  return {
    kind,
    generatedAt: new Date('2026-09-07T12:00:00Z'),
    project: {
      title: 'Квартира на Мира <тест>',
      subtitle: 'Гостиная и кухня · 28 м²',
      facts: [{ label: 'Стиль', value: 'Лофт, сканди' }],
      contact: { clientName: 'Иван', phone: '+7 900 000-00-00' },
      projectUrl: 'https://uyut.ru/p/05ec84b4',
    },
    summary: 'Дом для четверых, если считать кота. Тёмные стены и светлый дуб.',
    cover: { src: 'data:image/jpeg;base64,AAA', alt: 'Гостиная' },
    band: null,
    rooms: [
      {
        id: 'r1',
        name: 'Гостиная',
        areaM2: 18.4,
        conditionLabel: 'Черновая отделка',
        render: { src: 'data:image/jpeg;base64,BBB' },
        before: null,
        alternates: [{ src: 'data:image/jpeg;base64,CCC', caption: 'Вариант со скамьёй' }],
        note: 'Диван напротив окна.',
        objects: [{ index: 1, category: 'Диван', product: 'Диван Букле', priceKopecks: 67_900_00 }],
      },
    ],
    roomsWithoutConcept: ['Кухня'],
    shopping: [
      {
        roomName: 'Гостиная',
        items: [
          {
            title: 'Диван Букле',
            meta: 'Каталог · кремовый',
            image: null,
            quantity: 1,
            priceKopecks: 67_900_00,
            totalKopecks: 67_900_00,
            adDisclosure: 'Реклама. Рекламодатель ООО "Мебель" ИНН 6679151160 erid 2SDnjcaRSuF',
          },
        ],
      },
    ],
    estimate: estimateProject({
      rooms: [
        { id: 'r1', name: 'Гостиная', areaM2: 18.4, condition: 'bare', refreshFinish: false },
        { id: 'r2', name: 'Кухня', areaM2: null, condition: 'bare', refreshFinish: false },
      ],
      items: [{ priceKopecks: 67_900_00, quantity: 1 }],
      budgetKopecks: 1_200_000_00,
      rates,
    }),
    rates,
    brief: {
      summary: 'Дом для четверых.',
      rooms: [
        {
          name: 'Гостиная',
          sections: [{ title: 'Стены', items: ['Окрасить стены в два слоя.'] }],
        },
      ],
      questions: ['Уточнить расположение стола.'],
    },
  }
}

describe('project PDF template', () => {
  it('renders every section with escaped text and the brief', () => {
    const html = renderProjectHtml(sample('paid'), { fontCss: '' })
    expect(html).toContain('<!doctype html>')
    expect(html).toContain('Квартира на Мира &lt;тест&gt;')
    expect(html).toContain('Гостиная')
    expect(html).toContain('Что купить')
    expect(html).toContain('Сколько это стоит')
    expect(html).toContain('Техническое задание')
    expect(html).toContain('Окрасить стены в два слоя.')
    expect(html).toContain('Уточнить расположение стола.')
    expect(html).toContain('Кухня: расстановка не утверждена')
    expect(html).toContain('uyut.ru/p/05ec84b4')
    expect(html).toContain('+7 900 000-00-00')
    expect(html).not.toContain('wm-layer"></div>')
  })

  it('оговорка про задание стоит до самого задания, а не мелким шрифтом в конце', () => {
    const html = renderProjectHtml(sample('paid'), { fontCss: '' })
    const warning = html.indexOf('Прочитайте до того, как отдадите бригаде')
    const firstRoomSection = html.indexOf('Окрасить стены в два слоя.')
    expect(warning).toBeGreaterThan(-1)
    expect(warning).toBeLessThan(firstRoomSection)
    expect(html).toContain('не знает обмеров, состояния проводки')
  })

  it('печатает пометку рекламы одним блоком и не теряет erid', () => {
    const html = renderProjectHtml(sample('paid'), { fontCss: '' })
    expect(html).toContain('подобрана по партнёрским программам')
    // Кавычки в названии рекламодателя обязаны быть экранированы, строка приходит извне
    expect(html).toContain('ООО &quot;Мебель&quot; ИНН 6679151160 erid 2SDnjcaRSuF')
  })

  it('без пометок блок рекламы не печатается', () => {
    const data = sample('paid')
    for (const group of data.shopping) {
      for (const item of group.items) {
        item.adDisclosure = undefined
      }
    }
    expect(renderProjectHtml(data, { fontCss: '' })).not.toContain('партнёрским программам')
  })

  it('splits the summary into a headline and the rest of the text', () => {
    const html = renderProjectHtml(sample('paid'), { fontCss: '' })
    expect(html).toContain('Дом для четверых, если считать кота</h1>')
    expect(html).toContain('>Тёмные стены и светлый дуб.</p>')
  })

  it('adds the watermark layer and ribbon only to the free version', () => {
    const free = renderProjectHtml(sample('free'), { fontCss: '' })
    expect(free).toContain('class="wm-layer"')
    expect(free).toContain('водяной знак исчезнет после оплаты')
    const paid = renderProjectHtml(sample('paid'), { fontCss: '' })
    expect(paid).not.toContain('class="wm-layer"')
  })

  it('formats money with non-breaking spaces and skips the brief when there is none', () => {
    const data = { ...sample('paid'), brief: null }
    const html = renderProjectHtml(data, { fontCss: '' })
    expect(html).toContain(`67${NBSP}900${NBSP}₽`)
    expect(html).toContain(`435${NBSP}900${NBSP}₽`)
    expect(html).not.toContain('Техническое задание')
    expect(html).toContain('Вопросы появятся вместе с техническим заданием.')
  })

  it('builds a footer with the page counter', () => {
    const footer = footerTemplate('Квартира <на> Мира')
    expect(footer).toContain('class="pageNumber"')
    expect(footer).toContain('Квартира &lt;на&gt; Мира')
  })
})
