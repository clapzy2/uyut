import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const state = vi.hoisted(() => ({
  values: [] as unknown[],
  cursor: 0,
  pending: false,
  submit: undefined as (() => void) | undefined,
  task: undefined as Promise<void> | undefined,
  start: vi.fn(),
  refresh: vi.fn(),
  toast: vi.fn(),
}))

vi.mock('next/navigation', () => ({ useRouter: () => ({ refresh: state.refresh }) }))
vi.mock('@/actions/projects', () => ({ startManualPlanGeometry: state.start }))
vi.mock('react', async (importOriginal) => ({
  ...(await importOriginal<typeof import('react')>()),
  useState: () => {
    const index = state.cursor++
    return [
      state.values[index],
      (value: unknown) => {
        state.values[index] = value
      },
    ]
  },
  useTransition: () => [
    state.pending,
    (action: () => Promise<void>) => {
      state.task = action()
    },
  ],
}))
vi.mock('@uyut/ui', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@uyut/ui')>()
  return {
    ...actual,
    toast: state.toast,
    Button: ({ onClick, children }: { onClick: () => void; children: string }) => {
      state.submit = onClick
      return createElement('button', { type: 'button' }, children)
    },
  }
})

import { ManualPlanGeometryStart } from './manual-plan-geometry-start'

function render() {
  state.cursor = 0
  return renderToStaticMarkup(createElement(ManualPlanGeometryStart, { projectId: 'project' }))
}

beforeEach(() => {
  vi.clearAllMocks()
  state.values = ['410', '520', undefined]
  state.pending = false
  state.task = undefined
})

describe('создание ручного черновика при ошибке', () => {
  it('сохраняет размеры при транспортном отказе и предлагает проверить результат до повтора', async () => {
    state.start.mockRejectedValueOnce(new Error('network'))
    render()
    state.submit?.()
    await state.task
    const html = render()
    expect(html).toContain('value="410"')
    expect(html).toContain('value="520"')
    expect(html).toContain('role="alert"')
    expect(html).toContain('проверить, создан ли черновик')
    expect(state.refresh).not.toHaveBeenCalled()
    expect(state.toast).not.toHaveBeenCalled()
  })

  it('оставляет размеры и конкретную ошибку проверки сервера', async () => {
    state.start.mockResolvedValueOnce({ ok: false, error: 'Сначала загрузите план' })
    render()
    state.submit?.()
    await state.task
    expect(render()).toContain('Сначала загрузите план')
    expect(state.values.slice(0, 2)).toEqual(['410', '520'])
    expect(state.refresh).not.toHaveBeenCalled()
  })

  it('обновляет страницу только после подтверждённого успеха', async () => {
    state.start.mockResolvedValueOnce({ ok: true, data: {} })
    render()
    state.submit?.()
    await state.task
    expect(state.start).toHaveBeenCalledExactlyOnceWith('project', { widthCm: 410, heightCm: 520 })
    expect(state.refresh).toHaveBeenCalledTimes(1)
    expect(state.toast).toHaveBeenCalledTimes(1)
  })

  it('не позволяет менять отправленные размеры во время сохранения', () => {
    state.pending = true
    const html = render()
    expect(html).toMatch(/id="manual-plan-width"[^>]*disabled=""/)
    expect(html).toMatch(/id="manual-plan-height"[^>]*disabled=""/)
  })
})
