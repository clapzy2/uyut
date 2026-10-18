import type { PlanImageCalibration } from '@uyut/db'
import type { ReactElement } from 'react'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const hooks = vi.hoisted(() => ({
  cursor: 0,
  values: new Map<number, unknown>(),
  updates: new Map<number, unknown>(),
}))

vi.mock('react', async (importOriginal) => ({
  ...(await importOriginal<typeof import('react')>()),
  useState: (initial: unknown) => {
    const index = hooks.cursor++
    return [
      hooks.values.has(index) ? hooks.values.get(index) : initial,
      (value: unknown) => {
        hooks.updates.set(index, value)
      },
    ]
  },
  useRef: (initial: unknown) => ({ current: initial }),
  useEffect: () => undefined,
}))

import { PlanImageContourTrace } from './plan-image-contour-trace'

const calibration: PlanImageCalibration = {
  imageWidthPx: 1000,
  imageHeightPx: 800,
  pixelStart: { x: 100, y: 100 },
  pixelEnd: { x: 300, y: 100 },
  worldStart: { xCm: 100, yCm: 100 },
  lengthCm: 200,
  direction: 'right',
  verificationLines: [
    { pixelStart: { x: 100, y: 100 }, pixelEnd: { x: 100, y: 300 }, lengthCm: 200 },
  ],
}

const region = {
  id: 'region-1',
  polygon: [
    { x: 300, y: 300 },
    { x: 500, y: 300 },
    { x: 480, y: 480 },
    { x: 300, y: 450 },
  ],
  hasInteriorIslands: true,
}

function findAction(
  node: unknown,
  label: string,
): ReactElement<{ onClick?: () => void; disabled?: boolean }> | undefined {
  if (Array.isArray(node)) return node.map((child) => findAction(child, label)).find(Boolean)
  if (!node || typeof node !== 'object' || !('props' in node)) return undefined
  const element = node as ReactElement<{
    children?: unknown
    onClick?: () => void
    disabled?: boolean
  }>
  if (JSON.stringify(element.props.children)?.includes(label) && element.props.onClick)
    return element
  return findAction(element.props.children, label)
}

beforeEach(() => {
  hooks.cursor = 0
  hooks.values.clear()
  hooks.updates.clear()
})

describe('raster region editing', () => {
  it('copies only to the editable tracing state, not the saved metric contour', () => {
    const onChange = vi.fn()
    hooks.values.set(2, true) // source image loaded at the calibrated dimensions
    hooks.values.set(7, region) // source-bound region selected by the user
    const editor = PlanImageContourTrace({
      planUrl: '/source.jpg',
      calibration,
      points: undefined,
      widthCm: 1000,
      heightCm: 800,
      maxPoints: 30,
      label: 'Балкон',
      onChange,
      cornerSourceUrl: '/raster-candidates',
    })
    const action = findAction(editor, 'Взять контур области для правки')
    expect(action?.props.disabled).toBe(false)
    action?.props.onClick?.()
    expect(hooks.updates.get(1)).toEqual(region.polygon)
    expect(hooks.updates.get(0)).toBe(true)
    expect(onChange).not.toHaveBeenCalled()
  })

  it('does not offer copying when the source has not loaded or the contour exceeds the limit', () => {
    hooks.values.set(7, region)
    const props = {
      planUrl: '/source.jpg',
      calibration,
      points: undefined,
      widthCm: 1000,
      heightCm: 800,
      maxPoints: 3,
      label: 'Балкон',
      onChange: vi.fn(),
      cornerSourceUrl: '/raster-candidates',
    }
    expect(
      findAction(PlanImageContourTrace(props), 'Взять контур области для правки'),
    ).toBeUndefined()
    hooks.cursor = 0
    hooks.values.set(2, false)
    const editor = PlanImageContourTrace({ ...props, maxPoints: 30 })
    expect(findAction(editor, 'Взять контур области для правки')?.props.disabled).toBe(true)
  })
})
