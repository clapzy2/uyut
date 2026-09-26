import type { PlanReading } from '@uyut/db'
import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it, vi } from 'vitest'

vi.mock('next/navigation', () => ({ useRouter: () => ({ refresh: vi.fn() }) }))
vi.mock('@/actions/projects', () => ({
  confirmPlanRooms: vi.fn(),
  forgetPlanReading: vi.fn(),
  readPlan: vi.fn(),
}))

import { PlanReadingCard } from './plan-reading-card'

function render(reading: PlanReading | null) {
  return renderToStaticMarkup(
    createElement(PlanReadingCard, {
      projectId: 'project',
      reading,
      hasPlan: true,
      planIsPdf: true,
      roomCount: 0,
      existing: [],
    }),
  )
}

describe('plan review form', () => {
  it('shows a PDF page selector instead of promising to read the first three pages', () => {
    const html = render(null)
    expect(html).toContain('Страница PDF с планом')
    expect(html).toContain('Читаем только выбранную страницу')
    expect(html).not.toContain('первые три страницы')
  })

  it('shows individual ceilings, source room numbers and precise dimensions', () => {
    const html = render({
      sourcePage: 6,
      pageCount: 48,
      planState: 'existing',
      readAt: '2026-09-26',
      rooms: [
        {
          name: 'Спальня 4',
          kind: 'bedroom',
          sourceNumber: 4,
          widthCm: 298.5,
          depthCm: 515.6,
          ceilingCm: 266.3,
          areaM2: 15.39,
        },
      ],
    })
    expect(html).toContain('Помещение №4')
    expect(html).toContain('value="298.5"')
    expect(html).toContain('value="266.3"')
    expect(html).toContain('существующее состояние')
    expect(html).toContain('max="48"')
  })

  it('warns about proposed changes and never offers an area-derived correction button', () => {
    const html = render({
      readAt: '2026-09-26',
      planState: 'proposed',
      rooms: [{ name: 'Кухня', kind: 'kitchen', widthCm: 300, depthCm: 500, areaM2: 10 }],
    })
    expect(html).toContain('Проектное состояние — вариант после изменений, не исходный обмер')
    expect(html).toContain('Длину стены берём с чертежа или из замера, не из площади')
    expect(html).not.toContain('Ширина 200 см')
    expect(html).not.toContain('Глубина 333 см')
  })

  it('explains confirmation and gives a next step for unknown sides without inventing them', () => {
    const html = render({
      readAt: '2026-09-27',
      rooms: [{ name: 'Спальня', kind: 'bedroom', areaM2: 12 }],
    })
    expect(html).toContain('замеры на месте подтверждаются отдельно')
    expect(html).toContain('Дополните ширину и глубину по размерным линиям')
    expect(html).toContain('Пока неизвестные размеры оставлены пустыми')
    expect(html).not.toContain('Модель не может')
  })
})
