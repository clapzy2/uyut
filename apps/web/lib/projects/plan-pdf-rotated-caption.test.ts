import { afterEach, describe, expect, it, vi } from 'vitest'
import type { NativeDimensionCaptionContext } from './plan-pdf-caption-binding'
import * as chains from './plan-pdf-dimension-chain'
import type { PagePoint, PdfLinework, PdfVectorPath } from './plan-pdf-linework'
import {
  createRotatedNativeCaptionVerifier,
  nativeCaptionDimensionAxis,
} from './plan-pdf-rotated-caption'

function fixture(rotation = 0) {
  const source = { sha256: 'a'.repeat(64), pdfPage: 1, state: 'existing' as const }
  const pageWidth = 700
  const pageHeight = 1100
  const angle = (-rotation * Math.PI) / 180
  const cos = Math.cos(angle)
  const sin = Math.sin(angle)
  const point = (x: number, y: number): PagePoint => ({
    x: ((350 + (x - 200) * cos - (y - 170) * sin) * 1000) / pageWidth,
    y: ((550 + (x - 200) * sin + (y - 170) * cos) * 1000) / pageHeight,
  })
  const stroke = (operationIndex: number, points: PagePoint[]): PdfVectorPath => ({
    operationIndex,
    subpathIndex: 0,
    closed: false,
    paint: 'stroke',
    points,
  })
  const work: PdfLinework = {
    coordinateSystem: 'page-0-1000',
    pageWidth,
    pageHeight,
    paths: [
      stroke(10, [point(100, 170), point(300, 170)]),
      stroke(11, [point(95, 175), point(105, 165)]),
      stroke(12, [point(295, 175), point(305, 165)]),
    ],
    skippedCurves: 0,
    clippedPaths: 0,
    unsupportedPaths: 0,
    unsupportedContexts: 0,
    truncated: false,
  }
  const origin = point(191, 168)
  const caption: NativeDimensionCaptionContext['items'][number] = {
    index: 4,
    text: '2000',
    rotation,
    origin,
    baselineStart: { ...origin },
    baselineEnd: point(209, 168),
  }
  const context: NativeDimensionCaptionContext = {
    source: { ...source, pageWidth, pageHeight },
    complete: true,
    items: [caption],
  }
  const label = () => ({
    index: caption.index,
    text: caption.text,
    rotation: caption.rotation,
    ...caption.origin,
  })
  const verify = () => createRotatedNativeCaptionVerifier(work, source, context)(label(), 2000)
  return { source, work, context, caption, point, label, verify }
}

afterEach(() => vi.restoreAllMocks())

