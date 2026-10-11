import type { PlanGeometry } from '@uyut/db'
import { createElement, isValidElement, type ReactElement, type ReactNode, useState } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { inspectFurnitureTransfer } from '@/lib/projects/plan-furniture-transfer'
import { PlanFurnitureTransferCheck } from './plan-furniture-transfer-check'

vi.mock('react', async (original) => ({
  ...(await original<typeof import('react')>()),
  useState: vi.fn(),
  useId: () => 'transfer-test',
  useMemo: (compute: () => unknown) => compute(),
}))
vi.mock('@/lib/projects/plan-furniture-transfer', () => ({ inspectFurnitureTransfer: vi.fn() }))

const geometry: PlanGeometry = {
  version: 1,
  status: 'draft',
  widthCm: 400,
  heightCm: 300,
  warnings: [],
  walls: [],
  openings: [],
  rooms: [
    {
      name: 'Комната',
      polygon: [
        { xCm: 0, yCm: 0 },
        { xCm: 400, yCm: 0 },
        { xCm: 400, yCm: 300 },
        { xCm: 0, yCm: 300 },
      ],
    },
  ],
}
const fields = {
  widthCm: '60',
  depthCm: '40',
  heightCm: '100',
  clearanceCm: '1',
  orientation: '0',
  allowTurns: false,
}
const key = `${JSON.stringify(geometry)}:${JSON.stringify(fields)}`
const response: ReturnType<typeof inspectFurnitureTransfer> = {
  notes: ['Неизвестная высота проёма требует обмера.'],
  inspection: {
    missing: undefined,
    result: {
      widthCm: 62,
      stepCm: 10,
      footprint: 'axis-aligned-rectangle',
      footprintCm: { widthCm: 62, depthCm: 42 },
      status: 'constructive-routes',
      reason: undefined,
      checkedNodes: 1,
      unresolvedRoomIds: [],
      routes: [
        {
          roomId: '0',
          points: [
            { xCm: 90, yCm: 90 },
            { xCm: 100, yCm: 90 },
          ],
        },
      ],
    },
  },
}

beforeEach(() => {
  vi.mocked(useState).mockImplementation(
    (initial?: unknown): ReturnType<typeof useState> => [
      typeof initial === 'function' ? initial() : initial,
      vi.fn(),
    ],
  )
  vi.mocked(inspectFurnitureTransfer).mockReturnValue({ error: 'Сверьте мерки', notes: [] })
})
afterEach(() => vi.resetAllMocks())

type NodeProps = {
  children?: ReactNode
  onClick?: () => void
  onChange?: (event: { currentTarget: { value?: string; checked?: boolean } }) => void
  type?: string
  value?: string
  id?: string
}
function elements(node: ReactNode): ReactElement<NodeProps>[] {
  if (Array.isArray(node)) return node.flatMap(elements)
  if (!isValidElement<NodeProps>(node)) return []
  return [node, ...elements(node.props.children)]
}

