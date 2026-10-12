import { Button } from '@uyut/ui'
import { createElement, isValidElement, type ReactElement, type ReactNode } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it, vi } from 'vitest'
import type { SourceFloorReference } from '@/lib/projects/plan-page-source-floors'
import { PlanPageSourceFloorControls } from './plan-page-source-floor-controls'

const polygon = [
  { x: 10, y: 10 },
  { x: 30, y: 10 },
  { x: 10, y: 30 },
]
const floor: SourceFloorReference['floors'][number] = {
  id: 'source-floor-1',
  sourceRoomKey: '3.1',
  name: 'Гардероб',
  polygon,
  holes: [],
  exactPointKeys: ['10/1:10/1', '30/1:10/1', '10/1:30/1'],
  holeExactPointKeys: [],
  nonDecimalVertices: 0,
  omittedStrokeCount: 2,
  boundaryInkComplete: false,
}
const reference: SourceFloorReference = {
  version: 1,
  coordinateSystem: 'page-0-1000',
  source: { sha256: 'a'.repeat(64), pdfPage: 3, state: 'existing' },
  sourceRevision: 'b'.repeat(64),
  pageWidth: 1200,
  pageHeight: 800,
  status: 'checked',
  reason: null,
  readOnly: true,
  physicalBoundariesAccepted: false,
  floors: [floor],
}

function props(overrides: Partial<Parameters<typeof PlanPageSourceFloorControls>[0]> = {}) {
  return {
    reference,
    selectedKey: '3.1',
    shown: true,
    loading: false,
    locked: false,
    draftExists: false,
    conversion: {
      kind: 'candidate' as const,
      draft: { roomSourceNumber: 3.1, polygon, closed: true },
    },
    onToggle: vi.fn(),
    onCopy: vi.fn(),
    ...overrides,
  }
}

function buttons(node: ReactNode): ReactElement<{ disabled: boolean; onClick: () => void }>[] {
  if (Array.isArray(node)) return node.flatMap(buttons)
  if (!isValidElement<{ children?: ReactNode }>(node)) return []
  if (node.type === Button)
    return [node as ReactElement<{ disabled: boolean; onClick: () => void }>]
  return buttons(node.props.children)
}

function html(input: Parameters<typeof PlanPageSourceFloorControls>[0]) {
  return renderToStaticMarkup(createElement(PlanPageSourceFloorControls, input))
}

