import type { KeyboardEvent, ReactElement, ReactNode } from 'react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const state = vi.hoisted(() => ({
  reducedMotion: false,
  voted: [] as string[],
  setters: [] as ReturnType<typeof vi.fn>[],
}))

vi.mock('react', async (importOriginal) => ({
  ...(await importOriginal<typeof import('react')>()),
  useCallback: (callback: unknown) => callback,
  useEffect: () => {},
  useRef: (current: unknown) => ({ current }),
  useState: (initial: unknown) => {
    const setter = vi.fn()
    state.setters.push(setter)
    return [Array.isArray(initial) ? state.voted : initial, setter]
  },
}))

vi.mock('motion/react', () => ({
  AnimatePresence: 'section',
  motion: { div: 'div', span: 'span' },
  useReducedMotion: () => state.reducedMotion,
  useMotionValue: () => ({ set: vi.fn() }),
  useTransform: () => 0,
  animate: vi.fn(),
}))

import { SwipeDeck } from './swipe-deck'

type ElementProps = {
  children?: ReactNode
  role?: string
  drag?: string | boolean
  onKeyDown?: (event: KeyboardEvent<HTMLDivElement>) => void
}

function findCard(node: ReactNode): ReactElement<ElementProps> | undefined {
  if (Array.isArray(node)) {
    for (const child of node) {
      const found = findCard(child)
      if (found) return found
    }
  } else if (node && typeof node === 'object' && 'props' in node) {
    const element = node as ReactElement<ElementProps>
    if (element.props.role === 'button') return element
    return findCard(element.props.children)
  }
  return undefined
}

function setup(disabled = false) {
  const onOpen = vi.fn()
  const onVote = vi.fn()
  const onUndo = vi.fn()
  const deck = SwipeDeck({
    cards: [
      { id: 'one', src: '/one.webp' },
      { id: 'two', src: '/two.webp' },
    ],
    onOpen,
    onVote,
    onUndo,
    disabled,
  }) as ReactElement<ElementProps>
  const card = findCard(deck)
  expect(card).toBeDefined()
  return { deck, card, onOpen, onVote, onUndo }
}

function keyboard(key: string, overrides = {}) {
  return {
    key,
    preventDefault: vi.fn(),
    defaultPrevented: false,
    repeat: false,
    altKey: false,
    ctrlKey: false,
    metaKey: false,
    target: {},
    ...overrides,
  } as unknown as KeyboardEvent<HTMLDivElement>
}

beforeEach(() => {
  state.reducedMotion = false
  state.voted = []
  state.setters = []
  vi.stubGlobal('HTMLElement', class {})
})
afterEach(() => vi.unstubAllGlobals())

describe('клавиатура и спокойный режим карточек', () => {
  it.each(['Enter', ' '])('открывает только саму карточку по %s', (key) => {
    const { card, onOpen } = setup()
    const event = keyboard(key)
    card?.props.onKeyDown?.(event)
    expect(onOpen).toHaveBeenCalledWith({ id: 'one', src: '/one.webp' })
    expect(event.preventDefault).toHaveBeenCalledOnce()
  })

  it('не перехватывает Space и Enter у остальных кнопок', () => {
    const { deck, onOpen, onVote } = setup()
    for (const key of [' ', 'Enter']) {
      const event = keyboard(key)
      deck.props.onKeyDown?.(event)
      expect(event.preventDefault).not.toHaveBeenCalled()
    }
    expect(onOpen).not.toHaveBeenCalled()
    expect(onVote).not.toHaveBeenCalled()
  })

  it.each([
    ['ArrowLeft', false],
    ['ArrowRight', true],
  ] as const)('голосует по %s только в сфокусированной стопке', (key, liked) => {
    const { deck, onVote } = setup()
    const event = keyboard(key)
    deck.props.onKeyDown?.(event)
    expect(onVote).toHaveBeenCalledWith({ id: 'one', src: '/one.webp' }, liked)
    expect(event.preventDefault).toHaveBeenCalledOnce()
  })

  it.each([
    { repeat: true },
    { ctrlKey: true },
    { metaKey: true },
    { altKey: true },
    { defaultPrevented: true },
  ])('не забирает повтор и системные сочетания %o', (overrides) => {
    const { deck, onVote } = setup()
    deck.props.onKeyDown?.(keyboard('ArrowRight', overrides))
    expect(onVote).not.toHaveBeenCalled()
  })

  it('не голосует при редактировании текста внутри стопки', () => {
    class EditableTarget extends HTMLElement {
      override closest() {
        return this
      }
    }
    const { deck, onVote } = setup()
    deck.props.onKeyDown?.(keyboard('ArrowRight', { target: new EditableTarget() }))
    expect(onVote).not.toHaveBeenCalled()
  })

  it('с reduced motion отключает жест и улетающую копию, сохраняя голосование', () => {
    state.reducedMotion = true
    const { deck, card, onVote } = setup()
    expect(card?.props.drag).toBe(false)
    deck.props.onKeyDown?.(keyboard('ArrowRight'))
    expect(onVote).toHaveBeenCalledOnce()
    expect(state.setters[1]).toHaveBeenCalledWith(null)
  })

  it('оставляет жест и анимированную копию в обычном режиме', () => {
    const { deck, card } = setup()
    expect(card?.props.drag).toBe('x')
    deck.props.onKeyDown?.(keyboard('ArrowLeft'))
    expect(state.setters[1]).toHaveBeenCalledWith({
      card: { id: 'one', src: '/one.webp' },
      liked: false,
    })
  })

  it('не принимает новые голоса или открытие во время сохранения', () => {
    const { deck, card, onOpen, onVote } = setup(true)
    expect(deck.props).toHaveProperty('aria-busy', true)
    expect(card?.props.drag).toBe(false)
    deck.props.onKeyDown?.(keyboard('ArrowRight'))
    card?.props.onKeyDown?.(keyboard('Enter'))
    expect(onOpen).not.toHaveBeenCalled()
    expect(onVote).not.toHaveBeenCalled()
  })
})
