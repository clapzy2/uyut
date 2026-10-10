import { afterEach, describe, expect, it, vi } from 'vitest'
import * as bindings from './plan-native-caption-bindings'
import { nativeScaleEvidence } from './plan-native-scale-evidence'
import type { PagePoint, PdfVectorPath } from './plan-pdf-linework'

type Input = Parameters<typeof nativeScaleEvidence>[0]
function fixture(): Input {
  const source = { sha256: 'b'.repeat(64), pdfPage: 1, state: 'existing' as const }
  const image = { sha256: 'a'.repeat(64), page: 1, width: 1000, height: 1000 }
  const input: Input = {
    source,
    lineworkSource: { ...image },
    native: {
      source: image,
      originalPdfSha256: source.sha256,
      complete: true,
      pageNormalizedScale: { x: 1, y: 1 },
      labels: [],
      compactCaptionGeometry: {
        source: { sha256: source.sha256, pdfPage: 1, pageWidth: 1000, pageHeight: 1000 },
        complete: true,
        items: [],
      },
    },
    work: {
      coordinateSystem: 'page-0-1000',
      pageWidth: 1000,
      pageHeight: 1000,
      skippedCurves: 0,
      clippedPaths: 0,
      unsupportedPaths: 0,
      unsupportedContexts: 0,
      truncated: false,
      paths: [],
    },
  }
  addDimension(input, 'width', 100, 300, 170, 1000)
  addDimension(input, 'width', 500, 600, 350, 500)
  addDimension(input, 'depth', 100, 400, 750, 1500)
  addDimension(input, 'depth', 500, 600, 900, 500)
  return input
}
function addDimension(
  input: Input,
  axis: 'width' | 'depth',
  low: number,
  high: number,
  across: number,
  valueMm: number,
) {
  const compact = input.native.compactCaptionGeometry
  if (!compact) throw new Error('Missing fixture bridge')
  const index = input.native.labels.length
  const point = (along: number, cross: number): PagePoint =>
    axis === 'width' ? { x: along, y: cross } : { x: cross, y: along }
  const midpoint = (low + high) / 2
  const start = point(midpoint + (axis === 'width' ? -9 : 9), across - 2)
  const end = point(midpoint + (axis === 'width' ? 9 : -9), across - 2)
  const rotation = axis === 'width' ? 0 : 90
  input.native.labels.push({
    id: `native-text-${index}`,
    nativeIndex: index,
    compactIndex: index,
    name: `${valueMm}`,
    rotation,
    point: { ...start },
    pagePoint: { ...start },
  })
  compact.items.push({
    index,
    text: `${valueMm}`,
    rotation,
    origin: { ...start },
    baselineStart: { ...start },
    baselineEnd: end,
  })
  const operation = input.work.paths.length + 1
  const path = (operationIndex: number, points: PagePoint[]): PdfVectorPath => ({
    operationIndex,
    subpathIndex: 0,
    paint: 'stroke',
    closed: false,
    points,
  })
  input.work.paths.push(
    path(operation, [point(low, across), point(high, across)]),
    path(operation + 1, [point(low - 5, across + 5), point(low + 5, across - 5)]),
    path(operation + 2, [point(high - 5, across + 5), point(high + 5, across - 5)]),
  )
}
function renameDimension(input: Input, index: number, value: number) {
  const label = input.native.labels[index]
  const caption = input.native.compactCaptionGeometry?.items[index]
  if (!label || !caption) throw new Error('Missing fixture dimension')
  label.name = `${value}`
  caption.text = `${value}`
}
afterEach(() => vi.restoreAllMocks())

