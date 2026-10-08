import { describe, expect, it } from 'vitest'
import { captionFrameComponents, type ReviewedCaptionFrames } from './plan-caption-frame-components'
import type { NativeTextAnchors } from './plan-document'
import type { PdfLinework } from './plan-pdf-linework'

const source = { sha256: 'a'.repeat(64), page: 1, width: 100, height: 100 }
const native: NativeTextAnchors = {
  source,
  complete: true,
  pageNormalizedScale: { x: 0.1, y: 0.1 },
  labels: [{ id: 'number', name: '1', point: { x: 40, y: 40 } }],
}
const sides = [
  [
    { x: 300, y: 300 },
    { x: 500, y: 300 },
  ],
  [
    { x: 500, y: 300 },
    { x: 500, y: 500 },
  ],
  [
    { x: 500, y: 500 },
    { x: 300, y: 500 },
  ],
  [
    { x: 300, y: 500 },
    { x: 300, y: 300 },
  ],
]
const work: PdfLinework = {
  coordinateSystem: 'page-0-1000',
  pageWidth: 100,
  pageHeight: 100,
  paths: sides.map((points, operationIndex) => ({
    operationIndex,
    subpathIndex: 0,
    paint: 'stroke',
    closed: false,
    points,
  })),
  skippedCurves: 0,
  unsupportedPaths: 0,
  unsupportedContexts: 0,
  clippedPaths: 0,
  truncated: false,
}
const reviewed: ReviewedCaptionFrames = {
  source,
  review: 'manual-caption-frame-review',
  frames: [
    {
      markerLabelId: 'number',
      sides: work.paths.map(({ operationIndex, subpathIndex }) => ({
        operationIndex,
        subpathIndex,
      })),
    },
  ],
}
function pixels(divide = false) {
  const raster = new Uint8Array(10_000)
  for (let y = 20; y < 80; y++) {
    for (let x = 20; x < 80; x++) {
      const frame =
        ((x === 30 || x === 50) && y >= 30 && y <= 50) ||
        ((y === 30 || y === 50) && x >= 30 && x <= 50)
      raster[y * 100 + x] = frame || (divide && y >= 38 && y <= 42) ? 0 : 255
    }
  }
  return raster
}
const input = { native, work, reviewed, lineworkSource: source, grayscale: pixels() }
describe('reviewed annotation-frame side components', () => {
  it('links a verified four-side annotation without modifying any source pixels', () => {
    const before = input.grayscale.slice()
    const result = captionFrameComponents(input)
    expect(result.links[0]?.regionId).toBeTruthy()
    expect(result.links[0]?.samples).toHaveLength(4)
    expect(result.links[0]?.reason).toBe('four-side-component-agreement')
    expect(result.status).toBe('draft')
    expect(input.grayscale).toEqual(before)
  })
  it('refuses sides in different or unknown components', () => {
    const result = captionFrameComponents({ ...input, grayscale: pixels(true) })
    expect(result.links[0]?.regionId).toBeNull()
  })
  it('blocks an unrelated native line through the annotation clearance', () => {
    const extra = {
      operationIndex: 10,
      subpathIndex: 0,
      paint: 'stroke' as const,
      closed: false,
      points: [
        { x: 270, y: 200 },
        { x: 270, y: 800 },
      ],
    }
    const result = captionFrameComponents({
      ...input,
      work: { ...work, paths: [...work.paths, extra] },
    })
    expect(result.links[0]?.reason).toBe('other-linework-or-omission-near-frame')
    expect(result.links[0]?.regionId).toBeNull()
  })
  it('blocks omitted curves near the frame instead of treating them as absent', () => {
    const result = captionFrameComponents({
      ...input,
      work: {
        ...work,
        skippedCurves: 1,
        skippedCurveBounds: [
          { operationIndex: 10, bounds: { left: 250, top: 250, right: 320, bottom: 320 } },
        ],
      },
    })
    expect(result.links[0]?.regionId).toBeNull()
  })
  it.each([
    { ...input, lineworkSource: { ...source, page: 2 } },
    { ...input, native: { ...native, complete: false } },
    { ...input, work: { ...work, truncated: true } },
    { ...input, work: { ...work, skippedCurves: 1 } },
    { ...input, native: { ...native, pageNormalizedScale: { x: 0.2, y: 0.1 } } },
    {
      ...input,
      native: { ...native, labels: [{ id: 'number', name: '1', point: { x: 80, y: 80 } }] },
    },
  ])('rejects unsupported source evidence', (invalid) => {
    expect(() => captionFrameComponents(invalid)).toThrow()
  })
  it('rejects reused sides and incomplete rectangles', () => {
    const first = reviewed.frames[0]
    if (!first) throw new Error('Missing fixture frame')
    expect(() =>
      captionFrameComponents({
        ...input,
        reviewed: { ...reviewed, frames: [{ ...first, sides: first.sides.slice(0, 3) }] },
      }),
    ).toThrow()
    expect(() =>
      captionFrameComponents({
        ...input,
        reviewed: {
          ...reviewed,
          frames: [
            {
              ...first,
              sides: Array.from({ length: 4 }, () => ({ operationIndex: 0, subpathIndex: 0 })),
            },
          ],
        },
      }),
    ).toThrow()
  })
})
