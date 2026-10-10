import type { PlanGeometry } from '@uyut/db'
import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'
import { applyPlanVerticalReference } from '@/lib/projects/plan-vertical-reference'
import {
  buildVerticalReferenceRequest,
  createVerticalReferenceDraft,
} from '@/lib/projects/plan-vertical-reference-edit'
import { PlanVerticalReferenceEditor } from './plan-vertical-reference-editor'

function fixture(): PlanGeometry {
  return {
    version: 1,
    status: 'draft',
    widthCm: 400,
    heightCm: 300,
    warnings: [],
    rooms: [
      {
        name: 'Прихожая и коридор',
        sourceNumbers: [1, 5],
        polygon: [
          { xCm: 0, yCm: 0 },
          { xCm: 400, yCm: 0 },
          { xCm: 400, yCm: 300 },
          { xCm: 0, yCm: 300 },
        ],
      },
    ],
    walls: [{ id: 'wall-1', kind: 'outer', start: { xCm: 0, yCm: 0 }, end: { xCm: 400, yCm: 0 } }],
    openings: [],
  }
}

const handlers = {
  acknowledged: false,
  removal: false,
  pending: false,
  onStart: () => {},
  onChange: () => {},
  onAcknowledge: () => {},
  onRemove: () => {},
  onCancel: () => {},
}

function draftFor(geometry: PlanGeometry) {
  let nextId = 0
  return createVerticalReferenceDraft(geometry, () => `synthetic-${++nextId}`)
}

function savedFixture() {
  const geometry = fixture()
  const draft = draftFor(geometry)
  const floor = draft.floors[0]
  if (!floor) throw new Error('Synthetic floor missing')
  draft.kind = 'finished-floor'
  draft.zeroFloorId = floor.id
  draft.sourceKind = 'site-measurement'
  draft.sourceReference = 'Синтетическая проверка, не обмер пользователя'
  floor.surface = 'finished-floor'
  floor.elevation = '0'
  floor.ceiling = '270'
  for (const base of draft.wallBases) base.floorId = floor.id
  const request = buildVerticalReferenceRequest(geometry, draft)
  if (!request.ok) throw new Error(request.error)
  const result = applyPlanVerticalReference(
    geometry,
    request.request,
    'synthetic-owner',
    '2026-10-11T12:00:00.000Z',
  )
  if (!result.ok) throw new Error(result.error)
  return result.geometry
}

