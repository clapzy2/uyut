import type { FormEvent, ReactElement, ReactNode } from 'react'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const state = vi.hoisted(() => ({
  cursor: 0,
  values: [] as unknown[],
  plan: vi.fn(),
  revise: vi.fn(),
}))
vi.mock('react', async (original) => ({
  ...(await original<typeof import('react')>()),
  useCallback: (callback: unknown) => callback,
  useState: (initial: unknown) => {
    const index = state.cursor++
    if (index >= state.values.length) state.values[index] = initial
    return [
      state.values[index],
      (value: unknown) => {
        state.values[index] = value
      },
    ]
  },
  useRef: (initial: unknown) => {
    const index = state.cursor++
    if (index >= state.values.length) state.values[index] = { current: initial }
    return state.values[index]
  },
}))
vi.mock('next/navigation', () => ({ useRouter: () => ({ push: vi.fn() }) }))
vi.mock('@/actions/concepts', () => ({
  planConceptEdit: state.plan,
  reviseConcept: state.revise,
  checkGeneration: vi.fn(),
  refreshConcepts: vi.fn(),
}))
vi.mock('@/lib/queue/use-run-watch', () => ({ useRunWatch: vi.fn() }))

import { ConceptEditForm } from './concept-edit-form'

type Props = {
  children?: ReactNode
  label?: string
  disabled?: boolean
  value?: string
  onChange?: (event: { currentTarget: { value: string } }) => void
  onSubmit?: (event: FormEvent<HTMLFormElement>) => Promise<void>
  onClick?: () => void
}
function find(node: ReactNode, match: (props: Props) => boolean): ReactElement<Props> | undefined {
  if (Array.isArray(node)) {
    for (const child of node) {
      const found = find(child, match)
      if (found) return found
    }
  } else if (node && typeof node === 'object' && 'props' in node) {
    const element = node as ReactElement<Props>
    return match(element.props) ? element : find(element.props.children, match)
  }
}
function render() {
  state.cursor = 0
  return ConceptEditForm({
    conceptId: 'concept',
    roomId: 'room',
    roomHref: '/room',
    busyElsewhere: false,
    objects: [{ id: 'bed', label: 'Кровать' }],
  })
}
const event = { preventDefault() {} } as FormEvent<HTMLFormElement>
const plan = {
  steps: [{ titleRu: 'Синее покрывало', prompt: 'Blue bedspread', needsObject: false }],
  warningRu: '',
  planToken: 'signed-plan',
}

beforeEach(() => {
  vi.resetAllMocks()
  state.cursor = 0
  state.values = []
})

describe('форма правки во время запроса', () => {
  it('не отправляет два предпросмотра до перерисовки и блокирует изменение текста и предмета', async () => {
    let finish!: (value: unknown) => void
    state.plan.mockReturnValue(
      new Promise((resolve) => {
        finish = resolve
      }),
    )
    find(render(), (p) => p.label === 'Поправить этот вариант')?.props.onChange?.({
      currentTarget: { value: 'Синее покрывало' },
    })
    const submit = find(render(), (p) => Boolean(p.onSubmit))?.props.onSubmit
    if (!submit) throw new Error('Нет формы правки')
    const pending = submit(event)
    await submit(event)
    expect(state.plan).toHaveBeenCalledTimes(1)
    const waiting = render()
    expect(find(waiting, (p) => p.label === 'Поправить этот вариант')?.props.disabled).toBe(true)
    expect(find(waiting, (p) => p.children === 'Кровать')?.props.disabled).toBe(true)
    finish({ ok: false, error: 'Недоступно' })
    await pending
    const restored = find(render(), (p) => p.label === 'Поправить этот вариант')
    expect(restored?.props.disabled).toBe(false)
    expect(restored?.props.value).toBe('Синее покрывало')
    state.plan.mockResolvedValue({ ok: true, data: plan })
    await find(render(), (p) => Boolean(p.onSubmit))?.props.onSubmit?.(event)
    expect(state.plan).toHaveBeenCalledTimes(2)
  })

  it('блокирует возврат к тексту и второй запуск, после потери ответа требует проверить статус', async () => {
    state.plan.mockResolvedValue({ ok: true, data: plan })
    await find(render(), (p) => Boolean(p.onSubmit))?.props.onSubmit?.(event)
    let fail!: (reason: Error) => void
    state.revise.mockReturnValue(
      new Promise((_, reject) => {
        fail = reject
      }),
    )
    const start = find(render(), (p) => p.children === 'Запустить')?.props.onClick
    if (!start) throw new Error('Нет кнопки запуска')
    start()
    start()
    expect(state.revise).toHaveBeenCalledTimes(1)
    expect(state.revise).toHaveBeenCalledWith(
      'concept',
      expect.objectContaining({ planToken: 'signed-plan' }),
    )
    expect(find(render(), (p) => p.children === 'Изменить просьбу')?.props.disabled).toBe(true)
    fail(new Error('lost response'))
    await vi.waitFor(() => {
      expect(find(render(), (p) => p.children === 'Проверить статус в комнате')).toBeDefined()
    })
    expect(find(render(), (p) => p.children === 'Запустить')).toBeUndefined()
  })
})
