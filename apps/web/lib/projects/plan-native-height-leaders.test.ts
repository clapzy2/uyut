import { describe, expect, it } from 'vitest'
import native from '../../../../docs/qa/fixtures/apartment-74-77-native-leaders.json'
import { createNativeHeightLeaderVerifier } from './plan-native-height-leaders'
import type { PagePoint, PdfLinework, PdfVectorPath } from './plan-pdf-linework'

const point = (x: number, y: number): PagePoint => ({ x, y })
function required<T>(value: T | undefined): T {
  if (value === undefined) throw new Error('Missing test fixture item')
  return value
}
const path = (
  operationIndex: number,
  points: PagePoint[],
  closed = false,
  paint: PdfVectorPath['paint'] = 'stroke',
): PdfVectorPath => ({
  operationIndex,
  subpathIndex: 0,
  points,
  closed,
  paint,
})
const quad = [point(102, 102), point(118, 102), point(118, 108), point(102, 108)]
const source = (): PdfLinework => ({
  coordinateSystem: 'page-0-1000',
  pageWidth: 1000,
  pageHeight: 1000,
  paths: [
    path(1, [point(100, 100), point(120, 100), point(120, 110), point(100, 110)], true),
    path(2, [point(140, 105), point(130, 105), point(120, 105)]),
    path(3, [point(140, 104), point(146, 105), point(140, 106)], true, 'fill-stroke'),
  ],
  skippedCurves: 0,
  unsupportedPaths: 0,
  unsupportedContexts: 0,
  clippedPaths: 0,
  truncated: false,
})
const verify = (work = source(), caption = quad) => createNativeHeightLeaderVerifier(work)(caption)
const expectHeld = (work: PdfLinework) => expect(verify(work).status).not.toBe('candidate')

