import type { PlanGeometry } from '@uyut/db'
import { createElement, isValidElement, type ReactElement, type ReactNode, useState } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { inspectFurnitureDeliveryViaStairs } from '@/lib/projects/plan-furniture-delivery'
import { inspectFurnitureStairTransfer } from '@/lib/projects/plan-furniture-stair-transfer'
import { PlanFurnitureStairCheck } from './plan-furniture-stair-check'

vi.mock('react', async (original) => ({
  ...(await original<typeof import('react')>()),
  useState: vi.fn(),
  useId: () => 'stair-test',
}))
vi.mock('@/lib/projects/plan-furniture-stair-transfer', () => ({
  furnitureStairGeometryKey: (geometry: unknown) => JSON.stringify(geometry),
  inspectFurnitureStairTransfer: vi.fn(),
}))
vi.mock('@/lib/projects/plan-furniture-delivery', () => ({
  inspectFurnitureDeliveryViaStairs: vi.fn(),
}))
const geometry: PlanGeometry = {
  version: 1,
  status: 'draft',
  widthCm: 700,
  heightCm: 300,
  warnings: [],
  walls: [],
  openings: [],
  rooms: [],
}
const profileFields = {
  widthCm: '55',
  depthCm: '65',
  heightCm: '170',
  clearanceCm: '2',
  orientation: '0' as const,
}
const fields = {
  lowerFloorId: 'lower',
  upperFloorId: 'upper',
  direction: 'x',
  travelDirection: 'up',
  startCm: '0',
  crossStartCm: '90',
  widthCm: '120',
  lowerLandingLengthCm: '250',
  upperLandingLengthCm: '250',
  carryClearanceCm: '5',
  sourceReference: 'Test survey 11 October',
  tilt: 'depth',
  angleDeg: '30,5',
  steps: [{ id: 'step-1', runCm: '28', elevationCm: '18', ceilingElevationCm: '360' }],
}
const key = `${JSON.stringify(geometry)}:${JSON.stringify(profileFields)}:${JSON.stringify(fields)}`
const turningFields = {
  ...fields,
  turning: true,
  layout: [
    {
      id: 'layout-1',
      kind: 'landing',
      leftCm: '-10,5',
      topCm: '0',
      rightCm: '200',
      bottomCm: '120',
      elevationCm: '0',
      ceilingElevationCm: '350',
    },
    {
      id: 'layout-2',
      kind: 'tread',
      leftCm: '200',
      topCm: '0',
      rightCm: '228',
      bottomCm: '120',
      elevationCm: '18',
      ceilingElevationCm: '368',
    },
    {
      id: 'layout-3',
      kind: 'landing',
      leftCm: '228',
      topCm: '0',
      rightCm: '428',
      bottomCm: '220',
      elevationCm: '18',
      ceilingElevationCm: '368',
    },
  ],
}
const deliveryGeometry: PlanGeometry = {
  ...geometry,
  routeStartOpeningId: 'entry-test',
  rooms: ['Нижняя комната', 'Верхняя комната'].map((name, index) => ({
    name,
    polygon: [
      { xCm: index * 300, yCm: 0 },
      { xCm: index * 300 + 300, yCm: 0 },
      { xCm: index * 300 + 300, yCm: 300 },
      { xCm: index * 300, yCm: 300 },
    ],
  })),
}
const deliveryFields = { ...turningFields, targetRoomId: '1' }
const deliveryKey = `${JSON.stringify(deliveryGeometry)}:${JSON.stringify(profileFields)}:${JSON.stringify(deliveryFields)}`
const stairResult: NonNullable<ReturnType<typeof inspectFurnitureStairTransfer>['result']> = {
  referenceId: 'survey',
  travelDirection: 'up',
  tilt: 'none',
  angleDeg: 0,
  carried: { widthCm: 59, depthCm: 69, heightCm: 174 },
  sweepHeightCm: 174,
  regions: [
    {
      kind: 'landing',
      index: 0,
      polygon: deliveryGeometry.rooms[0]?.polygon ?? [],
      elevationCm: 0,
      ceilingElevationCm: 350,
    },
  ],
  points: [
    { xCm: 125, yCm: 60, zCm: 0 },
    { xCm: 350, yCm: 60, zCm: 18 },
  ],
  stages: [],
}
const deliveryResponse: ReturnType<typeof inspectFurnitureDeliveryViaStairs> = {
  notes: ['Наружный занос не проверен.'],
  result: {
    targetRoomId: '1',
    checkedNodes: 42,
    stairs: stairResult,
    points: [{ xCm: 10, yCm: 60, zCm: 0 }, ...stairResult.points, { xCm: 450, yCm: 60, zCm: 18 }],
    segments: {
      entry: [
        { xCm: 10, yCm: 60, zCm: 0 },
        { xCm: 125, yCm: 60, zCm: 0 },
      ],
      stairs: stairResult.points,
      exit: [
        { xCm: 350, yCm: 60, zCm: 18 },
        { xCm: 450, yCm: 60, zCm: 18 },
      ],
    },
  },
}
type Props = {
  children?: ReactNode
  id?: string
  onClick?: () => void
  onChange?: (event: { currentTarget: { value?: string; checked?: boolean } }) => void
}
function elements(node: ReactNode): ReactElement<Props>[] {
  if (Array.isArray(node)) return node.flatMap(elements)
  if (!isValidElement<Props>(node)) return []
  return [node, ...elements(node.props.children)]
}
beforeEach(() => {
  vi.resetAllMocks()
  vi.mocked(useState).mockImplementation(
    (initial?: unknown): ReturnType<typeof useState> => [
      typeof initial === 'function' ? initial() : initial,
      vi.fn(),
    ],
  )
  vi.mocked(inspectFurnitureStairTransfer).mockReturnValue({ error: 'Нужны обмеры', notes: [] })
  vi.mocked(inspectFurnitureDeliveryViaStairs).mockReturnValue({
    error: 'Путь не проверен',
    notes: [],
  })
})
function expanded(
  input: typeof fields | typeof turningFields = fields,
  acknowledged = true,
  response?: ReturnType<typeof inspectFurnitureStairTransfer>,
) {
  const snapshot = `${JSON.stringify(geometry)}:${JSON.stringify(profileFields)}:${JSON.stringify(input)}`
  vi.mocked(useState)
    .mockReturnValueOnce([true, vi.fn()])
    .mockReturnValueOnce([input, vi.fn()])
    .mockReturnValueOnce([acknowledged ? snapshot : undefined, vi.fn()])
    .mockReturnValueOnce([response ? { key: snapshot, response } : undefined, vi.fn()])
  return PlanFurnitureStairCheck({ geometry, profileFields })
}

