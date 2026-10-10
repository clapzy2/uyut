import { describe, expect, it } from 'vitest'
import { exactNativePointLocation } from './plan-native-exact-intersections'
import { nativeFloorMarkerLeaders } from './plan-native-floor-marker-leaders'
import type { NativeNumberCircleCue } from './plan-native-number-circles'
import type { PdfLinework } from './plan-pdf-linework'

function fixture() {
  const cue: NativeNumberCircleCue = {
    labelId: 'outboard-8',
    sourceNumber: 8,
    pagePoint: { x: 400, y: 200 },
    bounds: { left: 390, right: 410, top: 190, bottom: 210 },
    curve: {
      operationIndex: 10,
      subpathIndex: 0,
      operationSubpathCount: 1,
      paint: 'stroke',
      closed: true,
      start: { x: 410, y: 200 },
      segments: [
        {
          kind: 'cubic',
          control1: { x: 410, y: 205.5 },
          control2: { x: 405.5, y: 210 },
          end: { x: 400, y: 210 },
        },
        {
          kind: 'cubic',
          control1: { x: 394.5, y: 210 },
          control2: { x: 390, y: 205.5 },
          end: { x: 390, y: 200 },
        },
        {
          kind: 'cubic',
          control1: { x: 390, y: 194.5 },
          control2: { x: 394.5, y: 190 },
          end: { x: 400, y: 190 },
        },
        {
          kind: 'cubic',
          control1: { x: 405.5, y: 190 },
          control2: { x: 410, y: 194.5 },
          end: { x: 410, y: 200 },
        },
      ],
    },
  }
  const work: PdfLinework = {
    coordinateSystem: 'page-0-1000',
    pageWidth: 1000,
    pageHeight: 1000,
    paths: [
      {
        operationIndex: 20,
        subpathIndex: 0,
        paint: 'stroke',
        closed: false,
        points: [
          { x: 200, y: 200 },
          { x: 391, y: 200 },
        ],
      },
    ],
    curvePaths: [cue.curve],
    skippedCurves: 1,
    clippedPaths: 0,
    unsupportedPaths: 0,
    unsupportedContexts: 0,
    truncated: false,
  }
  const cell = {
    id: 'source-cell',
    polygon: [
      { x: 100, y: 100 },
      { x: 300, y: 100 },
      { x: 300, y: 300 },
      { x: 100, y: 300 },
    ],
    markerLabelIds: [] as string[],
  }
  return { cue, work, cell }
}

