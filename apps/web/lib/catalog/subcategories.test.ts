import { subcategoryForLabel, subcategoryFromText } from '@uyut/catalog'
import { describe, expect, it } from 'vitest'

describe('subcategoryFromText', () => {
  it('письменный стол не обеденный, хотя оба столы', () => {
    expect(subcategoryFromText('table', 'Стол компьютерный №9, 2 ящика')).toBe('desk')
    expect(subcategoryFromText('table', 'Стол обеденный «Милан»')).toBe('dining')
    expect(subcategoryFromText('table', 'Столик журнальный «Дельта»')).toBe('coffee')
  })

  it('кресло, стул и табурет различаются', () => {
    expect(subcategoryFromText('chair', 'Кресло Glasar бордовое')).toBe('armchair')
    expect(subcategoryFromText('chair', 'Стул обеденный «Роза»')).toBe('chair')
    expect(subcategoryFromText('chair', 'Стул барный «Гангток»')).toBe('stool')
  })

  it('шкаф, комод и стеллаж различаются', () => {
    expect(subcategoryFromText('storage', 'Шкаф распашной Ikea Ivar')).toBe('wardrobe')
    expect(subcategoryFromText('storage', 'Комод «Кельн», 3 ящика')).toBe('dresser')
    expect(subcategoryFromText('storage', 'Стеллаж-перегородка «Ольга»')).toBe('shelving')
    expect(subcategoryFromText('storage', 'Тумба прикроватная Sherlock 64')).toBe('bedside')
  })

  it('у категорий без видов ответа нет', () => {
    expect(subcategoryFromText('sofa', 'Диван угловой «Осло»')).toBeUndefined()
    expect(subcategoryFromText('bed', 'Кровать двуспальная')).toBeUndefined()
    expect(subcategoryFromText('table', 'Артикул без слов')).toBeUndefined()
  })
})

describe('subcategoryForLabel', () => {
  it('подписи детектора переводятся в виды каталога', () => {
    expect(subcategoryForLabel('a dining table')).toBe('dining')
    expect(subcategoryForLabel('an armchair')).toBe('armchair')
    expect(subcategoryForLabel('a bar stool')).toBe('stool')
    expect(subcategoryForLabel('a sofa')).toBeUndefined()
  })
})
