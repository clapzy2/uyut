import { layoutRoom } from '@uyut/catalog'
import type { PlanGeometry } from '@uyut/db'
import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'
import { planVolume } from '@/lib/projects/plan-volume'
import { roomVolume } from '@/lib/projects/room-volume'
import PlanVolumeViewer from './plan-volume-viewer'

const geometry: PlanGeometry = {
  version: 1,
  status: 'confirmed',
  widthCm: 300,
  heightCm: 200,
  walls: [
    {
      id: 'wall',
      kind: 'outer',
      start: { xCm: 0, yCm: 0 },
      end: { xCm: 300, yCm: 0 },
      heightCm: 200,
    },
  ],
  openings: [
    {
      id: 'window',
      type: 'window',
      wallId: 'wall',
      offsetCm: 100,
      widthCm: 100,
      bottomCm: 50,
      heightCm: 100,
    },
  ],
  rooms: [],
  warnings: [],
  footprint: [
    { xCm: 0, yCm: 0 },
    { xCm: 300, yCm: 0 },
    { xCm: 300, yCm: 200 },
    { xCm: 0, yCm: 200 },
  ],
}

function render(source: PlanGeometry) {
  const model = planVolume(source)
  if (!model) throw new Error('Missing volume')
  return renderToStaticMarkup(createElement(PlanVolumeViewer, { model }))
}