describe('strict rotated source-caption projection, not model acceptance', () => {
  it.each([0, 90, -43.956296393540775])(
    'checks complete clipped ink in original coordinates at rotation %s',
    (rotation) => {
      const data = fixture(rotation)
      data.work.clippedPaths = 1
      data.work.clippedPathBounds = [
        {
          operationIndex: 30,
          paint: 'fill',
          bounds: { left: -20, right: -10, top: 700, bottom: 710 },
        },
      ]
      expect(data.verify().status).toBe('candidate')
      const tip = data.point(100, 170)
      const omission = data.work.clippedPathBounds[0]
      if (!omission) throw new Error('Missing synthetic clipped path')
      omission.bounds = {
        left: tip.x,
        right: tip.x,
        top: tip.y,
        bottom: tip.y,
      }
      expect(data.verify()).toEqual({
        status: 'unresolved',
        reason: 'omitted-ink-near-source-caption-rail',
      })
    },
  )
  it.each([0, 90, 180, -90, 270, 360, 90.00000000000595, -43.956296393540775, 0.3])(
    'checks raw rotation %s with exact original endpoints on a non-square page',
    (rotation) => {
      const data = fixture(rotation)
      const before = structuredClone({ work: data.work, context: data.context })
      const result = data.verify()
      expect(result).toMatchObject({
        status: 'candidate',
        totalMm: 2000,
        axis: nativeCaptionDimensionAxis(rotation),
        lineOperations: [10],
        linePaths: [{ operationIndex: 10, subpathIndex: 0 }],
        ends: data.work.paths[0]?.points,
      })
      expect({ work: data.work, context: data.context }).toEqual(before)
      expect(data.caption.rotation).toBe(rotation)
      expect(result).not.toHaveProperty('mayTransfer2D')
      expect(result).not.toHaveProperty('mayTransfer3D')
    },
  )

  it('does not reinterpret a genuine 0.3-degree baseline as a horizontal dimension', () => {
    const data = fixture(0.3)
    data.work.paths = fixture().work.paths
    expect(data.verify().status).toBe('unresolved')
  })

  it('retains strict centering when a slanted baseline is genuinely displaced', () => {
    const data = fixture(-43.956296393540775)
    data.caption.baselineEnd = data.point(207, 168)
    expect(data.verify()).toMatchObject({
      status: 'unresolved',
      reason: 'caption-rail-unresolved',
    })
  })

  it('projects actual run ink and preserves source-operation metadata without moving the baseline', () => {
    const data = fixture(-43.956296393540775)
    data.caption.baselineEnd = data.point(207, 168)
    data.caption.inkPolygon = [
      data.point(192, 168),
      data.point(208, 168),
      data.point(208, 165),
      data.point(192, 165),
    ]
    data.caption.inkSourceOperation = 200
    const before = structuredClone(data.context)
    expect(data.verify()).toMatchObject({ status: 'candidate', lineOperations: [10] })
    expect(data.context).toEqual(before)
  })

  it('keeps an opposed caption on the other side of the rail as a competitor', () => {
    const data = fixture(-44)
    data.context.items.push({
      index: 8,
      text: '2000',
      rotation: 136,
      origin: data.point(209, 172),
      baselineStart: data.point(209, 172),
      baselineEnd: data.point(191, 172),
    })
    expect(data.verify()).toMatchObject({
      status: 'ambiguous',
      reason: 'competing-native-captions',
    })
  })

  it('does not choose the nearest of two centered source rails', () => {
    const data = fixture(-44)
    data.work.paths.push(
      {
        ...data.work.paths[0],
        operationIndex: 20,
        points: [data.point(100, 171), data.point(300, 171)],
      } as PdfVectorPath,
      {
        ...data.work.paths[1],
        operationIndex: 21,
        points: [data.point(95, 176), data.point(105, 166)],
      } as PdfVectorPath,
      {
        ...data.work.paths[2],
        operationIndex: 22,
        points: [data.point(295, 176), data.point(305, 166)],
      } as PdfVectorPath,
    )
    expect(data.verify().status).toBe('ambiguous')
  })

  it.each([
    'hash',
    'page',
    'width',
    'incomplete',
    'duplicate',
    'baseline-origin',
    'direction',
    'zero-baseline',
    'nonfinite',
    'ink-source',
    'ink-duplicate',
    'ink-refusal',
  ] as const)('refuses invalid original context %s before projecting', (kind) => {
    const data = fixture(-44)
    if (kind === 'hash') data.context.source.sha256 = 'b'.repeat(64)
    if (kind === 'page') data.context.source.pdfPage = 2
    if (kind === 'width') data.context.source.pageWidth = 701
    if (kind === 'incomplete') data.context.complete = false
    if (kind === 'duplicate') data.context.items.push(structuredClone(data.caption))
    if (kind === 'baseline-origin') data.caption.baselineStart.x += 0.4
    if (kind === 'direction') data.caption.rotation = -43.7
    if (kind === 'zero-baseline') data.caption.baselineEnd = { ...data.caption.baselineStart }
    if (kind === 'nonfinite') data.caption.baselineEnd.x = Number.NaN
    if (kind === 'ink-source') data.caption.inkSourceOperation = 1
    if (kind === 'ink-duplicate')
      data.caption.inkPolygon = Array.from({ length: 4 }, () => ({ ...data.caption.origin }))
    if (kind === 'ink-refusal') data.caption.inkRefusal = ''
    const prepare = vi.spyOn(chains, 'createPdfNativePageDimensionChainVerifier')
    expect(data.verify()).toMatchObject({
      status: 'unresolved',
      reason: 'rotated-caption-context-invalid',
    })
    expect(prepare).not.toHaveBeenCalled()
  })

  it.each(['index', 'text', 'origin', 'rotation', 'value'] as const)(
    'does not repair a mismatching query %s',
    (kind) => {
      const data = fixture(-44)
      const label = data.label()
      if (kind === 'index') label.index = 8
      if (kind === 'text') label.text = '2001'
      if (kind === 'origin') label.x += 1e-10
      if (kind === 'rotation') label.rotation = -44 + 1e-10
      expect(
        createRotatedNativeCaptionVerifier(
          data.work,
          data.source,
          data.context,
        )(label, kind === 'value' ? 2001 : 2000),
      ).toMatchObject({ status: 'unresolved', reason: 'rotated-caption-context-invalid' })
    },
  )

  it.each(['clipped', 'omission-count', 'truncated', 'foreign-source'] as const)(
    'retains original source refusal for %s',
    (kind) => {
      const data = fixture(-44)
      if (kind === 'clipped') data.work.clippedPaths = 1
      if (kind === 'omission-count') data.work.skippedCurves = 1
      if (kind === 'truncated') data.work.truncated = true
      if (kind === 'foreign-source') data.source.sha256 = 'invalid'
      expect(data.verify()).toMatchObject({
        status: 'unresolved',
        reason:
          kind === 'foreign-source'
            ? 'invalid-native-dimension-source'
            : 'incomplete-native-dimension-layer',
      })
    },
  )

  it('caps distinct source frames atomically before preparing a matcher', () => {
    const data = fixture()
    data.context.items = Array.from({ length: 33 }, (_, index) => {
      const other = fixture(index)
      return { ...other.caption, index }
    })
    const first = data.context.items[0]
    if (!first) throw new Error('Missing first source run')
    const prepare = vi.spyOn(chains, 'createPdfNativePageDimensionChainVerifier')
    const verify = createRotatedNativeCaptionVerifier(data.work, data.source, data.context)
    expect(
      verify(
        { ...first.origin, index: first.index, text: first.text, rotation: first.rotation },
        2000,
      ),
    ).toMatchObject({ status: 'unresolved', reason: 'rotated-caption-budget-exceeded' })
    expect(prepare).not.toHaveBeenCalled()
  })

  it('reserves the complete projected search budget before returning any result', () => {
    const data = fixture()
    const rail = data.work.paths[0]
    if (!rail) throw new Error('Missing rail')
    data.work.paths.push(
      ...Array.from({ length: 2000 }, (_, index) => ({ ...rail, operationIndex: 100 + index })),
    )
    const prepare = vi.spyOn(chains, 'createPdfNativePageDimensionChainVerifier')
    expect(data.verify()).toMatchObject({
      status: 'unresolved',
      reason: 'rotated-caption-budget-exceeded',
    })
    expect(prepare).not.toHaveBeenCalled()
  })

  it('reuses a bounded source frame and detaches cached results from the source', () => {
    const data = fixture(-44)
    const before = structuredClone({ work: data.work, context: data.context })
    const prepare = vi.spyOn(chains, 'createPdfNativePageDimensionChainVerifier')
    const verify = createRotatedNativeCaptionVerifier(data.work, data.source, data.context)
    const first = verify(data.label(), 2000)
    if (first.status !== 'candidate') throw new Error('Missing source candidate')
    first.ends[0].x += 100
    first.lineOperations[0] = 999
    const second = verify(data.label(), 2000)
    expect(second).toMatchObject({
      status: 'candidate',
      ends: data.work.paths[0]?.points,
      lineOperations: [10],
    })
    expect(prepare).toHaveBeenCalledTimes(1)
    expect({ work: data.work, context: data.context }).toEqual(before)
  })

  it('holds non-source endpoints instead of inverse-calculating a point', () => {
    const data = fixture(-44)
    vi.spyOn(chains, 'createPdfNativePageDimensionChainVerifier').mockReturnValue(() => ({
      status: 'candidate',
      totalMm: 2000,
      axis: 'width',
      labelIndexes: [4],
      lineOperations: [10],
      linePaths: [{ operationIndex: 10, subpathIndex: 0 }],
      ends: [
        { x: 1, y: 1 },
        { x: 2, y: 1 },
      ],
      segments: [{ labelIndex: 4, valueMm: 2000, start: { x: 1, y: 1 }, end: { x: 2, y: 1 } }],
      basis: 'native-page-dimension',
    }))
    expect(data.verify()).toMatchObject({
      status: 'unresolved',
      reason: 'rotated-caption-non-native-endpoint',
    })
  })
})
