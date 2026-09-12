import type { LayoutItem, Placement } from '@uyut/catalog'
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
    // Комната 180 см в ширину, шкафы занимают обе стены целиком: посередине остаются
    // шестьдесят, и обойти их негде
    const layout = layoutRoom({ widthCm: 180, depthCm: 200 }, [
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
    // Периметр 1400 минус занятые сто сантиметров. Угол уступают только боковые стены,
    // а здесь у верхней и нижней пусто, и уступать нечего
    expect(layout.freeWallCm).toBe(1300)
  })
})

/** Пересекаются ли два прямоугольника плана хотя бы на сантиметр */
function overlaps(a: Placement, b: Placement): boolean {
  return (
    a.xCm < b.xCm + b.widthCm - 0.5 &&
    b.xCm < a.xCm + a.widthCm - 0.5 &&
    a.yCm < b.yCm + b.depthCm - 0.5 &&
    b.yCm < a.yCm + a.depthCm - 0.5
  )
}

function anyOverlap(layout: ReturnType<typeof layoutRoom>): boolean {
  return layout.placed.some((one, index) =>
    layout.placed.slice(index + 1).some((other) => overlaps(one, other)),
  )
}

describe('ничто не наезжает друг на друга', () => {
  it('мебель соседних стен не встаёт в один угол', () => {
    // Комод уходил на верхнюю стену в точку (0,0), где уже стояла кровать у левой стены
    const layout = layoutRoom({ widthCm: 350, depthCm: 400 }, [
      item({
        title: 'Кровать',
        category: 'bed',
        dimensions: { width: 160, depth: 200, height: 90 },
      }),
      item({ title: 'Шкаф', dimensions: { width: 200, depth: 60, height: 220 } }),
      item({ title: 'Комод', dimensions: { width: 100, depth: 45, height: 80 } }),
    ])
    expect(anyOverlap(layout)).toBe(false)
  })

  it('четыре одинаковые тумбы по четырём стенам тоже не сходятся в углах', () => {
    const layout = layoutRoom({ widthCm: 400, depthCm: 400 }, [
      item({ title: 'Тумба', dimensions: { width: 120, depth: 40, height: 60 }, quantity: 4 }),
    ])
    expect(layout.placed).toHaveLength(4)
    expect(anyOverlap(layout)).toBe(false)
  })

  it('журнальный столик не оказывается внутри обеденного', () => {
    const layout = layoutRoom({ widthCm: 500, depthCm: 500 }, [
      item({
        title: 'Стол обеденный',
        category: 'table',
        subcategory: 'dining',
        dimensions: { width: 160, depth: 90, height: 75 },
      }),
      item({
        title: 'Столик журнальный',
        category: 'table',
        subcategory: 'coffee',
        dimensions: { width: 110, depth: 60, height: 45 },
      }),
    ])
    expect(anyOverlap(layout)).toBe(false)
  })

  it('две копии одного столика не ложатся в одну точку', () => {
    const layout = layoutRoom({ widthCm: 600, depthCm: 500 }, [
      item({
        title: 'Столик',
        category: 'table',
        subcategory: 'coffee',
        dimensions: { width: 110, depth: 60, height: 45 },
        quantity: 2,
      }),
    ])
    expect(layout.placed).toHaveLength(2)
    expect(anyOverlap(layout)).toBe(false)
  })

  it('ничего не вылезает за стены комнаты', () => {
    const layout = layoutRoom({ widthCm: 250, depthCm: 400 }, [
      item({
        title: 'Угловой диван',
        category: 'sofa',
        dimensions: { width: 260, depth: 260, height: 85 },
      }),
    ])
    for (const place of layout.placed) {
      expect(place.xCm + place.widthCm).toBeLessThanOrEqual(250.5)
      expect(place.yCm + place.depthCm).toBeLessThanOrEqual(400.5)
    }
    // Не встал — значит, об этом надо сказать, а не тихо нарисовать поверх стены
    expect(layout.problems.some((problem) => problem.kind === 'noWall')).toBe(true)
  })
})

