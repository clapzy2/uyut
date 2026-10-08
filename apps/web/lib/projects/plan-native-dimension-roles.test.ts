import { describe, expect, it } from 'vitest'
import type { NativeTextAnchors } from './plan-document'
import { automaticNativeDimensionRoles } from './plan-native-dimension-roles'
import type { PdfLinework, PdfVectorPath } from './plan-pdf-linework'

function fixture() {
  const source = { sha256: 'b'.repeat(64), pdfPage: 1, state: 'existing' as const }
  const frame = { sha256: 'a'.repeat(64), page: 1, width: 1000, height: 1000 }
  const native: NativeTextAnchors = {
    source: frame,
    originalPdfSha256: source.sha256,
    complete: true,
    pageNormalizedScale: { x: 1, y: 1 },
    labels: [
      {
        id: 'native-text-10',
        nativeIndex: 10,
        name: '200',
        rotation: 0,
        pagePoint: { x: 200, y: 168 },
        point: { x: 200, y: 168 },
      },
    ],
  }
  const stroke = (operationIndex: number, points: PdfVectorPath['points']): PdfVectorPath => ({
    operationIndex,
    subpathIndex: 0,
    paint: 'stroke',
    closed: false,
    points,
  })
  const work: PdfLinework = {
    coordinateSystem: 'page-0-1000',
    pageWidth: 1000,
    pageHeight: 1000,
    paths: [
      stroke(1, [
        { x: 100, y: 170 },
        { x: 300, y: 170 },
      ]),
      stroke(2, [
        { x: 95, y: 175 },
        { x: 105, y: 165 },
      ]),
      stroke(3, [
        { x: 295, y: 175 },
        { x: 305, y: 165 },
      ]),
    ],
    skippedCurves: 0,
    clippedPaths: 0,
    unsupportedPaths: 0,
    unsupportedContexts: 0,
    truncated: false,
  }
  return { native, source, work, lineworkSource: frame }
}
describe('automatic printed dimension roles, not permission to erase lines', () => {
  it.each([180, -90, 270])(
    'checks cardinal rotation %s without changing source text',
    (rotation) => {
      const input = fixture()
      const label = input.native.labels[0]
      if (!label) throw new Error('Missing test label')
      label.rotation = rotation
      if (rotation !== 180) {
        input.work.paths = input.work.paths.map((path) => ({
          ...path,
          points: path.points.map((point) => ({ x: point.y, y: point.x })),
        }))
        label.point = { x: 168, y: 200 }
        label.pagePoint = { ...label.point }
      }
      expect(automaticNativeDimensionRoles(input).candidates).toHaveLength(1)
      expect(label.rotation).toBe(rotation)
    },
  )
  it('discovers a unique labelled rail and both source ticks without selected label IDs', () => {
    const input = fixture(),
      before = structuredClone(input.work)
    const result = automaticNativeDimensionRoles(input)
    expect(result.refusalReason).toBeNull()
    expect(result.candidates).toHaveLength(1)
    expect(result.candidates[0]).toMatchObject({
      labelId: 'native-text-10',
      valueMm: 200,
      rail: { operationIndex: 1 },
    })
    expect(result.candidates[0]?.ticks.map((tick) => tick.operationIndex)).toEqual([2, 3])
    expect(result.mayEraseSourceStrokes).toBe(false)
    expect(input.work).toEqual(before)
  })
  it('does not mark arbitrary numbers or an unmarked line as a dimension', () => {
    const input = fixture()
    input.work.paths = input.work.paths.slice(0, 1)
    expect(automaticNativeDimensionRoles(input).candidates).toEqual([])
  })
  it('refuses duplicate or shifted ticks rather than choosing one', () => {
    const input = fixture(),
      tick = input.work.paths[1]
    if (!tick) throw new Error('Missing test tick')
    input.work.paths.push({ ...tick, operationIndex: 4 })
    expect(automaticNativeDimensionRoles(input).candidates).toEqual([])
    input.work.paths.pop()
    tick.points = tick.points.map((point) => ({ x: point.x + 1, y: point.y }))
    expect(automaticNativeDimensionRoles(input).candidates).toEqual([])
  })
  it('requires the selected existing page and native coordinate provenance', () => {
    const input = fixture()
    expect(
      automaticNativeDimensionRoles({ ...input, source: { ...input.source, pdfPage: 2 } })
        .refusalReason,
    ).toBe('unverified-or-mismatched-page-state')
    expect(
      automaticNativeDimensionRoles({ ...input, source: { ...input.source, state: 'proposed' } })
        .candidates,
    ).toEqual([])
    const label = input.native.labels[0]
    if (!label) throw new Error('Missing test label')
    label.point.x++
    expect(automaticNativeDimensionRoles(input).refusalReason).toBe(
      'invalid-native-text-provenance',
    )
  })
  it('refuses incomplete extraction and malformed source path references', () => {
    const input = fixture()
    expect(
      automaticNativeDimensionRoles({ ...input, native: { ...input.native, complete: false } })
        .candidates,
    ).toEqual([])
    const path = input.work.paths[0]
    if (!path) throw new Error('Missing test path')
    path.operationIndex = -1
    expect(automaticNativeDimensionRoles(input).refusalReason).toBe(
      'invalid-native-path-provenance',
    )
  })
  it('does not perform unbounded dimension discovery', () => {
    const input = fixture()
    input.native.labels = Array.from({ length: 101 }, (_, index) => ({
      ...(input.native.labels[0] as NativeTextAnchors['labels'][number]),
      id: `native-text-${index}`,
      nativeIndex: index,
    }))
    expect(automaticNativeDimensionRoles(input)).toMatchObject({
      refusalReason: 'dimension-discovery-budget',
      candidates: [],
    })
  })
  it('keeps competing labels unresolved rather than assigning the same rail twice', () => {
    const input = fixture(),
      label = input.native.labels[0]
    if (!label) throw new Error('Missing test label')
    input.native.labels.push({ ...label, id: 'native-text-20', nativeIndex: 20, name: '201' })
    const result = automaticNativeDimensionRoles(input)
    expect(result.candidates).toEqual([])
    expect(
      result.unresolved.filter((entry) => entry.reason === 'competing-dimension-labels'),
    ).toHaveLength(2)
  })
})
