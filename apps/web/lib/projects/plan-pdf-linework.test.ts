import { describe, expect, it } from 'vitest'
import { extractPdfLinework, pdfVectorRectangle } from './plan-pdf-linework'

const ops = {
  save: 1,
  restore: 2,
  transform: 3,
  clip: 4,
  eoClip: 5,
  constructPath: 6,
  stroke: 7,
  closeStroke: 8,
  fill: 9,
  eoFill: 10,
  fillStroke: 11,
  eoFillStroke: 12,
  closeFillStroke: 13,
  closeEOFillStroke: 14,
  endPath: 15,
  paintFormXObjectBegin: 16,
  paintFormXObjectEnd: 17,
  beginGroup: 18,
  endGroup: 19,
  beginAnnotation: 20,
  endAnnotation: 21,
  setFillRGBColor: 22,
  setStrokeRGBColor: 23,
}
const viewport = {
  width: 100,
  height: 200,
  convertToViewportPoint: (x: number, y: number) => [x, 200 - y],
}
type Operation = [number, unknown]
const stroke = (values: number[]): Operation => [
  ops.constructPath,
  [ops.stroke, [new Float32Array(values)], []],
]
const extract = (operations: Operation[]) =>
  extractPdfLinework(
    {
      fnArray: operations.map(([fn]) => fn),
      argsArray: operations.map(([, args]) => args),
    },
    ops,
    viewport,
  )

