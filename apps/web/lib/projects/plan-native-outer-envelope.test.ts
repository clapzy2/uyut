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

  it('называет комнаты, выходящие за кольцо, вместо вида готового контура', () => {
    // Краска стены не доходит до низа комнаты: кольцо есть, но принимать его нельзя.
    const { work, inventory } = fixture([square(10, 10, 50, 40), square(10, 40, 40, 50)])
    const inside = nativeOuterEnvelope({
      inventory,
      work,
      rooms: [{ sourceNumber: 1, polygon: square(10, 10, 50, 40) }],
    })
    expect(inside.status).toBe('diagnostic')
    expect(inside.roomsOutside).toEqual([])
    const outside = nativeOuterEnvelope({
      inventory,
      work,
      rooms: [{ sourceNumber: 2, polygon: square(10, 40, 50, 50) }],
    })
    expect(outside.polygon).not.toBeNull()
    expect(outside.roomsOutside).toEqual([2])
  })

  it('держит оболочку при несвязных пятнах краски', () => {
    const { work, inventory } = fixture([square(10, 10, 20, 20), square(80, 80, 90, 90)])
    expect(nativeOuterEnvelope({ inventory, work })).toMatchObject({
      status: 'held',
      reason: 'multiple-paint-components',
      polygon: null,
    })
  })

  it('принимает угол кольца с доказательством пересечения двух штрихов', () => {
    // Пересечение двух полос создаёт вершину, которой на чертеже нет отдельным узлом.
    const { work, inventory } = fixture([square(10, 20, 90, 30), square(20, 10, 30, 90)])
    // Полосы обведены: пересечение их штрихов и даёт недостающий угол.
    const stroke = (index: number, a: { x: number; y: number }, b: { x: number; y: number }) =>
      ({
        operationIndex: index,
        subpathIndex: 0,
        closed: false,
        paint: 'stroke',
        points: [a, b],
      }) as never
    work.paths.push(
      stroke(50, { x: 10, y: 20 }, { x: 90, y: 20 }),
      stroke(51, { x: 10, y: 30 }, { x: 90, y: 30 }),
      stroke(52, { x: 20, y: 10 }, { x: 20, y: 90 }),
      stroke(53, { x: 30, y: 10 }, { x: 30, y: 90 }),
    )
    const result = nativeOuterEnvelope({ inventory, work })
    expect(result.status).toBe('diagnostic')
    expect(result.vertexProofs.map((proof) => proof.kind)).toContain('bounded-native-crossing')
    expect(result.polygon).not.toBeNull()
  })

  it('держит оболочку, если угол нельзя доказать пересечением', () => {
    const { work, inventory } = fixture([square(10, 20, 90, 30), square(20, 10, 30, 90)])
    expect(nativeOuterEnvelope({ inventory, work })).toMatchObject({
      status: 'held',
      reason: 'outer-envelope-vertex-not-native',
    })
  })

  it('называет короткие рёбра поимённо, с координатами и длиной', () => {
    const { work, inventory } = fixture([square(10, 10, 50, 40), square(10, 40, 50, 50)])
    expect(nativeOuterEnvelope({ inventory, work, cmPerPoint: 1 }).shortEdges).toEqual([])
    // Метрическая схема отбрасывает стену короче сантиметра и отказывается целиком.
    const short = nativeOuterEnvelope({ inventory, work, cmPerPoint: 0.01 }).shortEdges
    expect(short).toHaveLength(4)
    expect(short[0]).toEqual({
      index: 0,
      start: { x: 10, y: 10 },
      end: { x: 50, y: 10 },
      lengthCm: 0.4,
      collapses: [],
    })
  })

  it('предлагает снять уступ исходным узлом и называет комнату, которую тогда править', () => {
    // Краска комнаты на полсантиметра выше краски соседней стены: в кольце ступенька.
    const { work, inventory } = fixture([square(10, 10, 30, 50), square(30, 10.5, 60, 50)])
    const room = { sourceNumber: 2, polygon: square(10, 10, 30, 50) }
    const without = nativeOuterEnvelope({ inventory, work, cmPerPoint: 1, rooms: [room] })
    expect(without.shortEdges).toHaveLength(1)
    expect(without.shortEdges[0]?.lengthCm).toBe(0.5)
    // Узла, которым уступ снимается, на чертеже нет: остаётся ручная правка.
    expect(without.shortEdges[0]?.collapses).toEqual([])
    // Толстый штрих стены сходится в узле (10, 10.5): этот угол на чертеже есть.
    work.paths.push({
      operationIndex: 90,
      subpathIndex: 0,
      closed: false,
      paint: 'stroke',
      points: [
        { x: 10, y: 50 },
        { x: 10, y: 10.5 },
        { x: 30, y: 10.5 },
      ],
    } as never)
    const withNode = nativeOuterEnvelope({ inventory, work, cmPerPoint: 1, rooms: [room] })
    expect(withNode.shortEdges[0]?.collapses).toEqual([
      expect.objectContaining({ corner: { x: 10, y: 10.5 }, roomsOutside: [2] }),
    ])
    // Само предложение не правится: комната по-прежнему внутри исходного кольца.
    expect(withNode.roomsOutside).toEqual([])
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
