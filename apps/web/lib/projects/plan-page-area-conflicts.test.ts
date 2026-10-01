import { parseFloorPlan } from '@uyut/ai'
import { describe, expect, it } from 'vitest'
import { planPageAreaConflicts } from './plan-page-area-conflicts'
import type { PlanReadingGeometryContext } from './plan-reading-geometry'
import { verifyPlanReadingGeometry } from './plan-reading-geometry'

const source = { sha256: 'a'.repeat(64), pdfPage: 2, state: 'existing' as const }
const polygon = [
  { x: 100, y: 100 },
  { x: 300, y: 100 },
  { x: 300, y: 300 },
  { x: 100, y: 300 },
]
const item = (text: string, x: number, y: number) => ({ text, x, y, rotation: 0 })
const textItems = [
  item('Экспликация помещений:', 700, 500),
  item('01-Кухня - 8,51м', 700, 520),
  item('02-Спальня - 16,54м', 700, 540),
  item('01', 180, 190),
  item('8,93', 180, 204),
  item('м', 220, 204),
]
const context: PlanReadingGeometryContext = {
  source,
  planText: JSON.stringify(textItems),
  linework: {
    coordinateSystem: 'page-0-1000',
    pageWidth: 1000,
    pageHeight: 1000,
    paths: [],
    skippedCurves: 0,
    unsupportedPaths: 0,
    unsupportedContexts: 0,
    clippedPaths: 0,
    truncated: false,
  },
  contours: {
    source,
    coordinateSystem: 'page-0-1000',
    review: 'manual-source-review',
    pageWidth: 1000,
    pageHeight: 1000,
    rooms: [{ roomSourceNumber: 1, polygon }],
  },
}

describe('противоречие двух площадей на одном обмерном листе', () => {
  it.each([8.51, 8.93])(
    'снимает выбранную площадь %s м², сохраняя обе исходные подписи в пояснении',
    (selectedAreaM2) => {
      const reading = parseFloorPlan(
        JSON.stringify({
          planState: 'existing',
          rooms: [{ name: 'Кухня', sourceNumber: 1, areaM2: selectedAreaM2 }],
        }),
        { planText: context.planText },
      )
      expect(reading.rooms[0]?.areaM2).toBe(selectedAreaM2 === 8.51 ? selectedAreaM2 : undefined)
      expect(planPageAreaConflicts(context)).toEqual([
        { sourceNumber: 1, planAreaM2: 8.93, scheduleAreaM2: 8.51 },
      ])

      const checked = verifyPlanReadingGeometry(reading, context)
      expect(checked.rooms[0]?.areaM2).toBeUndefined()
      expect(checked.rooms[0]?.measurementWarnings?.join(' ')).toContain('8,93')
      expect(checked.rooms[0]?.measurementWarnings?.join(' ')).toContain('8,51')
    },
  )

  it('не объявляет конфликт без единственной подписанной площади внутри нужного контура', () => {
    const changed = (index: number, replacement: ReturnType<typeof item>) => ({
      ...context,
      planText: JSON.stringify(
        textItems.map((value, position) => (position === index ? replacement : value)),
      ),
    })
    expect(planPageAreaConflicts(changed(4, item('8,51', 180, 204)))).toEqual([])
    expect(planPageAreaConflicts(changed(4, item('8,93', 330, 204)))).toEqual([])
    expect(planPageAreaConflicts(changed(5, item('не единица', 220, 204)))).toEqual([])
    expect(planPageAreaConflicts({ ...context, source: { ...source, state: 'proposed' } })).toEqual(
      [],
    )
    expect(
      planPageAreaConflicts({
        ...context,
        planText: JSON.stringify([...textItems, item('8,51', 180, 206)]),
      }),
    ).toEqual([])
  })
})
