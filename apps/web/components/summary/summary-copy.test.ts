import { estimateProject } from '@uyut/catalog'
import { type ComponentProps, createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it, vi } from 'vitest'

vi.mock('next/navigation', () => ({ useRouter: () => ({ refresh: vi.fn() }) }))
vi.mock('@/actions/shopping', () => ({ setRoomRefreshFinish: vi.fn() }))
vi.mock('@/actions/billing', () => ({
  startProjectPurchase: vi.fn(),
  startProSubscription: vi.fn(),
}))
vi.mock('@/actions/exports', () => ({ exportProjectPdf: vi.fn(), loadExport: vi.fn() }))
vi.mock('@/lib/queue/use-run-watch', () => ({
  useRunWatch: () => ({ progress: {}, slow: false, lost: true }),
}))

import { EstimateCard, type EstimateRoomRow } from './estimate-card'
import { ExportCard } from './export-card'
import { ExportComposition } from './export-composition'
import { PartnerExports } from './partner-exports'

const rates = { roughRubPerM2: 15_000, finishRubPerM2: 5_000 }
const rooms: EstimateRoomRow[] = [
  { id: 'living', name: 'Гостиная', areaM2: 10, condition: 'bare', refreshFinish: false },
  {
    id: 'kitchen',
    name: 'Кухня <уточнить>',
    areaM2: null,
    condition: 'bare',
    refreshFinish: false,
  },
]

function renderEstimate(selectedRooms = rooms) {
  const estimate = estimateProject({
    rooms: selectedRooms,
    items: [{ priceKopecks: 50_000_00, quantity: 1 }],
    budgetKopecks: 500_000_00,
    rates,
  })
  return renderToStaticMarkup(
    createElement(EstimateCard, {
      estimate,
      rooms: selectedRooms,
      rates,
      projectId: 'project',
      readOnly: true,
    }),
  )
}

function renderExport(running = false, overrides: Partial<ComponentProps<typeof ExportCard>> = {}) {
  return renderToStaticMarkup(
    createElement(
      ExportCard,
      {
        projectId: 'project',
        exports: [],
        contact: null,
        isPaid: false,
        plan: 'free',
        hasRooms: true,
        projectPriceKopecks: 990_00,
        proPriceKopecks: 1990_00,
        initialRun: running
          ? { runId: 'test-run', accessToken: 'test-token', exportId: 'test-export', kind: 'free' }
          : null,
        ...overrides,
      },
      createElement(ExportComposition, { projectId: 'project', rooms: [], items: [] }),
    ),
  )
}

describe('summary and export explanations', () => {
  it('shows exclusions beside the total before the budget bar without changing arithmetic', () => {
    const html = renderEstimate()
    const total = html.indexOf('Итого по расчёту')
    const budgetBar = html.indexOf('role="img"', total)
    const notes = html.slice(total, budgetBar)
    expect(total).toBeGreaterThan(-1)
    expect(budgetBar).toBeGreaterThan(total)
    expect(notes).toContain('Материалы для отделки в сумму не включены')
    expect(notes).toContain('ещё не включены: Кухня &lt;уточнить&gt;')
    expect(notes).not.toContain('<details')
    expect(notes).toMatch(/250\s*000\s*₽/)
    expect(html).toContain('Ставки этого расчёта')
    expect(html).not.toContain('по средним ставкам')
  })

  it('does not show missing-area exclusions when all areas are known', () => {
    const html = renderEstimate(rooms.map((room) => ({ ...room, areaM2: 10 })))
    expect(html).not.toContain('Работы для комнат без площади')
    expect(html).toContain('Материалы для отделки в сумму не включены')
  })

  it('explains the document purpose before the purchase button', () => {
    const html = renderExport()
    const scope = html.indexOf('инженерные решения оформляются отдельно')
    expect(scope).toBeGreaterThan(-1)
    expect(scope).toBeLessThan(html.indexOf('Без водяного знака за'))
    expect(html).toContain('Задание для мастеров')
    expect(html).not.toContain('техническое задание для бригады')
  })

  it('shows the current composition and free PDF before buying without blocking incomplete rooms', () => {
    const html = renderExport()
    const composition = html.indexOf('Состав следующего PDF')
    const free = html.indexOf('Бесплатно собрать PDF с водяным знаком')
    const purchase = html.indexOf('Без водяного знака за')
    expect(composition).toBeGreaterThan(-1)
    expect(composition).toBeLessThan(free)
    expect(free).toBeLessThan(purchase)
    expect(html).not.toContain('disabled=""')
    expect(html).not.toContain('разворот каждой комнаты')
    expect(html).not.toMatch(/\d+ стр\./)
  })

  it('does not guarantee completion when the queue status is unavailable', () => {
    const html = renderExport(true)
    expect(html).toContain('Не удалось получить статус сборки')
    expect(html).toContain('Проверить результат')
    expect(html).not.toContain('Файл всё равно соберётся')
  })

  it('keeps partner PDF access read-only without checkout or a guaranteed brief', () => {
    const html = renderToStaticMarkup(
      createElement(
        PartnerExports,
        { exports: [] },
        createElement(ExportComposition, { projectId: 'project', rooms: [], items: [] }),
      ),
    )
    expect(html).toContain('владелец')
    expect(html).toContain('Готовых файлов пока нет')
    expect(html).not.toContain('<button')
    expect(html).not.toContain('Оформить Pro')
    expect(html).not.toContain('разворот каждой комнаты')
    expect(html).not.toContain('техническое задание')
    expect(html.indexOf('PDF как журнал')).toBeLessThan(html.indexOf('Состав следующего PDF'))
    expect(html.indexOf('Состав следующего PDF')).toBeLessThan(
      html.indexOf('Готовых файлов пока нет'),
    )
  })

  it('preserves paid and Pro assembly without offering another project purchase', () => {
    for (const overrides of [{ isPaid: true }, { plan: 'pro' as const }]) {
      const html = renderExport(false, overrides)
      expect(html).toContain('Собрать PDF</button>')
      expect(html).not.toContain('Без водяного знака за')
      expect(html).not.toContain('Бесплатно собрать PDF с водяным знаком</button>')
    }
  })

  it('retains the existing requirement of at least one room', () => {
    const html = renderExport(false, { hasRooms: false })
    expect(html).toContain('Добавьте хотя бы одну комнату')
    expect(html).toMatch(/disabled=""[^>]*>Бесплатно собрать PDF с водяным знаком/)
    expect(html).toMatch(/disabled=""[^>]*>Без водяного знака за/)
  })
})
