import { createHash } from 'node:crypto'
import { existsSync } from 'node:fs'
import { readFile } from 'node:fs/promises'
import { describe, expect, it } from 'vitest'
import { nativeHeightCalloutCandidates } from './plan-native-height-callouts'
import type { PagePoint, PdfVectorPath } from './plan-pdf-linework'

type Input = Parameters<typeof nativeHeightCalloutCandidates>[0]
function fixture(): Input {
  const source = { sha256: 'b'.repeat(64), pdfPage: 3, state: 'existing' as const }
  const image = { sha256: 'a'.repeat(64), page: 3, width: 1000, height: 1000 }
  const points: PagePoint[] = [
    { x: 99, y: 120 },
    { x: 99.3, y: 119.3 },
    { x: 100, y: 119 },
    { x: 100.7, y: 119.3 },
    { x: 101, y: 120 },
    { x: 100.7, y: 120.7 },
    { x: 100, y: 121 },
    { x: 99.3, y: 120.7 },
  ]
  const line = (operationIndex: number, start: PagePoint, end: PagePoint): PdfVectorPath => ({
    operationIndex,
    subpathIndex: 0,
    paint: 'stroke',
    strokeColor: '#000000',
    closed: false,
    points: [start, end],
    strokeInk: {
      points: [start, end],
      sourceToPage: [1, 0, 0, 1, 0, 0],
      lineWidth: 0.2,
      lineCap: 1,
      lineJoin: 1,
      miterLimit: 10,
      dashArray: [],
      dashPhase: 0,
      refusalReason: null,
    },
  })
  const text = 'Н = 2000 мм/проем'
  return {
    source,
    lineworkSource: image,
    native: {
      source: image,
      originalPdfSha256: source.sha256,
      complete: true,
      pageNormalizedScale: { x: 1, y: 1 },
      labels: [
        {
          id: 'native-text-0',
          nativeIndex: 0,
          name: text,
          rotation: 0,
          point: { x: 110, y: 90 },
          pagePoint: { x: 110, y: 90 },
        },
      ],
      heightCaptionInk: {
        source: { ...source, pageWidth: 1000, pageHeight: 1000 },
        complete: true,
        refusalReason: null,
        unresolved: [],
        items: [
          {
            index: 0,
            text,
            fontName: 'fixture-font',
            operationIndex: 5,
            baselineStart: { x: 110, y: 90 },
            baselineEnd: { x: 210, y: 90 },
            quad: [
              { x: 110, y: 80 },
              { x: 210, y: 80 },
              { x: 210, y: 91 },
              { x: 110, y: 91 },
            ],
          },
        ],
      },
    },
    work: {
      coordinateSystem: 'page-0-1000',
      pageWidth: 1000,
      pageHeight: 1000,
      skippedCurves: 1,
      skippedCurveBounds: [
        { operationIndex: 13, bounds: { left: 99, right: 101, top: 119, bottom: 121 } },
      ],
      clippedPaths: 0,
      clippedPathBounds: [],
      unsupportedContexts: 0,
      unsupportedPaths: 0,
      truncated: false,
      paths: [
        line(10, { x: 100, y: 100 }, { x: 100, y: 119 }),
        line(11, { x: 100, y: 100 }, { x: 110, y: 100 }),
        {
          operationIndex: 12,
          subpathIndex: 0,
          paint: 'fill',
          fillColor: '#000000',
          closed: true,
          points,
        },
      ],
      curvePaths: [
        {
          operationIndex: 13,
          subpathIndex: 0,
          operationSubpathCount: 1,
          paint: 'stroke',
          strokeColor: '#000000',
          closed: true,
          start: { x: 101, y: 120 },
          segments: [
            {
              kind: 'cubic',
              control1: { x: 101, y: 119.5 },
              control2: { x: 100.5, y: 119 },
              end: { x: 100, y: 119 },
            },
            {
              kind: 'cubic',
              control1: { x: 99.5, y: 119 },
              control2: { x: 99, y: 119.5 },
              end: { x: 99, y: 120 },
            },
            {
              kind: 'cubic',
              control1: { x: 99, y: 120.5 },
              control2: { x: 99.5, y: 121 },
              end: { x: 100, y: 121 },
            },
            {
              kind: 'cubic',
              control1: { x: 100.5, y: 121 },
              control2: { x: 101, y: 120.5 },
              end: { x: 101, y: 120 },
            },
          ],
        },
      ],
      paintBounds: { complete: true, refusalReason: null, events: [] },
    },
  }
}
function path(input: Input, index: number) {
  const result = input.work.paths[index]
  if (!result) throw new Error('Missing test path')
  return result
}