describe('rigid furniture transfer UI', () => {
  it('starts blank and unacknowledged, has explicit orientation and no nested submitting form', () => {
    const html = renderToStaticMarkup(createElement(PlanFurnitureTransferCheck, { geometry }))
    expect(html.match(/inputMode="decimal"/g)).toHaveLength(4)
    expect(html.match(/value=""/g)).toHaveLength(4)
    expect(html).not.toContain('checked=""')
    expect(html).toContain('Разрешить повороты на месте на 90°')
    expect(html).toContain('в фиксированном положении')
    expect(html).not.toContain('<form')
    expect(html).toContain('type="button"')
    expect(html).toContain('90°: глубина по X, ширина по Y')
    expect(html).toContain('Пустое поле означает неизвестное значение, а не ноль')
    expect(html).toContain('по высоте - только над предметом')
    expect(html).toContain('Другая подвижная мебель не учтена')
    expect(html).toContain('упаковки')
    expect(html).toContain('внешний вход')
    expect(html).toContain('масса предмета')
    expect(html).toContain('не подтверждает физический перенос мебели')
  })

  it('shows only fixed-axis candidate routes with the rectangular footprint, not a green promise', () => {
    vi.mocked(useState)
      .mockReturnValueOnce([fields, vi.fn()])
      .mockReturnValueOnce([key, vi.fn()])
      .mockReturnValueOnce([{ key, result: response }, vi.fn()])
    const html = renderToStaticMarkup(createElement(PlanFurnitureTransferCheck, { geometry }))
    expect(html).toContain('Найденные горизонтальные пути габарита: 1 из 1')
    expect(html).toContain('62 × 42 см')
    expect(html).toContain('width="62" height="42"')
    expect(html).toContain('<polyline')
    expect(html).toContain('stroke="var(--accent)"')
    expect(html).not.toContain('#247752')
    expect(html).not.toContain('можно занести')
    expect(html).toContain('Неизвестная высота проёма требует обмера')
  })

  it('prints the upright base and clearance envelope in the common negative datum', () => {
    const measured = structuredClone(response)
    measured.profile = {
      widthCm: 60,
      depthCm: 40,
      heightCm: 100,
      clearanceCm: 1,
      orientation: 0,
      allowTurns: false,
      acknowledged: true,
    }
    if (!measured.inspection?.result) throw new Error('Missing seeded transfer result')
    measured.inspection.result.vertical = {
      referenceId: 'datum',
      elevationCm: -15,
      heldTransitions: [],
    }
    vi.mocked(useState)
      .mockReturnValueOnce([fields, vi.fn()])
      .mockReturnValueOnce([key, vi.fn()])
      .mockReturnValueOnce([{ key, result: measured }, vi.fn()])
    const html = renderToStaticMarkup(createElement(PlanFurnitureTransferCheck, { geometry }))
    expect(html).toContain('Основание на отметке -15 см')
    expect(html).toMatch(/верх габарита с запасом над ним\s+86 см/)
    expect(html).toContain('Что учитывает расчёт')
  })

  it.each(['geometry', 'profile', 'turn-mode'] as const)(
    'hides checked paths and acknowledgement after changing %s',
    (change) => {
      vi.mocked(useState)
        .mockReturnValueOnce([
          change === 'profile'
            ? { ...fields, widthCm: '61' }
            : change === 'turn-mode'
              ? { ...fields, allowTurns: true }
              : fields,
          vi.fn(),
        ])
        .mockReturnValueOnce([key, vi.fn()])
        .mockReturnValueOnce([{ key, result: response }, vi.fn()])
      const html = renderToStaticMarkup(
        createElement(PlanFurnitureTransferCheck, {
          geometry: change === 'geometry' ? { ...geometry, widthCm: 401 } : geometry,
        }),
      )
      expect(html).toContain('Прежние пути скрыты')
      expect(html).not.toContain('<polyline')
      expect(html).not.toMatch(/id="transfer-test-acknowledged"[^>]*checked/u)
    },
  )

  it('passes unknown blanks as undefined and requires a separately acknowledged profile', () => {
    const nodes = elements(PlanFurnitureTransferCheck({ geometry }))
    const button = nodes.find((node) => node.props.onClick)
    if (!button?.props.onClick) throw new Error('Missing check button')
    button.props.onClick()
    expect(inspectFurnitureTransfer).toHaveBeenCalledWith(geometry, {
      widthCm: undefined,
      depthCm: undefined,
      heightCm: undefined,
      clearanceCm: undefined,
      orientation: 0,
      allowTurns: false,
      acknowledged: false,
    })
  })

  it.each(['0x10', '1e2', '6 0', 'Infinity', '--1'])(
    'does not reinterpret %s as a decimal measurement',
    (value) => {
      vi.mocked(useState).mockReturnValueOnce([{ ...fields, widthCm: value }, vi.fn()])
      const button = elements(PlanFurnitureTransferCheck({ geometry })).find(
        (node) => node.props.onClick,
      )
      if (!button?.props.onClick) throw new Error('Missing check button')
      button.props.onClick()
      expect(inspectFurnitureTransfer).toHaveBeenCalledWith(
        geometry,
        expect.objectContaining({ widthCm: Number.NaN }),
      )
    },
  )

  it.each([
    ['60,5', 60.5],
    ['+60.5', 60.5],
    ['.5', 0.5],
  ] as const)('accepts ordinary decimal input %s', (value, expected) => {
    vi.mocked(useState).mockReturnValueOnce([{ ...fields, widthCm: value }, vi.fn()])
    const button = elements(PlanFurnitureTransferCheck({ geometry })).find(
      (node) => node.props.onClick,
    )
    if (!button?.props.onClick) throw new Error('Missing check button')
    button.props.onClick()
    expect(inspectFurnitureTransfer).toHaveBeenCalledWith(
      geometry,
      expect.objectContaining({ widthCm: expected }),
    )
  })

  it('shows the fixed obstacles that constrain a displayed path', () => {
    const withObstacle: PlanGeometry = {
      ...geometry,
      obstacles: [{ id: 'fixed', kind: 'fixed', xCm: 120, yCm: 80, widthCm: 45, depthCm: 60 }],
    }
    const currentKey = `${JSON.stringify(withObstacle)}:${JSON.stringify(fields)}`
    vi.mocked(useState)
      .mockReturnValueOnce([fields, vi.fn()])
      .mockReturnValueOnce([currentKey, vi.fn()])
      .mockReturnValueOnce([{ key: currentKey, result: response }, vi.fn()])
    const html = renderToStaticMarkup(
      createElement(PlanFurnitureTransferCheck, { geometry: withObstacle }),
    )
    expect(html).toContain('x="120" y="80" width="45" height="60"')
    expect(html).toContain('Неподвижный объект или кухонный модуль')
  })

  it('clears previous confirmation and results when a dimension changes or the acknowledgement is withdrawn', () => {
    const setFields = vi.fn()
    const setAcknowledged = vi.fn()
    const setChecked = vi.fn()
    vi.mocked(useState)
      .mockReturnValueOnce([fields, setFields])
      .mockReturnValueOnce([key, setAcknowledged])
      .mockReturnValueOnce([{ key, result: response }, setChecked])
    const nodes = elements(PlanFurnitureTransferCheck({ geometry }))
    const width = nodes.find(
      (node) => node.props.id === 'transfer-test-widthCm' && node.props.onChange,
    )
    const checkbox = nodes.find((node) => node.props.id === 'transfer-test-acknowledged')
    if (!width?.props.onChange || !checkbox?.props.onChange) throw new Error('Missing input')
    width.props.onChange({ currentTarget: { value: '65' } })
    expect(setFields).toHaveBeenCalled()
    expect(setAcknowledged).toHaveBeenCalledWith(undefined)
    expect(setChecked).toHaveBeenCalledWith(undefined)
    checkbox.props.onChange({ currentTarget: { checked: false } })
    expect(setChecked).toHaveBeenCalledTimes(2)
  })

  it('includes the optional turn policy in the acknowledged profile and resets acknowledgement after a mode edit', () => {
    const turningFields = { ...fields, allowTurns: true }
    const turningKey = `${JSON.stringify(geometry)}:${JSON.stringify(turningFields)}`
    const setAcknowledged = vi.fn()
    const setChecked = vi.fn()
    vi.mocked(useState)
      .mockReturnValueOnce([turningFields, vi.fn()])
      .mockReturnValueOnce([turningKey, setAcknowledged])
      .mockReturnValueOnce([undefined, setChecked])
    const nodes = elements(PlanFurnitureTransferCheck({ geometry }))
    const button = nodes.find((node) => node.props.onClick)
    const mode = nodes.find((node) => node.props.id === 'transfer-test-allow-turns')
    if (!button?.props.onClick || !mode?.props.onChange) throw new Error('Missing turn controls')
    button.props.onClick()
    expect(inspectFurnitureTransfer).toHaveBeenCalledWith(
      geometry,
      expect.objectContaining({ allowTurns: true, acknowledged: true }),
    )
    mode.props.onChange({ currentTarget: { checked: false } })
    expect(setAcknowledged).toHaveBeenCalledWith(undefined)
    expect(setChecked).toHaveBeenLastCalledWith(undefined)
  })

  it('shows only real same-center quarter-turn witnesses and their supplied sweep square', () => {
    const turningFields = { ...fields, allowTurns: true }
    const turningKey = `${JSON.stringify(geometry)}:${JSON.stringify(turningFields)}`
    const measured = structuredClone(response)
    if (!measured.inspection?.result) throw new Error('Missing seeded transfer result')
    measured.inspection.result.turnPolicy = 'conservative-square'
    measured.inspection.result.turnSweepCm = 75
    measured.inspection.result.routes = [
      {
        roomId: '0',
        points: [
          { xCm: 90, yCm: 90, orientation: 0 },
          { xCm: 90, yCm: 90, orientation: 90 },
          { xCm: 120, yCm: 90, orientation: 90 },
        ],
      },
    ]
    vi.mocked(useState)
      .mockReturnValueOnce([turningFields, vi.fn()])
      .mockReturnValueOnce([turningKey, vi.fn()])
      .mockReturnValueOnce([{ key: turningKey, result: measured }, vi.fn()])
    const html = renderToStaticMarkup(createElement(PlanFurnitureTransferCheck, { geometry }))
    expect(html).toContain('консервативного квадрата')
    expect(html).toContain('data-transfer-turn="1"')
    expect(html).not.toContain('data-transfer-turn="2"')
    expect(html).toContain('Поворот 1: 0° → 90°')
    expect(html).toContain('x="52.5" y="52.5" width="75" height="75"')
    expect(html).toContain('Номера отмечают найденные повороты на месте: 1')
    expect(html).not.toContain('Положение не меняется вдоль пути')
    expect(html).not.toContain('<animate')
    expect(html).toContain('не подтверждает физический перенос мебели')
  })

  it('does not invent an in-place turn when only movement or an orientation change between different centers is supplied', () => {
    const turningFields = { ...fields, allowTurns: true }
    const turningKey = `${JSON.stringify(geometry)}:${JSON.stringify(turningFields)}`
    const measured = structuredClone(response)
    if (!measured.inspection?.result) throw new Error('Missing seeded transfer result')
    measured.inspection.result.turnPolicy = 'conservative-square'
    measured.inspection.result.turnSweepCm = 75
    measured.inspection.result.routes = [
      {
        roomId: '0',
        points: [
          { xCm: 90, yCm: 90, orientation: 0 },
          { xCm: 100, yCm: 90, orientation: 90 },
        ],
      },
    ]
    vi.mocked(useState)
      .mockReturnValueOnce([turningFields, vi.fn()])
      .mockReturnValueOnce([turningKey, vi.fn()])
      .mockReturnValueOnce([{ key: turningKey, result: measured }, vi.fn()])
    const html = renderToStaticMarkup(createElement(PlanFurnitureTransferCheck, { geometry }))
    expect(html).not.toContain('data-transfer-turn=')
    expect(html).toContain('Номера отмечают найденные повороты на месте: 0')
  })

  it('starts the optional lift mode with an unknown carry datum and no implicit tilt', () => {
    vi.mocked(useState).mockReturnValueOnce([
      { ...fields, allowManeuver: true, carryElevationCm: '', tilt: 'none' },
      vi.fn(),
    ])
    const nodes = elements(PlanFurnitureTransferCheck({ geometry }))
    const elevation = nodes.find((node) => node.props.id === 'transfer-test-carry-elevation')
    const tilt = nodes.find((node) => node.props.id === 'transfer-test-tilt')
    expect(elevation?.props.value).toBe('')
    expect(tilt?.props.value).toBe('none')
    nodes.find((node) => node.props.onClick)?.props.onClick?.()
    expect(inspectFurnitureTransfer).toHaveBeenCalledWith(
      geometry,
      expect.objectContaining({ maneuver: { carryElevationCm: undefined, tilt: 'none' } }),
    )
  })

  it.each(['width', 'depth'])(
    'explains the stronger three-axis reserve for the %s tilt before rotation',
    (tilt) => {
      vi.mocked(useState).mockReturnValueOnce([
        { ...fields, allowManeuver: true, carryElevationCm: '20', tilt },
        vi.fn(),
      ])
      const html = renderToStaticMarkup(createElement(PlanFurnitureTransferCheck, { geometry }))
      expect(html).toContain('каждый из трёх размеров заранее увеличивается на два запаса')
      expect(html).toContain('исходная высота становится горизонтальным размером')
      expect(html).toContain('весь двойной запас располагается над основанием')
      expect(html).not.toContain('по высоте - только над предметом')
    },
  )

  it('keeps the above-only height reserve for upright lifting without tilt', () => {
    vi.mocked(useState).mockReturnValueOnce([
      { ...fields, allowManeuver: true, carryElevationCm: '20', tilt: 'none' },
      vi.fn(),
    ])
    const html = renderToStaticMarkup(createElement(PlanFurnitureTransferCheck, { geometry }))
    expect(html).toContain('по высоте - только над предметом')
    expect(html).not.toContain('каждый из трёх размеров заранее увеличивается на два запаса')
  })

  it('shows a deliberate 90-degree initial angle only after selecting a tilt axis', () => {
    vi.mocked(useState).mockReturnValueOnce([
      { ...fields, allowManeuver: true, carryElevationCm: '20', tilt: 'depth', angleDeg: '90' },
      vi.fn(),
    ])
    const html = renderToStaticMarkup(createElement(PlanFurnitureTransferCheck, { geometry }))
    expect(html).toContain('Угол наклона, °')
    expect(html).toContain('id="transfer-test-angle"')
    expect(html).toContain('value="90"')
    expect(html).toContain('на всех углах от 0° до выбранного значения')
    expect(html).toMatch(/охватывающая зона полного\s+поворота на 90°/)
    expect(html).toMatch(/может отклонить\s+физически возможный/)
    expect(html).not.toContain('Произвольные углы наклона не проверяются')
  })

  it.each([
    ['35,5', 35.5],
    ['.5', 0.5],
    ['0', 0],
    ['90', 90],
    ['-1', -1],
    ['91', 91],
    ['', Number.NaN],
    ['   ', Number.NaN],
    ['1e1', Number.NaN],
    ['0x10', Number.NaN],
  ])(
    'passes explicit tilt angle %s for validation without restoring an empty value to 90',
    (value, expected) => {
      vi.mocked(useState).mockReturnValueOnce([
        { ...fields, allowManeuver: true, carryElevationCm: '20', tilt: 'width', angleDeg: value },
        vi.fn(),
      ])
      elements(PlanFurnitureTransferCheck({ geometry }))
        .find((node) => node.props.onClick)
        ?.props.onClick?.()
      expect(inspectFurnitureTransfer).toHaveBeenCalledWith(
        geometry,
        expect.objectContaining({
          maneuver: { carryElevationCm: 20, tilt: 'width', angleDeg: expected },
        }),
      )
    },
  )

  it('uses only the above-height reserve for a selected axis at exactly zero degrees', () => {
    vi.mocked(useState).mockReturnValueOnce([
      { ...fields, allowManeuver: true, carryElevationCm: '20', tilt: 'width', angleDeg: '0' },
      vi.fn(),
    ])
    const html = renderToStaticMarkup(createElement(PlanFurnitureTransferCheck, { geometry }))
    expect(html).toContain('по высоте - только над предметом')
    expect(html).not.toContain('каждый из трёх размеров заранее увеличивается на два запаса')
  })

  it('revokes acknowledgement and checked routes when the entered angle changes', () => {
    const carryingFields = {
      ...fields,
      allowManeuver: true,
      carryElevationCm: '20',
      tilt: 'width',
      angleDeg: '35,5',
    }
    const carryingKey = `${JSON.stringify(geometry)}:${JSON.stringify(carryingFields)}`
    const setAcknowledged = vi.fn()
    const setChecked = vi.fn()
    vi.mocked(useState)
      .mockReturnValueOnce([carryingFields, vi.fn()])
      .mockReturnValueOnce([carryingKey, setAcknowledged])
      .mockReturnValueOnce([{ key: carryingKey, result: response }, setChecked])
    elements(PlanFurnitureTransferCheck({ geometry }))
      .find((node) => node.props.id === 'transfer-test-angle')
      ?.props.onChange?.({ currentTarget: { value: '40' } })
    expect(setAcknowledged).toHaveBeenCalledWith(undefined)
    expect(setChecked).toHaveBeenCalledWith(undefined)
  })

  it.each([
    ['-15,5', -15.5],
    ['+0.5', 0.5],
    ['0', 0],
    ['1e2', Number.NaN],
    ['0x10', Number.NaN],
    ['Infinity', Number.NaN],
  ])('passes the explicit signed common carry datum %s without guessing', (value, expected) => {
    const carryingFields = {
      ...fields,
      allowManeuver: true,
      carryElevationCm: value,
      tilt: 'width',
    }
    const carryingKey = `${JSON.stringify(geometry)}:${JSON.stringify(carryingFields)}`
    vi.mocked(useState)
      .mockReturnValueOnce([carryingFields, vi.fn()])
      .mockReturnValueOnce([carryingKey, vi.fn()])
    elements(PlanFurnitureTransferCheck({ geometry }))
      .find((node) => node.props.onClick)
      ?.props.onClick?.()
    expect(inspectFurnitureTransfer).toHaveBeenCalledWith(
      geometry,
      expect.objectContaining({
        maneuver: { carryElevationCm: expected, tilt: 'width', angleDeg: 90 },
        acknowledged: true,
      }),
    )
  })

  it.each(['allow-maneuver', 'carry-elevation', 'tilt'])(
    'revokes acknowledgement and hides previous routes after editing %s',
    (control) => {
      const carryingFields = {
        ...fields,
        allowManeuver: true,
        carryElevationCm: '20',
        tilt: 'none',
      }
      const carryingKey = `${JSON.stringify(geometry)}:${JSON.stringify(carryingFields)}`
      const setAcknowledged = vi.fn()
      const setChecked = vi.fn()
      vi.mocked(useState)
        .mockReturnValueOnce([carryingFields, vi.fn()])
        .mockReturnValueOnce([carryingKey, setAcknowledged])
        .mockReturnValueOnce([{ key: carryingKey, result: response }, setChecked])
      const node = elements(PlanFurnitureTransferCheck({ geometry })).find(
        (item) => item.props.id === `transfer-test-${control}`,
      )
      expect(node?.props.onChange).toBeDefined()
      node?.props.onChange?.({ currentTarget: { checked: false, value: 'depth' } })
      expect(setAcknowledged).toHaveBeenCalledWith(undefined)
      expect(setChecked).toHaveBeenCalledWith(undefined)
    },
  )

  it.each([undefined, 35.5])(
    'prints actual angle %s, carried height and endpoint lifting without promising delivery',
    (angleDeg) => {
      const carryingFields = {
        ...fields,
        allowManeuver: true,
        carryElevationCm: '-5',
        tilt: 'width',
      }
      const carryingKey = `${JSON.stringify(geometry)}:${JSON.stringify(carryingFields)}`
      const measured = structuredClone(response)
      measured.profile = {
        widthCm: 60,
        depthCm: 40,
        heightCm: 100,
        clearanceCm: 1,
        orientation: 0,
        acknowledged: true,
      }
      measured.maneuver = {
        carryElevationCm: -5,
        tilt: 'width',
        ...(angleDeg === undefined ? {} : { angleDeg }),
        carriedHeightCm: 62,
        sweepHeightCm: 119,
        stages: [
          {
            roomId: '0',
            startFloorElevationCm: -15,
            endFloorElevationCm: -10,
            liftCm: 10,
            lowerCm: 5,
          },
        ],
      }
      if (!measured.inspection?.result) throw new Error('Missing seeded transfer result')
      measured.inspection.result.vertical = {
        referenceId: 'datum',
        elevationCm: -5,
        heldTransitions: [],
      }
      vi.mocked(useState)
        .mockReturnValueOnce([carryingFields, vi.fn()])
        .mockReturnValueOnce([carryingKey, vi.fn()])
        .mockReturnValueOnce([{ key: carryingKey, result: measured }, vi.fn()])
      const html = renderToStaticMarkup(createElement(PlanFurnitureTransferCheck, { geometry }))
      expect(html).toMatch(/верх габарита с запасом над ним\s+57 см/)
      expect(html).toContain('подъём 10 см, опускание 5 см')
      expect(html).toContain('пол в начале -15 см, пол в конце -10 см')
      expect(html).toContain('высота зоны манёвра 119 см')
      expect(html).toContain(`Наклон в сечении ширина/высота: ${angleDeg ?? 90}°`)
      expect(html).toContain('Это не проверка движения по лестничному маршу')
      expect(html).toContain('не гарантия доставки')
      expect(html).not.toContain('Это положение без подъёма и наклона')
      expect(html).not.toContain('Наклон, подъём, лестницы, внешний вход')
    },
  )
})
