import { checkFit, footprintCm } from '@uyut/catalog'
import { describe, expect, it } from 'vitest'

const spots = [
  { name: 'простенок под окном', widthCm: 140 },
  { name: 'стена слева', widthCm: 320 },
]

describe('footprintCm', () => {
  it('у шкафа вдоль стены ширина, а не высота', () => {
    expect(footprintCm({ width: 100, depth: 35, height: 220 })).toBe(100)
  })

  it('у дивана вдоль стены всё та же ширина', () => {
    expect(footprintCm({ width: 220, depth: 95, height: 85 })).toBe(220)
  })

  it('использует только известные стороны основания', () => {
    expect(footprintCm({ width: 120, depth: 45 })).toBe(120)
    expect(footprintCm({ width: 120, height: 180 })).toBe(120)
    expect(footprintCm({ height: 180 })).toBeUndefined()
  })

  it('без размеров ответа нет', () => {
    expect(footprintCm(undefined)).toBeUndefined()
    expect(footprintCm({})).toBeUndefined()
  })
})

describe('checkFit', () => {
  it('не использует старые мерки для отдельно выбранного проектного контура', () => {
    expect(
      checkFit(
        { width: 400, depth: 90, height: 300 },
        {
          widthCm: 100,
          depthCm: 100,
          ceilingCm: 200,
          spots: [{ name: 'Старый простенок', widthCm: 50 }],
          projectedContour: { version: 1 },
        },
      ),
    ).toEqual({ state: 'unknown', reason: 'roomDimensions' })
  })

  it('молчим, когда нечего сравнивать', () => {
    expect(checkFit({ width: 120, depth: 45, height: 80 }, { spots: [] }).state).toBe('unknown')
    expect(checkFit(undefined, { spots })).toMatchObject({
      state: 'unknown',
      reason: 'itemDimensions',
    })
  })

  it('одна сторона товара может доказать отказ, но не положительный результат', () => {
    expect(checkFit({ width: 120 }, { spots })).toMatchObject({
      state: 'unknown',
      reason: 'itemDimensions',
    })
    expect(checkFit({ width: 360 }, { spots }).state).toBe('tooWide')
  })

  it('встаёт свободно', () => {
    expect(checkFit({ width: 120, depth: 45, height: 80 }, { spots }).state).toBe('fits')
  })

  it('не встаёт никуда и говорим насколько', () => {
    const verdict = checkFit({ width: 360, depth: 95, height: 85 }, { spots })
    expect(verdict.state).toBe('tooWide')
    expect(verdict.overCm).toBe(40)
    expect(verdict.spot?.name).toBe('стена слева')
  })

  it('впритык это отдельный ответ', () => {
    expect(checkFit({ width: 318, depth: 60, height: 200 }, { spots }).state).toBe('tight')
  })

  it('сравниваем с самым широким участком, а не с первым в списке', () => {
    const verdict = checkFit({ width: 200, depth: 60, height: 80 }, { spots })
    expect(verdict.state).toBe('fits')
    expect(verdict.spot?.widthCm).toBe(320)
  })
})

describe('высота потолка', () => {
  const spots = [{ name: 'стена слева', widthCm: 320 }]

  it('шкаф под потолок не встанет, и ширина уже не важна', () => {
    const verdict = checkFit({ width: 100, depth: 35, height: 270 }, { spots, ceilingCm: 270 })
    expect(verdict.state).toBe('tooTall')
    expect(verdict.overCm).toBe(5)
    expect(verdict.ceilingCm).toBe(270)
  })

  it('запас под потолком пять сантиметров: иначе не занести и не выровнять', () => {
    // 266 плюс запас выше потолка в 270, а в потолок 272 тот же шкаф встаёт
    expect(checkFit({ width: 100, depth: 35, height: 266 }, { spots, ceilingCm: 270 }).state).toBe(
      'tooTall',
    )
    expect(checkFit({ width: 100, depth: 35, height: 266 }, { spots, ceilingCm: 272 }).state).toBe(
      'fits',
    )
  })

  it('без высоты потолка проверяем только ширину', () => {
    expect(checkFit({ width: 100, depth: 35, height: 270 }, { spots }).state).toBe('fits')
  })

  it('без высоты проверяет только основание', () => {
    expect(checkFit({ width: 100, depth: 35 }, { spots, ceilingCm: 200 }).state).toBe('fits')
  })

  it('сравнивает указанную высоту шкафа с потолком, но не с шириной стены', () => {
    const wardrobe = { height: 236.4 }
    const limits = { spots: [{ name: 'стена', widthCm: 200 }] }
    expect(checkFit(wardrobe, limits)).toMatchObject({ state: 'unknown', reason: 'itemDimensions' })
    expect(checkFit(wardrobe, { ...limits, ceilingCm: 230 }).state).toBe('tooTall')
  })
})

describe('коробка комнаты с плана', () => {
  // Комната 290 на 425 см: длиннейшая стена 425, но чем она занята, мы не знаем
  const room = { widthCm: 290, depthCm: 425 }

  it.each([{ widthCm: 170 }, { depthCm: 170 }])(
    'одна известная сторона не определяет самую длинную стену',
    (limits) => {
      expect(checkFit({ width: 185, depth: 60, height: 236.4 }, limits)).toMatchObject({
        state: 'unknown',
        reason: 'roomDimensions',
      })
    },
  )

  it('шире самой длинной стены — не встанет ни при какой расстановке', () => {
    const verdict = checkFit({ width: 440, depth: 95, height: 85 }, room)
    expect(verdict.state).toBe('tooWide')
    expect(verdict.overCm).toBe(15)
    expect(verdict.spot?.widthCm).toBe(425)
  })

  it('уже стены — молчим: обещать «встанет» по коробке нельзя', () => {
    // Вдоль стены дверь, батарея и угол, и всей её длины под диван нет
    expect(checkFit({ width: 300, depth: 95, height: 85 }, room)).toMatchObject({
      state: 'unknown',
      reason: 'wallMeasurements',
    })
  })

  it('промеренный участок сильнее коробки: он и отвечает', () => {
    const verdict = checkFit(
      { width: 300, depth: 95, height: 85 },
      {
        ...room,
        spots: [{ name: 'стена слева', widthCm: 320 }],
      },
    )
    expect(verdict.state).toBe('fits')
    expect(verdict.spot?.name).toBe('стена слева')
  })

  it('без размеров предмета коробка не помогает', () => {
    expect(checkFit(undefined, room).state).toBe('unknown')
  })
})
