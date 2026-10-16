import { describe, expect, it } from 'vitest'
import { nativeCompositeFrameEvidence } from './plan-native-composite-frames'
import type { PagePoint, PdfLinework } from './plan-pdf-linework'

function fixture(): PdfLinework {
  const points: PagePoint[] = [
    { x: 10, y: 10 },
    { x: 50, y: 10 },
    { x: 50, y: 14 },
    { x: 10, y: 14 },
  ]
  return {
    coordinateSystem: 'page-0-1000',
    pageWidth: 1000,
    pageHeight: 1000,
    paths: points.map((start, i) => ({
      operationIndex: 10 + i,
      subpathIndex: 0,
      paint: 'stroke',
      closed: false,
      points: [start, points[(i + 1) % 4] as PagePoint],
    })),
    skippedCurves: 0,
    clippedPaths: 0,
    unsupportedPaths: 0,
    unsupportedContexts: 0,
    truncated: false,
  }
}

describe('exact composite source rectangle evidence', () => {
  it('preserves all four source refs and actual external jamb contacts without granting authority', () => {
    const work = fixture()
    for (const x of [10, 50])
      work.paths.push({
        operationIndex: x + 100,
        subpathIndex: 0,
        paint: 'stroke',
        closed: false,
        points: [
          { x, y: 9 },
          { x, y: 15 },
        ],
      })
    const before = structuredClone(work)
    const result = nativeCompositeFrameEvidence(work, { x: 1, y: 1 })
    expect(result.refusalReason).toBeNull()
    expect(result.candidates).toHaveLength(1)
    expect(result.candidates[0]?.edges.map((edge) => edge.operationIndex).sort()).toEqual([
      10, 11, 12, 13,
    ])
    expect(result.candidates[0]?.jambContacts.map((contact) => contact.coverage)).toEqual([
      'complete',
      'complete',
    ])
    expect(result.candidates[0]?.physicalPassageAccepted).toBe(false)
    expect(work).toEqual(before)
  })

  it('keeps a table-like rectangle unclassified with unproved jamb contacts', () => {
    const result = nativeCompositeFrameEvidence(fixture(), { x: 1, y: 1 })
    expect(
      result.candidates[0]?.jambContacts.every((contact) => contact.coverage === 'unproved'),
    ).toBe(true)
    expect(result.candidates[0]?.closesFloorBoundary).toBe(false)
  })

  it.each(['gap', 'missing', 'zero', 'duplicate-ref'] as const)(
    'holds invalid %s evidence',
    (kind) => {
      const work = fixture()
      if (kind === 'missing') work.paths.pop()
      const first = work.paths[0]
      if (!first) throw new Error('Missing fixture edge')
      if (kind === 'gap') first.points[0] = { x: 10.000001, y: 10 }
      if (kind === 'zero') first.points[1] = first.points[0] as PagePoint
      if (kind === 'duplicate-ref') work.paths.push(structuredClone(first))
      expect(nativeCompositeFrameEvidence(work, { x: 1, y: 1 }).candidates).toEqual([])
    },
  )

  it('retains exact rectangle coordinates and source directions observed in the Muhanova PDF', () => {
    const work = fixture()
    const points = [
      { x: 281.379, y: 493.654 },
      { x: 285.665, y: 493.654 },
      { x: 285.665, y: 607.809 },
      { x: 281.379, y: 607.809 },
    ]
    const operations = [5600, 5621, 5628, 5635]
    const endpoints = [
      [0, 1],
      [0, 3],
      [2, 3],
      [2, 1],
    ]
    work.paths = endpoints.map(([from, to], i) => ({
      operationIndex: operations[i] as number,
      subpathIndex: 0,
      paint: 'stroke',
      closed: false,
      points: [points[from as number] as PagePoint, points[to as number] as PagePoint],
    }))
    const result = nativeCompositeFrameEvidence(work, { x: 1.41, y: 1 })
    expect(result.candidates[0]?.polygon).toEqual(points)
    expect(result.candidates[0]?.edges.map((edge) => edge.operationIndex)).toEqual([
      5600, 5635, 5628, 5621,
    ])
  })
})
