import type { PlanGeometry } from '@uyut/db'
import { isValidElement, type ReactElement, type ReactNode, useRef, useState } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { loadPlanDeliveryMeasurements, savePlanDeliveryMeasurements } from '@/actions/plan-delivery'
import type { FurnitureDeliveryDraftFields } from '@/lib/projects/plan-furniture-delivery-archive'
import { serializeFurnitureDeliveryDraft } from '@/lib/projects/plan-furniture-delivery-archive'
import { PlanDeliveryAccount } from './plan-delivery-account'

vi.mock('@/actions/plan-delivery', () => ({
  loadPlanDeliveryMeasurements: vi.fn(),
  savePlanDeliveryMeasurements: vi.fn(),
}))
vi.mock('react', async (original) => ({
  ...(await original<typeof import('react')>()),
  useState: vi.fn(),
  useRef: vi.fn(),
}))

const geometry: PlanGeometry = {
  version: 1,
  status: 'draft',
  widthCm: 400,
  heightCm: 300,
  walls: [],
  openings: [],
  rooms: [],
  warnings: [],
}
const profile = {
  widthCm: '040,500',
  depthCm: '60',
  heightCm: '170',
  clearanceCm: '1',
  orientation: '0' as const,
}
const fields: FurnitureDeliveryDraftFields = {
  lowerFloorId: '',
  upperFloorId: '',
  direction: 'x',
  travelDirection: 'up',
  startCm: '',
  crossStartCm: '',
  widthCm: '',
  lowerLandingLengthCm: '',
  upperLandingLengthCm: '',
  carryClearanceCm: '',
  sourceReference: '',
  tilt: 'none',
  angleDeg: '90',
  steps: [],
}
const record = {
  version: 1 as const,
  savedAt: '2026-10-11T12:00:00.000Z',
  draftJson: serializeFurnitureDeliveryDraft(geometry, profile, fields),
}
const context = () => ({
  account: { projectId: 'project', revision: 'r1', onRevisionChange: vi.fn() },
  geometry,
  profileFields: profile,
  fields,
  canSaveChecked: false,
  onLoaded: vi.fn(),
})
type Props = { children?: ReactNode; disabled?: boolean; onClick?: () => void }
function nodes(node: ReactNode): ReactElement<Props>[] {
  if (Array.isArray(node)) return node.flatMap(nodes)
  if (!isValidElement<Props>(node)) return []
  return [node, ...nodes(node.props.children)]
}
function click(tree: ReactNode, text: string) {
  const element = nodes(tree).find((node) => node.props.children === text)
  expect(element).toBeDefined()
  element?.props.onClick?.()
}
beforeEach(() => {
  vi.resetAllMocks()
  vi.mocked(useState).mockImplementation(
    (initial?: unknown): ReturnType<typeof useState> => [initial, vi.fn()],
  )
  vi.mocked(useRef).mockImplementation((initial: unknown) => ({ current: initial }))
  vi.mocked(loadPlanDeliveryMeasurements).mockResolvedValue({
    ok: true,
    data: { revision: 'r1', record },
  })
  vi.mocked(savePlanDeliveryMeasurements).mockResolvedValue({
    ok: true,
    data: { revision: 'r2', record },
  })
})