describe('controlled common vertical reference fields', () => {
  it('keeps horizontal identity errors visible before height review begins', () => {
    const html = renderToStaticMarkup(
      createElement(PlanVerticalReferenceEditor, {
        ...handlers,
        geometry: fixture(),
        startError: 'Сначала сверьте номера контуров.',
      }),
    )
    expect(html).toContain('Сначала сверьте номера контуров.')
    expect(html).toMatch(/<button[^>]*disabled=""[^>]*>Ввести общий отсчёт и отметки/)
  })
  it('starts with an explicit opt-in action, without assumed zero or readiness', () => {
    const html = renderToStaticMarkup(
      createElement(PlanVerticalReferenceEditor, { ...handlers, geometry: fixture() }),
    )
    expect(html).toContain('Общий высотный отсчёт и отметки')
    expect(html).toContain('Ввести общий отсчёт и отметки')
    expect(html).toContain('не означает, что полы всех помещений')
    expect(html).not.toContain('<input')
    expect(html).not.toContain('Готово к 3D')
  })

  it('leaves all new fields and owners empty and distinguishes ceiling from wall height', () => {
    const geometry = fixture()
    const html = renderToStaticMarkup(
      createElement(PlanVerticalReferenceEditor, {
        ...handlers,
        geometry,
        draft: draftFor(geometry),
      }),
    )
    expect(html).toContain('<option value="" selected="">Выберите нулевой пол</option>')
    expect(html).toContain('<option value="" selected="">Выберите источник</option>')
    expect(html).toContain('<option value="" selected="">Выберите пол основания</option>')
    expect(html).toMatch(/id="vertical-floor-[^"]+"[^>]*value=""/)
    expect(html).toMatch(/id="vertical-ceiling-[^"]+"[^>]*value=""/)
    expect(html).not.toContain('value="0"')
    expect(html).toContain('Пустое поле не означает 0')
    expect(html).toContain('Прихожая и коридор · № 1 + 5')
    expect(html).toContain('Отметка чистового потолка от общего нуля, см')
    expect(html).toContain('Не высота стены')
    expect(html).toContain('А (0; 0) → Б (400; 0)')
    expect(html).toContain('Стена 1: А (0; 0)')
    expect(html).toContain('id="vertical-wall-wall-1"')
    expect(html).not.toContain('Стена wall-1:')
    expect(html).toMatch(/type="checkbox"[^>]*disabled=""/)
    expect(html).toContain('Перенос уровней в 2D/3D, мебель и маршруты ещё')
    expect(html).not.toContain('<form')
  })

  it('disables the complete review during saving', () => {
    const geometry = fixture()
    const html = renderToStaticMarkup(
      createElement(PlanVerticalReferenceEditor, {
        ...handlers,
        geometry,
        draft: draftFor(geometry),
        pending: true,
      }),
    )
    expect(html).toMatch(/<fieldset[^>]*disabled=""/)
    expect(html).toMatch(/<button[^>]*disabled=""[^>]*>Отменить редактирование/)
  })

  it('uses display order for wall labels but retains exact wall identity in controls', () => {
    const geometry = fixture()
    geometry.walls.unshift({
      id: 'another-wall',
      kind: 'outer',
      start: { xCm: 0, yCm: 300 },
      end: { xCm: 400, yCm: 300 },
    })
    const html = renderToStaticMarkup(
      createElement(PlanVerticalReferenceEditor, {
        ...handlers,
        geometry,
        draft: draftFor(geometry),
      }),
    )
    expect(html).toContain('Стена 2: А (0; 0)')
    expect(html).toContain('id="vertical-wall-wall-1"')
    expect(html).toContain('id="vertical-wall-another-wall"')
    expect(html).not.toContain('id="vertical-wall-1"')
  })

  it('shows human paired-opening labels and explicitly holds missing hosts', () => {
    const geometry = fixture()
    geometry.walls.push({
      id: 'second-wall',
      kind: 'outer',
      start: { xCm: 0, yCm: 300 },
      end: { xCm: 400, yCm: 300 },
    })
    geometry.openings = [
      { id: 'inside-opening', type: 'balcony', wallId: 'wall-1', offsetCm: 100, widthCm: 90 },
      { id: 'outside-opening', type: 'balcony', wallId: 'second-wall', offsetCm: 100, widthCm: 90 },
    ]
    const firstWall = geometry.walls[0]
    const secondWall = geometry.walls[1]
    const firstOpening = geometry.openings[0]
    const secondOpening = geometry.openings[1]
    if (!firstWall || !secondWall || !firstOpening || !secondOpening)
      throw new Error('Synthetic pair missing')
    geometry.pdfCalibration = {
      sourceSha256: 'a'.repeat(64),
      pdfPage: 1,
      cmPerPoint: 1,
      origin: { x: 0, y: 0 },
      anchorRoomNumbers: [1],
      labelIndexes: [],
      derivedOpeningIds: [],
      wallFaceRoomPolygons: geometry.rooms.map((room) => structuredClone(room.polygon)),
      openingFacePairs: [
        {
          bindings: [
            { opening: structuredClone(firstOpening), wall: structuredClone(firstWall) },
            { opening: structuredClone(secondOpening), wall: structuredClone(secondWall) },
          ],
          jambs: [
            { operationIndex: 1, subpathIndex: 0, segmentIndex: 0 },
            { operationIndex: 1, subpathIndex: 0, segmentIndex: 1 },
          ],
        },
      ],
    }
    const draft = draftFor(geometry)
    expect(draft.thresholds).toHaveLength(1)
    const html = renderToStaticMarkup(
      createElement(PlanVerticalReferenceEditor, { ...handlers, geometry, draft }),
    )
    expect(html).toContain('Балконный блок 1 (стена 1)')
    expect(html).toContain('Балконный блок 2 (стена 2)')
    expect(html).not.toContain('inside-opening (стена')
    expect(html).toContain(`id="vertical-threshold-${draft.thresholds[0]?.id}"`)
    geometry.walls.pop()
    const held = renderToStaticMarkup(
      createElement(PlanVerticalReferenceEditor, { ...handlers, geometry, draft }),
    )
    expect(held).toContain('Балконный блок 2 (стена не найдена)')
    expect(held).toContain('Поля заблокированы')
  })

  it('holds a stale draft and offers explicit restart without asserting transfer', () => {
    const geometry = fixture()
    const draft = draftFor(geometry)
    const changed = structuredClone(geometry)
    changed.widthCm = 420
    const corner = changed.rooms[0]?.polygon[1]
    if (!corner) throw new Error('Synthetic corner missing')
    corner.xCm = 420
    const html = renderToStaticMarkup(
      createElement(PlanVerticalReferenceEditor, {
        ...handlers,
        geometry: changed,
        draft,
        acknowledged: true,
      }),
    )
    expect(html).toMatch(/<fieldset[^>]*disabled=""/)
    expect(html).toContain('Начать сверку заново')
    expect(html).toContain('Прежние числа не будут перенесены')
    expect(html).not.toContain('checked=""')
  })

  it('shows saved floor/ceiling separately and calls the source a user review', () => {
    const html = renderToStaticMarkup(
      createElement(PlanVerticalReferenceEditor, { ...handlers, geometry: savedFixture() }),
    )
    expect(html).toContain('Сохранённая сверка пользователя относится к текущим контурам')
    expect(html).toContain('Источник пользователя: обмер')
    expect(html).toContain('чистовой пол 0 см')
    expect(html).toContain('Потолок в общем отсчёте: +270 см')
    expect(html).toContain('Изменить отсчёт и отметки')
    expect(html).toContain('Подготовить снятие отсчёта')
    expect(html).toContain('Пока доступно только сохранение отметок')
    expect(html).not.toContain('Готово к 3D')
  })

  it('marks an invalid stored reference as unusable without exposing stale numbers or source', () => {
    const geometry = savedFixture()
    const corner = geometry.rooms[0]?.polygon[1]
    if (!corner) throw new Error('Synthetic corner missing')
    corner.xCm = 420
    const html = renderToStaticMarkup(
      createElement(PlanVerticalReferenceEditor, { ...handlers, geometry }),
    )
    expect(html).toContain('Сохранённый отсчёт недействителен')
    expect(html).toContain('Сверить отсчёт заново')
    expect(html).not.toContain('Сохранённая сверка пользователя относится')
    expect(html).not.toContain('не обмер пользователя')
    expect(html).not.toContain('+270 см')
    expect(html).toContain('Прежние отметки не используются')
    expect(html).toContain('Подготовить снятие отсчёта')
  })

  it.each([null, false, 0, '', {}])(
    'holds malformed stored reference %j without crashing or hiding removal',
    (value) => {
      const geometry = fixture()
      geometry.verticalReference = value as unknown as PlanGeometry['verticalReference']
      const html = renderToStaticMarkup(
        createElement(PlanVerticalReferenceEditor, { ...handlers, geometry }),
      )
      expect(html).toContain('Сохранённый отсчёт недействителен')
      expect(html).toContain('Пока доступно только сохранение отметок')
      expect(html).toContain('Сверить отсчёт заново')
      expect(html).toContain('Подготовить снятие отсчёта')
      expect(html).not.toContain('Сохранённая сверка пользователя относится')
      expect(html).not.toContain('Нулевой пол:')
    },
  )

  it('requires a distinct removal acknowledgment and explains deferred saving', () => {
    const html = renderToStaticMarkup(
      createElement(PlanVerticalReferenceEditor, {
        ...handlers,
        geometry: savedFixture(),
        removal: true,
      }),
    )
    expect(html).toContain('Я понимаю, что сниму общий отсчёт')
    expect(html).toContain('Оно произойдёт только после сохранения схемы')
    expect(html).toContain('Отменить снятие отсчёта')
    expect(html).not.toContain('checked=""')
    expect(html).not.toContain('id="vertical-reference-zero"')
  })
})
