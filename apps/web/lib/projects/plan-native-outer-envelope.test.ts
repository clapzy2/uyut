import { describe, expect, it } from 'vitest'
import { nativeOuterEnvelope } from './plan-native-outer-envelope'
import type { PdfLinework } from './plan-pdf-linework'

const square = (l: number, t: number, r: number, b: number) => [
  { x: l, y: t },
  { x: r, y: t },
  { x: r, y: b },
  { x: l, y: b },
]

function fixture(polygons: { x: number; y: number }[][]) {
  const work = {
    coordinateSystem: 'page-0-1000',
    pageWidth: 1000,
    pageHeight: 1000,
    skippedCurves: 0,
    unsupportedContexts: 0,
    unsupportedPaths: 0,
    clippedPaths: 0,
    truncated: false,
    paths: polygons.map((points, index) => ({
      operationIndex: index,
      subpathIndex: 0,
      closed: true,
      paint: 'fill' as const,
      points,
    })),
  } as unknown as PdfLinework
  const inventory = {
    refusalReason: null,
    truncated: false,
    candidates: polygons.map((polygon, index) => ({ id: `native-fill-${index}:0`, polygon })),
  } as unknown as Parameters<typeof nativeOuterEnvelope>[0]['inventory']
  return { work, inventory }
}

describe('наружная оболочка по нарисованной краске', () => {
  it('собирает одно кольцо из смежных заливок комнаты и стены', () => {
    // Комната и полоса стены под ней: объединение даёт одну внешнюю грань.
    const { work, inventory } = fixture([square(10, 10, 50, 40), square(10, 40, 50, 50)])
    const result = nativeOuterEnvelope({ inventory, work })
    expect(result.status).toBe('diagnostic')
    expect(result.polygon).toEqual(square(10, 10, 50, 50))
    expect(result.holes).toBe(0)
  })

  it('держит оболочку при несвязных пятнах краски', () => {
    const { work, inventory } = fixture([square(10, 10, 20, 20), square(80, 80, 90, 90)])
    expect(nativeOuterEnvelope({ inventory, work })).toMatchObject({
      status: 'held',
      reason: 'multiple-paint-components',
      polygon: null,
    })
  })

  it('держит оболочку, если угол кольца не исходный узел PDF', () => {
    // Пересечение двух полос создаёт вершину, которой на чертеже нет.
    const { work, inventory } = fixture([square(10, 20, 90, 30), square(20, 10, 30, 90)])
    expect(nativeOuterEnvelope({ inventory, work })).toMatchObject({
      status: 'held',
      reason: 'outer-envelope-vertex-not-native',
    })
  })

  it('держит оболочку при неполном или отказавшем перечне заливок', () => {
    const { work, inventory } = fixture([square(10, 10, 50, 50)])
    expect(
      nativeOuterEnvelope({ inventory: { ...inventory, truncated: true }, work }),
    ).toMatchObject({ status: 'held', reason: 'incomplete-fill-inventory' })
    expect(
      nativeOuterEnvelope({ inventory: { ...inventory, refusalReason: 'paint-limit' }, work }),
    ).toMatchObject({ status: 'held', reason: 'paint-limit' })
    expect(
      nativeOuterEnvelope({ inventory: { ...inventory, candidates: [] }, work }),
    ).toMatchObject({ status: 'held', reason: 'no-source-paint' })
  })

  it('держит оболочку сложнее сотни углов', () => {
    const steps = Array.from({ length: 60 }, (_, index) => [
      { x: 10 + index, y: 10 },
      { x: 11 + index, y: 10 },
      { x: 11 + index, y: 11 + (index % 2) },
      { x: 10 + index, y: 11 + (index % 2) },
    ]).flat()
    const { work, inventory } = fixture([steps])
    expect(nativeOuterEnvelope({ inventory, work }).status).toBe('held')
  })
})
