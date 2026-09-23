import { conceptLayoutContract, type LayoutItem } from '@uyut/catalog'
import type { PlanGeometry } from '@uyut/db'
import { describe, expect, it } from 'vitest'

const geometry: PlanGeometry = {
  version: 1,
  status: 'confirmed',
  widthCm: 500,
  heightCm: 400,
  warnings: [],
  walls: [
    { id: 'top', kind: 'outer', start: { xCm: 0, yCm: 0 }, end: { xCm: 500, yCm: 0 } },
    { id: 'left', kind: 'outer', start: { xCm: 0, yCm: 0 }, end: { xCm: 0, yCm: 400 } },
  ],
  openings: [
    { id: 'window', type: 'window', wallId: 'top', offsetCm: 200, widthCm: 100, sillHeightCm: 90 },
    {
      id: 'door',
      type: 'door',
      wallId: 'left',
      offsetCm: 200,
      widthCm: 80,
      clearance: { side: 'right', depthCm: 80, shape: 'rectangle' },
    },
  ],
  rooms: [
    {
      name: 'Гостиная',
      polygon: [
        { xCm: 0, yCm: 0 },
        { xCm: 500, yCm: 0 },
        { xCm: 500, yCm: 400 },
        { xCm: 0, yCm: 400 },
      ],
    },
  ],
}

const sofa: LayoutItem = {
  id: 'sofa',
  title: 'Диван',
  category: 'sofa',
  quantity: 1,
  dimensions: { width: 180, depth: 85, height: 80 },
  operationClearance: { front: 70 },
}

describe('render layout contract', () => {
  it('never substitutes a rectangular room for an unconfirmed or unmatched plan', () => {
    expect(conceptLayoutContract('Гостиная', 'living', null, undefined, [sofa])).toBeUndefined()
    expect(
      conceptLayoutContract('Гостиная', 'living', null, { ...geometry, status: 'draft' }, [sofa]),
    ).toBeUndefined()
    expect(conceptLayoutContract('Спальня', 'bedroom', null, geometry, [sofa])).toBeUndefined()
  })

  it('does not assert a verified placement with an unknown window sill or door swing', () => {
    const unsafe = {
      ...geometry,
      openings: geometry.openings.map((opening) =>
        opening.type === 'window'
          ? { ...opening, sillHeightCm: undefined }
          : { ...opening, clearance: undefined },
      ),
    }
    expect(conceptLayoutContract('Гостиная', 'living', null, unsafe, [sofa])).toBeUndefined()
  })

  it('does not send furniture positions that collide with a fixed obstacle', () => {
    const obstructed: PlanGeometry = {
      ...geometry,
      obstacles: [
        {
          id: 'fixed-zone',
          kind: 'fixed',
          xCm: 0,
          yCm: 0,
          widthCm: 500,
          depthCm: 400,
        },
      ],
    }
    expect(conceptLayoutContract('Гостиная', 'living', null, obstructed, [sofa])).toBeUndefined()
  })

  it('uses a fully checked plan and measured furniture when available', () => {
    const contract = conceptLayoutContract('Гостиная', 'living', null, geometry, [sofa])
    expect(contract).toContain('Verified top-down furniture contract')
    expect(contract).toContain('Диван')
  })
})
