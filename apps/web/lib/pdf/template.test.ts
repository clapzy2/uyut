import { estimateProject, layoutRoom } from '@uyut/catalog'
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
        plan: layoutRoom({ widthCm: 340, depthCm: 540 }, [
          {
            id: 's1',
            title: 'Диван Букле',
            category: 'sofa',
            dimensions: { width: 220, depth: 95, height: 85 },
            quantity: 1,
          },
        ]),
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
  it('does not present an unpriced geometry check as a zero-cost estimate', () => {
    const data = sample('free')
    data.estimateStatus = 'not-calculated'
    const html = renderProjectHtml(data, { fontCss: '' })
    expect(html).toContain('Стоимость не рассчитывалась')
    expect(html).not.toContain('Сколько это стоит')
    expect(html).not.toContain('<div>Смета</div>')
    expect(renderProjectHtml(sample('free'), { fontCss: '' })).toContain('Сколько это стоит')
  })

  it('does not invent an online project link for an offline QA document', () => {
    const data = sample('free')
    data.project.projectUrl = null
    const html = renderProjectHtml(data, { fontCss: '' })
    expect(html).not.toContain('Проект онлайн')
    expect(html).not.toContain('в проекте по адресу')
  })

  it('does not promise renders when a project only has a 2D plan', () => {
    const data = sample('free')
    data.rooms = data.rooms.map((room) => ({ ...room, render: null, alternates: [] }))
    const html = renderProjectHtml(data, { fontCss: '' })
    expect(html).toContain('Данные проекта — по адресу')
    expect(html).not.toContain('Все рендеры')
    expect(html).not.toContain('Рендеры и данные проекта')
    expect(renderProjectHtml(sample('free'), { fontCss: '' })).toContain('Рендеры и данные проекта')
  })

  it('marks balcony works as requiring a separate estimate', () => {
    const data = sample('free')
    data.estimate = estimateProject({
      rooms: [
        {
          id: 'balcony',
          name: 'Балкон 1',
          spaceKind: 'balcony',
          areaM2: 5,
          condition: 'bare',
          refreshFinish: false,
        },
      ],
      items: [],
      budgetKopecks: null,
      rates,
    })
    const html = renderProjectHtml(data, { fontCss: '' })
    expect(html).toContain('отдельный расчёт работ')
    expect(html).toContain('Работы на балконах и лоджиях в итог не включены')
    expect(data.estimate.works.totalKopecks).toBe(0)
  })

  it('keeps the selected product link escaped and excludes unsafe protocols', () => {
    const data = sample('paid')
    const item = data.shopping[0]?.items[0]
    if (!item) throw new Error('Missing shopping fixture')
    item.affiliateUrl = 'https://shop.example/sofa?fabric=green&size=220'
    expect(renderProjectHtml(data, { fontCss: '' })).toContain(
      'href="https://shop.example/sofa?fabric=green&amp;size=220"',
    )
    item.affiliateUrl = 'javascript:alert(1)'
    expect(renderProjectHtml(data, { fontCss: '' })).not.toContain('javascript:')
  })
  it('includes escaped measurement limitations beside the plan', () => {
    const data = sample('paid')
    const room = data.rooms[0]
    if (!room?.plan) throw new Error('Missing fixture plan')
    room.plan.measurementNote = 'Предварительно <проверить размеры>'
    const html = renderProjectHtml(data, { fontCss: '' })
    expect(html).toContain('Предварительно &lt;проверить размеры&gt;')
    expect(html).not.toContain('<проверить размеры>')
  })
  it('renders every section with escaped text and the brief', () => {
    const html = renderProjectHtml(sample('paid'), { fontCss: '' })
    expect(html).toContain('<!doctype html>')
    expect(html).toContain('Квартира на Мира &lt;тест&gt;')
    expect(html).toContain('Гостиная')
    expect(html).toContain('Что купить')
    expect(html).toContain('Сколько это стоит')
    expect(html).toContain('Задание для мастеров')
    expect(html).toContain('Окрасить стены в два слоя.')
    expect(html).toContain('Уточнить расположение стола.')
    expect(html).toContain('Кухня: концепт можно выбрать отдельно')
    expect(html).toContain('uyut.ru/p/05ec84b4')
    expect(html).toContain('+7 900 000-00-00')
    expect(html).not.toContain('wm-layer"></div>')
  })

  it('оговорка про задание стоит до самого задания, а не мелким шрифтом в конце', () => {
    const html = renderProjectHtml(sample('paid'), { fontCss: '' })
    const warning = html.indexOf('Как использовать задание')
    const firstRoomSection = html.indexOf('Окрасить стены в два слоя.')
    expect(warning).toBeGreaterThan(-1)
    expect(warning).toBeLessThan(firstRoomSection)
    expect(html).toContain('бригада сверяет обмеры, состояние основания и проводки')
    expect(html).toContain('Это задание не заменяет рабочую проектную документацию')
    expect(html).not.toContain('не знает обмеров')
  })

  it('keeps material and missing-area exclusions beside the estimate total', () => {
    const html = renderProjectHtml(sample('paid'), { fontCss: '' })
    const total = html.indexOf('<span>Итого по расчёту</span>')
    const exclusions = html.indexOf('Материалы для отделки в сумму не включены', total)
    const budget = html.indexOf('class="bar"', total)
    expect(total).toBeGreaterThan(-1)
    expect(exclusions).toBeGreaterThan(total)
    expect(exclusions).toBeLessThan(budget)
    expect(html.slice(total, budget)).toContain('ещё не включены: Кухня')
    expect(html).toContain('Ставки этого расчёта')
    expect(html).not.toContain('по средним ставкам')
    expect(html).toContain(`435${NBSP}900${NBSP}₽`)
  })

  it('does not promise complete fit without openings and preserves the shared safety result', () => {
    const data = sample('paid')
    const html = renderProjectHtml(data, { fontCss: '' })
    const plan = data.rooms[0]?.plan
    if (!plan) throw new Error('Missing fixture plan')
    expect(html).toContain(plan.safetySummary.title)
    expect(html).toContain(plan.safetySummary.detail)
    expect(html).toContain('Для проверки доступа укажите двери и окна на плане')
    expect(html).not.toContain('Выбранное помещается')
  })

  it('preserves a blocked safety verdict even if there are no placement problems', () => {
    const data = sample('paid')
    const plan = data.rooms[0]?.plan
    if (!plan) throw new Error('Missing fixture plan')
    plan.problems = []
    plan.safetySummary = {
      status: 'blocked',
      title: 'Требуется перестановка',
      detail: 'Кровать перекрывает <боковой подход>.',
    }
    const html = renderProjectHtml(data, { fontCss: '' })
    expect(html).toContain('class="verdict status bad">Требуется перестановка')
    expect(html).toContain('Кровать перекрывает &lt;боковой подход&gt;')
  })

  it('shows the missing-data result when no drawing can be produced', () => {
    const data = sample('paid')
    const room = data.rooms[0]
    if (!room) throw new Error('Missing fixture room')
    room.plan = layoutRoom({}, [])
    const html = renderProjectHtml(data, { fontCss: '' })
    expect(html).toContain(room.plan.safetySummary.title)
    expect(html).toContain(room.plan.safetySummary.detail)
    expect(html).not.toContain('<svg viewBox="0 0 400')
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

  it('печатает вид сверху вектором, а не картинкой, и говорит про проход', () => {
    const html = renderProjectHtml(sample('paid'), { fontCss: '' })
    expect(html).toContain('Вид сверху · 340 × 540 см')
    expect(html).toContain('<svg viewBox="0 0 400')
    expect(html).toContain('проход посередине')
    const planPage = html.split('<section class="page plan-page">')[1]?.split('</section>')[0]
    expect(planPage).toContain('Гостиная · расстановка')
    expect(planPage).toContain('<svg viewBox="0 0 400')
    expect(planPage).toContain('Для проверки доступа укажите двери и окна на плане')
  })

  it('когда ничего не расставилось, причину всё равно печатаем', () => {
    const data = sample('paid')
    const room = data.rooms[0]
    if (room) {
      room.plan = layoutRoom({ widthCm: 300, depthCm: 260 }, [
        {
          id: 's1',
          title: 'Диван Бергамо',
          category: 'sofa',
          dimensions: { width: 320, depth: 95, height: 85 },
          quantity: 1,
        },
      ])
    }
    const html = renderProjectHtml(data, { fontCss: '' })
    expect(html).toContain('Вид сверху · 300 × 260 см')
    expect(html).toContain('не встаёт ни к одной стене')
    // Рисовать нечего, рамку пустой комнаты не печатаем
    expect(html).not.toContain('<svg viewBox="0 0 400')
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
    expect(html).not.toContain('Задание для мастеров</h1>')
    expect(html).toContain('Вопросы появятся вместе с заданием для мастеров.')
  })

  it('builds a footer with the page counter', () => {
    const footer = footerTemplate('Квартира <на> Мира')
    expect(footer).toContain('class="pageNumber"')
    expect(footer).toContain('Квартира &lt;на&gt; Мира')
  })
})
