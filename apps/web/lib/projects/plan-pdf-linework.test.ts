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
  setLineWidth: 24,
  setLineCap: 25,
  setLineJoin: 26,
  setMiterLimit: 27,
  setDash: 28,
  setGState: 29,
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

describe('source stroke pen metadata without changing diagnostic centreline geometry', () => {
  it('keeps renderer Float32 operands separate from the existing rounded page points', () => {
    const values = new Float32Array([0, 10.123456, 20.654321, 1, 30.234567, 20.654321])
    const result = extract([[ops.constructPath, [ops.stroke, [values], []]]])
    expect(result.paths[0]?.points).toEqual([
      { x: 101.235, y: 896.728 },
      { x: 302.346, y: 896.728 },
    ])
    expect(result.paths[0]?.strokeInk?.points).toEqual([
      { x: values[1], y: values[2] },
      { x: values[4], y: values[5] },
    ])
    expect(result.paths[0]?.strokeInk?.points[0]?.x).not.toBe(10.123456)
    expect(result.paths[0]?.strokeInk?.sourceToPage).toEqual([10, 0, 0, -5, 0, 1000])
  })

  it('documents the default solid pen rather than guessing a source color', () => {
    const path = extract([stroke([0, 10, 20, 1, 30, 20])]).paths[0]
    expect(path?.strokeInk).toEqual({
      points: [
        { x: 10, y: 20 },
        { x: 30, y: 20 },
      ],
      sourceToPage: [10, 0, 0, -5, 0, 1000],
      lineWidth: 1,
      lineCap: 0,
      lineJoin: 0,
      miterLimit: 10,
      dashArray: [],
      dashPhase: 0,
      refusalReason: null,
    })
    expect(path?.strokeColor).toBeUndefined()
  })

  it('composes the viewport affine map and graphics transform on a non-square page', () => {
    const operations: Operation[] = [
      [ops.transform, [2, 1, 0.5, 3, 10, 20]],
      [ops.setLineWidth, [0.15]],
      stroke([0, 10, 20, 1, 20, 20]),
    ]
    const result = extractPdfLinework(
      {
        fnArray: operations.map(([fn]) => fn),
        argsArray: operations.map(([, args]) => args),
      },
      ops,
      {
        width: 200,
        height: 100,
        convertToViewportPoint: (x, y) => [2 * x + 5, 100 - 0.5 * y],
      },
    )
    const path = result.paths[0]
    expect(path?.points).toEqual([
      { x: 425, y: 550 },
      { x: 625, y: 500 },
    ])
    expect(path?.strokeInk).toMatchObject({
      points: [
        { x: 10, y: 20 },
        { x: 20, y: 20 },
      ],
      sourceToPage: [20, -5, 5, -15, 125, 900],
      lineWidth: 0.15,
      refusalReason: null,
    })
  })

  it('restores nested pen and dash states without sharing mutable dash arrays', () => {
    const dash = [3, 2]
    const result = extract([
      [ops.setLineWidth, [2]],
      [ops.save, null],
      [ops.setDash, [dash, 1]],
      [ops.setLineCap, [2]],
      stroke([0, 10, 20, 1, 30, 20]),
      [ops.save, null],
      [ops.setLineWidth, ['invalid']],
      [ops.setDash, [[], 0]],
      stroke([0, 10, 20, 1, 30, 20]),
      [ops.restore, null],
      stroke([0, 10, 20, 1, 30, 20]),
      [ops.restore, null],
      stroke([0, 10, 20, 1, 30, 20]),
    ])
    dash[0] = 99
    expect(result.paths.map((path) => path.strokeInk?.refusalReason)).toEqual([
      'dashed-source-pen',
      'invalid-source-pen-state',
      'dashed-source-pen',
      null,
    ])
    expect(result.paths.map((path) => path.strokeInk?.dashArray)).toEqual([[3, 2], [], [3, 2], []])
    expect(result.paths.map((path) => path.strokeInk?.lineCap)).toEqual([2, 2, 2, 0])
    expect(result.paths.map((path) => path.strokeInk?.lineWidth)).toEqual([2, 2, 2, 2])
    expect(result.paths[0]?.strokeInk?.dashArray).not.toBe(result.paths[2]?.strokeInk?.dashArray)
  })

  it('reads PDF.js graphics-state LW, LC, LJ, ML and D operands', () => {
    const result = extract([
      [
        ops.setGState,
        [
          [
            ['LW', 0.25],
            ['LC', 1],
            ['LJ', 2],
            ['ML', 7],
            ['D', [[4, 2], 0.5]],
          ],
        ],
      ],
      stroke([0, 10, 20, 1, 30, 20]),
      [ops.setDash, [[], 0]],
      [ops.setLineJoin, [1]],
      [ops.setMiterLimit, [5]],
      stroke([0, 10, 20, 1, 30, 20]),
    ])
    expect(result.paths[0]?.strokeInk).toMatchObject({
      lineWidth: 0.25,
      lineCap: 1,
      lineJoin: 2,
      miterLimit: 7,
      dashArray: [4, 2],
      dashPhase: 0.5,
      refusalReason: 'dashed-source-pen',
    })
    expect(result.paths[1]?.strokeInk).toMatchObject({
      lineWidth: 0.25,
      lineCap: 1,
      lineJoin: 1,
      miterLimit: 5,
      dashArray: [],
      dashPhase: 0,
      refusalReason: null,
    })
  })

  it.each([
    [ops.setLineWidth, [0], 'device-dependent-source-hairline'],
    [ops.setDash, [[1, 2], 0], 'dashed-source-pen'],
    [ops.setLineWidth, [-1], 'invalid-source-pen-state'],
    [ops.setLineCap, [3], 'invalid-source-pen-state'],
    [ops.setLineJoin, [Number.NaN], 'invalid-source-pen-state'],
    [ops.setMiterLimit, [0.5], 'invalid-source-pen-state'],
    [ops.setDash, [[1, -2], 0], 'invalid-source-pen-state'],
    [ops.setGState, [[['LW', 2], ['D']]], 'invalid-source-pen-state'],
    [ops.setGState, ['invalid'], 'invalid-source-pen-state'],
  ])(
    'retains the path but refuses unsupported or malformed pen state (%s, %j)',
    (fn, args, reason) => {
      const result = extract([[fn as number, args], stroke([0, 10, 20, 1, 30, 20])])
      expect(result.paths).toHaveLength(1)
      expect(result.paths[0]?.strokeInk?.refusalReason).toBe(reason)
      expect(result.paths[0]?.points).toEqual([
        { x: 100, y: 900 },
        { x: 300, y: 900 },
      ])
    },
  )

  it('refuses a singular pen transform without inventing a finite ink envelope', () => {
    const result = extract([[ops.transform, [1, 0, 2, 0, 10, 20]], stroke([0, 10, 20, 1, 30, 20])])
    expect(result.paths).toHaveLength(1)
    expect(result.paths[0]?.strokeInk?.refusalReason).toBe('unstable-source-pen-transform')
  })

  it.each([
    [0, 10, 20, 1, 30, 20, 1, 30, 30],
    [0, 10, 20, 1, 30, 20, 1, 30, 30, 4],
  ])('keeps multi-edge or closed pen topology held (%j)', (...values) => {
    const result = extract([stroke(values)])
    expect(result.paths).toHaveLength(1)
    expect(result.paths[0]?.strokeInk?.refusalReason).toBe('unsupported-source-pen-topology')
  })

  it('checks the full pen envelope inside a rectangular clip, not just the centreline', () => {
    const result = extract([
      [ops.clip, null],
      [ops.constructPath, [ops.endPath, [[0, 10, 10, 1, 30, 10, 1, 30, 30, 1, 10, 30, 4]], []]],
      stroke([0, 10.25, 20, 1, 25, 20]),
      stroke([0, 15, 20, 1, 25, 20]),
    ])
    expect(result.paths).toHaveLength(2)
    expect(result.clippedPaths).toBe(0)
    expect(result.paths.map((path) => path.strokeInk?.refusalReason)).toEqual([
      'source-pen-envelope-clipped',
      null,
    ])
  })

  it('holds polygon clips and page-crop edge overlap and attaches no pen to pure fill', () => {
    const polygon = extract([
      [ops.clip, null],
      [ops.constructPath, [ops.endPath, [[0, 10, 10, 1, 30, 10, 1, 20, 30, 4]], []]],
      stroke([0, 20, 12, 1, 20, 20]),
    ])
    expect(polygon.paths[0]?.strokeInk?.refusalReason).toBe('unsupported-source-pen-clip')
    const page = extract([
      stroke([0, 0.25, 20, 1, 30, 20]),
      [ops.constructPath, [ops.fill, [[0, 10, 20, 1, 20, 20, 1, 20, 30, 4]], []]],
    ])
    expect(page.paths[0]?.strokeInk?.refusalReason).toBe('source-pen-envelope-clipped')
    expect(page.paths[1]?.strokeInk).toBeUndefined()
  })
})

