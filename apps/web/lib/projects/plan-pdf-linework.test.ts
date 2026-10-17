import { createHash } from 'node:crypto'
import { existsSync } from 'node:fs'
import { readFile } from 'node:fs/promises'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import { extractPdfLinework, pdfVectorRectangle } from './plan-pdf-linework'

const originalSource = fileURLToPath(
  new URL('../../../../output/pdf/source-search-20261003/rebrina-original.pdf', import.meta.url),
)
const decoSource = fileURLToPath(
  new URL('../../../../tmp/pdfs/deco-art-dvushka-source.pdf', import.meta.url),
)
it.skipIf(!existsSync(decoSource))(
  'retains the complete DECO curve inventory inside its concave page mask',
  async () => {
    const bytes = await readFile(decoSource)
    expect(createHash('sha256').update(bytes).digest('hex')).toBe(
      'fee92486f301e8a40886914c74b9a83ce77747c6ee14dd4ee0a666dec4a647fd',
    )
    const { preparePlanPage } = await import('./plan-document')
    const page = await preparePlanPage(bytes, true, 3, true, true)
    expect(page.linework?.skippedCurves).toBe(14)
    expect(page.linework?.curvePaths).toHaveLength(14)
    expect(page.linework?.curvePathsTruncated).toBe(false)
    expect(page.linework?.paths.every((path) => path.points.length > 0)).toBe(true)
    if (!page.linework || !page.nativeTextAnchors || !page.lineworkRasterSource)
      throw new Error('Missing DECO source evidence')
    const { nativeDoorSymbolCandidates } = await import('./plan-native-door-symbols')
    const doors = nativeDoorSymbolCandidates({
      native: page.nativeTextAnchors,
      work: page.linework,
      lineworkSource: page.lineworkRasterSource,
    })
    expect(doors.refusalReason).toBeNull()
    expect(doors.candidates.map((candidate) => candidate.arc.operationIndex)).toEqual([
      4981, 8615, 18688,
    ])
    expect(doors.candidates.every((candidate) => !candidate.physicalPassageAccepted)).toBe(true)
    expect(doors.completeOpeningInventory).toBe(false)
    expect(doors.closesFloorBoundary).toBe(false)
  },
  30_000,
)
it.skipIf(!existsSync(originalSource))(
  'keeps original hairline paint bounded without upgrading hairlines to physical ink evidence',
  async () => {
    const bytes = await readFile(originalSource)
    expect(createHash('sha256').update(bytes).digest('hex')).toBe(
      '2e141c135812c81719e1f4783173cb5202e20041ac494d3cc799eb37ad62ad4e',
    )
    const { preparePlanPage } = await import('./plan-document')
    const page = await preparePlanPage(bytes, true, 3, true, true)
    const work = page.linework
    if (!work?.paintBounds) throw new Error('Missing real source paint inventory')
    expect(work.paintBounds.complete).toBe(true)
    expect(work.paintBounds.refusalReason).toBeNull()
    expect(work.paintBounds.events.length).toBeGreaterThan(0)
    for (const event of work.paintBounds.events.filter((item) => item.bounds === null)) {
      expect(event).toMatchObject({ kind: 'text', reason: 'empty-source-text-paint' })
    }
    const hairlines = work.paths.filter((path) => path.strokeInk?.lineWidth === 0)
    expect(hairlines.length).toBeGreaterThan(0)
    for (const path of hairlines) {
      expect(path.strokeInk?.refusalReason).toBe('device-dependent-source-hairline')
      const event = work.paintBounds.events.find(
        (item) => item.operationIndex === path.operationIndex,
      )
      expect(event?.kind).toBe('vector')
      expect(event?.bounds).not.toBeNull()
      expect(event?.reason).toBeNull()
    }
  },
  30_000,
)

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
  showText: 30,
  paintImageXObject: 31,
  paintImageXObjectRepeat: 32,
  shadingFill: 33,
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
const extract = (operations: Operation[], paintViewport?: { width: number; height: number }) =>
  extractPdfLinework(
    {
      fnArray: operations.map(([fn]) => fn),
      argsArray: operations.map(([, args]) => args),
    },
    ops,
    viewport,
    paintViewport,
  )

