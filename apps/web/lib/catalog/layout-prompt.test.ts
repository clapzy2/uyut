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
})
