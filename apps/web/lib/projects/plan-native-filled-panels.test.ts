import { createHash } from 'node:crypto'
import { existsSync } from 'node:fs'
import { readFile } from 'node:fs/promises'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import type { NativeTextAnchors } from './plan-document'
import { nativeFilledPanelCandidates } from './plan-native-filled-panels'
import type { PdfLinework, PdfVectorPath } from './plan-pdf-linework'

const source = { sha256: 'b'.repeat(64), page: 1, width: 1000, height: 1000 }
const native: NativeTextAnchors = {
  source,
  originalPdfSha256: 'a'.repeat(64),
  complete: true,
  labels: [],
  pageNormalizedScale: { x: 1, y: 1 },
}
function rectangle(
  operationIndex: number,
  left: number,
  right: number,
  top = 100,
  bottom = 110,
): PdfVectorPath {
  return {
    operationIndex,
    subpathIndex: 0,
    paint: 'fill',
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
function work(
  paths = [rectangle(1, 100, 200), rectangle(2, 90, 100.1), rectangle(3, 199.9, 210)],
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
const run = (layer = work()) =>
  nativeFilledPanelCandidates({ native, work: layer, lineworkSource: source })
const required = <T>(value: T | undefined): T => {
  if (value === undefined) throw new Error('Missing fixture')
  return value
}

describe('filled convex quad source profiles', () => {
  it('retains untouched body, cap and short-edge references without semantic promotion', () => {
    const input = work(),
      result = run(input)
    expect(result.panels).toHaveLength(1)
    expect(result.basis).toBe('native-filled-quad-and-opposed-cap-overlap')
    expect(result.panels[0]).toMatchObject({
      id: 'native-filled-panel-1:0',
      body: input.paths[0],
      caps: [input.paths[2], input.paths[1]],
      physicalJambAccepted: false,
      physicalPassageAccepted: false,
      closesFloorBoundary: false,
      finalPaintVisibilityProved: false,
    })
    expect(result.panels[0]?.shortEdges.map((edge) => edge.segmentIndex)).toEqual([1, 3])
    expect(result.completeOpeningInventory).toBe(false)
    expect(input.paths).toEqual(work().paths)
  })

  it('uses convex source quads, not an invented orthogonal or axis-aligned rectangle', () => {
    const input = work()
    input.paths = input.paths.map((path) => ({
      ...path,
      points: path.points.map(({ x, y }) => ({ x: x + y / 8, y })),
    }))
    expect(run(input).panels).toHaveLength(1)
    expect(run(input).panels[0]?.body.points).toEqual(input.paths[0]?.points)
  })

  it('does not use fill colour to classify or select the profile', () => {
    const input = work()
    input.paths.forEach((path, index) => {
      path.fillColor = ['#ffffff', '#000000', '#ff0000'][index]
    })
    expect(run(input).panels).toHaveLength(1)
  })

  it('accepts explicit or implicit closing vertices and reversed winding', () => {
    const input = work()
    input.paths = input.paths.map((path) => ({
      ...path,
      points: path.points.slice(0, -1).reverse(),
    }))
    expect(run(input).panels).toHaveLength(1)
  })

  it('requires positive overlap, without repairing endpoint contact, a tiny gap or a nearby cap', () => {
    for (const right of [100, 100 - 1e-9, 99]) {
      const input = work()
      input.paths[1] = rectangle(2, 90, right)
      expect(run(input).panels).toEqual([])
    }
    const input = work()
    input.paths[1] = rectangle(2, 90, 100 + 1e-9)
    expect(run(input).panels).toHaveLength(1)
  })

  it('requires a cap crossing an end, not a contained icon, same-side pair or long strip', () => {
    for (const cap of [
      rectangle(2, 101, 111),
      rectangle(2, 95, 105, 120, 130),
      rectangle(2, 80, 130),
    ]) {
      const input = work()
      input.paths[1] = cap
      expect(run(input).panels).toEqual([])
    }
  })

  it('rejects competing caps and exact duplicate body repaint identities', () => {
    const caps = work()
    caps.paths.push(rectangle(4, 90, 100.1))
    expect(run(caps).panels).toEqual([])
    expect(run(caps).rejected).toContainEqual({
      operationIndex: 1,
      subpathIndex: 0,
      reason: 'competing-filled-caps',
    })
    const bodies = work()
    bodies.paths.push(rectangle(4, 100, 200))
    expect(run(bodies).panels).toEqual([])
    expect(run(bodies).rejected.filter((r) => r.reason === 'competing-filled-bodies')).toHaveLength(
      2,
    )
  })

  it('does not hide a shared-cap competitor whose second cap is missing', () => {
    const input = work()
    input.paths.push(rectangle(4, 209.9, 309.9))
    expect(run(input).panels).toEqual([])
    expect(run(input).rejected).toContainEqual({
      operationIndex: 1,
      subpathIndex: 0,
      reason: 'competing-filled-bodies',
    })
  })

  it('withholds all profiles with a component reused as another profile body', () => {
    const input = work([
      rectangle(1, 100, 200),
      rectangle(2, 95.1, 100.1, 95, 115),
      rectangle(3, 199.9, 210),
      rectangle(4, 95.1, 100.1, 94.9, 100),
      rectangle(5, 95.1, 100.1, 110, 115.1),
    ])
    const result = run(input)
    expect(result.panels).toEqual([])
    expect(
      result.rejected.filter((item) => item.reason === 'competing-filled-component-roles'),
    ).toHaveLength(2)
  })

  it('does not round a true source midpoint on the cap boundary into its interior', () => {
    const input = work([
      rectangle(1, 100, 200, 100.004, 110.005),
      rectangle(2, 90, 100.1, 105.0045, 115.0045),
      rectangle(3, 199.9, 210, 100.004, 110.005),
    ])
    expect((100.004 + 110.005) / 2).toBeGreaterThan(105.0045)
    expect(run(input).panels).toEqual([])
  })

  it('excludes stroke-only, open, nonconvex and degenerate body shapes', () => {
    for (const change of [
      (path: PdfVectorPath) => {
        path.paint = 'stroke'
      },
      (path: PdfVectorPath) => {
        path.closed = false
      },
      (path: PdfVectorPath) => {
        required(path.points[1]).x = 90
      },
      (path: PdfVectorPath) => {
        path.points = path.points.map((point) => ({ ...point, y: 100 }))
      },
    ]) {
      const input = work()
      change(required(input.paths[0]))
      expect(run(input).panels).toEqual([])
    }
  })

  it('retains later paint and localized omitted ink as unresolved context, including paint between components', () => {
    const input = work()
    input.paths[2] = rectangle(10, 199.9, 210)
    input.paths.push(rectangle(4, 100, 200))
    // A stroke is context only, not a competing filled body.
    required(input.paths[3]).paint = 'stroke'
    input.skippedCurves = 1
    input.skippedCurveBounds = [
      { operationIndex: 77, bounds: { left: 100, right: 110, top: 100, bottom: 110 } },
    ]
    const result = run(input)
    expect(result.panels).toHaveLength(1)
    expect(result.panels[0]?.laterPaintOperations).toEqual([4])
    expect(result.panels[0]?.unresolvedInk).toHaveLength(1)
    expect(result.panels[0]?.finalPaintVisibilityProved).toBe(false)
  })

  it.each([1, 2, 3])('does not use operation %s with omitted siblings', (operationIndex) => {
    const input = work()
    input.clippedPaths = 1
    input.clippedPathBounds = [
      { operationIndex, bounds: { left: 900, right: 910, top: 900, bottom: 910 } },
    ]
    expect(run(input).panels).toEqual([])
  })

  it('bounds later paint diagnostics without hiding the full count', () => {
    const input = work()
    input.paths.push(
      ...Array.from({ length: 101 }, (_, index) => ({
        ...rectangle(index + 10, 120, 130),
        paint: 'stroke' as const,
      })),
    )
    const panel = run(input).panels[0]
    expect(panel?.laterPaintOperations).toHaveLength(100)
    expect(panel?.laterPaintCount).toBe(101)
    expect(panel?.laterPaintTruncated).toBe(true)
  })

  it('fails atomically for malformed refs, closure, paint and unsupported coordinates', () => {
    for (const change of [
      (layer: PdfLinework) => {
        required(layer.paths[1]).operationIndex = 1
      },
      (layer: PdfLinework) => {
        required(layer.paths[0]).closed = 'closed' as unknown as boolean
      },
      (layer: PdfLinework) => {
        required(layer.paths[0]).paint = 'invalid' as PdfVectorPath['paint']
      },
      (layer: PdfLinework) => {
        required(required(layer.paths[0]).points[0]).x = 1e-19
      },
      (layer: PdfLinework) => {
        required(required(layer.paths[0]).points[0]).x = 1001
      },
      (layer: PdfLinework) => {
        required(required(layer.paths[0]).points[0]).x = Number.NaN
      },
    ]) {
      const input = work()
      change(input)
      expect(run(input).refusalReason).not.toBeNull()
      expect(run(input).panels).toEqual([])
    }
  })

  it('refuses mismatched source identity before searching', () => {
    for (const frame of [
      { ...source, page: 2 },
      { ...source, sha256: 'c'.repeat(64) },
      { ...source, width: 999 },
    ])
      expect(() =>
        nativeFilledPanelCandidates({ native, work: work(), lineworkSource: frame }),
      ).toThrow()
  })

  it('refuses unsupported, truncated, unlocalized and malformed omission inventory', () => {
    for (const patch of [
      { unsupportedContexts: 1 },
      { unsupportedPaths: 1 },
      { truncated: true },
      { curvePathsTruncated: true },
      { clippedPathBoundsTruncated: true },
      { skippedCurves: 1 },
      { clippedPaths: -1 },
      {
        clippedPaths: 1,
        clippedPathBounds: [
          { operationIndex: 4, bounds: { left: 110, right: 100, top: 100, bottom: 110 } },
        ],
      },
      {
        clippedPaths: 0,
        clippedPathBounds: [
          { operationIndex: 4, bounds: { left: 100, right: 110, top: 100, bottom: 110 } },
        ],
      },
    ]) {
      const result = run({ ...work(), ...patch })
      expect(result.refusalReason).not.toBeNull()
      expect(result.panels).toEqual([])
    }
  })

  it('refuses the whole search at its bounded comparison limit', () => {
    const paths = Array.from({ length: 500 }, (_, index) => rectangle(index + 1, 100, 200))
    expect(run(work(paths))).toMatchObject({
      panels: [],
      refusalReason: 'filled-panel-search-budget',
    })
  })

  it('refuses the whole inventory rather than returning the first hundred profiles', () => {
    const paths = Array.from({ length: 101 }, (_, index) => {
      const top = 100 + index * 3
      return [
        rectangle(index * 3 + 1, 100, 120, top, top + 1),
        rectangle(index * 3 + 2, 99, 100.1, top, top + 1),
        rectangle(index * 3 + 3, 119.9, 121, top, top + 1),
      ]
    }).flat()
    expect(run(work(paths))).toMatchObject({
      panels: [],
      refusalReason: 'filled-panel-candidate-limit',
    })
  })

  it('does not treat a cap crossing only the extension of an end as opposed end coverage', () => {
    const input = work()
    input.paths[1] = rectangle(2, 90, 101, 109, 119)
    expect(run(input).panels).toEqual([])
  })

  const realSource = fileURLToPath(
    new URL('../../../../output/pdf/source-search-20261003/rebrina-original.pdf', import.meta.url),
  )
  it.skipIf(!existsSync(realSource))(
    'recovers two actual source quad profiles from the complete Rebrina page, not an operation allowlist',
    async () => {
      const body = await readFile(realSource)
      expect(createHash('sha256').update(body).digest('hex')).toBe(
        '2e141c135812c81719e1f4783173cb5202e20041ac494d3cc799eb37ad62ad4e',
      )
      const { preparePlanPage } = await import('./plan-document')
      const page = await preparePlanPage(body, true, 3, true, true)
      const result = nativeFilledPanelCandidates({
        native: required(page.nativeTextAnchors),
        work: required(page.linework),
        lineworkSource: required(page.lineworkRasterSource),
      })
      expect(result.refusalReason).toBeNull()
      expect(
        result.panels.map((panel) => ({
          body: panel.body.operationIndex,
          caps: panel.caps.map((cap) => cap.operationIndex),
        })),
      ).toEqual([
        { body: 2035, caps: [2031, 2027] },
        { body: 2059, caps: [2055, 2051] },
      ])
      expect(
        result.panels.every(
          (panel) =>
            !panel.physicalJambAccepted &&
            !panel.physicalPassageAccepted &&
            !panel.closesFloorBoundary &&
            !panel.finalPaintVisibilityProved,
        ),
      ).toBe(true)
      expect(result.panels.every((panel) => panel.laterPaintCount > 0)).toBe(true)
    },
    30_000,
  )
})