describe('проход меряем тем, что просит предмет', () => {
  it('журнальный столик у дивана в просторной комнате не создаёт тесноты', () => {
    const layout = layoutRoom({ widthCm: 420, depthCm: 500 }, [
      item({ title: 'Диван', category: 'sofa', dimensions: { width: 220, depth: 95, height: 85 } }),
      item({
        title: 'Столик',
        category: 'table',
        subcategory: 'coffee',
        dimensions: { width: 110, depth: 60, height: 45 },
      }),
    ])
    expect(layout.problems.some((problem) => problem.kind === 'narrowWalkway')).toBe(false)
  })

  it('без мебели посередине проход меряем семьюдесятью сантиметрами', () => {
    const layout = layoutRoom({ widthCm: 180, depthCm: 200 }, [
      item({ title: 'Шкаф', dimensions: { width: 200, depth: 60, height: 220 } }),
      item({ title: 'Комод', dimensions: { width: 200, depth: 60, height: 90 } }),
    ])
    expect(layout.problems.some((problem) => problem.kind === 'narrowWalkway')).toBe(true)
  })
})

describe('кровать встаёт изголовьем к стене', () => {
  it('вдоль стены идёт ширина кровати, а не её длина', () => {
    const layout = layoutRoom({ widthCm: 300, depthCm: 400 }, [
      item({
        title: 'Кровать',
        category: 'bed',
        dimensions: { width: 180, depth: 200, height: 50 },
      }),
    ])
    const bed = layout.placed[0]
    // Кровать ушла к длинной стене, поэтому вдоль стены идёт вертикаль плана
    const alongWall = bed?.wall === 'left' || bed?.wall === 'right' ? bed?.depthCm : bed?.widthCm
    const intoRoom = bed?.wall === 'left' || bed?.wall === 'right' ? bed?.widthCm : bed?.depthCm
    expect(alongWall).toBe(180)
    expect(intoRoom).toBe(200)
  })
})

/**
 * Перебор случайных комнат.
 *
 * Расстановка — это арифметика на четырёх стенах, и её легко сломать правкой, которая
 * на трёх примерах из тестов выглядит безобидной. Генератор детерминированный: одна и та же
 * тысяча раскладок на каждом прогоне, поэтому упавший случай воспроизводится.
 */
function pseudoRandom(seed: number): () => number {
  let state = seed
  return () => {
    state = (state * 1664525 + 1013904223) % 4294967296
    return state / 4294967296
  }
}

const CATEGORIES = ['sofa', 'bed', 'storage', 'table', 'chair', 'lamp', 'rug', 'decor'] as const
const SUBCATEGORIES = [undefined, 'dining', 'coffee', 'armchair', 'floorLamp', 'wardrobe'] as const

describe('перебор случайных комнат', () => {
  it.each([20260912, 7, 999_331])(
    'ни одна раскладка не наезжает, не вылезает и не теряет предметы (зерно %i)',
    (seed) => {
      const random = pseudoRandom(seed)
      for (let round = 0; round < 1000; round += 1) {
        const roomWidth = 150 + Math.floor(random() * 500)
        const roomDepth = 150 + Math.floor(random() * 500)
        const count = 1 + Math.floor(random() * 6)
        const items: LayoutItem[] = Array.from({ length: count }, (_, index) => ({
          id: `i${index}`,
          title: `Предмет ${index}`,
          category: CATEGORIES[Math.floor(random() * CATEGORIES.length)] as LayoutItem['category'],
          subcategory: SUBCATEGORIES[
            Math.floor(random() * SUBCATEGORIES.length)
          ] as LayoutItem['subcategory'],
          dimensions: {
            width: 30 + Math.floor(random() * 270),
            depth: 30 + Math.floor(random() * 170),
            height: 30 + Math.floor(random() * 200),
          },
          quantity: 1 + Math.floor(random() * 3),
        }))
        const layout = layoutRoom({ widthCm: roomWidth, depthCm: roomDepth }, items)
        const where = `комната ${roomWidth}×${roomDepth}, предметов ${count}, круг ${round}`

        for (const place of layout.placed) {
          expect(place.xCm, where).toBeGreaterThanOrEqual(-0.5)
          expect(place.yCm, where).toBeGreaterThanOrEqual(-0.5)
          expect(place.xCm + place.widthCm, where).toBeLessThanOrEqual(roomWidth + 0.5)
          expect(place.yCm + place.depthCm, where).toBeLessThanOrEqual(roomDepth + 0.5)
        }
        expect(anyOverlap(layout), where).toBe(false)

        // Каждая купленная единица либо стоит на плане, либо названа вслух: молча пропасть нельзя
        const onFloor = items
          .filter((item) => !layout.offFloor.includes(item.title))
          .filter((item) => !layout.unmeasured.includes(item.title))
          .reduce((sum, item) => sum + item.quantity, 0)
        const named = layout.problems.filter(
          (problem) => problem.kind === 'noWall' || problem.kind === 'noCenter',
        ).length
        expect(layout.placed.length + named, where).toBe(onFloor)
        expect(layout.freeWallCm, where).toBeGreaterThanOrEqual(0)
      }
    },
  )
})

