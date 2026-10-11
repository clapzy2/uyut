import { describe, expect, it } from 'vitest'
import type { NativeTextAnchors } from './plan-document'
import { nativeOpeningSourceLinks } from './plan-native-opening-links'
import type { PagePoint, PdfCurvePath, PdfLinework, PdfVectorPath } from './plan-pdf-linework'

type Input = Parameters<typeof nativeOpeningSourceLinks>[0]
const source = { sha256: 'a'.repeat(64), page: 6, width: 1000, height: 1000 }
const native: NativeTextAnchors = {
  source,
  originalPdfSha256: 'b'.repeat(64),
  complete: true,
  labels: [],
  pageNormalizedScale: { x: 1, y: 1 },
}

function path(operationIndex: number, coordinates: number[][], closed = true): PdfVectorPath {
  return {
    operationIndex,
    subpathIndex: 0,
    paint: 'stroke',
    closed,
    points: coordinates.map(([x, y]) => ({ x: x as number, y: y as number })),
  }
}
function rectangle(
  operationIndex: number,
  left: number,
  top: number,
  right: number,
  bottom: number,
) {
  return path(operationIndex, [
    [left, top],
    [right, top],
    [right, bottom],
    [left, bottom],
    [left, top],
  ])
}
function panel(operationIndex: number, left = 100, top = 100): PdfVectorPath[] {
  return [
    rectangle(operationIndex, left, top, left + 100, top + 5),
    rectangle(operationIndex + 1, left - 5, top, left, top + 5),
    rectangle(operationIndex + 2, left + 100, top, left + 105, top + 5),
    path(
      operationIndex + 3,
      [
        [left, top + 2.5],
        [left + 100, top + 2.5],
      ],
      false,
    ),
  ]
}
function leftProfile(operationIndex = 20): PdfVectorPath {
  return path(operationIndex, [
    [80, 95],
    [95, 95],
    [95, 102.5],
    [90, 102.5],
    [90, 110],
    [80, 110],
  ])
}
function rightProfile(operationIndex = 21): PdfVectorPath {
  return path(operationIndex, [
    [320, 95],
    [335, 95],
    [335, 110],
    [325, 110],
    [325, 102.5],
    [320, 102.5],
  ])
}
function bridgeProfile(operationIndex = 22): PdfVectorPath {
  return path(operationIndex, [
    [203, 98],
    [212, 98],
    [212, 100],
    [210, 100],
    [210, 102.5],
    [205, 102.5],
    [205, 100],
    [203, 100],
  ])
}
function input(
  paths = [...panel(1), ...panel(5, 215), leftProfile(), rightProfile(), bridgeProfile()],
): Input {
  const work: PdfLinework = {
    coordinateSystem: 'page-0-1000',
    pageWidth: 1000,
    pageHeight: 1000,
    paths,
    curvePaths: [],
    skippedCurves: 0,
    clippedPaths: 0,
    unsupportedPaths: 0,
    unsupportedContexts: 0,
    truncated: false,
  }
  return { native: structuredClone(native), work, lineworkSource: structuredClone(source) }
}
function required<T>(value: T | undefined): T {
  if (value === undefined) throw new Error('Missing source fixture evidence')
  return value
}
function sourcePath(input: Input, operationIndex: number) {
  return required(input.work.paths.find((path) => path.operationIndex === operationIndex))
}
function mutatePoint(
  input: Input,
  operationIndex: number,
  index: number,
  change: Partial<PagePoint>,
) {
  Object.assign(required(sourcePath(input, operationIndex).points[index]), change)
}
function addSwing(input: Input, center: PagePoint, start: PagePoint, end: PagePoint) {
  const a = { x: start.x - center.x, y: start.y - center.y }
  const b = { x: end.x - center.x, y: end.y - center.y }
  const angle = Math.atan2(a.x * b.y - a.y * b.x, a.x * b.x + a.y * b.y)
  const k = (4 / 3) * Math.tan(angle / 4)
  const control1 = { x: start.x - k * a.y, y: start.y + k * a.x }
  const control2 = { x: end.x + k * b.y, y: end.y - k * b.x }
  const curve: PdfCurvePath = {
    operationIndex: 100,
    subpathIndex: 0,
    operationSubpathCount: 1,
    paint: 'stroke',
    closed: false,
    start,
    segments: [{ kind: 'cubic', control1, control2, end }],
  }
  input.work.curvePaths = [curve]
  input.work.skippedCurves = 1
  const points = [start, control1, control2, end]
  input.work.skippedCurveBounds = [
    {
      operationIndex: 100,
      bounds: {
        left: Math.min(...points.map((point) => point.x)),
        right: Math.max(...points.map((point) => point.x)),
        top: Math.min(...points.map((point) => point.y)),
        bottom: Math.max(...points.map((point) => point.y)),
      },
    },
  ]
}
function frameDoor(): Input {
  const result = input([
    rectangle(1, 100, 200, 300, 210),
    path(2, [
      [100, 200],
      [200, 200],
      [200, 180],
      [80, 180],
      [80, 220],
      [100, 220],
      [100, 210],
    ]),
    path(3, [
      [300, 190],
      [320, 190],
      [320, 220],
      [310, 220],
      [310, 230],
      [300, 230],
    ]),
    path(
      4,
      [
        [200, 200],
        [200, 100],
      ],
      false,
    ),
  ])
  addSwing(result, { x: 200, y: 200 }, { x: 200, y: 100 }, { x: 300, y: 200 })
  return result
}
function cappedDoor(left = 200, reversed = false): Input {
  const result = input([
    ...panel(1),
    rectangle(10, left, 110, left + 5, 210),
    rectangle(11, left, 105, left + 5, 110),
    rectangle(12, left, 210, left + 5, 215),
  ])
  if (reversed) for (const path of result.work.paths.slice(4)) path.points.reverse()
  const hinge = { x: left + 5, y: 105 }
  addSwing(result, hinge, { x: hinge.x, y: 215 }, { x: hinge.x + 110, y: 105 })
  return result
}