describe('measured stair transfer form', () => {
  it('calls the joint inspector only for the complete-path action, with explicit target and survey', () => {
    vi.mocked(useState)
      .mockReturnValueOnce([true, vi.fn()])
      .mockReturnValueOnce([deliveryFields, vi.fn()])
      .mockReturnValueOnce([deliveryKey, vi.fn()])
      .mockReturnValueOnce([undefined, vi.fn()])
    const tree = PlanFurnitureStairCheck({ geometry: deliveryGeometry, profileFields })
    const nodes = elements(tree)
    expect(inspectFurnitureDeliveryViaStairs).not.toHaveBeenCalled()
    nodes.find((item) => item.props.children === 'Проверить марш')?.props.onClick?.()
    expect(inspectFurnitureStairTransfer).toHaveBeenCalledTimes(1)
    expect(inspectFurnitureDeliveryViaStairs).not.toHaveBeenCalled()
    nodes
      .find((item) => item.props.children === 'Проверить путь от стартовой двери')
      ?.props.onClick?.()
    expect(inspectFurnitureStairTransfer).toHaveBeenCalledTimes(1)
    expect(inspectFurnitureDeliveryViaStairs).toHaveBeenCalledWith(
      deliveryGeometry,
      expect.objectContaining({
        version: 2,
        geometryKey: JSON.stringify(deliveryGeometry),
        acknowledged: true,
        layout: expect.any(Array),
      }),
      { widthCm: 55, depthCm: 65, heightCm: 170, clearanceCm: 2, orientation: 0 },
      '1',
    )
    const html = renderToStaticMarkup(tree)
    expect(html).toContain('Проход снаружи, наружный порог и работа грузчиков не проверены')
    expect(html).toContain('Положение мебели по X/Y на участках квартиры фиксировано')
  })
  it.each(['', '0'])(
    'does not silently change an empty or zero room target: %s',
    (targetRoomId) => {
      const input = { ...deliveryFields, targetRoomId }
      vi.mocked(useState)
        .mockReturnValueOnce([true, vi.fn()])
        .mockReturnValueOnce([input, vi.fn()])
        .mockReturnValueOnce([undefined, vi.fn()])
        .mockReturnValueOnce([undefined, vi.fn()])
      const tree = PlanFurnitureStairCheck({ geometry: deliveryGeometry, profileFields })
      const html = renderToStaticMarkup(tree)
      expect(html).toContain(`<option value="${targetRoomId}" selected="">`)
      elements(tree)
        .find((item) => item.props.children === 'Проверить путь от стартовой двери')
        ?.props.onClick?.()
      expect(vi.mocked(inspectFurnitureDeliveryViaStairs).mock.calls[0]?.[3]).toBe(targetRoomId)
      expect(vi.mocked(inspectFurnitureDeliveryViaStairs).mock.calls[0]?.[1]).toMatchObject({
        acknowledged: false,
      })
    },
  )
  it('revokes both confirmation and proof after changing the target', () => {
    const setAck = vi.fn()
    const setChecked = vi.fn()
    vi.mocked(useState)
      .mockReturnValueOnce([true, vi.fn()])
      .mockReturnValueOnce([deliveryFields, vi.fn()])
      .mockReturnValueOnce([deliveryKey, setAck])
      .mockReturnValueOnce([undefined, setChecked])
    const tree = PlanFurnitureStairCheck({ geometry: deliveryGeometry, profileFields })
    elements(tree)
      .find((item) => item.props.id === 'stair-stair-test-targetRoomId')
      ?.props.onChange?.({ currentTarget: { value: '0' } })
    expect(setAck).toHaveBeenCalledWith(undefined)
    expect(setChecked).toHaveBeenCalledWith(undefined)
  })
  it('renders the complete indoor polyline, explicit target and shared-work count', () => {
    vi.mocked(useState)
      .mockReturnValueOnce([true, vi.fn()])
      .mockReturnValueOnce([deliveryFields, vi.fn()])
      .mockReturnValueOnce([deliveryKey, vi.fn()])
      .mockReturnValueOnce([
        {
          key: deliveryKey,
          delivery: deliveryResponse,
          response: { notes: deliveryResponse.notes, result: stairResult },
        },
        vi.fn(),
      ])
    const html = renderToStaticMarkup(
      PlanFurnitureStairCheck({ geometry: deliveryGeometry, profileFields }),
    )
    expect(html).toContain('Единый внутренний путь построен')
    expect(html).toContain('Цель: Верхняя комната')
    expect(html).toContain('42 из общего бюджета 6000')
    expect(html).toContain('Единый план внутреннего пути от стартовой двери через лестницу')
    expect(html).toContain('points="10,60 125,60 350,60 450,60"')
    expect(html).toContain('Наружный занос не проверен')
    expect(html).not.toContain('Локальный путь по поворотному маршу построен')
  })
  it('replaces an old local proof with the global failure instead of retaining a local success', () => {
    const setChecked = vi.fn()
    vi.mocked(inspectFurnitureDeliveryViaStairs).mockReturnValue({
      error: 'Нет пути от двери',
      notes: ['Наружный занос не проверен.'],
    })
    vi.mocked(useState)
      .mockReturnValueOnce([true, vi.fn()])
      .mockReturnValueOnce([deliveryFields, vi.fn()])
      .mockReturnValueOnce([deliveryKey, vi.fn()])
      .mockReturnValueOnce([
        { key: deliveryKey, response: { notes: [], result: stairResult } },
        setChecked,
      ])
    const tree = PlanFurnitureStairCheck({ geometry: deliveryGeometry, profileFields })
    elements(tree)
      .find((item) => item.props.children === 'Проверить путь от стартовой двери')
      ?.props.onClick?.()
    const replacement = setChecked.mock.calls[0]?.[0]
    expect(replacement.response.result).toBeUndefined()
    vi.mocked(useState)
      .mockReturnValueOnce([true, vi.fn()])
      .mockReturnValueOnce([deliveryFields, vi.fn()])
      .mockReturnValueOnce([deliveryKey, vi.fn()])
      .mockReturnValueOnce([replacement, vi.fn()])
    const html = renderToStaticMarkup(
      PlanFurnitureStairCheck({ geometry: deliveryGeometry, profileFields }),
    )
    expect(html).toContain('Нет пути от двери')
    expect(html).not.toContain('Локальный путь по поворотному маршу построен')
    expect(html).not.toContain('Единый внутренний путь построен')
  })
  it('keeps straight mode as the default and turning coordinates absent until enabled', () => {
    const html = renderToStaticMarkup(expanded())
    expect(html).toContain('Задать поворотный марш по обмеренным участкам')
    expect(html).toContain('Начало нижней площадки по оси марша')
    expect(html).not.toContain('Левая граница X')
  })
  it('sends only surveyed version 2 rectangles in lower-to-upper order, including signed decimal coordinates', () => {
    const tree = expanded(turningFields)
    const html = renderToStaticMarkup(tree)
    expect(html).toContain('Первый и последний участки — площадки')
    expect(html).toContain('Не более 128 участков')
    expect(html).not.toContain('Начало нижней площадки по оси марша')
    expect(html).not.toContain('Добавить ступень')
    elements(tree)
      .find((item) => item.props.children === 'Проверить марш')
      ?.props.onClick?.()
    const survey = vi.mocked(inspectFurnitureStairTransfer).mock.calls[0]?.[1]
    expect(survey).toMatchObject({
      version: 2,
      acknowledged: true,
      carryClearanceCm: 5,
      angleDeg: 30.5,
      layout: [
        {
          kind: 'landing',
          polygon: [
            { xCm: -10.5, yCm: 0 },
            { xCm: 200, yCm: 0 },
            { xCm: 200, yCm: 120 },
            { xCm: -10.5, yCm: 120 },
          ],
          elevationCm: 0,
          ceilingElevationCm: 350,
        },
        { kind: 'tread', elevationCm: 18, ceilingElevationCm: 368 },
        { kind: 'landing', elevationCm: 18, ceilingElevationCm: 368 },
      ],
    })
    for (const field of [
      'direction',
      'startCm',
      'crossStartCm',
      'widthCm',
      'treads',
      'lowerLandingCeilingCm',
      'upperLandingCeilingCm',
    ]) {
      expect(survey).not.toHaveProperty(field)
    }
  })
  it.each(['', '0x20', '1e2'])(
    'never guesses missing or non-decimal turning coordinates: %s',
    (value) => {
      const input = {
        ...turningFields,
        layout: turningFields.layout.map((section, index) =>
          index === 0 ? { ...section, leftCm: value, ceilingElevationCm: '' } : section,
        ),
      }
      elements(expanded(input))
        .find((item) => item.props.children === 'Проверить марш')
        ?.props.onClick?.()
      expect(vi.mocked(inspectFurnitureStairTransfer).mock.calls[0]?.[1]).toMatchObject({
        layout: [
          expect.objectContaining({
            polygon: [
              expect.objectContaining({ xCm: Number.NaN }),
              expect.anything(),
              expect.anything(),
              expect.objectContaining({ xCm: Number.NaN }),
            ],
            ceilingElevationCm: Number.NaN,
          }),
          expect.anything(),
          expect.anything(),
        ],
      })
    },
  )
  it.each(['turning', 'layout-0-kind', 'layout-1-leftCm', 'layout-2-ceilingElevationCm'])(
    'revokes acknowledgement and results for turning edit %s',
    (control) => {
      const setAck = vi.fn()
      const setChecked = vi.fn()
      vi.mocked(useState)
        .mockReturnValueOnce([true, vi.fn()])
        .mockReturnValueOnce([turningFields, vi.fn()])
        .mockReturnValueOnce(['old-key', setAck])
        .mockReturnValueOnce([undefined, setChecked])
      const tree = PlanFurnitureStairCheck({ geometry, profileFields })
      elements(tree)
        .find((item) => item.props.id === `stair-stair-test-${control}`)
        ?.props.onChange?.({ currentTarget: { value: '30', checked: false } })
      expect(setAck).toHaveBeenCalledWith(undefined)
      expect(setChecked).toHaveBeenCalledWith(undefined)
    },
  )
  it('initializes turning sections without invented measurements', () => {
    const setter = vi.fn()
    let call = 0
    let captured: typeof turningFields | undefined
    vi.mocked(useState).mockImplementation((initial?: unknown): ReturnType<typeof useState> => {
      call += 1
      if (call === 2) captured = initial as typeof turningFields
      return [call === 1 ? true : initial, setter]
    })
    const tree = PlanFurnitureStairCheck({ geometry, profileFields })
    expect(captured?.turning).toBe(false)
    expect(captured?.layout).toHaveLength(2)
    for (const section of captured?.layout ?? []) {
      expect(section.kind).toBe('landing')
      for (const field of [
        'leftCm',
        'topCm',
        'rightCm',
        'bottomCm',
        'elevationCm',
        'ceilingElevationCm',
      ] as const)
        expect(section[field]).toBe('')
    }
    expect(renderToStaticMarkup(tree)).not.toContain('Левая граница X')
  })
  it('starts collapsed without guessed stair measurements or a submitting form', () => {
    const html = renderToStaticMarkup(
      createElement(PlanFurnitureStairCheck, { geometry, profileFields }),
    )
    expect(html).toContain('Проверить измеренный лестничный марш')
    expect(html).not.toContain('<input')
    expect(html).not.toContain('<form')
    expect(html).toContain('aria-expanded="false"')
  })
  it('explains the separate local survey, absolute ceilings and no removal of recorded voids', () => {
    const html = renderToStaticMarkup(expanded())
    expect(html).toContain('Это не путь от входной двери')
    expect(html).toContain('не автоматически распознанная лестница')
    expect(html).toContain('с учётом перил')
    expect(html).toContain('потолок над всей её шириной и глубиной')
    expect(html).toContain('не локальная высота подступёнка')
    expect(html).toContain('пустоты и препятствия не удаляются')
  })
  it('sends explicit decimal survey, current geometry and selected tilt without ceiling defaults', () => {
    const node = elements(expanded()).find((item) => item.props.children === 'Проверить марш')
    node?.props.onClick?.()
    expect(inspectFurnitureStairTransfer).toHaveBeenCalledWith(
      geometry,
      expect.objectContaining({
        geometryKey: JSON.stringify(geometry),
        referenceKey: '',
        direction: 'x',
        carryClearanceCm: 5,
        angleDeg: 30.5,
        lowerLandingCeilingCm: undefined,
        upperLandingCeilingCm: undefined,
        treads: [{ runCm: 28, elevationCm: 18, ceilingElevationCm: 360 }],
        acknowledged: true,
      }),
      { widthCm: 55, depthCm: 65, heightCm: 170, clearanceCm: 2, orientation: 0 },
    )
  })
  it.each(['', '0x20', '1e2'])(
    'does not reinterpret an invalid coordinate as a measurement: %s',
    (startCm) => {
      const node = elements(expanded({ ...fields, startCm })).find(
        (item) => item.props.children === 'Проверить марш',
      )
      node?.props.onClick?.()
      expect(vi.mocked(inspectFurnitureStairTransfer).mock.calls[0]?.[1]).toMatchObject({
        startCm: Number.NaN,
      })
    },
  )
  it('passes an absent acknowledgement as false, never implicitly approves a survey', () => {
    const node = elements(expanded(fields, false)).find(
      (item) => item.props.children === 'Проверить марш',
    )
    node?.props.onClick?.()
    expect(vi.mocked(inspectFurnitureStairTransfer).mock.calls[0]?.[1]).toMatchObject({
      acknowledged: false,
    })
  })
  it.each(['widthCm', 'travelDirection', 'step-0-ceilingElevationCm', 'angleDeg'])(
    'revokes confirmation and stale results after editing %s',
    (control) => {
      const setAck = vi.fn()
      const setChecked = vi.fn()
      vi.mocked(useState)
        .mockReturnValueOnce([true, vi.fn()])
        .mockReturnValueOnce([fields, vi.fn()])
        .mockReturnValueOnce([key, setAck])
        .mockReturnValueOnce([undefined, setChecked])
      const node = elements(PlanFurnitureStairCheck({ geometry, profileFields })).find(
        (item) => item.props.id === `stair-stair-test-${control}`,
      )
      expect(node).toBeDefined()
      node?.props.onChange?.({ currentTarget: { value: '35' } })
      expect(setAck).toHaveBeenCalledWith(undefined)
      expect(setChecked).toHaveBeenCalledWith(undefined)
    },
  )
  it('hides a result after the outer furniture profile changes', () => {
    vi.mocked(useState)
      .mockReturnValueOnce([true, vi.fn()])
      .mockReturnValueOnce([fields, vi.fn()])
      .mockReturnValueOnce([key, vi.fn()])
      .mockReturnValueOnce([{ key, response: { error: 'OLD RESULT', notes: [] } }, vi.fn()])
    const html = renderToStaticMarkup(
      PlanFurnitureStairCheck({ geometry, profileFields: { ...profileFields, widthCm: '60' } }),
    )
    expect(html).not.toContain('OLD RESULT')
    expect(html).not.toContain('checked=""')
  })
  it('shows measured variable-height stages without turning them into a delivery guarantee', () => {
    const response: ReturnType<typeof inspectFurnitureStairTransfer> = {
      notes: ['Не гарантия доставки.'],
      result: {
        referenceId: 'survey',
        travelDirection: 'down',
        tilt: 'depth',
        angleDeg: 30.5,
        carried: { widthCm: 59, depthCm: 115, heightCm: 168 },
        sweepHeightCm: 190,
        regions: [
          {
            kind: 'landing',
            index: 0,
            polygon: [
              { xCm: 0, yCm: 0 },
              { xCm: 250, yCm: 0 },
              { xCm: 250, yCm: 120 },
              { xCm: 0, yCm: 120 },
            ],
            elevationCm: 0,
            ceilingElevationCm: 360,
          },
          {
            kind: 'landing',
            index: 1,
            polygon: [
              { xCm: 530, yCm: 0 },
              { xCm: 780, yCm: 0 },
              { xCm: 780, yCm: 120 },
              { xCm: 530, yCm: 120 },
            ],
            elevationCm: 198,
            ceilingElevationCm: 558,
          },
        ],
        points: [
          { xCm: 655, yCm: 60, zCm: 198 },
          { xCm: 655, yCm: 60, zCm: 203 },
          { xCm: 125, yCm: 60, zCm: 203 },
          { xCm: 125, yCm: 60, zCm: 0 },
        ],
        stages: [
          {
            kind: 'lower',
            from: { xCm: 125, yCm: 60, zCm: 203 },
            to: { xCm: 125, yCm: 60, zCm: 0 },
            bounds: {
              leftCm: 90,
              topCm: 10,
              rightCm: 160,
              bottomCm: 110,
              bottomElevationCm: 0,
              topElevationCm: 371,
            },
          },
        ],
      },
    }
    const html = renderToStaticMarkup(expanded(fields, true, response))
    expect(html).toContain('Локальный путь по прямому маршу построен: спуск')
    expect(html).toContain('наклон 30.5°')
    expect(html).toContain('Высотный профиль измеренного марша')
    expect(html).toContain('не центра мебели')
    expect(html).toContain('203 →')
    expect(html).toContain('Не гарантия доставки')
    const turningHtml = renderToStaticMarkup(expanded(turningFields, true, response))
    expect(turningHtml).toContain('План измеренных участков поворотной лестницы')
    expect(turningHtml).not.toContain('Высотный профиль измеренного марша')
    expect(turningHtml).toContain('Поворот пути не означает вращение мебели')
    expect(turningHtml).toContain('203 →')
  })
})
