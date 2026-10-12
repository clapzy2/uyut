import type { PlanPageVertexProof } from '@uyut/db'
import { describe, expect, it } from 'vitest'
import type { NativePageSegment } from '@/lib/projects/plan-pdf-opening-endpoint'
import {
  contourDraftsFromSaved,
  pageContourRoomsForSave,
  pageContourVertexProofsChanged,
} from './plan-page-contour-editor-model'
import { snapPageSourceContourPoint } from './plan-page-vertex-candidate'

const page = { width: 1000, height: 1000 }
const segment = (
  operationIndex: number,
  start: { x: number; y: number },
  end: { x: number; y: number },
): NativePageSegment => ({ operationIndex, subpathIndex: 0, segmentIndex: 0, start, end })
const diagonal = segment(1, { x: 10, y: 10 }, { x: 30, y: 30 })
const rising = segment(2, { x: 10, y: 30 }, { x: 30, y: 10 })

describe('reviewed source contour crossing proposals', () => {
  it('proposes a decimal-exact diagonal crossing with two source snapshots and a rational identity', () => {
    const before = structuredClone([diagonal, rising])
    const candidate = snapPageSourceContourPoint({ x: 20, y: 20 }, [], page, [diagonal, rising], 1)
    expect(candidate).toEqual({
      kind: 'candidate',
      point: { x: 20, y: 20 },
      distance: 0,
      vertexProof: {
        kind: 'bounded-native-rational-crossing',
        vertexIndex: 1,
        exactPointKey: '20/1:20/1',
        segments: [diagonal, rising],
      },
    })
    if (candidate.kind !== 'candidate' || !candidate.vertexProof)
      throw new Error('Missing source crossing')
    expect(candidate.vertexProof.segments[0]).not.toBe(diagonal)
    expect([diagonal, rising]).toEqual(before)
  })

  it('retains a finite fractional crossing without rounding it to a whole coordinate', () => {
    const first = segment(1, { x: 10, y: 10 }, { x: 30, y: 30 })
    const second = segment(2, { x: 10, y: 30.5 }, { x: 30, y: 10.5 })
    const candidate = snapPageSourceContourPoint(
      { x: 20.25, y: 20.25 },
      [],
      page,
      [first, second],
      2,
    )
    expect(candidate).toMatchObject({
      kind: 'candidate',
      point: { x: 20.25, y: 20.25 },
      vertexProof: { exactPointKey: '81/4:81/4', vertexIndex: 2 },
    })
  })

  it('holds non-terminating rational coordinates instead of exporting their rounded display point', () => {
    const first = segment(1, { x: 10, y: 10 }, { x: 30, y: 30 })
    const second = segment(2, { x: 10, y: 30 }, { x: 30, y: 20 })
    expect(
      snapPageSourceContourPoint(
        { x: 23.333333333333332, y: 23.333333333333332 },
        [],
        page,
        [first, second],
        0,
      ),
    ).toEqual({ kind: 'held', reason: 'unsupported-precision' })
  })

  it('does not ignore an unsupported crossing in favour of a nearby supported crossing', () => {
    const second = segment(2, { x: 10, y: 30 }, { x: 30, y: 20 })
    const near = segment(3, { x: 10, y: 36.75 }, { x: 30, y: 16.75 })
    expect(
      snapPageSourceContourPoint(
        { x: 23.333333333333332, y: 23.333333333333332 },
        [],
        page,
        [diagonal, second, near],
        0,
      ),
    ).toEqual({ kind: 'held', reason: 'unsupported-precision' })
  })

  it('does not extend source lines to invent a crossing', () => {
    const short = { ...rising, end: { x: 12, y: 28 } }
    expect(snapPageSourceContourPoint({ x: 20, y: 20 }, [], page, [diagonal, short], 0)).toEqual({
      kind: 'none',
    })
  })

  it('keeps an exact original node authoritative but holds competing crossing source pairs', () => {
    const point = { x: 20, y: 20 }
    expect(snapPageSourceContourPoint(point, [point], page, [diagonal, rising], 1)).toEqual({
      kind: 'candidate',
      point,
      distance: 0,
    })
    const duplicateLine = { ...rising, operationIndex: 3 }
    expect(
      snapPageSourceContourPoint(point, [], page, [diagonal, rising, duplicateLine], 1),
    ).toEqual({ kind: 'ambiguous' })
    expect(snapPageSourceContourPoint(point, [], page, [diagonal, rising, rising], 1)).toEqual({
      kind: 'ambiguous',
    })
  })

  it('holds two different nearby locations even when the first is an exact crossing', () => {
    const near = segment(3, { x: 10, y: 30.2 }, { x: 30, y: 10.2 })
    expect(
      snapPageSourceContourPoint({ x: 20, y: 20 }, [], page, [diagonal, rising, near], 1),
    ).toEqual({ kind: 'ambiguous' })
  })

  it('bounds the nearby pair search, but does not scan remote pairs or fit an approximate node', () => {
    const crowded = Array.from({ length: 201 }, (_, i) =>
      segment(i, { x: 10, y: 20 + i / 10000 }, { x: 30, y: 20 + i / 10000 }),
    )
    expect(snapPageSourceContourPoint({ x: 20, y: 20 }, [], page, crowded, 0)).toEqual({
      kind: 'held',
      reason: 'intersection-budget',
    })
    const remote = Array.from({ length: 10000 }, (_, i) =>
      segment(10 + i, { x: 100, y: 100 }, { x: 120, y: 120 }),
    )
    expect(
      snapPageSourceContourPoint({ x: 20, y: 20 }, [], page, [diagonal, rising, ...remote], 1),
    ).toMatchObject({ kind: 'candidate', vertexProof: { exactPointKey: '20/1:20/1' } })
    expect(
      snapPageSourceContourPoint({ x: 20, y: 20 }, [], page, new Array(20001).fill(diagonal), 0),
    ).toEqual({ kind: 'held', reason: 'intersection-budget' })
  })

  it('does not broaden obstacles or voids and rejects invalid search coordinates and page dimensions', () => {
    expect(snapPageSourceContourPoint({ x: NaN, y: 20 }, [], page, [diagonal, rising], 0)).toEqual({
      kind: 'none',
    })
    expect(
      snapPageSourceContourPoint(
        { x: 20, y: 20 },
        [],
        { width: 0, height: 1000 },
        [diagonal, rising],
        0,
      ),
    ).toEqual({ kind: 'none' })
    expect(snapPageSourceContourPoint({ x: 20, y: 20 }, [], page, [diagonal, rising], 100)).toEqual(
      { kind: 'none' },
    )
  })

  it('inserts the accepted proof at the selected index, survives reload and refuses missing fresh lines', () => {
    const result = snapPageSourceContourPoint({ x: 20, y: 20 }, [], page, [diagonal, rising], 1)
    if (result.kind !== 'candidate' || !result.vertexProof) throw new Error('Missing proposal')
    const polygon = [{ x: 10, y: 10 }, result.point, { x: 30, y: 10 }]
    const proof = result.vertexProof
    const vertexProofs = pageContourVertexProofsChanged(undefined, polygon, {
      index: 1,
      vertexProof: proof,
    })
    const room = { roomSourceNumber: 3.1, polygon, vertexProofs }
    const nodes = [diagonal, rising].flatMap((item) => [item.start, item.end])
    expect(
      pageContourRoomsForSave(contourDraftsFromSaved([room]), nodes, [diagonal, rising]),
    ).toEqual([room])
    expect(pageContourRoomsForSave(contourDraftsFromSaved([room]), nodes)).toBeNull()
    expect(pageContourVertexProofsChanged(room, polygon, { index: 1 })).toBeUndefined()
    expect(pageContourVertexProofsChanged(room, polygon, { index: 2, vertexProof: proof })).toEqual(
      vertexProofs,
    )
    const malformed = { ...proof, exactPointKey: '20/1:21/1' } as PlanPageVertexProof
    expect(
      pageContourRoomsForSave(
        contourDraftsFromSaved([{ ...room, vertexProofs: [malformed] }]),
        nodes,
        [diagonal, rising],
      ),
    ).toBeNull()
  })
})