describe('PDF.js 6 diagnostic straight linework, not room geometry', () => {
  it('does not accept a thin pen outside an unrounded clip that the diagnostic grid expands', () => {
    const result = extract([
      [ops.clip, []],
      [
        ops.constructPath,
        [ops.endPath, [[0, 10.000049, 10, 1, 30, 10, 1, 30, 30, 1, 10.000049, 30, 4]], []],
      ],
      [ops.setLineWidth, [0.000005]],
      stroke([0, 10.00005, 15, 1, 10.00005, 25]),
    ])
    expect(result.paths).toHaveLength(1)
    expect(result.paths[0]?.strokeInk?.refusalReason).toBe('source-pen-envelope-clipped')
    // The legacy drawing layer is intentionally still quantized independently.
    expect(result.paths[0]?.points[0]?.x).toBe(100)
  })
  it.each([
    [ops.stroke, 'stroke'],
    [ops.fill, 'fill'],
    [ops.fillStroke, 'fill-stroke'],
  ] as const)('retains the actual paint role for omitted paths (%s)', (paint, paintKind) => {
    const result = extract([
      [ops.constructPath, [paint, [new Float32Array([0, -10, 20, 1, 30, 20])], []]],
      [ops.constructPath, [paint, [new Float32Array([0, 10, 20, 2, 20, 30, 30, 40, 40, 40])], []]],
    ])
    expect(result.clippedPaths).toBe(1)
    expect(result.clippedPathBounds?.[0]?.paint).toBe(paintKind)
    expect(result.skippedCurves).toBe(1)
    expect(result.skippedCurveBounds?.[0]?.paint).toBe(paintKind)
    expect(result.paths).toEqual([])
  })

  it('не считает пустой endPath потерянной геометрией и сохраняет соседние линии', () => {
    const result = extract([
      stroke([0, 10, 20, 1, 30, 20]),
      [ops.constructPath, [ops.endPath, [null], null]],
      stroke([0, 10, 30, 1, 30, 30]),
    ])
    expect(result.unsupportedPaths).toBe(0)
    expect(result.paths.map((path) => path.operationIndex)).toEqual([0, 2])
    expect(result.paths.map((path) => path.points)).toEqual([
      [
        { x: 100, y: 900 },
        { x: 300, y: 900 },
      ],
      [
        { x: 100, y: 850 },
        { x: 300, y: 850 },
      ],
    ])
  })

  it('не отменяет неизвестную маску пустой командой сброса', () => {
    const result = extract([
      [ops.clip, []],
      [ops.constructPath, [ops.endPath, [null], null]],
      stroke([0, 10, 20, 1, 30, 20]),
    ])
    expect(result.unsupportedPaths).toBe(1)
    expect(result.paths).toEqual([])
  })

  it.each([
    [ops.stroke, [null], null],
    [ops.endPath, [null, null], null],
    [ops.endPath, [null], []],
    [ops.endPath, [[0, 10]], null],
  ])('не принимает повреждённый или другой путь за пустой сброс: %j', (paint, paths, bounds) => {
    const result = extract([[ops.constructPath, [paint, paths, bounds]]])
    expect(result.unsupportedPaths).toBe(1)
    expect(result.paths).toEqual([])
  })

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
    expect(result.skippedCurveBounds).toEqual([
      {
        operationIndex: 0,
        bounds: { left: 100, top: 800, right: 400, bottom: 900 },
        paint: 'stroke',
      },
    ])
    expect(result.paths).toHaveLength(1)
    expect(result.paths[0]?.points).toEqual([
      { x: 500, y: 750 },
      { x: 600, y: 700 },
    ])
    expect(result.curvePaths).toEqual([
      {
        operationIndex: 0,
        subpathIndex: 0,
        operationSubpathCount: 2,
        paint: 'stroke',
        closed: true,
        start: { x: 100, y: 900 },
        segments: [
          { kind: 'line', end: { x: 200, y: 900 } },
          {
            kind: 'cubic',
            control1: { x: 200, y: 850 },
            control2: { x: 300, y: 800 },
            end: { x: 400, y: 800 },
          },
        ],
      },
    ])
  })

  it('retains transformed quadratic/cubic commands and source styles without flattening', () => {
    const result = extract([
      [ops.transform, [2, 0, 0, 2, 10, 20]],
      [ops.setStrokeRGBColor, ['#123456']],
      stroke([0, 1, 2, 3, 2, 3, 4, 5, 2, 6, 7, 8, 9, 10, 11]),
    ])
    expect(result.paths).toEqual([])
    expect(result.skippedCurves).toBe(1)
    expect(result.curvePaths).toEqual([
      {
        operationIndex: 2,
        subpathIndex: 0,
        operationSubpathCount: 1,
        paint: 'stroke',
        strokeColor: '#123456',
        closed: false,
        start: { x: 120, y: 880 },
        segments: [
          { kind: 'quadratic', control: { x: 140, y: 870 }, end: { x: 180, y: 850 } },
          {
            kind: 'cubic',
            control1: { x: 220, y: 830 },
            control2: { x: 260, y: 810 },
            end: { x: 300, y: 790 },
          },
        ],
      },
    ])
  })

  it('does not retain a curve with invisible controls even when its endpoints are visible', () => {
    const result = extract([
      [ops.save, []],
      [ops.clip, []],
      [ops.constructPath, [ops.endPath, [[0, 10, 10, 1, 30, 10, 1, 30, 30, 1, 10, 30, 4]], []]],
      stroke([0, 15, 15, 2, 40, 15, 15, 25, 25, 25]),
      [ops.restore, []],
      stroke([0, 15, 15, 2, 40, 15, 15, 25, 25, 25]),
    ])
    expect(result.curvePaths?.map((path) => path.operationIndex)).toEqual([5])
    expect(result.skippedCurves).toBe(2)
    expect(result.skippedCurveBounds).toHaveLength(2)
    expect(result.paths).toEqual([])
  })

  it('retains no symbol commands under a polygon clip, without pretending omissions disappeared', () => {
    const result = extract([
      [ops.clip, []],
      [ops.constructPath, [ops.endPath, [[0, 10, 10, 1, 40, 10, 1, 25, 40, 4]], []]],
      stroke([0, 20, 15, 2, 22, 15, 25, 18, 25, 20]),
    ])
    expect(result.curvePaths).toEqual([])
    expect(result.skippedCurves).toBe(1)
    expect(result.skippedCurveBounds).toHaveLength(1)
  })

  it('caps retained curve commands separately and keeps the omission inventory', () => {
    const result = extract(
      Array.from({ length: 3001 }, () => stroke([0, 10, 10, 2, 12, 10, 20, 12, 20, 20])),
    )
    expect(result.curvePaths).toHaveLength(3000)
    expect(result.curvePathsTruncated).toBe(true)
    expect(result.skippedCurves).toBe(3001)
    expect(result.skippedCurveBoundsTruncated).toBe(true)
    expect(result.paths).toEqual([])
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
    expect(result.clippedPathBounds).toEqual([
      {
        operationIndex: 4,
        bounds: { left: 150, top: 825, right: 350, bottom: 925 },
        paint: 'stroke',
      },
    ])
    expect(result.unsupportedContexts).toBe(0)
  })

  it('uses a polygonal clip without exposing paths outside its shape', () => {
    const result = extract([
      [ops.save, null],
      [ops.eoClip, null],
      [ops.constructPath, [ops.endPath, [[0, 10, 10, 1, 30, 10, 1, 20, 30, 4]], []]],
      stroke([0, 20, 12, 1, 20, 20]),
      stroke([0, 15, 15, 1, 25, 25]),
      [ops.restore, null],
      stroke([0, 15, 15, 1, 25, 25]),
    ])
    expect(result.paths).toHaveLength(2)
    expect(result.clippedPaths).toBe(1)
    expect(result.unsupportedContexts).toBe(0)
  })

  it('rejects a segment that crosses the missing corner of a concave clip', () => {
    const result = extract([
      [ops.clip, null],
      [
        ops.constructPath,
        [ops.endPath, [[0, 10, 10, 1, 30, 10, 1, 30, 20, 1, 20, 20, 1, 20, 30, 1, 10, 30, 4]], []],
      ],
      stroke([0, 15, 28, 1, 28, 15]),
      stroke([0, 12, 12, 1, 28, 12]),
    ])
    expect(result.paths).toHaveLength(1)
    expect(result.clippedPaths).toBe(1)
    expect(result.unsupportedContexts).toBe(0)
  })

  it('still refuses a curved clipping path instead of replacing it with a chord', () => {
    const result = extract([
      [ops.clip, null],
      [ops.constructPath, [ops.endPath, [[0, 10, 10, 2, 20, 20, 20, 30, 30, 30, 4]], []]],
      stroke([0, 15, 15, 1, 25, 25]),
    ])
    expect(result.paths).toHaveLength(0)
    expect(result.unsupportedContexts).toBe(1)
  })

  it('refuses a self-intersecting clipping polygon', () => {
    const result = extract([
      [ops.clip, null],
      [ops.constructPath, [ops.endPath, [[0, 10, 10, 1, 30, 30, 1, 10, 30, 1, 30, 10, 4]], []]],
      stroke([0, 15, 15, 1, 25, 15]),
    ])
    expect(result.paths).toHaveLength(0)
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
