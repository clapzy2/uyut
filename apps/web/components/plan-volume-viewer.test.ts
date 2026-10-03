import type { PlanGeometry } from '@uyut/db'
import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'
import { planVolume } from '@/lib/projects/plan-volume'
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

  it('при неполных мерках сохраняет маркер положения и условную высоту', () => {
    const html = render({
      ...geometry,
      walls: geometry.walls.map((wall) => ({ ...wall, heightCm: undefined })),
    })
    expect(html).toContain('Окно · положение на плане')
    expect(html).toContain('Высота стен показана условно')
    expect(html.match(/<path /g)).toHaveLength(2)
    expect(html).toContain('<line ')
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
})
