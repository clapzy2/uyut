import { styleLibrary } from '@uyut/ai'
import type { ReactElement, ReactNode } from 'react'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const hooks = vi.hoisted(() => ({
  cursor: 0,
  values: [] as unknown[],
  pending: false,
  transition: Promise.resolve() as Promise<unknown>,
  push: vi.fn(),
}))

vi.mock('react', async (importOriginal) => ({
  ...(await importOriginal<typeof import('react')>()),
  useMemo: (factory: () => unknown) => factory(),
  useState: (initial: unknown) => {
    const index = hooks.cursor++
    if (index >= hooks.values.length) {
      hooks.values[index] = typeof initial === 'function' ? initial() : initial
    }
    return [
      hooks.values[index],
      (value: unknown) => {
        hooks.values[index] = typeof value === 'function' ? value(hooks.values[index]) : value
      },
    ]
  },
  useTransition: () => [
    hooks.pending,
    (callback: () => Promise<unknown>) => {
      hooks.pending = true
      hooks.transition = callback().finally(() => {
        hooks.pending = false
      })
    },
  ],
}))

vi.mock('next/navigation', () => ({ useRouter: () => ({ push: hooks.push }) }))
vi.mock('@/actions/onboarding', () => ({
  saveHousehold: vi.fn(),
  saveBudget: vi.fn(),
  saveReferenceLink: vi.fn(),
  saveStyleVotes: vi.fn(),
  finishOnboarding: vi.fn(),
  uploadReference: vi.fn(),
}))
vi.mock('@/components/file-uploader', () => ({ FileUploader: () => null }))

import {
  finishOnboarding,
  saveBudget,
  saveHousehold,
  saveReferenceLink,
  saveStyleVotes,
} from '@/actions/onboarding'
import { BudgetForm } from './budget-form'
import { HouseholdForm } from './household-form'
import { ReferenceForm } from './reference-form'
import { StyleSwipe } from './style-swipe'

type FormProps = { children?: ReactNode; disabled?: boolean; onClick?: () => void; value?: unknown }

function find(
  node: ReactNode,
  predicate: (props: FormProps) => boolean,
): ReactElement<FormProps> | undefined {
  if (Array.isArray(node)) {
    for (const child of node) {
      const found = find(child, predicate)
      if (found) return found
    }
  } else if (node && typeof node === 'object' && 'props' in node) {
    const element = node as ReactElement<FormProps>
    if (predicate(element.props)) return element
    return find(element.props.children, predicate)
  }
  return undefined
}

function render(kind: string) {
  hooks.cursor = 0
  if (kind === 'household')
    return HouseholdForm({ projectId: 'project', initial: { adults: 3, pets: true } })
  if (kind === 'budget') return BudgetForm({ projectId: 'project', initial: 120_000_000 })
  return ReferenceForm({ projectId: 'project', referenceSrc: null })
}

function submit(kind: string) {
  const form = render(kind)
  const next = find(
    form,
    (props) => props.children === (kind === 'reference' ? 'Готово' : 'Дальше'),
  )
  expect(next).toBeDefined()
  next?.props.onClick?.()
}

beforeEach(() => {
  vi.resetAllMocks()
  hooks.cursor = 0
  hooks.values = []
  hooks.pending = false
  hooks.transition = Promise.resolve()
})

describe('сохранение введённых ответов при отправке анкеты', () => {
  it.each(['household', 'budget', 'reference'])(
    'блокирует поля и Back только на время запроса: %s',
    async (kind) => {
      let resolve: ((result: { ok: false; error: string }) => void) | undefined
      const request = new Promise<{ ok: false; error: string }>((done) => {
        resolve = done
      })
      vi.mocked(saveHousehold).mockReturnValue(request)
      vi.mocked(saveBudget).mockReturnValue(request)
      vi.mocked(finishOnboarding).mockReturnValue(request)
      submit(kind)
      expect(hooks.pending).toBe(true)
      const pending = render(kind)
      expect(pending.type).toBe('fieldset')
      expect(pending.props.disabled).toBe(true)
      expect(find(pending, (props) => props.children === 'Назад')?.props.disabled).toBe(true)
      resolve?.({ ok: false, error: 'Повторите отправку' })
      await hooks.transition
      expect(render(kind).props.disabled).toBe(false)
      expect(hooks.values[0]).toBe('Повторите отправку')
      expect(hooks.push).not.toHaveBeenCalled()
    },
  )

  it.each(['household', 'budget', 'reference'])(
    'перехватывает сетевую ошибку без очистки ответа: %s',
    async (kind) => {
      render(kind)
      if (kind === 'reference') hooks.values[1] = 'https://example.test/interior.jpg'
      const entered = hooks.values[1]
      vi.mocked(saveHousehold).mockRejectedValue(new Error('offline'))
      vi.mocked(saveBudget).mockRejectedValue(new Error('offline'))
      vi.mocked(saveReferenceLink).mockRejectedValue(new Error('offline'))
      submit(kind)
      await hooks.transition
      expect(hooks.values[0]).toContain('Не удалось получить ответ сервера.')
      expect(hooks.values[1]).toEqual(entered)
      expect(render(kind).props.disabled).toBe(false)
      expect(hooks.push).not.toHaveBeenCalled()
    },
  )

  it('пропускает ссылку явно, не отправляет старое значение и сохраняет его при ошибке завершения', async () => {
    render('reference')
    hooks.values[1] = 'https://example.test/interior.jpg'
    vi.mocked(finishOnboarding).mockRejectedValue(new Error('offline'))
    const skip = find(render('reference'), (props) => props.children === 'Пропустить этот шаг')
    skip?.props.onClick?.()
    await hooks.transition
    expect(saveReferenceLink).not.toHaveBeenCalled()
    expect(finishOnboarding).toHaveBeenCalledWith('project')
    expect(hooks.values[1]).toBe('https://example.test/interior.jpg')
    expect(hooks.values[0]).toContain('Ссылка осталась в форме')
    expect(hooks.push).not.toHaveBeenCalled()
  })

  it('оставляет оценки стиля и разблокирует карточки после сетевой ошибки', async () => {
    const votes = styleLibrary
      .slice(0, 10)
      .map((style, index) => ({ styleId: style.id, liked: index === 0 }))
    function renderStyle() {
      hooks.cursor = 0
      return StyleSwipe({ projectId: 'project', initialVotes: votes })
    }
    let reject: ((error: Error) => void) | undefined
    const request = new Promise<Awaited<ReturnType<typeof saveStyleVotes>>>((_, fail) => {
      reject = fail
    })
    vi.mocked(saveStyleVotes).mockReturnValue(request)
    const next = find(renderStyle(), (props) => props.children === 'Дальше')
    next?.props.onClick?.()
    expect(saveStyleVotes).toHaveBeenCalledWith('project', { votes })
    const pending = renderStyle()
    expect(find(pending, (props) => props.children === 'Назад')?.props.disabled).toBe(true)
    const deck = pending.props.children[0] as ReactElement<{ disabled: boolean }>
    expect(deck.props.disabled).toBe(true)
    reject?.(new Error('offline'))
    await hooks.transition
    expect(hooks.values[0]).toContain('Оценки остались на странице')
    expect(hooks.values[1]).toEqual(votes)
    const recovered = renderStyle()
    expect(find(recovered, (props) => props.children === 'Назад')?.props.disabled).toBe(false)
    expect(
      (recovered.props.children[0] as ReactElement<{ disabled: boolean }>).props.disabled,
    ).toBe(false)
    expect(hooks.push).not.toHaveBeenCalled()
  })
})