describe('PDF.js 6 diagnostic straight linework, not room geometry', () => {
  it('composes transforms, flips the PDF axis and restores the saved graphics state', () => {
    const reading = extract([
      [ops.transform, [2, 0, 0, 2, 10, 20]],
      [ops.save, null],
      [ops.transform, [1, 0, 0, 1, 5, 10]],
      stroke([0, 1, 2, 1, 3, 4]),
      [ops.restore, null],
      stroke([0, 1, 2, 1, 3, 4]),
    ])
    expect(reading.paths.map((path) => path.points)).toEqual([
      [
        { x: 220, y: 780 },
        { x: 260, y: 760 },
      ],
      [
        { x: 120, y: 880 },
        { x: 160, y: 860 },
      ],
    ])
    expect(reading.unsupportedContexts).toBe(0)
  })

  it('supports rotation/shear matrices without treating the transformed path as axis aligned', () => {
    const result = extract([[ops.transform, [0, 1, -1, 0, 50, 20]], stroke([0, 0, 0, 1, 10, 20])])
    expect(result.paths[0]?.points).toEqual([
      { x: 500, y: 900 },
      { x: 300, y: 850 },
    ])
  })

  it('keeps subpaths separate and recognises a straight filled arrow triangle', () => {
    const result = extract([
      [
        ops.constructPath,
        [
          ops.closeFillStroke,
          [[0, 10, 20, 1, 12, 21, 1, 12, 19, 4, 0, 20, 20, 1, 22, 21, 1, 22, 19, 4]],
          [],
        ],
      ],
    ])
    expect(result.paths).toHaveLength(2)
    expect(result.paths.every((path) => path.closed && path.paint === 'fill-stroke')).toBe(true)
    expect(result.paths.map((path) => path.subpathIndex)).toEqual([0, 1])
  })

  it('retains only valid source colors for painted paths and restores the parent style', () => {
    const filled: Operation = [
      ops.constructPath,
      [ops.fillStroke, [[0, 10, 20, 1, 20, 20, 1, 20, 30, 4]], []],
    ]
    const result = extract([
      [ops.setFillRGBColor, ['#989898']],
      [ops.setStrokeRGBColor, ['#545454']],
      filled,
      [ops.save, null],
      [ops.setFillRGBColor, ['#FF00FF']],
      [ops.setStrokeRGBColor, ['invalid']],
      filled,
      [ops.restore, null],
      filled,
      stroke([0, 10, 20, 1, 20, 20]),
    ])
    expect(result.paths.map(({ fillColor, strokeColor }) => [fillColor, strokeColor])).toEqual([
      ['#989898', '#545454'],
      ['#ff00ff', undefined],
      ['#989898', '#545454'],
      [undefined, '#545454'],
    ])
  })

  it('skips a curved subpath instead of drawing an invented door-arc chord or closing edge', () => {
    const result = extract([
      stroke([0, 10, 20, 1, 20, 20, 2, 20, 30, 30, 40, 40, 40, 4, 0, 50, 50, 1, 60, 60]),
    ])
    expect(result.skippedCurves).toBe(1)
    expect(result.paths).toHaveLength(1)
    expect(result.paths[0]?.points).toEqual([
      { x: 500, y: 750 },
      { x: 600, y: 700 },
    ])
  })

  it('honours a rectangular clip and restores the unclipped parent state', () => {
    const result = extract([
      [ops.save, null],
      [ops.clip, null],
      [ops.constructPath, [ops.endPath, [[0, 10, 10, 1, 30, 10, 1, 30, 30, 1, 10, 30, 4]], []]],
      stroke([0, 15, 15, 1, 25, 25]),
      stroke([0, 15, 15, 1, 35, 35]),
      [ops.restore, null],
      stroke([0, 15, 15, 1, 35, 35]),
    ])
    expect(result.paths).toHaveLength(2)
    expect(result.clippedPaths).toBe(1)
    expect(result.unsupportedContexts).toBe(0)
  })

  it('does not treat a nonrectangular or curved clipping path as its bounding box', () => {
    const result = extract([
      [ops.save, null],
      [ops.eoClip, null],
      [ops.constructPath, [ops.endPath, [[0, 10, 10, 1, 30, 10, 1, 20, 30, 4]], []]],
      stroke([0, 15, 15, 1, 25, 25]),
      [ops.restore, null],
      stroke([0, 15, 15, 1, 25, 25]),
    ])
    expect(result.paths).toHaveLength(1)
    expect(result.unsupportedContexts).toBe(1)
  })

  it.each([ops.paintFormXObjectBegin, ops.beginGroup, ops.beginAnnotation])(
    'does not assume unsupported context %i uses the parent transform',
    (fn) => {
      const end =
        fn === ops.beginGroup
          ? ops.endGroup
          : fn === ops.beginAnnotation
            ? ops.endAnnotation
            : ops.paintFormXObjectEnd
      const result = extract([
        [fn, []],
        stroke([0, 1, 1, 1, 2, 2]),
        [end, []],
        stroke([0, 1, 1, 1, 2, 2]),
      ])
      expect(result.paths).toHaveLength(1)
      expect(result.unsupportedContexts).toBe(1)
    },
  )

  it.each(
    [
      [0, 10],
      [0, 1, 2, 99, 3, 4],
      [1, 1, 2],
      [0, 1, 2, 1, Number.NaN, 3],
      [0, 1, 2, 4, 1, 3, 4],
    ].map((values) => [values]),
  )('rejects malformed draw commands without joining remaining points: %j', (values) => {
    const result = extract([stroke(values)])
    expect(result.paths).toEqual([])
    expect(result.unsupportedPaths).toBe(1)
  })

  it('marks a broken transform or unmatched state stack instead of emitting shifted lines', () => {
    const transform = extract([[ops.transform, [1, 0, 0, 1, null, 0]], stroke([0, 1, 1, 1, 2, 2])])
    const restore = extract([[ops.restore, null], stroke([0, 1, 1, 1, 2, 2])])
    for (const result of [transform, restore]) {
      expect(result.paths).toEqual([])
      expect(result.unsupportedContexts).toBe(1)
    }
  })

  it('does not expose lines outside the visible page as usable arrow stems', () => {
    const result = extract([stroke([0, -1, 20, 1, 20, 20])])
    expect(result.paths).toEqual([])
    expect(result.clippedPaths).toBe(1)
  })

  it('detects an explicit closed rectangle but not diagonal corner order', () => {
    const result = extract([
      stroke([0, 10, 10, 1, 30, 10, 1, 30, 30, 1, 10, 30, 1, 10, 10]),
      [ops.constructPath, [ops.closeStroke, [[0, 10, 10, 1, 30, 30, 1, 30, 10, 1, 10, 30]], []]],
    ])
    const first = result.paths[0]
    const second = result.paths[1]
    expect(first && pdfVectorRectangle(first)).toEqual({
      left: 100,
      right: 300,
      top: 850,
      bottom: 950,
    })
    expect(second && pdfVectorRectangle(second)).toBeUndefined()
  })

  it('caps paths and explicitly marks an incomplete vector layer', () => {
    const result = extract(Array.from({ length: 3001 }, () => stroke([0, 1, 1, 1, 2, 2])))
    expect(result.paths).toHaveLength(3000)
    expect(result.truncated).toBe(true)
  })
})
