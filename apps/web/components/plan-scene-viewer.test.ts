import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'
import type { PlanVolume } from '@/lib/projects/plan-volume'
import PlanSceneViewer from './plan-scene-viewer'

const model: PlanVolume = {
  floor: [
    { xCm: 0, yCm: 0 },
    { xCm: 400, yCm: 0 },
    { xCm: 400, yCm: 300 },
    { xCm: 0, yCm: 300 },
  ],
  voids: [],
  walls: [],
  solidFaces: [],
  openings: [],
  issues: [],
  wallSource: 'room-layout',
  joinedSolids: false,
  furniture: [
    {
      id: 'desk',
      title: 'Стол',
      heightCm: 75,
      floor: [
        { xCm: 10, yCm: 10 },
        { xCm: 90, yCm: 10 },
        { xCm: 90, yCm: 70 },
        { xCm: 10, yCm: 70 },
      ],
    },
    {
      id: 'chair',
      title: 'Кресло',
      floor: [
        { xCm: 110, yCm: 10 },
        { xCm: 155, yCm: 10 },
        { xCm: 155, yCm: 55 },
        { xCm: 110, yCm: 55 },
      ],
    },
  ],
}

describe('3D-просмотр', () => {
  it('оставляет доступные кнопки, описание и неизвестную высоту без запуска WebGL на сервере', () => {
    const html = renderToStaticMarkup(
      createElement(PlanSceneViewer, { model, onFallback: () => {} }),
    )
    expect(html).toContain('3D-сцена планировки квартиры')
    expect(html).toContain('Сверху')
    expect(html).toContain('Исходный вид')
    expect(html).toContain('Показать выбранное крупнее')
    expect(html).not.toContain('Срез стен')
    expect(html).toContain('Управлять мышью и жестами')
    expect(html).toContain('data-scene-ready="false"')
    expect(html).toContain('Стол · высота 75 см')
    expect(html).toContain('Кресло · высоту нужно уточнить')
    expect(html).not.toContain('Зоны из 2D')
    expect(html).not.toContain('Высота 270')
  })

  it('предлагает срез только при известной высоте стен', () => {
    const html = renderToStaticMarkup(
      createElement(PlanSceneViewer, {
        model: {
          ...model,
          walls: [
            {
              id: 'wall',
              wallId: 'wall',
              kind: 'outer',
              start: { xCm: 0, yCm: 0 },
              end: { xCm: 400, yCm: 0 },
              bottomCm: 0,
              topCm: 270,
            },
          ],
        },
        onFallback: () => {},
      }),
    )
    expect(html).toContain('Срез стен — заглянуть внутрь')
    expect(html).not.toContain('type="range"')
    expect(html).not.toContain('checked="" disabled=""')
  })

  it('показывает зоны и предупреждения текущей геометрии, не обещая модель реального изделия', () => {
    const html = renderToStaticMarkup(
      createElement(PlanSceneViewer, {
        model: {
          ...model,
          floorZones: [
            {
              id: 'zone',
              title: 'Рабочая зона',
              kind: 'operation',
              floor: model.floor,
              preliminary: true,
            },
          ],
          issues: [
            {
              id: 'opening-blocked',
              severity: 'warning',
              message: 'Проём перекрыт другой стеной.',
            },
          ],
        },
        onFallback: () => {},
      }),
    )
    expect(html).toContain('Зоны из 2D')
    expect(html).toContain('Проём перекрыт другой стеной.')
    expect(html).toContain('не точными моделями изделий')
    expect(html).toContain('предварительные запасы уточняются')
  })
})