describe('source floor controls', () => {
  it('shows bounded opening contacts and retained uncertain source-end status without accepting a passage', () => {
    const input = props({
      reference: {
        ...reference,
        openingInspection: {
          status: 'checked',
          reason: null,
          completeOpeningInventory: false,
          physicalJambAccepted: false,
          physicalPassageAccepted: false,
          finalPaintVisibilityProved: false,
          targets: [
            {
              id: 'panel:panel-end:1',
              objectId: 'panel',
              kind: 'panel-end',
              sourceRef: { operationIndex: 20, subpathIndex: 0, segmentIndex: 1 },
              startKey: '10/1:10/1',
              endKey: '30/1:10/1',
              frameInteriorSide: null,
              independentSourceRefs: [],
              sourceEndStatus: 'ambiguous',
              omittedInkCount: 2,
              laterPaintCount: 3,
              status: 'ambiguous',
              coverage: 'complete',
              visibility: {
                status: 'held',
                reason: 'later-paint-may-cover-source-span',
                sourceRef: { operationIndex: 20, subpathIndex: 0, segmentIndex: 1 },
                blockerOperations: [1000],
              },
              contacts: [
                {
                  floorId: floor.id,
                  ringIndex: 0,
                  edgeIndex: 0,
                  startKey: '10/1:10/1',
                  endKey: '30/1:10/1',
                  regionSide: 'left',
                },
              ],
            },
          ],
        },
      },
    })
    const markup = html(input)
    expect(markup).toContain('Контакты исходной области с рамками и профилями')
    expect(markup).toContain('Конец профиля')
    expect(markup).toContain('20/0/1')
    expect(markup).toContain('Конец по источнику: Неоднозначная связь')
    expect(markup).toContain('Возможных пропусков: 2')
    expect(markup).toContain('Поздних наложений: 3')
    expect(markup).toContain('Видимость исходного отрезка удержана')
    expect(markup).toContain('Совпадение не подтверждает физический косяк')
    expect(input.onCopy).not.toHaveBeenCalled()
  })

  it.each(['checked', 'held'] as const)(
    'explains %s opening inspection without inventing missing doors',
    (status) => {
      const input = props({
        reference: {
          ...reference,
          openingInspection: {
            status,
            reason: status === 'held' ? 'source-opening-work-limit' : null,
            completeOpeningInventory: false,
            physicalJambAccepted: false,
            physicalPassageAccepted: false,
            finalPaintVisibilityProved: false,
            targets: [],
          },
        },
      })
      const markup = html(input)
      expect(markup).toContain(
        status === 'held'
          ? 'Исходный контур не изменён'
          : 'Это не означает, что в комнате нет проёмов',
      )
      expect(buttons(PlanPageSourceFloorControls(input))[1]?.props.disabled).toBe(false)
    },
  )

  it('shows source command coverage and paint side without claiming a physical wall or jamb', () => {
    const input = props({
      reference: {
        ...reference,
        boundaryInspection: { status: 'checked', reason: null },
        floors: [
          {
            ...floor,
            boundarySupports: [
              {
                ringIndex: 0,
                edgeIndex: 0,
                sourceRegionSide: 'left',
                status: 'linked',
                coverage: 'complete',
                reason: null,
                omittedInkCount: 2,
                contacts: [
                  {
                    operationIndex: 10,
                    subpathIndex: 0,
                    segmentIndex: 2,
                    startKey: '10/1:10/1',
                    endKey: '30/1:10/1',
                    paintSide: 'opposite-region',
                  },
                ],
              },
            ],
          },
        ],
      },
    })
    const markup = html(input)
    expect(markup).toContain('Проверка граней исходного контура')
    expect(markup).toContain('Полное покрытие источником')
    expect(markup).toContain('10/0/2')
    expect(markup).toContain('С другой стороны')
    expect(markup).toContain('Возможных пропусков: 2')
    expect(markup).toContain('ещё не проверка строительных стен, косяков или проходов')
    expect(markup).not.toContain('physicalJambAccepted')
  })

  it('keeps whole-source copy available when boundary inspection exceeds its budget', () => {
    const input = props({
      reference: {
        ...reference,
        boundaryInspection: { status: 'held', reason: 'source-boundary-work-limit' },
      },
    })
    expect(html(input)).toContain('Сам исходный снимок остаётся доступен')
    expect(html(input)).toContain('source-boundary-work-limit')
    expect(buttons(PlanPageSourceFloorControls(input))[1]?.props.disabled).toBe(false)
  })

  it('offers a lazy toggle without claiming physical boundaries', () => {
    const input = props({ reference: undefined, shown: false })
    const markup = html(input)
    expect(markup).toContain('Показать выбранную область исходника')
    expect(markup).toContain('не подтверждённая физическая граница пола')
    expect(markup).not.toContain('Взять как черновик комнаты')
    expect(input.onToggle).not.toHaveBeenCalled()
    buttons(PlanPageSourceFloorControls(input))[0]?.props.onClick()
    expect(input.onToggle).toHaveBeenCalledOnce()
    expect(input.onCopy).not.toHaveBeenCalled()
  })

  it('copies only after an explicit click for the selected single room', () => {
    const input = props()
    expect(html(input)).toContain('№ 3.1')
    expect(html(input)).toContain('Гардероб')
    expect(html(input)).toContain('возможных пропущенных штрихов: 2')
    const copy = buttons(PlanPageSourceFloorControls(input))[1]
    expect(copy?.props.disabled).toBe(false)
    expect(input.onCopy).not.toHaveBeenCalled()
    copy?.props.onClick()
    expect(input.onCopy).toHaveBeenCalledOnce()
  })

  it.each([true, false])('does not replace an existing draft, locked=%s', (locked) => {
    const input = props({ draftExists: true, locked })
    expect(html(input)).toContain('проёмы и другие объекты не заменяются')
    expect(html(input)).not.toContain('Взять как черновик комнаты')
    expect(buttons(PlanPageSourceFloorControls(input))).toHaveLength(1)
    expect(input.onCopy).not.toHaveBeenCalled()
  })

  it.each(['holes', 'rational-precision', 'unproved-vertex', 'missing-selection'] as const)(
    'explains held %s without offering partial copy',
    (reason) => {
      const input = props({ conversion: { kind: 'held', reason } })
      expect(html(input)).not.toContain('Взять как черновик комнаты')
      expect(html(input)).toContain('role="status"')
      expect(buttons(PlanPageSourceFloorControls(input))).toHaveLength(1)
    },
  )

  it('shows holes and precision counts without classifying holes as voids', () => {
    const input = props({
      reference: { ...reference, floors: [{ ...floor, holes: [polygon], nonDecimalVertices: 4 }] },
      conversion: { kind: 'held', reason: 'holes' },
    })
    const markup = html(input)
    expect(markup).toContain('внутренних вырезов: 1')
    expect(markup).toContain('представления: 4')
    expect(markup).toContain('не превращаются автоматически в технические пустоты')
  })

  it.each([
    { selectedKey: '3' },
    { selectedKey: '3+3.1' },
    {
      conversion: {
        kind: 'candidate' as const,
        draft: { roomSourceNumber: 3, polygon, closed: true },
      },
    },
    {
      conversion: {
        kind: 'candidate' as const,
        draft: { roomSourceNumbers: [3, 3.1], polygon, closed: true },
      },
    },
  ])('does not copy into another room or a grouped room', (override) => {
    const input = props(override)
    expect(html(input)).not.toContain('Взять как черновик комнаты')
    expect(buttons(PlanPageSourceFloorControls(input))).toHaveLength(1)
  })

  it('guards both action callbacks while locked', () => {
    const input = props({ locked: true })
    const actions = buttons(PlanPageSourceFloorControls(input))
    expect(actions).toHaveLength(2)
    for (const action of actions) {
      expect(action.props.disabled).toBe(true)
      action.props.onClick()
    }
    expect(input.onCopy).not.toHaveBeenCalled()
    expect(input.onToggle).not.toHaveBeenCalled()
  })

  it.each([
    { loading: true },
    { error: 'Исходный план изменился.' },
    { shown: false },
    { reference: { ...reference, status: 'held' as const, reason: 'stale', floors: [] } },
    { reference: { ...reference, status: 'not-saved' as const, floors: [] } },
  ])('does not show an old floor summary or copy action while unavailable', (override) => {
    const input = props(override)
    const markup = html(input)
    expect(markup).not.toContain('Гардероб')
    expect(markup).not.toContain('Взять как черновик комнаты')
    expect(buttons(PlanPageSourceFloorControls(input))).toHaveLength(1)
  })

  it('does not toggle during a pending load', () => {
    const input = props({ loading: true })
    const toggle = buttons(PlanPageSourceFloorControls(input))[0]
    expect(toggle?.props.disabled).toBe(true)
    toggle?.props.onClick()
    expect(input.onToggle).not.toHaveBeenCalled()
  })
})
