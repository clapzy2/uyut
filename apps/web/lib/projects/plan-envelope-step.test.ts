import type { PlanPageVertexProof } from '@uyut/db'
import { describe, expect, it } from 'vitest'
import { collapseEnvelopeStep, envelopeStepCollapses } from './plan-envelope-step'

// Кольцо с уступом в полсантиметра у верхней грани: ребро 1-2 короткое и вертикальное.
const ring = [
  { x: 10, y: 10 },
  { x: 30, y: 10 },
  { x: 30, y: 10.5 },
  { x: 60, y: 10.5 },
  { x: 60, y: 50 },
  { x: 10, y: 50 },
]
const nodes = (...points: { x: number; y: number }[]) =>
  new Set([...ring, ...points].map((point) => `${point.x}:${point.y}`))

const proof = (vertexIndex: number) =>
  ({ vertexIndex, kind: 'bounded-native-crossing', segments: [] }) as unknown as PlanPageVertexProof

describe('снятие уступа оболочки по исходным узлам', () => {
  it('предлагает только тот угол, который есть среди узлов PDF', () => {
    const collapses = envelopeStepCollapses(ring, [], 1, nodes({ x: 10, y: 10.5 }))
    expect(collapses).toEqual([{ corner: { x: 10, y: 10.5 }, replaces: [0, 1, 2] }])
    const both = envelopeStepCollapses(ring, [], 1, nodes({ x: 10, y: 10.5 }, { x: 60, y: 10 }))
    expect(both.map((option) => option.corner)).toEqual([
      { x: 10, y: 10.5 },
      { x: 60, y: 10 },
    ])
  })

  it('не предлагает ничего, если нового угла на чертеже нет', () => {
    expect(envelopeStepCollapses(ring, [], 1, nodes())).toEqual([])
  })

  it('не трогает косое ребро и ребро без поперечных соседей', () => {
    const slanted = ring.map((point, index) => (index === 2 ? { x: 30.2, y: 10.5 } : point))
    expect(envelopeStepCollapses(slanted, [], 1, nodes({ x: 10, y: 10.5 }))).toEqual([])
    // После уступа кольцо идёт дальше вниз по той же линии: это не ступенька, а излом.
    const collinear = [
      { x: 10, y: 10 },
      { x: 30, y: 10 },
      { x: 30, y: 10.5 },
      { x: 30, y: 50 },
      { x: 10, y: 50 },
    ]
    expect(envelopeStepCollapses(collinear, [], 1, nodes({ x: 10, y: 10.5 }))).toEqual([])
    expect(envelopeStepCollapses(ring.slice(0, 4), [], 1, nodes({ x: 10, y: 10.5 }))).toEqual([])
  })

  it('отказывается, если новый угол совпал бы с уже существующим', () => {
    // Угол (10, 10.5) уже есть в кольце: снятие дало бы петлю, а не правку.
    const withCorner = [...ring.slice(0, 5), { x: 10, y: 10.5 }, { x: 10, y: 50 }]
    expect(envelopeStepCollapses(withCorner, [], 1, nodes({ x: 10, y: 10.5 }))).toEqual([])
  })

  it('переносит доказательства вершин и отбрасывает доказательства снятых углов', () => {
    const result = collapseEnvelopeStep(ring, [proof(1), proof(4)], {
      corner: { x: 10, y: 10.5 },
      replaces: [0, 1, 2],
    })
    expect(result.polygon).toEqual([
      { x: 10, y: 10.5 },
      { x: 60, y: 10.5 },
      { x: 60, y: 50 },
      { x: 10, y: 50 },
    ])
    expect(result.vertexProofs.map((item) => item.vertexIndex)).toEqual([2])
  })
})
