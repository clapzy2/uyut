import type { PlanGeometry } from '@uyut/db'
import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'
import {
  applyOpeningMeasurementRequests,
  openingMeasurementSnapshot,
  openingMeasurementWallSnapshot,
} from '@/lib/projects/plan-opening-measurements'
import { PlanOpeningMeasurementEditor } from './plan-opening-measurement-editor'

const opening = { id: 'door', type: 'door' as const, wallId: 'wall', widthCm: 90, offsetCm: 100 }
const wall = {
  id: 'wall',
  kind: 'outer' as const,
  start: { xCm: 0, yCm: 0 },
  end: { xCm: 500, yCm: 0 },
}
const props = {
  opening,
  wall,
  pending: false,
  required: true,
  onVerify: () => {},
  onRemove: () => {},
}

describe('форма сверки мерок проёма', () => {
  it('не копирует масштабные числа в поля обмера и показывает точку отсчёта', () => {
    const html = renderToStaticMarkup(createElement(PlanOpeningMeasurementEditor, props))
    expect(html).toContain('А — начало выбранной стены')
    expect(html).toContain('не измерение картинки')
    expect(html).toContain('Сверенная ширина, см')
    expect(html).toContain('Сверенный отступ, см')
    expect(html).not.toContain('value="90"')
    expect(html).not.toContain('value="100"')
    expect(html).toMatch(/<button[^>]*disabled=""[^>]*>Применить сверенные мерки/)
  })

  it('различает подготовленную сверку и уже сохранённый пользователем источник', () => {
    const geometry: Pick<PlanGeometry, 'walls' | 'openings' | 'rooms' | 'pdfCalibration'> = {
      walls: [wall],
      openings: [opening],
      rooms: [],
      pdfCalibration: {
        sourceSha256: 'a'.repeat(64),
        pdfPage: 2,
        cmPerPoint: 1,
        origin: { x: 0, y: 0 },
        anchorRoomNumbers: [1],
        labelIndexes: [],
        derivedOpeningIds: [opening.id],
      },
    }
    const result = applyOpeningMeasurementRequests(
      geometry,
      [
        {
          action: 'verify',
          opening: openingMeasurementSnapshot(opening),
          wall: openingMeasurementWallSnapshot(wall),
          source: { kind: 'dimensioned-drawing', reference: 'Обмерный план, лист 03' },
          acknowledged: true,
        },
      ],
      'owner',
      '2026-10-03T12:00:00.000Z',
    )
    if (!result.ok) throw new Error(result.error)
    const measurement = result.pdfCalibration?.openingMeasurements?.[0]
    const saved = renderToStaticMarkup(
      createElement(PlanOpeningMeasurementEditor, { ...props, measurement }),
    )
    expect(saved).toContain('Мерки сверены пользователем.')
    expect(saved).toContain('Обмерный план, лист 03')
    const pending = renderToStaticMarkup(
      createElement(PlanOpeningMeasurementEditor, { ...props, measurement, pending: true }),
    )
    expect(pending).toContain('Сверка подготовлена — сохраните черновик.')
    expect(pending).toContain('Снять сверку')
  })

  it('явно сообщает о сбросе предыдущей сверки после изменения', () => {
    const html = renderToStaticMarkup(
      createElement(PlanOpeningMeasurementEditor, { ...props, invalidated: true }),
    )
    expect(html).toContain('прежняя сверка больше не действует')
    expect(html).not.toContain('Мерки сверены пользователем.')
  })
})
