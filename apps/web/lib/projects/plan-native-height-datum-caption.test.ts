import { describe, expect, it } from 'vitest'
import {
  nativeCeilingDatumDeclaration,
  nativeCeilingDatumDeclarationTopic,
} from './plan-native-height-datum-caption'

const primary =
  '4. Потолок в квартире - натяжной, отметки потолка в пределах: от 2649мм до 2684мм от уровня существующего пола.'

describe('nativeCeilingDatumDeclaration', () => {
  it('reads the literal primary note without claiming a common floor zero', () => {
    expect(nativeCeilingDatumDeclaration(primary)).toEqual({
      scope: 'apartment-finished-ceilings',
      datum: 'existing-floor',
      minimumMm: 2649,
      maximumMm: 2684,
    })
    expect(Object.keys(nativeCeilingDatumDeclaration(primary) ?? {})).toEqual([
      'scope',
      'datum',
      'minimumMm',
      'maximumMm',
    ])
  })

  it.each([
    ['2649мм', '2684мм', 2649, 2684],
    ['264.9см', '268,4см', 2649, 2684],
    ['2,649м', '2.684м', 2649, 2684],
    ['2649mm', '2684mm', 2649, 2684],
    ['264.9 cm', '268.4 cm', 2649, 2684],
    ['2.649 M', '2.684 m', 2649, 2684],
    ['2649мм', '2.684м', 2649, 2684],
    ['0.001м', '6000мм', 1, 6000],
    ['1мм', '1мм', 1, 1],
  ])('converts the two independently unit-qualified bounds %s..%s', (lower, upper, min, max) => {
    const text = primary.replace('2649мм', lower).replace('2684мм', upper)
    expect(nativeCeilingDatumDeclaration(text)).toMatchObject({ minimumMm: min, maximumMm: max })
  })

  it.each(['чистого', 'чистового', 'готового'])('reads finished-floor datum: %s', (floor) => {
    expect(nativeCeilingDatumDeclaration(primary.replace('существующего', floor))).toMatchObject({
      datum: 'finished-floor',
    })
  })

  it.each(['натяжной', 'подвесной', 'чистовой', 'чистый'])(
    'accepts an explicit finished ceiling role: %s',
    (role) => {
      expect(nativeCeilingDatumDeclaration(primary.replace('натяжной', role))).not.toBeNull()
    },
  )

  it.each(['', '1. ', '99. '])('allows only an optional bounded numbered prefix %s', (prefix) => {
    expect(nativeCeilingDatumDeclaration(primary.replace('4. ', prefix))).not.toBeNull()
  })

  it('accepts PDF line wrapping, NBSP and narrow NBSP', () => {
    expect(
      nativeCeilingDatumDeclaration(`\t${primary.replaceAll(' ', '\u00a0\n\u202f')}\r\n`),
    ).toMatchObject({ minimumMm: 2649, maximumMm: 2684 })
  })

  it.each([
    ['', ''],
    ['4. ', '0. '],
    ['4. ', '100. '],
    ['4. ', '04. '],
    ['в квартире', 'в комнате'],
    ['в квартире', 'в части квартиры'],
    ['в квартире', 'в квартире кроме санузла'],
    ['в квартире', 'в квартире и на балконе'],
    ['натяжной', 'не натяжной'],
    ['натяжной', 'предположительно натяжной'],
    ['натяжной', 'будущий натяжной'],
    ['натяжной', 'натяжной?'],
    ['натяжной', 'железобетонный'],
    ['натяжной', 'натяжной и низ балки'],
    ['от уровня существующего пола', 'без уровня существующего пола'],
    ['от уровня существующего пола', 'от уровня пола'],
    ['от уровня существующего пола', 'от существующего пола'],
    ['существующего пола', 'существующего и чистового пола'],
    ['существующего пола', 'существующего пола от уровня чистового пола'],
    ['2649мм', '2649'],
    ['2684мм', '2684'],
    ['2649мм', '2 649мм'],
    ['2649мм', '2\u00a0649мм'],
    ['2649мм', '2\u202f649мм'],
    ['2649мм', '2.649e3мм'],
    ['2649мм', '+2649мм'],
    ['2649мм', '-2649мм'],
    ['2649мм', '−2649мм'],
    ['2649мм', '±2649мм'],
    ['2649мм', '0мм'],
    ['2649мм', '0.000м'],
    ['2649мм', '2685мм'],
    ['2649мм', '6001мм'],
    ['2684мм', '6001мм'],
    ['2684мм', '2.6840м'],
    ['2649мм', '2649мм или 2648мм'],
    ['от 2649мм до 2684мм', '2649–2684мм'],
    ['от 2649мм до 2684мм', 'до 2684мм'],
    ['Потолок', 'Пото\u200bлок'],
    ['Потолок', '\u202eПотолок'],
    ['в квартире', 'в\u2003квартире'],
    ['в квартире', 'в\vквартире'],
    ['в квартире', 'в\fквартире'],
    ['пола.', 'пола. Уровень всех полов 0мм.'],
    ['пола.', 'пола. Не подтверждено.'],
    ['пола.', 'пола. Допуск 10мм.'],
  ])('withholds an unsupported or qualified note: replace %s with %s', (from, to) => {
    const text = from ? primary.replace(from, to) : ''
    expect(nativeCeilingDatumDeclaration(text)).toBeNull()
  })

  it('applies the source length limit before whitespace normalization', () => {
    expect(nativeCeilingDatumDeclaration(`${primary}${' '.repeat(201)}`)).toBeNull()
    expect(nativeCeilingDatumDeclaration(`Потолок ${' '.repeat(200)}в квартире`)).toBeNull()
  })
})