describe('account delivery measurement controls', () => {
  it('saves partial drafts with CAS and advances the editor only after successful save', async () => {
    const props = context()
    click(PlanDeliveryAccount(props), 'Сохранить черновик в аккаунте')
    await vi.waitFor(() => expect(props.account.onRevisionChange).toHaveBeenCalledWith('r2'))
    expect(savePlanDeliveryMeasurements).toHaveBeenCalledExactlyOnceWith(
      'project',
      record.draftJson,
      'r1',
      false,
    )
    expect(props.onLoaded).not.toHaveBeenCalled()
  })

  it('never saves checked state from an unconfirmed route', () => {
    const tree = PlanDeliveryAccount(context())
    expect(
      nodes(tree).find((node) => node.props.children === 'Пересчитать и сохранить маршрут для PDF')
        ?.props.disabled,
    ).toBe(true)
    click(tree, 'Пересчитать и сохранить маршрут для PDF')
    expect(savePlanDeliveryMeasurements).not.toHaveBeenCalled()
  })

  it('requests a server recomputation instead of submitting the displayed result', async () => {
    const props = { ...context(), canSaveChecked: true }
    click(PlanDeliveryAccount(props), 'Пересчитать и сохранить маршрут для PDF')
    await vi.waitFor(() => expect(props.account.onRevisionChange).toHaveBeenCalledWith('r2'))
    expect(savePlanDeliveryMeasurements).toHaveBeenCalledExactlyOnceWith(
      'project',
      record.draftJson,
      'r1',
      true,
    )
  })

  it('does not advance an editor on server conflict', async () => {
    const props = context()
    vi.mocked(savePlanDeliveryMeasurements).mockResolvedValue({
      ok: false,
      error: 'Новая схема',
      code: 'plan-conflict',
    })
    click(PlanDeliveryAccount(props), 'Сохранить черновик в аккаунте')
    await vi.waitFor(() => expect(savePlanDeliveryMeasurements).toHaveBeenCalledOnce())
    expect(props.account.onRevisionChange).not.toHaveBeenCalled()
  })

  it('reading from the account never applies fields or adopts a newer foreign revision', async () => {
    const props = context()
    vi.mocked(loadPlanDeliveryMeasurements).mockResolvedValue({
      ok: true,
      data: { revision: 'r2', record },
    })
    click(PlanDeliveryAccount(props), 'Загрузить обмеры из аккаунта')
    await vi.waitFor(() => expect(loadPlanDeliveryMeasurements).toHaveBeenCalledOnce())
    expect(props.onLoaded).not.toHaveBeenCalled()
    expect(props.account.onRevisionChange).not.toHaveBeenCalled()
  })

  it('explicitly applies the saved body and draft, not a saved result or acknowledgement', () => {
    const props = context()
    vi.mocked(useState)
      .mockReturnValueOnce([false, vi.fn()])
      .mockReturnValueOnce([undefined, vi.fn()])
      .mockReturnValueOnce([
        { text: record.draftJson, revision: 'r1', projectId: 'project' },
        vi.fn(),
      ])
    click(PlanDeliveryAccount(props), 'Заменить габарит и обмеры из аккаунта')
    expect(props.onLoaded).toHaveBeenCalledExactlyOnceWith(profile, fields)
    expect(props.account.onRevisionChange).not.toHaveBeenCalled()
  })

  it('holds prepared account input when the local geometry has changed', () => {
    const props = { ...context(), geometry: { ...geometry, widthCm: 401 } }
    vi.mocked(useState)
      .mockReturnValueOnce([false, vi.fn()])
      .mockReturnValueOnce([undefined, vi.fn()])
      .mockReturnValueOnce([
        { text: record.draftJson, revision: 'r1', projectId: 'project' },
        vi.fn(),
      ])
    click(PlanDeliveryAccount(props), 'Заменить габарит и обмеры из аккаунта')
    expect(props.onLoaded).not.toHaveBeenCalled()
  })

  it('does not apply prepared input to a different project with coincidentally identical revision', () => {
    const props = context()
    vi.mocked(useState)
      .mockReturnValueOnce([false, vi.fn()])
      .mockReturnValueOnce([undefined, vi.fn()])
      .mockReturnValueOnce([
        { text: record.draftJson, revision: 'r1', projectId: 'another' },
        vi.fn(),
      ])
    const html = renderToStaticMarkup(PlanDeliveryAccount(props))
    expect(html).not.toContain('Заменить габарит и обмеры из аккаунта')
    expect(props.onLoaded).not.toHaveBeenCalled()
  })

  it('holds a double click until the first save finishes', async () => {
    const props = context()
    let finish: (value: Awaited<ReturnType<typeof savePlanDeliveryMeasurements>>) => void = () => {
      throw new Error('Not started')
    }
    vi.mocked(savePlanDeliveryMeasurements).mockImplementation(
      () =>
        new Promise((resolve) => {
          finish = resolve
        }),
    )
    const tree = PlanDeliveryAccount(props)
    click(tree, 'Сохранить черновик в аккаунте')
    click(tree, 'Сохранить черновик в аккаунте')
    expect(savePlanDeliveryMeasurements).toHaveBeenCalledOnce()
    finish({ ok: true, data: { revision: 'r2', record } })
    await vi.waitFor(() => expect(props.account.onRevisionChange).toHaveBeenCalledOnce())
  })
})
