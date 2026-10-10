import { describe, expect, it } from 'vitest'
import { nativeAnnotationFixture } from '../../scripts/qa-native-annotation-fixture'
import { nativeReviewPacket } from './plan-native-review-packet'
import {
  connectedNativeRoomFixture,
  numberedNativeRoomFixture,
} from './test-fixtures/native-numbered-rooms'

function fixture() {
  const input = nativeAnnotationFixture()
  return { ...input, source: input.reviewed.source, image: input.native.source }
}
describe('whole-page native inspection, separate from saved geometry', () => {
  function savedReading(): PlanReading {
    const input = fixture()
    const polygon = input.work.paths[0]?.points
    if (!polygon) throw new Error('Missing native polygon')
    return {
      readAt: '2026-10-09',
      sourcePage: input.source.pdfPage,
      planState: 'existing',
      rooms: [{ sourceNumber: 1, name: 'Гостиная', kind: 'living' }],
      pageReview: {
        version: 1,
        savedAt: '2026-10-09',
        contours: {
          source: { ...input.source },
          coordinateSystem: 'page-0-1000',
          review: 'manual-source-review',
          pageWidth: input.work.pageWidth,
          pageHeight: input.work.pageHeight,
          rooms: [{ roomSourceNumber: 1, polygon: structuredClone(polygon) }],
        },
      },
    }
  }
  it('checks only saved manual contours and leaves both reading and source unchanged', () => {
    const input = { ...fixture(), savedReading: savedReading() }
    const before = structuredClone(input)
    const packet = nativeReviewPacket(input)
    expect(packet.savedReview).toMatchObject({
      status: 'checked',
      coverage: {
        status: 'partial',
        floorBoundary: 'missing',
        readiness: { readOnly: true, readyFor2D: false, readyFor3D: false },
      },
    })
    expect(input).toEqual(before)
    expect(packet.savedReview).not.toHaveProperty('contours')
    if (packet.savedReview.status !== 'checked') throw new Error('Missing coverage')
    expect(packet.savedReview.coverage).not.toHaveProperty('reviewSpans')
    expect(nativeReviewPacket(fixture()).savedReview).toEqual({ status: 'not-saved' })
  })
  it('distinguishes saved review with missing native layer from no saved review', () => {
    const input = fixture()
    const packet = nativeReviewPacket({
      source: input.source,
      image: input.image,
      savedReading: savedReading(),
    })
    expect(packet.savedReview).toEqual({
      status: 'unavailable',
      reason: 'native-layer-unavailable',
    })
  })
  it('shows refusal for stale saved contours instead of combining different PDFs', () => {
    const input = { ...fixture(), savedReading: savedReading() }
    if (!input.savedReading.pageReview) throw new Error('Missing review')
    input.savedReading.pageReview.contours.source.sha256 = 'c'.repeat(64)
    expect(nativeReviewPacket(input).savedReview).toMatchObject({
      status: 'checked',
      coverage: { status: 'refused', refusalReason: 'different-plan-source' },
    })
  })
  it('aggregates only same-source candidates without creating a confirmed plan', () => {
    const input = fixture(),
      before = structuredClone(input)
    const result = nativeReviewPacket(input)
    expect(result.version).toBe(1)
    expect(result.readiness).toEqual({ readyFor2D: false, readyFor3D: false, readOnly: true })
    expect(result.counts.printedDimensions).toBe(1)
    expect(result.issues.map((issue) => issue.code)).toContain('floor-boundaries-unreviewed')
    expect(result).not.toHaveProperty('footprint')
    expect(result).not.toHaveProperty('pageReview')
    expect(JSON.stringify(result)).not.toContain('manual-native-annotation-review')
    expect(input).toEqual(before)
  })
  it('maps source swings and painted jamb frames to pixels without authorizing floor closure', () => {
    const input = fixture()
    input.work.paths.push(
      {
        operationIndex: 40,
        subpathIndex: 0,
        paint: 'stroke',
        closed: false,
        points: [
          { x: 100, y: 100 },
          { x: 200, y: 100 },
        ],
      },
      {
        operationIndex: 41,
        subpathIndex: 0,
        paint: 'stroke',
        closed: true,
        points: [
          { x: 100, y: 100 },
          { x: 120, y: 100 },
          { x: 120, y: 200 },
          { x: 100, y: 200 },
        ],
      },
    )
    for (const [operationIndex, y] of [
      [42, 100],
      [43, 200],
    ] as const)
      input.work.paths.push({
        operationIndex,
        subpathIndex: 0,
        paint: 'stroke',
        closed: true,
        points: [
          { x: 80, y },
          { x: 140, y },
          { x: 140, y: y - 10 },
          { x: 130, y: y - 10 },
          { x: 130, y: y - 20 },
          { x: 80, y: y - 20 },
        ],
      })
    const k = (4 / 3) * Math.tan(Math.PI / 8) * 100
    input.work.curvePaths = [
      {
        operationIndex: 44,
        subpathIndex: 0,
        operationSubpathCount: 1,
        paint: 'stroke',
        closed: false,
        start: { x: 200, y: 100 },
        segments: [
          {
            kind: 'cubic',
            control1: { x: 200, y: 100 + k },
            control2: { x: 100 + k, y: 200 },
            end: { x: 100, y: 200 },
          },
        ],
      },
    ]
    input.work.skippedCurves = 1
    input.work.skippedCurveBounds = [
      { operationIndex: 44, bounds: { left: 100, top: 100, right: 200, bottom: 200 } },
    ]
    const before = structuredClone(input)
    const packet = nativeReviewPacket(input)
    expect(packet.doorSymbols).toMatchObject({
      status: 'draft',
      refusalReason: null,
      candidates: [
        {
          id: 'native-door-symbol-44:0',
          arc: { start: { x: 200, y: 100 } },
          leaf: { start: { x: 100, y: 100 }, end: { x: 200, y: 100 } },
          endpointResidualPixels: 0,
        },
      ],
    })
    expect(packet.openingFrames).toMatchObject({
      status: 'draft',
      refusalReason: null,
      candidates: [{ id: 'native-opening-frame-41:0' }],
    })
    expect(packet.extraction.skippedCurves).toBe(1)
    expect(packet.extraction.geometryComplete).toBe(false)
    expect(packet.readiness).toEqual({ readyFor2D: false, readyFor3D: false, readOnly: true })
    expect(packet.doorSymbols?.candidates[0]).not.toHaveProperty('closedTip')
    expect(packet.openingFrames?.candidates[0]).not.toHaveProperty('jambs')
    expect(packet).not.toHaveProperty('floor')
    expect(input).toEqual(before)
  })
  it('shows exact numbered unfilled outlines in the read-only source overlay', () => {
    const input = numberedNativeRoomFixture()
    input.work.paths = input.work.paths.map((path) => ({ ...path, paint: 'stroke' }))
    const before = structuredClone(input)
    const packet = nativeReviewPacket({
      ...input,
      source: { sha256: input.native.originalPdfSha256 as string, pdfPage: 1, state: 'existing' },
      image: input.native.source,
    })
    expect(packet.counts.numberedAssociations).toBe(3)
    expect(packet.counts.fillCandidates).toBe(0)
    expect(packet.faces.filter((face) => face.roomName).map((face) => face.roomName)).toEqual([
      'Спальня',
      'Спальня',
      'Балкон',
    ])
    expect(packet.faces.every((face) => face.layer === 'stroke')).toBe(true)
    expect(packet.faces[2]?.polygon).toEqual(
      input.work.paths.find((path) => path.operationIndex === 3)?.points,
    )
    expect(packet.readiness).toEqual({ readyFor2D: false, readyFor3D: false, readOnly: true })
    expect(packet).not.toHaveProperty('pageReview')
    expect(input).toEqual(before)
  })
  it('shows actual glazing bodies, endcaps and centerline without creating a window or floor', () => {
    const input = fixture()
    const polygons = [
      [
        { x: 100, y: 100 },
        { x: 200, y: 100 },
        { x: 200, y: 105 },
        { x: 100, y: 105 },
      ],
      [
        { x: 95, y: 100 },
        { x: 100, y: 100 },
        { x: 100, y: 105 },
        { x: 95, y: 105 },
      ],
      [
        { x: 200, y: 100 },
        { x: 205, y: 100 },
        { x: 205, y: 105 },
        { x: 200, y: 105 },
      ],
    ]
    for (const [index, points] of polygons.entries())
      input.work.paths.push({
        operationIndex: 80 + index,
        subpathIndex: 0,
        paint: 'stroke',
        closed: true,
        points,
      })
    input.work.paths.push({
      operationIndex: 83,
      subpathIndex: 0,
      paint: 'stroke',
      closed: false,
      points: [
        { x: 100, y: 102.5 },
        { x: 200, y: 102.5 },
      ],
    })
    const before = structuredClone(input)
    const packet = nativeReviewPacket(input)
    expect(packet.glazingSymbols).toEqual({
      status: 'draft',
      refusalReason: null,
      candidates: [
        {
          id: 'native-glazing-symbol-80:0',
          polygons,
          centerline: { start: { x: 100, y: 102.5 }, end: { x: 200, y: 102.5 } },
        },
      ],
    })
    expect(packet.readiness).toEqual({ readyFor2D: false, readyFor3D: false, readOnly: true })
    expect(packet).not.toHaveProperty('floor')
    expect(packet.glazingSymbols?.candidates[0]).not.toHaveProperty('openingKind')
    expect(input).toEqual(before)
    // Competing source centerlines cannot silently become a guessed glazing candidate.
    const centerline = input.work.paths.at(-1)
    if (!centerline) throw new Error('Missing source centerline fixture')
    input.work.paths.push({ ...structuredClone(centerline), operationIndex: 84 })
    expect(nativeReviewPacket(input).glazingSymbols?.candidates).toEqual([])
  })
  it('reports unavailable panel search explicitly without inventing fallback geometry', () => {
    const input = fixture()
    // No curve-command layer is needed for glazing, but incomplete source geometry
    // still holds both new profiles and the old openings; no fallback invents a panel.
    input.work.unsupportedContexts = 1
    const packet = nativeReviewPacket(input)
    expect(packet.glazingSymbols).toEqual({
      status: 'unresolved',
      refusalReason: 'incomplete-native-layer',
      candidates: [],
    })
    expect(packet.issues.some((issue) => issue.code.startsWith('panel-profile-search:'))).toBe(true)
    expect(packet.readiness.readOnly).toBe(true)
  })
  it('shows shared-wall source candidates without erasing frames or approving a floor', () => {
    const input = connectedNativeRoomFixture()
    const before = structuredClone(input)
    const packet = nativeReviewPacket({
      ...input,
      source: { sha256: input.native.originalPdfSha256 as string, pdfPage: 1, state: 'existing' },
      image: input.native.source,
    })
    expect(packet.counts.numberedAssociations).toBe(3)
    expect(packet.faces.filter((face) => face.roomName)).toHaveLength(3)
    expect(packet.faces.find((face) => face.roomName === 'Спальня')?.polygon).toEqual([
      { x: 50, y: 50 },
      { x: 275, y: 50 },
      { x: 275, y: 300 },
      { x: 50, y: 300 },
    ])
    expect(packet.readiness).toEqual({ readOnly: true, readyFor2D: false, readyFor3D: false })
    expect(input).toEqual(before)
  })
  it('withholds an oversized overlay instead of serializing or silently truncating 103 shapes', () => {
    const input = numberedNativeRoomFixture()
    input.work.paths = input.work.paths.map((path) => ({
      ...path,
      paint: path.paint === 'fill' ? 'fill-stroke' : path.paint,
    }))
    for (let index = 0; index < 47; index++)
      input.work.paths.push({
        operationIndex: 500 + index,
        subpathIndex: 0,
        paint: 'fill',
        closed: true,
        points: [
          { x: 500 + index / 100, y: 600 },
          { x: 600, y: 600 },
          { x: 600, y: 700 },
          { x: 500 + index / 100, y: 700 },
        ],
      })
    for (let column = 0; column <= 5; column++)
      input.work.paths.push({
        operationIndex: 600 + column,
        subpathIndex: 0,
        paint: 'stroke',
        closed: false,
        points: [
          { x: 50 + column * 60, y: 450 },
          { x: 50 + column * 60, y: 850 },
        ],
      })
    for (let row = 0; row <= 10; row++)
      input.work.paths.push({
        operationIndex: 700 + row,
        subpathIndex: 0,
        paint: 'stroke',
        closed: false,
        points: [
          { x: 50, y: 450 + row * 40 },
          { x: 350, y: 450 + row * 40 },
        ],
      })
    // This legacy localized-omission path does not run the complete-layer face expansion.
    input.work.skippedCurves = 1
    input.work.skippedCurveBounds = [
      {
        operationIndex: 900,
        bounds: { left: 900, top: 900, right: 910, bottom: 910 },
      },
    ]
    const packet = nativeReviewPacket({
      ...input,
      source: { sha256: input.native.originalPdfSha256 as string, pdfPage: 1, state: 'existing' },
      image: input.native.source,
    })
    expect(packet.counts.fillCandidates).toBe(50)
    expect(packet.counts.strokeFaces).toBe(53)
    expect(packet.counts.numberedAssociations).toBe(3)
    expect(packet.status).toBe('unresolved')
    expect(packet.faces).toEqual([])
    expect(packet.issues.map((issue) => issue.code)).toContain('native-overlay-limit')
    expect(packet.readiness.readyFor2D).toBe(false)
  })
  it('explains unavailable native layers rather than treating zero candidates as complete', () => {
    const input = fixture()
    const result = nativeReviewPacket({ source: input.source, image: input.image })
    expect(result.status).toBe('unresolved')
    expect(result.faces).toEqual([])
    expect(result.issues[0]?.code).toBe('native-layers-unavailable')
  })
  it('preserves localized omitted curves as an incompleteness blocker', () => {
    const input = fixture()
    input.work.skippedCurves = 1
    input.work.skippedCurveBounds = [
      { operationIndex: 1000, bounds: { left: 900, right: 950, top: 900, bottom: 950 } },
    ]
    const result = nativeReviewPacket(input)
    expect(result.status).toBe('unresolved')
    expect(result.extraction.geometryComplete).toBe(false)
    expect(result.issues.map((issue) => issue.code)).toContain('native-geometry-incomplete')
  })
  it.each(['pdf', 'raster', 'page', 'state'])(
    'rejects mismatched %s evidence instead of composing different sources',
    (kind) => {
      const input = fixture()
      if (kind === 'pdf') input.source = { ...input.source, sha256: 'c'.repeat(64) }
      if (kind === 'raster') input.image = { ...input.image, sha256: 'c'.repeat(64) }
      if (kind === 'page') input.source = { ...input.source, pdfPage: 2 }
      if (kind === 'state') input.source = { ...input.source, state: 'proposed' as 'existing' }
      expect(() => nativeReviewPacket(input)).toThrow()
    },
  )
})

import type { PlanReading } from '@uyut/db'