describe('renderer-resolution stroke exclusion envelopes', () => {
  const matrices = [
    [1, 0, 0, 1, 0, 0],
    [2, 0, 0, 2, 0, 0],
    [2, 0, 0, 0.5, 0, 0],
    [1, 0.25, 0.5, 1, 0, 0],
    [-1, 0, 0, 1, 60, 0],
    [0, 1, -1, 0, 60, 0],
  ]
  const cases = matrices.flatMap((matrix) => [0, 0.01, 2].map((width) => ({ matrix, width })))

  it.each(cases)(
    'encloses installed renderer stroke width $width under $matrix',
    ({ matrix, width }) => {
      const [a = 0, b = 0, c = 0, d = 0, tx = 0, ty = 0] = matrix
      const operations: Operation[] = [
        [ops.transform, matrix],
        [ops.setLineWidth, [width]],
        stroke([0, 10, 20, 1, 20, 20]),
      ]
      const result = extract(operations, { width: 200, height: 400 })
      const bounds = result.paintBounds?.events[0]?.bounds
      if (!bounds) throw new Error('Missing device-pixel stroke envelope')

      // Independent replay of the installed PDF.js getScaleForStroking branches.
      // Viewport maps y downward and the output raster doubles each PDF unit.
      const da = 2 * a
      const db = -2 * b
      const dc = 2 * c
      const dd = -2 * d
      const normX = Math.hypot(da, db)
      const normY = Math.hypot(dc, dd)
      const determinant = Math.abs(da * dd - db * dc)
      const scaleX =
        db === 0 && dc === 0
          ? width === 0
            ? 1 / normX
            : Math.max(1, 1 / (normX * width))
          : width === 0
            ? normY / determinant
            : Math.max(1, normY / (width * determinant))
      const scaleY =
        db === 0 && dc === 0
          ? width === 0
            ? 1 / normY
            : Math.max(1, 1 / (normY * width))
          : width === 0
            ? normX / determinant
            : Math.max(1, normX / (width * determinant))
      const radius = ((width || 1) * Math.SQRT2) / 2
      const padX = radius * Math.hypot(10 * a * scaleX, 10 * c * scaleY)
      const padY = radius * Math.hypot(-5 * b * scaleX, -5 * d * scaleY)
      const ends = [10, 20].map((x) => ({
        x: 10 * (a * x + c * 20 + tx),
        y: 1000 - 5 * (b * x + d * 20 + ty),
      }))
      expect(bounds.left).toBeCloseTo(Math.min(...ends.map((point) => point.x)) - padX, 7)
      expect(bounds.right).toBeCloseTo(Math.max(...ends.map((point) => point.x)) + padX, 7)
      expect(bounds.top).toBeCloseTo(Math.min(...ends.map((point) => point.y)) - padY, 7)
      expect(bounds.bottom).toBeCloseTo(Math.max(...ends.map((point) => point.y)) + padY, 7)
      expect(result.paths).toEqual(extract(operations).paths)
      const region = result.paintBounds?.events[0]?.straightStrokeRegion
      if (!region) throw new Error('Missing straight raster stroke region')
      expect(region.start.x).toBeCloseTo(10 / scaleX, 7)
      expect(region.start.y).toBeCloseTo(20 / scaleY, 7)
      expect(region.end.x).toBeCloseTo(20 / scaleX, 7)
      expect(region.end.y).toBeCloseTo(20 / scaleY, 7)
      expect(region.radius).toBe((width || 1) / 2)
      const expectedMatrix = [
        10 * a * scaleX,
        -5 * b * scaleX,
        10 * c * scaleY,
        -5 * d * scaleY,
        10 * tx,
        1000 - 5 * ty,
      ]
      region.sourceToPage.forEach((value, index) => {
        expect(value).toBeCloseTo(expectedMatrix[index] ?? Number.NaN, 7)
      })
      for (const [index, end] of [region.start, region.end].entries()) {
        const mapped = {
          x:
            region.sourceToPage[0] * end.x +
            region.sourceToPage[2] * end.y +
            region.sourceToPage[4],
          y:
            region.sourceToPage[1] * end.x +
            region.sourceToPage[3] * end.y +
            region.sourceToPage[5],
        }
        expect(mapped.x).toBeCloseTo(ends[index]?.x ?? Number.NaN, 7)
        expect(mapped.y).toBeCloseTo(ends[index]?.y ?? Number.NaN, 7)
      }
      if (width === 0) {
        expect(result.paths[0]?.strokeInk?.refusalReason).toBe('device-dependent-source-hairline')
      }
    },
  )

  it('widens thin paint but not physical pen evidence or source coordinates', () => {
    const operations: Operation[] = [[ops.setLineWidth, [0.01]], stroke([0, 10, 20, 1, 20, 20])]
    const nominal = extract(operations)
    const device = extract(operations, { width: 100, height: 200 })
    expect(device.paintBounds?.events[0]?.bounds?.left).toBeLessThan(
      nominal.paintBounds?.events[0]?.bounds?.left ?? 0,
    )
    expect(device.paintBounds?.events[0]?.bounds?.top).toBeLessThan(
      nominal.paintBounds?.events[0]?.bounds?.top ?? 0,
    )
    expect(device.paths).toEqual(nominal.paths)
    expect(device.paths[0]?.strokeInk?.lineWidth).toBe(0.01)
  })

  it('keeps a hairline unknown without renderer resolution and bounded with it', () => {
    const operations: Operation[] = [[ops.setLineWidth, [0]], stroke([0, 10, 20, 1, 20, 20])]
    expect(extract(operations).paintBounds?.events[0]?.bounds).toBeNull()
    expect(
      extract(operations, { width: 100, height: 200 }).paintBounds?.events[0]?.bounds,
    ).not.toBeNull()
  })

  it.each([
    { width: 0, height: 200 },
    { width: 100, height: -1 },
    { width: Number.NaN, height: 200 },
    { width: 100, height: Number.POSITIVE_INFINITY },
  ])('holds invalid render dimensions $width × $height', (resolution) => {
    expect(
      extract([stroke([0, 10, 20, 1, 20, 20])], resolution).paintBounds?.events[0]?.bounds,
    ).toBeNull()
  })

  it.each([
    [0, 0, 0, 1, 0, 0],
    [1, 1, 1, 1, 0, 0],
  ])('holds singular renderer transforms %j', (matrix) => {
    expect(
      extract([[ops.transform, matrix], stroke([0, 10, 20, 1, 20, 20])], {
        width: 100,
        height: 200,
      }).paintBounds?.events[0]?.bounds,
    ).toBeNull()
  })
})