describe('independent source drawing X/Y scale evidence', () => {
  it('checks both axes and every source span without conversion authority or input changes', () => {
    const input = fixture()
    const before = structuredClone(input)
    const fresh = bindings.nativeCaptionBindings(input)
    expect(fresh.candidates).toHaveLength(4)
    const result = nativeScaleEvidence(input, fresh)
    expect(result).toMatchObject({
      status: 'draft',
      refusalReason: null,
      dimensionToleranceMm: 2,
      axes: [
        {
          axis: 'width',
          status: 'consistent',
          referenceMmPerPoint: 5,
          independentLabelIds: ['native-text-0', 'native-text-1'],
        },
        {
          axis: 'depth',
          status: 'consistent',
          referenceMmPerPoint: 5,
          independentLabelIds: ['native-text-2', 'native-text-3'],
        },
      ],
      commonScale: { status: 'consistent', referenceLabelId: 'native-text-0', mmPerPoint: 5 },
      readOnly: true,
      mayTransfer2D: false,
      mayTransfer3D: false,
    })
    expect(
      result.axes.flatMap((axis) => axis.observations).every((item) => item.residualMm === 0),
    ).toBe(true)
    expect(input).toEqual(before)
  })
  it('requires independent Y evidence rather than copying X scale', () => {
    const input = fixture()
    input.native.labels.splice(2)
    input.native.compactCaptionGeometry?.items.splice(2)
    input.work.paths.splice(6)
    const result = nativeScaleEvidence(input)
    expect(result.axes[0]?.status).toBe('consistent')
    expect(result.axes[1]).toMatchObject({ status: 'insufficient', referenceMmPerPoint: null })
    expect(result.commonScale).toEqual({
      status: 'insufficient',
      referenceLabelId: null,
      mmPerPoint: null,
    })
  })
  it('reports anisotropic axes as a common scale conflict, never applies separate factors', () => {
    const input = fixture()
    renameDimension(input, 2, 1800)
    renameDimension(input, 3, 600)
    const result = nativeScaleEvidence(input)
    expect(result.axes.map((axis) => axis.status)).toEqual(['consistent', 'consistent'])
    expect(result.axes.map((axis) => axis.referenceMmPerPoint)).toEqual([5, 6])
    expect(result.commonScale).toEqual({
      status: 'conflict',
      referenceLabelId: null,
      mmPerPoint: null,
    })
  })
  it('uses physical page points rather than normalized coordinate distances', () => {
    const input = fixture()
    input.work.pageHeight = 2000
    if (!input.native.compactCaptionGeometry) throw new Error('Missing bridge')
    input.native.compactCaptionGeometry.source.pageHeight = 2000
    // Same physical source drawing, different normalized Y page coordinate frame.
    input.work.paths.forEach((path) => {
      path.points.forEach((point) => {
        point.y /= 2
      })
    })
    input.native.labels.forEach((label) => {
      label.point.y /= 2
      if (label.pagePoint) label.pagePoint.y /= 2
    })
    input.native.compactCaptionGeometry.items.forEach((caption) => {
      caption.origin.y = Math.round(caption.origin.y / 2)
      caption.baselineStart.y /= 2
      caption.baselineEnd.y /= 2
    })
    expect(nativeScaleEvidence(input).commonScale).toMatchObject({
      status: 'consistent',
      mmPerPoint: 5,
    })
  })
  it('checks every usable observation rather than selecting a fitted subset', () => {
    const input = fixture()
    addDimension(input, 'width', 650, 700, 450, 270)
    const result = nativeScaleEvidence(input)
    expect(result.axes[0]?.observations).toHaveLength(3)
    expect(result.axes[0]?.status).toBe('conflict')
    expect(result.commonScale.status).toBe('conflict')
    expect(
      result.axes[0]?.observations.find((item) => item.labelId === 'native-text-4')?.residualMm,
    ).toBe(-20)
  })
  it('keeps the longest reference while allowing two shorter disjoint measurements to prove independence', () => {
    const input = fixture()
    addDimension(input, 'width', 50, 650, 650, 3000)
    const result = nativeScaleEvidence(input)
    expect(result.axes[0]).toMatchObject({
      status: 'consistent',
      referenceLabelId: 'native-text-4',
      referenceMmPerPoint: 5,
      independentLabelIds: ['native-text-0', 'native-text-1'],
    })
    expect(result.axes[0]?.observations).toHaveLength(3)
    expect(result.commonScale).toMatchObject({
      status: 'consistent',
      referenceLabelId: 'native-text-4',
      mmPerPoint: 5,
    })
  })
  it('treats 2 mm only as the nominal drawing consistency allowance', () => {
    const input = fixture()
    renameDimension(input, 1, 502)
    expect(nativeScaleEvidence(input).commonScale.status).toBe('consistent')
    renameDimension(input, 1, 503)
    expect(nativeScaleEvidence(input).commonScale.status).toBe('conflict')
  })
  it.each(['duplicate', 'overlapping', 'shared-endpoint'] as const)(
    'does not count %s projected intervals as independent',
    (kind) => {
      const input = fixture()
      input.native.labels.splice(1, 1)
      input.native.compactCaptionGeometry?.items.splice(1, 1)
      input.work.paths.splice(3, 3)
      // Restore extraction's compact bijection after deleting the second X run.
      input.native.labels.forEach((label, index) => {
        label.compactIndex = index
      })
      input.native.compactCaptionGeometry?.items.forEach((caption, index) => {
        caption.index = index
      })
      const low = kind === 'duplicate' ? 100 : kind === 'overlapping' ? 200 : 300
      const high = kind === 'duplicate' ? 300 : 400
      // New operation indices cannot alias the surviving Y rails.
      const maxOperation = Math.max(...input.work.paths.map((path) => path.operationIndex))
      addDimension(input, 'width', low, high, 450, (high - low) * 5)
      input.work.paths.slice(-3).forEach((path, index) => {
        path.operationIndex = maxOperation + 1 + index
      })
      // addDimension derives IDs from count; preserve original native identities.
      const added = input.native.labels.at(-1)
      if (!added) throw new Error('Missing new dimension')
      added.id = 'native-text-4'
      added.nativeIndex = 4
      const result = nativeScaleEvidence(input)
      expect(result.axes[0]?.observations).toHaveLength(2)
      expect(result.axes[0]?.status).toBe('insufficient')
      expect(result.axes[0]?.independentLabelIds).toEqual([])
      expect(result.commonScale.status).toBe('insufficient')
    },
  )
  it('chooses reference deterministically despite input and cached report order', () => {
    const input = fixture()
    const fresh = bindings.nativeCaptionBindings(input)
    const expected = nativeScaleEvidence(input)
    input.work.paths.reverse()
    input.native.labels.reverse()
    input.native.compactCaptionGeometry?.items.reverse()
    fresh.candidates.reverse()
    expect(nativeScaleEvidence(input, fresh)).toEqual(expected)
  })
  it.each(['value', 'ends', 'source', 'flags'] as const)(
    'refuses stale supplied %s instead of trusting it',
    (kind) => {
      const input = fixture()
      const supplied = bindings.nativeCaptionBindings(input)
      const candidate = supplied.candidates[0]
      if (!candidate) throw new Error('Missing candidate')
      if (kind === 'value') candidate.valueMm++
      if (kind === 'ends') candidate.spanEnds[0].x += 1e-9
      if (kind === 'source') supplied.source.sha256 = 'c'.repeat(64)
      if (kind === 'flags') Object.assign(supplied, { mayTransfer2D: true })
      expect(nativeScaleEvidence(input, supplied).refusalReason).toBe(
        'stale-source-caption-bindings',
      )
    },
  )
  it.each(['hash', 'visibility', 'frame', 'glyph'] as const)(
    'holds unverified %s source evidence',
    (kind) => {
      const input = fixture()
      if (kind === 'hash') input.source.sha256 = 'c'.repeat(64)
      if (kind === 'visibility')
        input.native.vectorInkRefusal = 'hidden-native-vector-optional-content'
      if (kind === 'frame') input.lineworkSource.width = 1200
      if (kind === 'glyph') {
        const caption = input.native.compactCaptionGeometry?.items[0]
        if (!caption) throw new Error('Missing caption')
        caption.inkRefusal = 'native-glyph-ink-unavailable'
      }
      expect(nativeScaleEvidence(input)).toMatchObject({
        status: 'unresolved',
        commonScale: { status: 'insufficient', mmPerPoint: null },
      })
    },
  )
  it('excludes oblique observations with an explicit reason', () => {
    const input = fixture()
    const fresh = bindings.nativeCaptionBindings(input)
    const candidate = fresh.candidates[0]
    if (!candidate) throw new Error('Missing candidate')
    candidate.axis = 'aligned'
    candidate.angleDegrees = 30
    vi.spyOn(bindings, 'nativeCaptionBindings').mockReturnValue(fresh)
    const result = nativeScaleEvidence(input)
    expect(result.unresolved).toContainEqual({
      labelId: candidate.labelId,
      reason: 'scale-evidence-noncardinal-dimension',
    })
    expect(result.axes[0]?.observations).toHaveLength(1)
    expect(result.commonScale.status).toBe('insufficient')
  })
  it.each(['angle', 'span', 'zero'] as const)(
    'never projects invalid cardinal %s geometry',
    (kind) => {
      const input = fixture()
      const fresh = bindings.nativeCaptionBindings(input)
      const candidate = fresh.candidates[0]
      if (!candidate) throw new Error('Missing candidate')
      if (kind === 'angle') candidate.angleDegrees = 0.3
      if (kind === 'span') candidate.spanEnds[1].y += 1e-9
      if (kind === 'zero') candidate.spanEnds[1] = { ...candidate.spanEnds[0] }
      vi.spyOn(bindings, 'nativeCaptionBindings').mockReturnValue(fresh)
      expect(nativeScaleEvidence(input).refusalReason).toBe('invalid-source-cardinal-scale-span')
    },
  )
  it('clears accumulated observations and held labels atomically on source refusal', () => {
    const input = fixture()
    const fresh = bindings.nativeCaptionBindings(input)
    const candidate = fresh.candidates[3]
    if (!candidate) throw new Error('Missing candidate')
    candidate.spanEnds[1].x += 1e-9
    fresh.unresolved.push({ labelId: 'native-text-99', reason: 'caption-rail-unresolved' })
    vi.spyOn(bindings, 'nativeCaptionBindings').mockReturnValue(fresh)
    expect(nativeScaleEvidence(input)).toMatchObject({
      status: 'unresolved',
      axes: [],
      unresolved: [],
      commonScale: { status: 'insufficient', referenceLabelId: null, mmPerPoint: null },
    })
  })
  it('preserves source-held labels rather than claiming complete page calibration', () => {
    const input = fixture()
    const fresh = bindings.nativeCaptionBindings(input)
    fresh.unresolved.push({ labelId: 'native-text-99', reason: 'caption-rail-unresolved' })
    vi.spyOn(bindings, 'nativeCaptionBindings').mockReturnValue(fresh)
    const result = nativeScaleEvidence(input)
    expect(result.commonScale.status).toBe('consistent')
    expect(result.unresolved).toEqual([
      { labelId: 'native-text-99', reason: 'caption-rail-unresolved' },
    ])
    expect(result.mayTransfer2D).toBe(false)
  })
  it('bounds untrusted input before rebuilding source proof', () => {
    const input = fixture()
    const label = input.native.labels[0]
    if (!label) throw new Error('Missing fixture label')
    input.native.labels = Array.from({ length: 1001 }, () => structuredClone(label))
    const spy = vi.spyOn(bindings, 'nativeCaptionBindings')
    expect(nativeScaleEvidence(input)).toMatchObject({
      refusalReason: 'scale-evidence-input-limit',
      axes: [],
    })
    expect(spy).not.toHaveBeenCalled()
  })
  it('bounds supplied snapshots without clearing or mutating them', () => {
    const input = fixture()
    const supplied = bindings.nativeCaptionBindings(input)
    const candidate = supplied.candidates[0]
    if (!candidate) throw new Error('Missing candidate')
    supplied.candidates = Array.from({ length: 1001 }, () => structuredClone(candidate))
    const before = structuredClone(supplied)
    expect(nativeScaleEvidence(input, supplied).refusalReason).toBe('scale-evidence-input-limit')
    expect(supplied).toEqual(before)
  })
})