describe('объёмный просмотр с мерками', () => {
  it('показывает управление камерой и различает известную и неизвестную высоту мебели', () => {
    const layout = layoutRoom({ widthCm: 500, depthCm: 400 }, [
      {
        id: 'desk',
        title: 'Рабочий стол',
        category: 'table',
        dimensions: { width: 120, depth: 60, height: 75 },
        quantity: 1,
      },
      {
        id: 'sofa',
        title: 'Диван',
        category: 'sofa',
        dimensions: { width: 200, depth: 90 },
        quantity: 1,
      },
    ])
    const model = roomVolume(layout)
    if (!model) throw new Error('Missing room volume')
    const sourceReport = planVolume(geometry)?.verticalMeasurements
    if (!sourceReport) throw new Error('Missing source report')
    model.verticalMeasurements = sourceReport
    const html = renderToStaticMarkup(createElement(PlanVolumeViewer, { model }))
    expect(html).toContain('Поворот камеры, градусы')
    expect(html).toContain('Наклон камеры, градусы')
    expect(html).toContain('Приближение камеры')
    expect(html).toContain('Исходный вид')
    expect(html).toContain('высота 75 см')
    expect(html).toContain('Диван · высота не указана')
    expect(html).toContain('stroke-dasharray="5 4"')
    expect(html).toContain('data-volume-furniture=')
    expect(html).toContain('aria-pressed="false"')
    expect(html).not.toContain('Высоты стен показаны по меркам')
    expect(html).not.toContain('Открыть обзор комнат')
    expect(html).not.toContain('Мерки объёмной модели')
  })
  it('показывает толщину и откосы только после ввода отдельной мерки', () => {
    const html = render({
      ...geometry,
      walls: geometry.walls.map((wall) => ({ ...wall, measuredThicknessCm: 30 })),
    })
    expect(html).toContain('Откос проёма · толщина по обмеру')
    expect(html).toContain('Торец стены · толщина по обмеру')
    expect(html).toContain('Открыть обзор комнат')
    expect(html).not.toContain('NaN')
    expect(render(geometry)).not.toContain('толщина по обмеру')
  })
  it('показывает оконный контур с заданным низом и высотой', () => {
    const html = render(geometry)
    expect(html).toContain('Окно · низ 50 см · высота 100 см')
    expect(html).toContain('Высоты стен показаны по меркам')
    expect(html).not.toContain('<line ')
    expect(html.match(/<polygon /g)).toHaveLength(1)
    expect(html.match(/<path /g)).toHaveLength(5)
  })

  it('сохраняет известную высоту окна при неизвестной высоте стены', () => {
    const html = render({
      ...geometry,
      walls: geometry.walls.map((wall) => ({ ...wall, heightCm: undefined })),
    })
    expect(html).toContain('Окно · низ 50 см · высота 100 см')
    expect(html).toContain('Высота стен показана условно')
    expect(html.match(/<path /g)).toHaveLength(2)
    expect(html).toContain('<polygon ')
  })

  it('при неизвестной вертикали окна оставляет только положение на полу', () => {
    const html = render({
      ...geometry,
      openings: geometry.openings.map((opening) => ({ ...opening, heightCm: undefined })),
    })
    expect(html).toContain('Окно · положение на плане')
    expect(html).not.toContain('Окно · низ 50 см · высота 100 см')
    expect(html).toContain('<line ')
    expect(html).not.toContain('<polygon ')
  })

  it('показывает предупреждение, когда другая стена перекрывает проём', () => {
    const firstWall = geometry.walls[0]
    if (!firstWall) throw new Error('Missing wall fixture')
    const html = render({
      ...geometry,
      walls: [
        { ...firstWall, measuredThicknessCm: 20 },
        {
          id: 'crossing',
          kind: 'inner',
          heightCm: 200,
          measuredThicknessCm: 20,
          start: { xCm: 150, yCm: 0 },
          end: { xCm: 150, yCm: 200 },
        },
      ],
    })
    expect(html).toContain('role="status"')
    expect(html).toContain('Проём 1 пересекается с объёмом другой стены')
    expect(html).toContain('Стыки стен с мерками объединены')
    expect(html).toContain('fill-rule="evenodd"')
  })
  it('shows complete heights separately from missing thickness and does not label them a confirmed physical volume', () => {
    const html = render(geometry)
    expect(html).toContain('Мерки объёмной модели')
    expect(html).toContain('Высоты и нижние грани заполнены; толщины стен ещё неполные')
    expect(html).toContain('Толщина стен: 1 — wall')
    expect(html).toContain('не подтверждение обмера, высоты потолка или физического прохода')
    expect(html).not.toContain('Подтвердить')
    expect(html).not.toContain('Сохранить')
  })
  it('shows actionable missing height/bottom IDs while preserving conditional surfaces and source geometry', () => {
    const source: PlanGeometry = {
      ...geometry,
      walls: geometry.walls.map((wall) => ({ ...wall, heightCm: undefined })),
      openings: geometry.openings.map((opening) => ({
        ...opening,
        heightCm: undefined,
        bottomCm: undefined,
      })),
    }
    const before = structuredClone(source)
    const html = render(source)
    expect(html).toContain('Вертикальные мерки заполнены частично')
    expect(html).toContain('Высота стен: 1 — wall')
    expect(html).toContain('Высота проёмов: 1 — window')
    expect(html).toContain('Нижняя грань проёмов: 1 — window')
    expect(html).toContain('Стена · условная высота')
    expect(html).toContain('Окно · положение на плане')
    expect(source).toEqual(before)
  })
  it('keeps filled vertical/thickness values as model completeness, not acceptance of ceiling or a passage', () => {
    const source = {
      ...geometry,
      walls: geometry.walls.map((wall) => ({ ...wall, measuredThicknessCm: 20 })),
    }
    const html = render(source)
    expect(html).toContain('Высоты, нижние грани и толщины заполнены')
    expect(html).not.toContain('Какие мерки нужно уточнить')
    expect(html).toContain('Это полнота введённых полей')
    expect(html).toContain('не подтверждение обмера, высоты потолка или физического прохода')
  })
  it('adds no SVG geometry for the report and handles a legacy model with no vertical report', () => {
    const model = planVolume(geometry)
    if (!model) throw new Error('Missing volume')
    const html = renderToStaticMarkup(createElement(PlanVolumeViewer, { model }))
    const legacy = structuredClone(model)
    delete legacy.verticalMeasurements
    const oldHtml = renderToStaticMarkup(createElement(PlanVolumeViewer, { model: legacy }))
    expect(oldHtml).not.toContain('Мерки объёмной модели')
    expect(html.match(/<svg\b.*?<\/svg>/s)?.[0]).toEqual(oldHtml.match(/<svg\b.*?<\/svg>/s)?.[0])
  })
  it('reports invalid vertical values without turning warnings into model acceptance', () => {
    const model = planVolume(geometry)
    if (!model?.verticalMeasurements) throw new Error('Missing report')
    model.verticalMeasurements.surfaceStatus = 'invalid'
    const html = renderToStaticMarkup(createElement(PlanVolumeViewer, { model }))
    expect(html).toContain('Некоторые вертикальные мерки некорректны')
    expect(html).toContain('объём не считается сверенным')
    expect(html).not.toContain('Подтвердить')
  })
  it('distinguishes unknown and raised door/balcony threshold values in the volume report', () => {
    const html = render({
      ...geometry,
      openings: [
        ...geometry.openings,
        { id: 'door-unknown', type: 'door', wallId: 'wall', offsetCm: 10, widthCm: 60 },
        {
          id: 'balcony-raised',
          type: 'balcony',
          wallId: 'wall',
          offsetCm: 210,
          widthCm: 60,
          bottomCm: 12,
          heightCm: 180,
        },
      ],
    })
    expect(html).toContain('Уровень порога не указан: 1 — door-unknown')
    expect(html).toContain('Поднятая нижняя грань: 1 — balcony-raised')
    expect(html).toContain('Это не непрерывный ровный пол')
  })
})
