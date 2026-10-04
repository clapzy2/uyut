import { createElement, type EffectCallback } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { afterEach, describe, expect, it, vi } from 'vitest'

const hooks = vi.hoisted(() => ({ effect: undefined as EffectCallback | undefined }))
vi.mock('react', async (importOriginal) => ({
  ...(await importOriginal<typeof import('react')>()),
  useEffect: (effect: EffectCallback) => {
    hooks.effect = effect
  },
}))

import { RoomSectionLinks } from './room-section-links'

afterEach(() => vi.unstubAllGlobals())

function mount(hash: string, isOwner = true) {
  const section = { scrollIntoView: vi.fn(), focus: vi.fn() }
  const requestFrame = vi.fn()
  const cancelFrame = vi.fn()
  const getElement = vi.fn(() => section)
  vi.stubGlobal('window', { location: { hash } })
  vi.stubGlobal('document', { getElementById: getElement })
  vi.stubGlobal('requestAnimationFrame', requestFrame.mockReturnValue(1))
  vi.stubGlobal('cancelAnimationFrame', cancelFrame)
  const html = renderToStaticMarkup(createElement(RoomSectionLinks, { isOwner, hasConcepts: true }))
  const cleanup = hooks.effect?.()
  return { section, requestFrame, cancelFrame, getElement, cleanup, html }
}

describe('переход к разделу загруженной комнаты', () => {
  it.each(['#room-measurements', '#room-concepts'])(
    'переносит к %s после появления разметки',
    (hash) => {
      const { section, requestFrame, getElement, cleanup, cancelFrame } = mount(hash)
      requestFrame.mock.calls[0]?.[0]()
      expect(getElement).toHaveBeenCalledWith(hash.slice(1))
      expect(section.scrollIntoView).toHaveBeenCalledWith({ block: 'start', behavior: 'instant' })
      expect(section.focus).toHaveBeenCalledWith({ preventScroll: true })
      if (typeof cleanup === 'function') cleanup()
      expect(cancelFrame).toHaveBeenCalledWith(1)
    },
  )

  it.each(['', '#other'])('не меняет обычный просмотр для hash=%s', (hash) => {
    expect(mount(hash).requestFrame).not.toHaveBeenCalled()
  })

  it('не направляет второго участника в мерки владельца', () => {
    const { html, requestFrame } = mount('#room-measurements', false)
    expect(requestFrame).not.toHaveBeenCalled()
    expect(html).not.toContain('href="#room-measurements"')
    expect(html).toContain('href="#room-concepts"')
  })
})
