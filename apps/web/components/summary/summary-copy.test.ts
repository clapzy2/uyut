import { estimateProject } from '@uyut/catalog'
import { createElement } from 'react'
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

function renderExport(running = false) {
  return renderToStaticMarkup(
    createElement(ExportCard, {
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
    }),
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
    expect(scope).toBeLessThan(html.indexOf('Забрать за'))
    expect(html).toContain('задание для мастеров')
    expect(html).not.toContain('техническое задание для бригады')
  })

  it('does not guarantee completion when the queue status is unavailable', () => {
    const html = renderExport(true)
    expect(html).toContain('Не удалось получить статус сборки')
    expect(html).toContain('Проверить результат')
    expect(html).not.toContain('Файл всё равно соберётся')
  })
})
