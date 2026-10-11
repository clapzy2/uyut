import type { PlanGeometry } from '@uyut/db'
import { createElement, isValidElement, type ReactElement, type ReactNode, useState } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { beforeEach, describe, expect, it, vi } from 'vitest'
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
})
function expanded(
  input = fields,
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
  })
})
