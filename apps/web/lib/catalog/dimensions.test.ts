import { hasAnyDimension, parseDimensionsCm } from '@uyut/catalog'
import { describe, expect, it } from 'vitest'

describe('parseDimensionsCm', () => {
  it('миллиметры переводятся в сантиметры', () => {
    expect(parseDimensionsCm('Стол обеденный «Милан», 1300×850×750 мм, цвет дуб')).toEqual({
      width: 130,
      depth: 85,
      height: 75,
    })
  })

  it('четырёхзначное число больше не режется до трёх цифр', () => {
    // Прежний разбор давал кровать шириной 42 см: он начинал читать с середины числа
    expect(parseDimensionsCm('Кровать односпальная «Симпл», 2042×946×700 мм')).toEqual({
      width: 204,
      depth: 95,
      height: 70,
    })
  })

  it('сантиметры остаются сантиметрами', () => {
    expect(parseDimensionsCm('Банкетка Design 150x40x60 см серый')).toEqual({
      width: 150,
      depth: 40,
      height: 60,
    })
  })

  it('без единиц измерения судим по величине числа', () => {
    expect(parseDimensionsCm('Пуф Лора 400х400х420, ТП 331')).toEqual({
      width: 40,
      depth: 40,
      height: 42,
    })
    expect(parseDimensionsCm('Комод 84х45х101')).toEqual({ width: 84, depth: 45, height: 101 })
  })

  it('пара чисел только с единицей измерения', () => {
    expect(parseDimensionsCm('Ковёр 200 x 300 см')).toEqual({ width: 200, depth: 300 })
    expect(parseDimensionsCm('Артикул 200x300 без единиц')).toEqual({})
  })

  it('неправдоподобные размеры отбрасываются по одному, а не целиком', () => {
    expect(parseDimensionsCm('Полка 120х12х30 см')).toEqual({
      width: 120,
      depth: undefined,
      height: 30,
    })
  })

  it('без чисел размеров нет', () => {
    expect(parseDimensionsCm('Диван угловой «Осло», цвет бежевый')).toEqual({})
    expect(hasAnyDimension(parseDimensionsCm('Диван угловой'))).toBe(false)
  })
})

describe('размеры, которые описывают не сам предмет', () => {
  it('спальное место дивана не считается его габаритами', () => {
    expect(
      parseDimensionsCm('Диван прямой «Манго 4», спальное место 1100×1920 мм, обивка нео'),
    ).toEqual({})
  })

  it('после оговорки берётся следующий подходящий размер', () => {
    expect(
      parseDimensionsCm('Диван «Осло», спальное место 1400×1900 мм. Габариты 2200×950×850 мм'),
    ).toEqual({ width: 220, depth: 95, height: 85 })
  })

  it('обычные габариты по-прежнему читаются', () => {
    expect(parseDimensionsCm('Комод «Кельн», 802×400×776 мм')).toEqual({
      width: 80,
      depth: 40,
      height: 78,
    })
  })
})