describe('native painted opening source links, not free-floor proof', () => {
  it('links two source panels through positive partial cap contacts and a literal bridge edge', () => {
    const fixture = input()
    const before = structuredClone(fixture)
    const result = nativeOpeningSourceLinks(fixture)
    expect(result.refusalReason).toBeNull()
    expect(result.glazingLinks.map((link) => link.status)).toEqual(['two-sided', 'two-sided'])
    expect(result.glazingLinks[0]?.ends[1]?.contacts[0]).toMatchObject({
      start: { x: 205, y: 100 },
      end: { x: 205, y: 102.5 },
      capEdge: { operationIndex: 3 },
      profileEdge: { operationIndex: 22 },
    })
    expect(result.groups).toHaveLength(1)
    expect(result.groups[0]).toMatchObject({
      glazingIds: ['native-glazing-symbol-1:0', 'native-glazing-symbol-5:0'],
      doorIds: [],
      bridges: [{ operationIndex: 22, start: { x: 210, y: 102.5 }, end: { x: 205, y: 102.5 } }],
    })
    expect(result).toMatchObject({
      status: 'draft',
      completeOpeningInventory: false,
      roomOwnershipConfirmed: false,
      physicalPassagesAccepted: false,
      closesFloorBoundary: false,
    })
    expect(fixture).toEqual(before)
  })

  it('preserves the source evidence and returns detached contacts, profiles and bridges', () => {
    const fixture = input()
    const before = structuredClone(fixture)
    const result = nativeOpeningSourceLinks(fixture)
    required(required(result.glazingLinks[0]).ends[0].contacts[0]).start.x++
    required(required(result.profiles[0]).path.points[0]).x++
    required(required(result.groups[0]).bridges[0]).start.y++
    expect(fixture).toEqual(before)
  })

  it('recognizes vertical source profiles without changing the source edge direction', () => {
    const fixture = input()
    for (const path of fixture.work.paths)
      path.points = path.points.map(({ x, y }) => ({ x: y, y: x }))
    const result = nativeOpeningSourceLinks(fixture)
    expect(result.glazingLinks.map((link) => link.axis)).toEqual(['y', 'y'])
    expect(result.groups[0]?.bridges[0]).toMatchObject({
      start: { x: 102.5, y: 210 },
      end: { x: 102.5, y: 205 },
    })
  })

  it('uses exact rotated and reversed polygon repaints as aliases, not competing owners', () => {
    const fixture = input()
    const repaint = structuredClone(sourcePath(fixture, 22))
    repaint.operationIndex = 23
    repaint.points = [...repaint.points.slice(3), ...repaint.points.slice(0, 3)].reverse()
    fixture.work.paths.push(repaint)
    const result = nativeOpeningSourceLinks(fixture)
    expect(result.profiles).toHaveLength(3)
    expect(result.profiles.find((profile) => profile.path.operationIndex === 22)?.aliases).toEqual([
      repaint,
    ])
    expect(result.groups).toHaveLength(1)
    expect(result.glazingLinks.every((link) => link.status === 'two-sided')).toBe(true)
  })

  it('does not consider a repeated closing point an additional profile edge', () => {
    const fixture = input()
    for (const operationIndex of [20, 21, 22]) {
      const profile = sourcePath(fixture, operationIndex)
      profile.points.push(structuredClone(required(profile.points[0])))
    }
    expect(nativeOpeningSourceLinks(fixture).groups).toHaveLength(1)
  })

  it.each([1e-9, -1e-9])('does not repair a %s source contact offset', (offset) => {
    const fixture = input()
    for (const index of [4, 5]) mutatePoint(fixture, 22, index, { x: 210 + offset })
    const result = nativeOpeningSourceLinks(fixture)
    expect(result.glazingLinks[1]?.ends[0]?.status).toBe('unresolved')
    expect(result.groups).toEqual([])
  })

  it('does not treat an endpoint-only cap touch as a profile contact', () => {
    const fixture = input()
    sourcePath(fixture, 20).points = sourcePath(fixture, 20).points.map((point) => ({
      ...point,
      y: point.y - 2.5,
    }))
    const result = nativeOpeningSourceLinks(fixture)
    expect(result.glazingLinks[0]?.ends[0]).toMatchObject({ status: 'unresolved', contacts: [] })
    expect(result.groups).toEqual([])
  })

  it('does not group a panel whose other end has no independent source profile', () => {
    const fixture = input()
    fixture.work.paths = fixture.work.paths.filter((path) => path.operationIndex !== 21)
    const result = nativeOpeningSourceLinks(fixture)
    expect(result.glazingLinks.map((link) => link.status)).toEqual(['two-sided', 'unresolved'])
    expect(result.groups).toEqual([])
  })

  it('does not group different panels merely because both contact the same complex profile', () => {
    const fixture = input()
    sourcePath(fixture, 22).points = path(22, [
      [203, 98],
      [212, 98],
      [212, 100],
      [210, 100],
      [210, 102.5],
      [208, 102.5],
      [208, 103],
      [207, 103],
      [207, 102.5],
      [205, 102.5],
      [205, 100],
      [203, 100],
    ]).points
    const result = nativeOpeningSourceLinks(fixture)
    expect(result.glazingLinks.every((link) => link.status === 'two-sided')).toBe(true)
    expect(result.groups).toEqual([])
  })

  it('does not simplify collinear source vertices into an invented full bridge edge', () => {
    const fixture = input()
    sourcePath(fixture, 22).points.splice(5, 0, { x: 207.5, y: 102.5 })
    const result = nativeOpeningSourceLinks(fixture)
    expect(result.glazingLinks.every((link) => link.status === 'two-sided')).toBe(true)
    expect(result.groups).toEqual([])
  })

  it('withholds competing profile geometries instead of choosing the first or nearest source', () => {
    const fixture = input()
    const competing = leftProfile(23)
    required(competing.points[0]).x = 79
    required(competing.points[5]).x = 79
    fixture.work.paths.push(competing)
    const result = nativeOpeningSourceLinks(fixture)
    expect(result.glazingLinks[0]).toMatchObject({
      status: 'ambiguous',
      ends: [{ status: 'ambiguous', profileId: null }, { status: 'matched' }],
    })
    expect(result.groups).toEqual([])
  })

  it.each(['open', 'fill', 'diagonal'] as const)(
    'does not use an unsupported %s profile',
    (kind) => {
      const fixture = input()
      const profile = sourcePath(fixture, 20)
      if (kind === 'open') profile.closed = false
      if (kind === 'fill') profile.paint = 'fill'
      if (kind === 'diagonal') required(profile.points[0]).x += 0.5
      const result = nativeOpeningSourceLinks(fixture)
      expect(result.glazingLinks[0]?.ends[0]?.status).toBe('unresolved')
      expect(result.groups).toEqual([])
    },
  )

  it('does not borrow a source profile operation with a clipped sibling', () => {
    const fixture = input()
    fixture.work.clippedPaths = 1
    fixture.work.clippedPathBounds = [
      { operationIndex: 20, bounds: { left: 800, top: 800, right: 810, bottom: 810 } },
    ]
    const result = nativeOpeningSourceLinks(fixture)
    expect(result.glazingLinks[0]?.ends[0]?.status).toBe('unresolved')
    expect(result.groups).toEqual([])
    expect(fixture.work.clippedPaths).toBe(1)
  })

  it('retains the prior candidate layers when a parent refuses unavailable source curves', () => {
    const fixture = input()
    delete fixture.work.curvePaths
    fixture.work.skippedCurves = 1
    fixture.work.skippedCurveBounds = [
      { operationIndex: 77, bounds: { left: 700, top: 700, right: 710, bottom: 710 } },
    ]
    const result = nativeOpeningSourceLinks(fixture)
    expect(result).toMatchObject({
      status: 'unresolved',
      refusalReason: 'opening-candidates-unavailable',
      glazingLinks: [],
      doorLinks: [],
      groups: [],
      profiles: [],
    })
    expect(result.doorSymbols.compoundPanels.panels).toHaveLength(2)
    expect(result.openingFrames.refusalReason).toBeNull()
  })

  it.each(['duplicate', 'out-of-page', 'precision', 'unsupported-context'] as const)(
    'refuses invalid %s source provenance atomically',
    (kind) => {
      const fixture = input()
      if (kind === 'duplicate')
        fixture.work.paths.push(structuredClone(required(fixture.work.paths[0])))
      if (kind === 'out-of-page') mutatePoint(fixture, 20, 0, { x: 1001 })
      if (kind === 'precision') mutatePoint(fixture, 20, 0, { x: 1e-19 })
      if (kind === 'unsupported-context') fixture.work.unsupportedContexts = 1
      expect(nativeOpeningSourceLinks(fixture)).toMatchObject({
        status: 'unresolved',
        refusalReason: 'opening-candidates-unavailable',
        glazingLinks: [],
        doorLinks: [],
        groups: [],
        profiles: [],
      })
    },
  )

  it('links a strict interior source hinge through a literal connector owned by the frame jamb path', () => {
    const fixture = frameDoor()
    const before = structuredClone(fixture)
    const result = nativeOpeningSourceLinks(fixture)
    expect(result.openingFrames.candidates).toHaveLength(1)
    expect(result.doorSymbols.candidates).toHaveLength(1)
    expect(result.doorLinks).toHaveLength(1)
    expect(result.doorLinks[0]).toMatchObject({
      status: 'linked',
      targetKind: 'opening-frame',
      relation: 'jamb-to-frame',
      evidence: [
        { operationIndex: 1 },
        { operationIndex: 2, start: { x: 100, y: 200 }, end: { x: 200, y: 200 } },
      ],
    })
    expect(result.physicalPassagesAccepted).toBe(false)
    expect(fixture).toEqual(before)
  })

  it('does not invent a connector from the source frame corner to a projected closed door tip', () => {
    const fixture = frameDoor()
    sourcePath(fixture, 2).points = path(2, [
      [100, 190],
      [80, 190],
      [80, 220],
      [100, 220],
      [100, 210],
      [100, 200],
    ]).points
    const result = nativeOpeningSourceLinks(fixture)
    expect(result.openingFrames.candidates).toHaveLength(1)
    expect(result.doorSymbols.candidates).toHaveLength(1)
    expect(result.doorLinks[0]).toMatchObject({
      status: 'unresolved',
      evidence: [],
      targetKind: null,
    })
  })

  it('does not bridge a subdivided connector by tolerance or collinear simplification', () => {
    const fixture = frameDoor()
    sourcePath(fixture, 2).points.splice(1, 0, { x: 150, y: 200 })
    const result = nativeOpeningSourceLinks(fixture)
    expect(result.openingFrames.candidates).toHaveLength(1)
    expect(result.doorSymbols.candidates).toHaveLength(1)
    expect(result.doorLinks[0]?.status).toBe('unresolved')
  })

  it('does not use an independently painted connector that is not owned by a source jamb', () => {
    const fixture = frameDoor()
    sourcePath(fixture, 2).points = path(2, [
      [100, 190],
      [80, 190],
      [80, 220],
      [100, 220],
      [100, 210],
      [100, 200],
    ]).points
    fixture.work.paths.push(
      path(
        5,
        [
          [100, 200],
          [200, 200],
        ],
        false,
      ),
    )
    const result = nativeOpeningSourceLinks(fixture)
    expect(result.openingFrames.candidates).toHaveLength(1)
    expect(result.doorSymbols.candidates).toHaveLength(1)
    expect(result.doorLinks[0]?.status).toBe('unresolved')
  })

  it('does not attach a hinge sitting at the original frame endpoint', () => {
    const fixture = frameDoor()
    sourcePath(fixture, 4).points = [
      { x: 100, y: 200 },
      { x: 100, y: 100 },
    ]
    addSwing(fixture, { x: 100, y: 200 }, { x: 100, y: 100 }, { x: 200, y: 200 })
    const result = nativeOpeningSourceLinks(fixture)
    expect(result.openingFrames.candidates).toHaveLength(1)
    expect(result.doorSymbols.candidates).toHaveLength(1)
    expect(result.doorLinks[0]?.status).toBe('unresolved')
  })

  it.each([false, true])(
    'uses a whole original cap edge for a capped door, reversed=%s',
    (reversed) => {
      const result = nativeOpeningSourceLinks(cappedDoor(200, reversed))
      expect(result.doorSymbols.candidates).toHaveLength(1)
      expect(result.doorSymbols.candidates[0]?.leafProfile).toBe('capped-panel')
      expect(result.doorLinks[0]).toMatchObject({
        status: 'linked',
        targetKind: 'glazing-panel',
        relation: 'shared-cap-edge',
        evidence: [{ operationIndex: 11 }, { operationIndex: 3 }],
      })
      expect(result.closesFloorBoundary).toBe(false)
    },
  )

  it.each([204, 205, 200 + 1e-9])('rejects partial, point or offset cap joins at x=%s', (left) => {
    const result = nativeOpeningSourceLinks(cappedDoor(left))
    expect(result.doorSymbols.candidates).toHaveLength(1)
    expect(result.doorLinks[0]).toMatchObject({
      status: 'unresolved',
      evidence: [],
      targetId: null,
    })
  })

  it('adds only a source-linked capped door to an independently bridged glazing group', () => {
    const fixture = input()
    fixture.work.paths.push(...cappedDoor().work.paths.slice(4))
    addSwing(fixture, { x: 205, y: 105 }, { x: 205, y: 215 }, { x: 315, y: 105 })
    const result = nativeOpeningSourceLinks(fixture)
    expect(result.groups).toHaveLength(1)
    expect(result.groups[0]?.doorIds).toEqual(['native-door-symbol-100:0'])
    expect(result.groups[0]?.glazingIds).toHaveLength(2)
    expect(result.physicalPassagesAccepted).toBe(false)
    expect(result.roomOwnershipConfirmed).toBe(false)
  })

  it('withholds the entire connection batch when its bounded comparison budget is exceeded', () => {
    const paths = Array.from({ length: 40 }, (_, index) =>
      panel(index * 4 + 1, 100 + (index % 5) * 115, 100 + Math.floor(index / 5) * 20),
    ).flat()
    for (let index = 0; index < 125; index++) {
      const left = 750 + index / 1000
      const top = 750
      const coordinates: number[][] = []
      for (let step = 0; step < 5; step++) coordinates.push([left + step * 4, top])
      for (let step = 0; step < 5; step++) coordinates.push([left + 20, top + step * 2])
      for (let step = 0; step < 5; step++) coordinates.push([left + 20 - step * 4, top + 10])
      for (let step = 0; step < 5; step++) coordinates.push([left, top + 10 - step * 2])
      paths.push(path(500 + index, coordinates))
    }
    const result = nativeOpeningSourceLinks(input(paths))
    expect(result).toMatchObject({
      status: 'unresolved',
      refusalReason: 'source-link-work-limit',
      glazingLinks: [],
      doorLinks: [],
      groups: [],
      profiles: [],
    })
    expect(result.doorSymbols.compoundPanels.panels).toHaveLength(40)
    expect(result.openingFrames.refusalReason).toBeNull()
  })
})
