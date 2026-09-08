import { describe, expect, it } from 'vitest'
import { isStaleBuildError } from './stale-build'

describe('isStaleBuildError', () => {
  it('распознаёт пропавшие куски сборки', () => {
    const chunk = new Error('Loading chunk 42 failed')
    chunk.name = 'ChunkLoadError'
    expect(isStaleBuildError(chunk)).toBe(true)
    expect(
      isStaleBuildError(
        new Error('Failed to fetch dynamically imported module: /_next/static/x.js'),
      ),
    ).toBe(true)
    expect(isStaleBuildError(new Error('Loading CSS chunk 7 failed'))).toBe(true)
  })

  it('ловит случай, когда вместо файла вернулась страница 404', () => {
    // Браузер пытается разобрать HTML как модуль и спотыкается о первый же символ
    expect(isStaleBuildError(new SyntaxError("Unexpected token '<'"))).toBe(true)
  })

  it('не трогает настоящие ошибки приложения', () => {
    expect(isStaleBuildError(new Error('Не удалось сохранить проект'))).toBe(false)
    expect(isStaleBuildError(new TypeError('x is not a function'))).toBe(false)
    expect(isStaleBuildError(null)).toBe(false)
    expect(isStaleBuildError(undefined)).toBe(false)
  })
})
