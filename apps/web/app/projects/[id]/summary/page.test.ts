import type { PlanGeometry } from '@uyut/db'
import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import openApartment from '../../../../../../jobs/fixtures/open-swiss-apartment-35063-geometry.json'

vi.mock('server-only', () => ({}))
vi.mock('@/lib/session', () => ({ getSession: vi.fn(async () => ({ user: { id: 'owner' } })) }))
vi.mock('@/lib/projects/repository', () => ({ getProject: vi.fn() }))
vi.mock('@/lib/shopping/repository', () => ({
  getShoppingList: vi.fn(async () => ({ items: [], count: 0, id: null })),
}))
vi.mock('@/lib/exports/repository', () => ({ listExports: vi.fn(async () => []) }))
vi.mock('@/lib/billing/repository', () => ({
  getPlan: vi.fn(async () => 'free'),
  getPurchase: vi.fn(),
}))
vi.mock('@/lib/billing/apply', () => ({ applyPayment: vi.fn() }))
vi.mock('@/lib/env', () => ({
  getEnv: () => ({ PROJECT_PRICE_KOPECKS: 99000, PRO_PRICE_KOPECKS: 199000 }),
}))
vi.mock('@/components/chat/chat-drawer', () => ({ ChatDrawer: () => null }))
vi.mock('@/components/summary/estimate-card', () => ({ EstimateCard: () => null }))
vi.mock('@/components/summary/export-card', () => ({ ExportCard: () => null }))
vi.mock('@/components/summary/partner-exports', () => ({ PartnerExports: () => null }))
vi.mock('@/components/summary/shopping-rows', () => ({ ShoppingRows: () => null }))
vi.mock('@/components/summary/fit-warnings', () => ({ FitWarnings: () => null }))
vi.mock('@/components/plan-volume-launch', () => ({
  PlanVolumeLaunch: ({ model }: { model: { walls: unknown[] } }) =>
    createElement('button', { type: 'button' }, `Объёмный просмотр: ${model.walls.length} стен`),
}))

import { getProject } from '@/lib/projects/repository'
import SummaryPage from './page'

const geometry = openApartment.geometry as PlanGeometry

describe('общий план на странице итогов без покупок', () => {
  beforeEach(() => {
    vi.mocked(getProject).mockResolvedValue({
      id: 'project',
      title: 'Контрольная квартира',
      role: 'owner',
      rooms: [],
      budgetKopecks: null,
      totalAreaM2: null,
      contact: null,
      isPaid: false,
      planReading: { geometry: { ...geometry, status: 'confirmed' } },
    } as unknown as Awaited<ReturnType<typeof getProject>>)
  })

  async function render() {
    return renderToStaticMarkup(
      await SummaryPage({
        params: Promise.resolve({ id: 'project' }),
        searchParams: Promise.resolve({}),
      }),
    )
  }

  it('показывает подтверждённый пол и стены даже при пустом списке', async () => {
    const html = await render()
    expect(html).toContain('Расстановка в квартире')
    expect(html).toContain('Объёмный просмотр:')
    expect(html).not.toContain('Объёмный просмотр: 0 стен')
  })

  it('не открывает черновую геометрию как подтверждённую', async () => {
    const project = await getProject('owner', 'project')
    vi.mocked(getProject).mockResolvedValue({
      ...project,
      planReading: { ...project.planReading, geometry: { ...geometry, status: 'draft' } },
    } as Awaited<ReturnType<typeof getProject>>)
    expect(await render()).not.toContain('Расстановка в квартире')
  })
})
