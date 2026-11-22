import { describe, expect, it } from 'vitest'
import { gdeslonLampSpec } from '../../../../packages/catalog/src/gdeslon-lamp-specs'

describe('размеры из паспорта торшера', () => {
  const externalId = '95754-1601147-18183574109169197000'
  const title = 'Торшер Citilux Арчи CL807010 цвет плафона/подвески Белый, цвет арматуры Белый'

  it('сохраняет выступ дуги отдельно от каменного основания', () => {
    const spec = gdeslonLampSpec(externalId, title)
    expect(spec?.baseCm).toEqual({ diameter: 34.5 })
    expect(spec?.dimensionsCm).toEqual({ width: 180, depth: 50, height: 190 })
    expect(spec?.sourceUrl).toBe('https://citilux.ru/store/cl807010/')
  })

  it('требует совпадения артикула и названия исходной карточки', () => {
    expect(gdeslonLampSpec(externalId, title.replace('010', '011'))).toBeUndefined()
    expect(gdeslonLampSpec('другой артикул', title)).toBeUndefined()
  })

  it('сохраняет только основание у торшера с регулируемой высотой и неизвестным вылетом', () => {
    const spec = gdeslonLampSpec('116336-765717-2892942192139467000', 'Торшер Lightstar 765717')
    expect(spec?.baseCm).toEqual({ diameter: 32 })
    expect(spec?.dimensionsCm).toEqual({})
  })

  it('удерживает габарит, когда в паспорте общий диаметр меньше диаметра подставки', () => {
    const spec = gdeslonLampSpec(
      '95754-1581329-18186343056349176000',
      'Торшер Eglo Redcliffe 43537 цвет плафона/подвески Черный, цвет арматуры Черный',
    )
    expect(spec?.baseCm).toEqual({ diameter: 25 })
    expect(spec?.dimensionsCm).toEqual({ height: 135.5 })
  })

  it('размер основания с вырезом не подменяет габарит всего STUD1', () => {
    const spec = gdeslonLampSpec(
      '95754-1464550-1096436217204427800',
      'Торшер Novotech STUD1 359545 цвет плафона/подвески Белый, цвет арматуры Белый',
    )
    expect(spec?.baseCm).toEqual({ width: 45, depth: 30 })
    expect(spec?.dimensionsCm).toEqual({ height: 194.7 })
  })
})
