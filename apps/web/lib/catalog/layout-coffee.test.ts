import { type LayoutItem, layoutRoom, roomLayoutInputFromGeometry, WALKWAY_CM } from '@uyut/catalog'
import type { PlanGeometry } from '@uyut/db'
import { describe, expect, it } from 'vitest'

function room(width = 480, window = true) {
  const geometry: PlanGeometry = {
    version: 1,
    status: 'confirmed',
    widthCm: width,
    heightCm: 560,
    warnings: [],
    walls: [
      { id: 'top', kind: 'outer', start: { xCm: 0, yCm: 0 }, end: { xCm: width, yCm: 0 } },
      { id: 'left', kind: 'outer', start: { xCm: 0, yCm: 0 }, end: { xCm: 0, yCm: 560 } },
    ],
    openings: [
      {
        id: 'door',
        type: 'door',
        wallId: 'left',
        offsetCm: 420,
        widthCm: 90,
        clearance: { side: 'right', depthCm: 90, shape: 'rectangle' },
      },
      ...(window
        ? [
            {
              id: 'window',
              type: 'window' as const,
              wallId: 'top',
              offsetCm: 150,
              widthCm: 180,
              sillHeightCm: 90,
            },
          ]
        : []),
    ],
    rooms: [
      {
        name: 'Living',
        polygon: [
          { xCm: 0, yCm: 0 },
          { xCm: width, yCm: 0 },
          { xCm: width, yCm: 560 },
          { xCm: 0, yCm: 560 },
        ],
      },
    ],
  }
  const input = roomLayoutInputFromGeometry(geometry, 'Living', null)
  if (!input) throw new Error('Invalid synthetic geometry')
  return { ...input, roomKind: 'living' as const }
}

const sofa: LayoutItem = {
  id: 'sofa',
  title: 'Three-seat sofa',
  category: 'sofa',
  quantity: 1,
  dimensions: { width: 240, depth: 95, height: 90 },
  operationClearance: { front: 30 },
}
const tv: LayoutItem = {
  id: 'tv',
  title: 'ТВ-тумба',
  category: 'storage',
  subcategory: 'cabinet',
  quantity: 1,
  dimensions: { width: 180, depth: 45, height: 55 },
  operationClearance: { front: 30 },
}
const coffee: LayoutItem = {
  id: 'coffee',
  title: 'Coffee table',
  category: 'table',
  subcategory: 'coffee',
  quantity: 1,
  dimensions: { width: 100, depth: 55, height: 40 },
  operationClearance: { around: 20 },
}
const relationship = (layout: ReturnType<typeof layoutRoom>) =>
  layout.relationships.find((relation) => relation.kind === 'sofa-coffee')