describe('single straight raster stroke exclusion regions', () => {
  it.each([0, 1, 2])(
    'uses conservative cap coverage without changing the old bounds for cap %i',
    (cap) => {
      const operations: Operation[] = [
        [ops.setLineWidth, [2]],
        [ops.setLineCap, [cap]],
        stroke([0, 10, 20, 1, 20, 20]),
      ]
      const result = extract(operations)
      expect(result.paintBounds?.events[0]?.straightStrokeRegion).toEqual({
        start: { x: 10, y: 20 },
        end: { x: 20, y: 20 },
        sourceToPage: [10, 0, 0, -5, 0, 1000],
        radius: cap === 2 ? Math.SQRT2 : 1,
      })
      expect(result.paintBounds?.events[0]?.bounds).toEqual(
        extract([[ops.setLineWidth, [2]], stroke([0, 10, 20, 1, 20, 20])]).paintBounds?.events[0]
          ?.bounds,
      )
    },
  )

  it('never excludes dash gaps from the source paint region', () => {
    const result = extract([
      [ops.setLineWidth, [2]],
      [ops.setDash, [[1, 20], 10]],
      stroke([0, 10, 20, 1, 20, 20]),
    ])
    expect(result.paintBounds?.events[0]?.straightStrokeRegion).toMatchObject({
      start: { x: 10, y: 20 },
      end: { x: 20, y: 20 },
      radius: 1,
    })
    expect(result.paths[0]?.strokeInk?.refusalReason).toBe('dashed-source-pen')
  })

  it.each([
    { name: 'fill', paint: ops.fill, values: [0, 10, 20, 1, 20, 20] },
    { name: 'fill-stroke', paint: ops.fillStroke, values: [0, 10, 20, 1, 20, 20] },
    { name: 'closed stroke', paint: ops.closeStroke, values: [0, 10, 20, 1, 20, 20, 4] },
    { name: 'joined stroke', paint: ops.stroke, values: [0, 10, 20, 1, 20, 20, 1, 30, 30] },
    {
      name: 'multiple subpaths',
      paint: ops.stroke,
      values: [0, 10, 20, 1, 20, 20, 0, 30, 30, 1, 40, 40],
    },
    { name: 'curved stroke', paint: ops.stroke, values: [0, 10, 20, 2, 15, 5, 20, 30, 30, 10] },
  ])('does not add a straight region for $name', ({ paint, values }) => {
    const result = extract([[ops.constructPath, [paint, [new Float32Array(values)], []]]])
    expect(result.paintBounds?.events[0]).not.toHaveProperty('straightStrokeRegion')
  })

  it.each([
    [ops.setLineCap, [7]],
    [ops.setLineWidth, [-1]],
    [ops.setGState, [[['LW', 'unknown']]]],
    [ops.beginGroup, [{}]],
  ] satisfies Operation[])('holds invalid pen or unsupported context %i', (operation, args) => {
    const result = extract([[operation, args], stroke([0, 10, 20, 1, 20, 20])])
    expect(result.paintBounds?.events.at(-1)).not.toHaveProperty('straightStrokeRegion')
  })

  it('keeps the unclipped stroke as a safe superset when the usable source line is clipped', () => {
    const result = extract([
      [ops.clip, null],
      [ops.constructPath, [ops.endPath, [[0, 10, 10, 1, 20, 10, 1, 20, 20, 1, 10, 20, 4]], []]],
      stroke([0, 5, 15, 1, 30, 15]),
    ])
    expect(result.paths).toEqual([])
    expect(result.paintBounds?.events[0]?.straightStrokeRegion).toMatchObject({
      start: { x: 5, y: 15 },
      end: { x: 30, y: 15 },
    })
  })
})

