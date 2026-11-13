import { Children, isValidElement, type ReactNode } from 'react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('react', async (importOriginal) => ({
  ...(await importOriginal<typeof import('react')>()),
  useEffect: (effect: () => void) => effect(),
}))
vi.mock('@sentry/nextjs', () => ({ captureException: vi.fn() }))
vi.mock('@/lib/fonts', () => ({ fontVariables: '' }))

import ErrorScreen from './error'
import GlobalError from './global-error'

function retryButton(node: ReactNode): (() => void) | undefined {
  for (const child of Children.toArray(node)) {
    if (!isValidElement<{ children?: ReactNode; onClick?: () => void }>(child)) continue
    if (child.props.children === 'Попробовать снова') return child.props.onClick
    const nested = retryButton(child.props.children)
    if (nested) return nested
  }
}

const reload = vi.fn()
const reset = vi.fn()

beforeEach(() => {
  vi.clearAllMocks()
  vi.stubGlobal('window', {
    location: { reload },
    sessionStorage: {
      getItem: () => String(Date.now()),
      setItem: vi.fn(),
    },
  })
})

afterEach(() => vi.unstubAllGlobals())

it('автоматически перезагружает страницу только один раз при повторной ошибке', () => {
  let previous: string | null = null
  vi.stubGlobal('window', {
    location: { reload },
    sessionStorage: {
      getItem: () => previous,
      setItem: (_key: string, value: string) => {
        previous = value
      },
    },
  })
  const error = new Error('Failed to load chunk /_next/static/chunks/old.js')
  ErrorScreen({ error, reset })
  expect(reload).toHaveBeenCalledOnce()
  const retry = retryButton(ErrorScreen({ error, reset }))
  expect(reload).toHaveBeenCalledOnce()
  retry?.()
  expect(reload).toHaveBeenCalledTimes(2)
  expect(reset).not.toHaveBeenCalled()
})

describe.each([
  ['корневой экран', GlobalError],
  ['экран страницы', ErrorScreen],
] as const)('%s', (_name, Screen) => {
  it('после неудачного автоматического восстановления вручную загружает новую сборку', () => {
    const error = new Error('Failed to load chunk /_next/static/chunks/old.js from module 940853')
    const retry = retryButton(Screen({ error, reset }))
    expect(retry).toBeTypeOf('function')
    expect(reload).not.toHaveBeenCalled()
    retry?.()
    expect(reload).toHaveBeenCalledOnce()
    expect(reset).not.toHaveBeenCalled()
  })

  it('оставляет обычный повтор для ошибок приложения', () => {
    retryButton(Screen({ error: new Error('Не удалось прочитать проект'), reset }))?.()
    expect(reset).toHaveBeenCalledOnce()
    expect(reload).not.toHaveBeenCalled()
  })

  it('позволяет ручное восстановление при недоступном sessionStorage', () => {
    vi.stubGlobal('window', {
      location: { reload },
      get sessionStorage() {
        throw new Error('Storage denied')
      },
    })
    retryButton(Screen({ error: new Error('Loading CSS chunk 7 failed'), reset }))?.()
    expect(reload).toHaveBeenCalledOnce()
    expect(reset).not.toHaveBeenCalled()
  })
})
