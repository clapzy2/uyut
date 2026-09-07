import { describe, expect, it } from 'vitest'
import { personName } from './name'

describe('personName', () => {
  it('prefers the filled profile name', () => {
    expect(personName('Аня', 'anya@example.ru', 'второй участник')).toBe('Аня')
    expect(personName('  Маша  ', 'masha@example.ru', 'второй участник')).toBe('Маша')
  })

  it('falls back to the part before the at sign', () => {
    expect(personName(null, 'masha@example.ru', 'второй участник')).toBe('masha')
    expect(personName('   ', 'petr.ivanov@mail.ru', 'второй участник')).toBe('petr.ivanov')
  })

  it('cuts a machine address at its separator', () => {
    expect(personName(null, 'it-partner-1788786232467@example.test', 'второй участник')).toBe(
      'it-partner',
    )
    expect(personName(null, 'a.very.long.name.here@example.ru', 'второй участник')).toBe(
      'a.very.long.name',
    )
  })

  it('trims a long address without separators', () => {
    expect(personName(null, 'ooooooooooooooooooooooo@example.ru', 'второй участник')).toBe(
      'ooooooooooooooooo…',
    )
  })

  it('uses the fallback when there is nothing to show', () => {
    expect(personName(null, null, 'второй участник')).toBe('второй участник')
    expect(personName(null, '@example.ru', 'владельца')).toBe('владельца')
  })
})
