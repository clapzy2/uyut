import { describe, expect, it } from 'vitest'
import type { NativeTextAnchors } from './plan-document'
import { nativeFaceAnnotationCandidates } from './plan-native-face-annotations'
import type { PdfLinework, PdfVectorPath } from './plan-pdf-linework'

function fixture() {
  const source = { sha256: 'a'.repeat(64), page: 1, width: 1000, height: 1000 }
  const labels: NativeTextAnchors['labels'] = []
  const addLabel = (name: string, x: number, y: number) => {
    const nativeIndex = labels.length * 3 + 10
    labels.push({
      id: `native-text-${nativeIndex}`,
      nativeIndex,
      name,
      rotation: 0,
      pagePoint: { x, y },
      point: { x, y },
    })
  }
  const paths: PdfVectorPath[] = []
  const rectangle = (x: number, y: number, width: number, height: number) =>
    paths.push({
      operationIndex: paths.length,
      subpathIndex: 0,
      paint: 'stroke',
      closed: true,
      points: [
        { x, y },
        { x: x + width, y },
        { x: x + width, y: y + height },
        { x, y: y + height },
      ],
    })
  for (let index = 0; index < 3; index++) {
    rectangle(600 + index * 100, 100, 100, 50)
    rectangle(600 + index * 100, 150, 100, 50)
  }
  rectangle(100, 400, 400, 350)
  rectangle(600, 500, 300, 50)
  addLabel('№', 620, 130)
  addLabel('Наименование', 710, 130)
  addLabel('Площадь', 820, 130)
  addLabel('1', 620, 180)
  addLabel('Гостиная', 710, 180)
  addLabel('14,9', 820, 180)
  addLabel('Гостиная', 200, 600)
  addLabel('Масштаб', 650, 530)
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
  return { input: { native, work, lineworkSource: source }, addLabel }
}
describe('native face annotation hints, not accepted floor recognition', () => {
  it('does not seed a horizontal table from a rotated header', () => {
    const { input } = fixture(),
      label = input.native.labels[0]
    if (!label) throw new Error('Missing test header')
    label.rotation = 90
    expect(
      nativeFaceAnnotationCandidates(input).annotations.filter(
        (entry) => entry.kind !== 'sheet-metadata-cell',
      ),
    ).toEqual([])
  })
  it('rejects a linework frame from another page', () => {
    const { input } = fixture()
    expect(() =>
      nativeFaceAnnotationCandidates({
        ...input,
        lineworkSource: { ...input.lineworkSource, page: 2 },
      }),
    ).toThrow()
  })
  it('separates a complete table grid and explicit metadata while retaining all source geometry', () => {
    const { input } = fixture(),
      before = structuredClone(input)
    const result = nativeFaceAnnotationCandidates(input)
    expect(result.refusalReason).toBeNull()
    expect(result.annotations.filter((entry) => entry.kind === 'table-header-cell')).toHaveLength(3)
    expect(result.annotations.filter((entry) => entry.kind === 'table-column-cell')).toHaveLength(3)
    expect(result.annotations.filter((entry) => entry.kind === 'sheet-metadata-cell')).toHaveLength(
      1,
    )
    expect(result.unknownFaceIds).toHaveLength(1)
    expect(result.geometry.candidates).toHaveLength(8)
    expect(result.mayEraseSourceStrokes).toBe(false)
    expect(result.roomRecognitionAccepted).toBe(false)
    expect(input).toEqual(before)
  })
  it('does not propagate a header column into a lone adjoining rectangle', () => {
    const { input } = fixture()
    input.work.paths = input.work.paths.filter(
      (path) => path.operationIndex !== 1 && path.operationIndex !== 5,
    )
    const result = nativeFaceAnnotationCandidates(input)
    expect(result.annotations.filter((entry) => entry.kind === 'table-header-cell')).toHaveLength(3)
    expect(result.annotations.filter((entry) => entry.kind === 'table-column-cell')).toHaveLength(0)
  })
  it('does not use duplicate headers to seed a table', () => {
    const { input, addLabel } = fixture()
    addLabel('Наименование', 950, 900)
    expect(
      nativeFaceAnnotationCandidates(input).annotations.filter(
        (entry) => entry.kind !== 'sheet-metadata-cell',
      ),
    ).toEqual([])
  })
  it('does not use labels on rectangle boundaries as ownership evidence', () => {
    const { input } = fixture(),
      label = input.native.labels[7]
    if (!label) throw new Error('Missing metadata label')
    label.point = { x: 600, y: 530 }
    label.pagePoint = { ...label.point }
    expect(
      nativeFaceAnnotationCandidates(input).annotations.filter(
        (entry) => entry.kind === 'sheet-metadata-cell',
      ),
    ).toEqual([])
  })
  it('does not treat room text or a metadata substring as a sheet caption', () => {
    const { input } = fixture(),
      label = input.native.labels[7]
    if (!label) throw new Error('Missing metadata label')
    label.name = 'Масштаб комнаты'
    const result = nativeFaceAnnotationCandidates(input)
    expect(result.annotations.filter((entry) => entry.kind === 'sheet-metadata-cell')).toEqual([])
    expect(result.unknownFaceIds).toHaveLength(2)
  })
  it('does not claim a concave region from its rectangular bounding box', () => {
    const { input } = fixture(),
      path = input.work.paths[7]
    if (!path) throw new Error('Missing metadata path')
    path.points = [
      { x: 600, y: 500 },
      { x: 900, y: 500 },
      { x: 900, y: 530 },
      { x: 750, y: 530 },
      { x: 750, y: 550 },
      { x: 600, y: 550 },
    ]
    expect(
      nativeFaceAnnotationCandidates(input).annotations.filter(
        (entry) => entry.kind === 'sheet-metadata-cell',
      ),
    ).toEqual([])
  })
  it.each(['incomplete', 'stale', 'duplicate'])('returns no hints for %s native text', (kind) => {
    const { input } = fixture(),
      label = input.native.labels[0]
    if (!label) throw new Error('Missing test label')
    if (kind === 'incomplete') input.native.complete = false
    if (kind === 'stale') label.point.x++
    if (kind === 'duplicate') input.native.labels.push(label)
    const result = nativeFaceAnnotationCandidates(input)
    expect(result.refusalReason).not.toBeNull()
    expect(result.annotations).toEqual([])
  })
  it('leaves outlined text unknown and preserves geometry incompleteness', () => {
    const { input } = fixture()
    input.native.labels = []
    expect(nativeFaceAnnotationCandidates(input).unknownFaceIds).toHaveLength(8)
    input.work.truncated = true
    expect(nativeFaceAnnotationCandidates(input).annotations).toEqual([])
  })
})
