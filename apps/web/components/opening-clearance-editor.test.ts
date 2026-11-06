import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'
import { clearanceFromDraft, OpeningClearanceEditor } from './opening-clearance-editor'

describe('явный ввод свободной зоны двери', () => {
  const swing = { side: 'left', shape: 'swing', hinge: 'end', depth: '80' } as const

  it('сохраняет введённую створку, сторону и петли', () => {
    expect(clearanceFromDraft(swing)).toEqual({
      side: 'left',
      shape: 'swing',
      hinge: 'end',
      depthCm: 80,
    })
  })

  it('принимает дробный измеренный резерв без петель', () => {
    expect(
      clearanceFromDraft({ side: 'right', shape: 'rectangle', hinge: '', depth: '82,5' }),
    ).toEqual({ side: 'right', shape: 'rectangle', depthCm: 82.5 })
  })

  it.each(['', ' ', '0', '-1', '601', 'NaN', 'Infinity', '80 см'])(
    'не принимает размер %j',
    (depth) => {
      expect(clearanceFromDraft({ ...swing, depth })).toBeUndefined()
    },
  )

  it('не достраивает сторону, форму или петли', () => {
    expect(clearanceFromDraft({ ...swing, side: '' })).toBeUndefined()
    expect(clearanceFromDraft({ ...swing, shape: '' })).toBeUndefined()
    expect(clearanceFromDraft({ ...swing, hinge: '' })).toBeUndefined()
  })

  it('открывает новую зону без значений и запрещает применение', () => {
    const html = renderToStaticMarkup(
      createElement(OpeningClearanceEditor, {
        value: undefined,
        onChange: () => {},
      }),
    )
    expect(html).toContain('value=""')
    expect(html).toContain('disabled=""')
    expect(html).not.toContain('value="90"')
    expect(html).not.toContain('Убрать зону')
    expect(html).toContain('Ширина проёма не равна длине створки')
  })

  it('оставляет старый прямоугольный резерв и неполную дугу без новых петель', () => {
    const html = renderToStaticMarkup(
      createElement(OpeningClearanceEditor, {
        value: { side: 'left', depthCm: 42 },
        onChange: () => {},
      }),
    )
    expect(html).toContain('value="42"')
    expect(html).toContain('value="rectangle" selected=""')
    expect(html).toContain('Убрать зону')
    const incomplete = renderToStaticMarkup(
      createElement(OpeningClearanceEditor, {
        value: { side: 'left', shape: 'swing', depthCm: 80 },
        onChange: () => {},
      }),
    )
    expect(incomplete).toContain('value="" selected="">Не указаны')
    expect(incomplete).not.toContain('value="start" selected')
  })
})
