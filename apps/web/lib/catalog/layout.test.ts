import type { LayoutItem } from '@uyut/catalog'
import { layoutRoom, WALKWAY_CM } from '@uyut/catalog'
import { describe, expect, it } from 'vitest'

function item(over: Partial<LayoutItem> & Pick<LayoutItem, 'title'>): LayoutItem {
  return {
    id: over.title,
    category: 'storage',
    dimensions: { width: 100, depth: 40, height: 200 },
    quantity: 1,
    ...over,
  }
}

const kinds = (layout: ReturnType<typeof layoutRoom>) => layout.problems.map((p) => p.kind)

describe('layoutRoom', () => {
  it('без размеров комнаты расставлять не из чего', () => {
    const layout = layoutRoom({}, [item({ title: 'Шкаф' })])
    expect(kinds(layout)).toEqual(['noRoomSize'])
    expect(layout.placed).toEqual([])
  })

  it('диван встаёт к стене и не вылезает за комнату', () => {
    const layout = layoutRoom({ widthCm: 300, depthCm: 400 }, [
      item({ title: 'Диван', category: 'sofa', dimensions: { width: 220, depth: 95, height: 85 } }),
    ])
    const sofa = layout.placed[0]
    expect(layout.problems).toEqual([])
    expect(sofa?.xCm).toBeGreaterThanOrEqual(0)
    expect(sofa?.yCm).toBeGreaterThanOrEqual(0)
    expect((sofa?.xCm ?? 0) + (sofa?.widthCm ?? 0)).toBeLessThanOrEqual(300)
    expect((sofa?.yCm ?? 0) + (sofa?.depthCm ?? 0)).toBeLessThanOrEqual(400)
  })

  it('предмет шире любой стены не встаёт никуда, и мы это называем', () => {
    const layout = layoutRoom({ widthCm: 250, depthCm: 300 }, [
      item({ title: 'Стенка', dimensions: { width: 320, depth: 45, height: 200 } }),
    ])
    expect(layout.problems).toEqual([{ kind: 'noWall', title: 'Стенка', widthCm: 320 }])
    expect(layout.placed).toEqual([])
  })

  it('две тумбы подряд не встают на одно и то же место', () => {
    const layout = layoutRoom({ widthCm: 400, depthCm: 400 }, [
      item({ title: 'Тумба', dimensions: { width: 120, depth: 40, height: 60 }, quantity: 2 }),
    ])
    expect(layout.placed).toHaveLength(2)
    const [first, second] = layout.placed
    const same = first?.xCm === second?.xCm && first?.yCm === second?.yCm
    expect(same).toBe(false)
  })

  it('обеденный стол требует места на отодвинутый стул', () => {
    const table = item({
      title: 'Стол обеденный',
      category: 'table',
      subcategory: 'dining',
      dimensions: { width: 160, depth: 90, height: 75 },
    })
    // 160 плюс по 75 с двух сторон — это 310 см, в комнату 300 см такое не встанет
    expect(kinds(layoutRoom({ widthCm: 300, depthCm: 300 }, [table]))).toEqual(['noCenter'])
    expect(layoutRoom({ widthCm: 400, depthCm: 400 }, [table]).problems).toEqual([])
  })

  it('узкий проход между стенами называем числом', () => {
    // Комната 180 см в ширину, у обеих длинных стен по шестидесятисантиметровому шкафу:
    // посередине остаются шестьдесят, а это уже боком
    const layout = layoutRoom({ widthCm: 180, depthCm: 500 }, [
      item({ title: 'Шкаф', dimensions: { width: 200, depth: 60, height: 220 } }),
      item({ title: 'Комод', dimensions: { width: 200, depth: 60, height: 90 } }),
    ])
    const narrow = layout.problems.find((problem) => problem.kind === 'narrowWalkway')
    expect(narrow).toBeDefined()
    expect(layout.walkwayCm).toBeLessThan(WALKWAY_CM)
  })

  it('люстра, картина и ковёр пол не занимают', () => {
    const layout = layoutRoom({ widthCm: 300, depthCm: 400 }, [
      item({ title: 'Люстра', category: 'lamp', subcategory: 'pendant' }),
      item({ title: 'Картина', category: 'decor' }),
      item({ title: 'Ковёр', category: 'rug', dimensions: { width: 200, depth: 300 } }),
    ])
    expect(layout.offFloor).toEqual(['Люстра', 'Картина', 'Ковёр'])
    expect(layout.placed).toEqual([])
    expect(layout.problems).toEqual([])
  })

  it('торшер стоит на полу, а настольная лампа нет', () => {
    const layout = layoutRoom({ widthCm: 300, depthCm: 400 }, [
      item({
        title: 'Торшер',
        category: 'lamp',
        subcategory: 'floorLamp',
        dimensions: { width: 40, depth: 40, height: 160 },
      }),
      item({ title: 'Лампа', category: 'lamp', subcategory: 'tableLamp' }),
    ])
    expect(layout.placed.map((place) => place.title)).toEqual(['Торшер'])
    expect(layout.offFloor).toEqual(['Лампа'])
  })

  it('стулья задвинуты под стол, а кресло просит своё место', () => {
    const layout = layoutRoom({ widthCm: 400, depthCm: 400 }, [
      item({
        title: 'Стул',
        category: 'chair',
        subcategory: 'chair',
        dimensions: { width: 45, depth: 50, height: 90 },
        quantity: 4,
      }),
      item({
        title: 'Кресло',
        category: 'chair',
        subcategory: 'armchair',
        dimensions: { width: 80, depth: 85, height: 90 },
      }),
    ])
    expect(layout.placed.map((place) => place.title)).toEqual(['Кресло'])
    expect(layout.offFloor).toEqual(['Стул'])
  })

  it('товар без габаритов в карточке разместить не из чего, и мы говорим об этом', () => {
    const layout = layoutRoom({ widthCm: 300, depthCm: 400 }, [
      item({ title: 'Шкаф без размеров', dimensions: null }),
    ])
    expect(layout.unmeasured).toEqual(['Шкаф без размеров'])
    expect(layout.placed).toEqual([])
  })

  it('свободная стена остаётся числом: дверь и окно план не знает', () => {
    const layout = layoutRoom({ widthCm: 300, depthCm: 400 }, [
      item({ title: 'Шкаф', dimensions: { width: 100, depth: 60, height: 220 } }),
    ])
    // Периметр 1400 минус занятые сто сантиметров
    expect(layout.freeWallCm).toBe(1300)
  })
})
