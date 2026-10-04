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

import type { ExistingRoom } from '@/lib/projects/plan-rows'
import { PlanReadingCard } from './plan-reading-card'

function render(reading: PlanReading | null, roomCount = 0, existing: ExistingRoom[] = []) {
  return renderToStaticMarkup(
    createElement(PlanReadingCard, {
      projectId: 'project',
      sourceRevision: 'revision',
      reading,
      hasPlan: true,
      planIsPdf: true,
      roomCount,
      existing,
    }),
  )
}

describe('plan review form', () => {
  it('leads an unread plan to the selected sheet and explains the review before room transfer', () => {
    const html = render(null)
    expect(html).toContain('Прочитайте нужный лист')
    expect(html).toContain('Прочитать выбранный лист')
    expect(html).toContain('сверите результат с исходным листом')
    expect(html).not.toContain('Прочитать другой лист или повторить чтение')
  })

  it('leads transferred rooms to measurements while keeping rereading optional', () => {
    const html = render(
      {
        readAt: '2026-10-03',
        confirmedAt: '2026-10-03',
        sourcePage: 6,
        planState: 'proposed',
        rooms: [{ name: 'Спальня', kind: 'bedroom' }],
      },
      1,
      [{ id: 'room', name: 'Спальня', kind: 'bedroom', notes: null }],
    )
    expect(html).toContain('href="/projects/project/rooms/room#room-measurements"')
    expect(html).toContain('Открыть мерки комнаты')
    expect(html).toContain('aria-label="Открыть мерки комнаты Спальня"')
    expect(html).toContain('Перенос не подтверждает обмер')
    expect(html).toContain('Прочитан лист 6')
    expect(html).toContain('Проектное состояние — вариант после изменений, не исходный обмер')
    expect(html).toMatch(/<details[^>]*><summary[^>]*>Прочитать другой лист или повторить чтение/)
    expect(html).toContain('использует AI и заменит данные в форме')
  })

  it('names room transfer explicitly and labels each room selection for assistive technology', () => {
    const html = render({
      readAt: '2026-10-03',
      rooms: [{ name: 'Спальня', kind: 'bedroom' }],
    })
    expect(html).toContain('Сверьте данные перед переносом')
    expect(html).toContain('Перенести комнаты: 1')
    expect(html).toContain('aria-label="Перенести комнату Спальня"')
    expect(html).toContain('включая несохранённые правки')
    expect(html).toContain('Очистить сохранённое чтение')
    expect(html).toContain('Очистка удалит сохранённое чтение, разметку листа и 2D-схему')
    expect(html).toContain('aria-describedby="plan-forget-hint"')
  })

  it('opens a confirmation dialog before clearing saved reading and geometry', () => {
    const html = render({
      readAt: '2026-10-03',
      rooms: [{ name: 'Спальня', kind: 'bedroom' }],
    })
    const trigger = html.match(/<button[^>]*>Очистить сохранённое чтение<\/button>/)?.[0]
    expect(trigger).toBeDefined()
    expect(trigger).toContain('aria-haspopup="dialog"')
    expect(trigger).toContain('aria-expanded="false"')
    expect(trigger).toContain('data-state="closed"')
    expect(trigger).toContain('aria-describedby="plan-forget-hint"')
    expect(html).not.toContain('Да, очистить чтение')
  })

  it('offers editing saved rows without requiring another AI read', () => {
    const html = render({
      readAt: '2026-10-03',
      confirmedAt: '2026-10-03',
      rooms: [{ name: 'Спальня', sourceNumber: 4, kind: 'bedroom' }],
    })
    expect(html).toContain('Изменить данные с чертежа')
  })

  it('offers missing schedule identities separately with no preselected purpose or dimensions', () => {
    const html = render({
      readAt: '2026-10-03',
      sourcePage: 2,
      planState: 'existing',
      rooms: [{ name: 'Спальня 4', sourceNumber: 4, kind: 'bedroom' }],
      pageReview: {
        version: 1,
        savedAt: '2026-10-03',
        sourceRooms: [
          { name: 'Спальня 4', sourceNumber: 4 },
          { name: 'Спальня 6', sourceNumber: 6 },
        ],
        contours: {
          source: { sha256: 'a'.repeat(64), pdfPage: 2, state: 'existing' },
          coordinateSystem: 'page-0-1000',
          review: 'manual-source-review',
          pageWidth: 1000,
          pageHeight: 1000,
          rooms: [
            {
              roomSourceNumber: 4,
              polygon: [
                { x: 0, y: 0 },
                { x: 20, y: 0 },
                { x: 0, y: 20 },
              ],
            },
          ],
        },
      },
    })
    expect(html).toContain('Добавить помещение из экспликации')
    expect(html).toContain('№06 · Спальня 6')
    expect(html).toContain('размеры останутся пустыми')
    expect(html).toMatch(/<button[^>]*disabled[^>]*>Добавить строку/)
  })
  it('does not claim rooms were imported when the project has none', () => {
    const reading: PlanReading = {
      readAt: '2026-10-02',
      confirmedAt: '2026-10-02',
      rooms: [{ name: 'Гостиная', kind: 'living' }],
    }

    expect(render(reading)).toContain('комнат проекта сейчас нет')
    expect(render(reading)).not.toContain('Комнаты перенесены')
    expect(render(reading)).not.toContain('Данные с плана уже перенесены в комнаты')
    expect(render(reading, 1)).toContain('Данные с плана уже перенесены в комнаты')
  })

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

  it('offers sheet annotation without automatically rereading or confirming measurements', () => {
    const html = render({
      sourcePage: 6,
      planState: 'existing',
      readAt: '2026-09-27',
      confirmedAt: '2026-09-27',
      rooms: [{ name: 'Спальня', kind: 'bedroom', sourceNumber: 4 }],
    })
    expect(html).toContain('Разметить комнаты и объекты')
    expect(html).toContain('Разметка не меняет ваши мерки и не запускает генерацию')
    expect(html).not.toContain('Прочитать со сверкой контуров')
  })

  it('requires a known sheet state and printed room identity before offering annotation', () => {
    const html = render({
      sourcePage: 6,
      planState: 'unknown',
      readAt: '2026-09-27',
      rooms: [{ name: 'Спальня', kind: 'bedroom', sourceNumber: 4 }],
    })
    expect(html).not.toContain('Разметить комнаты и объекты')
    const unnumbered = render({
      sourcePage: 6,
      planState: 'existing',
      readAt: '2026-09-27',
      rooms: [{ name: 'Спальня', kind: 'bedroom' }],
    })
    expect(unnumbered).not.toContain('Разметить комнаты и объекты')
  })

  it('makes AI rereading explicit only for a saved review on the selected sheet', () => {
    const html = render({
      sourcePage: 6,
      planState: 'existing',
      readAt: '2026-09-27',
      rooms: [{ name: 'Спальня', kind: 'bedroom', sourceNumber: 4 }],
      pageReview: {
        version: 1,
        savedAt: '2026-09-27',
        contours: {
          source: { sha256: 'a'.repeat(64), pdfPage: 6, state: 'existing' },
          coordinateSystem: 'page-0-1000',
          review: 'manual-source-review',
          pageWidth: 842,
          pageHeight: 1191,
          rooms: [
            {
              roomSourceNumber: 4,
              polygon: [
                { x: 100, y: 100 },
                { x: 200, y: 100 },
                { x: 200, y: 200 },
              ],
            },
          ],
        },
      },
    })
    expect(html).toContain('Изменить разметку листа')
    expect(html).toContain('Прочитать со сверкой контуров')
    expect(html).toContain('Повторное чтение')
    expect(html).toContain('использует AI и заменит данные в форме')
  })
})
