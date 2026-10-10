import { createHash } from 'node:crypto'
import { describe, expect, it, vi } from 'vitest'
import { loadNativeReview } from './plan-native-review-client'
import { type NativeReviewPacket, nativeReviewPacket } from './plan-native-review-packet'
import { inspectReviewedPageCoverage } from './plan-page-reviewed-coverage'

const body = 'private jpeg test bytes',
  imageHash = createHash('sha256').update(body).digest('hex'),
  revision = 'c'.repeat(64)
function fixture() {
  const packet = {
    ...nativeReviewPacket({
      source: { sha256: 'b'.repeat(64), pdfPage: 1, state: 'existing' },
      image: { sha256: imageHash, page: 1, width: 1000, height: 1000 },
    }),
    sourceRevision: revision,
  }
  const headers = {
    'content-type': 'image/jpeg',
    'x-plan-sha256': packet.source.sha256,
    'x-plan-image-sha256': imageHash,
    'x-plan-page': '1',
    'x-plan-image-width': '1000',
    'x-plan-image-height': '1000',
  }
  return { packet, headers }
}
const input = () => ({
  projectId: 'private-project',
  page: 1,
  revision,
  signal: new AbortController().signal,
})
function doorSymbols(): NonNullable<NativeReviewPacket['doorSymbols']> {
  return {
    status: 'draft',
    refusalReason: null,
    candidates: [
      {
        id: 'native-door-symbol-1:0',
        arc: {
          start: { x: 50, y: 100 },
          segments: [
            {
              control1: { x: 50, y: 72.386 },
              control2: { x: 72.386, y: 50 },
              end: { x: 100, y: 50 },
            },
          ],
        },
        leaf: { start: { x: 100, y: 100 }, end: { x: 50, y: 100 } },
        endpointResidualPixels: 0.083,
      },
    ],
  }
}
function openingFrames(): NonNullable<NativeReviewPacket['openingFrames']> {
  return {
    status: 'draft',
    refusalReason: null,
    candidates: [
      {
        id: 'native-opening-frame-1:0',
        polygon: [
          { x: 30, y: 40 },
          { x: 100, y: 40 },
          { x: 100, y: 50 },
          { x: 30, y: 50 },
        ],
      },
    ],
  }
}
function glazingSymbols(): NonNullable<NativeReviewPacket['glazingSymbols']> {
  const rectangle = (left: number, top: number, right: number, bottom: number) => [
    { x: left, y: top },
    { x: right, y: top },
    { x: right, y: bottom },
    { x: left, y: bottom },
  ]
  return {
    status: 'draft',
    refusalReason: null,
    candidates: [
      {
        id: 'native-glazing-symbol-1:0',
        polygons: [
          rectangle(30, 40, 100, 50),
          rectangle(30, 38, 35, 52),
          rectangle(95, 38, 100, 52),
        ],
        centerline: { start: { x: 30, y: 45 }, end: { x: 100, y: 45 } },
      },
    ],
  }
}
function cappedDoorSymbols(): NonNullable<NativeReviewPacket['doorSymbols']> {
  const symbols = doorSymbols()
  const symbol = symbols.candidates[0]
  if (!symbol) throw new Error('Door symbol fixture is missing')
  Object.assign(symbol, {
    leafProfile: 'capped-panel',
    swingAngleDegrees: 85,
    leafParts: [
      { start: { x: 100, y: 100 }, end: { x: 100, y: 103 } },
      { start: { x: 50, y: 103 }, end: { x: 100, y: 103 } },
      { start: { x: 50, y: 103 }, end: { x: 50, y: 100 } },
    ],
  })
  return symbols
}

function loadFixture(packet: NativeReviewPacket, headers: Record<string, string>) {
  const fetcher = vi.fn(async (url: string) =>
    url.includes('native-review-image') ? new Response(body, { headers }) : Response.json(packet),
  )
  return loadNativeReview(input(), fetcher as typeof fetch)
}

