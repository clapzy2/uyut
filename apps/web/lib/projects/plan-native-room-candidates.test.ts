import { planRoomSchedule, planTabularScheduleEvidence } from '@uyut/ai'
import { describe, expect, it } from 'vitest'
import type { NativeTextAnchors } from './plan-document'
import { automaticNativeRoomCandidates } from './plan-native-room-candidates'
import type { PdfLinework, PdfVectorPath } from './plan-pdf-linework'

const source = { sha256: 'a'.repeat(64), page: 1, width: 1000, height: 1000 }
function addLabel(labels: NativeTextAnchors['labels'], name: string, x: number, y: number) {
  const nativeIndex = 100 + labels.length * 3
  const label = {
    id: `native-text-${nativeIndex}`,
    nativeIndex,
    name,
    point: { x, y },
    pagePoint: { x, y },
    rotation: 0,
  }
  labels.push(label)
  return label
}
function box(paths: PdfVectorPath[], base: number, x: number, y: number) {
  const corners = [
    { x: x - 10, y: y - 12 },
    { x: x + 10, y: y - 12 },
    { x: x + 10, y: y + 8 },
    { x: x - 10, y: y + 8 },
  ]
  for (let index = 0; index < 4; index++)
    paths.push({
      operationIndex: base + index,
      subpathIndex: 0,
      paint: 'stroke',
      closed: false,
      points: [
        corners[index] as { x: number; y: number },
        corners[(index + 1) % 4] as { x: number; y: number },
      ],
    })
}
function fixture() {
  const labels: NativeTextAnchors['labels'] = []
  addLabel(labels, '№', 100, 700)
  addLabel(labels, 'Наименование', 130, 700)
  addLabel(labels, 'Площадь', 210, 700)
  for (let index = 0; index < 3; index++) {
    addLabel(labels, String(index + 1), 100, 730 + index * 30)
    addLabel(labels, index === 2 ? 'Балкон' : 'Спальня', 130, 730 + index * 30)
    addLabel(labels, index === 2 ? '5,5' : '12,5', 210, 730 + index * 30)
  }
  const paths: PdfVectorPath[] = []
  for (let index = 0; index < 3; index++) {
    const left = 50 + index * 250
    paths.push({
      operationIndex: index + 1,
      subpathIndex: 0,
      paint: 'fill',
      closed: true,
      points: [
        { x: left, y: 50 },
        { x: left + 200, y: 50 },
        { x: left + 200, y: 300 },
        { x: left, y: 300 },
      ],
    })
    addLabel(labels, String(index + 1), 100 + index * 250, 150)
    box(paths, 100 + index * 10, 100 + index * 250, 150)
  }
  addLabel(labels, '1', 900, 950) // unboxed sheet number, not a room cue
  const native: NativeTextAnchors = {
    source,
    originalPdfSha256: 'b'.repeat(64),
    complete: true,
    labels,
    pageNormalizedScale: { x: 1, y: 1 },
  }
  const work: PdfLinework = {
    coordinateSystem: 'page-0-1000',
    pageWidth: 1000,
    pageHeight: 1000,
    paths,
    skippedCurves: 0,
    clippedPaths: 0,
    unsupportedPaths: 0,
    unsupportedContexts: 0,
    truncated: false,
  }
  return { native, work, lineworkSource: source }
}
describe('native table and boxed-number candidate association', () => {
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
})