describe('complete conservative paint envelope inventory', () => {
  it('retains source order for text, image, fills, and omitted curved geometry', () => {
    const result = extract([
      [ops.showText, [[{ unicode: 'A', width: 10 }]]],
      [ops.paintImageXObject, ['image', 20, 30]],
      [ops.constructPath, [ops.fill, [[0, 10, 10, 1, 20, 10, 1, 20, 20, 4]], []]],
      stroke([0, 10, 10, 2, 15, 5, 20, 30, 30, 10]),
    ])
    expect(result.paintBounds).toMatchObject({ complete: true, refusalReason: null })
    expect(result.paintBounds?.events.map((event) => [event.operationIndex, event.kind])).toEqual([
      [0, 'text'],
      [1, 'image'],
      [2, 'vector'],
      [3, 'vector'],
    ])
    expect(result.skippedCurves).toBe(1)
    expect(result.paintBounds?.events[3]?.bounds).toMatchObject({
      left: expect.any(Number),
      top: expect.any(Number),
    })
    expect(result.paintBounds?.events[3]?.bounds?.top).toBeLessThan(850)
    expect(result.paintBounds?.events[3]?.bounds?.bottom).toBeGreaterThan(975)
  })

  it('does not lose clipped paint when the usable centreline is omitted', () => {
    const result = extract([
      [ops.clip, null],
      [ops.constructPath, [ops.endPath, [[0, 10, 10, 1, 20, 10, 1, 20, 20, 1, 10, 20, 4]], []]],
      stroke([0, 5, 15, 1, 30, 15]),
    ])
    expect(result.paths).toEqual([])
    expect(result.paintBounds?.events).toHaveLength(1)
    expect(result.paintBounds?.events[0]).toMatchObject({
      operationIndex: 2,
      kind: 'vector',
      subpathCount: 1,
    })
    expect(result.paintBounds?.events[0]?.bounds?.left).toBeLessThan(50)
    expect(result.paintBounds?.events[0]?.bounds?.right).toBeGreaterThan(300)
  })

  it('bounds raw operands outward rather than reusing rounded centreline coordinates', () => {
    const values = new Float32Array([0, 10.123456, 20.654321, 1, 30.234567, 20.654321])
    const result = extract([[ops.constructPath, [ops.fill, [values], []]]])
    const bound = result.paintBounds?.events[0]?.bounds
    expect(bound?.left).toBeLessThan((values[1] ?? 0) * 10)
    expect(bound?.right).toBeGreaterThan((values[4] ?? 0) * 10)
    expect(bound?.left).not.toBe(result.paths[0]?.points[0]?.x)
  })

  it('includes square caps and miter extents, and does not shrink dashed paint envelopes', () => {
    const operations: Operation[] = [
      [ops.setLineWidth, [2]],
      [ops.setLineCap, [2]],
      [ops.setLineJoin, [0]],
      [ops.setMiterLimit, [10]],
      stroke([0, 10, 20, 1, 20, 20, 1, 20, 30]),
    ]
    const solid = extract(operations)
    const dashed = extract([[ops.setDash, [[3, 7], 1]], ...operations])
    expect(dashed.paintBounds?.events[0]?.bounds).toEqual(solid.paintBounds?.events[0]?.bounds)
    expect(solid.paintBounds?.events[0]?.bounds?.left).toBeLessThanOrEqual(0)
    expect(solid.paintBounds?.events[0]?.bounds?.bottom).toBeGreaterThanOrEqual(950)
  })

  it('uses the transformed unit quadrilateral for image envelopes on an anisotropic page', () => {
    const result = extract([
      [ops.transform, [2, 1, 0.5, 3, 10, 20]],
      [ops.paintImageXObject, ['image', 400, 500]],
    ])
    const bound = result.paintBounds?.events[0]?.bounds
    expect(bound?.left).toBeCloseTo(100, 8)
    expect(bound?.right).toBeCloseTo(125, 8)
    expect(bound?.top).toBeCloseTo(880, 8)
    expect(bound?.bottom).toBeCloseTo(900, 8)
  })

  it.each([
    [ops.setLineWidth, [0]],
    [ops.setLineWidth, [-1]],
    [ops.setLineCap, [9]],
  ] as Operation[])('keeps device-dependent or invalid pen %i unbounded', (fn, args) => {
    expect(
      extract([[fn, args], stroke([0, 10, 20, 1, 30, 20])]).paintBounds?.events[0],
    ).toMatchObject({
      kind: 'vector',
      bounds: null,
      reason: 'vector-paint-envelope-unavailable',
    })
  })

  it.each([ops.paintImageXObjectRepeat, ops.shadingFill])(
    'holds unmodelled paint operation %i',
    (fn) => {
      expect(extract([[fn, []]]).paintBounds?.events).toEqual([
        {
          operationIndex: 0,
          kind: 'unknown',
          bounds: null,
          reason: 'unsupported-paint-envelope-operation',
        },
      ])
    },
  )

  it('marks unknown operators incomplete and clears all partial envelopes', () => {
    expect(extract([stroke([0, 10, 20, 1, 30, 20]), [999, []]]).paintBounds).toEqual({
      complete: false,
      refusalReason: 'unknown-paint-envelope-operator',
      events: [],
    })
  })

  it('clears the inventory when its output budget is exceeded', () => {
    const result = extract(Array.from({ length: 6001 }, () => [ops.showText, []] as Operation))
    expect(result.paintBounds).toEqual({
      complete: false,
      refusalReason: 'paint-envelope-output-limit',
      events: [],
    })
  })

  it('records a full compound source operation rather than individual subpath exemptions', () => {
    const result = extract([stroke([0, 10, 20, 1, 30, 20, 0, 50, 60, 1, 70, 60])])
    expect(result.paintBounds?.events).toHaveLength(1)
    expect(result.paintBounds?.events[0]?.subpathCount).toBe(2)
    expect(result.paintBounds?.events[0]?.bounds?.right).toBeGreaterThan(700)
  })
})

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

  it('retains fully visible symbol commands inside a polygon clip without drawing chords', () => {
    const result = extract([
      [ops.clip, []],
      [ops.constructPath, [ops.endPath, [[0, 10, 10, 1, 40, 10, 1, 25, 40, 4]], []]],
      stroke([0, 20, 15, 2, 22, 15, 25, 18, 25, 20]),
    ])
    expect(result.curvePaths?.map((path) => path.operationIndex)).toEqual([2])
    expect(result.paths).toEqual([])
    expect(result.skippedCurves).toBe(1)
    expect(result.skippedCurveBounds).toHaveLength(1)
  })

  it('holds curves whose control box crosses a concave mask despite visible endpoints', () => {
    const result = extract([
      [ops.clip, []],
      [
        ops.constructPath,
        [ops.endPath, [[0, 10, 10, 1, 30, 10, 1, 30, 20, 1, 20, 20, 1, 20, 30, 1, 10, 30, 4]], []],
      ],
      stroke([0, 15, 28, 2, 15, 25, 25, 15, 28, 15]),
      stroke([0, 12, 12, 2, 13, 12, 15, 13, 15, 15]),
    ])
    expect(result.curvePaths?.map((path) => path.operationIndex)).toEqual([3])
    expect(result.skippedCurves).toBe(2)
    expect(result.skippedCurveBounds).toHaveLength(2)
    expect(result.paths).toEqual([])
  })

  it('checks enclosure edges when all controls lie inside opposite arms of a concave clip', () => {
    const result = extract([
      [ops.clip, []],
      [
        ops.constructPath,
        [
          ops.endPath,
          [
            [
              0, 10, 10, 1, 40, 10, 1, 40, 40, 1, 30, 40, 1, 30, 20, 1, 20, 20, 1, 20, 40, 1, 10,
              40, 4,
            ],
          ],
          [],
        ],
      ],
      stroke([0, 15, 15, 2, 15, 35, 35, 35, 35, 15]),
    ])
    expect(result.curvePaths).toEqual([])
    expect(result.skippedCurves).toBe(1)
    expect(result.skippedCurveBounds).toHaveLength(1)
  })

  it('caps retained curve commands separately and keeps the omission inventory', () => {
    const result = extract(
      Array.from({ length: 5001 }, () => stroke([0, 10, 10, 2, 12, 10, 20, 12, 20, 20])),
    )
    expect(result.curvePaths).toHaveLength(5000)
    expect(result.curvePathsTruncated).toBe(true)
    expect(result.skippedCurves).toBe(5001)
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
    const result = extract(Array.from({ length: 5001 }, () => stroke([0, 1, 1, 1, 2, 2])))
    expect(result.paths).toHaveLength(5000)
    expect(result.truncated).toBe(true)
  })

  it('retains a dense but bounded architectural page without marking it incomplete', () => {
    const result = extract(Array.from({ length: 3515 }, () => stroke([0, 1, 1, 1, 2, 2])))
    expect(result.paths).toHaveLength(3515)
    expect(result.truncated).toBe(false)
  })
})