describe('честность вердикта', () => {
  it('комод встаёт на свободную стену, а не объявляется бездомным', () => {
    const layout = layoutRoom({ widthCm: 350, depthCm: 400 }, [
      item({
        title: 'Кровать',
        category: 'bed',
        dimensions: { width: 160, depth: 200, height: 90 },
      }),
      item({ title: 'Шкаф', dimensions: { width: 200, depth: 60, height: 220 } }),
      item({ title: 'Комод', dimensions: { width: 100, depth: 45, height: 80 } }),
    ])
    expect(layout.problems).toEqual([])
    expect(layout.placed).toHaveLength(3)
  })

  it('три шкафа в квадратной комнате не выпадают все разом', () => {
    const layout = layoutRoom({ widthCm: 300, depthCm: 300 }, [
      item({ title: 'Шкаф А', dimensions: { width: 300, depth: 60, height: 220 } }),
      item({ title: 'Шкаф Б', dimensions: { width: 300, depth: 60, height: 220 } }),
      item({ title: 'Комод', dimensions: { width: 200, depth: 50, height: 80 } }),
    ])
    expect(layout.placed.length).toBeGreaterThanOrEqual(2)
    expect(anyOverlap(layout)).toBe(false)
  })

  it('одинокая кровать не считается узким проходом: рядом с ней пусто', () => {
    const layout = layoutRoom({ widthCm: 400, depthCm: 250 }, [
      item({
        title: 'Кровать',
        category: 'bed',
        dimensions: { width: 160, depth: 200, height: 90 },
      }),
    ])
    expect(layout.problems).toEqual([])
  })

  it('когда стол посередине не поместился, про узкий проход всё равно говорим', () => {
    const layout = layoutRoom({ widthCm: 180, depthCm: 200 }, [
      item({ title: 'Шкаф', dimensions: { width: 200, depth: 60, height: 220 } }),
      item({ title: 'Комод', dimensions: { width: 200, depth: 60, height: 90 } }),
      item({
        title: 'Стол обеденный',
        category: 'table',
        subcategory: 'dining',
        dimensions: { width: 160, depth: 90, height: 75 },
      }),
    ])
    expect(layout.problems.map((problem) => problem.kind).sort()).toEqual([
      'narrowWalkway',
      'noCenter',
    ])
  })

  it('журнальный столик рядом с обеденным не превращается в жалобу на тесноту', () => {
    const layout = layoutRoom({ widthCm: 600, depthCm: 420 }, [
      item({
        title: 'Стол обеденный',
        category: 'table',
        subcategory: 'dining',
        dimensions: { width: 160, depth: 90, height: 75 },
      }),
      item({
        title: 'Столик',
        category: 'table',
        subcategory: 'coffee',
        dimensions: { width: 90, depth: 130, height: 45 },
      }),
    ])
    expect(layout.problems).toEqual([])
  })
})

describe('один предмет в пустой комнате', () => {
  it('если он геометрически помещается, он должен встать', () => {
    const random = pseudoRandom(31337)
    for (let round = 0; round < 500; round += 1) {
      const roomWidth = 90 + Math.floor(random() * 900)
      const roomDepth = 90 + Math.floor(random() * 900)
      const width = 30 + Math.floor(random() * 400)
      const depth = 30 + Math.floor(random() * 300)
      const layout = layoutRoom({ widthCm: roomWidth, depthCm: roomDepth }, [
        item({ title: 'Шкаф', dimensions: { width, depth, height: 200 } }),
      ])
      const fitsSomehow =
        (width <= roomWidth && depth <= roomDepth) || (depth <= roomWidth && width <= roomDepth)
      const where = `комната ${roomWidth}×${roomDepth}, шкаф ${width}×${depth}, круг ${round}`
      expect(layout.placed.length === 1, where).toBe(fitsSomehow)
    }
  })
})