describe('coffee table placement near the sofa', () => {
  it.each([false, true])('keeps the control layout usable with pinned sofa/TV: %s', (pinned) => {
    const items: LayoutItem[] = [
      {
        ...sofa,
        ...(pinned
          ? { placement: { xCm: 0, yCm: 80, rotation: 90, frontDirection: 'right' } as const }
          : {}),
      },
      {
        ...tv,
        ...(pinned
          ? { placement: { xCm: 435, yCm: 80, rotation: 90, frontDirection: 'left' } as const }
          : {}),
      },
      coffee,
    ]
    const layout = layoutRoom(room(), items)
    expect(layout.placed).toHaveLength(3)
    expect(layout.problems).toEqual([])
    expect(layout.safetySummary.status).toBe('checked')
    expect(layout.walkwayCm).toBe(90)
    expect(relationship(layout)).toMatchObject({ status: 'checked', distanceCm: 50 })
    const reversed = layoutRoom(room(), [...items].reverse())
    expect(reversed.placed.find((item) => item.itemId === 'coffee')).toEqual(
      layout.placed.find((item) => item.itemId === 'coffee'),
    )
  })

  it('keeps an unassigned free-standing sofa front unknown despite a nearby manual table', () => {
    const layout = layoutRoom(room(480, false), [
      { ...sofa, placement: { xCm: 200, yCm: 160, rotation: 90 } },
      { ...coffee, placement: { xCm: 350, yCm: 220, rotation: 90 } },
    ])
    expect(layout.problems).toEqual([])
    expect(layout.placed.find((item) => item.itemId === 'sofa')).toMatchObject({
      xCm: 200,
      yCm: 160,
      wall: 'center',
    })
    expect(layout.placed.find((item) => item.itemId === 'coffee')).toMatchObject({
      xCm: 350,
      yCm: 220,
    })
    expect(
      layout.placementInputs.find((item) => item.id === 'sofa')?.frontDirection,
    ).toBeUndefined()
    expect(layout.functionalZones.find((zone) => zone.itemId === 'sofa')?.direction).toBe('around')
    expect(relationship(layout)).toMatchObject({ status: 'review', distanceCm: 55 })
  })

  it.each([
    { xCm: 0, yCm: 80, rotation: 90, frontDirection: 'right' },
    { xCm: 385, yCm: 80, rotation: 90, frontDirection: 'left' },
    { xCm: 120, yCm: 0, rotation: 0, frontDirection: 'down' },
    { xCm: 120, yCm: 465, rotation: 0, frontDirection: 'up' },
  ] as const)(
    'uses the measured margins in front of a sofa facing $frontDirection',
    (placement) => {
      for (const frontDirection of [placement.frontDirection, undefined]) {
        const layout = layoutRoom(room(480, false), [
          { ...sofa, placement: { ...placement, frontDirection } },
          coffee,
        ])
        expect(layout.problems).toEqual([])
        expect(layout.walkwayCm).toBeGreaterThanOrEqual(WALKWAY_CM)
        expect(relationship(layout)).toMatchObject({ status: 'checked', distanceCm: 50 })
        expect(layout.placed.find((item) => item.itemId === 'sofa')).toMatchObject({
          xCm: placement.xCm,
          yCm: placement.yCm,
        })
      }
    },
  )

  it('rotates the table when only its narrower orientation fits between operating zones', () => {
    const layout = layoutRoom(room(365, false), [
      { ...sofa, placement: { xCm: 0, yCm: 80, rotation: 90, frontDirection: 'right' } },
      { ...tv, placement: { xCm: 320, yCm: 80, rotation: 90, frontDirection: 'left' } },
      coffee,
    ])
    expect(layout.problems).toEqual([])
    expect(layout.walkwayCm).toBeGreaterThanOrEqual(WALKWAY_CM)
    expect(relationship(layout)?.status).toBe('checked')
    expect(layout.placed.find((item) => item.itemId === 'coffee')).toMatchObject({
      widthCm: 55,
      depthCm: 100,
    })
  })

  it.each([
    { width: 350, gap: 30 },
    { width: 480, gap: 45 },
  ])('prefers 45 cm but allows a safe smaller gap in a $width cm room', ({ width, gap }) => {
    const layout = layoutRoom(room(width, false), [
      {
        ...sofa,
        operationClearance: { front: 10 },
        placement: { xCm: 0, yCm: 80, rotation: 90, frontDirection: 'right' },
      },
      { ...tv, placement: { xCm: width - 45, yCm: 80, rotation: 90, frontDirection: 'left' } },
      coffee,
    ])
    expect(layout.problems).toEqual([])
    expect(layout.walkwayCm).toBeGreaterThanOrEqual(WALKWAY_CM)
    expect(relationship(layout)).toMatchObject({ status: 'checked', distanceCm: gap })
  })

  it('finds a local sofa-front pocket even when global wall depths leave no central span', () => {
    const layout = layoutRoom(room(), [
      { ...sofa, placement: { xCm: 0, yCm: 0, rotation: 90, frontDirection: 'right' } },
      {
        ...tv,
        id: 'storage',
        title: 'Storage',
        dimensions: { width: 100, depth: 300, height: 80 },
        placement: { xCm: 180, yCm: 400, rotation: 90, frontDirection: 'left' },
      },
      coffee,
    ])
    expect(layout.placed).toHaveLength(3)
    expect(layout.problems).toEqual([])
    expect(layout.walkwayCm).toBeGreaterThanOrEqual(WALKWAY_CM)
    expect(relationship(layout)).toMatchObject({ status: 'checked', distanceCm: 50 })
  })

  it('does not shrink measured margins to force an infeasible nearby table', () => {
    const layout = layoutRoom(room(), [
      {
        ...sofa,
        operationClearance: { front: 60 },
        placement: { xCm: 0, yCm: 80, rotation: 90, frontDirection: 'right' },
      },
      coffee,
    ])
    expect(relationship(layout)?.status).not.toBe('checked')
    expect(layout.walkwayCm).toBeGreaterThanOrEqual(WALKWAY_CM)
    expect(layout.operationInputs.find((item) => item.id === 'sofa')?.valueCm).toBe(60)
    expect(layout.operationInputs.find((item) => item.id === 'coffee')?.valueCm).toBe(20)
  })

  it('keeps a walkable distant candidate when a nearby table would constrain the route', () => {
    const layout = layoutRoom(room(300, false), [
      { ...sofa, placement: { xCm: 0, yCm: 80, rotation: 90, frontDirection: 'right' } },
      { ...tv, placement: { xCm: 255, yCm: 80, rotation: 90, frontDirection: 'left' } },
      coffee,
    ])
    expect(layout.placed).toHaveLength(3)
    expect(layout.problems).toEqual([])
    expect(layout.walkwayCm).toBeGreaterThanOrEqual(WALKWAY_CM)
    expect(relationship(layout)?.status).toBe('review')
  })

  it.each(['sofa', 'coffee'] as const)(
    'does not claim a missing %s operating margin was measured',
    (missing) => {
      const layout = layoutRoom(room(), [
        { ...sofa, operationClearance: missing === 'sofa' ? undefined : sofa.operationClearance },
        {
          ...coffee,
          operationClearance: missing === 'coffee' ? undefined : coffee.operationClearance,
        },
      ])
      expect(layout.safetySummary.status).not.toBe('checked')
      expect(layout.operationInputs.find((item) => item.id === missing)?.valueCm).toBeUndefined()
    },
  )

  it('does not put a close candidate inside a door clearance', () => {
    const input = room()
    input.keepClearZones.push({
      kind: 'door',
      label: 'Synthetic door swing',
      polygon: [
        { xCm: 125, yCm: 40 },
        { xCm: 310, yCm: 40 },
        { xCm: 310, yCm: 360 },
        { xCm: 125, yCm: 360 },
      ],
    })
    const layout = layoutRoom(input, [
      { ...sofa, placement: { xCm: 0, yCm: 80, rotation: 90, frontDirection: 'right' } },
      coffee,
    ])
    expect(layout.problems).toEqual([])
    expect(relationship(layout)?.status).toBe('review')
    expect(layout.walkwayCm).toBeGreaterThanOrEqual(WALKWAY_CM)
  })

  it.each([
    { name: 'behind', xCm: 100, yCm: 220, status: 'review', distanceCm: 45 },
    { name: 'beside', xCm: 210, yCm: 20, status: 'review', distanceCm: 40 },
    { name: 'in front', xCm: 350, yCm: 220, status: 'checked', distanceCm: 55 },
  ] as const)(
    'preserves manual furniture $name while checking its actual facing',
    ({ xCm, yCm, status, distanceCm }) => {
      const layout = layoutRoom(room(480, false), [
        { ...sofa, placement: { xCm: 200, yCm: 160, rotation: 90, frontDirection: 'right' } },
        { ...coffee, placement: { xCm, yCm, rotation: 90 } },
      ])
      expect(layout.problems).toEqual([])
      expect(layout.placed.find((item) => item.itemId === 'coffee')).toMatchObject({
        xCm,
        yCm,
        widthCm: 55,
        depthCm: 100,
      })
      expect(relationship(layout)).toMatchObject({
        status,
        distanceCm,
      })
    },
  )
})
