import { expect, it } from 'vitest'
import { renderSourceRoutePreview } from './plan-source-route-preview'

it('draws only returned routes and escapes room names and identities', () => {
  const svg = renderSourceRoutePreview({
    freeFloor: [
      [
        [
          [0, 0],
          [200, 0],
          [200, 200],
          [0, 200],
          [0, 0],
        ],
      ],
    ],
    rooms: [
      {
        id: 'missing',
        name: '<script>Ванная</script>',
        polygon: [
          { xCm: 0, yCm: 0 },
          { xCm: 200, yCm: 0 },
          { xCm: 0, yCm: 200 },
        ],
      },
    ],
    start: { xCm: 100, yCm: 100 },
    result: {
      widthCm: 70,
      stepCm: 5,
      footprint: 'axis-aligned-square',
      status: 'unresolved',
      reason: 'no-constructed-route',
      checkedNodes: 1,
      unresolvedRoomIds: ['missing'],
      routes: [],
    },
  })
  expect(svg).not.toContain('<script>')
  expect(svg).not.toContain('<polyline')
  expect(svg).toContain('&lt;script&gt;')
  expect(svg).toContain('путь не подтверждён')
  expect(svg).toContain('width="70" height="70"')
})
