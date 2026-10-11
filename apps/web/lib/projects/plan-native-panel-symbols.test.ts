import { describe, expect, it } from 'vitest'
import type { NativeTextAnchors } from './plan-document'
import { nativePanelSymbolCandidates } from './plan-native-panel-symbols'
import type { PagePoint, PdfCurvePath, PdfLinework, PdfVectorPath } from './plan-pdf-linework'

const source = { sha256: 'a'.repeat(64), page: 6, width: 1000, height: 1000 }
const native: NativeTextAnchors = {
  source,
  originalPdfSha256: 'b'.repeat(64),
  complete: true,
  labels: [],
  pageNormalizedScale: { x: 1, y: 1 },
}
function rectangle(
  operationIndex: number,
  left: number,
  top: number,
  right: number,
  bottom: number,
): PdfVectorPath {
  return {
    operationIndex,
    subpathIndex: 0,
    paint: 'stroke',
    closed: true,
    points: [
      { x: left, y: top },
      { x: right, y: top },
      { x: right, y: bottom },
      { x: left, y: bottom },
      { x: left, y: top },
    ],
  }
}
function line(
  operationIndex = 4,
  start = { x: 100, y: 102.5 },
  end = { x: 200, y: 102.5 },
): PdfVectorPath {
  return { operationIndex, subpathIndex: 0, paint: 'stroke', closed: false, points: [start, end] }
}
function work(
  paths = [
    rectangle(1, 100, 100, 200, 105),
    rectangle(2, 95, 100, 100, 105),
    rectangle(3, 200, 100, 205, 105),
    line(),
  ],
): PdfLinework {
  return {
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
}
const run = (layer = work(), anchors = native) =>
  nativePanelSymbolCandidates({ native: anchors, work: layer, lineworkSource: anchors.source })

function required<T>(value: T | undefined): T {
  if (value === undefined) throw new Error('Required test fixture item is missing')
  return value
}

function transform(layer: PdfLinework, fn: (point: PagePoint) => PagePoint) {
  for (const path of layer.paths) path.points = path.points.map(fn)
  return layer
}

describe('source-painted body and two endcap panel profiles', () => {
  it('retains three actual source segments per side and a separately painted glazing hint', () => {
    const input = work()
    const before = structuredClone(input)
    const result = run(input)
    expect(result.refusalReason).toBeNull()
    expect(result.panels).toHaveLength(1)
    expect(result.panels[0]).toMatchObject({
      body: input.paths[0],
      caps: [input.paths[1], input.paths[2]],
      centerline: { operationIndex: 4, segmentIndex: 0 },
      centerlineStatus: 'matched',
      centerlineResidualPixels: 0,
      glazingHint: 'independent-centered-line',
      physicalPassageAccepted: false,
      closesFloorBoundary: false,
    })
    expect(
      result.panels[0]?.sides.map((side) =>
        side.map((edge) => [edge.operationIndex, edge.segmentIndex]),
      ),
    ).toEqual([
      [
        [2, 0],
        [1, 0],
        [3, 0],
      ],
      [
        [2, 2],
        [1, 2],
        [3, 2],
      ],
    ])
    expect(result.completeOpeningInventory).toBe(false)
    expect(result.closesFloorBoundary).toBe(false)
    expect(input).toEqual(before)
    const panel = required(result.panels[0])
    required(panel.body.points[0]).x = 900
    required(panel.sides[0][0]).start.x = 901
    expect(input).toEqual(before)
  })

  it('recognizes vertical profiles with the unchanged original edge direction', () => {
    const result = run(transform(work(), (point) => ({ x: point.y, y: point.x })))
    expect(result.panels).toHaveLength(1)
    expect(result.panels[0]?.centerline).toMatchObject({
      start: { x: 102.5, y: 100 },
      end: { x: 102.5, y: 200 },
    })
    expect(result.panels[0]?.sides[0].map((edge) => edge.operationIndex)).toEqual([2, 1, 3])
  })

  it('accepts reversed source winding and distinct operation ids without using ids as semantic authority', () => {
    const input = work()
    for (const path of input.paths) {
      path.operationIndex += 7777
      path.points.reverse()
    }
    const result = run(input)
    expect(result.panels).toHaveLength(1)
    expect(result.panels[0]?.caps.map((cap) => cap.operationIndex)).toEqual([7779, 7780])
    expect(result.panels[0]?.centerline?.operationIndex).toBe(7781)
  })

  it('does not invent a glazing centerline for a door leaf panel', () => {
    const result = run(work(work().paths.slice(0, 3)))
    expect(result.panels).toHaveLength(1)
    expect(result.panels[0]).toMatchObject({
      centerline: null,
      centerlineStatus: 'absent',
      centerlineResidualPixels: null,
      glazingHint: 'unclassified-panel',
    })
  })

  it.each([
    ['partial', { x: 101, y: 102.5 }, { x: 200, y: 102.5 }],
    ['extended', { x: 95, y: 102.5 }, { x: 205, y: 102.5 }],
    ['edge', { x: 100, y: 100 }, { x: 200, y: 100 }],
    ['off-center', { x: 100, y: 102.6 }, { x: 200, y: 102.6 }],
    ['sloped', { x: 100, y: 102.5 }, { x: 200, y: 102.500000001 }],
  ])('does not use a %s line as a glazing hint', (_, start, end) => {
    const input = work()
    input.paths[3] = line(4, start as PagePoint, end as PagePoint)
    const result = run(input)
    expect(result.panels).toHaveLength(1)
    expect(result.panels[0]?.centerline).toBeNull()
    expect(result.panels[0]?.centerlineStatus).toBe('absent')
  })

  it('reports the bounded centerline fit without modifying the rounded PDF source points', () => {
    const input = work()
    input.paths[3] = line(4, { x: 100, y: 102.501 }, { x: 200, y: 102.501 })
    const before = structuredClone(input)
    const result = run(input)
    expect(result.panels[0]?.centerlineResidualPixels).toBeCloseTo(0.001, 10)
    expect(result.panels[0]?.centerline?.start.y).toBe(102.501)
    expect(input).toEqual(before)
  })

  it('withholds the hint when competing independently painted centerlines fit', () => {
    const input = work()
    input.paths.push(line(5, { x: 100, y: 102.501 }, { x: 200, y: 102.501 }))
    const result = run(input)
    expect(result.panels).toHaveLength(1)
    expect(result.panels[0]?.centerline).toBeNull()
    expect(result.panels[0]?.centerlineStatus).toBe('ambiguous')
    expect(result.rejected).toContainEqual({
      operationIndex: 1,
      subpathIndex: 0,
      reason: 'competing-panel-centerlines',
    })
  })

  it.each([1e-9, -1e-9])('does not repair a %s source gap or overlap at an endcap', (offset) => {
    const input = work()
    input.paths[1] = rectangle(2, 95, 100, 100 + offset, 105)
    expect(run(input).panels).toEqual([])
  })

  it('requires exact matching full cross range rather than partial edge or a long extension', () => {
    for (const cap of [
      rectangle(2, 95, 100, 100, 104),
      rectangle(2, 95, 99, 100, 105),
      rectangle(2, 80, 100, 100, 105),
    ]) {
      const input = work()
      input.paths[1] = cap
      expect(run(input).panels).toEqual([])
    }
  })

  it('withholds competing caps without selecting the first or nearest source path', () => {
    const input = work()
    input.paths.push(rectangle(5, 95, 100, 100, 105))
    expect(run(input).panels).toEqual([])
    expect(run(input).rejected).toContainEqual({
      operationIndex: 1,
      subpathIndex: 0,
      reason: 'competing-panel-caps',
    })
  })

  it('withholds two body profiles that compete for the same cap', () => {
    const input = work()
    input.paths.push(rectangle(5, 205, 100, 305, 105), rectangle(6, 305, 100, 310, 105))
    const result = run(input)
    expect(result.panels).toEqual([])
    expect(result.rejected.filter((item) => item.reason === 'competing-panel-bodies')).toHaveLength(
      2,
    )
  })

  it('withholds duplicated bodies even when their geometry was repainted exactly', () => {
    const input = work()
    input.paths.push(rectangle(5, 100, 100, 200, 105))
    expect(run(input).panels).toEqual([])
  })

  it('does not hide a competing body merely because its other cap is missing', () => {
    const input = work()
    input.paths.push(rectangle(5, 205, 100, 305, 105))
    expect(run(input).panels).toEqual([])
    expect(run(input).rejected).toContainEqual({
      operationIndex: 1,
      subpathIndex: 0,
      reason: 'competing-panel-bodies',
    })
  })

  it('uses physical raster aspect for the body and square cap proportions', () => {
    const input = work([
      rectangle(1, 100, 100, 120, 105),
      rectangle(2, 95, 100, 100, 105),
      rectangle(3, 120, 100, 125, 105),
      line(4, { x: 100, y: 102.5 }, { x: 120, y: 102.5 }),
    ])
    expect(run(input).panels).toHaveLength(1)
    expect(
      run(input, {
        ...native,
        source: { ...source, width: 500 },
        pageNormalizedScale: { x: 0.5, y: 1 },
      }).panels,
    ).toEqual([])
  })

  it('rejects square, degenerate, open, fill-painted and skewed component rectangles', () => {
    for (const change of [
      (path: PdfVectorPath) => {
        path.closed = false
      },
      (path: PdfVectorPath) => {
        path.paint = 'fill'
      },
      (path: PdfVectorPath) => {
        required(path.points[1]).y += 1e-9
      },
    ]) {
      const input = work()
      change(required(input.paths[0]))
      expect(run(input).panels).toEqual([])
    }
    expect(
      run(
        work([
          rectangle(1, 100, 100, 105, 105),
          rectangle(2, 95, 100, 100, 105),
          rectangle(3, 105, 100, 110, 105),
        ]),
      ).panels,
    ).toEqual([])
  })

  it('does not merge separate letter or wall rectangles without two exact square endcaps', () => {
    expect(run(work([rectangle(1, 100, 100, 200, 105), line()])).panels).toEqual([])
    const input = work()
    input.paths[2] = rectangle(3, 200, 110, 205, 115)
    expect(run(input).panels).toEqual([])
  })

  it.each([1, 2, 3, 4])(
    'does not reuse operation %s with clipped or skipped siblings',
    (operationIndex) => {
      for (const kind of ['clip', 'curve']) {
        const input = work()
        const omitted = [
          { operationIndex, bounds: { left: 800, right: 810, top: 800, bottom: 810 } },
        ]
        if (kind === 'clip') {
          input.clippedPaths = 1
          input.clippedPathBounds = omitted
        } else {
          input.skippedCurves = 1
          input.skippedCurveBounds = omitted
        }
        const result = run(input)
        if (operationIndex === 4) expect(result.panels[0]?.centerline).toBeNull()
        else expect(result.panels).toEqual([])
      }
    },
  )

  it('retains localized unrelated omissions and never calls the panel a floor boundary', () => {
    const input = work()
    input.skippedCurves = 1
    input.skippedCurveBounds = [
      { operationIndex: 77, bounds: { left: 95, right: 205, top: 95, bottom: 110 } },
    ]
    expect(run(input).panels).toHaveLength(1)
    expect(run(input).panels[0]?.closesFloorBoundary).toBe(false)
    expect(input.skippedCurves).toBe(1)
  })

  it('refuses the entire profile inference for unlocalized, truncated or malformed omissions', () => {
    for (const patch of [
      { unsupportedContexts: 1 },
      { unsupportedPaths: 1 },
      { truncated: true },
      { skippedCurves: 1 },
      { clippedPaths: 1 },
      {
        skippedCurves: 1,
        skippedCurveBounds: [
          { operationIndex: 8, bounds: { left: 100, right: 90, top: 0, bottom: 10 } },
        ],
      },
      {
        clippedPaths: 0,
        clippedPathBounds: [
          { operationIndex: 8, bounds: { left: 0, right: 10, top: 0, bottom: 10 } },
        ],
      },
    ]) {
      const result = run({ ...work(), ...patch })
      expect(result.refusalReason).not.toBeNull()
      expect(result.panels).toEqual([])
    }
  })

  it('refuses mismatched source hash, page and raster size before fitting', () => {
    for (const frame of [
      { ...source, sha256: 'c'.repeat(64) },
      { ...source, page: 7 },
      { ...source, width: 999 },
    ])
      expect(() =>
        nativePanelSymbolCandidates({ native, work: work(), lineworkSource: frame }),
      ).toThrow()
  })

  it('refuses invalid or duplicate source ids, unsupported precision and out-of-page points', () => {
    for (const change of [
      (input: PdfLinework) => {
        required(input.paths[1]).operationIndex = 1
      },
      (input: PdfLinework) => {
        required(input.paths[0]).operationIndex = -1
      },
      (input: PdfLinework) => {
        required(required(input.paths[0]).points[0]).x = Number.NaN
      },
      (input: PdfLinework) => {
        required(required(input.paths[0]).points[0]).x = 1001
      },
      (input: PdfLinework) => {
        required(required(input.paths[0]).points[0]).x = 1e-19
      },
    ]) {
      const input = work()
      change(input)
      const result = run(input)
      expect(result.refusalReason).not.toBeNull()
      expect(result.panels).toEqual([])
    }
  })

  it('does not use another straight subpath from a compound operation as a component', () => {
    const input = work()
    input.paths.push({ ...line(2, { x: 800, y: 800 }, { x: 810, y: 810 }), subpathIndex: 1 })
    expect(run(input).panels).toEqual([])
  })

  it('does not reuse a component operation with a retained curved sibling', () => {
    const input = work()
    const curve: PdfCurvePath = {
      operationIndex: 2,
      subpathIndex: 1,
      operationSubpathCount: 2,
      paint: 'stroke',
      closed: false,
      start: { x: 800, y: 800 },
      segments: [
        {
          kind: 'cubic',
          control1: { x: 800, y: 805 },
          control2: { x: 805, y: 810 },
          end: { x: 810, y: 810 },
        },
      ],
    }
    input.curvePaths = [curve]
    expect(run(input).refusalReason).toBe('invalid-curve-provenance')
    input.skippedCurves = 1
    input.skippedCurveBounds = [
      { operationIndex: 2, bounds: { left: 800, right: 810, top: 800, bottom: 810 } },
    ]
    expect(run(input).panels).toEqual([])
    expect(run(input).refusalReason).toBeNull()
    curve.subpathIndex = 0
    expect(run(input).refusalReason).toBe('invalid-curve-provenance')
  })

  it('refuses malformed counters and truncated retained curves rather than hiding uncertain source metadata', () => {
    for (const patch of [
      { unsupportedPaths: -1 },
      { unsupportedContexts: 0.5 },
      { curvePathsTruncated: true },
    ]) {
      const result = run({ ...work(), ...patch })
      expect(result.refusalReason).not.toBeNull()
      expect(result.panels).toEqual([])
    }
  })

  it('withholds all candidates when the source search budget is exceeded', () => {
    const input = work(
      Array.from({ length: 3000 }, (_, index) => rectangle(index + 1, 100, 100, 200, 105)),
    )
    const result = run(input)
    expect(result.refusalReason).toBe('panel-search-budget')
    expect(result.panels).toEqual([])
  })

  it('withholds the entire batch rather than silently returning the first hundred profiles', () => {
    const paths: PdfVectorPath[] = []
    for (let index = 0; index <= 100; index++) {
      const x = 10 + (index % 10) * 80
      const y = 10 + Math.floor(index / 10) * 20
      paths.push(
        rectangle(index * 3 + 1, x, y, x + 50, y + 2),
        rectangle(index * 3 + 2, x - 2, y, x, y + 2),
        rectangle(index * 3 + 3, x + 50, y, x + 52, y + 2),
      )
    }
    const result = run(work(paths))
    expect(result.refusalReason).toBe('panel-candidate-limit')
    expect(result.panels).toEqual([])
  })
})
