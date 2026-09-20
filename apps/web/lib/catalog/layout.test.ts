import type { LayoutItem, Placement } from '@uyut/catalog'
import { layoutRoom, WALKWAY_CM } from '@uyut/catalog'
import {
  functionalZoneRect,
  rectBlocksFloorReservation,
  reservationBlocksHeight,
  wallReservationToFloorReservation,
} from '@uyut/catalog/layout'
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
  describe('обязательные функции комнаты', () => {
    it('отдельно проверяет рабочую линию, холодильник и обеденное место кухни', () => {
      const layout = layoutRoom(
        { widthCm: 520, depthCm: 420, roomKind: 'kitchen', reservations: [] },
        [
          item({ id: 'run', title: 'Кухонный гарнитур', dimensions: { width: 240, depth: 60 } }),
          item({ id: 'fridge', title: 'Холодильник', dimensions: { width: 60, depth: 65 } }),
          item({
            id: 'dining',
            title: 'Обеденный стол',
            category: 'table',
            subcategory: 'dining',
            dimensions: { width: 100, depth: 70 },
          }),
        ],
      )

      expect(layout.functionChecks).toEqual([
        expect.objectContaining({ id: 'food-preparation', status: 'met', importance: 'required' }),
        expect.objectContaining({ id: 'cold-storage', status: 'met', importance: 'required' }),
        expect.objectContaining({ id: 'dining', status: 'met', importance: 'recommended' }),
      ])
    })

    it('не выдаёт спальню без хранения за функционально готовую', () => {
      const layout = layoutRoom(
        { widthCm: 420, depthCm: 420, roomKind: 'bedroom', reservations: [] },
        [
          item({
            id: 'bed',
            title: 'Кровать',
            category: 'bed',
            dimensions: { width: 160, depth: 200 },
            operationClearance: { side: 60 },
          }),
        ],
      )

      expect(layout.functionChecks).toContainEqual(
        expect.objectContaining({ id: 'sleeping', status: 'met' }),
      )
      expect(layout.functionChecks).toContainEqual(
        expect.objectContaining({ id: 'storage', status: 'missing', importance: 'required' }),
      )
      expect(layout.safetySummary).toMatchObject({ status: 'needs-data' })
    })

    it('просит уточнить рабочее место в детской, не называя его обязательным для дошкольника', () => {
      const layout = layoutRoom({ widthCm: 500, depthCm: 420, roomKind: 'kid', reservations: [] }, [
        item({
          id: 'bed',
          title: 'Детская кровать',
          category: 'bed',
          dimensions: { width: 90, depth: 190 },
          operationClearance: { side: 50 },
        }),
        item({ id: 'wardrobe', title: 'Шкаф', dimensions: { width: 120, depth: 55 } }),
      ])

      expect(layout.functionChecks).toContainEqual(
        expect.objectContaining({ id: 'study', status: 'review', importance: 'recommended' }),
      )
    })

    it('узнаёт студию по заметке и проверяет жилую и кухонную функции вместе', () => {
      const layout = layoutRoom(
        {
          widthCm: 600,
          depthCm: 500,
          roomKind: 'living',
          roomName: 'Моя студия',
          reservations: [],
        },
        [
          item({
            id: 'sofa-bed',
            title: 'Раскладной диван-кровать',
            category: 'sofa',
            dimensions: { width: 190, depth: 90 },
            operationClearance: { front: 140 },
          }),
          item({ id: 'run', title: 'Кухонный гарнитур', dimensions: { width: 220, depth: 60 } }),
          item({ id: 'fridge', title: 'Холодильник', dimensions: { width: 60, depth: 65 } }),
        ],
      )

      expect(layout.functionChecks).toEqual(
        expect.arrayContaining([
          expect.objectContaining({ id: 'sleeping', status: 'met' }),
          expect.objectContaining({ id: 'seating', status: 'met' }),
          expect.objectContaining({ id: 'food-preparation', status: 'met' }),
          expect.objectContaining({ id: 'cold-storage', status: 'met' }),
        ]),
      )
      expect(layout.functionProfile).toBe('studio')
    })
  })

  it('закрепляет товар в точных координатах и расставляет остальные вокруг', () => {
    const layout = layoutRoom({ widthCm: 400, depthCm: 300 }, [
      item({
        id: 'exact',
        title: 'Шкаф у правой стены',
        dimensions: { width: 120, depth: 50, height: 200 },
        placement: { xCm: 350, yCm: 40, rotation: 90 },
      }),
      item({ id: 'auto', title: 'Комод', dimensions: { width: 140, depth: 45, height: 80 } }),
    ])

    expect(layout.placed.find((place) => place.id.startsWith('exact-'))).toMatchObject({
      xCm: 350,
      yCm: 40,
      widthCm: 50,
      depthCm: 120,
      wall: 'right',
    })
    expect(layout.placed.find((place) => place.id.startsWith('auto-'))).toBeDefined()
    expect(layout.placementInputs).toContainEqual({
      id: 'exact',
      title: 'Шкаф у правой стены',
      widthCm: 120,
      depthCm: 50,
      heightCm: 200,
      xCm: 350,
      yCm: 40,
      rotation: 90,
      operationKind: 'front',
    })
  })

  it('отвергает закреплённое место поверх двери и не выдаёт его за безопасное', () => {
    const layout = layoutRoom(
      {
        widthCm: 300,
        depthCm: 300,
        reservations: [{ kind: 'door', wall: 'top', fromCm: 0, toCm: 90, clearanceCm: 90 }],
      },
      [
        item({
          title: 'Шкаф',
          dimensions: { width: 80, depth: 40, height: 200 },
          placement: { xCm: 5, yCm: 5, rotation: 0 },
        }),
      ],
    )

    expect(layout.placed).toEqual([])
    expect(layout.problems).toContainEqual({
      kind: 'invalidPlacement',
      title: 'Шкаф',
      reason: 'blocked',
    })
  })

  it('показывает, какие рабочие зоны мебели ещё нужно измерить', () => {
    const layout = layoutRoom({ widthCm: 400, depthCm: 400 }, [
      item({ title: 'Шкаф', subcategory: 'wardrobe' }),
      item({ title: 'Кровать', category: 'bed', subcategory: undefined }),
    ])

    expect(layout.operationInputs).toEqual([
      { id: 'Шкаф', title: 'Шкаф', kind: 'front' },
      { id: 'Кровать', title: 'Кровать', kind: 'side' },
    ])
  })

  it('просит точное место для кресла у рабочего стола', () => {
    const layout = layoutRoom({ widthCm: 300, depthCm: 400 }, [
      item({
        title: 'Рабочий стол',
        category: 'table',
        subcategory: 'desk',
        dimensions: { width: 120, depth: 60, height: 75 },
      }),
    ])

    expect(layout.operationInputs).toContainEqual({
      id: 'Рабочий стол',
      title: 'Рабочий стол',
      kind: 'front',
    })
    expect(layout.functionalZones).toEqual([])
  })

  it('не ставит мебель в измеренную зону открывания соседнего шкафа', () => {
    const layout = layoutRoom({ widthCm: 300, depthCm: 200 }, [
      item({
        id: 'first',
        title: 'Шкаф 1',
        subcategory: 'wardrobe',
        dimensions: { width: 300, depth: 40, height: 200 },
        operationClearance: { front: 100 },
      }),
      item({
        id: 'second',
        title: 'Шкаф 2',
        subcategory: 'wardrobe',
        dimensions: { width: 300, depth: 40, height: 200 },
        operationClearance: { front: 100 },
      }),
    ])

    expect(layout.placed).toHaveLength(1)
    expect(layout.functionalZones).toHaveLength(1)
    expect(layout.functionalZones[0]).toMatchObject({
      itemId: 'first',
      placementId: layout.placed[0]?.id,
      kind: 'front',
      source: 'measured',
      clearanceCm: 100,
    })
    expect(kinds(layout)).toContain('noWall')
  })

  it('не принимает рабочую зону, которая выходит за контур комнаты', () => {
    const layout = layoutRoom({ widthCm: 220, depthCm: 120 }, [
      item({
        title: 'Диван',
        category: 'sofa',
        dimensions: { width: 220, depth: 80 },
        operationClearance: { front: 80 },
      }),
    ])

    expect(layout.placed).toEqual([])
    expect(kinds(layout)).toEqual(['noWall'])
  })

  it('отличает предварительный запас у стола от измеренного', () => {
    const preliminary = layoutRoom({ widthCm: 400, depthCm: 400 }, [
      item({
        title: 'Стол',
        category: 'table',
        subcategory: 'dining',
        dimensions: { width: 120, depth: 80 },
      }),
    ])
    const measured = layoutRoom({ widthCm: 400, depthCm: 400 }, [
      item({
        title: 'Стол',
        category: 'table',
        subcategory: 'dining',
        dimensions: { width: 120, depth: 80 },
        operationClearance: { around: 60 },
      }),
    ])

    expect(preliminary.functionalZones[0]).toMatchObject({
      source: 'preliminary',
      clearanceCm: 75,
    })
    expect(measured.functionalZones[0]).toMatchObject({ source: 'measured', clearanceCm: 60 })
  })

  it('проверяет точный боковой подход к кровати в спальне', () => {
    const layout = layoutRoom({ widthCm: 500, depthCm: 500, roomKind: 'bedroom' }, [
      item({
        id: 'bed',
        title: 'Кровать',
        category: 'bed',
        dimensions: { width: 200, depth: 160, height: 90 },
        operationClearance: { side: 50 },
      }),
    ])

    expect(layout.safetyChecks).toContainEqual({
      id: 'bed-side',
      label: 'Подход к кровати «Кровать»',
      detail: 'Точный запас 50 см учтён в расстановке.',
      status: 'checked',
    })
    expect(layout.operationInputs[0]?.guidance).toContain('подход с каждого бока')
  })

  it('не выдаёт диван за проверенный без размера разложенной части', () => {
    const layout = layoutRoom({ widthCm: 500, depthCm: 400, roomKind: 'living' }, [
      item({
        id: 'sofa',
        title: 'Диван',
        category: 'sofa',
        dimensions: { width: 200, depth: 90, height: 85 },
      }),
    ])

    expect(layout.safetyChecks.find((check) => check.id === 'sofa-front')).toMatchObject({
      status: 'needs-data',
      detail: expect.stringContaining('вылет разложенной части'),
    })
  })

  it('помечает типовой запас у обеденного стола как предварительный', () => {
    const layout = layoutRoom({ widthCm: 500, depthCm: 500, roomKind: 'kitchen' }, [
      item({
        id: 'table',
        title: 'Обеденный стол',
        category: 'table',
        subcategory: 'dining',
        dimensions: { width: 120, depth: 80, height: 75 },
      }),
    ])

    expect(layout.safetyChecks.find((check) => check.id === 'table-around')).toMatchObject({
      status: 'preliminary',
      detail: 'Пока использован предварительный запас 75 см.',
    })
  })

  it('просит место под кресло у рабочего стола в детской', () => {
    const layout = layoutRoom({ widthCm: 400, depthCm: 400, roomKind: 'kid' }, [
      item({
        id: 'desk',
        title: 'Рабочий стол',
        category: 'table',
        subcategory: 'desk',
        dimensions: { width: 120, depth: 60, height: 75 },
      }),
    ])

    expect(layout.safetyChecks.find((check) => check.id === 'desk-front')).toMatchObject({
      status: 'needs-data',
      detail: expect.stringContaining('место для кресла'),
    })
  })

  it('показывает, когда мебель вместе с точной рабочей зоной не проходит', () => {
    const layout = layoutRoom({ widthCm: 220, depthCm: 120, roomKind: 'living' }, [
      item({
        id: 'sofa',
        title: 'Диван',
        category: 'sofa',
        dimensions: { width: 220, depth: 80 },
        operationClearance: { front: 80 },
      }),
    ])

    expect(layout.safetyChecks.find((check) => check.id === 'sofa-front')).toMatchObject({
      status: 'blocked',
      detail: 'Безопасное место вместе с рабочей зоной не найдено.',
    })
    expect(layout.safetySummary.status).toBe('blocked')
  })

  it('не даёт зелёный итог, пока неизвестно положение проёмов', () => {
    const layout = layoutRoom({ widthCm: 500, depthCm: 400, roomKind: 'living' }, [
      item({
        id: 'armchair',
        title: 'Кресло',
        category: 'chair',
        subcategory: 'armchair',
        dimensions: { width: 80, depth: 80, height: 90 },
      }),
    ])

    expect(layout.problems).toEqual([])
    expect(layout.safetySummary).toMatchObject({
      status: 'needs-data',
      title: 'Нужны данные перед покупкой',
      detail: expect.stringContaining('дверей, окон и радиаторов'),
    })
  })

  it('помечает расчёт как предварительный, когда проёмы взяты только из описания', () => {
    const layout = layoutRoom(
      {
        widthCm: 500,
        depthCm: 400,
        roomKind: 'living',
        layoutNotes: 'На верхней стене окно 120 см от 100 до 220 см',
      },
      [
        item({
          id: 'armchair',
          title: 'Кресло',
          category: 'chair',
          subcategory: 'armchair',
          dimensions: { width: 80, depth: 80, height: 90 },
        }),
      ],
    )

    expect(layout.reservationSource).toBe('description')
    expect(layout.safetySummary.status).toBe('preliminary')
  })

  it('даёт проверенный итог только с точными проёмами и рабочими зонами', () => {
    const layout = layoutRoom(
      {
        widthCm: 500,
        depthCm: 500,
        roomKind: 'bedroom',
        reservations: [],
        floorReservations: [],
      },
      [
        item({
          id: 'bed',
          title: 'Кровать',
          category: 'bed',
          dimensions: { width: 200, depth: 160, height: 90 },
          operationClearance: { side: 50 },
        }),
        item({
          id: 'wardrobe',
          title: 'Шкаф',
          dimensions: { width: 120, depth: 55, height: 220 },
          operationClearance: { front: 60 },
        }),
      ],
    )

    expect(layout.safetySummary).toEqual({
      status: 'checked',
      title: 'Базовые проверки пройдены',
      detail: 'Габариты, рабочие зоны, проёмы и непрерывный проход учтены в текущей схеме.',
    })
  })

  it('связывает каждую рабочую зону с конкретным экземпляром товара', () => {
    const layout = layoutRoom({ widthCm: 500, depthCm: 500 }, [
      item({
        id: 'sofa',
        title: 'Два дивана',
        category: 'sofa',
        quantity: 2,
        dimensions: { width: 160, depth: 70 },
        operationClearance: { front: 60 },
      }),
    ])

    expect(layout.placed).toHaveLength(2)
    expect(layout.functionalZones).toHaveLength(2)
    expect(new Set(layout.functionalZones.map((zone) => zone.placementId))).toEqual(
      new Set(layout.placed.map((place) => place.id)),
    )
  })

  it('пересчитывает рабочую зону в ту сторону, куда обращена мебель', () => {
    const rect = { xCm: 40, yCm: 30, widthCm: 120, depthCm: 50 }
    const requirement = { kind: 'front' as const, clearanceCm: 70 }

    expect(functionalZoneRect(rect, requirement, 'down')).toEqual({
      xCm: 40,
      yCm: 30,
      widthCm: 120,
      depthCm: 120,
    })
    expect(functionalZoneRect(rect, requirement, 'left')).toEqual({
      xCm: -30,
      yCm: 30,
      widthCm: 190,
      depthCm: 50,
    })
  })

  it('использует указанное направление у отдельно стоящей мебели', () => {
    const layout = layoutRoom({ widthCm: 500, depthCm: 400 }, [
      item({
        id: 'wardrobe',
        title: 'Шкаф в центре',
        subcategory: 'wardrobe',
        dimensions: { width: 100, depth: 40, height: 200 },
        operationClearance: { front: 80 },
        placement: { xCm: 180, yCm: 160, rotation: 0, frontDirection: 'right' },
      }),
    ])

    expect(layout.problems).toEqual([])
    expect(layout.functionalZones[0]).toMatchObject({
      direction: 'right',
      xCm: 180,
      yCm: 160,
      widthCm: 180,
      depthCm: 40,
    })
    expect(layout.placementInputs[0]).toMatchObject({
      frontDirection: 'right',
      operationKind: 'front',
    })
  })

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

  it('не ставит мебель на явно указанные проёмы', () => {
    const layout = layoutRoom(
      {
        widthCm: 220,
        depthCm: 250,
        layoutNotes: 'Дверь слева шириной 250 см, балкон справа шириной 250 см',
      },
      [item({ title: 'Шкаф', dimensions: { width: 250, depth: 40, height: 200 } })],
    )

    expect(layout.reservations).toHaveLength(2)
    expect(layout.placed).toEqual([])
    expect(layout.problems).toContainEqual({ kind: 'noWall', title: 'Шкаф', widthCm: 250 })
  })

  it('точные проёмы из 2D-схемы важнее текстового описания', () => {
    const layout = layoutRoom(
      {
        widthCm: 300,
        depthCm: 400,
        layoutNotes: 'Окно снизу шириной 120 см',
        reservations: [{ kind: 'door', wall: 'top', fromCm: 35, toCm: 125, clearanceCm: 90 }],
      },
      [item({ title: 'Тумба', dimensions: { width: 100, depth: 40, height: 60 } })],
    )

    expect(layout.reservationSource).toBe('geometry')
    expect(layout.reservations).toEqual([
      { kind: 'door', wall: 'top', fromCm: 35, toCm: 125, clearanceCm: 90 },
    ])
  })

  it('ставит низкую мебель под окно только при известных высотах', () => {
    const room = {
      widthCm: 150,
      depthCm: 140,
      reservations: [
        {
          kind: 'window' as const,
          wall: 'top' as const,
          fromCm: 0,
          toCm: 150,
          clearanceCm: 0,
          sillHeightCm: 90,
        },
      ],
    }
    const low = layoutRoom(room, [
      item({ title: 'Комод', dimensions: { width: 150, depth: 40, height: 80 } }),
    ])
    expect(low.placed[0]?.wall).toBe('top')
    const tall = layoutRoom(room, [
      item({ title: 'Шкаф', dimensions: { width: 150, depth: 40, height: 200 } }),
    ])
    expect(tall.placed[0]?.wall).not.toBe('top')
    const unknownSill = layoutRoom(
      {
        ...room,
        reservations: [
          {
            kind: 'window',
            wall: 'top',
            fromCm: 0,
            toCm: 150,
            clearanceCm: 0,
          },
        ],
      },
      [item({ title: 'Комод', dimensions: { width: 150, depth: 40, height: 80 } })],
    )
    expect(unknownSill.placed[0]?.wall).not.toBe('top')
  })

  it('одинаково проверяет линию окна для автоматической и ручной расстановки', () => {
    const window = wallReservationToFloorReservation(
      {
        kind: 'window',
        wall: 'top',
        fromCm: 20,
        toCm: 120,
        clearanceCm: 0,
        sillHeightCm: 90,
      },
      300,
      400,
    )
    const furniture = { xCm: 20, yCm: 0, widthCm: 100, depthCm: 40 }

    expect(rectBlocksFloorReservation(furniture, window)).toBe(true)
    expect(reservationBlocksHeight(window, { heightCm: 80 })).toBe(false)
    expect(reservationBlocksHeight(window, { heightCm: 180 })).toBe(true)
    expect(reservationBlocksHeight({ ...window, sillHeightCm: undefined }, { heightCm: 80 })).toBe(
      true,
    )
  })

  it('не ставит мебель в точную дугу двери или зону радиатора', () => {
    const result = layoutRoom(
      {
        widthCm: 200,
        depthCm: 140,
        keepClearZones: [
          {
            kind: 'door',
            label: 'Дуга двери',
            polygon: [
              { xCm: 0, yCm: 0 },
              { xCm: 120, yCm: 0 },
              { xCm: 120, yCm: 140 },
              { xCm: 0, yCm: 140 },
            ],
          },
          {
            kind: 'radiator',
            label: 'Радиатор',
            polygon: [
              { xCm: 120, yCm: 0 },
              { xCm: 200, yCm: 0 },
              { xCm: 200, yCm: 140 },
              { xCm: 120, yCm: 140 },
            ],
          },
        ],
      },
      [item({ title: 'Комод', dimensions: { width: 100, depth: 40, height: 80 } })],
    )
    expect(result.placed).toEqual([])
    expect(result.problems).toContainEqual({ kind: 'noWall', title: 'Комод', widthCm: 100 })
  })

  it('не прокладывает проход сквозь колонну, но разрешает идти через зону двери', () => {
    const polygon = [
      { xCm: 0, yCm: 120 },
      { xCm: 180, yCm: 120 },
      { xCm: 180, yCm: 280 },
      { xCm: 0, yCm: 280 },
    ]
    const furniture = [
      item({
        id: 'chair',
        title: 'Кресло',
        category: 'chair',
        subcategory: 'armchair',
        dimensions: { width: 60, depth: 60, height: 80 },
      }),
    ]
    const base = {
      roomKind: 'living' as const,
      widthCm: 240,
      depthCm: 400,
      reservations: [],
      floorReservations: [],
    }
    const obstacle = layoutRoom(
      {
        ...base,
        keepClearZones: [{ kind: 'obstacle', label: 'Колонна', polygon }],
      },
      furniture,
    )
    const radiator = layoutRoom(
      {
        ...base,
        keepClearZones: [{ kind: 'radiator', label: 'Радиатор', polygon }],
      },
      furniture,
    )
    const door = layoutRoom(
      {
        ...base,
        keepClearZones: [{ kind: 'door', label: 'Дуга двери', polygon }],
      },
      furniture,
    )

    expect(obstacle.walkwayCm).toBe(60)
    expect(obstacle.problems).toContainEqual({ kind: 'narrowWalkway', gapCm: 60 })
    expect(radiator.walkwayCm).toBe(60)
    expect(radiator.problems).toContainEqual({ kind: 'narrowWalkway', gapCm: 60 })
    expect(door.walkwayCm).toBeGreaterThanOrEqual(WALKWAY_CM)
    expect(door.problems.some((problem) => problem.kind === 'narrowWalkway')).toBe(false)
  })

  it('оставляет свободной зону открывания двери перед стеной', () => {
    const layout = layoutRoom(
      {
        widthCm: 310,
        depthCm: 220,
        layoutNotes: 'Дверь снизу шириной 90 см',
      },
      [
        item({
          title: 'Стол обеденный',
          category: 'table',
          subcategory: 'dining',
          dimensions: { width: 100, depth: 60, height: 75 },
        }),
      ],
    )

    expect(layout.placed).toEqual([])
    expect(layout.problems).toContainEqual({ kind: 'noCenter', title: 'Стол обеденный' })
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
    expect(layout.unmeasured.map((one) => one.title)).toEqual(['Шкаф без размеров'])
    expect(layout.placed).toEqual([])
  })

  it('товар только с шириной не получает выдуманную глубину', () => {
    const layout = layoutRoom({ widthCm: 300, depthCm: 400 }, [
      item({ title: 'Комод без глубины', dimensions: { width: 120 } }),
    ])
    expect(layout.unmeasured.map((one) => one.title)).toEqual(['Комод без глубины'])
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

  it('рабочая зона остаётся свободной от мебели, но не становится стеной для человека', () => {
    const layout = layoutRoom(
      {
        roomKind: 'kitchen',
        widthCm: 420,
        depthCm: 480,
        reservations: [
          { kind: 'window', wall: 'top', fromCm: 120, toCm: 240, clearanceCm: 0 },
          { kind: 'door', wall: 'bottom', fromCm: 0, toCm: 90, clearanceCm: 90 },
        ],
        floorReservations: [],
      },
      [
        item({
          id: 'run',
          title: 'Кухонный гарнитур',
          category: 'storage',
          subcategory: 'cabinet',
          dimensions: { width: 240, depth: 60, height: 90 },
          operationClearance: { front: 80 },
        }),
        item({
          id: 'fridge',
          title: 'Холодильник',
          category: 'storage',
          subcategory: 'wardrobe',
          dimensions: { width: 60, depth: 65, height: 200 },
          operationClearance: { front: 70 },
        }),
        item({
          id: 'table',
          title: 'Обеденный стол',
          category: 'table',
          subcategory: 'dining',
          dimensions: { width: 110, depth: 70, height: 75 },
          operationClearance: { around: 65 },
        }),
      ],
    )

    expect(layout.functionalZones).toHaveLength(3)
    expect(layout.problems).toEqual([])
    expect(layout.walkwayCm).toBeGreaterThanOrEqual(WALKWAY_CM)
    expect(layout.safetySummary.status).toBe('checked')
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
          .filter((item) => !layout.unmeasured.some((one) => one.title === item.title))
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

describe('нестандартный контур комнаты', () => {
  const floorPolygon = [
    { xCm: 0, yCm: 0 },
    { xCm: 300, yCm: 0 },
    { xCm: 300, yCm: 100 },
    { xCm: 100, yCm: 100 },
    { xCm: 100, yCm: 300 },
    { xCm: 0, yCm: 300 },
  ]

  it('не считает вырез Г-образной комнаты свободным полом', () => {
    const layout = layoutRoom({ widthCm: 300, depthCm: 300, floorPolygon }, [
      item({
        title: 'Тумба',
        dimensions: { width: 120, depth: 40, height: 60 },
        quantity: 4,
      }),
    ])

    expect(layout.floorPolygon).toEqual(floorPolygon)
    expect(layout.placed.length).toBeGreaterThan(0)
    for (const place of layout.placed) {
      const entersCutout = place.xCm + place.widthCm > 100 && place.yCm + place.depthCm > 100
      expect(entersCutout, `${place.title} попала в вырез комнаты`).toBe(false)
    }
  })

  it('считает весь реальный периметр, включая стены ниши', () => {
    const layout = layoutRoom({ widthCm: 300, depthCm: 300, floorPolygon }, [])

    expect(layout.freeWallCm).toBe(1200)
  })

  it('использует внутреннюю стену ниши, когда внешние стены заняты', () => {
    const layout = layoutRoom(
      {
        widthCm: 300,
        depthCm: 300,
        floorPolygon,
        reservations: [
          { kind: 'window', wall: 'top', fromCm: 0, toCm: 300, clearanceCm: 0 },
          { kind: 'window', wall: 'right', fromCm: 0, toCm: 100, clearanceCm: 0 },
          { kind: 'window', wall: 'bottom', fromCm: 0, toCm: 100, clearanceCm: 0 },
          { kind: 'window', wall: 'left', fromCm: 0, toCm: 300, clearanceCm: 0 },
        ],
      },
      [item({ title: 'Комод', dimensions: { width: 150, depth: 40, height: 80 } })],
    )

    expect(layout.placed).toHaveLength(1)
    expect(layout.placed[0]?.wall).toBe('perimeter')
  })

  it('не закрывает проём на внутренней стене', () => {
    const layout = layoutRoom(
      {
        widthCm: 300,
        depthCm: 300,
        floorPolygon,
        reservations: [
          { kind: 'window', wall: 'top', fromCm: 0, toCm: 300, clearanceCm: 0 },
          { kind: 'window', wall: 'right', fromCm: 0, toCm: 100, clearanceCm: 0 },
          { kind: 'window', wall: 'bottom', fromCm: 0, toCm: 100, clearanceCm: 0 },
          { kind: 'window', wall: 'left', fromCm: 0, toCm: 300, clearanceCm: 0 },
        ],
        floorReservations: [
          {
            kind: 'window',
            start: { xCm: 100, yCm: 100 },
            end: { xCm: 300, yCm: 100 },
            clearanceCm: 0,
          },
          {
            kind: 'door',
            start: { xCm: 100, yCm: 100 },
            end: { xCm: 100, yCm: 300 },
            clearanceCm: 90,
          },
        ],
      },
      [item({ title: 'Комод', dimensions: { width: 150, depth: 40, height: 80 } })],
    )

    expect(layout.placed).toEqual([])
    expect(layout.problems).toContainEqual({ kind: 'noWall', title: 'Комод', widthCm: 150 })
    expect(layout.rejections).toContainEqual({
      itemId: 'Комод',
      title: 'Комод',
      reason: 'architecture',
      detail: 'Все найденные места перекрывают дверь, окно, радиатор или препятствие.',
    })
  })

  it('объясняет, когда входит мебель, но не её рабочая зона', () => {
    const layout = layoutRoom(
      { widthCm: 220, depthCm: 220, roomKind: 'living', reservations: [] },
      [
        item({
          title: 'Раскладной диван',
          category: 'sofa',
          dimensions: { width: 140, depth: 70, height: 80 },
          operationClearance: { front: 200 },
        }),
      ],
    )

    expect(layout.placed).toEqual([])
    expect(layout.rejections[0]).toMatchObject({
      title: 'Раскладной диван',
      reason: 'operation-zone',
    })
  })
})