/**
 * Есть ли у предмета место у какой-нибудь стены, куда он встаёт, никого не задев.
 * Перебор грубый, шагом в десять сантиметров: он и должен быть грубее самой раскладки,
 * иначе проверял бы её же логику её же средствами.
 */
function couldStandSomewhere(
  layout: ReturnType<typeof layoutRoom>,
  size: { widthCm: number; depthCm: number },
): boolean {
  const free = (x: number, y: number, w: number, d: number) =>
    x >= 0 &&
    y >= 0 &&
    x + w <= layout.widthCm &&
    y + d <= layout.depthCm &&
    !layout.placed.some(
      (place) =>
        x < place.xCm + place.widthCm - 0.5 &&
        place.xCm < x + w - 0.5 &&
        y < place.yCm + place.depthCm - 0.5 &&
        place.yCm < y + d - 0.5,
    )
  const { widthCm: w, depthCm: d } = size
  for (let along = 0; along <= Math.max(layout.widthCm, layout.depthCm); along += 10) {
    if (free(along, 0, w, d)) return true
    if (free(along, layout.depthCm - d, w, d)) return true
    if (free(0, along, d, w)) return true
    if (free(layout.widthCm - d, along, d, w)) return true
  }
  return false
}

describe('вердикт «не встаёт» должен быть правдой', () => {
  it('комод не объявляется бездомным при свободной стене', () => {
    const layout = layoutRoom({ widthCm: 500, depthCm: 300 }, [
      item({ title: 'Стенка', dimensions: { width: 500, depth: 100, height: 200 } }),
      item({ title: 'Диван', category: 'sofa', dimensions: { width: 280, depth: 40, height: 85 } }),
      item({ title: 'Комод', dimensions: { width: 210, depth: 100, height: 80 } }),
    ])
    expect(layout.problems).toEqual([])
    expect(layout.placed).toHaveLength(3)
  })

  it('второй такой же диван встаёт к противоположной стене', () => {
    const layout = layoutRoom({ widthCm: 283, depthCm: 435 }, [
      item({
        title: 'Диван',
        category: 'sofa',
        dimensions: { width: 265, depth: 193, height: 85 },
        quantity: 2,
      }),
    ])
    expect(layout.placed).toHaveLength(2)
    expect(anyOverlap(layout)).toBe(false)
  })

  it('на переборе ни один отказ не оказывается ложным', () => {
    const random = pseudoRandom(4242)
    let checked = 0
    for (let round = 0; round < 3000; round += 1) {
      const roomWidth = 120 + Math.floor(random() * 500)
      const roomDepth = 120 + Math.floor(random() * 500)
      const items: LayoutItem[] = Array.from(
        { length: 1 + Math.floor(random() * 6) },
        (_, index) => ({
          id: `i${index}`,
          title: `Предмет ${index}`,
          category: 'storage' as const,
          dimensions: {
            width: 40 + Math.floor(random() * 260),
            depth: 35 + Math.floor(random() * 120),
            height: 80,
          },
          quantity: 1,
        }),
      )
      const layout = layoutRoom({ widthCm: roomWidth, depthCm: roomDepth }, items)
      for (const problem of layout.problems) {
        if (problem.kind !== 'noWall') {
          continue
        }
        checked += 1
        // Ширина в жалобе не различает два предмета одной ширины, поэтому проверяем всех,
        // кто под неё подходит: хоть одному из них места быть не должно
        const candidates = items
          .map((one) => ({
            widthCm: one.dimensions?.width ?? 0,
            depthCm: one.dimensions?.depth ?? 0,
          }))
          .filter((one) => one.widthCm === problem.widthCm)
        if (candidates.length === 0) {
          continue
        }
        expect(
          candidates.some((size) => !couldStandSomewhere(layout, size)),
          `комната ${roomWidth}×${roomDepth}, круг ${round}: «${problem.title}» отвергнут зря`,
        ).toBe(true)
      }
    }
    expect(checked).toBeGreaterThan(0)
  })
})
