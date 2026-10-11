import { existsSync, readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'
import { preparePlanPage } from './plan-document'
import { nativeFillCandidates } from './plan-native-fill-candidates'
import { nativePaintedRegionContext } from './plan-native-painted-region-context'
import type { PdfVectorPath } from './plan-pdf-linework'

type Input = Parameters<typeof nativePaintedRegionContext>[0]
function paint(operationIndex: number, fillColor = '#ffffff', size = 100): PdfVectorPath {
  return {
    operationIndex,
    subpathIndex: 0,
    paint: 'fill',
    closed: true,
    fillColor,
    points: [
      { x: 100, y: 100 },
      { x: 100 + size, y: 100 },
      { x: 100 + size, y: 100 + size },
      { x: 100, y: 100 + size },
    ],
  }
}
function fixture(): Input {
  const source = { sha256: 'a'.repeat(64), page: 3, width: 1000, height: 1000 }
  return {
    native: {
      source,
      originalPdfSha256: 'b'.repeat(64),
      complete: true,
      labels: [],
      pageNormalizedScale: { x: 1, y: 1 },
    },
    lineworkSource: { ...source },
    work: {
      coordinateSystem: 'page-0-1000',
      pageWidth: 1000,
      pageHeight: 1000,
      paths: [paint(10)],
      skippedCurves: 0,
      clippedPaths: 0,
      unsupportedPaths: 0,
      unsupportedContexts: 0,
      truncated: false,
    },
  }
}

describe('positive painted-region context, not floor classification', () => {
  it('references existing candidates and tracks native paint order, not array order', () => {
    const input = fixture()
    input.work.paths = [paint(20, '#aaaaaa'), paint(10), paint(2, '#000000')]
    const before = structuredClone(input)
    const result = nativePaintedRegionContext(input)
    expect(result.refusalReason).toBeNull()
    expect(
      result.contexts.find((item) => item.candidateId === 'native-fill-10:0')?.paintContacts,
    ).toEqual([
      {
        sourceRef: { operationIndex: 20, subpathIndex: 0 },
        order: 'later',
        fillColor: '#aaaaaa',
        relation: 'intersecting-paint',
      },
      {
        sourceRef: { operationIndex: 2, subpathIndex: 0 },
        order: 'earlier',
        fillColor: '#000000',
        relation: 'intersecting-paint',
      },
    ])
    expect(result.semanticStatus).toBe('unclassified')
    expect(result.visibilityConfirmed).toBe(false)
    expect(result.roomOwnershipConfirmed).toBe(false)
    expect(result.readyFor2D).toBe(false)
    expect(result.readyFor3D).toBe(false)
    expect(input).toEqual(before)
    expect(result.contexts[0]).not.toHaveProperty('polygon')
  })

  it('retains a small later column excluded from the area-filtered candidate inventory', () => {
    const input = fixture()
    input.work.paths.push(paint(20, '#aaaaaa', 10))
    expect(nativeFillCandidates(input).candidates).toHaveLength(1)
    expect(nativePaintedRegionContext(input).contexts[0]?.paintContacts).toEqual([
      {
        sourceRef: { operationIndex: 20, subpathIndex: 0 },
        order: 'later',
        fillColor: '#aaaaaa',
        relation: 'intersecting-paint',
      },
    ])
  })

  it('does not treat equal paint or a remote different-color shape as an obstruction', () => {
    const input = fixture()
    input.work.paths.push(paint(20))
    const remote = paint(30, '#aaaaaa')
    remote.points = remote.points.map((point) => ({ x: point.x + 500, y: point.y }))
    input.work.paths.push(remote)
    expect(
      nativePaintedRegionContext(input).contexts.every((item) => item.paintContacts.length === 0),
    ).toBe(true)
  })

  it('keeps compound paint and unknown colors unresolved without assuming a union', () => {
    const input = fixture()
    const first = paint(20, '#aaaaaa', 10),
      second = paint(20, '#aaaaaa', 15)
    second.subpathIndex = 1
    delete first.fillColor
    input.work.paths.push(first, second)
    const contacts = nativePaintedRegionContext(input).contexts[0]?.paintContacts
    expect(contacts).toHaveLength(2)
    expect(contacts?.every((item) => item.relation === 'unresolved-paint')).toBe(true)
    expect(contacts?.[0]?.fillColor).toBeNull()
  })

  it('records omitted ink bounds as possible contacts, not intersected geometry', () => {
    const input = fixture()
    input.work.skippedCurves = 1
    input.work.skippedCurveBounds = [
      { operationIndex: 21, bounds: { left: 120, top: 120, right: 130, bottom: 130 } },
    ]
    input.work.clippedPaths = 1
    input.work.clippedPathBounds = [
      { operationIndex: 22, bounds: { left: 700, top: 700, right: 720, bottom: 720 } },
    ]
    const result = nativePaintedRegionContext(input)
    expect(result.refusalReason).toBeNull()
    expect(result.contexts[0]?.possibleOmissions).toEqual([
      { kind: 'curve', ...input.work.skippedCurveBounds[0] },
    ])
    expect(result.omissionContactBasis).toBe('bounds-only-possible-contact')
  })

  it('holds a partially omitted paint operation even when its retained subpath is simple', () => {
    const input = fixture()
    input.work.paths.push(paint(20, '#aaaaaa', 10))
    input.work.clippedPaths = 1
    input.work.clippedPathBounds = [
      { operationIndex: 20, bounds: { left: 120, top: 120, right: 130, bottom: 130 } },
    ]
    expect(nativePaintedRegionContext(input).contexts[0]?.paintContacts[0]?.relation).toBe(
      'unresolved-paint',
    )
  })

  it('normalizes known RGB and retains invalid colors as unknown, not equal-color exclusion', () => {
    const input = fixture()
    input.work.paths.push(paint(20, '#FFFFFF', 10), paint(30, 'unknown', 10))
    const contacts = nativePaintedRegionContext(input).contexts[0]?.paintContacts
    expect(contacts).toHaveLength(1)
    expect(contacts?.[0]?.sourceRef.operationIndex).toBe(30)
    expect(contacts?.[0]?.fillColor).toBeNull()
  })

  it.each([
    'foreign-frame',
    'duplicate-ref',
    'invalid-point',
    'missing-omission',
    'hidden-ink',
    'invalid-omission',
  ] as const)('refuses %s without partial output', (kind) => {
    const input = fixture()
    if (kind === 'foreign-frame') input.lineworkSource.page = 2
    if (kind === 'duplicate-ref') input.work.paths.push(paint(10, '#aaaaaa', 10))
    if (kind === 'invalid-point')
      input.work.paths.push({
        ...paint(20),
        points: [
          { x: Number.NaN, y: 100 },
          { x: 120, y: 120 },
        ],
      })
    if (kind === 'missing-omission') input.work.clippedPaths = 1
    if (kind === 'hidden-ink') input.native.vectorInkRefusal = 'unverified-paint'
    if (kind === 'invalid-omission') {
      input.work.clippedPaths = 1
      input.work.clippedPathBounds = [
        { operationIndex: 20, bounds: { left: 120, top: 120, right: 100, bottom: 130 } },
      ]
    }
    const result = nativePaintedRegionContext(input)
    expect(result.refusalReason).not.toBeNull()
    expect(result.contexts).toEqual([])
  })
})

const original = resolve(
  process.cwd(),
  '../../output/pdf/source-search-20261003/rebrina-original.pdf',
)
it.skipIf(!existsSync(original))(
  'preserves real Rebrina positive room masks and later column context without floor authority',
  async () => {
    const page = await preparePlanPage(readFileSync(original), true, 3, true, true)
    if (!page.nativeTextAnchors || !page.linework || !page.lineworkRasterSource)
      throw new Error('Missing source extraction')
    const result = nativePaintedRegionContext({
      native: page.nativeTextAnchors,
      work: page.linework,
      lineworkSource: page.lineworkRasterSource,
    })
    expect(result.refusalReason).toBeNull()
    expect(result.contexts.map((item) => item.sourceRef.operationIndex)).toEqual(
      expect.arrayContaining([1462, 1491, 1527, 1563, 1591, 1611, 1631, 1651]),
    )
    expect(
      result.contexts.find((item) => item.sourceRef.operationIndex === 1462)?.paintContacts,
    ).toContainEqual({
      sourceRef: { operationIndex: 13501, subpathIndex: 0 },
      order: 'later',
      fillColor: '#aaaaaa',
      relation: 'intersecting-paint',
    })
    expect(result.readyFor2D).toBe(false)
    expect(result.readyFor3D).toBe(false)
  },
  30_000,
)