describe('unverified L/dot height source callout suggestions', () => {
  it('preserves exact primitive references without asserting a text or object owner', () => {
    const input = fixture(),
      before = structuredClone(input)
    const result = nativeHeightCalloutCandidates(input)
    expect(result.refusalReason).toBeNull()
    expect(result.candidates).toHaveLength(1)
    expect(result.candidates[0]).toMatchObject({
      stem: { source: { operationIndex: 10, subpathIndex: 0, segmentIndex: 0 } },
      horizontal: { source: { operationIndex: 11, subpathIndex: 0, segmentIndex: 0 } },
      dot: { source: { operationIndex: 12, subpathIndex: 0 } },
      outline: { operationIndex: 13, subpathIndex: 0 },
      possibleTextLabelIds: ['native-text-0'],
      heightCaptions: [{ labelId: 'native-text-0', sourceOperations: [5] }],
      textBlockStatus: 'unverified',
      objectStatus: 'unresolved',
    })
    expect(result.physicalObjectAccepted).toBe(false)
    expect(result.textBlockOwnershipConfirmed).toBe(false)
    expect(result.mayTransfer2D3D).toBe(false)
    expect(result.candidates[0]).not.toHaveProperty('openingId')
    expect(input).toEqual(before)
  })

  it.each([
    'elbow-gap',
    'dot-gap',
    'triangle',
    'missing-outline',
    'duplicate-elbow',
    'duplicate-outline',
    'curve-outside-dot',
    'dashed-stem',
    'cover',
    'unknown-paint',
    'hidden-caption',
    'unproved-caption',
    'distant-caption',
    'incomplete-curves',
  ] as const)('does not offer a falsely complete source pattern after %s', (mutation) => {
    const input = fixture()
    if (mutation === 'elbow-gap')
      path(input, 1).points = [
        { x: 100.001, y: 100 },
        { x: 110, y: 100 },
      ]
    if (mutation === 'dot-gap')
      path(input, 0).points = [
        { x: 100, y: 100 },
        { x: 100, y: 118.999 },
      ]
    if (mutation === 'triangle')
      path(input, 2).points = [
        { x: 100, y: 119 },
        { x: 101, y: 121 },
        { x: 99, y: 121 },
      ]
    if (mutation === 'missing-outline') {
      input.work.curvePaths = []
      input.work.skippedCurves = 0
      input.work.skippedCurveBounds = []
    }
    if (mutation === 'duplicate-elbow')
      input.work.paths.push({ ...structuredClone(path(input, 1)), operationIndex: 14 })
    if (mutation === 'duplicate-outline') {
      const curve = input.work.curvePaths?.[0]
      if (!curve) throw new Error('Missing outline')
      input.work.curvePaths?.push({ ...structuredClone(curve), operationIndex: 14 })
      input.work.skippedCurves = 2
      input.work.skippedCurveBounds?.push({
        operationIndex: 14,
        bounds: { left: 99, right: 101, top: 119, bottom: 121 },
      })
    }
    if (mutation === 'curve-outside-dot') {
      const segment = input.work.curvePaths?.[0]?.segments[0]
      if (segment?.kind !== 'cubic') throw new Error('Missing cubic')
      segment.control1.x = 102
    }
    if (mutation === 'dashed-stem') {
      const ink = path(input, 0).strokeInk
      if (ink) ink.dashArray = [1, 2]
    }
    if (mutation === 'cover' || mutation === 'unknown-paint')
      input.work.paintBounds?.events.push({
        operationIndex: 20,
        kind: 'vector',
        bounds: mutation === 'cover' ? { left: 99, right: 111, top: 95, bottom: 122 } : null,
        reason: null,
      })
    if (mutation === 'hidden-caption') input.native.vectorInkRefusal = 'hidden-source-text'
    if (mutation === 'unproved-caption' && input.native.heightCaptionInk)
      input.native.heightCaptionInk.items = []
    if (mutation === 'distant-caption') {
      const label = input.native.labels[0]
      if (label) {
        label.pagePoint = { x: 900, y: 90 }
        label.point = { x: 900, y: 90 }
      }
    }
    if (mutation === 'incomplete-curves') input.work.skippedCurves = 2
    expect(nativeHeightCalloutCandidates(input).candidates).toEqual([])
  })

  const sourcePath = new URL('../../../../tmp/pdfs/deco-art-dvushka-source.pdf', import.meta.url)
  it.skipIf(!existsSync(sourcePath))(
    'finds the three real DECO source callouts, never opening owners',
    async () => {
      const body = await readFile(sourcePath),
        sha256 = createHash('sha256').update(body).digest('hex')
      expect(sha256).toBe('fee92486f301e8a40886914c74b9a83ce77747c6ee14dd4ee0a666dec4a647fd')
      const { preparePlanPage } = await import('./plan-document')
      const page = await preparePlanPage(body, true, 3, true, true)
      if (!page.nativeTextAnchors || !page.linework || !page.lineworkRasterSource)
        throw new Error('Missing real source')
      const input: Input = {
        source: { sha256, pdfPage: 3, state: 'existing' },
        native: page.nativeTextAnchors,
        work: page.linework,
        lineworkSource: page.lineworkRasterSource,
      }
      const result = nativeHeightCalloutCandidates(input)
      expect(result.refusalReason).toBeNull()
      expect(
        result.candidates.map((row) => [
          row.stem.source.operationIndex,
          row.horizontal.source.operationIndex,
          row.dot.source.operationIndex,
          row.outline.operationIndex,
        ]),
      ).toEqual([
        [22561, 22582, 22566, 22575],
        [22722, 22743, 22727, 22736],
        [22831, 22852, 22836, 22845],
      ])
      expect(result.candidates.map((row) => row.possibleTextLabelIds.length)).toEqual([9, 9, 5])
      expect(result.candidates.map((row) => row.heightCaptions.length)).toEqual([4, 4, 4])
      expect(
        result.candidates.every(
          (row) => row.textBlockStatus === 'unverified' && row.objectStatus === 'unresolved',
        ),
      ).toBe(true)
      expect(result.mayTransfer2D3D).toBe(false)
    },
  )
})