describe('exact bounded height callout evidence, never room ownership', () => {
  it('retains both source stem segments in walking order and whole arrow', () => {
    expect(verify()).toEqual({
      status: 'candidate',
      reason: null,
      proof: {
        boxRefs: [{ operationIndex: 1, subpathIndex: 0 }],
        stemRefs: [
          { operationIndex: 2, subpathIndex: 0, segmentIndex: 1 },
          { operationIndex: 2, subpathIndex: 0, segmentIndex: 0 },
        ],
        arrowRef: { operationIndex: 3, subpathIndex: 0 },
        arrowPolygon: required(source().paths[2]).points,
        tip: point(146, 105),
      },
    })
  })
  it('does not require the computed base midpoint to equal the stem endpoint', () => {
    const work = source()
    required(work.paths[2]).points = [point(140, 103.999), point(146, 105), point(140, 106)]
    expect(verify(work).status).toBe('candidate')
  })
  it('supports a bent vertical terminal and a rectangular literal closing point', () => {
    const work = source()
    required(work.paths[0]).points.push(point(100, 100))
    required(work.paths[1]).points = [point(130, 80), point(130, 105), point(120, 105)]
    required(work.paths[2]).points = [
      point(129, 80),
      point(130, 74),
      point(131, 80),
      point(129, 80),
    ]
    expect(verify(work)).toMatchObject({ status: 'candidate', proof: { tip: point(130, 74) } })
  })
  it('supports separate endpoint-connected path segments', () => {
    const work = source()
    required(work.paths[1]).points = [point(130, 105), point(120, 105)]
    work.paths.push(path(4, [point(130, 105), point(140, 105)]))
    expect(verify(work).proof?.stemRefs.map((ref) => ref.operationIndex)).toEqual([2, 4])
  })
  it.each(['stroke', 'fill-stroke'] as const)(
    'retains a same-polyline subdivision crossing the strict interior of a closed %s contour',
    (paint) => {
      const work = source()
      work.paths.push(
        path(8, [point(130, 90), point(135, 90), point(135, 120), point(130, 120)], true, paint),
      )
      expect(verify(work).status).toBe('candidate')
    },
  )
  it.each(['open-contour', 'separate-join', 'foreign-endpoint', 'overlap'])(
    'does not generalize a source-polyline crossing into %s acceptance',
    (kind) => {
      const work = source()
      work.paths.push(
        path(8, [point(130, 90), point(135, 90), point(135, 120), point(130, 120)], true),
      )
      const crossing = required(work.paths.at(-1))
      if (kind === 'open-contour') {
        crossing.closed = false
        crossing.points.push({ ...required(crossing.points[0]) })
      }
      if (kind === 'separate-join') {
        required(work.paths[1]).points = [point(130, 105), point(120, 105)]
        work.paths.push(path(9, [point(130, 105), point(140, 105)]))
      }
      if (kind === 'foreign-endpoint') crossing.points[0] = point(130, 105)
      if (kind === 'overlap')
        crossing.points = [point(125, 105), point(132, 105), point(132, 109), point(125, 109)]
      expectHeld(work)
    },
  )
  it.each(['box', 'joint', 'base'] as const)('holds a literal 1e-9 gap at %s', (where) => {
    const work = source()
    if (where === 'box') required(required(work.paths[1]).points[2]).x += 1e-9
    if (where === 'base') required(required(work.paths[1]).points[0]).x -= 1e-9
    if (where === 'joint') {
      required(work.paths[1]).points = [point(130, 105), point(120, 105)]
      work.paths.push(path(4, [point(130 + 1e-9, 105), point(140, 105)]))
    }
    expectHeld(work)
  })
  it.each(['box', 'stem', 'arrow'] as const)(
    'holds competing/repainted %s, never first-wins',
    (kind) => {
      const work = source()
      const index = { box: 0, stem: 1, arrow: 2 }[kind]
      work.paths.push({ ...structuredClone(required(work.paths[index])), operationIndex: 8 })
      expect(verify(work).status).toBe('ambiguous')
    },
  )
  it('does not bind a partially contained caption', () => {
    expect(verify(source(), [point(99, 102), ...quad.slice(1)]).status).not.toBe('candidate')
  })
  it('holds a caption exactly touching the box edge without calling inclusive containment strict', () => {
    expect(verify(source(), [point(100, 102), ...quad.slice(1)]).reason).toBe(
      'height-leader-caption-box-contact',
    )
  })
  it('holds a second box partially crossing the caption despite one containing box', () => {
    const work = source()
    work.paths.push(
      path(8, [point(110, 101), point(135, 101), point(135, 107), point(110, 107)], true),
    )
    expectHeld(work)
  })
  it.each([0, 1, 2])('holds an unsupported compound source operation at path %i', (index) => {
    const work = source()
    work.paths.push({
      ...path(required(work.paths[index]).operationIndex, [point(200, 200), point(210, 210)]),
      subpathIndex: 1,
    })
    expectHeld(work)
  })
  it('does not mistake an enclosing sheet frame or floor contour for a caption box', () => {
    const work = source()
    work.paths.push(path(8, [point(10, 10), point(900, 10), point(900, 990), point(10, 990)], true))
    expect(verify(work).status).toBe('candidate')
  })
  it('retains an out-of-scope box stroke as a competing endpoint, never discarding attached ink', () => {
    const work = source()
    work.paths.push(
      path(8, [point(130, 105), point(900, 105), point(900, 990), point(130, 990)], true),
    )
    expectHeld(work)
  })
  it('holds an omitted sibling of the source stem even when its bounds are remote', () => {
    const work = source()
    work.skippedCurves = 1
    work.skippedCurveBounds = [
      { operationIndex: 2, bounds: { left: 200, top: 200, right: 210, bottom: 210 } },
    ]
    expectHeld(work)
  })
  it('holds omitted ink fully inside the source box', () => {
    const work = source()
    work.skippedCurves = 1
    work.skippedCurveBounds = [
      { operationIndex: 99, bounds: { left: 101, top: 101, right: 102, bottom: 102 } },
    ]
    expectHeld(work)
  })
  it.each(['paths', 'skippedCurveBounds', 'clippedPathBounds', 'curvePaths'])(
    'holds malformed source array %s without throwing',
    (field) => {
      const work = { ...source(), [field]: {} } as unknown as PdfLinework
      expect(verify(work)).toEqual({ status: 'unresolved', reason: 'invalid-height-leader-source' })
    },
  )
  it('holds an attached curve omitted without matching source diagnostic bounds', () => {
    const work = source()
    work.curvePaths = [
      {
        operationIndex: 9,
        subpathIndex: 0,
        operationSubpathCount: 1,
        paint: 'stroke',
        closed: false,
        start: point(130, 105),
        segments: [{ kind: 'quadratic', control: point(131, 110), end: point(135, 115) }],
      },
    ]
    expectHeld(work)
  })
  it('bounds inventories before traversing oversized path-point arrays', () => {
    const work = source()
    required(work.paths[1]).points = Array.from({ length: 20_001 }, () => point(130, 105))
    expectHeld(work)
    work.paths = Array.from({ length: 5001 }, () => source().paths[0] as PdfVectorPath)
    expect(verify(work).reason).toBe('height-leader-source-limit')
  })
  it('rejects an invalid caption container without throwing', () => {
    expect(createNativeHeightLeaderVerifier(source())(null as unknown as PagePoint[])).toEqual({
      status: 'unresolved',
      reason: 'invalid-height-leader-quad',
    })
  })
  it.each(['closed', 'fill', 'fill-stroke'] as const)('holds unsupported %s stem', (kind) => {
    const work = source()
    if (kind === 'closed') required(work.paths[1]).closed = true
    else required(work.paths[1]).paint = kind
    expectHeld(work)
  })
  it('holds a different base edge or off-axis arrow tip', () => {
    const work = source()
    required(required(work.paths[2]).points[1]).y += 1e-9
    expectHeld(work)
    required(work.paths[2]).points = [point(141, 104), point(147, 105), point(141, 106)]
    expectHeld(work)
  })
  it('holds a backwards arrow', () => {
    const work = source()
    required(required(work.paths[2]).points[1]).x = 134
    expectHeld(work)
  })
  it('ignores a true interior/interior crossing instead of treating it as a connection', () => {
    const work = source()
    work.paths.push(path(4, [point(125, 90), point(125, 120)]))
    expect(verify(work).status).toBe('candidate')
  })
  it.each([125, 130, 140])('holds a branch endpoint at source x=%i', (x) => {
    const work = source()
    work.paths.push(path(4, [point(x, 105), point(x, 115)]))
    expect(verify(work).status).toBe('ambiguous')
  })
  it('holds a terminal endpoint attached to another segment interior', () => {
    const work = source()
    work.paths.push(path(4, [point(130, 90), point(130, 120)]))
    expect(verify(work).status).toBe('ambiguous')
  })
  it.each(['skipped', 'clipped'] as const)('holds touching omitted %s ink', (kind) => {
    const work = source()
    const row = { operationIndex: 99, bounds: { left: 129, right: 131, top: 104, bottom: 106 } }
    if (kind === 'skipped') {
      work.skippedCurves = 1
      work.skippedCurveBounds = [row]
    } else {
      work.clippedPaths = 1
      work.clippedPathBounds = [row]
    }
    expect(verify(work).reason).toBe('height-leader-omitted-ink')
  })
  it('holds omitted ink touching the box away from the stem', () => {
    const work = source()
    work.clippedPaths = 1
    work.clippedPathBounds = [
      { operationIndex: 99, bounds: { left: 101, right: 102, top: 99, bottom: 101 } },
    ]
    expect(verify(work).reason).toBe('height-leader-omitted-ink')
  })
  it.each([
    { skippedCurves: 1 },
    { clippedPaths: 1 },
    { unsupportedPaths: 1 },
    { unsupportedContexts: 1 },
    { truncated: true },
    { curvePathsTruncated: true },
    { skippedCurveBoundsTruncated: true },
    { clippedPathBoundsTruncated: true },
  ])('holds incomplete source %j', (fields) => expectHeld({ ...source(), ...fields }))
  it('permits unrelated omitted ink with complete diagnostic bounds', () => {
    const work = source()
    work.skippedCurves = 1
    work.skippedCurveBounds = [
      { operationIndex: 99, bounds: { left: 200, right: 201, top: 200, bottom: 201 } },
    ]
    expect(verify(work).status).toBe('candidate')
  })
  it('bounds chain length rather than using a nearest triangle', () => {
    const work = source()
    required(work.paths[1]).points = Array.from({ length: 10 }, (_, index) =>
      point(120 + index * 2, 105),
    )
    required(work.paths[2]).points = [point(138, 104), point(144, 105), point(138, 106)]
    expect(verify(work).reason).toBe('height-leader-chain-limit')
  })
  it('keeps its shared work limit sticky for atomic caller clearing', () => {
    const verifier = createNativeHeightLeaderVerifier(source())
    let result = verifier(quad)
    for (let index = 0; index < 10_000 && result.reason !== 'height-leader-work-limit'; index++)
      result = verifier(quad)
    expect(result).toEqual({ status: 'unresolved', reason: 'height-leader-work-limit' })
    expect(verifier(quad)).toEqual(result)
  })
  it('does not mutate source input or leak geometry/height authority', () => {
    const work = source()
    const before = structuredClone(work)
    const result = verify(work)
    expect(work).toEqual(before)
    expect(Object.keys(result).sort()).toEqual(['proof', 'reason', 'status'])
    required(result.proof).tip.x = 1
    expect(required(verify(work).proof).tip.x).toBe(146)
  })
  it('traces the real source callouts without midpoint snapping', () => {
    const work = {
      ...source(),
      pageWidth: native.pageWidth,
      pageHeight: native.pageHeight,
      paths: native.paths as PdfVectorPath[],
    }
    const verifier = createNativeHeightLeaderVerifier(work)
    for (const [x, y, tip] of [
      [526, 487, point(691.008, 483.823)],
      [430, 426, point(525.277, 364.801)],
      [672, 255, point(767.134, 225.308)],
      [526, 637, point(691.008, 633.423)],
    ] as const) {
      const ink = [point(x, y), point(x + 15, y), point(x + 15, y + 4), point(x, y + 4)]
      expect(verifier(ink)).toMatchObject({ status: 'candidate', proof: { tip } })
    }
  })
})
