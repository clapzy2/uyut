import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'
import type { PlanVolume } from '@/lib/projects/plan-volume'
import { PlanVolumeSelection, type VolumeSelection } from './plan-volume-selection'

const model: PlanVolume = {
  floor: [],
  voids: [],
  walls: [],
  openings: [],
  solidFaces: [],
  issues: [],
  wallSource: 'centerline',
  joinedSolids: false,
  rooms: [{ id: 'room-a', title: 'Гостиная', floor: [] }],
  furniture: [
    {
      id: 'copy-1',
      itemId: 'sofa',
      roomId: 'room-a',
      title: 'Диван',
      heightCm: 80,
      floor: [
        { xCm: 100, yCm: 100 },
        { xCm: 190, yCm: 100 },
        { xCm: 190, yCm: 300 },
        { xCm: 100, yCm: 300 },
      ],
    },
    {
      id: 'copy-2',
      itemId: 'sofa',
      roomId: 'room-a',
      title: 'Диван',
      floor: [
        { xCm: 300, yCm: 100 },
        { xCm: 390, yCm: 100 },
        { xCm: 390, yCm: 300 },
        { xCm: 300, yCm: 300 },
      ],
    },
  ],
}

function render(selection: VolumeSelection, projectId?: string, source = model) {
  return renderToStaticMarkup(
    createElement(PlanVolumeSelection, {
      model: source,
      selection,
      projectId,
      onSelect: () => {},
    }),
  )
}

describe('выбор комнаты и предмета в объёмном обзоре', () => {
  it('shows a source balcony without linking its synthetic contour ID to a room page', () => {
    const html = render({ kind: 'room', id: 'plan-space:4' }, 'project-a', {
      ...model,
      rooms: [{ id: 'plan-space:4', title: 'Балкон', floor: [], sourceOnly: true }],
    })
    expect(html).toContain('Балкон')
    expect(html).not.toContain('/rooms/plan-space')
    expect(html).not.toContain('<a')
  })
  it('показывает доступные кнопки комнат без выбора и ссылок наугад', () => {
    const html = render(null, 'project-a')
    expect(html).toContain('<fieldset')
    expect(html).toContain('aria-pressed="false"')
    expect(html).toContain('Выберите комнату или предмет')
    expect(html).not.toContain('href=')
  })

  it('ведёт к выбранной комнате, её плану и проверкам', () => {
    const html = render({ kind: 'room', id: 'room-a' }, 'project-a')
    expect(html).toContain('Выбрана комната: Гостиная')
    expect(html).toContain('aria-pressed="true"')
    expect(html).toContain('href="/projects/project-a/rooms/room-a"')
    expect(html).toContain('href="/projects/project-a/rooms/room-a#room-plan"')
    expect(html).toContain('href="/projects/project-a/rooms/room-a#room-checks"')
  })

  it('сохраняет повёрнутый габарит и выбирает отдельную копию товара', () => {
    const before = structuredClone(model)
    const first = render({ kind: 'furniture', id: 'copy-1' }, 'project-a')
    expect(first).toContain('Габарит на схеме: 90 × 200 см.')
    expect(first).toContain('Высота 80 см.')
    const second = render({ kind: 'furniture', id: 'copy-2' }, 'project-a')
    expect(second).toContain('Высоту нужно уточнить.')
    expect(second).not.toContain('Высота 80 см.')
    expect(model).toEqual(before)
  })

  it('не создаёт переход к комнате без подтверждённой связи или контекста проекта', () => {
    expect(render({ kind: 'room', id: 'unknown' }, 'project-a')).not.toContain('href=')
    expect(render({ kind: 'furniture', id: 'copy-1' })).not.toContain('href=')
    const unlinked = {
      ...model,
      furniture: model.furniture?.map((item) => ({ ...item, roomId: undefined })),
    }
    expect(render({ kind: 'furniture', id: 'copy-1' }, 'project-a', unlinked)).not.toContain(
      'href=',
    )
  })

  it('кодирует части внутреннего адреса, не принимает их за внешний URL', () => {
    const source = { ...model, rooms: [{ id: 'room/a?x=1', title: 'Комната', floor: [] }] }
    const html = render({ kind: 'room', id: 'room/a?x=1' }, 'https://foreign.example', source)
    expect(html).toContain(
      '/projects/https%3A%2F%2Fforeign.example/rooms/room%2Fa%3Fx%3D1#room-plan',
    )
    expect(html).not.toContain('href="https://')
  })
})
