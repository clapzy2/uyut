import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'
import { ProjectGuide } from './project-guide'

const initial = {
  projectId: 'apartment',
  isOwner: true,
  onboarded: true,
  hasPlan: false,
  planNeedsReview: false,
  rooms: [],
  shoppingCount: 0,
}

describe('следующее действие в проекте', () => {
  it('позволяет начать без плана и раскрывает полный маршрут без обязательного тура', () => {
    const html = renderToStaticMarkup(createElement(ProjectGuide, initial))
    expect(html).toContain('Добавить комнату')
    expect(html).toContain('href="#project-rooms"')
    expect(html).toContain('Впервые здесь?')
    expect(html).toContain('<details')
    expect(html).not.toContain('<details open')
    expect(html).toContain('объёмном просмотре')
    expect(html).not.toContain('100%')
  })

  it('продолжает анкету существующей квартиры, не создаёт новую', () => {
    const html = renderToStaticMarkup(createElement(ProjectGuide, { ...initial, onboarded: false }))
    expect(html).toContain('href="/onboarding/step-2?project=apartment"')
    expect(html).toContain('Продолжить анкету')
  })

  it('направляет к сверке загруженного, но не подтверждённого плана', () => {
    const html = renderToStaticMarkup(
      createElement(ProjectGuide, {
        ...initial,
        hasPlan: true,
        planNeedsReview: true,
        rooms: [{ id: 'room', name: 'Спальня', conceptCount: 0 }],
      }),
    )
    expect(html).toContain('К загруженному плану')
    expect(html).toContain('добавленными вручную')
    expect(html).not.toContain('Открыть комнату')
  })

  it('даёт прямое продолжение комнаты без концептов', () => {
    const html = renderToStaticMarkup(
      createElement(ProjectGuide, {
        ...initial,
        rooms: [{ id: 'bedroom', name: 'Спальня', conceptCount: 0 }],
      }),
    )
    expect(html).toContain('href="/projects/apartment/rooms/bedroom"')
    expect(html).toContain('Открыть комнату')
    expect(html).toContain('aria-current="step"')
  })

  it('не выдаёт наличие картинки за точную готовность расстановки', () => {
    const html = renderToStaticMarkup(
      createElement(ProjectGuide, {
        ...initial,
        rooms: [{ id: 'living', name: 'Гостиная', conceptCount: 3 }],
      }),
    )
    expect(html).toContain('Посмотреть варианты')
    expect(html).toContain('нажмите на метку предмета')
    expect(html).not.toContain('Всё проверено')
    expect(html).not.toContain('План готов')
  })

  it('направляет выбранную мебель к итогам, не запускает экспорт или оплату', () => {
    const html = renderToStaticMarkup(
      createElement(ProjectGuide, {
        ...initial,
        rooms: [{ id: 'living', name: 'Гостиная', conceptCount: 3 }],
        shoppingCount: 1,
      }),
    )
    expect(html).toContain('href="/projects/apartment/summary"')
    expect(html).toContain('К покупкам и PDF')
    expect(html).not.toContain('<form')
  })

  it('партнёру объясняет только доступные действия, даже без анкеты владельца', () => {
    const html = renderToStaticMarkup(
      createElement(ProjectGuide, {
        ...initial,
        isOwner: false,
        onboarded: false,
      }),
    )
    expect(html).toContain('Выбирайте интерьер вместе')
    expect(html).toContain('Посмотреть комнаты')
    expect(html).not.toContain('Продолжить анкету')
    expect(html).not.toContain('Добавить комнату')
  })
})
