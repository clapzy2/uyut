import type { ObjectsStatus } from '@uyut/db'
import { createElement, type EffectCallback } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const hooks = vi.hoisted(() => ({
  delayed: false,
  refresh: vi.fn(),
  setDelayed: vi.fn(),
  effects: [] as EffectCallback[],
}))

vi.mock('next/navigation', () => ({ useRouter: () => ({ refresh: hooks.refresh }) }))
vi.mock('react', async (importOriginal) => {
  const actual = await importOriginal<typeof import('react')>()
  return {
    ...actual,
    useEffect: (effect: EffectCallback) => hooks.effects.push(effect),
    useState: () => [hooks.delayed, hooks.setDelayed],
    useTransition: () => [false, (action: () => void) => action()],
  }
})

import { ConceptSearchStatus } from './concept-search-status'

function render(status: ObjectsStatus, objectCount = 0) {
  return renderToStaticMarkup(
    createElement(ConceptSearchStatus, {
      status,
      objectCount,
      roomHref: '/projects/project/rooms/room#room-concepts',
    }),
  )
}

beforeEach(() => {
  vi.useFakeTimers()
  hooks.delayed = false
  hooks.effects = []
  vi.clearAllMocks()
})

afterEach(() => vi.useRealTimers())

describe('понятное завершение ожидания подбора', () => {
  it('обновляет только статус и после минуты прекращает автоматические запросы', () => {
    render('pending')
    const cleanup = hooks.effects[0]?.()
    vi.advanceTimersByTime(60_000)
    expect(hooks.refresh).toHaveBeenCalledTimes(20)
    expect(hooks.setDelayed).toHaveBeenCalledExactlyOnceWith(true)
    vi.advanceTimersByTime(120_000)
    expect(hooks.refresh).toHaveBeenCalledTimes(20)
    if (typeof cleanup === 'function') {
      cleanup()
    }
  })

  it('снимает таймер при уходе со страницы или завершении поиска', () => {
    render('pending')
    const cleanup = hooks.effects[0]?.()
    vi.advanceTimersByTime(3000)
    if (typeof cleanup === 'function') {
      cleanup()
    }
    vi.advanceTimersByTime(60_000)
    expect(hooks.refresh).toHaveBeenCalledTimes(1)
    expect(hooks.setDelayed).not.toHaveBeenCalled()
  })

  it.each(['ready', 'failed', 'skipped'] as const)('не опрашивает конечный статус %s', (status) => {
    render(status)
    hooks.effects[0]?.()
    vi.advanceTimersByTime(60_000)
    expect(hooks.refresh).not.toHaveBeenCalled()
  })

  it('при задержке показывает проверку статуса, а не обещает секунды или новую генерацию', () => {
    hooks.delayed = true
    const html = render('pending')
    expect(html).toContain('Подбор занял больше времени')
    expect(html).toContain('Проверить статус')
    expect(html).toContain('Проверка статуса не запускает новую генерацию')
    expect(html).toContain('href="/projects/project/rooms/room#room-concepts"')
    expect(html).not.toContain('10–15 секунд')
    expect(html).not.toContain('Сгенерировать')
  })

  it('различает ошибку, отключённый подбор, пустой результат и найденные предметы', () => {
    expect(render('failed')).toContain('Концепт сохранён')
    expect(render('failed', 2)).toContain('Найденные предметы доступны')
    expect(render('skipped')).toContain('автоматический подбор товаров не выполнялся')
    expect(render('skipped')).not.toContain('Проверить статус')
    expect(render('ready')).toContain('Подбор завершён')
    const complete = render('ready', 2)
    expect(complete).toContain('Нажмите на номер на картинке или выберите предмет в списке')
    expect(complete).not.toContain('К вариантам комнаты')
  })
})