describe('actual source leaders to outboard floor markers', () => {
  it('links one original straight stroke without moving its endpoints or floor', () => {
    const { work, cue, cell } = fixture()
    const before = structuredClone({ work, cue, cell })
    const report = nativeFloorMarkerLeaders(work, [cue], [cell])
    expect(report.refusalReason).toBeNull()
    expect(report.bindings).toHaveLength(1)
    expect(report.bindings[0]).toMatchObject({
      labelId: cue.labelId,
      cavityId: cell.id,
      circleEndpoint: 'end',
      segment: {
        operationIndex: 20,
        segmentIndex: 0,
        start: { x: 200, y: 200 },
        end: { x: 391, y: 200 },
      },
    })
    expect(JSON.parse(JSON.stringify(report))).toEqual(report)
    expect({ work, cue, cell }).toEqual(before)
    const binding = report.bindings[0]
    if (!binding) throw new Error('Missing binding')
    binding.segment.start.x = 999
    expect(work).toEqual(before.work)
  })

  it('retains an actual reversed source direction', () => {
    const { work, cue, cell } = fixture()
    work.paths[0]?.points.reverse()
    expect(nativeFloorMarkerLeaders(work, [cue], [cell]).bindings[0]?.circleEndpoint).toBe('start')
  })

  it.each(['translated', 'reflected', 'stretched', 'renamed'])(
    'uses source relationships rather than fixed coordinates or IDs after %s changes',
    (mode) => {
      const { work, cue, cell } = fixture()
      const transform = ({ x, y }: { x: number; y: number }) => ({
        x:
          mode === 'translated'
            ? x + 100
            : mode === 'reflected'
              ? 1000 - x
              : mode === 'stretched'
                ? x / 2
                : x,
        y: mode === 'translated' ? y + 50 : mode === 'stretched' ? y * 2 : y,
      })
      work.paths = work.paths.map((path) => ({ ...path, points: path.points.map(transform) }))
      cue.curve.start = transform(cue.curve.start)
      cue.curve.segments = cue.curve.segments.map((segment) => {
        if (segment.kind !== 'cubic') throw new Error('Missing source quarter')
        return {
          ...segment,
          control1: transform(segment.control1),
          control2: transform(segment.control2),
          end: transform(segment.end),
        }
      })
      cell.polygon = cell.polygon.map(transform)
      const corners = [
        transform({ x: cue.bounds.left, y: cue.bounds.top }),
        transform({ x: cue.bounds.right, y: cue.bounds.bottom }),
      ]
      cue.bounds = {
        left: Math.min(...corners.map(({ x }) => x)),
        right: Math.max(...corners.map(({ x }) => x)),
        top: Math.min(...corners.map(({ y }) => y)),
        bottom: Math.max(...corners.map(({ y }) => y)),
      }
      if (mode === 'renamed') {
        cue.labelId = 'arbitrary-marker'
        cell.id = 'arbitrary-floor'
        cue.curve.operationIndex = 992
        const path = work.paths[0]
        if (path) path.operationIndex = 993
      }
      const report = nativeFloorMarkerLeaders(work, [cue], [cell])
      expect(report.bindings).toHaveLength(1)
      expect(report.bindings[0]).toMatchObject({
        labelId: cue.labelId,
        cavityId: cell.id,
        segment: { start: transform({ x: 200, y: 200 }), end: transform({ x: 391, y: 200 }) },
      })
    },
  )

  it.each(['circle-boundary', 'floor-boundary', 'floor-outside', 'circle-outside', 'zero-length'])(
    'does not snap or extend a %s endpoint',
    (kind) => {
      const { work, cue, cell } = fixture()
      const points = work.paths[0]?.points
      if (!points) throw new Error('Missing source')
      if (kind === 'circle-boundary') points[1] = { x: 390, y: 200 }
      if (kind === 'floor-boundary') points[0] = { x: 300, y: 200 }
      if (kind === 'floor-outside') points[0] = { x: 300.000000001, y: 200 }
      if (kind === 'circle-outside') points[1] = { x: 389.999999999, y: 200 }
      if (kind === 'zero-length') points[0] = { ...(points[1] as { x: number; y: number }) }
      expect(nativeFloorMarkerLeaders(work, [cue], [cell]).bindings).toEqual([])
    },
  )

  it('accepts strictly inside floor coordinates one billionth from the boundary', () => {
    const { work, cue, cell } = fixture()
    const path = work.paths[0]
    if (!path) throw new Error('Missing source')
    path.points[0] = { x: 299.999999999, y: 200 }
    expect(nativeFloorMarkerLeaders(work, [cue], [cell]).bindings).toHaveLength(1)
  })

  it.each(['same-floor', 'different-floor'])('withholds competing %s leader paths', (kind) => {
    const { work, cue, cell } = fixture()
    work.paths.push({
      ...(work.paths[0] as NonNullable<(typeof work.paths)[0]>),
      operationIndex: 21,
      points: [
        { x: 200, y: kind === 'same-floor' ? 210 : 450 },
        { x: 392, y: 200 },
      ],
    })
    const second = {
      ...cell,
      id: 'other-cell',
      polygon: cell.polygon.map((point) => ({ x: point.x, y: point.y + 300 })),
    }
    const report = nativeFloorMarkerLeaders(work, [cue], [cell, second])
    expect(report.bindings).toEqual([])
    expect(report.issues).toEqual([
      { labelId: cue.labelId, reason: 'competing-or-unproved-source-leaders' },
    ])
  })

  it('withholds overlapping target cells rather than choosing the smallest', () => {
    const { work, cue, cell } = fixture()
    expect(
      nativeFloorMarkerLeaders(work, [cue], [cell, { ...cell, id: 'overlap' }]).bindings,
    ).toEqual([])
  })

  it.each(['bent', 'compound', 'curved', 'clipped'])(
    'does not hide a competing unsupported %s attachment before choosing a straight leader',
    (kind) => {
      const { work, cue, cell } = fixture()
      const competitor = {
        operationIndex: 21,
        subpathIndex: 0,
        paint: 'stroke' as const,
        closed: false,
        points: [
          { x: 200, y: 450 },
          { x: 392, y: 200 },
        ],
      }
      if (kind === 'bent') competitor.points.splice(1, 0, { x: 300, y: 450 })
      if (kind === 'compound') work.paths.push({ ...competitor, subpathIndex: 1 })
      if (kind === 'curved')
        work.curvePaths?.push({
          operationIndex: 21,
          subpathIndex: 0,
          operationSubpathCount: 1,
          paint: 'stroke',
          closed: false,
          start: competitor.points[0] as { x: number; y: number },
          segments: [
            {
              kind: 'quadratic',
              control: { x: 300, y: 450 },
              end: competitor.points[1] as { x: number; y: number },
            },
          ],
        })
      else work.paths.push(competitor)
      if (kind === 'clipped') work.clippedPathBounds = [{ operationIndex: 21, bounds: cue.bounds }]
      const second = {
        ...cell,
        id: 'second-cell',
        polygon: cell.polygon.map(({ x, y }) => ({ x, y: y + 300 })),
      }
      const report = nativeFloorMarkerLeaders(work, [cue], [cell, second])
      expect(report.bindings).toEqual([])
      expect(report.issues).toHaveLength(1)
    },
  )

  it.each(['closed', 'fill', 'compound', 'clipped', 'curve-sibling', 'multi-segment'])(
    'rejects an unsupported %s leader operation',
    (kind) => {
      const { work, cue, cell } = fixture()
      const path = work.paths[0]
      if (!path) throw new Error('Missing source')
      if (kind === 'closed') path.closed = true
      if (kind === 'fill') path.paint = 'fill-stroke'
      if (kind === 'compound') work.paths.push({ ...path, subpathIndex: 1 })
      if (kind === 'clipped') work.clippedPathBounds = [{ operationIndex: 20, bounds: cue.bounds }]
      if (kind === 'curve-sibling') work.curvePaths?.push({ ...cue.curve, operationIndex: 20 })
      if (kind === 'multi-segment') path.points.push({ x: 400, y: 200 })
      expect(nativeFloorMarkerLeaders(work, [cue], [cell]).bindings).toEqual([])
    },
  )

  it('preserves directly contained markers and withholds circles touching candidate bounds', () => {
    const { work, cue, cell } = fixture()
    cell.markerLabelIds = [cue.labelId]
    expect(nativeFloorMarkerLeaders(work, [cue], [cell]).bindings).toEqual([])
    cell.markerLabelIds = []
    const touching = {
      ...cell,
      polygon: [
        { x: 390, y: 100 },
        { x: 500, y: 100 },
        { x: 500, y: 190 },
        { x: 390, y: 190 },
      ],
    }
    expect(nativeFloorMarkerLeaders(work, [cue], [cell, touching]).bindings).toEqual([])
  })

  it('does not bind a line connecting two circles', () => {
    const { work, cue, cell } = fixture()
    const competitor = structuredClone(cue)
    competitor.labelId = 'other-circle'
    expect(nativeFloorMarkerLeaders(work, [cue, competitor], [cell]).bindings).toEqual([])
  })

  it('does not use fitted anchor bounds to hide an unresolved competing source handle', () => {
    const { work, cue, cell } = fixture()
    const shiftCurve = (candidate: NativeNumberCircleCue, shift: number) => {
      candidate.curve.start.x += shift
      for (const segment of candidate.curve.segments) {
        if (segment.kind !== 'cubic') throw new Error('Missing cubic quarter')
        segment.control1.x += shift
        segment.control2.x += shift
        segment.end.x += shift
      }
      candidate.bounds.left += shift
      candidate.bounds.right += shift
    }
    const competitor = structuredClone(cue)
    shiftCurve(cue, 0.001)
    shiftCurve(competitor, 20)
    competitor.labelId = 'competing-cue'
    competitor.curve.operationIndex = 11
    const quarter = competitor.curve.segments[1]
    if (quarter?.kind !== 'cubic') throw new Error('Missing quarter')
    quarter.control2.x = 409.999
    const path = work.paths[0]
    if (!path) throw new Error('Missing source')
    path.points[1] = { x: 409.9999998, y: 200.00165 }
    expect(path.points[1].x).toBeLessThan(competitor.bounds.left)
    expect(nativeFloorMarkerLeaders(work, [cue], [cell]).bindings).toHaveLength(1)
    const report = nativeFloorMarkerLeaders(work, [cue, competitor], [cell])
    expect(report.bindings).toEqual([])
    expect(report.issues).toContainEqual({
      labelId: cue.labelId,
      reason: 'competing-or-unproved-source-leaders',
    })
  })

  it('bounds input without emitting partial associations', () => {
    const { work, cue, cell } = fixture()
    const report = nativeFloorMarkerLeaders(
      work,
      Array.from({ length: 101 }, () => cue),
      [cell],
    )
    expect(report).toEqual({
      bindings: [],
      issues: [],
      refusalReason: 'floor-marker-leader-input-limit',
    })
  })

  it('reserves bounded exact curve work and withholds the whole association pass on exhaustion', () => {
    const { work, cue, cell } = fixture()
    const leader = work.paths[0]
    if (!leader) throw new Error('Missing source')
    work.paths = Array.from({ length: 500 }, (_, index) => ({
      ...leader,
      operationIndex: 1000 + index,
    }))
    expect(nativeFloorMarkerLeaders(work, [cue], [cell])).toEqual({
      bindings: [],
      issues: [],
      refusalReason: 'floor-marker-leader-work-limit',
    })
  })
})

describe('exact source polygon point locations', () => {
  it.each([
    [200, 'inside'],
    [300, 'boundary'],
    [300.000000001, 'outside'],
    [299.999999999, 'inside'],
  ] as const)('locates x=%s as %s', (x, expected) => {
    const { cell } = fixture()
    expect(exactNativePointLocation(cell.polygon, { x, y: 200 })).toBe(expected)
    expect(exactNativePointLocation(cell.polygon.toReversed(), { x, y: 200 })).toBe(expected)
  })
  it('withholds degenerate and unsupported source coordinates', () => {
    const { cell } = fixture()
    expect(exactNativePointLocation(cell.polygon, { x: 1e-19, y: 200 })).toBe('unresolved')
    expect(
      exactNativePointLocation(
        [
          { x: 1, y: 1 },
          { x: 2, y: 2 },
          { x: 3, y: 3 },
        ],
        { x: 2, y: 2 },
      ),
    ).toBe('unresolved')
  })
})