describe('atomic private native image/packet loading', () => {
  function coveredFixture() {
    const result = fixture()
    const polygon = [
      { x: 10, y: 10 },
      { x: 100, y: 10 },
      { x: 100, y: 100 },
    ]
    const { reviewSpans: _reviewSpans, ...coverage } = inspectReviewedPageCoverage({
      source: result.packet.source,
      reading: {
        readAt: '2026-10-09',
        sourcePage: 1,
        planState: 'existing',
        rooms: [{ sourceNumber: 1, name: 'Комната', kind: 'living' }],
      },
      contours: {
        source: result.packet.source,
        coordinateSystem: 'page-0-1000',
        review: 'manual-source-review',
        pageWidth: 1000,
        pageHeight: 1000,
        rooms: [{ roomSourceNumber: 1, polygon }],
      },
      linework: {
        coordinateSystem: 'page-0-1000',
        pageWidth: 1000,
        pageHeight: 1000,
        paths: [
          { operationIndex: 1, subpathIndex: 0, paint: 'stroke', closed: true, points: polygon },
        ],
        skippedCurves: 0,
        clippedPaths: 0,
        unsupportedPaths: 0,
        unsupportedContexts: 0,
        truncated: false,
      },
    })
    result.packet.savedReview = { status: 'checked', coverage }
    return { ...result, coverage }
  }
  it('returns saved review coverage only in the same verified private image pair', async () => {
    const { packet, headers } = coveredFixture()
    const fetcher = vi.fn(async (url: string) =>
      url.includes('native-review-image') ? new Response(body, { headers }) : Response.json(packet),
    )
    const result = await loadNativeReview(input(), fetcher as typeof fetch)
    expect(result.packet.savedReview).toMatchObject({
      status: 'checked',
      coverage: { status: 'partial', readiness: { readyFor2D: false, readyFor3D: false } },
    })
  })
  it.each([
    'source',
    'page',
    'state',
    'promotion',
    'status',
    'counts',
    'spans',
    'floor-role',
    'issues',
    'missing',
    'null',
  ])('rejects malformed saved coverage %s before displaying source pixels', async (change) => {
    const { packet, headers, coverage } = coveredFixture()
    if (change === 'source') coverage.source.sha256 = 'd'.repeat(64)
    if (change === 'page') coverage.source.pdfPage = 2
    if (change === 'state') coverage.source.state = 'proposed' as 'existing'
    if (change === 'promotion') coverage.readiness.readyFor3D = true as false
    if (change === 'status') coverage.status = 'accepted' as 'partial'
    if (change === 'counts') coverage.openings.pairedDoorFaces = 1
    if (change === 'spans') Object.assign(coverage, { reviewSpans: [] })
    if (change === 'floor-role') coverage.floorBoundary = 'confirmed' as 'missing'
    if (change === 'issues') coverage.issues = ['x'.repeat(129)]
    if (change === 'missing') delete (packet as Partial<typeof packet>).savedReview
    if (change === 'null')
      packet.savedReview = { status: 'checked', coverage: null as unknown as typeof coverage }
    const fetcher = vi.fn(async (url: string) =>
      url.includes('native-review-image') ? new Response(body, { headers }) : Response.json(packet),
    )
    await expect(loadNativeReview(input(), fetcher as typeof fetch)).rejects.toMatchObject({
      status: 422,
    })
  })
  it('fetches both channels without saving, and checks actual private image bytes', async () => {
    const { packet, headers } = fixture()
    const fetcher = vi.fn(async (url: string) =>
      url.includes('native-review-image') ? new Response(body, { headers }) : Response.json(packet),
    )
    const result = await loadNativeReview(input(), fetcher as typeof fetch)
    expect(result.packet.doorSymbols).toBeUndefined()
    expect(result.packet.openingFrames).toBeUndefined()
    expect(result.packet.glazingSymbols).toBeUndefined()
    expect(result.packet.image.sha256).toBe(imageHash)
    expect(await result.image.text()).toBe(body)
    expect(fetcher).toHaveBeenCalledTimes(2)
    expect(
      fetcher.mock.calls.every(([url]) => url.includes('/api/projects/private-project/plan-page?')),
    ).toBe(true)
  })
  it('preserves bounded optional source curves without changing readiness', async () => {
    const { packet, headers } = fixture()
    packet.doorSymbols = doorSymbols()
    const symbol = packet.doorSymbols.candidates[0]
    if (!symbol) throw new Error('Door symbol fixture is missing')
    symbol.id = 'd'.repeat(128)
    symbol.endpointResidualPixels = 0.1
    symbol.arc.segments.push(...structuredClone(symbol.arc.segments), {
      control1: { x: 0, y: 0 },
      control2: { x: 1000, y: 1000 },
      end: { x: 100, y: 50 },
    })
    const fetcher = vi.fn(async (url: string) =>
      url.includes('native-review-image') ? new Response(body, { headers }) : Response.json(packet),
    )
    const result = await loadNativeReview(input(), fetcher as typeof fetch)
    expect(result.packet.doorSymbols).toEqual(packet.doorSymbols)
    expect(result.packet.readiness).toEqual({
      readOnly: true,
      readyFor2D: false,
      readyFor3D: false,
    })
  })
  it.each(['draft', 'unresolved'] as const)('accepts an empty %s symbol search', async (status) => {
    const { packet, headers } = fixture()
    packet.doorSymbols = {
      status,
      refusalReason: status === 'unresolved' ? 'curve-commands-unavailable' : null,
      candidates: [],
    }
    const fetcher = vi.fn(async (url: string) =>
      url.includes('native-review-image') ? new Response(body, { headers }) : Response.json(packet),
    )
    expect((await loadNativeReview(input(), fetcher as typeof fetch)).packet.doorSymbols).toEqual(
      packet.doorSymbols,
    )
  })
  it.each([4, 5])('preserves the %i source frame points without promotion', async (points) => {
    const { packet, headers } = fixture()
    packet.openingFrames = openingFrames()
    const frame = packet.openingFrames.candidates[0]
    if (!frame) throw new Error('Opening frame fixture is missing')
    if (points === 5) frame.polygon.push({ x: 30, y: 40 })
    const fetcher = vi.fn(async (url: string) =>
      url.includes('native-review-image') ? new Response(body, { headers }) : Response.json(packet),
    )
    const result = await loadNativeReview(input(), fetcher as typeof fetch)
    expect(result.packet.openingFrames).toEqual(packet.openingFrames)
    expect(result.packet.readiness.readyFor2D).toBe(false)
    expect(result.packet.readiness.readyFor3D).toBe(false)
  })
  it('accepts a bounded refusal of the frame search without a partial candidate list', async () => {
    const { packet, headers } = fixture()
    packet.openingFrames = {
      status: 'unresolved',
      refusalReason: 'frame-search-budget',
      candidates: [],
    }
    const fetcher = vi.fn(async (url: string) =>
      url.includes('native-review-image') ? new Response(body, { headers }) : Response.json(packet),
    )
    expect((await loadNativeReview(input(), fetcher as typeof fetch)).packet.openingFrames).toEqual(
      packet.openingFrames,
    )
  })
  it.each([4, 5])('preserves all %i source points of each glazing polygon', async (points) => {
    const { packet, headers } = fixture()
    packet.glazingSymbols = glazingSymbols()
    const candidate = packet.glazingSymbols.candidates[0]
    if (!candidate) throw new Error('Glazing fixture is missing')
    if (points === 5) {
      for (const polygon of candidate.polygons) {
        const first = polygon[0]
        if (!first) throw new Error('Glazing polygon fixture is missing')
        polygon.push({ ...first })
      }
    }
    const result = await loadFixture(packet, headers)
    expect(result.packet.glazingSymbols).toEqual(packet.glazingSymbols)
    expect(result.packet.readiness).toEqual({
      readOnly: true,
      readyFor2D: false,
      readyFor3D: false,
    })
  })
  it.each(['draft', 'unresolved'] as const)('accepts an empty %s glazing layer', async (status) => {
    const { packet, headers } = fixture()
    packet.glazingSymbols = {
      status,
      refusalReason: status === 'unresolved' ? 'glazing-search-budget' : null,
      candidates: [],
    }
    expect((await loadFixture(packet, headers)).packet.glazingSymbols).toEqual(
      packet.glazingSymbols,
    )
  })
  it('accepts exactly 100 glazing candidates without accepting their physical kind', async () => {
    const { packet, headers } = fixture()
    const symbols = glazingSymbols()
    const candidate = symbols.candidates[0]
    if (!candidate) throw new Error('Glazing fixture is missing')
    symbols.candidates = Array.from({ length: 100 }, (_, i) => ({
      ...candidate,
      id: `glazing-${i}`,
    }))
    packet.glazingSymbols = symbols
    expect((await loadFixture(packet, headers)).packet.glazingSymbols?.candidates).toHaveLength(100)
  })
  it.each([
    'null-layer',
    'status',
    'draft-reason',
    'partial-refusal',
    'blank-reason',
    'long-reason',
    'missing-candidates',
    'candidate-limit',
    'null-candidate',
    'blank-id',
    'long-id',
    'duplicate-id',
    'missing-polygons',
    'missing-group-member',
    'extra-group-member',
    'null-polygon',
    'too-few-points',
    'too-many-points',
    'null-point',
    'outside-image',
    'nonfinite-point',
    'repeated-vertex',
    'fifth-endpoint',
    'missing-centerline',
    'missing-centerline-end',
    'nonfinite-centerline',
    'outside-centerline',
    'string-centerline',
    'zero-centerline',
  ])('rejects malformed glazing metadata atomically: %s', async (change) => {
    const { packet, headers } = fixture()
    const symbols = glazingSymbols()
    packet.glazingSymbols = symbols
    const candidate = symbols.candidates[0]
    const polygon = candidate?.polygons[0]
    const first = polygon?.[0]
    if (!candidate || !polygon || !first) throw new Error('Glazing fixture is missing')
    if (change === 'null-layer') Object.assign(packet, { glazingSymbols: null })
    if (change === 'status') Object.assign(symbols, { status: 'accepted' })
    if (change === 'draft-reason') symbols.refusalReason = 'glazing-search-budget'
    if (change === 'partial-refusal')
      Object.assign(symbols, { status: 'unresolved', refusalReason: 'glazing-search-budget' })
    if (change === 'blank-reason')
      Object.assign(symbols, { status: 'unresolved', refusalReason: ' ', candidates: [] })
    if (change === 'long-reason')
      Object.assign(symbols, {
        status: 'unresolved',
        refusalReason: 'x'.repeat(129),
        candidates: [],
      })
    if (change === 'missing-candidates') Object.assign(symbols, { candidates: null })
    if (change === 'candidate-limit')
      symbols.candidates = Array.from({ length: 101 }, (_, i) => ({ ...candidate, id: String(i) }))
    if (change === 'null-candidate') Object.assign(symbols, { candidates: [null] })
    if (change === 'blank-id') candidate.id = ' '
    if (change === 'long-id') candidate.id = 'x'.repeat(129)
    if (change === 'duplicate-id') symbols.candidates.push(structuredClone(candidate))
    if (change === 'missing-polygons') Object.assign(candidate, { polygons: null })
    if (change === 'missing-group-member') candidate.polygons.pop()
    if (change === 'extra-group-member') candidate.polygons.push(structuredClone(polygon))
    if (change === 'null-polygon') Object.assign(candidate.polygons, { 1: null })
    if (change === 'too-few-points') polygon.pop()
    if (change === 'too-many-points') polygon.push({ ...first }, { x: 31, y: 40 })
    if (change === 'null-point') Object.assign(polygon, { 0: null })
    if (change === 'outside-image') first.x = -1
    if (change === 'nonfinite-point') first.x = Infinity
    if (change === 'repeated-vertex') polygon[3] = { ...first }
    if (change === 'fifth-endpoint') polygon.push({ x: 31, y: 40 })
    if (change === 'missing-centerline') Object.assign(candidate, { centerline: null })
    if (change === 'missing-centerline-end') Object.assign(candidate.centerline, { end: null })
    if (change === 'nonfinite-centerline') candidate.centerline.start.y = NaN
    if (change === 'outside-centerline') candidate.centerline.end.x = 1001
    if (change === 'string-centerline') Object.assign(candidate.centerline.start, { x: '30' })
    if (change === 'zero-centerline') candidate.centerline.end = { ...candidate.centerline.start }
    await expect(loadFixture(packet, headers)).rejects.toMatchObject({ status: 422 })
  })
  it.each([80, 85, 100])(
    'accepts a capped source leaf at %i degrees with mixed segment directions',
    async (angle) => {
      const { packet, headers } = fixture()
      packet.doorSymbols = cappedDoorSymbols()
      const symbol = packet.doorSymbols.candidates[0]
      if (!symbol) throw new Error('Door symbol fixture is missing')
      symbol.swingAngleDegrees = angle
      expect((await loadFixture(packet, headers)).packet.doorSymbols).toEqual(packet.doorSymbols)
    },
  )
  it.each([89.72, 90, 90.28])(
    'accepts a single source leaf at %s degrees without capped parts',
    async (angle) => {
      const { packet, headers } = fixture()
      packet.doorSymbols = doorSymbols()
      const symbol = packet.doorSymbols.candidates[0]
      if (!symbol) throw new Error('Door symbol fixture is missing')
      symbol.leafProfile = 'single-stroke'
      symbol.swingAngleDegrees = angle
      expect((await loadFixture(packet, headers)).packet.doorSymbols).toEqual(packet.doorSymbols)
    },
  )
  it.each([
    'profile-only',
    'angle-only',
    'parts-only',
    'unknown-profile',
    'nonfinite-angle',
    'string-angle',
    'capped-angle-low',
    'capped-angle-high',
    'missing-parts',
    'null-parts',
    'short-parts',
    'long-parts',
    'null-part',
    'missing-part-start',
    'missing-part-end',
    'outside-part',
    'nonfinite-part',
    'zero-part',
    'single-with-parts',
    'single-angle-low',
    'single-angle-high',
    'single-zero-leaf',
  ])('rejects incomplete or malformed new door profiles: %s', async (change) => {
    const { packet, headers } = fixture()
    packet.doorSymbols = cappedDoorSymbols()
    const symbol = packet.doorSymbols.candidates[0]
    const part = symbol?.leafParts?.[0]
    if (!symbol || !part || !symbol.leafParts) throw new Error('Door profile fixture is missing')
    const parts = symbol.leafParts
    if (change === 'profile-only') {
      delete symbol.swingAngleDegrees
      delete symbol.leafParts
    }
    if (change === 'angle-only') {
      delete symbol.leafProfile
      delete symbol.leafParts
    }
    if (change === 'parts-only') {
      delete symbol.leafProfile
      delete symbol.swingAngleDegrees
    }
    if (change === 'unknown-profile') Object.assign(symbol, { leafProfile: 'window' })
    if (change === 'nonfinite-angle') symbol.swingAngleDegrees = Infinity
    if (change === 'string-angle') Object.assign(symbol, { swingAngleDegrees: '90' })
    if (change === 'capped-angle-low') symbol.swingAngleDegrees = 79.999
    if (change === 'capped-angle-high') symbol.swingAngleDegrees = 100.001
    if (change === 'missing-parts') delete symbol.leafParts
    if (change === 'null-parts') Object.assign(symbol, { leafParts: null })
    if (change === 'short-parts') parts.pop()
    if (change === 'long-parts') parts.push(structuredClone(part))
    if (change === 'null-part') Object.assign(parts, { 0: null })
    if (change === 'missing-part-start') Object.assign(part, { start: null })
    if (change === 'missing-part-end') Object.assign(part, { end: null })
    if (change === 'outside-part') part.end.x = 1001
    if (change === 'nonfinite-part') part.end.y = NaN
    if (change === 'zero-part') part.end = { ...part.start }
    if (change.startsWith('single-')) {
      symbol.leafProfile = 'single-stroke'
      symbol.swingAngleDegrees = 90
      if (change !== 'single-with-parts') delete symbol.leafParts
    }
    if (change === 'single-angle-low') symbol.swingAngleDegrees = 89.71
    if (change === 'single-angle-high') symbol.swingAngleDegrees = 90.29
    if (change === 'single-zero-leaf') symbol.leaf.end = { ...symbol.leaf.start }
    await expect(loadFixture(packet, headers)).rejects.toMatchObject({ status: 422 })
  })
  it.each([
    'null-layer',
    'status',
    'partial-refusal',
    'missing-candidates',
    'candidate-limit',
    'null-candidate',
    'blank-id',
    'long-id',
    'duplicate-id',
    'missing-polygon',
    'too-few-points',
    'too-many-points',
    'null-point',
    'outside-image',
    'nonfinite-point',
    'repeated-vertex',
    'fifth-endpoint',
  ])('rejects malformed optional opening frames: %s', async (change) => {
    const { packet, headers } = fixture()
    const frames = openingFrames()
    packet.openingFrames = frames
    const frame = frames.candidates[0]
    const first = frame?.polygon[0]
    if (!frame || !first) throw new Error('Opening frame fixture is missing')
    if (change === 'null-layer') Object.assign(packet, { openingFrames: null })
    if (change === 'status') Object.assign(frames, { status: 'accepted' })
    if (change === 'partial-refusal')
      Object.assign(frames, { status: 'unresolved', refusalReason: 'frame-search-budget' })
    if (change === 'missing-candidates') Object.assign(frames, { candidates: undefined })
    if (change === 'candidate-limit')
      frames.candidates = Array.from({ length: 101 }, (_, i) => ({ ...frame, id: String(i) }))
    if (change === 'null-candidate') Object.assign(frames, { candidates: [null] })
    if (change === 'blank-id') frame.id = ' '
    if (change === 'long-id') frame.id = 'f'.repeat(129)
    if (change === 'duplicate-id') frames.candidates.push(structuredClone(frame))
    if (change === 'missing-polygon') Object.assign(frame, { polygon: null })
    if (change === 'too-few-points') frame.polygon.pop()
    if (change === 'too-many-points') frame.polygon.push({ x: 30, y: 40 }, { x: 100, y: 40 })
    if (change === 'null-point') Object.assign(frame.polygon, { 0: null })
    if (change === 'outside-image') first.y = -1
    if (change === 'nonfinite-point') first.x = Infinity
    if (change === 'repeated-vertex') frame.polygon[3] = { ...first }
    if (change === 'fifth-endpoint') frame.polygon.push({ x: 31, y: 40 })
    const fetcher = vi.fn(async (url: string) =>
      url.includes('native-review-image') ? new Response(body, { headers }) : Response.json(packet),
    )
    await expect(loadNativeReview(input(), fetcher as typeof fetch)).rejects.toMatchObject({
      status: 422,
    })
  })
  it.each([
    'null-layer',
    'status',
    'draft-reason',
    'unresolved-reason',
    'blank-reason',
    'long-reason',
    'partial-refusal',
    'missing-candidates',
    'candidate-limit',
    'null-candidate',
    'blank-id',
    'long-id',
    'duplicate-id',
    'missing-arc',
    'missing-start',
    'empty-segments',
    'segment-limit',
    'null-segment',
    'missing-control',
    'nonfinite-control',
    'negative-point',
    'outside-width',
    'outside-height',
    'string-coordinate',
    'missing-leaf',
    'missing-leaf-end',
    'negative-residual',
    'large-residual',
    'nonfinite-residual',
    'string-residual',
  ])('rejects malformed optional door symbols: %s', async (change) => {
    const { packet, headers } = fixture()
    const symbols = doorSymbols()
    packet.doorSymbols = symbols
    const symbol = symbols.candidates[0]
    const segment = symbol?.arc.segments[0]
    if (!symbol || !segment) throw new Error('Door symbol fixture is missing')
    if (change === 'null-layer') Object.assign(packet, { doorSymbols: null })
    if (change === 'status') Object.assign(symbols, { status: 'accepted' })
    if (change === 'draft-reason') symbols.refusalReason = 'incomplete-native-layer'
    if (change === 'unresolved-reason') symbols.status = 'unresolved'
    if (change === 'blank-reason')
      Object.assign(symbols, { status: 'unresolved', refusalReason: ' ', candidates: [] })
    if (change === 'long-reason')
      Object.assign(symbols, {
        status: 'unresolved',
        refusalReason: 'r'.repeat(129),
        candidates: [],
      })
    if (change === 'partial-refusal')
      Object.assign(symbols, { status: 'unresolved', refusalReason: 'symbol-search-budget' })
    if (change === 'missing-candidates') Object.assign(symbols, { candidates: undefined })
    if (change === 'candidate-limit')
      symbols.candidates = Array.from({ length: 101 }, (_, i) => ({ ...symbol, id: String(i) }))
    if (change === 'null-candidate') Object.assign(symbols, { candidates: [null] })
    if (change === 'blank-id') symbol.id = ' '
    if (change === 'long-id') symbol.id = 'd'.repeat(129)
    if (change === 'duplicate-id') symbols.candidates.push(structuredClone(symbol))
    if (change === 'missing-arc') Object.assign(symbol, { arc: null })
    if (change === 'missing-start') Object.assign(symbol.arc, { start: null })
    if (change === 'empty-segments') symbol.arc.segments = []
    if (change === 'segment-limit') symbol.arc.segments = Array(5).fill(segment)
    if (change === 'null-segment') Object.assign(symbol.arc, { segments: [null] })
    if (change === 'missing-control') Object.assign(segment, { control1: null })
    if (change === 'nonfinite-control') segment.control1.x = NaN
    if (change === 'negative-point') symbol.arc.start.x = -1
    if (change === 'outside-width') segment.control2.x = 1001
    if (change === 'outside-height') segment.end.y = 1001
    if (change === 'string-coordinate') Object.assign(symbol.leaf.start, { x: '100' })
    if (change === 'missing-leaf') Object.assign(symbol, { leaf: null })
    if (change === 'missing-leaf-end') Object.assign(symbol.leaf, { end: null })
    if (change === 'negative-residual') symbol.endpointResidualPixels = -0.001
    if (change === 'large-residual') symbol.endpointResidualPixels = 0.100001
    if (change === 'nonfinite-residual') symbol.endpointResidualPixels = Infinity
    if (change === 'string-residual') Object.assign(symbol, { endpointResidualPixels: '0.01' })
    const fetcher = vi.fn(async (url: string) =>
      url.includes('native-review-image') ? new Response(body, { headers }) : Response.json(packet),
    )
    await expect(loadNativeReview(input(), fetcher as typeof fetch)).rejects.toMatchObject({
      status: 422,
    })
  })
  it.each(['pdf', 'image', 'page', 'width', 'bytes', 'revision', 'promotion', 'counts', 'polygon'])(
    'refuses mismatched or malformed %s response',
    (change) => {
      const { packet, headers } = fixture()
      if (change === 'pdf') headers['x-plan-sha256'] = 'd'.repeat(64)
      if (change === 'image') headers['x-plan-image-sha256'] = 'd'.repeat(64)
      if (change === 'page') headers['x-plan-page'] = '2'
      if (change === 'width') headers['x-plan-image-width'] = '999'
      if (change === 'revision') packet.sourceRevision = 'd'.repeat(64)
      if (change === 'promotion') packet.readiness.readyFor2D = true as false
      if (change === 'counts') packet.counts.strokeFaces = NaN
      if (change === 'polygon')
        packet.faces = [
          {
            id: 'bad',
            layer: 'stroke',
            annotationHint: false,
            polygon: [
              { x: -1, y: 0 },
              { x: 10, y: 0 },
              { x: 10, y: 10 },
            ],
          },
        ]
      const fetcher = vi.fn(async (url: string) =>
        url.includes('native-review-image')
          ? new Response(change === 'bytes' ? 'different bytes' : body, { headers })
          : Response.json(packet),
      )
      return expect(loadNativeReview(input(), fetcher as typeof fetch)).rejects.toThrow()
    },
  )
  it('preserves a revision conflict as 409 and never presents a half-successful pair', async () => {
    const { packet } = fixture()
    const fetcher = vi.fn(async (url: string) =>
      url.includes('native-review-image')
        ? new Response('План изменился.', { status: 409 })
        : Response.json(packet),
    )
    await expect(loadNativeReview(input(), fetcher as typeof fetch)).rejects.toMatchObject({
      status: 409,
    })
  })
  it('does not return an inspection after cancellation', async () => {
    const { packet, headers } = fixture(),
      controller = new AbortController()
    const fetcher = vi.fn(async (url: string) =>
      url.includes('native-review-image') ? new Response(body, { headers }) : Response.json(packet),
    )
    controller.abort()
    await expect(
      loadNativeReview({ ...input(), signal: controller.signal }, fetcher as typeof fetch),
    ).rejects.toMatchObject({ name: 'AbortError' })
  })
})
