import { describe, expect, it } from 'vitest'
import nativeLabels from '../../../../docs/qa/fixtures/apartment-74-77-native-labels.json'
import annotated from '../../../../docs/qa/fixtures/apartment-74-77-page-contours.json'
import type { NativeTextAnchors } from './plan-document'
import {
  nativeDimensionEvidence,
  type ReviewedNativeDimensions,
} from './plan-native-dimension-evidence'
import type { PdfLinework, PdfVectorPath } from './plan-pdf-linework'

const frame = { sha256: 'a'.repeat(64), page: annotated.source.pdfPage, width: 1000, height: 1000 }
const room = annotated.rooms.find((entry) => entry.roomSourceNumber === 4)
if (!room) throw new Error('Missing unit fixture room')
const ids = room.widthLabels.map((index) => `native-text-${index}`)
const native: NativeTextAnchors = {
  source: frame,
  originalPdfSha256: annotated.source.sha256,
  complete: true,
  labels: room.widthLabels.map((index) => {
    const label = nativeLabels.items.find((item) => item.index === index)
    if (!label) throw new Error('Missing unit fixture label')
    return {
      id: `native-text-${index}`,
      name: label.text,
      nativeIndex: index,
      rotation: label.rotation,
      point: { x: label.x, y: label.y },
      pagePoint: { x: label.x, y: label.y },
    }
  }),
}
const work: PdfLinework = {
  coordinateSystem: 'page-0-1000',
  pageWidth: 842,
  pageHeight: 1191,
  paths: annotated.dimensionPaths as PdfVectorPath[],
  skippedCurves: 0,
  unsupportedPaths: 0,
  unsupportedContexts: 0,
  clippedPaths: 0,
  truncated: false,
}
const reviewed: ReviewedNativeDimensions = {
  review: 'manual-native-dimension-review',
  source: { ...annotated.source, state: 'existing' },
  rasterSource: frame,
  chains: [{ id: 'width-chain', axis: 'width', labelIds: ids }],
  wallOperations: [],
}
const input = { native, work, reviewed, lineworkSource: frame }
describe('source-bound printed dimension evidence', () => {
  it('derives millimetres from selected text and preserves exact native rail identities', () => {
    const result = nativeDimensionEvidence(input)
    expect(result.status).toBe('draft')
    const chain = result.chains[0]
    expect(chain?.result.status).toBe('candidate')
    if (chain?.result.status !== 'candidate') throw new Error('Missing unit candidate')
    expect(chain.result.totalMm).toBe(
      native.labels.reduce(
        (sum, label) => sum + Number(label.name.replaceAll(' ', '').replace(',', '.')),
        0,
      ),
    )
    expect(chain.rails).toHaveLength(native.labels.length)
  })
  it('refuses a rail that is also declared as a wall, without erasing any data', () => {
    const positive = nativeDimensionEvidence(input)
    const operation = positive.chains[0]?.rails[0]?.operationIndex
    if (operation === undefined) throw new Error('Missing fixture rail')
    const result = nativeDimensionEvidence({
      ...input,
      reviewed: { ...reviewed, wallOperations: [operation] },
    })
    expect(result.chains[0]?.result).toEqual({
      status: 'unresolved',
      reason: 'dimension-wall-role-conflict',
    })
    expect(result.chains[0]?.rails).toEqual([])
    expect(input.work.paths).toBe(work.paths)
  })
  it('preserves native disconnection and truncation refusals', () => {
    const result = nativeDimensionEvidence({ ...input, work: { ...work, paths: [] } })
    expect(result.chains[0]?.result.status).toBe('unresolved')
    const truncated = nativeDimensionEvidence({ ...input, work: { ...work, truncated: true } })
    expect(truncated.chains[0]?.result).toEqual({
      status: 'unresolved',
      reason: 'incomplete-native-page',
    })
  })
  it.each([
    { ...reviewed, source: { ...reviewed.source, sha256: frame.sha256 } },
    { ...reviewed, source: { ...reviewed.source, pdfPage: frame.page + 1 } },
    { ...reviewed, rasterSource: { ...frame, page: frame.page + 1 } },
    { ...reviewed, chains: [{ id: 'bad', axis: 'width', labelIds: ['missing'] }] },
    { ...reviewed, chains: [{ id: 'bad', axis: 'width', labelIds: [ids[0], ids[0]] }] },
  ])('rejects changed source and invalid selections', (invalid) => {
    expect(() =>
      nativeDimensionEvidence({ ...input, reviewed: invalid as ReviewedNativeDimensions }),
    ).toThrow()
  })
  it('does not substitute raster coordinates for missing page-native evidence', () => {
    const changed = {
      ...native,
      labels: native.labels.map((label) => ({ ...label, pagePoint: undefined })),
    }
    expect(() => nativeDimensionEvidence({ ...input, native: changed })).toThrow()
    expect(() =>
      nativeDimensionEvidence({ ...input, native: { ...native, complete: false } }),
    ).toThrow()
  })
})
