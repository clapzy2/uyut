import { estimateProject } from '@uyut/catalog'
import {
  inspectStoredPlanDelivery,
  type PlanDeliveryPresentation,
} from '@uyut/catalog/plan-delivery-record'
import type { PdfData } from '@uyut/pdf'
import { renderProjectHtml } from '@uyut/pdf'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { buildPdfData, type ProjectSnapshot } from '../../../../jobs/src/lib/pdf-data'

vi.mock('@uyut/catalog/plan-delivery-record', () => ({ inspectStoredPlanDelivery: vi.fn() }))

const rates = { roughRubPerM2: 15000, finishRubPerM2: 5000 }
function sample(): PdfData {
  return {
    kind: 'free',
    generatedAt: new Date('2026-10-11T12:00:00Z'),
    project: { title: 'Занос', subtitle: '', facts: [], contact: null, projectUrl: null },
    summary: null,
    cover: null,
    band: null,
    rooms: [],
    roomsWithoutConcept: [],
    shopping: [],
    estimate: estimateProject({ rooms: [], items: [], budgetKopecks: null, rates }),
    rates,
    brief: null,
    estimateStatus: 'not-calculated',
  }
}
function checked(): Extract<PlanDeliveryPresentation, { status: 'checked' }> {
  const from = { xCm: -125.123456789, yCm: -150, zCm: -10, orientation: 0 as const }
  const to = { xCm: 600, yCm: 150, zCm: 198, orientation: 90 as const }
  return {
    status: 'checked',
    reviewedAt: '2026-10-11T12:00:00Z',
    targetRoomName: 'Гостиная <тест>',
    profile: { widthCm: 40.123456789, depthCm: 60, heightCm: 170, clearanceCm: 1, orientation: 0 },
    points: [from, { xCm: 150, yCm: 150, zCm: 0 }, to],
    regions: [0, 1, 2].map((index) => ({
      index,
      kind: index === 1 ? ('tread' as const) : ('landing' as const),
      polygon: [
        { xCm: index * 200, yCm: 0 },
        { xCm: index * 200 + 200, yCm: 0 },
        { xCm: index * 200 + 200, yCm: 300 },
        { xCm: index * 200, yCm: 300 },
      ],
      elevationCm: index * 99,
      ceilingElevationCm: index * 99 + 300,
    })),
    stages: [
      {
        kind: 'translate',
        from,
        to,
        bounds: {
          leftCm: -150.123456789,
          topCm: -180,
          rightCm: 630,
          bottomCm: 180,
          bottomElevationCm: -10,
          topElevationCm: 369,
        },
      },
    ],
    exteriorChecked: true,
    leavesChecked: true,
    notes: ['Источник <обмер>, без гарантии доставки.'],
  }
}
afterEach(() => {
  vi.unstubAllEnvs()
  vi.clearAllMocks()
})

describe('saved delivery route in project PDF', () => {
  it('omits an absent route without empty pages or contents entry', () => {
    expect(renderProjectHtml(sample(), { fontCss: '' })).not.toContain('Маршрут заноса')
  })
  it.each(['Черновик не проверен.', 'Схема изменилась <повторите>.'])(
    'prints held reason without any successful diagram: %s',
    (warning) => {
      const data = sample()
      data.deliveryPlan = { status: 'held', warnings: [warning] }
      const html = renderProjectHtml(data, { fontCss: '' })
      expect(html).toContain('Маршрут не подтверждён')
      expect(html).not.toContain('data-delivery-map="true"')
      expect(html).not.toContain('data-delivery-position=')
      expect(html).not.toContain('<повторите>')
    },
  )
  it('keeps exterior negative coordinates, heights, bounds and decimal precision and escapes notes', () => {
    const data = sample()
    data.deliveryPlan = checked()
    const html = renderProjectHtml(data, { fontCss: '' })
    expect(html).toContain('-125.123456789')
    expect(html).toContain('40.123456789')
    expect(html).toContain('-150.123456789')
    expect(html).toContain('Гостиная &lt;тест&gt;')
    expect(html).toContain('Источник &lt;обмер&gt;')
    expect(html).toContain('проверен от обмеренной площадки')
    expect(html).toContain('измеренные объёмы включены')
    expect(html).toContain('не гарантия доставки')
    expect(html).toContain('369')
  })
  it('does not claim omitted optional checks are completed', () => {
    const data = sample()
    data.deliveryPlan = { ...checked(), exteriorChecked: false, leavesChecked: false }
    const html = renderProjectHtml(data, { fontCss: '' })
    expect(html).toContain('Наружный занос: не проверен')
    expect(html).toContain('Створки: не проверены')
  })
  it('prints all 6000 positions and stages once in flowing tables without fixed clipping', () => {
    const data = sample()
    const report = checked()
    report.points = Array.from({ length: 6000 }, (_, index) => ({ xCm: index, yCm: 150, zCm: 198 }))
    const stage = report.stages[0]
    if (!stage) throw new Error('Missing synthetic stage')
    report.stages = Array.from({ length: 6000 }, () => stage)
    data.deliveryPlan = report
    const html = renderProjectHtml(data, { fontCss: '' })
    expect(html.match(/data-delivery-position=/gu)).toHaveLength(6000)
    expect(html.match(/data-delivery-stage=/gu)).toHaveLength(6000)
    expect(html.match(/data-delivery-map="true"/gu)).toHaveLength(1)
    expect(html).toContain('data-delivery-position="6000"')
    expect(html).toContain('data-delivery-stage="6000"')
    expect(html).not.toContain('class="page fixed delivery-plan"')
    expect(html).toContain('.delivery-plan thead { display: table-header-group; }')
  })
  it.each([
    undefined,
    { status: 'held' as const, warnings: ['Нужна повторная проверка.'] },
    checked(),
  ])(
    'uses the same geometry and record from the repeatable project snapshot',
    async (presentation) => {
      vi.stubEnv('APP_URL', 'https://domitsa.example')
      vi.mocked(inspectStoredPlanDelivery).mockReturnValue(presentation)
      const record = { version: 1 as const, savedAt: '2026-10-11T12:00:00Z', draftJson: '{}' }
      const geometry = {
        version: 1 as const,
        status: 'draft' as const,
        widthCm: 600,
        heightCm: 300,
        rooms: [],
        walls: [],
        openings: [],
        warnings: [],
      }
      const snapshot = {
        project: {
          id: 'synthetic',
          title: 'Занос',
          totalAreaM2: null,
          budgetKopecks: null,
          household: null,
          contact: null,
          styleTags: [],
          planReading: {
            rooms: [],
            readAt: record.savedAt,
            geometry,
            deliveryMeasurements: record,
          },
        },
        rooms: [],
        shopping: [],
        concepts: new Map(),
        objects: new Map(),
      } as unknown as ProjectSnapshot
      const data = await buildPdfData({
        snapshot,
        kind: 'free',
        options: {},
        rates,
        brief: null,
        summary: null,
      })
      expect(inspectStoredPlanDelivery).toHaveBeenCalledExactlyOnceWith(geometry, record)
      expect(data.deliveryPlan).toEqual(presentation)
      expect(Object.hasOwn(data, 'deliveryPlan')).toBe(presentation !== undefined)
    },
  )
})
