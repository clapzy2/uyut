import { planRoomSchedule, planTabularScheduleEvidence } from '@uyut/ai'
import { describe, expect, it } from 'vitest'
import { automaticNativeRoomCandidates, nativeRoomPolygonKey } from './plan-native-room-candidates'
import { nativeStrokeFaceCandidates } from './plan-native-stroke-candidates'
import type { PdfVectorPath } from './plan-pdf-linework'
import {
  addNativeRoomLabel as addLabel,
  addNativeRoomBox as box,
  connectedNativeRoomFixture,
  numberedNativeRoomFixture as fixture,
} from './test-fixtures/native-numbered-rooms'

function strokeFixture() {
  const input = fixture()
  input.work.paths = input.work.paths.map((path) => ({ ...path, paint: 'stroke' }))
  return input
}
describe('native table and boxed-number candidate association', () => {
  it('keeps a matching child caption 2.1 separate from integer 2', () => {
    const input = connectedNativeRoomFixture()
    for (const label of input.native.labels) {
      if (label.name === '3') label.name = '2.1'
      if (label.name === 'Балкон') label.name = 'Гардероб'
    }
    const before = structuredClone(input)
    const result = automaticNativeRoomCandidates(input)
    if (result.status !== 'draft') throw new Error(result.reason)
    expect(result.associations.map((entry) => entry.sourceNumber)).toEqual([1, 2, 2.1])
    expect(result.associations[2]?.name).toBe('Гардероб')
    expect(result.unresolvedSourceNumbers).toEqual([])
    expect(result.geometry.semanticStatus).toBe('unclassified')
    expect(input).toEqual(before)
  })
  it('finds both shared-wall candidates while preserving the source number frames', () => {
    const input = connectedNativeRoomFixture()
    const before = structuredClone(input)
    const result = automaticNativeRoomCandidates(input)
    if (result.status !== 'draft') throw new Error(result.reason)
    expect(result.associations.map((entry) => entry.sourceNumber)).toEqual([1, 2, 3])
    expect(result.unresolvedSourceNumbers).toEqual([])
    expect(result.frameFaces?.exclusions).toHaveLength(3)
    expect(nativeStrokeFaceCandidates(input).candidates).toEqual([])
    expect(input).toEqual(before)
  })
  it('uses exact collinear outline identity without simplifying source evidence or near vertices', () => {
    const polygon = fixture().work.paths[0]?.points
    if (!polygon) throw new Error('Missing source polygon')
    const withCut = [polygon[0] as { x: number; y: number }, { x: 150, y: 50 }, ...polygon.slice(1)]
    const before = structuredClone(withCut)
    expect(nativeRoomPolygonKey(withCut)).toBe(nativeRoomPolygonKey(polygon))
    expect(
      nativeRoomPolygonKey([
        withCut[0] as { x: number; y: number },
        { x: 150, y: 50.001 },
        ...polygon.slice(1),
      ]),
    ).not.toBe(nativeRoomPolygonKey(polygon))
    expect(withCut).toEqual(before)
  })
  it.each(['unknown-stroke', 'unknown-ring', 'door-gap', 'competing-fill'])(
    'does not promote a shared-wall candidate with %s',
    (caseName) => {
      const input = connectedNativeRoomFixture()
      if (caseName === 'door-gap') {
        const divider = input.work.paths.find((path) => path.operationIndex === 2)
        if (!divider) throw new Error('Missing divider')
        divider.points = [
          { x: 275, y: 50 },
          { x: 275, y: 160 },
        ]
        input.work.paths.push({
          operationIndex: 500,
          subpathIndex: 0,
          paint: 'stroke',
          closed: false,
          points: [
            { x: 275, y: 200 },
            { x: 275, y: 300 },
          ],
        })
      } else if (caseName === 'competing-fill') {
        const outer = input.work.paths.find((path) => path.operationIndex === 1)
        if (!outer) throw new Error('Missing outer source')
        input.work.paths.push({ ...structuredClone(outer), operationIndex: 500, paint: 'fill' })
      } else
        input.work.paths.push({
          operationIndex: 500,
          subpathIndex: 0,
          paint: 'stroke',
          closed: caseName === 'unknown-ring',
          points:
            caseName === 'unknown-stroke'
              ? [
                  { x: 160, y: 200 },
                  { x: 180, y: 220 },
                ]
              : [
                  { x: 160, y: 200 },
                  { x: 200, y: 200 },
                  { x: 200, y: 240 },
                  { x: 160, y: 240 },
                ],
        })
      const result = automaticNativeRoomCandidates(input)
      if (result.status !== 'draft') throw new Error(result.reason)
      expect(result.associations.map((entry) => entry.sourceNumber)).toEqual(
        caseName === 'door-gap' || caseName === 'competing-fill' ? [3] : [2, 3],
      )
      expect(result).not.toHaveProperty('pageReview')
      expect(result).not.toHaveProperty('footprint')
    },
  )
  it('keeps duplicate numbered cues as competitors across newly connected faces', () => {
    const input = connectedNativeRoomFixture()
    addLabel(input.native.labels, '1', 400, 220)
    box(input.work.paths, 500, 400, 220)
    const result = automaticNativeRoomCandidates(input)
    if (result.status !== 'draft') throw new Error(result.reason)
    expect(result.associations.map((entry) => entry.sourceNumber)).toEqual([3])
    expect(result.unresolvedSourceNumbers).toEqual([1, 2])
  })
  it('automatically links separate repeated room names and a balcony without reviewed IDs', () => {
    const result = automaticNativeRoomCandidates(fixture())
    expect(result.status).toBe('draft')
    if (result.status !== 'draft') throw new Error(result.reason)
    expect(
      result.associations.map((entry) => [entry.sourceNumber, entry.name, entry.regionId]),
    ).toEqual([
      [1, 'Спальня', 'native-fill-1:0'],
      [2, 'Спальня', 'native-fill-2:0'],
      [3, 'Балкон', 'native-fill-3:0'],
    ])
    expect(result.unresolvedSourceNumbers).toEqual([])
    expect(result.potentialCaptionCues).toHaveLength(3)
    expect(result.geometry.semanticStatus).toBe('unclassified')
  })
  it('retains caller-array evidence slots, not original PDF IDs, while preserving the old schedule API', () => {
    const input = fixture()
    const items = [
      { text: 'unpositioned', rotation: 0 },
      ...input.native.labels.map((label) => ({
        text: label.name,
        rotation: label.rotation as number,
        ...label.pagePoint,
      })),
    ]
    const evidence = planTabularScheduleEvidence(items)
    expect(evidence?.get(1)).toMatchObject({
      numberItemIndex: 4,
      nameItemIndex: 5,
      areaItemIndex: 6,
      name: 'Спальня',
      areaM2: 12.5,
    })
    expect(planRoomSchedule(items)?.get(1)).toEqual({ name: 'Спальня', areaM2: 12.5 })
  })
  it('does not treat a bare number as a boxed room marker', () => {
    const input = fixture()
    const work = {
      ...input.work,
      paths: input.work.paths.filter(
        (path) => path.operationIndex < 110 || path.operationIndex > 113,
      ),
    }
    const result = automaticNativeRoomCandidates({ ...input, work })
    if (result.status !== 'draft') throw new Error(result.reason)
    expect(result.unresolvedSourceNumbers).toEqual([2])
    expect(result.associations).toHaveLength(2)
  })
  it('keeps duplicate-number cues as spatial competitors instead of selecting one', () => {
    const input = fixture()
    addLabel(input.native.labels, '1', 450, 220)
    box(input.work.paths, 200, 450, 220)
    const result = automaticNativeRoomCandidates(input)
    if (result.status !== 'draft') throw new Error(result.reason)
    expect(result.unresolvedSourceNumbers).toEqual([1, 2])
    expect(result.associations.map((entry) => entry.sourceNumber)).toEqual([3])
  })
  it('does not discard an uncertain frame cue to permit a sibling in a shared fill', () => {
    const input = fixture()
    const sourceSide = input.work.paths.find((path) => path.operationIndex === 103)
    if (!sourceSide) throw new Error('Missing fixture side')
    input.work.paths.push({ ...sourceSide, operationIndex: 200 })
    const shared: PdfVectorPath = {
      operationIndex: 1,
      subpathIndex: 0,
      paint: 'fill',
      closed: true,
      points: [
        { x: 50, y: 50 },
        { x: 500, y: 50 },
        { x: 500, y: 300 },
        { x: 50, y: 300 },
      ],
    }
    input.work.paths = [
      shared,
      ...input.work.paths.filter((path) => path.paint === 'stroke' || path.operationIndex === 3),
    ]
    const result = automaticNativeRoomCandidates(input)
    if (result.status !== 'draft') throw new Error(result.reason)
    expect(result.unresolvedSourceNumbers).toEqual([1, 2])
    expect(result.associations.map((entry) => entry.sourceNumber)).toEqual([3])
  })
  it('refuses ambiguous table headers or non-room schedule names', () => {
    const input = fixture()
    addLabel(input.native.labels, '№', 800, 800)
    expect(automaticNativeRoomCandidates(input)).toMatchObject({
      status: 'unresolved',
      reason: 'unsupported-or-ambiguous-room-table',
    })
    const other = fixture()
    const row = other.native.labels[4]
    if (!row) throw new Error('Missing fixture row')
    row.name = 'Стол'
    expect(automaticNativeRoomCandidates(other).status).toBe('unresolved')
  })
  it('refuses incomplete text and moved raster caption coordinates', () => {
    const input = fixture()
    expect(
      automaticNativeRoomCandidates({ ...input, native: { ...input.native, complete: false } })
        .status,
    ).toBe('unresolved')
    const first = input.native.labels[0]
    if (!first) throw new Error('Missing fixture label')
    first.point = { x: first.point.x + 1, y: first.point.y }
    expect(automaticNativeRoomCandidates(input)).toMatchObject({
      status: 'unresolved',
      reason: 'missing-native-text-provenance',
    })
  })
  it('refuses negative or duplicated stroke path references before inferring frames', () => {
    const input = fixture()
    const paths = input.work.paths.map((path) =>
      path.operationIndex >= 100 && path.operationIndex <= 103
        ? { ...path, operationIndex: -path.operationIndex, subpathIndex: -1 }
        : path,
    )
    expect(
      automaticNativeRoomCandidates({ ...input, work: { ...input.work, paths } }),
    ).toMatchObject({ status: 'unresolved', reason: 'invalid-native-frame-provenance' })
    const stroke = input.work.paths.find((path) => path.operationIndex === 100)
    if (!stroke) throw new Error('Missing fixture stroke')
    expect(
      automaticNativeRoomCandidates({
        ...input,
        work: { ...input.work, paths: [...input.work.paths, stroke] },
      }),
    ).toMatchObject({ status: 'unresolved', reason: 'invalid-native-frame-provenance' })
  })
  it('does not infer room names from shapes when native text is outlined or absent', () => {
    const input = fixture()
    const result = automaticNativeRoomCandidates({
      ...input,
      native: { ...input.native, labels: [] },
    })
    expect(result).toMatchObject({
      status: 'unresolved',
      reason: 'unsupported-or-ambiguous-room-table',
      associations: [],
    })
    expect(result.geometry.candidates).toHaveLength(3)
    expect(result.geometry.semanticStatus).toBe('unclassified')
  })
  it('does not construct room floors from number frames without native fills', () => {
    const input = fixture()
    const result = automaticNativeRoomCandidates({
      ...input,
      work: { ...input.work, paths: input.work.paths.filter((path) => path.paint === 'stroke') },
    })
    if (result.status !== 'draft') throw new Error(result.reason)
    expect(result.associations).toEqual([])
    expect(result.geometry.candidates).toEqual([])
    expect(result.unresolvedSourceNumbers).toEqual([1, 2, 3])
  })
  it('refuses the whole association pass when omitted geometry has no usable bounds', () => {
    const input = fixture()
    const result = automaticNativeRoomCandidates({
      ...input,
      work: { ...input.work, clippedPaths: 1, clippedPathBounds: [] },
    })
    expect(result).toMatchObject({
      status: 'unresolved',
      reason: 'incomplete-native-geometry',
      associations: [],
    })
  })
  it.each(['rectangle', 'stepped', 'diagonal'])(
    'links a numbered unfilled %s outline without creating an approved floor',
    (shape) => {
      const input = strokeFixture()
      const balcony = input.work.paths.find((path) => path.operationIndex === 3)
      if (!balcony) throw new Error('Missing balcony outline')
      if (shape === 'stepped')
        balcony.points = [
          { x: 550, y: 50 },
          { x: 750, y: 50 },
          { x: 750, y: 240 },
          { x: 700, y: 240 },
          { x: 700, y: 300 },
          { x: 550, y: 300 },
        ]
      if (shape === 'diagonal')
        balcony.points = [
          { x: 550, y: 50 },
          { x: 750, y: 50 },
          { x: 750, y: 240 },
          { x: 690, y: 300 },
          { x: 550, y: 300 },
        ]
      const before = structuredClone(input)
      const result = automaticNativeRoomCandidates(input)
      if (result.status !== 'draft') throw new Error(result.reason)
      expect(result.associations.map((entry) => [entry.sourceNumber, entry.name])).toEqual([
        [1, 'Спальня'],
        [2, 'Спальня'],
        [3, 'Балкон'],
      ])
      const association = result.associations.find((entry) => entry.sourceNumber === 3)
      const candidate = result.strokeGeometry.candidates.find(
        (entry) => entry.id === association?.regionId,
      )
      expect(candidate?.polygon).toEqual(balcony.points)
      expect(candidate?.sourceRefs.every((ref) => ref.operationIndex === 3)).toBe(true)
      expect(result.geometry.candidates).toEqual([])
      expect(result.strokeGeometry.semanticStatus).toBe('unclassified')
      expect(result).not.toHaveProperty('pageReview')
      expect(result).not.toHaveProperty('footprint')
      expect(result).not.toHaveProperty('widthCm')
      expect(input).toEqual(before)
    },
  )
  it('keeps exactly identical fill-stroke polygons as aliases of one candidate, not six rooms', () => {
    const input = fixture()
    input.work.paths = input.work.paths.map((path) => ({
      ...path,
      paint: path.paint === 'fill' ? 'fill-stroke' : path.paint,
    }))
    const result = automaticNativeRoomCandidates(input)
    if (result.status !== 'draft') throw new Error(result.reason)
    expect(result.associations).toHaveLength(3)
    for (const association of result.associations) {
      expect(association.regionId).toMatch(/^native-fill-/)
      expect(association.regionIds).toHaveLength(3)
      expect(association.regionIds[1]).toMatch(/^native-stroke-cycle-/)
      expect(association.regionIds[2]).toMatch(/^native-number-frame-face-/)
    }
  })
  it('does not choose between different nested fill and stroke candidates', () => {
    const input = fixture()
    input.work.paths.push({
      operationIndex: 500,
      subpathIndex: 0,
      paint: 'stroke',
      closed: true,
      points: [
        { x: 80, y: 100 },
        { x: 130, y: 100 },
        { x: 130, y: 200 },
        { x: 80, y: 200 },
      ],
    })
    const result = automaticNativeRoomCandidates(input)
    if (result.status !== 'draft') throw new Error(result.reason)
    expect(result.unresolvedSourceNumbers).toEqual([1])
    expect(result.associations.map((entry) => entry.sourceNumber)).toEqual([2, 3])
  })
  it('does not alias nearly identical paint and outline coordinates', () => {
    const input = fixture()
    const first = input.work.paths[0]
    if (!first) throw new Error('Missing source fill')
    input.work.paths.push({
      ...first,
      operationIndex: 500,
      paint: 'stroke',
      points: first.points.map((point) => ({ ...point, x: point.x + 0.001 })),
    })
    const result = automaticNativeRoomCandidates(input)
    if (result.status !== 'draft') throw new Error(result.reason)
    expect(result.unresolvedSourceNumbers).toEqual([1])
  })
  it.each(['crossing-frame', 'concavity-between-frame-corners'])(
    'does not assign a point-contained caption with %s',
    (caseName) => {
      const input = fixture()
      const first = input.work.paths[0]
      if (!first) throw new Error('Missing source fill')
      first.points =
        caseName === 'crossing-frame'
          ? [
              { x: 50, y: 141 },
              { x: 250, y: 141 },
              { x: 250, y: 300 },
              { x: 50, y: 300 },
            ]
          : [
              { x: 50, y: 50 },
              { x: 95, y: 50 },
              { x: 95, y: 142 },
              { x: 99, y: 142 },
              { x: 99, y: 50 },
              { x: 250, y: 50 },
              { x: 250, y: 300 },
              { x: 50, y: 300 },
            ]
      const result = automaticNativeRoomCandidates(input)
      if (result.status !== 'draft') throw new Error(result.reason)
      expect(result.unresolvedSourceNumbers).toEqual([1])
      expect(result.associations.map((entry) => entry.sourceNumber)).toEqual([2, 3])
    },
  )
  it('keeps duplicate number competitors in unfilled outlines', () => {
    const input = strokeFixture()
    addLabel(input.native.labels, '1', 450, 220)
    box(input.work.paths, 200, 450, 220)
    const result = automaticNativeRoomCandidates(input)
    if (result.status !== 'draft') throw new Error(result.reason)
    expect(result.unresolvedSourceNumbers).toEqual([1, 2])
    expect(result.associations.map((entry) => entry.sourceNumber)).toEqual([3])
  })
  it.each(['missing-side', 'small-gap', 'omitted-curve'])(
    'does not close or classify an unfilled room with %s',
    (caseName) => {
      const input = strokeFixture()
      const first = input.work.paths[0]
      if (!first) throw new Error('Missing source outline')
      if (caseName === 'missing-side' || caseName === 'small-gap') {
        first.closed = false
        if (caseName === 'small-gap') first.points.push({ x: 50, y: 50.001 })
      } else {
        input.work.skippedCurves = 1
        input.work.skippedCurveBounds = [
          {
            operationIndex: 500,
            bounds: { left: 50, top: 50, right: 70, bottom: 70 },
          },
        ]
      }
      const result = automaticNativeRoomCandidates(input)
      if (result.status !== 'draft') throw new Error(result.reason)
      expect(result.unresolvedSourceNumbers).toEqual([1])
      expect(result.associations.map((entry) => entry.sourceNumber)).toEqual([2, 3])
    },
  )
  it('refuses combined region-budget overflow instead of partially assigning the first candidates', () => {
    const input = strokeFixture()
    for (let index = 0; index < 49; index++)
      input.work.paths.push({
        operationIndex: 500 + index,
        subpathIndex: 0,
        paint: 'fill',
        closed: true,
        points: [
          { x: 600 + index / 100, y: 400 },
          { x: 700, y: 400 },
          { x: 700, y: 480 },
          { x: 600 + index / 100, y: 480 },
        ],
      })
    expect(automaticNativeRoomCandidates(input)).toMatchObject({
      status: 'unresolved',
      reason: 'room-region-limit',
      associations: [],
    })
  })
})
