import { createHash } from 'node:crypto'
import { existsSync } from 'node:fs'
import { readFile } from 'node:fs/promises'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import type { NativeTextAnchors } from './plan-document'
import { nativeFilledPanelJambContacts } from './plan-native-filled-panel-jambs'
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
function line(operationIndex: number, x: number, from = 90, to = 120): PdfVectorPath {
  return {
    operationIndex,
    subpathIndex: 0,
    paint: 'stroke',
    closed: false,
    points: [
      { x, y: from },
      { x, y: to },
    ],
  }
}
function work(
  paths = [
    rectangle(1, 100, 200),
    rectangle(2, 90, 100.1),
    rectangle(3, 199.9, 210),
    line(4, 100),
    line(5, 200),
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
const run = (layer = work()) =>
  nativeFilledPanelJambContacts({ native, work: layer, lineworkSource: source })
const runJoined = (layer: PdfLinework) =>
  nativeFilledPanelJambContacts({
    native,
    work: layer,
    lineworkSource: source,
    contactMode: 'exact-joined-endcaps',
  })
const required = <T>(value: T | undefined): T => {
  if (value === undefined) throw new Error('Missing fixture')
  return value
}

describe('filled profile ends and independent source paint edges', () => {
  it('checks literal joined endcaps without changing the legacy overlap mode', () => {
    const input = work([
      rectangle(1, 100, 200),
      rectangle(2, 90, 100),
      rectangle(3, 200, 210),
      line(4, 100),
      line(5, 200),
    ])
    expect(run(input).panels).toEqual([])
    const joined = runJoined(input)
    expect(joined.panels).toHaveLength(1)
    expect(joined.panels[0]?.status).toBe('paired')
    expect(joined.panels[0]?.ends.map((end) => end.coverage)).toEqual(['complete', 'complete'])
    expect(joined.physicalJambAccepted).toBe(false)
    expect(joined.finalPaintVisibilityProved).toBe(false)
    expect(joined.readyFor2D).toBe(false)
    expect(joined.readyFor3D).toBe(false)

    required(input.paths[4]).points[0] = { x: 200 + 1e-9, y: 90 }
    required(input.paths[4]).points[1] = { x: 200 + 1e-9, y: 120 }
    expect(runJoined(input).panels[0]?.status).toBe('partial')
    input.paths.push(line(6, 100))
    expect(runJoined(input).panels[0]?.ends[1]?.status).toBe('ambiguous')
  })

  it('does not call a fill-only boundary an independent end stroke for joined panels', () => {
    const input = work([
      rectangle(1, 100, 200),
      rectangle(2, 90, 100),
      rectangle(3, 200, 210),
      rectangle(4, 90, 100, 90, 120),
      line(5, 200),
    ])
    expect(runJoined(input).panels[0]?.status).toBe('partial')
    expect(runJoined(input).panels[0]?.ends[1]?.status).toBe('unobserved')

    input.paths[3] = { ...required(input.paths[3]), paint: 'fill-stroke' }
    expect(runJoined(input).panels[0]?.status).toBe('paired')
    expect(runJoined(input).panels[0]?.ends[1]?.sourcePaints[0]?.paint).toBe('fill-stroke')
  })

  it('binds literal independent ends while refusing physical wall/jamb ownership', () => {
    const input = work(),
      before = structuredClone(input)
    const result = run(input)
    expect(result.panels).toHaveLength(1)
    expect(result.panels[0]?.status).toBe('paired')
    expect(
      result.panels[0]?.ends.map((end) => end.sourceEdges.map((edge) => edge.operationIndex)),
    ).toEqual([[5], [4]])
    expect(result.panels[0]?.ends.map((end) => end.coverage)).toEqual(['complete', 'complete'])
    expect(result).toMatchObject({
      wallOwnershipConfirmed: false,
      physicalJambAccepted: false,
      physicalPassageAccepted: false,
      closesFloorBoundary: false,
      readyFor2D: false,
      readyFor3D: false,
    })
    expect(input).toEqual(before)
    expect(result.panels[0]?.ends[1]?.sourceEdges[0]?.start).toEqual({ x: 100, y: 90 })
  })

  it('does not use the profile body or its caps as independent source evidence', () => {
    const result = run(work(work().paths.slice(0, 3)))
    expect(result.panels[0]?.status).toBe('unobserved')
    expect(result.panels[0]?.ends.every((end) => end.sourceEdges.length === 0)).toBe(true)
  })

  it('binds real fill-boundary edges without classifying their colour or physical role', () => {
    const input = work(work().paths.slice(0, 3))
    const host = rectangle(4, 90, 100, 90, 120)
    host.fillColor = '#ff00ff'
    input.paths.push(host, line(5, 200))
    const result = run(input)
    expect(result.panels[0]?.status).toBe('paired')
    expect(result.panels[0]?.ends[1]?.sourcePaints).toEqual([
      { operationIndex: 4, subpathIndex: 0, paint: 'fill' },
    ])
    expect(result.panels[0]?.wallOwnershipConfirmed).toBe(false)
  })

  it('keeps missing and partial support distinct from complete source coupling', () => {
    const missing = work()
    missing.paths = missing.paths.filter((path) => path.operationIndex !== 4)
    expect(run(missing).panels[0]?.status).toBe('partial')
    expect(run(missing).panels[0]?.ends[1]?.status).toBe('unobserved')
    const partial = work()
    partial.paths[3] = line(4, 100, 100, 105)
    expect(run(partial).panels[0]?.ends[1]?.coverage).toBe('partial')
    expect(run(partial).panels[0]?.ends[1]?.status).toBe('partial')
  })

  it('joins literal adjacent source spans without bridging a tiny source gap', () => {
    const input = work()
    input.paths[3] = line(4, 100, 100, 105)
    input.paths.push(line(6, 100, 105, 110))
    expect(run(input).panels[0]?.ends[1]?.status).toBe('matched')
    input.paths[5] = line(6, 100, 105 + 1e-9, 110)
    expect(run(input).panels[0]?.ends[1]?.status).toBe('partial')
  })

  it('never repairs a near-collinear segment or an endpoint-only touch', () => {
    for (const path of [line(4, 100 + 1e-9), line(4, 100, 90, 100)]) {
      const input = work()
      input.paths[3] = path
      expect(run(input).panels[0]?.ends[1]?.status).toBe('unobserved')
    }
  })

  it('preserves arbitrary-angle original directions and reversed support strokes', () => {
    const input = work()
    input.paths = input.paths.map((path) => ({
      ...path,
      points: path.points.map(({ x, y }) => ({
        x: (3 * x - 4 * y) / 5 + 300,
        y: (4 * x + 3 * y) / 5 + 100,
      })),
    }))
    required(input.paths[3]).points.reverse()
    const result = run(input)
    expect(result.panels[0]?.status).toBe('paired')
    expect(result.panels[0]?.ends[1]?.sourceEdges[0]?.start).toEqual(input.paths[3]?.points[0])
  })

  it('holds duplicate strokes and overlapping fill/stroke provenance as ambiguous', () => {
    const input = work()
    input.paths.push(line(6, 100))
    expect(run(input).panels[0]?.status).toBe('ambiguous')
    expect(run(input).panels[0]?.ends[1]?.reason).toBe('competing-or-repainted-source-end')
    input.paths[5] = rectangle(6, 90, 100, 90, 120)
    expect(run(input).panels[0]?.ends[1]?.sourcePaints.map((paint) => paint.paint)).toEqual([
      'stroke',
      'fill',
    ])
  })

  it('holds competing partial spans even after an uncovered initial gap', () => {
    const input = work()
    input.paths[3] = line(4, 100, 102, 107)
    input.paths.push(line(6, 100, 105, 110))
    const end = run(input).panels[0]?.ends[1]
    expect(end?.coverage).toBe('partial')
    expect(end?.status).toBe('ambiguous')
  })

  it('does not synthesize a closing edge for an open source polyline', () => {
    const input = work()
    required(input.paths[3]).points = [
      { x: 100, y: 100 },
      { x: 90, y: 100 },
      { x: 90, y: 110 },
      { x: 100, y: 110 },
    ]
    expect(run(input).panels[0]?.ends[1]?.status).toBe('unobserved')
  })

  it('does not use clipped or compound source support and holds local omitted geometry', () => {
    const input = work()
    input.clippedPaths = 1
    input.clippedPathBounds = [
      { operationIndex: 4, bounds: { left: 100, right: 100, top: 90, bottom: 120 } },
    ]
    const result = run(input)
    expect(result.panels[0]?.ends[1]?.sourceEdges).toEqual([])
    expect(result.panels[0]?.status).toBe('unresolved')
    const compound = work()
    compound.paths.push({ ...line(4, 900), subpathIndex: 1 })
    expect(run(compound).panels[0]?.ends[1]?.status).toBe('unobserved')
  })

  it('fails atomically for malformed source refs, precision and incomplete inventories', () => {
    for (const change of [
      (input: PdfLinework) => {
        required(input.paths[4]).operationIndex = 4
      },
      (input: PdfLinework) => {
        required(required(input.paths[3]).points[0]).x = 1e-19
      },
      (input: PdfLinework) => {
        input.truncated = true
      },
      (input: PdfLinework) => {
        input.clippedPaths = 1
      },
      (input: PdfLinework) => {
        input.unsupportedContexts = 1
      },
    ]) {
      const input = work()
      change(input)
      expect(run(input).panels).toEqual([])
      expect(run(input).refusalReason).not.toBeNull()
    }
  })

  it('refuses mismatched source identity before any pairing', () => {
    expect(() =>
      nativeFilledPanelJambContacts({
        native,
        work: work(),
        lineworkSource: { ...source, page: 2 },
      }),
    ).toThrow()
  })

  it('fails atomically at its global source-contact limit', () => {
    const input = work()
    input.paths.push(...Array.from({ length: 1001 }, (_, index) => line(index + 10, 100)))
    expect(run(input)).toMatchObject({
      panels: [],
      refusalReason: 'filled-panel-end-contact-limit',
    })
  })

  it('fails atomically at its whole-inventory comparison budget', () => {
    const profiles = Array.from({ length: 80 }, (_, index) => {
      const top = 100 + index * 4
      return [
        rectangle(index * 3 + 1, 100, 120, top, top + 1),
        rectangle(index * 3 + 2, 99, 100.1, top, top + 1),
        rectangle(index * 3 + 3, 119.9, 121, top, top + 1),
      ]
    }).flat()
    const sources = Array.from({ length: 1000 }, (_, index) => line(index + 1000, 700, 700, 710))
    expect(run(work([...profiles, ...sources]))).toMatchObject({
      panels: [],
      refusalReason: 'filled-panel-end-search-budget',
    })
  })

  const realSource = fileURLToPath(
    new URL('../../../../output/pdf/source-search-20261003/rebrina-original.pdf', import.meta.url),
  )
  it.skipIf(!existsSync(realSource))(
    'binds actual original source edges and preserves the unresolved right side without source allowlists',
    async () => {
      const body = await readFile(realSource)
      expect(createHash('sha256').update(body).digest('hex')).toBe(
        '2e141c135812c81719e1f4783173cb5202e20041ac494d3cc799eb37ad62ad4e',
      )
      const { preparePlanPage } = await import('./plan-document')
      const page = await preparePlanPage(body, true, 3, true, true)
      const result = nativeFilledPanelJambContacts({
        native: required(page.nativeTextAnchors),
        work: required(page.linework),
        lineworkSource: required(page.lineworkRasterSource),
      })
      expect(result.refusalReason).toBeNull()
      expect(
        result.panels.map((panel) => ({
          id: panel.panelId,
          status: panel.status,
          ends: panel.ends.map((end) => ({
            status: end.status,
            refs: end.sourceEdges.map((edge) => edge.operationIndex),
          })),
        })),
      ).toEqual([
        {
          id: 'native-filled-panel-2035:0',
          status: 'ambiguous',
          ends: [
            { status: 'matched', refs: [2131] },
            { status: 'ambiguous', refs: [2023, 2115] },
          ],
        },
        {
          id: 'native-filled-panel-2059:0',
          status: 'ambiguous',
          ends: [
            { status: 'ambiguous', refs: [2047, 2223] },
            { status: 'unobserved', refs: [] },
          ],
        },
      ])
      expect(result.readyFor2D).toBe(false)
      expect(result.readyFor3D).toBe(false)
      expect(result.physicalJambAccepted).toBe(false)
    },
    30_000,
  )
})
