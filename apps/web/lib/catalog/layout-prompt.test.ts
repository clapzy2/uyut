import { type LayoutItem, layoutPromptContract, layoutRoom } from '@uyut/catalog'
import { describe, expect, it } from 'vitest'

const item = (
  id: string,
  title: string,
  category: LayoutItem['category'],
  width: number,
  depth: number,
  subcategory?: LayoutItem['subcategory'],
): LayoutItem => ({
  id,
  title,
  category,
  subcategory,
  dimensions: { width, depth, height: 90 },
  quantity: 1,
})

describe('контракт расстановки для генератора', () => {
  for (const roomKind of ['bedroom', 'kid'] as const) {
    for (const clearances of [
      [null, null],
      [{ side: 40 }, null],
      [null, { front: 50 }],
      [{ front: 40 }, { front: 50 }],
      [{ side: 0 }, { front: 50 }],
    ] as const) {
      it(`не подтверждает рабочие зоны ${roomKind} при неполных запасах ${JSON.stringify(clearances)}`, () => {
        const layout = layoutRoom({ roomKind, widthCm: 600, depthCm: 600, reservations: [] }, [
          { ...item('bed', 'Кровать', 'bed', 160, 200), operationClearance: clearances[0] },
          { ...item('storage', 'Шкаф', 'storage', 100, 50), operationClearance: clearances[1] },
        ])
        expect(layout.placed).toHaveLength(2)
        expect(
          layout.relationships.find((relation) => relation.kind === 'bed-storage'),
        ).toMatchObject({
          status: 'needs-data',
        })
        expect(layoutPromptContract(layout)).not.toContain(
          'keep their operating clearances separate',
        )
      })
    }

    it(`подтверждает заданные и размещённые рабочие зоны ${roomKind}`, () => {
      const layout = layoutRoom({ roomKind, widthCm: 600, depthCm: 600, reservations: [] }, [
        { ...item('bed', 'Кровать', 'bed', 160, 200), operationClearance: { side: 40 } },
        { ...item('storage', 'Шкаф', 'storage', 100, 50), operationClearance: { front: 50 } },
      ])
      expect(layout.placed).toHaveLength(2)
      expect(layout.functionalZones).toHaveLength(2)
      expect(
        layout.relationships.find((relation) => relation.kind === 'bed-storage'),
      ).toMatchObject({
        status: 'checked',
      })
      expect(layoutPromptContract(layout)).toContain('keep their operating clearances separate')
    })
  }

  it('не скрывает неизвестную зону второго шкафа за проверенной первой парой', () => {
    const layout = layoutRoom(
      { roomKind: 'bedroom', widthCm: 800, depthCm: 800, reservations: [] },
      [
        { ...item('bed', 'Кровать', 'bed', 160, 200), operationClearance: { side: 40 } },
        { ...item('storage', 'Шкаф', 'storage', 100, 50), operationClearance: { front: 50 } },
        item('storage-2', 'Второй шкаф', 'storage', 100, 50),
      ],
    )
    expect(layout.placed).toHaveLength(3)
    expect(layout.relationships.find((relation) => relation.kind === 'bed-storage')).toMatchObject({
      status: 'needs-data',
    })
    expect(layoutPromptContract(layout)).not.toContain('keep their operating clearances separate')
  })

  it('передаёт модели рассчитанные координаты, стены и проход', () => {
    const layout = layoutRoom(
      { roomKind: 'living', widthCm: 480, depthCm: 560, reservations: [] },
      [
        item('sofa', 'Sofa', 'sofa', 240, 95),
        item('tv', 'TV cabinet', 'storage', 180, 45, 'cabinet'),
        item('table', 'Coffee table', 'table', 100, 55, 'coffee'),
      ],
    )

    const contract = layoutPromptContract(layout)

    expect(contract).toContain('480 by 560 cm room')
    expect(contract).toMatch(/Sofa: (240 by 95|95 by 240) cm footprint/)
    expect(contract).toContain('x=')
    expect(contract).toContain('narrowest clear route')
    expect(contract).toContain('Functional relationships:')
  })

  it('не обещает расстановку без размеров или размещённых предметов', () => {
    expect(layoutPromptContract(layoutRoom({}, []))).toBe('')
  })

  it('не обещает удобный журнальный стол, если зона раскладного дивана отодвинула его', () => {
    const sofa = item('sofa', 'Раскладной диван', 'sofa', 240, 95)
    const layout = layoutRoom(
      { roomKind: 'living', widthCm: 480, depthCm: 560, reservations: [] },
      [
        { ...sofa, operationClearance: { front: 130 } },
        {
          ...item('table', 'Журнальный стол', 'table', 100, 55, 'coffee'),
          operationClearance: { around: 35 },
        },
      ],
    )

    expect(layout.relationships.find((relation) => relation.kind === 'sofa-coffee')).toMatchObject({
      status: 'review',
      distanceCm: expect.any(Number),
    })
    expect(layoutPromptContract(layout)).not.toContain(
      'the coffee table remains directly usable from the sofa',
    )
  })
})