describe('nativeCeilingDatumDeclarationTopic', () => {
  it('selects the literal note for strict parsing', () => {
    expect(nativeCeilingDatumDeclarationTopic(primary)).toBe(true)
    expect(nativeCeilingDatumDeclaration(primary)).not.toBeNull()
  })

  it.each([
    primary.replace('натяжной', 'не натяжной'),
    primary.replace('натяжной', 'предположительно натяжной'),
    primary.replace('натяжной', 'планируемый натяжной'),
    primary.replace('натяжной', 'будущий натяжной'),
    primary.replace('натяжной', 'натяжной?'),
    primary.replace('в квартире', 'в части квартиры'),
    primary.replace('в квартире', 'во всей квартире'),
    primary.replace('пола.', 'пола кроме ванной.'),
    primary.replace('пола.', 'пола. В ванной другой уровень.'),
    primary.replace('2649мм', '2649мм или 2648мм'),
    primary.replace('пола.', 'пола. Допуск 10мм.'),
    primary.replace('2649мм', '2649'),
    primary.replace('существующего пола', 'существующего и чистового пола'),
    primary.replace('Потолок', 'Пото\u200bлок'),
    primary.replace('квартире', 'квар\u0000тире'),
    primary.replace('квартире', '\u202eквартире'),
    primary.replace('в квартире', 'в\u2003квартире'),
    primary.replace('в квартире', 'в\vквартире'),
    'Отметки потолков квартиры уточнить относительно уровня существующего пола.',
    'Высоты потолков в квартире от уровня пола пока не известны.',
    'Потолочные отметки квартиры в пределах 2649–2684мм.',
    'Потолок квартиры от уровня пола 2663мм; отметка балки 2500мм.',
    'Потолок в квартире - натяжной, отметки не подтверждены.',
  ])('retains an unsupported competing note as a topic: %s', (text) => {
    expect(nativeCeilingDatumDeclarationTopic(text)).toBe(true)
    expect(nativeCeilingDatumDeclaration(text)).toBeNull()
  })

  it.each([
    '',
    'натяжной-2663',
    'h1-2663мм',
    'h2=2649мм от уровня существующего пола',
    'Потолок в санузле 2649мм от уровня существующего пола.',
    'Уровень пола квартиры 0мм.',
    'Потолок в квартире - натяжной.',
    'Потолок в квартире полимерный.',
    'Отметки в квартире от уровня существующего пола.',
    'Высота шкафа квартиры 2100мм.',
  ])('does not select ordinary local labels or non-reference notes: %s', (text) => {
    expect(nativeCeilingDatumDeclarationTopic(text)).toBe(false)
  })

  it('applies the raw source length bound to topic detection as well', () => {
    expect(nativeCeilingDatumDeclarationTopic(primary.padEnd(200, ' '))).toBe(true)
    expect(nativeCeilingDatumDeclarationTopic(primary.padEnd(201, ' '))).toBe(false)
  })
})
