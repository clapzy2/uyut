import type { ComponentProps, EffectCallback, ReactElement } from 'react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const hooks = vi.hoisted(() => ({
  state: [] as unknown[],
  stateIndex: 0,
  ref: { current: null as unknown },
  effect: undefined as EffectCallback | undefined,
  dependencies: undefined as readonly unknown[] | undefined,
  cleanup: undefined as (() => void) | undefined,
}))

// Exercise the real component effects and handlers with persistent hook state, without a DOM dependency.
vi.mock('react', async (importOriginal) => ({
  ...(await importOriginal<typeof import('react')>()),
  useState: (initial: unknown) => {
    const index = hooks.stateIndex++
    if (!(index in hooks.state)) hooks.state[index] = initial
    return [
      hooks.state[index],
      (next: unknown) => {
        hooks.state[index] = typeof next === 'function' ? next(hooks.state[index]) : next
      },
    ]
  },
  useRef: () => hooks.ref,
  useEffect: (effect: EffectCallback, dependencies: readonly unknown[]) => {
    if (
      !hooks.dependencies ||
      dependencies.some((value, index) => !Object.is(value, hooks.dependencies?.[index]))
    ) {
      hooks.cleanup?.()
      hooks.cleanup = undefined
      hooks.dependencies = dependencies
      hooks.effect = effect
    }
  },
}))

import { ProductImage } from './product-image'

const observers: VisibilityObserver[] = []
class VisibilityObserver {
  observe = vi.fn()
  disconnect = vi.fn()
  constructor(private callback: IntersectionObserverCallback) {
    observers.push(this)
  }
  intersect(isIntersecting = true) {
    this.callback(
      [{ isIntersecting } as IntersectionObserverEntry],
      this as unknown as IntersectionObserver,
    )
  }
}

function imageAt(top = 1000) {
  return {
    complete: false,
    naturalWidth: 0,
    getBoundingClientRect: () => ({
      top,
      bottom: top + 120,
      left: 0,
      right: 120,
      width: 120,
      height: 120,
    }),
  }
}
const props = { src: '/primary.jpg', fallback: '/fallback.jpg', alt: 'Sofa' }
let image = imageAt()

function render(input = props) {
  hooks.stateIndex = 0
  const element = ProductImage(input) as ReactElement<ComponentProps<'img'>>
  hooks.ref.current = element.type === 'img' ? image : null
  const effect = hooks.effect
  hooks.effect = undefined
  const cleanup = effect?.()
  if (typeof cleanup === 'function') hooks.cleanup = cleanup
  return element
}

function latestObserver() {
  const observer = observers.at(-1)
  if (!observer) throw new Error('Missing visibility observer')
  return observer
}

beforeEach(() => {
  vi.useFakeTimers()
  hooks.state = []
  hooks.stateIndex = 0
  hooks.ref.current = null
  hooks.effect = undefined
  hooks.dependencies = undefined
  hooks.cleanup = undefined
  observers.length = 0
  image = imageAt()
  vi.stubGlobal('IntersectionObserver', VisibilityObserver)
  vi.stubGlobal('window', Object.assign(new EventTarget(), { innerHeight: 800, innerWidth: 1200 }))
})
afterEach(() => {
  hooks.cleanup?.()
  vi.useRealTimers()
  vi.unstubAllGlobals()
})

describe('ProductImage lazy loading and fallback', () => {
  it('does not exhaust either URL while the card stays below the viewport', () => {
    expect(render().props.loading).toBe('lazy')
    latestObserver().intersect(false)
    vi.advanceTimersByTime(60_000)
    expect(render().props.src).toBe(props.src)
    expect(vi.getTimerCount()).toBe(0)
    latestObserver().intersect()
    vi.advanceTimersByTime(3499)
    expect(render().props.src).toBe(props.src)
    vi.advanceTimersByTime(1)
    expect(render().props.src).toBe(props.fallback)
  })

  it('gives each visible source its own timeout and eventually shows a placeholder', () => {
    render()
    latestObserver().intersect()
    latestObserver().intersect()
    expect(vi.getTimerCount()).toBe(1)
    vi.advanceTimersByTime(3500)
    expect(render().props.src).toBe(props.fallback)
    expect(vi.getTimerCount()).toBe(0)
    latestObserver().intersect()
    vi.advanceTimersByTime(3500)
    expect(render().type).toBe('span')
  })

  it('still falls back immediately on an actual image error', () => {
    const first = render()
    first.props.onError?.({} as Parameters<NonNullable<typeof first.props.onError>>[0])
    expect(render().props.src).toBe(props.fallback)
    vi.advanceTimersByTime(60_000)
    expect(render().props.src).toBe(props.fallback)
  })

  it.each([false, true])('cleans up after loading; already visible: %s', (visible) => {
    const first = render()
    const observer = latestObserver()
    if (visible) observer.intersect()
    image.complete = true
    image.naturalWidth = 120
    first.props.onLoad?.({} as Parameters<NonNullable<typeof first.props.onLoad>>[0])
    expect(render().props.className).toContain('opacity-100')
    expect(vi.getTimerCount()).toBe(0)
    observer.intersect()
    vi.advanceTimersByTime(60_000)
    expect(render().props.src).toBe(props.src)
    expect(observer.disconnect).toHaveBeenCalled()
  })

  it('recognizes an already cached image when hydration missed its load event', () => {
    image.complete = true
    image.naturalWidth = 120
    render()
    expect(render().props.className).toContain('opacity-100')
    expect(observers).toHaveLength(0)
    expect(vi.getTimerCount()).toBe(0)
  })

  it('cancels an old URL timeout and ignores late visibility callbacks after src changes', () => {
    render()
    const oldObserver = latestObserver()
    oldObserver.intersect()
    vi.advanceTimersByTime(3000)
    image = imageAt()
    const changed = { ...props, src: '/new-primary.jpg' }
    expect(render(changed).props.src).toBe(changed.src)
    oldObserver.intersect()
    vi.advanceTimersByTime(60_000)
    expect(render(changed).props.src).toBe(changed.src)
    expect(vi.getTimerCount()).toBe(0)
    latestObserver().intersect()
    vi.advanceTimersByTime(3500)
    expect(render(changed).props.src).toBe(props.fallback)
  })

  it('gives a replacement fallback a fresh visibility gate after the primary failed', () => {
    const first = render()
    first.props.onError?.({} as Parameters<NonNullable<typeof first.props.onError>>[0])
    render()
    latestObserver().intersect()
    vi.advanceTimersByTime(3000)
    image = imageAt()
    const changed = { ...props, fallback: '/new-fallback.jpg' }
    expect(render(changed).props.src).toBe(changed.fallback)
    vi.advanceTimersByTime(60_000)
    expect(render(changed).props.src).toBe(changed.fallback)
    expect(vi.getTimerCount()).toBe(0)
  })

  it('cleans up the pending timeout when unmounted', () => {
    render()
    const observer = latestObserver()
    observer.intersect()
    hooks.cleanup?.()
    observer.intersect()
    expect(vi.getTimerCount()).toBe(0)
    expect(observer.disconnect).toHaveBeenCalled()
  })

  it('waits for scrolling into view when IntersectionObserver is unavailable', () => {
    vi.stubGlobal('IntersectionObserver', undefined)
    render()
    vi.advanceTimersByTime(60_000)
    expect(render().props.src).toBe(props.src)
    image.getBoundingClientRect = imageAt(100).getBoundingClientRect
    window.dispatchEvent(new Event('scroll'))
    vi.advanceTimersByTime(3500)
    expect(render().props.src).toBe(props.fallback)
  })
})
