import { createHash } from 'node:crypto'
import { existsSync } from 'node:fs'
import { readFile } from 'node:fs/promises'
import { fileURLToPath } from 'node:url'
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
  // Most client tests construct older DTOs or replace caption parents independently.
  // Opt into the new scale report explicitly in its contract tests below.
  delete packet.scaleEvidence
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

function loadFixture(
  packet: NativeReviewPacket,
  headers: Record<string, string>,
  options: { imageBody?: Uint8Array<ArrayBuffer>; page?: number } = {},
) {
  const fetcher = vi.fn(async (url: string) =>
    url.includes('native-review-image')
      ? new Response(options.imageBody ?? body, { headers })
      : Response.json(packet),
  )
  return loadNativeReview({ ...input(), page: options.page ?? 1 }, fetcher as typeof fetch)
}

describe('filled-quad profile contract, separate from physical openings', () => {
  function required<T>(value: T | undefined): T {
    if (value === undefined) throw new Error('Missing filled-profile fixture')
    return value
  }
  function filledFixture() {
    const result = fixture()
    const polygon = (left: number, right: number) => [
      { x: left, y: 40 },
      { x: right, y: 40 },
      { x: right, y: 50 },
      { x: left, y: 50 },
    ]
    result.packet.filledPanelSymbols = {
      status: 'draft',
      basis: 'native-filled-quad-and-opposed-cap-overlap',
      refusalReason: null,
      completeOpeningInventory: false,
      physicalJambAccepted: false,
      physicalPassageAccepted: false,
      closesFloorBoundary: false,
      finalPaintVisibilityProved: false,
      candidates: [
        {
          id: 'native-filled-panel-10:0',
          sourceRefs: [10, 11, 12].map((operationIndex) => ({ operationIndex, subpathIndex: 0 })),
          polygons: [polygon(30, 100), polygon(25, 32), polygon(98, 105)],
          laterPaintCount: 5,
          omittedInkCount: 2,
        },
      ],
    }
    return result
  }
  it('loads source paint profiles without admitting physical geometry', async () => {
    const { packet, headers } = filledFixture()
    const result = await loadFixture(packet, headers)
    expect(result.packet.filledPanelSymbols).toEqual(packet.filledPanelSymbols)
    expect(result.packet.readiness).toEqual({
      readOnly: true,
      readyFor2D: false,
      readyFor3D: false,
    })
    expect(result.packet.openingFrames).toBeUndefined()
    expect(result.packet).not.toHaveProperty('geometry')
  })
  it.each([
    'completeOpeningInventory',
    'physicalJambAccepted',
    'physicalPassageAccepted',
    'closesFloorBoundary',
    'finalPaintVisibilityProved',
  ])('rejects promotion of %s', async (key) => {
    const { packet, headers } = filledFixture()
    Object.assign(packet.filledPanelSymbols as object, { [key]: true })
    await expect(loadFixture(packet, headers)).rejects.toThrow()
  })
  it.each([
    [
      'wrong basis',
      (report: NonNullable<NativeReviewPacket['filledPanelSymbols']>) =>
        Object.assign(report, { basis: 'native-body-and-two-endcap-profile' }),
    ],
    [
      'unknown geometry',
      (report: NonNullable<NativeReviewPacket['filledPanelSymbols']>) =>
        Object.assign(report, { geometry: {} }),
    ],
    [
      'foreign identity',
      (report: NonNullable<NativeReviewPacket['filledPanelSymbols']>) => {
        required(report.candidates[0]).id = 'native-filled-panel-99:0'
      },
    ],
    [
      'duplicate cap',
      (report: NonNullable<NativeReviewPacket['filledPanelSymbols']>) => {
        const candidate = required(report.candidates[0])
        candidate.sourceRefs[2] = required(candidate.sourceRefs[1])
      },
    ],
    [
      'missing cap',
      (report: NonNullable<NativeReviewPacket['filledPanelSymbols']>) => {
        required(report.candidates[0]).polygons.pop()
      },
    ],
    [
      'out of image',
      (report: NonNullable<NativeReviewPacket['filledPanelSymbols']>) => {
        const polygon = required(required(report.candidates[0]).polygons[0])
        required(polygon[0]).x = -1
      },
    ],
    [
      'fractional count',
      (report: NonNullable<NativeReviewPacket['filledPanelSymbols']>) => {
        required(report.candidates[0]).laterPaintCount = 0.5
      },
    ],
    [
      'partial refused inventory',
      (report: NonNullable<NativeReviewPacket['filledPanelSymbols']>) => {
        report.status = 'unresolved'
        report.refusalReason = 'filled-panel-search-budget'
      },
    ],
  ] as const)('rejects %s atomically', async (_name, mutate) => {
    const { packet, headers } = filledFixture()
    mutate(required(packet.filledPanelSymbols))
    await expect(loadFixture(packet, headers)).rejects.toThrow()
  })
  it('accepts an atomic source refusal with no profiles', async () => {
    const { packet, headers } = filledFixture()
    const report = required(packet.filledPanelSymbols)
    report.status = 'unresolved'
    report.refusalReason = 'filled-panel-search-budget'
    report.candidates = []
    expect((await loadFixture(packet, headers)).packet.filledPanelSymbols).toEqual(report)
  })
  it('rejects competing body/cap roles across different profiles', async () => {
    const { packet, headers } = filledFixture()
    const report = required(packet.filledPanelSymbols)
    const competing = structuredClone(required(report.candidates[0]))
    competing.id = 'native-filled-panel-11:0'
    competing.sourceRefs = [11, 20, 21].map((operationIndex) => ({
      operationIndex,
      subpathIndex: 0,
    }))
    report.candidates.push(competing)
    await expect(loadFixture(packet, headers)).rejects.toThrow()
  })
  it('refuses more profiles than the public producer limit', async () => {
    const { packet, headers } = filledFixture()
    const report = required(packet.filledPanelSymbols)
    const original = required(report.candidates[0])
    report.candidates = Array.from({ length: 101 }, (_, index) => ({
      ...structuredClone(original),
      id: `native-filled-panel-${index * 3}:0`,
      sourceRefs: [index * 3, index * 3 + 1, index * 3 + 2].map((operationIndex) => ({
        operationIndex,
        subpathIndex: 0,
      })),
    }))
    await expect(loadFixture(packet, headers)).rejects.toThrow()
  })
})

describe('positive painted-region context contract', () => {
  function contextFixture() {
    const result = fixture()
    result.packet.faces = [
      {
        id: 'native-fill-10:0',
        layer: 'fill',
        annotationHint: false,
        polygon: [
          { x: 10, y: 10 },
          { x: 100, y: 10 },
          { x: 100, y: 100 },
          { x: 10, y: 100 },
        ],
      },
    ]
    result.packet.counts.fillCandidates = 1
    result.packet.paintedRegionContext = {
      status: 'draft',
      refusalReason: null,
      regions: [
        {
          candidateId: 'native-fill-10:0',
          sourceRef: { operationIndex: 10, subpathIndex: 0 },
          earlierPaintCount: 2,
          laterPaintCount: 1,
          unresolvedPaintCount: 1,
          possibleOmissionCount: 0,
        },
      ],
    }
    return result
  }

  it('loads source paint-order diagnostics without floor or room acceptance', async () => {
    const { packet, headers } = contextFixture()
    const loaded = await loadFixture(packet, headers)
    expect(loaded.packet.paintedRegionContext).toEqual(packet.paintedRegionContext)
    expect(loaded.packet.readiness).toEqual({
      readOnly: true,
      readyFor2D: false,
      readyFor3D: false,
    })
  })

  it('loads an unresolved paint report when omission counters exceed retained bounds', async () => {
    const { packet, headers } = contextFixture()
    packet.extraction.clippedPaths = 3001
    packet.paintedRegionContext = {
      status: 'unresolved',
      refusalReason: 'incomplete-native-layer',
      regions: [],
    }
    const result = await loadFixture(packet, headers)
    expect(result.packet.paintedRegionContext?.status).toBe('unresolved')
  })

  it.each([
    'foreign-id',
    'duplicate',
    'missing-region',
    'count',
    'omissions',
    'extra-claim',
    'refused-partial',
  ] as const)('rejects %s paint context instead of treating it as floor evidence', async (kind) => {
    const { packet, headers } = contextFixture()
    const report = packet.paintedRegionContext
    const region = report?.regions[0]
    if (!report || !region) throw new Error('Missing painted-region context fixture')
    if (kind === 'foreign-id') region.sourceRef.operationIndex = 11
    if (kind === 'duplicate') report.regions.push(structuredClone(region))
    if (kind === 'missing-region') report.regions = []
    if (kind === 'count') region.unresolvedPaintCount = 4
    if (kind === 'omissions') region.possibleOmissionCount = 1
    if (kind === 'extra-claim') Object.assign(report, { readyFor3D: true })
    if (kind === 'refused-partial') {
      report.status = 'unresolved'
      report.refusalReason = 'paint-context-work-limit'
    }
    await expect(loadFixture(packet, headers)).rejects.toMatchObject({ status: 422 })
  })
})

describe('ordered source paint fragments', () => {
  function orderedFixture() {
    const result = fixture()
    result.packet.faces = [
      {
        id: 'native-fill-10:0',
        layer: 'fill',
        annotationHint: false,
        polygon: [
          { x: 10, y: 10 },
          { x: 100, y: 10 },
          { x: 100, y: 100 },
          { x: 10, y: 100 },
        ],
      },
    ]
    result.packet.extraction.clippedPaths = 2
    const face = result.packet.faces[0]
    if (!face) throw new Error('Missing source painted face')
    result.packet.orderedPaint = {
      status: 'diagnostic',
      refusalReason: null,
      regions: [
        {
          candidateId: 'native-fill-10:0',
          status: 'diagnostic',
          refusalReason: null,
          maskCount: 1,
          omittedStrokeCount: 2,
          boundaryInkComplete: false,
          pieces: [
            {
              polygon: face.polygon,
              holes: [
                [
                  { x: 30, y: 30 },
                  { x: 40, y: 30 },
                  { x: 40, y: 40 },
                  { x: 30, y: 40 },
                ],
              ],
            },
          ],
        },
      ],
    }
    return result
  }

  it('loads fragments and explicit holes with nonzero source omissions', async () => {
    const { packet, headers } = orderedFixture()
    const result = await loadFixture(packet, headers)
    expect(result.packet.orderedPaint).toEqual(packet.orderedPaint)
    expect(result.packet.readiness.readyFor3D).toBe(false)
  })

  it.each([
    'foreign-id',
    'duplicate',
    'claimed-completeness',
    'omissions',
    'outside-point',
    'short-hole',
    'held-pieces',
    'extra-authority',
    'partial-global',
  ] as const)('rejects %s ordered paint without publishing partial fragments', async (kind) => {
    const { packet, headers } = orderedFixture()
    const report = packet.orderedPaint
    const region = report?.regions[0]
    const piece = region?.pieces[0]
    if (!report || !region || !piece) throw new Error('Missing ordered paint fixture')
    if (kind === 'foreign-id') region.candidateId = 'native-fill-11:0'
    if (kind === 'duplicate') report.regions.push(structuredClone(region))
    if (kind === 'claimed-completeness') region.boundaryInkComplete = true
    if (kind === 'omissions') region.omittedStrokeCount = 3
    if (kind === 'outside-point') piece.polygon = [{ x: -1, y: 10 }, ...piece.polygon.slice(1)]
    if (kind === 'short-hole') piece.holes = [[{ x: 10, y: 10 }]]
    if (kind === 'held-pieces') {
      region.status = 'held'
      region.refusalReason = 'ambiguous-nearby-intersections'
    }
    if (kind === 'extra-authority') Object.assign(region, { readyFor3D: true })
    if (kind === 'partial-global') {
      report.status = 'unresolved'
      report.refusalReason = 'visible-paint-output-limit'
    }
    await expect(loadFixture(packet, headers)).rejects.toMatchObject({ status: 422 })
  })
})

function sourceLinksFixture() {
  const result = fixture()
  const { packet } = result
  const door = doorSymbols().candidates[0]
  const glazing = glazingSymbols().candidates[0]
  if (!door || !glazing) throw new Error('Source symbol fixture is missing')
  packet.doorSymbols = {
    status: 'draft',
    refusalReason: null,
    candidates: ['door-frame', 'door-glazing', 'door-unresolved', 'door-ambiguous'].map((id) => ({
      ...structuredClone(door),
      id,
    })),
  }
  packet.openingFrames = openingFrames()
  packet.glazingSymbols = {
    status: 'draft',
    refusalReason: null,
    candidates: ['glazing-1', 'glazing-2', 'glazing-unresolved', 'glazing-ambiguous'].map((id) => ({
      ...structuredClone(glazing),
      id,
    })),
  }
  const links: NonNullable<NativeReviewPacket['sourceLinks']> = {
    status: 'draft',
    refusalReason: null,
    doors: [
      {
        symbolId: 'door-frame',
        status: 'linked',
        targetKind: 'opening-frame',
        targetId: 'native-opening-frame-1:0',
        relation: 'jamb-to-frame',
      },
      {
        symbolId: 'door-glazing',
        status: 'linked',
        targetKind: 'glazing-panel',
        targetId: 'glazing-1',
        relation: 'shared-cap-edge',
      },
      {
        symbolId: 'door-unresolved',
        status: 'unresolved',
        targetKind: null,
        targetId: null,
        relation: null,
      },
      {
        symbolId: 'door-ambiguous',
        status: 'ambiguous',
        targetKind: null,
        targetId: null,
        relation: null,
      },
    ],
    glazing: [
      { symbolId: 'glazing-1', status: 'two-sided' },
      { symbolId: 'glazing-2', status: 'two-sided' },
      { symbolId: 'glazing-unresolved', status: 'unresolved' },
      { symbolId: 'glazing-ambiguous', status: 'ambiguous' },
    ],
    groups: [
      { id: 'source-group-1', glazingIds: ['glazing-1', 'glazing-2'], doorIds: ['door-glazing'] },
    ],
  }
  packet.sourceLinks = links
  return { ...result, links }
}

describe('bounded native numeric-circle observations', () => {
  function circlesFixture() {
    const result = fixture()
    const circles: NonNullable<NativeReviewPacket['numberCircles']> = {
      status: 'draft',
      refusalReason: null,
      cues: [{ labelId: 'native-label-1', sourceNumber: 1 }],
    }
    result.packet.numberCircles = circles
    return { ...result, circles }
  }
  it('keeps numeric observations distinct from room identity and accepts duplicate observed numbers', async () => {
    const { packet, headers, circles } = circlesFixture()
    circles.cues.push({ labelId: 'native-label-2', sourceNumber: 1 })
    const loaded = (await loadFixture(packet, headers)).packet
    expect(loaded.numberCircles).toEqual(circles)
    expect(loaded.faces).toEqual(packet.faces)
    expect(loaded.readiness).toEqual({ readOnly: true, readyFor2D: false, readyFor3D: false })
  })
  it('accepts exactly 100 bounded cues without serializing extra circle or room geometry', async () => {
    const { packet, headers, circles } = circlesFixture()
    circles.cues = Array.from({ length: 100 }, (_, index) => ({
      labelId: index === 0 ? 'l'.repeat(128) : `native-label-${index}`,
      sourceNumber: index === 99 ? 10000 : index + 1,
    }))
    expect((await loadFixture(packet, headers)).packet.numberCircles).toEqual(circles)
  })
  it.each(['draft', 'unresolved'] as const)('accepts an empty %s circle layer', async (status) => {
    const { packet, headers } = fixture()
    packet.numberCircles = {
      status,
      refusalReason: status === 'unresolved' ? 'r'.repeat(128) : null,
      cues: [],
    }
    expect((await loadFixture(packet, headers)).packet.numberCircles).toEqual(packet.numberCircles)
  })
  it.each([
    'null-layer',
    'status',
    'draft-reason',
    'refusal-with-cues',
    'blank-reason',
    'long-reason',
    'missing-cues',
    'cue-limit',
    'null-cue',
    'blank-id',
    'long-id',
    'duplicate-id',
    'missing-number',
    'string-number',
    'fractional-number',
    'zero-number',
    'negative-number',
    'number-limit',
    'nonfinite-number',
    'room-name',
    'geometry',
    'readiness',
  ])('rejects malformed or semantic circle claims: %s', async (change) => {
    const { packet, headers, circles } = circlesFixture()
    const cue = circles.cues[0]
    if (!cue) throw new Error('Numeric-circle fixture is missing')
    if (change === 'null-layer') Object.assign(packet, { numberCircles: null })
    if (change === 'status') Object.assign(circles, { status: 'confirmed' })
    if (change === 'draft-reason') circles.refusalReason = 'source-unavailable'
    if (change === 'refusal-with-cues')
      Object.assign(circles, { status: 'unresolved', refusalReason: 'source-unavailable' })
    if (change === 'blank-reason' || change === 'long-reason')
      Object.assign(circles, {
        status: 'unresolved',
        refusalReason: change === 'blank-reason' ? ' ' : 'r'.repeat(129),
        cues: [],
      })
    if (change === 'missing-cues') Object.assign(circles, { cues: null })
    if (change === 'cue-limit') circles.cues = Array(101).fill(cue)
    if (change === 'null-cue') Object.assign(circles.cues, { 0: null })
    if (change === 'blank-id') cue.labelId = ' '
    if (change === 'long-id') cue.labelId = 'l'.repeat(129)
    if (change === 'duplicate-id') circles.cues.push({ ...cue })
    if (change === 'missing-number') Object.assign(cue, { sourceNumber: undefined })
    if (change === 'string-number') Object.assign(cue, { sourceNumber: '1' })
    if (change === 'fractional-number') cue.sourceNumber = 1.5
    if (change === 'zero-number') cue.sourceNumber = 0
    if (change === 'negative-number') cue.sourceNumber = -1
    if (change === 'number-limit') cue.sourceNumber = 10001
    if (change === 'nonfinite-number') cue.sourceNumber = NaN
    if (change === 'room-name') Object.assign(cue, { roomName: 'Кухня' })
    if (change === 'geometry') Object.assign(cue, { polygon: [] })
    if (change === 'readiness') Object.assign(circles, { readyFor2D: true })
    await expect(loadFixture(packet, headers)).rejects.toMatchObject({ status: 422 })
  })
})

describe('documentary room schedule and complete numeric-marker accounting', () => {
  function scheduleFixture() {
    const result = fixture()
    const circles: NonNullable<NativeReviewPacket['numberCircles']> = {
      status: 'draft',
      refusalReason: null,
      cues: [
        { labelId: 'circle-1', sourceNumber: 1 },
        { labelId: 'circle-2-a', sourceNumber: 2 },
        { labelId: 'circle-2-b', sourceNumber: 2 },
        { labelId: 'circle-8', sourceNumber: 8 },
      ],
    }
    const schedule: NonNullable<NativeReviewPacket['roomSchedule']> = {
      status: 'draft',
      refusalReason: null,
      rows: ['Прихожая', 'Гостиная', 'Балкон'].map((name, index) => ({
        sourceNumber: index + 1,
        name,
        documentaryAreaM2: [5.8, 14.9, 2.4][index] ?? 1,
        numberLabelId: `table-number-${index + 1}`,
        nameLabelId: `table-name-${index + 1}`,
        areaLabelId: `table-area-${index + 1}`,
        markerStatus: index === 0 ? 'linked' : index === 1 ? 'ambiguous' : 'unobserved',
        markerLabelIds:
          index === 0 ? ['circle-1'] : index === 1 ? ['circle-2-a', 'circle-2-b'] : [],
      })),
      unlistedMarkerLabelIds: ['circle-8'],
    }
    result.packet.numberCircles = circles
    result.packet.roomSchedule = schedule
    return { ...result, schedule, circles }
  }
  it('preserves printed documentary rows and numeric matches without constructing room ownership', async () => {
    const { packet, headers, schedule } = scheduleFixture()
    const loaded = (await loadFixture(packet, headers)).packet
    expect(loaded.roomSchedule).toEqual(schedule)
    expect(loaded.numberCircles).toEqual(packet.numberCircles)
    expect(loaded.faces).toEqual(packet.faces)
    expect(loaded.savedReview).toEqual(packet.savedReview)
    expect(loaded.readiness).toEqual({ readOnly: true, readyFor2D: false, readyFor3D: false })
  })
  it('preserves table rows when the numeric-circle search is unavailable, not unobserved', async () => {
    const { packet, headers, schedule } = scheduleFixture()
    packet.numberCircles = { status: 'unresolved', refusalReason: 'circle-search-budget', cues: [] }
    schedule.unlistedMarkerLabelIds = []
    for (const row of schedule.rows) {
      row.markerStatus = 'unavailable'
      row.markerLabelIds = []
    }
    expect((await loadFixture(packet, headers)).packet.roomSchedule).toEqual(schedule)
  })
  it('accepts a bounded atomic schedule refusal without requiring number-circle data', async () => {
    const { packet, headers } = fixture()
    packet.roomSchedule = {
      status: 'unresolved',
      refusalReason: 'r'.repeat(128),
      rows: [],
      unlistedMarkerLabelIds: [],
    }
    delete packet.numberCircles
    expect((await loadFixture(packet, headers)).packet.roomSchedule).toEqual(packet.roomSchedule)
  })
  it('accepts 50 contiguous table rows and all 100 parent markers, with bounded source labels', async () => {
    const { packet, headers, schedule, circles } = scheduleFixture()
    schedule.rows = Array.from({ length: 50 }, (_, index) => ({
      sourceNumber: index + 1,
      name: index === 0 ? 'Н'.repeat(80) : `Помещение ${index + 1}`,
      documentaryAreaM2: index === 49 ? 999.99 : 0.01,
      numberLabelId: index === 0 ? 'n'.repeat(128) : `table-number-${index}`,
      nameLabelId: `table-name-${index}`,
      areaLabelId: `table-area-${index}`,
      markerStatus: 'ambiguous',
      markerLabelIds: [`circle-${index}-a`, `circle-${index}-b`],
    }))
    circles.cues = schedule.rows.flatMap((row) =>
      row.markerLabelIds.map((labelId) => ({ labelId, sourceNumber: row.sourceNumber })),
    )
    schedule.unlistedMarkerLabelIds = []
    expect((await loadFixture(packet, headers)).packet.roomSchedule).toEqual(schedule)
  })
  it('accepts exactly 100 unlisted observed markers only for numbers outside the table', async () => {
    const { packet, headers, schedule, circles } = scheduleFixture()
    circles.cues = Array.from({ length: 100 }, (_, index) => ({
      labelId: `extra-${index}`,
      sourceNumber: index + 4,
    }))
    for (const row of schedule.rows) {
      row.markerStatus = 'unobserved'
      row.markerLabelIds = []
    }
    schedule.unlistedMarkerLabelIds = circles.cues.map(({ labelId }) => labelId)
    expect((await loadFixture(packet, headers)).packet.roomSchedule).toEqual(schedule)
  })
  it.each([
    'null-report',
    'status',
    'draft-reason',
    'blank-reason',
    'long-reason',
    'refusal-with-rows',
    'refusal-with-unlisted',
    'missing-rows',
    'empty-rows',
    'short-rows',
    'row-limit',
    'null-row',
    'noncontiguous-number',
    'string-number',
    'row-order',
    'missing-name',
    'blank-name',
    'padded-name',
    'long-name',
    'string-area',
    'zero-area',
    'negative-area',
    'large-area',
    'nonfinite-area',
    'blank-label',
    'long-label',
    'missing-label',
    'row-label-duplicate',
    'global-label-duplicate',
    'table-circle-overlap',
    'missing-parent',
    'missing-markers',
    'marker-limit',
    'foreign-marker',
    'wrong-number',
    'blank-marker',
    'long-marker',
    'duplicate-marker',
    'marker-status',
    'linked-empty',
    'linked-many',
    'ambiguous-one',
    'unobserved-with-marker',
    'unavailable-with-parent-draft',
    'available-status-with-parent-unresolved',
    'omitted-marker',
    'missing-unlisted',
    'unlisted-limit',
    'foreign-unlisted',
    'duplicate-unlisted',
    'unlisted-table-number',
    'unlisted-and-row-overlap',
    'source-polygon',
    'room-ownership',
    'room-name',
    'metric-acceptance',
  ])('refuses malformed or overclaimed schedule atomically: %s', async (change) => {
    const { packet, headers, schedule, circles } = scheduleFixture()
    const [first, second, third] = schedule.rows
    if (!first || !second || !third) throw new Error('Room schedule fixture is missing')
    if (change === 'null-report') Object.assign(packet, { roomSchedule: null })
    if (change === 'status') Object.assign(schedule, { status: 'accepted' })
    if (change === 'draft-reason') schedule.refusalReason = 'source-unavailable'
    if (change === 'blank-reason' || change === 'long-reason')
      Object.assign(schedule, {
        status: 'unresolved',
        refusalReason: change === 'blank-reason' ? ' ' : 'r'.repeat(129),
        rows: [],
        unlistedMarkerLabelIds: [],
      })
    if (change === 'refusal-with-rows')
      Object.assign(schedule, {
        status: 'unresolved',
        refusalReason: 'source-unavailable',
        unlistedMarkerLabelIds: [],
      })
    if (change === 'refusal-with-unlisted')
      Object.assign(schedule, {
        status: 'unresolved',
        refusalReason: 'source-unavailable',
        rows: [],
      })
    if (change === 'missing-rows') Object.assign(schedule, { rows: null })
    if (change === 'empty-rows') schedule.rows = []
    if (change === 'short-rows') schedule.rows.pop()
    if (change === 'row-limit') schedule.rows = Array(51).fill(first)
    if (change === 'null-row') Object.assign(schedule.rows, { 0: null })
    if (change === 'noncontiguous-number') third.sourceNumber = 4
    if (change === 'string-number') Object.assign(first, { sourceNumber: '1' })
    if (change === 'row-order') schedule.rows = [second, first, third]
    if (change === 'missing-name') Object.assign(first, { name: undefined })
    if (change === 'blank-name') first.name = ' '
    if (change === 'padded-name') first.name = ' Прихожая '
    if (change === 'long-name') first.name = 'Н'.repeat(81)
    if (change === 'string-area') Object.assign(first, { documentaryAreaM2: '5.8' })
    if (change === 'zero-area') first.documentaryAreaM2 = 0
    if (change === 'negative-area') first.documentaryAreaM2 = -1
    if (change === 'large-area') first.documentaryAreaM2 = 1000
    if (change === 'nonfinite-area') first.documentaryAreaM2 = Infinity
    if (change === 'blank-label') first.nameLabelId = ' '
    if (change === 'long-label') first.areaLabelId = 'a'.repeat(129)
    if (change === 'missing-label') Object.assign(first, { numberLabelId: undefined })
    if (change === 'row-label-duplicate') first.areaLabelId = first.nameLabelId
    if (change === 'global-label-duplicate') second.numberLabelId = first.nameLabelId
    if (change === 'table-circle-overlap') first.numberLabelId = 'circle-1'
    if (change === 'missing-parent') delete packet.numberCircles
    if (change === 'missing-markers') Object.assign(first, { markerLabelIds: null })
    if (change === 'marker-limit') second.markerLabelIds = Array(101).fill('circle-2-a')
    if (change === 'foreign-marker') first.markerLabelIds = ['foreign-circle']
    if (change === 'wrong-number') first.markerLabelIds = ['circle-2-a']
    if (change === 'blank-marker') first.markerLabelIds = [' ']
    if (change === 'long-marker') first.markerLabelIds = ['m'.repeat(129)]
    if (change === 'duplicate-marker') second.markerLabelIds = ['circle-2-a', 'circle-2-a']
    if (change === 'marker-status') Object.assign(first, { markerStatus: 'owned' })
    if (change === 'linked-empty') first.markerLabelIds = []
    if (change === 'linked-many') second.markerStatus = 'linked'
    if (change === 'ambiguous-one') first.markerStatus = 'ambiguous'
    if (change === 'unobserved-with-marker') first.markerStatus = 'unobserved'
    if (change === 'unavailable-with-parent-draft') third.markerStatus = 'unavailable'
    if (change === 'available-status-with-parent-unresolved') {
      circles.status = 'unresolved'
      circles.refusalReason = 'source-unavailable'
      circles.cues = []
      schedule.unlistedMarkerLabelIds = []
      for (const row of schedule.rows) row.markerLabelIds = []
    }
    if (change === 'omitted-marker') {
      second.markerLabelIds = ['circle-2-a']
      second.markerStatus = 'linked'
    }
    if (change === 'missing-unlisted') Object.assign(schedule, { unlistedMarkerLabelIds: null })
    if (change === 'unlisted-limit') schedule.unlistedMarkerLabelIds = Array(101).fill('circle-8')
    if (change === 'foreign-unlisted') schedule.unlistedMarkerLabelIds = ['foreign-circle']
    if (change === 'duplicate-unlisted') schedule.unlistedMarkerLabelIds.push('circle-8')
    if (change === 'unlisted-table-number') {
      second.markerStatus = 'unobserved'
      second.markerLabelIds = []
      schedule.unlistedMarkerLabelIds.push('circle-2-a', 'circle-2-b')
    }
    if (change === 'unlisted-and-row-overlap') schedule.unlistedMarkerLabelIds.push('circle-1')
    if (change === 'source-polygon') Object.assign(first, { polygon: [] })
    if (change === 'room-ownership') Object.assign(schedule, { roomOwnershipConfirmed: true })
    if (change === 'room-name') Object.assign(first, { roomName: 'Комната' })
    if (change === 'metric-acceptance') Object.assign(first, { metricAccepted: true })
    await expect(loadFixture(packet, headers)).rejects.toMatchObject({ status: 422 })
  })
})

describe('optional documentary dimension discovery', () => {
  function dimensionFixture() {
    const result = fixture()
    const discovery: NonNullable<NativeReviewPacket['dimensionDiscovery']> = {
      status: 'draft',
      refusalReason: null,
      candidates: [{ labelId: 'native-text-10', valueMm: 2400, axis: 'width' }],
      unresolved: [{ labelId: 'native-text-11', reason: 'unsupported-dimension-orientation' }],
    }
    result.packet.counts.printedDimensions = 1
    result.packet.dimensionDiscovery = discovery
    return { ...result, discovery }
  }

  it('keeps documentary candidates and unresolved source IDs without calibration authority', async () => {
    const { packet, headers, discovery } = dimensionFixture()
    const loaded = (await loadFixture(packet, headers)).packet
    expect(loaded.dimensionDiscovery).toEqual(discovery)
    expect(loaded.counts.printedDimensions).toBe(1)
    expect(loaded.readiness).toEqual({ readOnly: true, readyFor2D: false, readyFor3D: false })
  })

  it('accepts legacy absence and an empty held discovery', async () => {
    const { packet, headers } = fixture()
    expect((await loadFixture(packet, headers)).packet.dimensionDiscovery).toBeUndefined()
    packet.dimensionDiscovery = {
      status: 'unresolved',
      refusalReason: 'r'.repeat(128),
      candidates: [],
      unresolved: [],
    }
    expect((await loadFixture(packet, headers)).packet.dimensionDiscovery).toEqual(
      packet.dimensionDiscovery,
    )
  })

  it('accepts exactly 1000 combined source captions and the printed millimetre bounds', async () => {
    const { packet, headers, discovery } = dimensionFixture()
    discovery.candidates = Array.from({ length: 500 }, (_, index) => ({
      labelId: `source-${index}`,
      valueMm: index === 0 ? 1 : 99999,
      axis: index % 2 ? 'width' : 'depth',
    }))
    discovery.unresolved = Array.from({ length: 500 }, (_, index) => ({
      labelId: `source-${500 + index}`,
      reason: 'r'.repeat(128),
    }))
    packet.counts.printedDimensions = 500
    expect((await loadFixture(packet, headers)).packet.dimensionDiscovery).toEqual(discovery)
  })

  it.each([
    'null',
    'status',
    'draft-reason',
    'missing-candidates',
    'missing-unresolved',
    'combined-limit',
    'candidate-null',
    'candidate-label',
    'duplicate-candidate',
    'cross-claim',
    'value-zero',
    'value-negative',
    'value-fractional',
    'value-large',
    'axis',
    'count-mismatch',
    'candidate-authority',
    'unresolved-null',
    'unresolved-reason',
    'duplicate-unresolved',
    'unresolved-authority',
    'held-nonempty',
    'report-authority',
  ])('rejects malformed or overclaimed dimension discovery: %s', async (change) => {
    const { packet, headers, discovery } = dimensionFixture()
    const candidate = discovery.candidates[0],
      unresolved = discovery.unresolved[0]
    if (!candidate || !unresolved) throw new Error('Dimension fixture is missing')
    if (change === 'null') Object.assign(packet, { dimensionDiscovery: null })
    if (change === 'status') Object.assign(discovery, { status: 'calibrated' })
    if (change === 'draft-reason') discovery.refusalReason = 'held'
    if (change === 'missing-candidates') Object.assign(discovery, { candidates: null })
    if (change === 'missing-unresolved') Object.assign(discovery, { unresolved: null })
    if (change === 'combined-limit')
      discovery.unresolved = Array.from({ length: 1000 }, (_, index) => ({
        labelId: `unresolved-${index}`,
        reason: 'unobserved',
      }))
    if (change === 'candidate-null') Object.assign(discovery.candidates, { 0: null })
    if (change === 'candidate-label') candidate.labelId = ' '
    if (change === 'duplicate-candidate') {
      discovery.candidates.push({ ...candidate })
      packet.counts.printedDimensions = 2
    }
    if (change === 'cross-claim') unresolved.labelId = candidate.labelId
    if (change === 'value-zero') candidate.valueMm = 0
    if (change === 'value-negative') candidate.valueMm = -1
    if (change === 'value-fractional') candidate.valueMm = 10.5
    if (change === 'value-large') candidate.valueMm = 100000
    if (change === 'axis') Object.assign(candidate, { axis: 'height' })
    if (change === 'count-mismatch') packet.counts.printedDimensions = 0
    if (change === 'candidate-authority') Object.assign(candidate, { cmPerPoint: 1.76 })
    if (change === 'unresolved-null') Object.assign(discovery.unresolved, { 0: null })
    if (change === 'unresolved-reason') unresolved.reason = ' '
    if (change === 'duplicate-unresolved') discovery.unresolved.push({ ...unresolved })
    if (change === 'unresolved-authority') Object.assign(unresolved, { estimatedValueMm: 1200 })
    if (change === 'held-nonempty')
      Object.assign(discovery, { status: 'unresolved', refusalReason: 'held' })
    if (change === 'report-authority') Object.assign(discovery, { calibrated: true })
    await expect(loadFixture(packet, headers)).rejects.toMatchObject({ status: 422 })
  })
})

describe('optional strict source-run to dimension-rail bindings', () => {
  function captionFixture() {
    const result = fixture()
    const report: NonNullable<NativeReviewPacket['sourceCaptionBindings']> = {
      status: 'draft',
      refusalReason: null,
      candidates: [
        {
          labelId: 'native-text-10',
          compactIndex: 0,
          valueMm: 2400,
          axis: 'width',
          rail: { operationIndex: 1, subpathIndex: 0 },
        },
        {
          labelId: 'native-text-12',
          compactIndex: 999,
          valueMm: 99999,
          axis: 'depth',
          rail: { operationIndex: 1, subpathIndex: 1 },
        },
      ],
      unresolved: [{ labelId: 'native-text-11', reason: 'caption-rail-unresolved' }],
    }
    result.packet.sourceCaptionBindings = report
    return { ...result, report }
  }

  it('keeps source identities, compact slots and literal rail references without transfer authority', async () => {
    const { packet, headers, report } = captionFixture()
    const loaded = (await loadFixture(packet, headers)).packet
    expect(loaded.sourceCaptionBindings).toEqual(report)
    expect(loaded.dimensionDiscovery).toBeUndefined()
    expect(loaded.counts.printedDimensions).toBe(0)
    expect(loaded.readiness).toEqual({ readOnly: true, readyFor2D: false, readyFor3D: false })
  })

  it('accepts legacy absence and an atomic held bridge without using other role candidates as fallback', async () => {
    const { packet, headers } = fixture()
    expect((await loadFixture(packet, headers)).packet.sourceCaptionBindings).toBeUndefined()
    packet.dimensionDiscovery = {
      status: 'draft',
      refusalReason: null,
      candidates: [{ labelId: 'native-text-10', valueMm: 2400, axis: 'width' }],
      unresolved: [],
    }
    packet.counts.printedDimensions = 1
    packet.sourceCaptionBindings = {
      status: 'unresolved',
      refusalReason: 'native-caption-bridge-unavailable',
      candidates: [],
      unresolved: [],
    }
    const loaded = (await loadFixture(packet, headers)).packet
    expect(loaded.sourceCaptionBindings).toEqual(packet.sourceCaptionBindings)
    expect(loaded.sourceCaptionBindings?.candidates).toEqual([])
    expect(loaded.dimensionDiscovery?.candidates).toHaveLength(1)
  })

  it('accepts exactly 1000 combined records and integer millimetre/index/reference bounds', async () => {
    const { packet, headers, report } = captionFixture()
    report.candidates = Array.from({ length: 500 }, (_, index) => ({
      labelId: `native-text-${index}`,
      compactIndex: index,
      valueMm: index === 0 ? 1 : 99999,
      axis: index % 2 ? 'width' : 'depth',
      rail: {
        operationIndex: index === 0 ? Number.MAX_SAFE_INTEGER : index,
        subpathIndex: index === 0 ? Number.MAX_SAFE_INTEGER : 0,
      },
    }))
    report.unresolved = Array.from({ length: 500 }, (_, index) => ({
      labelId: `native-text-${500 + index}`,
      reason: 'r'.repeat(128),
    }))
    expect((await loadFixture(packet, headers)).packet.sourceCaptionBindings).toEqual(report)
  })

  it('compares only overlapping draft role candidates, not inventory equality or held-label presence', async () => {
    const { packet, headers, report } = captionFixture()
    packet.dimensionDiscovery = {
      status: 'draft',
      refusalReason: null,
      candidates: [
        { labelId: 'native-text-10', valueMm: 2400, axis: 'width' },
        { labelId: 'native-text-11', valueMm: 900, axis: 'width' },
        { labelId: 'legacy-only', valueMm: 1500, axis: 'depth' },
      ],
      unresolved: [{ labelId: 'native-text-12', reason: 'legacy-role-held' }],
    }
    packet.counts.printedDimensions = 3
    expect((await loadFixture(packet, headers)).packet.sourceCaptionBindings).toEqual(report)
    packet.dimensionDiscovery = {
      status: 'unresolved',
      refusalReason: 'dimension-discovery-work-limit',
      candidates: [],
      unresolved: [],
    }
    packet.counts.printedDimensions = 0
    expect((await loadFixture(packet, headers)).packet.sourceCaptionBindings).toEqual(report)
  })

  it.each(['value', 'axis'] as const)(
    'rejects a contradictory %s for an overlapping legacy candidate',
    async (field) => {
      const { packet, headers } = captionFixture()
      packet.dimensionDiscovery = {
        status: 'draft',
        refusalReason: null,
        candidates: [{ labelId: 'native-text-10', valueMm: 2400, axis: 'width' }],
        unresolved: [],
      }
      packet.counts.printedDimensions = 1
      const legacy = packet.dimensionDiscovery.candidates[0]
      if (!legacy) throw new Error('Legacy candidate is missing')
      if (field === 'value') legacy.valueMm = 2401
      if (field === 'axis') legacy.axis = 'depth'
      await expect(loadFixture(packet, headers)).rejects.toMatchObject({ status: 422 })
    },
  )

  it.each([
    'null-report',
    'status',
    'draft-reason',
    'missing-candidates',
    'missing-unresolved',
    'combined-limit',
    'candidate-null',
    'candidate-label',
    'padded-label',
    'long-label',
    'duplicate-candidate',
    'cross-claim',
    'compact-negative',
    'compact-large',
    'compact-fraction',
    'compact-unsafe',
    'compact-string',
    'duplicate-compact',
    'value-zero',
    'value-negative',
    'value-fraction',
    'value-large',
    'value-nan',
    'axis',
    'rail-null',
    'rail-operation-negative',
    'rail-subpath-negative',
    'rail-operation-fraction',
    'rail-subpath-fraction',
    'rail-operation-unsafe',
    'rail-subpath-unsafe',
    'rail-operation-string',
    'rail-subpath-string',
    'duplicate-rail',
    'rail-extra',
    'candidate-coordinates',
    'candidate-authority',
    'unresolved-null',
    'unresolved-label',
    'unresolved-reason',
    'unresolved-reason-long',
    'duplicate-unresolved',
    'unresolved-extra',
    'held-nonempty',
    'held-empty-reason',
    'held-missing-reason',
    'report-authority',
  ])('rejects malformed or overclaimed strict caption binding: %s', async (change) => {
    const { packet, headers, report } = captionFixture()
    const first = report.candidates[0],
      second = report.candidates[1],
      held = report.unresolved[0]
    if (!first || !second || !held) throw new Error('Caption fixture is missing')
    if (change === 'null-report') Object.assign(packet, { sourceCaptionBindings: null })
    if (change === 'status') Object.assign(report, { status: 'calibrated' })
    if (change === 'draft-reason') report.refusalReason = 'held'
    if (change === 'missing-candidates') Object.assign(report, { candidates: null })
    if (change === 'missing-unresolved') Object.assign(report, { unresolved: null })
    if (change === 'combined-limit')
      report.unresolved = Array.from({ length: 999 }, (_, index) => ({
        labelId: `held-${index}`,
        reason: 'held',
      }))
    if (change === 'candidate-null') Object.assign(report.candidates, { 0: null })
    if (change === 'candidate-label') first.labelId = ' '
    if (change === 'padded-label') first.labelId = ' native-text-10 '
    if (change === 'long-label') first.labelId = 's'.repeat(129)
    if (change === 'duplicate-candidate') second.labelId = first.labelId
    if (change === 'cross-claim') held.labelId = first.labelId
    if (change === 'compact-negative') first.compactIndex = -1
    if (change === 'compact-large') first.compactIndex = 1000
    if (change === 'compact-fraction') first.compactIndex = 0.5
    if (change === 'compact-unsafe') first.compactIndex = Number.MAX_SAFE_INTEGER + 1
    if (change === 'compact-string') Object.assign(first, { compactIndex: '0' })
    if (change === 'duplicate-compact') second.compactIndex = first.compactIndex
    if (change === 'value-zero') first.valueMm = 0
    if (change === 'value-negative') first.valueMm = -1
    if (change === 'value-fraction') first.valueMm = 10.5
    if (change === 'value-large') first.valueMm = 100000
    if (change === 'value-nan') first.valueMm = Number.NaN
    if (change === 'axis') Object.assign(first, { axis: 'height' })
    if (change === 'rail-null') Object.assign(first, { rail: null })
    if (change === 'rail-operation-negative') first.rail.operationIndex = -1
    if (change === 'rail-subpath-negative') first.rail.subpathIndex = -1
    if (change === 'rail-operation-fraction') first.rail.operationIndex = 0.5
    if (change === 'rail-subpath-fraction') first.rail.subpathIndex = 0.5
    if (change === 'rail-operation-unsafe') first.rail.operationIndex = Number.MAX_SAFE_INTEGER + 1
    if (change === 'rail-subpath-unsafe') first.rail.subpathIndex = Number.MAX_SAFE_INTEGER + 1
    if (change === 'rail-operation-string') Object.assign(first.rail, { operationIndex: '1' })
    if (change === 'rail-subpath-string') Object.assign(first.rail, { subpathIndex: '0' })
    if (change === 'duplicate-rail') second.rail = { ...first.rail }
    if (change === 'rail-extra') Object.assign(first.rail, { segmentIndex: 0 })
    if (change === 'candidate-coordinates') Object.assign(first, { pagePoint: { x: 10, y: 20 } })
    if (change === 'candidate-authority') Object.assign(first, { acceptedFor2D: true })
    if (change === 'unresolved-null') Object.assign(report.unresolved, { 0: null })
    if (change === 'unresolved-label') held.labelId = ' '
    if (change === 'unresolved-reason') held.reason = ' '
    if (change === 'unresolved-reason-long') held.reason = 'r'.repeat(129)
    if (change === 'duplicate-unresolved') report.unresolved.push({ ...held })
    if (change === 'unresolved-extra') Object.assign(held, { estimatedValueMm: 900 })
    if (change === 'held-nonempty')
      Object.assign(report, { status: 'unresolved', refusalReason: 'held' })
    if (change === 'held-empty-reason' || change === 'held-missing-reason') {
      report.status = 'unresolved'
      report.refusalReason = change === 'held-empty-reason' ? '' : null
      report.candidates = []
      report.unresolved = []
    }
    if (change === 'report-authority') Object.assign(report, { mayTransfer3D: false })
    await expect(loadFixture(packet, headers)).rejects.toMatchObject({ status: 422 })
  })
})

describe('source X/Y scale evidence', () => {
  function scaleFixture() {
    const result = fixture()
    result.packet.sourceCaptionBindings = {
      status: 'draft',
      refusalReason: null,
      candidates: ['width', 'depth'].flatMap((axis, axisIndex) =>
        [200, 100].map((length, index) => ({
          labelId: `${axis}-${index}`,
          compactIndex: axisIndex * 2 + index,
          valueMm: length * 10,
          axis: axis as 'width' | 'depth',
          rail: { operationIndex: axisIndex * 2 + index, subpathIndex: 0 },
        })),
      ),
      unresolved: [{ labelId: 'held', reason: 'caption-rail-unresolved' }],
    }
    const report: NonNullable<NativeReviewPacket['scaleEvidence']> = {
      status: 'draft',
      refusalReason: null,
      dimensionToleranceMm: 2,
      axes: (['width', 'depth'] as const).map((axis) => ({
        axis,
        status: 'consistent',
        referenceLabelId: `${axis}-0`,
        referenceMmPerPoint: 10,
        independentLabelIds: [`${axis}-0`, `${axis}-1`],
        observations: [200, 100].map((length, index) => ({
          labelId: `${axis}-${index}`,
          valueMm: length * 10,
          lengthPoints: length,
          mmPerPoint: 10,
          residualMm: 0,
        })),
      })),
      commonScale: { status: 'consistent', referenceLabelId: 'width-0', mmPerPoint: 10 },
      unresolved: [{ labelId: 'held', reason: 'caption-rail-unresolved' }],
    }
    result.packet.scaleEvidence = report
    return { ...result, report }
  }
  it('replays ratios and independent axis/common status without changing the packet', async () => {
    const { packet, headers, report } = scaleFixture()
    const before = structuredClone(packet)
    expect((await loadFixture(packet, headers)).packet.scaleEvidence).toEqual(report)
    expect(packet).toEqual(before)
  })
  it('accepts atomic refusal and absence for legacy DTOs', async () => {
    const { packet, headers } = scaleFixture()
    packet.scaleEvidence = {
      status: 'unresolved',
      refusalReason: 'source-unavailable',
      dimensionToleranceMm: 2,
      axes: [],
      commonScale: { status: 'insufficient', referenceLabelId: null, mmPerPoint: null },
      unresolved: [],
    }
    expect((await loadFixture(packet, headers)).packet.scaleEvidence).toEqual(packet.scaleEvidence)
    delete packet.scaleEvidence
    expect((await loadFixture(packet, headers)).packet.scaleEvidence).toBeUndefined()
  })
  it('allows an independent pair outside the longest reference and refuses a singleton', async () => {
    const { packet, headers, report } = scaleFixture()
    const x = report.axes[0]
    const bindings = packet.sourceCaptionBindings
    if (!x || !bindings) throw new Error('Missing scale fixture')
    x.observations.push({
      labelId: 'width-2',
      valueMm: 500,
      lengthPoints: 50,
      mmPerPoint: 10,
      residualMm: 0,
    })
    bindings.candidates.push({
      labelId: 'width-2',
      compactIndex: 4,
      valueMm: 500,
      axis: 'width',
      rail: { operationIndex: 4, subpathIndex: 0 },
    })
    x.independentLabelIds = ['width-1', 'width-2']
    expect((await loadFixture(packet, headers)).packet.scaleEvidence).toEqual(report)
    x.independentLabelIds = ['width-1']
    await expect(loadFixture(packet, headers)).rejects.toMatchObject({ status: 422 })
    x.independentLabelIds = []
    x.status = 'insufficient'
    report.commonScale = { status: 'insufficient', referenceLabelId: null, mmPerPoint: null }
    expect((await loadFixture(packet, headers)).packet.scaleEvidence).toEqual(report)
  })
  it('accounts for held oblique captions rather than silently dropping them', async () => {
    const { packet, headers, report } = scaleFixture()
    packet.sourceCaptionBindings?.candidates.push({
      labelId: 'slant',
      compactIndex: 4,
      valueMm: 1000,
      axis: 'aligned',
      rail: { operationIndex: 4, subpathIndex: 0 },
    })
    report.unresolved.push({ labelId: 'slant', reason: 'scale-evidence-noncardinal-dimension' })
    expect((await loadFixture(packet, headers)).packet.scaleEvidence).toEqual(report)
    report.unresolved.pop()
    await expect(loadFixture(packet, headers)).rejects.toMatchObject({ status: 422 })
  })
  it.each([
    'parent',
    'unknown-key',
    'tolerance',
    'ratio',
    'residual',
    'missing-observation',
    'duplicate-label',
    'duplicate-anchor',
    'same-rail',
    'axis-order',
    'wrong-common',
    'missing-held',
    'wrong-held',
    'fake-conflict',
    'partial-refusal',
    'overflow-ratio',
  ])('rejects invalid scale report: %s', async (change) => {
    const { packet, headers, report } = scaleFixture()
    const x = report.axes[0]
    const first = x?.observations[0]
    const second = x?.observations[1]
    const sourceFirst = packet.sourceCaptionBindings?.candidates[0]
    const sourceSecond = packet.sourceCaptionBindings?.candidates[1]
    const held = report.unresolved[0]
    if (!x || !first || !second || !sourceFirst || !sourceSecond || !held)
      throw new Error('Missing scale fixture')
    if (change === 'parent') delete packet.sourceCaptionBindings
    if (change === 'unknown-key') Object.assign(report, { readyFor2D: true })
    if (change === 'tolerance') Object.assign(report, { dimensionToleranceMm: 3 })
    if (change === 'ratio') second.mmPerPoint = 10.01
    if (change === 'residual') second.residualMm = 0.1
    if (change === 'missing-observation') x.observations.pop()
    if (change === 'duplicate-label') second.labelId = first.labelId
    if (change === 'duplicate-anchor') x.independentLabelIds[1] = first.labelId
    if (change === 'same-rail') sourceSecond.rail = sourceFirst.rail
    if (change === 'axis-order') report.axes.reverse()
    if (change === 'wrong-common') report.commonScale.mmPerPoint = 11
    if (change === 'missing-held') report.unresolved = []
    if (change === 'wrong-held') held.reason = 'invented'
    if (change === 'fake-conflict') report.commonScale.status = 'conflict'
    if (change === 'overflow-ratio') second.lengthPoints = Number.MIN_VALUE
    if (change === 'partial-refusal') {
      report.status = 'unresolved'
      report.refusalReason = 'source-unavailable'
    }
    await expect(loadFixture(packet, headers)).rejects.toMatchObject({ status: 422 })
  })
  it('detects anisotropic cross-axis conflict even with locally consistent axes', async () => {
    const { packet, headers, report } = scaleFixture()
    const y = report.axes[1]
    if (!y) throw new Error('Missing scale Y fixture')
    y.referenceMmPerPoint = 20
    for (const observation of y.observations) {
      observation.lengthPoints /= 2
      observation.mmPerPoint = 20
    }
    report.commonScale = { status: 'conflict', referenceLabelId: null, mmPerPoint: null }
    expect((await loadFixture(packet, headers)).packet.scaleEvidence).toEqual(report)
    report.commonScale = { status: 'consistent', referenceLabelId: 'width-0', mmPerPoint: 10 }
    await expect(loadFixture(packet, headers)).rejects.toMatchObject({ status: 422 })
  })
})

describe('rotated captions and bounded source dimension targets', () => {
  function targetFixture() {
    const result = fixture()
    result.packet.openingFrames = openingFrames()
    result.packet.sourceCaptionBindings = {
      status: 'draft',
      refusalReason: null,
      candidates: [
        {
          labelId: 'dimension-1',
          compactIndex: 0,
          valueMm: 2000,
          axis: 'width',
          rail: { operationIndex: 1, subpathIndex: 0 },
          angleDegrees: 180,
          textPlacement: 'baseline',
        },
        {
          labelId: 'dimension-2',
          compactIndex: 1,
          valueMm: 1317,
          axis: 'aligned',
          rail: { operationIndex: 2, subpathIndex: 0 },
          angleDegrees: -43.95629639354044,
          textPlacement: 'glyph-ink',
          inkSourceOperation: 20,
        },
      ],
      unresolved: [{ labelId: 'held-1', reason: 'caption-rail-unresolved' }],
    }
    const report: NonNullable<NativeReviewPacket['dimensionTargets']> = {
      status: 'draft',
      refusalReason: null,
      observations: [
        {
          labelId: 'dimension-1',
          valueMm: 2000,
          axis: 'width',
          status: 'continuous',
          reason: null,
          targets: [
            {
              kind: 'opening-frame',
              id: 'native-opening-frame-1:0',
              faces: [
                {
                  edgeIndex: 0,
                  status: 'continuous',
                  reason: null,
                  supportRefs: [{ operationIndex: 10, subpathIndex: 0, segmentIndex: 0 }],
                  endpointWitnesses: [
                    {
                      status: 'continuous',
                      sourceRefs: [{ operationIndex: 11, subpathIndex: 0, segmentIndex: 0 }],
                      gapPoints: 0,
                    },
                    {
                      status: 'continuous',
                      sourceRefs: [{ operationIndex: 12, subpathIndex: 0, segmentIndex: 0 }],
                      gapPoints: 0,
                    },
                  ],
                },
              ],
            },
          ],
        },
        {
          labelId: 'dimension-2',
          valueMm: 1317,
          axis: 'aligned',
          status: 'unresolved',
          reason: 'non-cardinal-source-target-not-supported',
          targets: [],
        },
      ],
      unresolved: [{ labelId: 'held-1', reason: 'caption-rail-unresolved' }],
    }
    result.packet.dimensionTargets = report
    const row = report.observations[0]
    const target = row?.targets[0]
    const face = target?.faces[0]
    if (!row || !target || !face) throw new Error('Missing target fixture')
    return { ...result, report, row, target, face }
  }

  it('accepts literal raw angles, glyph references and source targets without transfer authority', async () => {
    const { packet, headers, report } = targetFixture()
    const loaded = (await loadFixture(packet, headers)).packet
    expect(loaded.sourceCaptionBindings).toEqual(packet.sourceCaptionBindings)
    expect(loaded.dimensionTargets).toEqual(report)
    expect(loaded.readiness).toEqual({ readOnly: true, readyFor2D: false, readyFor3D: false })
  })
  function repeatedFloorFixture(valueMm: number) {
    const result = targetFixture()
    result.packet.numberCircles = { status: 'draft', refusalReason: null, cues: [] }
    result.packet.floorCavities = {
      status: 'draft',
      refusalReason: null,
      candidates: [
        {
          id: 'floor-1',
          polygon: openingFrames().candidates[0]?.polygon ?? [],
          markerLabelIds: [],
          markerStatus: 'unmarked',
          closureIds: [],
          unknownInteriorStrokeCount: 0,
          omittedBoundaryInkCount: 0,
        },
      ],
      thresholds: [],
      closures: [],
      unprovedCavities: [],
      unresolvedMarkerLabelIds: [],
      markersAvailable: true,
    }
    result.target.kind = 'floor-boundary'
    result.target.id = 'floor-1'
    const repeated = structuredClone(result.row)
    repeated.labelId = 'dimension-repeat'
    repeated.valueMm = valueMm
    result.report.observations.push(repeated)
    const caption = result.packet.sourceCaptionBindings?.candidates[0]
    if (!caption) throw new Error('Missing source caption')
    result.packet.sourceCaptionBindings?.candidates.push({
      ...structuredClone(caption),
      labelId: repeated.labelId,
      compactIndex: 2,
      valueMm,
      rail: { operationIndex: 3, subpathIndex: 0 },
    })
    if (valueMm !== result.row.valueMm) {
      for (const row of [result.row, repeated]) {
        row.status = 'conflict'
        row.reason = 'conflicting-whole-floor-dimensions'
      }
    }
    return { ...result, repeated }
  }
  it.each([2000, 2001])(
    'retains repeated whole-floor values %s with group-wide conflict evidence',
    async (value) => {
      const { packet, headers, report, row, repeated } = repeatedFloorFixture(value)
      const before = structuredClone(packet)
      expect((await loadFixture(packet, headers)).packet.dimensionTargets).toEqual(report)
      expect(row.status).toBe(value === 2000 ? 'continuous' : 'conflict')
      expect(repeated.status).toBe(row.status)
      expect(row.targets[0]?.faces[0]?.status).toBe('continuous')
      expect(packet).toEqual(before)
    },
  )
  it('preserves literal detached witnesses within a conflicting floor group', async () => {
    const { packet, headers, report, row, repeated } = repeatedFloorFixture(2100)
    for (const item of [row, repeated]) {
      const face = item.targets[0]?.faces[0]
      if (!face) throw new Error('Missing repeated floor face')
      face.status = 'detached'
      face.reason = 'detached-source-extension'
      face.endpointWitnesses[0].status = 'detached'
      face.endpointWitnesses[0].gapPoints = 0.00001
    }
    expect((await loadFixture(packet, headers)).packet.dimensionTargets).toEqual(report)
  })
  it.each(['axis', 'edge', 'floor'] as const)(
    'does not group a repeated caption with a different %s',
    async (change) => {
      const { packet, headers, report, row, repeated } = repeatedFloorFixture(2100)
      for (const item of [row, repeated]) {
        item.status = 'continuous'
        item.reason = null
      }
      const target = repeated.targets[0]
      if (!target) throw new Error('Missing repeated floor target')
      if (change === 'axis') {
        repeated.axis = 'depth'
        const caption = packet.sourceCaptionBindings?.candidates.at(-1)
        if (!caption) throw new Error('Missing repeated source caption')
        caption.axis = 'depth'
        caption.angleDegrees = 90
      }
      if (change === 'edge') Object.assign(target.faces[0] ?? {}, { edgeIndex: 2 })
      if (change === 'floor') {
        const floor = packet.floorCavities?.candidates[0]
        if (!floor) throw new Error('Missing source floor')
        packet.floorCavities?.candidates.push({ ...structuredClone(floor), id: 'floor-2' })
        target.id = 'floor-2'
      }
      expect((await loadFixture(packet, headers)).packet.dimensionTargets).toEqual(report)
      row.status = repeated.status = 'conflict'
      row.reason = repeated.reason = 'conflicting-whole-floor-dimensions'
      await expect(loadFixture(packet, headers)).rejects.toMatchObject({ status: 422 })
    },
  )
  it.each([
    'one-suppressed',
    'both-suppressed',
    'reason',
    'face-conflict',
    'witness-conflict',
    'ambiguous-face',
  ])('rejects corrupted whole-floor conflicts: %s', async (change) => {
    const { packet, headers, row, repeated, face } = repeatedFloorFixture(2100)
    if (change === 'one-suppressed' || change === 'both-suppressed') {
      row.status = 'continuous'
      row.reason = null
    }
    if (change === 'both-suppressed') {
      repeated.status = 'continuous'
      repeated.reason = null
    }
    if (change === 'reason') row.reason = 'different-conflict'
    if (change === 'face-conflict') Object.assign(face, { status: 'conflict' })
    if (change === 'witness-conflict')
      Object.assign(face.endpointWitnesses[0], { status: 'conflict' })
    if (change === 'ambiguous-face') {
      face.status = 'ambiguous'
      face.reason = 'ambiguous-source-witness'
      Object.assign(face.endpointWitnesses[0], {
        status: 'ambiguous',
        gapPoints: null,
        sourceRefs: [
          { operationIndex: 11, subpathIndex: 0, segmentIndex: 0 },
          { operationIndex: 13, subpathIndex: 0, segmentIndex: 0 },
        ],
      })
    }
    await expect(loadFixture(packet, headers)).rejects.toMatchObject({ status: 422 })
  })
  it('rejects invented conflicts on matching floor values and a lone frame face', async () => {
    const floor = repeatedFloorFixture(2000)
    floor.row.status = 'conflict'
    floor.row.reason = 'conflicting-whole-floor-dimensions'
    await expect(loadFixture(floor.packet, floor.headers)).rejects.toMatchObject({ status: 422 })
    const frame = targetFixture()
    frame.row.status = 'conflict'
    frame.row.reason = 'conflicting-whole-floor-dimensions'
    await expect(loadFixture(frame.packet, frame.headers)).rejects.toMatchObject({ status: 422 })
  })
  it('holds omitted whole-floor ink without discarding literal endpoint witnesses', async () => {
    const { packet, headers, report, row, repeated } = repeatedFloorFixture(2100)
    const floor = packet.floorCavities?.candidates[0]
    if (!floor) throw new Error('Missing floor parent')
    floor.omittedBoundaryInkCount = 1
    for (const item of [row, repeated]) {
      const face = item.targets[0]?.faces[0]
      if (!face) throw new Error('Missing floor face')
      item.status = face.status = 'unresolved'
      item.reason = face.reason = 'omitted-ink-near-source-target'
    }
    expect((await loadFixture(packet, headers)).packet.dimensionTargets).toEqual(report)
    expect(row.targets[0]?.faces[0]?.endpointWitnesses[0]?.status).toBe('continuous')
  })
  it.each(['continuous', 'detached', 'ambiguous', 'conflict'] as const)(
    'rejects %s promotion of omitted whole-floor ink',
    async (status) => {
      const { packet, headers, row, repeated } = repeatedFloorFixture(
        status === 'conflict' ? 2100 : 2000,
      )
      const floor = packet.floorCavities?.candidates[0]
      if (!floor) throw new Error('Missing floor parent')
      floor.omittedBoundaryInkCount = 1
      if (status !== 'conflict') {
        for (const item of [row, repeated]) {
          const face = item.targets[0]?.faces[0]
          if (!face) throw new Error('Missing floor face')
          item.status = face.status = status
          item.reason = face.reason = status === 'continuous' ? null : 'source-witness-held'
          if (status === 'detached') {
            face.endpointWitnesses[0].status = status
            face.endpointWitnesses[0].gapPoints = 0.1
          }
          if (status === 'ambiguous') {
            Object.assign(face.endpointWitnesses[0], {
              status,
              gapPoints: null,
              sourceRefs: [
                { operationIndex: 11, subpathIndex: 0, segmentIndex: 0 },
                { operationIndex: 13, subpathIndex: 0, segmentIndex: 0 },
              ],
            })
          }
        }
      }
      await expect(loadFixture(packet, headers)).rejects.toMatchObject({ status: 422 })
    },
  )
  function pairedJambFixture() {
    const result = targetFixture()
    result.row.status = 'ambiguous'
    result.row.reason = 'source-target-face-alternatives'
    result.target.faces.push({ ...structuredClone(result.face), edgeIndex: 2 })
    for (const face of result.target.faces)
      face.supportRefs.push(
        { operationIndex: 11, subpathIndex: 0, segmentIndex: 0 },
        { operationIndex: 12, subpathIndex: 0, segmentIndex: 0 },
      )
    const span: NonNullable<typeof result.report.jambSpans>[number] = {
      labelId: result.row.labelId,
      frameId: result.target.id,
      valueMm: result.row.valueMm,
      axis: 'width',
      status: 'continuous',
      faceEdgeIndexes: [0, 2],
      jambRefs: [
        [
          { operationIndex: 1, subpathIndex: 0, segmentIndex: 1 },
          { operationIndex: 11, subpathIndex: 0, segmentIndex: 0 },
        ],
        [
          { operationIndex: 1, subpathIndex: 0, segmentIndex: 3 },
          { operationIndex: 12, subpathIndex: 0, segmentIndex: 0 },
        ],
      ],
    }
    result.report.jambSpans = [span]
    return { ...result, span }
  }
  it('keeps one paired-jamb interval separate from alternative long faces', async () => {
    const { packet, headers, report } = pairedJambFixture()
    const before = structuredClone(packet)
    expect((await loadFixture(packet, headers)).packet.dimensionTargets).toEqual(report)
    expect(packet).toEqual(before)
  })
  it.each([
    'parent-frame',
    'value',
    'axis',
    'same-side',
    'empty-side',
    'unknown-ref',
    'duplicate-label',
    'unknown-key',
    'missing-face',
    'fractional-face',
    'invented-conflict',
    'foreign-ref',
    'missing-jamb-edge',
    'long-face-jamb',
    'adjacent-faces',
  ])('rejects invalid paired-jamb report: %s', async (change) => {
    const { packet, headers, report, span, target } = pairedJambFixture()
    if (change === 'parent-frame') span.frameId = 'missing-frame'
    if (change === 'value') span.valueMm += 1
    if (change === 'axis') span.axis = 'depth'
    if (change === 'same-side') span.jambRefs[1] = span.jambRefs[0]
    if (change === 'empty-side') span.jambRefs[0] = []
    if (change === 'unknown-ref') Object.assign(span.jambRefs[0][0] ?? {}, { physicalWall: true })
    if (change === 'duplicate-label') report.jambSpans?.push(structuredClone(span))
    if (change === 'unknown-key') Object.assign(span, { accepted: true })
    if (change === 'missing-face') span.faceEdgeIndexes = [0, 1]
    if (change === 'fractional-face') span.faceEdgeIndexes = [0, 2.1]
    if (change === 'invented-conflict') span.status = 'conflict'
    if (change === 'foreign-ref')
      span.jambRefs[0].push({ operationIndex: 999, subpathIndex: 0, segmentIndex: 0 })
    if (change === 'missing-jamb-edge') span.jambRefs[0].shift()
    if (change === 'long-face-jamb') Object.assign(span.jambRefs[0][0] ?? {}, { segmentIndex: 0 })
    if (change === 'adjacent-faces') {
      span.faceEdgeIndexes = [0, 1]
      Object.assign(target.faces[1] ?? {}, { edgeIndex: 1 })
      Object.assign(span.jambRefs[0][0] ?? {}, { segmentIndex: 2 })
    }
    await expect(loadFixture(packet, headers)).rejects.toMatchObject({ status: 422 })
  })
  it('requires unique glyph text-show operations even for distinct labels, slots and rails', async () => {
    const { packet, headers } = targetFixture()
    const first = packet.sourceCaptionBindings?.candidates[0]
    const second = packet.sourceCaptionBindings?.candidates[1]
    if (!first || !second) throw new Error('Missing glyph caption candidates')
    first.textPlacement = 'glyph-ink'
    first.inkSourceOperation = 21
    expect((await loadFixture(packet, headers)).packet.sourceCaptionBindings).toEqual(
      packet.sourceCaptionBindings,
    )
    first.inkSourceOperation = second.inkSourceOperation
    await expect(loadFixture(packet, headers)).rejects.toMatchObject({ status: 422 })
  })
  it('accepts old optional-field absence and an atomic target refusal', async () => {
    const { packet, headers, report } = targetFixture()
    for (const item of packet.sourceCaptionBindings?.candidates ?? []) {
      delete item.angleDegrees
      delete item.textPlacement
      delete item.inkSourceOperation
    }
    delete packet.dimensionTargets
    expect((await loadFixture(packet, headers)).packet.dimensionTargets).toBeUndefined()
    packet.dimensionTargets = {
      ...report,
      status: 'unresolved',
      refusalReason: 'source-targets-unavailable',
      observations: [],
      unresolved: [],
    }
    expect((await loadFixture(packet, headers)).packet.dimensionTargets).toEqual(
      packet.dimensionTargets,
    )
  })
  it('accepts an empty draft target inventory without inventing parent layers', async () => {
    const { packet, headers } = fixture()
    packet.sourceCaptionBindings = {
      status: 'draft',
      refusalReason: null,
      candidates: [],
      unresolved: [],
    }
    packet.dimensionTargets = {
      status: 'draft',
      refusalReason: null,
      observations: [],
      unresolved: [],
    }
    expect((await loadFixture(packet, headers)).packet.dimensionTargets).toEqual(
      packet.dimensionTargets,
    )
    expect(packet.floorCavities).toBeUndefined()
    expect(packet.openingFrames).toBeUndefined()
  })
  it.each(['detached', 'ambiguous', 'unresolved'] as const)(
    'retains %s witnesses honestly',
    async (status) => {
      const { packet, headers, report, row, face } = targetFixture()
      row.status = face.status = status
      row.reason = face.reason = 'source-witness-held'
      const witness = face.endpointWitnesses[0]
      witness.status = status
      if (status === 'detached') witness.gapPoints = 0.00001
      if (status === 'ambiguous') {
        witness.gapPoints = null
        witness.sourceRefs.push({ operationIndex: 13, subpathIndex: 0, segmentIndex: 0 })
      }
      if (status === 'unresolved') {
        witness.gapPoints = null
        witness.sourceRefs = []
      }
      expect((await loadFixture(packet, headers)).packet.dimensionTargets).toEqual(report)
    },
  )
  it('keeps alternative faces ambiguous and validates parent floor edge inventories', async () => {
    const { packet, headers, report, row, target, face } = targetFixture()
    packet.numberCircles = { status: 'draft', refusalReason: null, cues: [] }
    packet.floorCavities = {
      status: 'draft',
      refusalReason: null,
      candidates: [
        {
          id: 'floor-1',
          polygon: openingFrames().candidates[0]?.polygon ?? [],
          markerLabelIds: [],
          markerStatus: 'unmarked',
          closureIds: [],
          unknownInteriorStrokeCount: 0,
          omittedBoundaryInkCount: 0,
        },
      ],
      thresholds: [],
      closures: [],
      unprovedCavities: [],
      unresolvedMarkerLabelIds: [],
      markersAvailable: true,
    }
    target.kind = 'floor-boundary'
    target.id = 'floor-1'
    target.faces.push({ ...structuredClone(face), edgeIndex: 1 })
    row.status = 'ambiguous'
    row.reason = 'source-target-face-alternatives'
    expect((await loadFixture(packet, headers)).packet.dimensionTargets).toEqual(report)
    const sourceFloor = packet.floorCavities
    delete packet.floorCavities
    await expect(loadFixture(packet, headers)).rejects.toMatchObject({ status: 422 })
    packet.floorCavities = sourceFloor
    face.edgeIndex = 4
    await expect(loadFixture(packet, headers)).rejects.toMatchObject({ status: 422 })
  })
  it.each([
    'angle-nan',
    'angle-infinity',
    'angle-string',
    'angle-large',
    'angle-axis',
    'placement',
    'glyph-missing-ref',
    'glyph-ref-negative',
    'glyph-ref-fraction',
    'glyph-ref-unsafe',
    'baseline-ref',
    'orphan-ref',
    'span-coordinates',
  ])('rejects corrupted rotated caption metadata: %s', async (change) => {
    const { packet, headers } = targetFixture()
    const candidate = packet.sourceCaptionBindings?.candidates[1]
    if (!candidate) throw new Error('Missing rotated candidate')
    if (change === 'angle-nan') candidate.angleDegrees = Number.NaN
    if (change === 'angle-infinity') candidate.angleDegrees = Number.POSITIVE_INFINITY
    if (change === 'angle-string') Object.assign(candidate, { angleDegrees: '-44' })
    if (change === 'angle-large') candidate.angleDegrees = 361
    if (change === 'angle-axis') candidate.angleDegrees = 90
    if (change === 'placement') Object.assign(candidate, { textPlacement: 'nearest' })
    if (change === 'glyph-missing-ref') delete candidate.inkSourceOperation
    if (change === 'glyph-ref-negative') candidate.inkSourceOperation = -1
    if (change === 'glyph-ref-fraction') candidate.inkSourceOperation = 0.5
    if (change === 'glyph-ref-unsafe') candidate.inkSourceOperation = Number.MAX_SAFE_INTEGER + 1
    if (change === 'baseline-ref') candidate.textPlacement = 'baseline'
    if (change === 'orphan-ref') delete candidate.textPlacement
    if (change === 'span-coordinates')
      Object.assign(candidate, {
        spanEnds: [
          { x: 1, y: 2 },
          { x: 3, y: 4 },
        ],
      })
    await expect(loadFixture(packet, headers)).rejects.toMatchObject({ status: 422 })
  })
  it.each([
    'authority',
    'null-report',
    'null-observations',
    'missing-caption-parent',
    'missing-frame-parent',
    'held-nonempty',
    'unknown-label',
    'duplicate-label',
    'missing-label',
    'value',
    'axis',
    'status',
    'reason',
    'row-coordinates',
    'target-kind',
    'target-id',
    'target-extra',
    'duplicate-target',
    'no-faces',
    'edge-negative',
    'edge-large',
    'edge-fraction',
    'duplicate-edge',
    'face-extra',
    'face-status',
    'face-reason',
    'support-empty',
    'ref-negative',
    'ref-fraction',
    'ref-unsafe',
    'ref-extra',
    'duplicate-ref',
    'witness-count',
    'witness-extra',
    'witness-status',
    'gap-positive-continuous',
    'gap-negative',
    'gap-infinite',
    'gap-null',
    'continuous-with-unresolved',
    'detached-zero',
    'ambiguous-one-ref',
    'unresolved-with-ref',
    'held-unknown',
    'held-reason',
    'inventory-limit',
  ])('rejects malformed or overclaimed target report: %s', async (change) => {
    const { packet, headers, report, row, target, face } = targetFixture()
    const witness = face.endpointWitnesses[0]
    const ref = face.supportRefs[0]
    if (!ref) throw new Error('Missing source ref')
    if (change === 'authority') Object.assign(report, { mayTransfer2D: true })
    if (change === 'null-report') Object.assign(packet, { dimensionTargets: null })
    if (change === 'null-observations') Object.assign(report, { observations: null })
    if (change === 'missing-caption-parent') delete packet.sourceCaptionBindings
    if (change === 'missing-frame-parent') delete packet.openingFrames
    if (change === 'held-nonempty')
      Object.assign(report, { status: 'unresolved', refusalReason: 'held' })
    if (change === 'unknown-label') row.labelId = 'unknown'
    if (change === 'duplicate-label') report.observations.push(structuredClone(row))
    if (change === 'missing-label') report.observations.pop()
    if (change === 'value') row.valueMm = 2001
    if (change === 'axis') row.axis = 'depth'
    if (change === 'status') Object.assign(row, { status: 'accepted' })
    if (change === 'reason') row.reason = 'not-actually-continuous'
    if (change === 'row-coordinates') Object.assign(row, { start: { x: 1, y: 2 } })
    if (change === 'target-kind') Object.assign(target, { kind: 'wall' })
    if (change === 'target-id') target.id = 'unknown-frame'
    if (change === 'target-extra') Object.assign(target, { accepted: true })
    if (change === 'duplicate-target') row.targets.push(structuredClone(target))
    if (change === 'no-faces') target.faces = []
    if (change === 'edge-negative') face.edgeIndex = -1
    if (change === 'edge-large') face.edgeIndex = 4
    if (change === 'edge-fraction') face.edgeIndex = 0.5
    if (change === 'duplicate-edge') target.faces.push(structuredClone(face))
    if (change === 'face-extra') Object.assign(face, { calibrated: true })
    if (change === 'face-status') Object.assign(face, { status: 'accepted' })
    if (change === 'face-reason') face.reason = 'bad'
    if (change === 'support-empty') face.supportRefs = []
    if (change === 'ref-negative') ref.operationIndex = -1
    if (change === 'ref-fraction') ref.subpathIndex = 0.5
    if (change === 'ref-unsafe') ref.segmentIndex = Number.MAX_SAFE_INTEGER + 1
    if (change === 'ref-extra') Object.assign(ref, { x: 1 })
    if (change === 'duplicate-ref') face.supportRefs.push({ ...ref })
    if (change === 'witness-count') Object.assign(face, { endpointWitnesses: [witness] })
    if (change === 'witness-extra') Object.assign(witness, { clearanceCm: 1 })
    if (change === 'witness-status') Object.assign(witness, { status: 'accepted' })
    if (change === 'gap-positive-continuous') witness.gapPoints = 0.001
    if (change === 'gap-negative') witness.gapPoints = -1
    if (change === 'gap-infinite') witness.gapPoints = Number.POSITIVE_INFINITY
    if (change === 'gap-null') witness.gapPoints = null
    if (change === 'continuous-with-unresolved') {
      witness.status = 'unresolved'
      witness.gapPoints = null
      witness.sourceRefs = []
    }
    if (change === 'detached-zero') {
      witness.status = 'detached'
      row.status = face.status = 'detached'
      row.reason = face.reason = 'detached'
    }
    if (change === 'ambiguous-one-ref') {
      witness.status = 'ambiguous'
      witness.gapPoints = null
      row.status = face.status = 'ambiguous'
      row.reason = face.reason = 'ambiguous'
    }
    if (change === 'unresolved-with-ref') {
      witness.status = 'unresolved'
      witness.gapPoints = null
      row.status = face.status = 'unresolved'
      row.reason = face.reason = 'unresolved'
    }
    if (change === 'held-unknown') Object.assign(report.unresolved[0] ?? {}, { labelId: 'unknown' })
    if (change === 'held-reason') Object.assign(report.unresolved[0] ?? {}, { reason: 'changed' })
    if (change === 'inventory-limit')
      report.observations = Array.from({ length: 1001 }, () => structuredClone(row))
    await expect(loadFixture(packet, headers)).rejects.toMatchObject({ status: 422 })
  })
})

describe('optional literal height diagnostics, never a 3D acceptance gate', () => {
  function heightFixture() {
    const result = fixture()
    result.packet.extraction.skippedCurves = 45
    result.packet.extraction.clippedPaths = 18
    const heights: NonNullable<NativeReviewPacket['heightObservations']> = {
      status: 'draft',
      refusalReason: null,
      observations: [
        {
          labelId: 'native-text-20',
          originalText: 'h потолок натяжной-2672мм',
          valueMm: 2672,
          quantityKind: 'finished-ceiling',
          datum: 'unspecified',
          issueCodes: ['height-datum-unverified'],
          mayAcceptFor3D: false,
        },
      ],
      issues: [
        {
          labelId: 'native-text-20',
          originalText: 'h потолок натяжной-2672мм',
          code: 'height-datum-unverified',
        },
      ],
      omissionCounts: { skippedCurves: 45, clippedPaths: 18 },
    }
    result.packet.heightObservations = heights
    return { ...result, heights }
  }

  function documentaryHeightFixture(inkSourceOperation: number | null = null) {
    const result = heightFixture()
    const row = result.heights.observations[0]
    if (!row) throw new Error('Missing height fixture')
    Object.assign(row, {
      originalText: 'Н=3790',
      valueMm: 3790,
      quantityKind: 'unclassified-height',
      issueCodes: [
        'height-role-unclassified',
        'height-datum-unverified',
        ...(inkSourceOperation === null ? ['height-unit-ink-unverified'] : []),
      ],
      unitEvidence: {
        kind: 'same-page-millimetre-declaration',
        labelId: 'native-text-237',
        originalText: '5. Размеры указаны в миллиметрах',
        nativeIndex: 237,
        inkSourceOperation,
        source: structuredClone(result.packet.source),
      },
    })
    result.heights.issues = row.issueCodes.map((code) => ({
      labelId: row.labelId,
      originalText: row.originalText,
      code,
    }))
    return { ...result, row }
  }

  it.each([null, 19])(
    'accepts documentary height with separately retained note glyph operation %s',
    async (operation) => {
      const { packet, headers, heights } = documentaryHeightFixture(operation)
      expect((await loadFixture(packet, headers)).packet.heightObservations).toEqual(heights)
    },
  )

  it.each([
    'null',
    'extra-key',
    'kind',
    'label-alias',
    'same-label',
    'bad-index',
    'unsafe-index',
    'bad-caption-id',
    'negative-operation',
    'fractional-operation',
    'missing-operation',
    'source-sha',
    'source-page',
    'source-state',
    'source-extra',
    'note-negated',
    'note-exception',
    'note-unit',
    'note-hidden',
    'inline-alias',
    'value',
    'role',
    'datum',
    'authority',
    'missing-ink-code',
    'unexpected-ink-code',
    'extra-code',
    'conflicting-note',
    'conflicting-operation',
  ])('rejects malformed or authoritative documentary height: %s', async (change) => {
    const { packet, headers, heights, row } = documentaryHeightFixture()
    const units = row.unitEvidence
    if (!units) throw new Error('Missing documentary units fixture')
    if (change === 'null') Object.assign(row, { unitEvidence: null })
    if (change === 'extra-key') Object.assign(units, { verified: true })
    if (change === 'kind') Object.assign(units, { kind: 'inline-mm' })
    if (change === 'label-alias') units.labelId = 'native-text-0237'
    if (change === 'same-label') {
      units.labelId = row.labelId
      units.nativeIndex = 20
    }
    if (change === 'bad-index') units.nativeIndex = -1
    if (change === 'unsafe-index') units.nativeIndex = 1000
    if (change === 'bad-caption-id') row.labelId = 'fake-text-20'
    if (change === 'negative-operation') units.inkSourceOperation = -1
    if (change === 'fractional-operation') units.inkSourceOperation = 1.5
    if (change === 'missing-operation') Object.assign(units, { inkSourceOperation: undefined })
    if (change === 'source-sha') units.source.sha256 = 'c'.repeat(64)
    if (change === 'source-page') units.source.pdfPage++
    if (change === 'source-state') units.source.state = 'proposed'
    if (change === 'source-extra') Object.assign(units.source, { accepted: true })
    if (change === 'note-negated') units.originalText = 'Размеры не указаны в миллиметрах'
    if (change === 'note-exception') units.originalText += ', кроме высот'
    if (change === 'note-unit') units.originalText = 'Размеры указаны в метрах'
    if (change === 'note-hidden') units.originalText = 'Раз\u200bмеры указаны в миллиметрах'
    if (change === 'inline-alias') row.originalText = 'Н=3790 мм'
    if (change === 'value') row.valueMm++
    if (change === 'role') row.quantityKind = 'finished-ceiling'
    if (change === 'datum') row.datum = 'finished-floor'
    if (change === 'authority') Object.assign(row, { mayAcceptFor3D: true })
    if (change === 'missing-ink-code') row.issueCodes.pop()
    if (change === 'unexpected-ink-code') units.inkSourceOperation = 19
    if (change === 'extra-code') row.issueCodes.push('verified-native-units')
    if (change === 'conflicting-note' || change === 'conflicting-operation') {
      const other = structuredClone(row)
      other.labelId = 'native-text-21'
      if (!other.unitEvidence) throw new Error('Missing second units fixture')
      if (change === 'conflicting-note') {
        other.unitEvidence.nativeIndex = 238
        other.unitEvidence.labelId = 'native-text-238'
      } else other.unitEvidence.inkSourceOperation = 19
      heights.observations.push(other)
    }
    heights.issues = heights.observations.flatMap((observation) =>
      observation.issueCodes.map((code) => ({
        labelId: observation.labelId,
        originalText: observation.originalText,
        code,
      })),
    )
    await expect(loadFixture(packet, headers)).rejects.toMatchObject({ status: 422 })
  })

  const realHeightSource = fileURLToPath(
    new URL('../../../../output/pdf/source-search-20261003/rebrina-original.pdf', import.meta.url),
  )
  it.skipIf(!existsSync(realHeightSource))(
    'loads the actual original Rebrina packet and image without documentary height 422',
    async () => {
      const bytes = await readFile(realHeightSource)
      const sha256 = createHash('sha256').update(bytes).digest('hex')
      expect(sha256).toBe('2e141c135812c81719e1f4783173cb5202e20041ac494d3cc799eb37ad62ad4e')
      const { preparePlanPage } = await import('./plan-document')
      const page = await preparePlanPage(bytes, true, 3, true, true)
      const imageSha256 = createHash('sha256').update(page.image.body).digest('hex')
      const packet = nativeReviewPacket({
        source: { sha256, pdfPage: 3, state: 'existing' },
        image: { sha256: imageSha256, page: 3, width: page.image.width, height: page.image.height },
        native: page.nativeTextAnchors,
        work: page.linework,
        lineworkSource: page.lineworkRasterSource,
      })
      packet.sourceRevision = revision
      const headers = {
        'content-type': 'image/jpeg',
        'x-plan-sha256': sha256,
        'x-plan-image-sha256': imageSha256,
        'x-plan-page': '3',
        'x-plan-image-width': String(page.image.width),
        'x-plan-image-height': String(page.image.height),
      }
      const loaded = (
        await loadFixture(packet, headers, { imageBody: new Uint8Array(page.image.body), page: 3 })
      ).packet
      expect(loaded.heightObservations?.observations).toHaveLength(10)
      expect(loaded.heightObservations?.observations[0]?.unitEvidence?.inkSourceOperation).toBe(
        14076,
      )
      expect(loaded.readiness).toEqual({ readOnly: true, readyFor2D: false, readyFor3D: false })
    },
  )

  it('retains raw source text, unresolved datum and exact parent omission counts', async () => {
    const { packet, headers, heights } = heightFixture()
    const loaded = (await loadFixture(packet, headers)).packet
    expect(loaded.heightObservations).toEqual(heights)
    expect(loaded.heightObservations?.observations[0]?.mayAcceptFor3D).toBe(false)
    expect(loaded.readiness).toEqual({ readOnly: true, readyFor2D: false, readyFor3D: false })
  })

  function heightLocationsFixture() {
    const result = heightFixture()
    result.packet.openingFrames = { status: 'draft', refusalReason: null, candidates: [] }
    result.packet.numberCircles = { status: 'draft', refusalReason: null, cues: [] }
    result.packet.floorCavities = {
      status: 'draft',
      refusalReason: null,
      candidates: [100, 500].map((x, index) => ({
        id: `height-cavity-${index}`,
        polygon: [
          { x, y: 100 },
          { x: x + 200, y: 100 },
          { x: x + 200, y: 300 },
          { x, y: 300 },
        ],
        markerLabelIds: [],
        markerStatus: 'unmarked',
        closureIds: [],
        unknownInteriorStrokeCount: 0,
        omittedBoundaryInkCount: 0,
      })),
      thresholds: [],
      closures: [],
      unprovedCavities: [],
      unresolvedMarkerLabelIds: [],
      markersAvailable: true,
    }
    const locations: NonNullable<typeof result.heights.locations> = {
      status: 'draft',
      refusalReason: null,
      observations: [
        {
          labelId: 'native-text-20',
          status: 'inside-single-cavity',
          cavityIds: ['height-cavity-0'],
          inkSourceOperation: 20,
          reason: null,
        },
      ],
    }
    result.heights.locations = locations
    return { ...result, locations }
  }

  function heightLeaderFixture() {
    const fixture = heightLocationsFixture()
    const row = fixture.locations.observations[0]
    if (!row) throw new Error('Height location fixture is missing')
    const leader: NonNullable<typeof row.leader> = {
      status: 'linked',
      reason: null,
      cavityIds: ['height-cavity-0'],
      source: {
        boxRefs: [{ operationIndex: 30, subpathIndex: 0 }],
        stemRefs: [
          { operationIndex: 32, subpathIndex: 0, segmentIndex: 1 },
          { operationIndex: 31, subpathIndex: 0, segmentIndex: 0 },
        ],
        arrowRef: { operationIndex: 33, subpathIndex: 0 },
      },
    }
    row.leader = leader
    return { ...fixture, row, leader }
  }

  function syncHeightNoteIssues(packet: NativeReviewPacket) {
    const heights = packet.heightObservations
    const objects = packet.heightObjects
    if (!heights || !objects) throw new Error('Missing height note fixture')
    const fixtureNoteIds = new Set(['native-text-200', 'native-text-201', 'native-text-202'])
    heights.issues = heights.issues.filter((issue) => !fixtureNoteIds.has(issue.labelId))
    for (const note of [...objects.declarations, ...objects.unsupportedDeclarations]) {
      heights.issues.push({
        labelId: note.labelId,
        originalText: note.originalText,
        code: 'multiple-height-quantities',
      })
    }
  }

  function heightObjectFixture() {
    const fixture = heightLeaderFixture()
    const { packet } = fixture
    packet.numberCircles = {
      status: 'draft',
      refusalReason: null,
      cues: [{ labelId: 'circle-1', sourceNumber: 1 }],
    }
    const cavity = packet.floorCavities?.candidates[0]
    if (!cavity) throw new Error('Missing floor fixture')
    cavity.markerLabelIds = ['circle-1']
    cavity.markerStatus = 'unambiguous'
    packet.roomSchedule = {
      status: 'draft',
      refusalReason: null,
      unlistedMarkerLabelIds: [],
      rows: ['Гостиная', 'Кухня', 'Балкон'].map((name, index) => ({
        sourceNumber: index + 1,
        name,
        documentaryAreaM2: 10,
        numberLabelId: `table-number-${index}`,
        nameLabelId: `table-name-${index}`,
        areaLabelId: `table-area-${index}`,
        markerStatus: index === 0 ? 'linked' : 'unobserved',
        markerLabelIds: index === 0 ? ['circle-1'] : [],
      })),
    }
    const objects: NonNullable<NativeReviewPacket['heightObjects']> = {
      status: 'draft',
      refusalReason: null,
      unsupportedDeclarations: [],
      declarations: [
        {
          labelId: 'native-text-200',
          originalText:
            'Потолок в квартире - натяжной, отметки потолка в пределах: от 2600 мм до 2800 мм от уровня существующего пола.',
          scope: 'apartment-finished-ceilings',
          datum: 'existing-floor',
          minimumMm: 2600,
          maximumMm: 2800,
          status: 'verified',
          inkSourceOperation: 200,
          reason: null,
        },
      ],
      bindings: [
        {
          labelId: 'native-text-20',
          objectStatus: 'proposed',
          objectReason: null,
          targets: [
            {
              kind: 'finished-ceiling',
              cavityId: 'height-cavity-0',
              sourceRoomNumber: 1,
              roomName: 'Гостиная',
              markerLabelId: 'circle-1',
            },
          ],
          datumEvidence: {
            status: 'documentary',
            kind: 'existing-floor',
            sourceLabelIds: ['native-text-200'],
            reason: null,
          },
        },
      ],
    }
    packet.heightObjects = objects
    syncHeightNoteIssues(packet)
    const binding = objects.bindings[0]
    const target = binding?.targets[0]
    const declaration = objects.declarations[0]
    const schedule = packet.roomSchedule
    if (!binding || !target || !declaration || !schedule) throw new Error('Missing object fixture')
    return { ...fixture, objects, binding, target, declaration, cavity, schedule }
  }

  it('preserves source-object proposals and documentary reference kinds without promoting geometry or zero', async () => {
    const { packet, headers, objects } = heightObjectFixture()
    const before = structuredClone(packet)
    const loaded = (await loadFixture(packet, headers)).packet
    expect(loaded.heightObjects).toEqual(objects)
    expect(packet).toEqual(before)
    expect(loaded.readiness).toEqual({ readOnly: true, readyFor2D: false, readyFor3D: false })
  })

  it('does not reinterpret unknown interior annotation strokes as a rejected source-object proposal', async () => {
    const { packet, headers, objects, cavity } = heightObjectFixture()
    cavity.unknownInteriorStrokeCount = 166
    const loaded = (await loadFixture(packet, headers)).packet
    expect(loaded.heightObjects).toEqual(objects)
    expect(loaded.floorCavities?.candidates[0]?.unknownInteriorStrokeCount).toBe(166)
    expect(loaded.readiness).toEqual({ readOnly: true, readyFor2D: false, readyFor3D: false })
  })

  it.each([
    'extra-report-key',
    'accepted',
    'missing-binding',
    'duplicate-binding',
    'unknown-height',
    'forged-object',
    'missing-target',
    'wrong-cavity',
    'wrong-room',
    'wrong-marker',
    'wrong-number',
    'wrong-kind',
    'extra-target-key',
    'wrong-datum',
    'zero-kind',
    'missing-note-ref',
    'unknown-note-ref',
    'duplicate-note',
    'forged-range',
    'forged-literal',
    'unverified-note',
    'extra-note-key',
    'duplicate-operation',
    'missing-locations',
    'missing-schedule',
    'malformed-schedule',
    'omitted-boundary-floor',
    'missing-leader',
    'partial-binding',
    'extra-datum-key',
  ] as const)('rejects forged height-object or reference evidence: %s', async (change) => {
    const { packet, headers, objects, row, binding, target, declaration, cavity, schedule } =
      heightObjectFixture()
    if (change === 'extra-report-key') Object.assign(objects, { commonZeroConfirmed: true })
    if (change === 'accepted') Object.assign(objects, { status: 'accepted' })
    if (change === 'missing-binding') objects.bindings = []
    if (change === 'duplicate-binding') objects.bindings.push(structuredClone(binding))
    if (change === 'unknown-height') binding.labelId = 'unknown'
    if (change === 'forged-object')
      Object.assign(binding, { objectStatus: 'unresolved', objectReason: 'held' })
    if (change === 'missing-target') binding.targets = []
    if (change === 'wrong-cavity') target.cavityId = 'height-cavity-1'
    if (change === 'wrong-room') target.roomName = 'Кухня'
    if (change === 'wrong-marker') target.markerLabelId = 'circle-2'
    if (change === 'wrong-number') target.sourceRoomNumber = 2
    if (change === 'wrong-kind') Object.assign(target, { kind: 'wall-height' })
    if (change === 'extra-target-key') Object.assign(target, { acceptedOwner: true })
    if (change === 'wrong-datum') binding.datumEvidence.kind = 'finished-floor'
    if (change === 'zero-kind') Object.assign(binding.datumEvidence, { kind: 'shared-zero' })
    if (change === 'missing-note-ref') binding.datumEvidence.sourceLabelIds = []
    if (change === 'unknown-note-ref') binding.datumEvidence.sourceLabelIds = ['unknown']
    if (change === 'duplicate-note') objects.declarations.push(structuredClone(declaration))
    if (change === 'forged-range') declaration.minimumMm = 2500
    if (change === 'forged-literal') declaration.originalText = 'Потолок 2700 мм'
    if (change === 'unverified-note')
      Object.assign(declaration, {
        status: 'unresolved',
        inkSourceOperation: null,
        reason: 'height-datum-ink-unverified',
      })
    if (change === 'extra-note-key') Object.assign(declaration, { commonZeroConfirmed: true })
    if (change === 'duplicate-operation') declaration.inkSourceOperation = 20
    if (change === 'missing-locations') delete packet.heightObservations?.locations
    if (change === 'missing-schedule') delete packet.roomSchedule
    if (change === 'malformed-schedule') Object.assign(schedule, { rows: [null] })
    if (change === 'omitted-boundary-floor') {
      cavity.omittedBoundaryInkCount = 1
      Object.assign(row, {
        status: 'unresolved',
        reason: 'height-caption-boundary-or-ink-unverified',
      })
      Object.assign(row.leader ?? {}, {
        status: 'unresolved',
        reason: 'height-leader-target-unverified',
      })
    }
    if (change === 'missing-leader') delete row.leader
    if (change === 'partial-binding')
      objects.bindings.push({ ...structuredClone(binding), labelId: 'native-text-21' })
    if (change === 'extra-datum-key') Object.assign(binding.datumEvidence, { zeroMm: 0 })
    await expect(loadFixture(packet, headers)).rejects.toThrow()
  })

  it('holds all declarations and reference claims on conflicting literal note ranges', async () => {
    const { packet, headers, objects, declaration, binding } = heightObjectFixture()
    objects.declarations.push({
      ...structuredClone(declaration),
      labelId: 'native-text-201',
      originalText:
        'Потолок в квартире - натяжной, отметки потолка в пределах: от 2500 мм до 2800 мм от уровня существующего пола.',
      minimumMm: 2500,
      inkSourceOperation: 201,
    })
    for (const declaration of objects.declarations)
      Object.assign(declaration, {
        status: 'unresolved',
        reason: 'conflicting-ceiling-datum-declarations',
      })
    Object.assign(binding.datumEvidence, {
      status: 'unresolved',
      kind: null,
      sourceLabelIds: ['native-text-200', 'native-text-201'],
      reason: 'conflicting-ceiling-datum-declarations',
    })
    syncHeightNoteIssues(packet)
    expect((await loadFixture(packet, headers)).packet.heightObjects).toEqual(objects)
  })

  it('keeps an unsupported competing source note visible and refuses borrowing its reference', async () => {
    const { packet, headers, objects, binding } = heightObjectFixture()
    objects.unsupportedDeclarations.push({
      labelId: 'native-text-202',
      originalText:
        'Потолок в квартире - натяжной, отметки потолка в пределах: от 2600 мм до 2800 мм от уровня существующего пола, кроме кухни.',
      reason: 'unsupported-ceiling-datum-declaration',
    })
    Object.assign(binding.datumEvidence, {
      status: 'unresolved',
      kind: null,
      sourceLabelIds: ['native-text-200', 'native-text-202'],
      reason: 'unsupported-ceiling-datum-declarations',
    })
    syncHeightNoteIssues(packet)
    expect((await loadFixture(packet, headers)).packet.heightObjects).toEqual(objects)
    objects.unsupportedDeclarations = []
    Object.assign(binding.datumEvidence, {
      status: 'documentary',
      kind: 'existing-floor',
      sourceLabelIds: ['native-text-200'],
      reason: null,
    })
    await expect(loadFixture(packet, headers)).rejects.toThrow()
  })

  it.each([
    'missing-supported',
    'unknown-supported',
    'altered-source-text',
    'missing-unsupported-field',
    'null-unsupported-field',
    'wrong-unsupported-reason',
    'parsed-as-unsupported',
    'unrelated-as-unsupported',
    'duplicate-unsupported',
    'supported-unsupported-overlap',
    'unsafe-extra-key',
  ] as const)(
    'rejects incomplete or malformed source reference note inventories: %s',
    async (change) => {
      const { packet, headers, objects, declaration, binding } = heightObjectFixture()
      const unsupported = {
        labelId: 'native-text-202',
        originalText:
          'Потолок в квартире - натяжной, отметки потолка в пределах: от 2600 мм до 2800 мм от уровня существующего пола, кроме кухни.',
        reason: 'unsupported-ceiling-datum-declaration' as const,
      }
      objects.unsupportedDeclarations = [unsupported]
      Object.assign(binding.datumEvidence, {
        status: 'unresolved',
        kind: null,
        sourceLabelIds: ['native-text-200', 'native-text-202'],
        reason: 'unsupported-ceiling-datum-declarations',
      })
      syncHeightNoteIssues(packet)
      if (change === 'missing-supported') objects.declarations = []
      if (change === 'unknown-supported') declaration.labelId = 'unrelated-note'
      if (change === 'altered-source-text')
        declaration.originalText = declaration.originalText.replace('2600', '2500')
      if (change === 'missing-unsupported-field')
        Reflect.deleteProperty(objects, 'unsupportedDeclarations')
      if (change === 'null-unsupported-field')
        Object.assign(objects, { unsupportedDeclarations: null })
      if (change === 'wrong-unsupported-reason')
        Object.assign(unsupported, { reason: 'borrow-reference-anyway' })
      if (change === 'parsed-as-unsupported') unsupported.originalText = declaration.originalText
      if (change === 'unrelated-as-unsupported') unsupported.originalText = 'Текст о мебели'
      if (change === 'duplicate-unsupported')
        objects.unsupportedDeclarations.push(structuredClone(unsupported))
      if (change === 'supported-unsupported-overlap') unsupported.labelId = declaration.labelId
      if (change === 'unsafe-extra-key') Object.assign(unsupported, { commonZeroMm: 0 })
      await expect(loadFixture(packet, headers)).rejects.toThrow()
    },
  )

  it.each([
    'inline',
    'inline-conflict',
    'outside-range',
    'unverified-note',
    'no-reference',
    'non-ceiling',
    'no-ink',
    'no-leader',
    'no-schedule',
    'global-refusal',
  ] as const)(
    'replays held and documentary height-object states without creating a shared zero: %s',
    async (state) => {
      const { packet, headers, heights, objects, binding, declaration, row } = heightObjectFixture()
      const observation = heights.observations[0]
      if (!observation) throw new Error('Missing height fixture')
      if (state === 'inline' || state === 'inline-conflict') {
        observation.originalText = 'Чистый потолок 2672 мм от чистого пола'
        observation.datum = 'finished-floor'
        observation.issueCodes = []
        heights.issues = []
        binding.datumEvidence.sourceLabelIds.unshift(observation.labelId)
        if (state === 'inline') {
          objects.declarations = []
          binding.datumEvidence.sourceLabelIds = [observation.labelId]
          binding.datumEvidence.kind = 'finished-floor'
        } else
          Object.assign(binding.datumEvidence, {
            status: 'unresolved',
            kind: null,
            reason: 'inline-global-height-datum-conflict',
          })
      }
      if (state === 'outside-range') {
        declaration.minimumMm = 2700
        declaration.originalText = declaration.originalText.replace('2600', '2700')
        Object.assign(binding.datumEvidence, {
          status: 'unresolved',
          kind: null,
          reason: 'ceiling-height-outside-declared-range',
        })
      }
      if (state === 'unverified-note') {
        Object.assign(declaration, {
          status: 'unresolved',
          inkSourceOperation: null,
          reason: 'height-datum-ink-unverified',
        })
        Object.assign(binding.datumEvidence, {
          status: 'unresolved',
          kind: null,
          reason: 'height-datum-ink-unverified',
        })
      }
      if (state === 'no-reference') {
        objects.declarations = []
        Object.assign(binding.datumEvidence, {
          status: 'unresolved',
          kind: null,
          sourceLabelIds: [],
          reason: 'height-datum-unspecified',
        })
      }
      if (state === 'non-ceiling') {
        observation.originalText = 'h1 = 2672 мм'
        observation.quantityKind = 'unclassified-height'
        observation.issueCodes = ['height-role-unclassified', 'height-datum-unverified']
        heights.issues = observation.issueCodes.map((code) => ({
          labelId: observation.labelId,
          originalText: observation.originalText,
          code,
        }))
        Object.assign(binding, {
          objectStatus: 'unresolved',
          objectReason: 'height-object-role-unresolved',
          targets: [],
        })
        Object.assign(binding.datumEvidence, {
          status: 'unresolved',
          kind: null,
          sourceLabelIds: [],
          reason: 'height-object-role-unresolved',
        })
      }
      if (state === 'no-ink') {
        delete row.leader
        Object.assign(row, {
          status: 'unresolved',
          cavityIds: [],
          inkSourceOperation: null,
          reason: 'height-caption-ink-unverified',
        })
        Object.assign(binding, {
          objectStatus: 'unresolved',
          objectReason: 'height-caption-ink-unverified',
          targets: [],
        })
        Object.assign(binding.datumEvidence, {
          status: 'unresolved',
          kind: null,
          sourceLabelIds: [],
          reason: 'height-caption-ink-unverified',
        })
      }
      if (state === 'no-leader') {
        delete row.leader
        Object.assign(binding, {
          objectStatus: 'unresolved',
          objectReason: 'height-object-leader-unverified',
          targets: [],
        })
      }
      if (state === 'no-schedule') {
        delete packet.roomSchedule
        Object.assign(binding, {
          objectStatus: 'unresolved',
          objectReason: 'height-object-schedule-unverified',
          targets: [],
        })
      }
      if (state === 'global-refusal')
        Object.assign(objects, {
          status: 'unresolved',
          refusalReason: 'height-object-source-held',
          declarations: [],
          unsupportedDeclarations: [],
          bindings: [],
        })
      syncHeightNoteIssues(packet)
      const loaded = (await loadFixture(packet, headers)).packet
      expect(loaded.heightObjects).toEqual(objects)
      expect(loaded.readiness.readyFor3D).toBe(false)
    },
  )

  it.each([
    'linked',
    'ambiguous-target',
    'ambiguous-chain',
    'unresolved-target',
    'unresolved-chain',
  ] as const)(
    'retains read-only source height leader %s without assigning an owner or sorting refs',
    async (state) => {
      const { packet, headers, row, leader } = heightLeaderFixture()
      if (state === 'ambiguous-target')
        Object.assign(leader, {
          status: 'ambiguous',
          reason: 'competing-height-leader-targets',
          cavityIds: ['height-cavity-0', 'height-cavity-1'],
        })
      if (state === 'ambiguous-chain') {
        Object.assign(leader, {
          status: 'ambiguous',
          reason: 'multiple-source-chains',
          cavityIds: [],
        })
        delete leader.source
      }
      if (state === 'unresolved-target')
        Object.assign(leader, {
          status: 'unresolved',
          reason: 'height-leader-target-unverified',
        })
      if (state === 'unresolved-chain') {
        Object.assign(leader, { status: 'unresolved', reason: 'no-source-chain', cavityIds: [] })
        delete leader.source
      }
      const before = structuredClone(packet)
      const loaded = (await loadFixture(packet, headers)).packet
      expect(loaded.heightObservations?.locations?.observations[0]).toEqual(row)
      expect(loaded.readiness.readyFor3D).toBe(false)
      expect(packet).toEqual(before)
    },
  )

  it.each([
    'null-leader',
    'extra-owner',
    'extra-point',
    'extra-source-key',
    'extra-ref-key',
    'extra-stem-point',
    'null-source',
    'undefined-source',
    'unknown-status',
    'linked-reason',
    'linked-no-source',
    'linked-no-cavity',
    'linked-two-cavities',
    'unknown-cavity',
    'duplicate-cavity',
    'linked-omitted',
    'no-floor',
    'null-ink',
    'ambiguous-one',
    'ambiguous-no-reason',
    'ambiguous-no-source-cavities',
    'unresolved-two',
    'unresolved-no-reason',
    'unresolved-no-source-cavities',
    'source-work-limit',
    'source-ambiguous-reason',
    'empty-box',
    'empty-stem',
    'long-box',
    'long-stem',
    'duplicate-box',
    'duplicate-stem',
    'negative-ref',
    'fractional-ref',
    'unsafe-ref',
    'missing-ref',
    'arrow-box',
    'arrow-stem',
    'box-stem',
  ] as const)('rejects unsafe height source-leader evidence: %s', async (change) => {
    const { packet, headers, row, leader } = heightLeaderFixture()
    const source = leader.source
    const stem = source?.stemRefs[0]
    const box = source?.boxRefs[0]
    const cavity = packet.floorCavities?.candidates[0]
    if (!source || !stem || !box || !cavity) throw new Error('Height leader fixture is missing')
    if (change === 'null-leader') Object.assign(row, { leader: null })
    if (change === 'extra-owner') Object.assign(leader, { roomId: 'room' })
    if (change === 'extra-point') Object.assign(leader, { pagePoint: { x: 1, y: 1 } })
    if (change === 'extra-source-key') Object.assign(source, { mayTransfer3D: true })
    if (change === 'extra-ref-key') Object.assign(source.arrowRef, { segmentIndex: 0 })
    if (change === 'extra-stem-point') Object.assign(stem, { start: { x: 1, y: 1 } })
    if (change === 'null-source') Object.assign(leader, { source: null })
    if (change === 'undefined-source') Object.assign(leader, { source: undefined })
    if (change === 'unknown-status') Object.assign(leader, { status: 'accepted' })
    if (change === 'linked-reason') leader.reason = 'held'
    if (change === 'linked-no-source') delete leader.source
    if (change === 'linked-no-cavity') leader.cavityIds = []
    if (change === 'linked-two-cavities') leader.cavityIds.push('height-cavity-1')
    if (change === 'unknown-cavity') leader.cavityIds = ['unknown']
    if (change === 'duplicate-cavity')
      Object.assign(leader, {
        status: 'ambiguous',
        reason: 'held',
        cavityIds: ['height-cavity-0', 'height-cavity-0'],
      })
    if (change === 'linked-omitted') {
      cavity.omittedBoundaryInkCount = 1
      Object.assign(row, { status: 'unresolved', reason: 'omitted-boundary-ink' })
    }
    if (change === 'no-floor') delete packet.floorCavities
    if (change === 'null-ink')
      Object.assign(row, {
        inkSourceOperation: null,
        status: 'unresolved',
        reason: 'height-caption-ink-unverified',
        cavityIds: [],
      })
    if (change.startsWith('ambiguous-')) {
      Object.assign(leader, { status: 'ambiguous', reason: 'held' })
      if (change === 'ambiguous-no-reason') {
        leader.reason = null
        leader.cavityIds.push('height-cavity-1')
      }
      if (change === 'ambiguous-no-source-cavities') delete leader.source
    }
    if (change.startsWith('unresolved-')) {
      Object.assign(leader, { status: 'unresolved', reason: 'held' })
      if (change === 'unresolved-two') leader.cavityIds.push('height-cavity-1')
      if (change === 'unresolved-no-reason') leader.reason = null
      if (change === 'unresolved-no-source-cavities') delete leader.source
    }
    if (change === 'source-work-limit')
      Object.assign(leader, { status: 'unresolved', reason: 'height-leader-work-limit' })
    if (change === 'source-ambiguous-reason')
      Object.assign(leader, {
        status: 'ambiguous',
        reason: 'wrong-target-reason',
        cavityIds: ['height-cavity-0', 'height-cavity-1'],
      })
    if (change === 'empty-box') source.boxRefs = []
    if (change === 'empty-stem') source.stemRefs = []
    if (change === 'long-box')
      source.boxRefs = Array.from({ length: 101 }, (_, operationIndex) => ({
        operationIndex: operationIndex + 100,
        subpathIndex: 0,
      }))
    if (change === 'long-stem')
      source.stemRefs = Array.from({ length: 101 }, (_, operationIndex) => ({
        operationIndex: operationIndex + 100,
        subpathIndex: 0,
        segmentIndex: 0,
      }))
    if (change === 'duplicate-box') source.boxRefs.push({ ...box })
    if (change === 'duplicate-stem') source.stemRefs.push({ ...stem })
    if (change === 'negative-ref') source.arrowRef.operationIndex = -1
    if (change === 'fractional-ref') stem.segmentIndex = 0.5
    if (change === 'unsafe-ref') box.subpathIndex = Number.MAX_SAFE_INTEGER + 1
    if (change === 'missing-ref') Object.assign(source.arrowRef, { subpathIndex: undefined })
    if (change === 'arrow-box') source.arrowRef = { ...box }
    if (change === 'arrow-stem') source.arrowRef = { operationIndex: 32, subpathIndex: 0 }
    if (change === 'box-stem') source.boxRefs = [{ operationIndex: 32, subpathIndex: 0 }]
    await expect(loadFixture(packet, headers)).rejects.toThrow()
  })

  it('enforces one shared height-leader reference budget across all rows', async () => {
    const { packet, headers, heights, locations, row, leader } = heightLeaderFixture()
    const parentObservation = heights.observations[0]
    if (!parentObservation) throw new Error('Height fixture is missing')
    const parent = structuredClone(parentObservation)
    const parentIssues = structuredClone(heights.issues)
    heights.observations = []
    heights.issues = []
    locations.observations = []
    for (let index = 0; index < 100; index++) {
      const labelId = `native-text-${index + 100}`
      heights.observations.push({ ...structuredClone(parent), labelId })
      heights.issues.push(...parentIssues.map((issue) => ({ ...issue, labelId })))
      const next = { ...structuredClone(row), labelId, inkSourceOperation: index + 100 }
      next.leader = {
        ...structuredClone(leader),
        source: {
          boxRefs: Array.from({ length: 100 }, (_, offset) => ({
            operationIndex: offset + 1000,
            subpathIndex: index,
          })),
          stemRefs: Array.from({ length: 100 }, (_, offset) => ({
            operationIndex: offset + 2000,
            subpathIndex: index,
            segmentIndex: 0,
          })),
          arrowRef: { operationIndex: 3000, subpathIndex: index },
        },
      }
      locations.observations.push(next)
    }
    // 100 × (100 box + 100 stem + 1 arrow) is above the global cap.
    await expect(loadFixture(packet, headers)).rejects.toThrow()
    for (const location of locations.observations) {
      const source = location.leader?.source
      if (!source) throw new Error('Height leader fixture is missing')
      source.stemRefs.pop()
    }
    // 100 × (100 box + 99 stem + 1 arrow) is exactly the shared cap.
    expect((await loadFixture(packet, headers)).packet.heightObservations?.locations).toEqual(
      locations,
    )
  })

  it.each(['inside', 'ambiguous', 'outside', 'ink-unverified', 'omitted-boundary'] as const)(
    'retains source height-caption location %s without accepting a height owner',
    async (state) => {
      const { packet, headers, locations } = heightLocationsFixture()
      const row = locations.observations[0]
      if (!row) throw new Error('Height location fixture is missing')
      if (state === 'ambiguous')
        Object.assign(row, {
          status: 'ambiguous',
          cavityIds: ['height-cavity-0', 'height-cavity-1'],
          reason: 'multiple-cavities',
        })
      if (state === 'outside')
        Object.assign(row, {
          status: 'unresolved',
          cavityIds: [],
          reason: 'outside-cavities',
        })
      if (state === 'ink-unverified')
        Object.assign(row, {
          status: 'unresolved',
          cavityIds: [],
          inkSourceOperation: null,
          reason: 'height-caption-ink-unverified',
        })
      if (state === 'omitted-boundary') {
        Object.assign(row, { status: 'unresolved', reason: 'omitted-boundary-ink' })
        const cavity = packet.floorCavities?.candidates[0]
        if (!cavity) throw new Error('Cavity fixture is missing')
        cavity.omittedBoundaryInkCount = 1
      }
      const loaded = (await loadFixture(packet, headers)).packet
      expect(loaded.heightObservations?.locations).toEqual(locations)
      expect(loaded.readiness.readyFor3D).toBe(false)
    },
  )

  it.each(['draft-parent', 'held-parent'] as const)(
    'accepts atomic held height locations with %s',
    async (state) => {
      const { packet, headers, heights } = heightLocationsFixture()
      heights.locations = {
        status: 'unresolved',
        refusalReason: 'source-height-locations-held',
        observations: [],
      }
      if (state === 'held-parent')
        Object.assign(heights, {
          status: 'unresolved',
          refusalReason: 'source-height-held',
          observations: [],
          issues: [],
        })
      expect((await loadFixture(packet, headers)).packet.heightObservations?.locations).toEqual(
        heights.locations,
      )
    },
  )

  it.each([
    'null-report',
    'extra-report-key',
    'accepted-report',
    'draft-reason',
    'held-rows',
    'unknown-label',
    'missing-row',
    'duplicate-row',
    'unknown-cavity',
    'duplicate-cavity',
    'inside-omitted',
    'inside-two',
    'inside-null-operation',
    'inside-reason',
    'negative-operation',
    'fractional-operation',
    'missing-operation',
    'duplicate-operation',
    'null-operation-cavity',
    'null-operation-reason',
    'ambiguous-one',
    'ambiguous-no-reason',
    'unresolved-two',
    'unresolved-no-reason',
    'extra-row-owner',
    'extra-row-point',
    'floor-held',
    'parent-held',
  ] as const)('rejects forged or incomplete height-caption locations: %s', async (change) => {
    const { packet, headers, heights, locations } = heightLocationsFixture()
    const row = locations.observations[0]
    if (!row) throw new Error('Height location fixture is missing')
    if (change === 'null-report') Object.assign(heights, { locations: null })
    if (change === 'extra-report-key') Object.assign(locations, { mayTransfer2D3D: true })
    if (change === 'accepted-report') Object.assign(locations, { status: 'accepted' })
    if (change === 'draft-reason') locations.refusalReason = 'held'
    if (change === 'held-rows')
      Object.assign(locations, { status: 'unresolved', refusalReason: 'held' })
    if (change === 'unknown-label') row.labelId = 'not-a-parent-height'
    if (change === 'missing-row') locations.observations = []
    if (change === 'duplicate-row') locations.observations.push(structuredClone(row))
    if (change === 'unknown-cavity') row.cavityIds = ['not-a-source-cavity']
    if (change === 'duplicate-cavity') row.cavityIds.push('height-cavity-0')
    if (change === 'inside-omitted') {
      const cavity = packet.floorCavities?.candidates[0]
      if (!cavity) throw new Error('Cavity fixture is missing')
      cavity.omittedBoundaryInkCount = 1
    }
    if (change === 'inside-two') row.cavityIds.push('height-cavity-1')
    if (change === 'inside-null-operation') row.inkSourceOperation = null
    if (change === 'inside-reason') row.reason = 'held'
    if (change === 'negative-operation') row.inkSourceOperation = -1
    if (change === 'fractional-operation') row.inkSourceOperation = 1.5
    if (change === 'missing-operation') Object.assign(row, { inkSourceOperation: undefined })
    if (change === 'duplicate-operation') {
      const observation = heights.observations[0]
      if (!observation) throw new Error('Height fixture is missing')
      heights.observations.push({ ...structuredClone(observation), labelId: 'native-text-21' })
      heights.issues.push(
        ...heights.issues.map((issue) => ({ ...issue, labelId: 'native-text-21' })),
      )
      locations.observations.push({ ...structuredClone(row), labelId: 'native-text-21' })
    }
    if (change === 'null-operation-cavity' || change === 'null-operation-reason')
      Object.assign(row, {
        status: 'unresolved',
        inkSourceOperation: null,
        reason:
          change === 'null-operation-reason' ? 'outside-cavities' : 'height-caption-ink-unverified',
        cavityIds: change === 'null-operation-cavity' ? ['height-cavity-0'] : [],
      })
    if (change === 'ambiguous-one' || change === 'ambiguous-no-reason')
      Object.assign(row, {
        status: 'ambiguous',
        cavityIds:
          change === 'ambiguous-one' ? ['height-cavity-0'] : ['height-cavity-0', 'height-cavity-1'],
        reason: change === 'ambiguous-no-reason' ? null : 'ambiguous-cavity',
      })
    if (change === 'unresolved-two' || change === 'unresolved-no-reason')
      Object.assign(row, {
        status: 'unresolved',
        cavityIds: change === 'unresolved-two' ? ['height-cavity-0', 'height-cavity-1'] : [],
        reason: change === 'unresolved-no-reason' ? null : 'outside-cavities',
      })
    if (change === 'extra-row-owner') Object.assign(row, { roomId: 'accepted-room' })
    if (change === 'extra-row-point') Object.assign(row, { pagePoint: { x: 150, y: 150 } })
    if (change === 'floor-held') delete packet.floorCavities
    if (change === 'parent-held')
      Object.assign(heights, {
        status: 'unresolved',
        refusalReason: 'held',
        observations: [],
        issues: [],
      })
    await expect(loadFixture(packet, headers)).rejects.toThrow()
  })

  it('accepts legacy absence, an empty held diagnostic and a separately observed unitless header', async () => {
    const { packet, headers } = fixture()
    expect((await loadFixture(packet, headers)).packet.heightObservations).toBeUndefined()
    packet.heightObservations = {
      status: 'unresolved',
      refusalReason: 'r'.repeat(128),
      observations: [],
      issues: [],
      omissionCounts: { skippedCurves: 0, clippedPaths: 0 },
    }
    expect((await loadFixture(packet, headers)).packet.heightObservations).toEqual(
      packet.heightObservations,
    )
    packet.heightObservations.status = 'draft'
    packet.heightObservations.refusalReason = null
    packet.heightObservations.issues = [
      {
        labelId: 'native-text-30',
        originalText: 'Высота потолка',
        code: 'no-literal-unit-qualified-height',
      },
    ]
    expect((await loadFixture(packet, headers)).packet.heightObservations?.issues).toEqual(
      packet.heightObservations.issues,
    )
  })

  it.each(['finished-ceiling', 'opening-height', 'beam-level', 'unclassified-height'] as const)(
    'accepts a bounded %s observation only with consistent issue records',
    async (quantityKind) => {
      const { packet, headers, heights } = heightFixture()
      const observation = heights.observations[0]
      if (!observation) throw new Error('Height fixture is missing')
      observation.quantityKind = quantityKind
      observation.originalText = {
        'finished-ceiling': 'Чистый потолок 2672 мм',
        'opening-height': 'Высота проёма 2672 мм',
        'beam-level': 'Отметка низа балки 2672 мм',
        'unclassified-height': 'h1 = 2672 мм',
      }[quantityKind]
      for (const issue of heights.issues) issue.originalText = observation.originalText
      if (quantityKind === 'unclassified-height') {
        observation.issueCodes.unshift('height-role-unclassified')
        heights.issues.push({
          labelId: observation.labelId,
          originalText: observation.originalText,
          code: 'height-role-unclassified',
        })
      }
      expect((await loadFixture(packet, headers)).packet.heightObservations).toEqual(heights)
    },
  )

  it.each([-6000, -120, 0, 35, 6000, -6000.1, 6000.1])(
    'preserves literal signed threshold level %s mm without model authority',
    async (valueMm) => {
      const { packet, headers, heights } = heightFixture()
      const observation = heights.observations[0]
      if (!observation) throw new Error('Height fixture is missing')
      Object.assign(observation, {
        originalText: `Отметка верха порога ${valueMm} мм от чистого пола`,
        valueMm,
        quantityKind: 'threshold-level',
        datum: 'finished-floor',
        issueCodes: Math.abs(valueMm) > 6000 ? ['height-outside-model-range'] : [],
      })
      heights.issues = observation.issueCodes.map((code) => ({
        labelId: observation.labelId,
        originalText: observation.originalText,
        code,
      }))
      const loaded = (await loadFixture(packet, headers)).packet
      expect(loaded.heightObservations).toEqual(heights)
      expect(loaded.readiness).toEqual({ readOnly: true, readyFor2D: false, readyFor3D: false })
    },
  )

  it.each([
    'value',
    'role',
    'datum',
    'negation',
    'date',
    'multiple',
    'not-height',
    'unitless',
    'fabricated-note',
    'issue-order',
  ] as const)(
    'rejects height observation not reproducible from literal caption: %s',
    async (change) => {
      const { packet, headers, heights } = heightFixture()
      const observation = heights.observations[0]
      if (!observation) throw new Error('Height fixture is missing')
      if (change === 'value') observation.valueMm = 2673
      if (change === 'role') observation.quantityKind = 'threshold-level'
      if (change === 'datum') {
        observation.datum = 'finished-floor'
        observation.issueCodes = []
      }
      if (change === 'negation') observation.originalText = 'Не чистый потолок 2672 мм'
      if (change === 'date') observation.originalText = 'Чистый потолок 2672 мм на 10.10.2026'
      if (change === 'multiple') observation.originalText = 'Чистый потолок 2672 мм, порог 20 мм'
      if (change === 'not-height') observation.originalText = 'Ширина стены 2672 мм'
      if (change === 'unitless') observation.originalText = 'Чистый потолок 2672'
      if (change === 'fabricated-note') observation.issueCodes.push('source-note')
      if (change === 'issue-order') {
        observation.originalText = 'h1 = 2672 мм'
        observation.quantityKind = 'unclassified-height'
        observation.issueCodes = ['height-datum-unverified', 'height-role-unclassified']
      }
      heights.issues = observation.issueCodes.map((code) => ({
        labelId: observation.labelId,
        originalText: observation.originalText,
        code,
      }))
      await expect(loadFixture(packet, headers)).rejects.toThrow()
    },
  )

  it.each(['invented-code', 'observed-caption', 'not-height', 'wrong-unresolved-code'] as const)(
    'rejects a standalone height issue without matching literal refusal: %s',
    async (change) => {
      const { packet, headers, heights } = heightFixture()
      heights.observations = []
      heights.issues = [
        {
          labelId: 'standalone-height',
          originalText: 'Высота потолка',
          code: 'no-literal-unit-qualified-height',
        },
      ]
      const issue = heights.issues[0]
      if (!issue) throw new Error('Height issue fixture is missing')
      if (change === 'invented-code') issue.code = 'made-up-height-code'
      if (change === 'observed-caption') issue.originalText = 'Чистый потолок 2672 мм'
      if (change === 'not-height') issue.originalText = 'Ширина стены 2672 мм'
      if (change === 'wrong-unresolved-code') issue.code = 'multiple-height-quantities'
      await expect(loadFixture(packet, headers)).rejects.toThrow()
    },
  )

  it.each([-120, 0, 6000.1, 90000])(
    'preserves out-of-domain %s mm as flagged diagnostic evidence only',
    async (valueMm) => {
      const { packet, headers, heights } = heightFixture()
      const observation = heights.observations[0]
      if (!observation) throw new Error('Height fixture is missing')
      observation.valueMm = valueMm
      observation.originalText = `Чистый потолок = ${valueMm} мм`
      for (const issue of heights.issues) issue.originalText = observation.originalText
      observation.issueCodes.push('height-outside-model-range')
      heights.issues.push({
        labelId: observation.labelId,
        originalText: observation.originalText,
        code: 'height-outside-model-range',
      })
      expect((await loadFixture(packet, headers)).packet.heightObservations).toEqual(heights)
    },
  )

  it('accepts 100 observations, 100 independent header issues and retained count bounds', async () => {
    const { packet, headers, heights } = heightFixture()
    const sample = heights.observations[0]
    if (!sample) throw new Error('Height fixture is missing')
    heights.observations = Array.from({ length: 100 }, (_, index) => ({
      ...structuredClone(sample),
      labelId: `obs-${index}`,
      datum: index % 2 ? 'existing-floor' : 'finished-floor',
      originalText: `Чистый потолок 2672 мм от ${index % 2 ? 'существующего' : 'чистого'} пола`,
      issueCodes: [],
    }))
    heights.issues = Array.from({ length: 100 }, (_, index) => ({
      labelId: `header-${index}`,
      originalText: 'Высота потолка',
      code: 'no-literal-unit-qualified-height',
    }))
    heights.omissionCounts = { skippedCurves: 6000, clippedPaths: 6000 }
    packet.extraction.skippedCurves = 6000
    packet.extraction.clippedPaths = 6000
    expect((await loadFixture(packet, headers)).packet.heightObservations).toEqual(heights)
  })

  it('rejects invented issue codes even when linked to a valid observation', async () => {
    const { packet, headers, heights } = heightFixture()
    const observation = heights.observations[0]
    if (!observation) throw new Error('Height fixture is missing')
    observation.issueCodes.push(...Array.from({ length: 19 }, (_, index) => `source-note-${index}`))
    heights.issues = observation.issueCodes.map((code) => ({
      labelId: observation.labelId,
      originalText: observation.originalText,
      code,
    }))
    await expect(loadFixture(packet, headers)).rejects.toThrow()
  })

  it.each([
    'null-layer',
    'extra-layer-key',
    'status',
    'draft-reason',
    'null-observations',
    'null-issues',
    'observations-limit',
    'issues-limit',
    'null-observation',
    'duplicate-observation',
    'blank-label',
    'blank-text',
    'long-text',
    'nonfinite-value',
    'kind',
    'datum',
    'accepted-for-3d',
    'point-authority',
    'wall-authority',
    'null-codes',
    'codes-limit',
    'duplicate-code',
    'blank-code',
    'missing-datum-code',
    'missing-role-code',
    'contradictory-role-code',
    'contradictory-datum-code',
    'missing-range-code',
    'contradictory-range-code',
    'ambiguous-explicit-datum',
    'missing-issue-row',
    'duplicate-issue-row',
    'stale-issue-text',
    'foreign-observation-issue',
    'unexpected-observation-code',
    'external-text-conflict',
    'issue-authority',
    'null-omissions',
    'extra-omission-key',
    'stale-curve-count',
    'negative-clip-count',
    'large-count',
    'held-observation',
  ])('rejects malformed or contradictory height diagnostics: %s', async (change) => {
    const { packet, headers, heights } = heightFixture()
    const observation = heights.observations[0],
      issue = heights.issues[0]
    if (!observation || !issue) throw new Error('Height fixture is missing')
    if (change === 'null-layer') Object.assign(packet, { heightObservations: null })
    if (change === 'extra-layer-key') Object.assign(heights, { assignsGeometryHeights: true })
    if (change === 'status') Object.assign(heights, { status: 'accepted' })
    if (change === 'draft-reason') heights.refusalReason = 'held'
    if (change === 'null-observations') Object.assign(heights, { observations: null })
    if (change === 'null-issues') Object.assign(heights, { issues: null })
    if (change === 'observations-limit') heights.observations = Array(101).fill(observation)
    if (change === 'issues-limit') heights.issues = Array(101).fill(issue)
    if (change === 'null-observation') Object.assign(heights.observations, { 0: null })
    if (change === 'duplicate-observation') heights.observations.push(structuredClone(observation))
    if (change === 'blank-label') observation.labelId = ' '
    if (change === 'blank-text') observation.originalText = ' '
    if (change === 'long-text') observation.originalText = 'h'.repeat(201)
    if (change === 'nonfinite-value') observation.valueMm = Infinity
    if (change === 'kind') Object.assign(observation, { quantityKind: 'wall-height' })
    if (change === 'datum') Object.assign(observation, { datum: 'assumed-zero' })
    if (change === 'accepted-for-3d') Object.assign(observation, { mayAcceptFor3D: true })
    if (change === 'point-authority') Object.assign(observation, { pagePoint: { x: 100, y: 100 } })
    if (change === 'wall-authority') Object.assign(observation, { wallId: 'source-wall' })
    if (change === 'null-codes') Object.assign(observation, { issueCodes: null })
    if (change === 'codes-limit')
      observation.issueCodes = Array.from({ length: 21 }, (_, index) => `issue-${index}`)
    if (change === 'duplicate-code') observation.issueCodes.push('height-datum-unverified')
    if (change === 'blank-code') observation.issueCodes.push(' ')
    if (change === 'missing-datum-code') {
      observation.issueCodes = []
      heights.issues = []
    }
    if (change === 'missing-role-code') observation.quantityKind = 'unclassified-height'
    if (change === 'contradictory-role-code')
      observation.issueCodes.push('height-role-unclassified')
    if (change === 'contradictory-datum-code') observation.datum = 'existing-floor'
    if (change === 'missing-range-code') observation.valueMm = -20
    if (change === 'contradictory-range-code')
      observation.issueCodes.push('height-outside-model-range')
    if (change === 'ambiguous-explicit-datum') {
      observation.datum = 'finished-floor'
      observation.issueCodes = ['ambiguous-height-datum']
    }
    if (change === 'missing-issue-row') heights.issues = []
    if (change === 'duplicate-issue-row') heights.issues.push({ ...issue })
    if (change === 'stale-issue-text') issue.originalText = 'h потолок натяжной-2800мм'
    if (change === 'foreign-observation-issue') issue.labelId = 'unknown-observation'
    if (change === 'unexpected-observation-code') issue.code = 'no-literal-unit-qualified-height'
    if (change === 'external-text-conflict')
      heights.issues.push(
        { labelId: 'header', originalText: 'Высота?', code: 'no-literal-unit-qualified-height' },
        { labelId: 'header', originalText: 'Другая высота?', code: 'multiple-height-quantities' },
      )
    if (change === 'issue-authority') Object.assign(issue, { wallId: 'source-wall' })
    if (change === 'null-omissions') Object.assign(heights, { omissionCounts: null })
    if (change === 'extra-omission-key')
      Object.assign(heights.omissionCounts, { extractionComplete: true })
    if (change === 'stale-curve-count') heights.omissionCounts.skippedCurves = 0
    if (change === 'negative-clip-count') heights.omissionCounts.clippedPaths = -1
    if (change === 'large-count') {
      heights.omissionCounts.skippedCurves = 6001
      packet.extraction.skippedCurves = 6001
    }
    if (change === 'held-observation')
      Object.assign(heights, { status: 'unresolved', refusalReason: 'held' })
    await expect(loadFixture(packet, headers)).rejects.toMatchObject({ status: 422 })
  })
})

describe('bounded source-backed floor cavities without accepted ownership', () => {
  function floorFixture() {
    const result = fixture()
    result.packet.openingFrames = openingFrames()
    result.packet.numberCircles = {
      status: 'draft',
      refusalReason: null,
      cues: [1, 5, 8].map((sourceNumber) => ({ labelId: `circle-${sourceNumber}`, sourceNumber })),
    }
    const floor: NonNullable<NativeReviewPacket['floorCavities']> = {
      status: 'draft',
      refusalReason: null,
      markersAvailable: true,
      candidates: [
        {
          id: 'source-cavity-1',
          polygon: [
            { x: 100, y: 100 },
            { x: 300, y: 100 },
            { x: 300, y: 300 },
            { x: 100, y: 300 },
          ],
          markerStatus: 'unambiguous',
          markerLabelIds: ['circle-1', 'circle-5'],
          closureIds: ['native-opening-frame-1:0', 'source-profile'],
          unknownInteriorStrokeCount: 2,
          omittedBoundaryInkCount: 1,
        },
        {
          id: 'source-cavity-unmarked',
          polygon: [
            { x: 400, y: 100 },
            { x: 500, y: 100 },
            { x: 500, y: 200 },
          ],
          markerStatus: 'unmarked',
          markerLabelIds: [],
          closureIds: [],
          unknownInteriorStrokeCount: 0,
          omittedBoundaryInkCount: 0,
        },
      ],
      thresholds: [{ frameId: 'native-opening-frame-1:0', paintAmbiguous: false }],
      closures: [
        {
          id: 'source-profile',
          sourceKind: 'literal-closed-run',
          remainingSegmentCount: 1,
          paintAmbiguous: false,
        },
      ],
      unprovedCavities: [{ reason: 'nested-painted-island', vertexCount: 4 }],
      unresolvedMarkerLabelIds: ['circle-8'],
    }
    result.packet.floorCavities = floor
    return { ...result, floor }
  }
  it('keeps joint numeric cues and unresolved outboard markers without constructing accepted rooms', async () => {
    const { packet, headers, floor } = floorFixture()
    const loaded = (await loadFixture(packet, headers)).packet
    expect(loaded.floorCavities).toEqual(floor)
    expect(loaded.openingFrames).toEqual(packet.openingFrames)
    expect(loaded.faces).toEqual(packet.faces)
    expect(loaded.savedReview).toEqual(packet.savedReview)
    expect(loaded.readiness).toEqual({ readOnly: true, readyFor2D: false, readyFor3D: false })
  })
  describe('optional logical frame-side correspondence', () => {
    function openingSidesFixture() {
      const result = floorFixture()
      const report: NonNullable<NativeReviewPacket['floorOpeningSides']> = {
        status: 'draft',
        refusalReason: null,
        frames: [
          {
            frameId: 'native-opening-frame-1:0',
            status: 'two-sided',
            reason: null,
            sides: [
              {
                frameEdgeIndex: 0,
                status: 'matched',
                contacts: [
                  { cavityId: 'source-cavity-1', coverage: 'complete', boundaryEdgeIndices: [0] },
                ],
              },
              {
                frameEdgeIndex: 2,
                status: 'matched',
                contacts: [
                  {
                    cavityId: 'source-cavity-unmarked',
                    coverage: 'complete',
                    boundaryEdgeIndices: [1],
                  },
                ],
              },
            ],
            doorSymbolIds: ['native-door-symbol-1:0'],
            omittedInkCount: 1,
          },
        ],
      }
      result.packet.doorSymbols = doorSymbols()
      result.packet.sourceLinks = {
        status: 'draft',
        refusalReason: null,
        doors: [
          {
            symbolId: 'native-door-symbol-1:0',
            status: 'linked',
            targetKind: 'opening-frame',
            targetId: 'native-opening-frame-1:0',
            relation: 'jamb-to-frame',
          },
        ],
        glazing: [],
        groups: [],
      }
      result.packet.floorOpeningSides = report
      const row = report.frames[0]
      if (!row) throw new Error('Opening-side fixture is missing')
      const oppositeCell = result.floor.candidates[1]
      if (!oppositeCell) throw new Error('Opposite cavity fixture is missing')
      oppositeCell.closureIds = [row.frameId]
      return { ...result, report, row }
    }

    it.each([
      [0, 2],
      [1, 3],
      [2, 0],
      [3, 1],
    ])(
      'keeps opposite source rectangle edges %i/%i without choosing a raster-aspect axis',
      async (first, second) => {
        const { packet, headers, report, row } = openingSidesFixture()
        const a = row.sides[0],
          b = row.sides[1]
        if (!a || !b) throw new Error('Opening-side fixture is missing')
        a.frameEdgeIndex = first
        b.frameEdgeIndex = second
        const loaded = (await loadFixture(packet, headers)).packet
        expect(loaded.floorOpeningSides).toEqual(report)
        expect(loaded.floorCavities).toEqual(packet.floorCavities)
        expect(loaded.readiness).toEqual({ readOnly: true, readyFor2D: false, readyFor3D: false })
      },
    )

    it('allows old packets without side metadata and an empty held report without parents', async () => {
      const { packet, headers } = fixture()
      expect((await loadFixture(packet, headers)).packet.floorOpeningSides).toBeUndefined()
      packet.floorOpeningSides = {
        status: 'unresolved',
        refusalReason: 'r'.repeat(128),
        frames: [],
      }
      expect((await loadFixture(packet, headers)).packet.floorOpeningSides).toEqual(
        packet.floorOpeningSides,
      )
    })

    it.each([
      'one-sided',
      'same-cavity',
      'partial',
      'unproved',
      'ambiguous',
      'unobserved',
    ] as const)('preserves %s relations without asserting a physical passage', async (variant) => {
      const { packet, headers, floor, report, row } = openingSidesFixture()
      const a = row.sides[0],
        b = row.sides[1]
      const contact = a?.contacts[0]
      if (!a || !b || !contact) throw new Error('Opening-side fixture is missing')
      if (variant === 'same-cavity') {
        row.status = 'same-cavity'
        const other = b.contacts[0]
        if (!other) throw new Error('Opening-side fixture is missing')
        other.cavityId = contact.cavityId
      } else if (variant === 'one-sided') {
        b.contacts = []
        b.status = 'unobserved'
        row.status = 'one-sided'
        row.reason = 'unobserved-opposite-cavity'
      } else if (variant === 'ambiguous') {
        a.contacts.push({
          cavityId: 'source-cavity-unmarked',
          coverage: 'partial',
          boundaryEdgeIndices: [0],
        })
        a.status = 'ambiguous'
        row.status = 'ambiguous'
        row.reason = 'competing-cavity-contacts'
      } else {
        row.status = 'unresolved'
        row.reason = 'incomplete-cavity-contacts'
        if (variant === 'unobserved') {
          for (const side of row.sides) {
            side.contacts = []
            side.status = 'unobserved'
          }
        } else {
          contact.coverage = variant
          a.status = variant === 'partial' ? 'partial' : 'unresolved'
          if (variant === 'unproved') {
            const cell = floor.candidates.find((candidate) => candidate.id === contact.cavityId)
            if (cell) cell.closureIds = cell.closureIds.filter((id) => id !== row.frameId)
          }
        }
      }
      expect((await loadFixture(packet, headers)).packet.floorOpeningSides).toEqual(report)
    })

    it.each([
      'logical-strip-unavailable',
      'competing-strip-paint',
      'strip-overlaps-cavity',
      'unproved-neighbor-region',
    ] as const)('preserves the explicit empty-side hold: %s', async (reason) => {
      const { packet, headers, floor, report, row } = openingSidesFixture()
      row.sides = []
      row.reason = reason
      row.status =
        reason === 'competing-strip-paint' || reason === 'strip-overlaps-cavity'
          ? 'ambiguous'
          : 'unresolved'
      if (reason === 'logical-strip-unavailable') floor.thresholds = []
      if (reason === 'competing-strip-paint') {
        const threshold = floor.thresholds[0]
        if (!threshold) throw new Error('Threshold fixture is missing')
        threshold.paintAmbiguous = true
      }
      if (reason === 'logical-strip-unavailable' || reason === 'competing-strip-paint')
        for (const cell of floor.candidates)
          cell.closureIds = cell.closureIds.filter((id) => id !== row.frameId)
      expect((await loadFixture(packet, headers)).packet.floorOpeningSides).toEqual(report)
    })

    it('requires an exact unique set of co-observed linked door symbols', async () => {
      const { packet, headers, row } = openingSidesFixture()
      if (!packet.doorSymbols || !packet.sourceLinks) throw new Error('Source links are missing')
      const second = structuredClone(packet.doorSymbols.candidates[0])
      if (!second) throw new Error('Door fixture is missing')
      second.id = 'second-source-door'
      packet.doorSymbols.candidates.push(second)
      packet.sourceLinks.doors.push({
        symbolId: second.id,
        status: 'linked',
        targetKind: 'opening-frame',
        targetId: row.frameId,
        relation: 'jamb-to-frame',
      })
      row.doorSymbolIds = [second.id, 'native-door-symbol-1:0']
      expect(
        (await loadFixture(packet, headers)).packet.floorOpeningSides?.frames[0]?.doorSymbolIds,
      ).toEqual(row.doorSymbolIds)
      packet.sourceLinks = {
        status: 'unresolved',
        refusalReason: 'source-link-search-budget',
        doors: [],
        glazing: [],
        groups: [],
      }
      row.doorSymbolIds = []
      expect(
        (await loadFixture(packet, headers)).packet.floorOpeningSides?.frames[0]?.doorSymbolIds,
      ).toEqual([])
    })

    function limitFixture() {
      // Protocol bounds only: these polygons are not an apartment/source acceptance.
      const result = openingSidesFixture()
      const { packet, floor, report, row } = result
      const template = floor.candidates[1]
      const frame = packet.openingFrames?.candidates[0]
      if (!template || !frame || !packet.openingFrames || !packet.sourceLinks)
        throw new Error('Bounds fixture is missing')
      floor.candidates = Array.from({ length: 5 }, (_, index) => ({
        ...structuredClone(template),
        id: `cell-${index}`,
        polygon: Array.from({ length: 12 }, (_, vertex) => ({
          x: 100 + vertex,
          y: 100 + (vertex % 3),
        })),
      }))
      floor.unresolvedMarkerLabelIds = ['circle-1', 'circle-5', 'circle-8']
      packet.openingFrames.candidates = Array.from({ length: 100 }, (_, index) => ({
        ...structuredClone(frame),
        id: `frame-${index}`,
      }))
      floor.thresholds = packet.openingFrames.candidates.map(({ id }) => ({
        frameId: id,
        paintAmbiguous: false,
      }))
      for (const cell of floor.candidates)
        cell.closureIds = floor.thresholds.map((threshold) => threshold.frameId)
      const linked = packet.sourceLinks.doors[0]
      if (!linked) throw new Error('Source link fixture is missing')
      linked.targetId = 'frame-0'
      report.frames = packet.openingFrames.candidates.map(({ id }, index) => ({
        ...structuredClone(row),
        frameId: id,
        status: 'ambiguous',
        reason: 'competing-cavity-contacts',
        omittedInkCount: 6000,
        doorSymbolIds: index === 0 ? [...row.doorSymbolIds] : [],
        sides: [0, 2].map((frameEdgeIndex) => ({
          frameEdgeIndex,
          status: 'ambiguous',
          contacts: floor.candidates.map(({ id }) => ({
            cavityId: id,
            coverage: 'complete',
            boundaryEdgeIndices: Array.from({ length: 10 }, (_, proof) => proof),
          })),
        })),
      }))
      return result
    }

    it('accepts exactly 100 frames, 1000 contacts and 10000 source-edge proof references', async () => {
      const { packet, headers, report } = limitFixture()
      expect((await loadFixture(packet, headers)).packet.floorOpeningSides).toEqual(report)
    })

    it.each(['contacts', 'proofs'] as const)(
      'withholds the complete report beyond the %s budget',
      async (budget) => {
        const { packet, headers, floor, report } = limitFixture()
        const side = report.frames[99]?.sides[1]
        if (!side) throw new Error('Bounds fixture is missing')
        if (budget === 'contacts') {
          for (const row of report.frames)
            for (const part of row.sides)
              for (const contact of part.contacts) contact.boundaryEdgeIndices = [0]
          const first = floor.candidates[0]
          if (!first) throw new Error('Bounds fixture is missing')
          floor.candidates.push({ ...structuredClone(first), id: 'extra-cell' })
          side.contacts.push({
            cavityId: 'extra-cell',
            coverage: 'complete',
            boundaryEdgeIndices: [0],
          })
        } else side.contacts[0]?.boundaryEdgeIndices.push(10)
        await expect(loadFixture(packet, headers)).rejects.toMatchObject({ status: 422 })
      },
    )

    it.each([
      'null-report',
      'extra-report-key',
      'held-with-frames',
      'draft-reason',
      'missing-frames',
      'missing-floor',
      'held-floor',
      'missing-frame-layer',
      'held-frame-layer',
      'missing-row',
      'duplicate-row',
      'foreign-frame',
      'extra-row-key',
      'row-status',
      'row-reason',
      'one-side',
      'adjacent-sides',
      'duplicate-side',
      'negative-opposite-side',
      'outside-opposite-side',
      'fractional-edge',
      'extra-side-key',
      'side-status',
      'missing-contacts',
      'null-contact',
      'foreign-cavity',
      'duplicate-contact',
      'extra-contact-key',
      'coverage',
      'empty-proof',
      'duplicate-proof',
      'negative-proof',
      'outside-proof',
      'string-proof',
      'partial-as-matched',
      'unproved-as-matched',
      'untagged-complete',
      'untagged-partial',
      'rival-as-matched',
      'wrong-same-cavity',
      'wrong-one-sided',
      'empty-sides-without-hold',
      'false-strip-unavailable',
      'false-competing-paint',
      'unproved-without-parent',
      'missing-threshold',
      'ambiguous-threshold',
      'missing-door',
      'foreign-door',
      'duplicate-door',
      'unlinked-door',
      'different-door-target',
      'null-door-ids',
      'omission-negative',
      'omission-limit',
    ])('rejects malformed or overclaimed logical side metadata: %s', async (change) => {
      const { packet, headers, floor, report, row } = openingSidesFixture()
      const a = row.sides[0],
        b = row.sides[1],
        contact = a?.contacts[0]
      if (!a || !b || !contact) throw new Error('Opening-side fixture is missing')
      if (change === 'null-report') Object.assign(packet, { floorOpeningSides: null })
      if (change === 'extra-report-key') Object.assign(report, { physicalPassagesAccepted: true })
      if (change === 'held-with-frames')
        Object.assign(report, { status: 'unresolved', refusalReason: 'held' })
      if (change === 'draft-reason') report.refusalReason = 'held'
      if (change === 'missing-frames') Object.assign(report, { frames: null })
      if (change === 'missing-floor') delete packet.floorCavities
      if (change === 'held-floor')
        Object.assign(floor, {
          status: 'unresolved',
          refusalReason: 'held',
          candidates: [],
          thresholds: [],
          closures: [],
          unprovedCavities: [],
          unresolvedMarkerLabelIds: [],
        })
      if (change === 'missing-frame-layer') delete packet.openingFrames
      if (change === 'held-frame-layer')
        packet.openingFrames = { status: 'unresolved', refusalReason: 'held', candidates: [] }
      if (change === 'missing-row') report.frames = []
      if (change === 'duplicate-row') report.frames.push(structuredClone(row))
      if (change === 'foreign-frame') row.frameId = 'foreign'
      if (change === 'extra-row-key') Object.assign(row, { wallThicknessCm: 20 })
      if (change === 'row-status') Object.assign(row, { status: 'physical-door' })
      if (change === 'row-reason') row.reason = 'nearest-cavity'
      if (change === 'one-side') row.sides.pop()
      if (change === 'adjacent-sides') b.frameEdgeIndex = 1
      if (change === 'duplicate-side') b.frameEdgeIndex = 0
      if (change === 'negative-opposite-side') b.frameEdgeIndex = -2
      if (change === 'outside-opposite-side') {
        a.frameEdgeIndex = 2
        b.frameEdgeIndex = 4
      }
      if (change === 'fractional-edge') a.frameEdgeIndex = 0.5
      if (change === 'extra-side-key') Object.assign(a, { freeFloorConfirmed: true })
      if (change === 'side-status') Object.assign(a, { status: 'accepted' })
      if (change === 'missing-contacts') Object.assign(a, { contacts: null })
      if (change === 'null-contact') Object.assign(a.contacts, { 0: null })
      if (change === 'foreign-cavity') contact.cavityId = 'unknown-cavity'
      if (change === 'duplicate-contact') a.contacts.push(structuredClone(contact))
      if (change === 'extra-contact-key') Object.assign(contact, { sourceRoomNumber: 8 })
      if (change === 'coverage') Object.assign(contact, { coverage: 'assumed' })
      if (change === 'empty-proof') contact.boundaryEdgeIndices = []
      if (change === 'duplicate-proof') contact.boundaryEdgeIndices = [0, 0]
      if (change === 'negative-proof') contact.boundaryEdgeIndices = [-1]
      if (change === 'outside-proof') contact.boundaryEdgeIndices = [4]
      if (change === 'string-proof') Object.assign(contact, { boundaryEdgeIndices: ['0'] })
      if (change === 'partial-as-matched') contact.coverage = 'partial'
      if (change === 'unproved-as-matched') contact.coverage = 'unproved'
      if (change === 'untagged-complete' || change === 'untagged-partial') {
        const cell = floor.candidates.find((candidate) => candidate.id === contact.cavityId)
        if (cell) cell.closureIds = cell.closureIds.filter((id) => id !== row.frameId)
        if (change === 'untagged-partial') {
          contact.coverage = 'partial'
          a.status = 'partial'
          row.status = 'unresolved'
          row.reason = 'incomplete-cavity-contacts'
        }
      }
      if (change === 'rival-as-matched')
        a.contacts.push({
          cavityId: 'source-cavity-unmarked',
          coverage: 'partial',
          boundaryEdgeIndices: [0],
        })
      if (change === 'wrong-same-cavity') row.status = 'same-cavity'
      if (change === 'wrong-one-sided') row.status = 'one-sided'
      if (change === 'empty-sides-without-hold') row.sides = []
      if (change === 'false-strip-unavailable' || change === 'unproved-without-parent') {
        row.sides = []
        row.status = 'unresolved'
        row.reason =
          change === 'false-strip-unavailable'
            ? 'logical-strip-unavailable'
            : 'unproved-neighbor-region'
        if (change === 'unproved-without-parent') floor.unprovedCavities = []
      }
      if (change === 'false-competing-paint') {
        row.sides = []
        row.status = 'ambiguous'
        row.reason = 'competing-strip-paint'
      }
      if (change === 'missing-threshold') {
        floor.thresholds = []
        for (const cell of floor.candidates)
          cell.closureIds = cell.closureIds.filter((id) => id !== row.frameId)
      }
      if (change === 'ambiguous-threshold') {
        const threshold = floor.thresholds[0]
        if (threshold) threshold.paintAmbiguous = true
        for (const cell of floor.candidates)
          cell.closureIds = cell.closureIds.filter((id) => id !== row.frameId)
      }
      if (change === 'missing-door') row.doorSymbolIds = []
      if (change === 'foreign-door') row.doorSymbolIds = ['foreign-door']
      if (change === 'duplicate-door') row.doorSymbolIds.push(row.doorSymbolIds[0] as string)
      if (change === 'unlinked-door' && packet.sourceLinks)
        packet.sourceLinks.doors = [
          {
            symbolId: 'native-door-symbol-1:0',
            status: 'unresolved',
            targetKind: null,
            targetId: null,
            relation: null,
          },
        ]
      if (change === 'different-door-target' && packet.openingFrames && packet.sourceLinks) {
        const other = structuredClone(packet.openingFrames.candidates[0])
        if (!other) throw new Error('Frame fixture is missing')
        other.id = 'other-frame'
        packet.openingFrames.candidates.push(other)
        packet.sourceLinks.doors[0] = {
          symbolId: 'native-door-symbol-1:0',
          status: 'linked',
          targetKind: 'opening-frame',
          targetId: other.id,
          relation: 'jamb-to-frame',
        }
        report.frames.push({
          frameId: other.id,
          status: 'unresolved',
          reason: 'logical-strip-unavailable',
          sides: [],
          doorSymbolIds: ['native-door-symbol-1:0'],
          omittedInkCount: 0,
        })
      }
      if (change === 'null-door-ids') Object.assign(row, { doorSymbolIds: null })
      if (change === 'omission-negative') row.omittedInkCount = -1
      if (change === 'omission-limit') row.omittedInkCount = 6001
      await expect(loadFixture(packet, headers)).rejects.toMatchObject({ status: 422 })
    })
  })

  describe('optional source marker leaders', () => {
    function leaderFixture() {
      const result = floorFixture()
      const leader: NonNullable<typeof result.floor.markerLeaders>[number] = {
        labelId: 'circle-1',
        cavityId: 'source-cavity-1',
        circleEndpoint: 'start',
        segment: {
          operationIndex: 200,
          subpathIndex: 0,
          segmentIndex: 0,
          start: { x: 80, y: 200 },
          end: { x: 180, y: 200 },
        },
      }
      result.floor.markerLeaders = [leader]
      return { ...result, leader }
    }

    it.each(['start', 'end'] as const)(
      'preserves a bounded source leader with circle endpoint %s without new authority',
      async (circleEndpoint) => {
        const { packet, headers, floor, leader } = leaderFixture()
        leader.circleEndpoint = circleEndpoint
        const before = structuredClone({
          candidates: floor.candidates,
          readiness: packet.readiness,
        })
        const loaded = (await loadFixture(packet, headers)).packet
        expect(loaded.floorCavities?.markerLeaders).toEqual([leader])
        expect(loaded.floorCavities?.candidates).toEqual(before.candidates)
        expect(loaded.readiness).toEqual(before.readiness)
      },
    )

    it.each(['absent', 'undefined', 'empty'] as const)(
      'keeps legacy %s leader metadata backward-compatible',
      async (variant) => {
        const { packet, headers, floor } = floorFixture()
        if (variant === 'undefined') floor.markerLeaders = undefined
        if (variant === 'empty') floor.markerLeaders = []
        expect((await loadFixture(packet, headers)).packet.floorCavities).toEqual(
          JSON.parse(JSON.stringify(floor)),
        )
      },
    )

    it('allows empty leaders on unavailable markers and on an atomic held layer', async () => {
      const { packet, headers, floor } = floorFixture()
      floor.markerLeaders = []
      floor.markersAvailable = false
      floor.unresolvedMarkerLabelIds = []
      packet.numberCircles = { status: 'unresolved', refusalReason: 'missing-commands', cues: [] }
      for (const cell of floor.candidates) {
        cell.markerLabelIds = []
        cell.markerStatus = 'unavailable'
      }
      expect((await loadFixture(packet, headers)).packet.floorCavities).toEqual(floor)
      floor.status = 'unresolved'
      floor.refusalReason = 'native-layer-unavailable'
      floor.candidates = []
      floor.thresholds = []
      floor.closures = []
      floor.unprovedCavities = []
      expect((await loadFixture(packet, headers)).packet.floorCavities).toEqual(floor)
    })

    it('keeps duplicate parent numbers ambiguous instead of letting a leader prove ownership', async () => {
      const { packet, headers, floor, leader } = leaderFixture()
      const cell = floor.candidates[0]
      if (!cell || !packet.numberCircles) throw new Error('Floor fixture is missing')
      packet.numberCircles.cues.push({ labelId: 'circle-1-extra', sourceNumber: 1 })
      floor.unresolvedMarkerLabelIds.push('circle-1-extra')
      cell.markerStatus = 'ambiguous'
      const loaded = (await loadFixture(packet, headers)).packet
      expect(loaded.floorCavities?.markerLeaders).toEqual([leader])
      expect(loaded.floorCavities?.candidates[0]?.markerStatus).toBe('ambiguous')
      expect(loaded.readiness).toEqual({ readyFor2D: false, readyFor3D: false, readOnly: true })
      cell.markerStatus = 'unambiguous'
      await expect(loadFixture(packet, headers)).rejects.toMatchObject({ status: 422 })
    })

    it('accepts the exact leader and safe-index bounds with unique parent claims', async () => {
      const { packet, headers, floor, leader } = leaderFixture()
      const cell = floor.candidates[0]
      if (!cell || !packet.numberCircles) throw new Error('Floor fixture is missing')
      packet.numberCircles.cues = Array.from({ length: 100 }, (_, index) => ({
        labelId: `source-cue-${index}`,
        sourceNumber: index + 1,
      }))
      cell.markerLabelIds = packet.numberCircles.cues.map((cue) => cue.labelId)
      floor.unresolvedMarkerLabelIds = []
      floor.markerLeaders = packet.numberCircles.cues.map(({ labelId }, index) => ({
        ...structuredClone(leader),
        labelId,
        segment: { ...structuredClone(leader.segment), operationIndex: index },
      }))
      const last = floor.markerLeaders[99]
      if (!last) throw new Error('Leader fixture is missing')
      last.segment.operationIndex = Number.MAX_SAFE_INTEGER
      last.segment.subpathIndex = Number.MAX_SAFE_INTEGER
      last.segment.start = { x: 0, y: 0 }
      last.segment.end = { x: packet.image.width, y: packet.image.height }
      expect((await loadFixture(packet, headers)).packet.floorCavities?.markerLeaders).toEqual(
        floor.markerLeaders,
      )
    })

    it.each([
      'null-array',
      'non-array',
      'leader-limit',
      'null-leader',
      'extra-leader-key',
      'missing-label',
      'unknown-label',
      'duplicate-label',
      'missing-target',
      'unknown-target',
      'target-not-claiming',
      'duplicate-segment',
      'null-segment',
      'extra-segment-key',
      'negative-operation',
      'unsafe-operation',
      'string-operation',
      'negative-subpath',
      'fractional-subpath',
      'nonzero-segment',
      'string-segment',
      'null-start',
      'missing-end',
      'nonfinite-point',
      'negative-point',
      'outside-point',
      'string-point',
      'identical-points',
      'extra-point-key',
      'circle-endpoint',
      'missing-circle-endpoint',
      'unavailable-markers',
      'held-layer',
    ])('rejects malformed or overclaimed leader metadata: %s', async (change) => {
      const { packet, headers, floor, leader } = leaderFixture()
      if (change === 'null-array') Object.assign(floor, { markerLeaders: null })
      if (change === 'non-array') Object.assign(floor, { markerLeaders: 'not-an-array' })
      if (change === 'leader-limit') floor.markerLeaders = Array(101).fill(leader)
      if (change === 'null-leader') Object.assign(floor.markerLeaders ?? [], { 0: null })
      if (change === 'extra-leader-key') Object.assign(leader, { roomOwnershipConfirmed: true })
      if (change === 'missing-label') Object.assign(leader, { labelId: undefined })
      if (change === 'unknown-label') leader.labelId = 'foreign-cue'
      if (change === 'duplicate-label')
        floor.markerLeaders?.push({
          ...structuredClone(leader),
          segment: { ...structuredClone(leader.segment), operationIndex: 201 },
        })
      if (change === 'missing-target') Object.assign(leader, { cavityId: undefined })
      if (change === 'unknown-target') leader.cavityId = 'unknown-cavity'
      if (change === 'target-not-claiming') leader.cavityId = 'source-cavity-unmarked'
      if (change === 'duplicate-segment')
        floor.markerLeaders?.push({
          ...structuredClone(leader),
          labelId: 'circle-5',
          segment: {
            ...structuredClone(leader.segment),
            start: { x: 90, y: 200 },
            end: { x: 190, y: 200 },
          },
        })
      if (change === 'null-segment') Object.assign(leader, { segment: null })
      if (change === 'extra-segment-key') Object.assign(leader.segment, { cubicControls: [] })
      if (change === 'negative-operation') leader.segment.operationIndex = -1
      if (change === 'unsafe-operation') leader.segment.operationIndex = Number.MAX_SAFE_INTEGER + 1
      if (change === 'string-operation') Object.assign(leader.segment, { operationIndex: '200' })
      if (change === 'negative-subpath') leader.segment.subpathIndex = -1
      if (change === 'fractional-subpath') leader.segment.subpathIndex = 0.5
      if (change === 'nonzero-segment') leader.segment.segmentIndex = 1
      if (change === 'string-segment') Object.assign(leader.segment, { segmentIndex: '0' })
      if (change === 'null-start') Object.assign(leader.segment, { start: null })
      if (change === 'missing-end') Object.assign(leader.segment, { end: undefined })
      if (change === 'nonfinite-point') leader.segment.start.x = NaN
      if (change === 'negative-point') leader.segment.start.x = -1
      if (change === 'outside-point') leader.segment.end.y = packet.image.height + 1
      if (change === 'string-point') Object.assign(leader.segment.start, { x: '80' })
      if (change === 'identical-points') leader.segment.end = { ...leader.segment.start }
      if (change === 'extra-point-key') Object.assign(leader.segment.start, { floorSide: 'inside' })
      if (change === 'circle-endpoint') Object.assign(leader, { circleEndpoint: 'nearest' })
      if (change === 'missing-circle-endpoint') Object.assign(leader, { circleEndpoint: undefined })
      if (change === 'unavailable-markers') {
        floor.markersAvailable = false
        floor.unresolvedMarkerLabelIds = []
        packet.numberCircles = { status: 'unresolved', refusalReason: 'missing-commands', cues: [] }
        for (const cell of floor.candidates) {
          cell.markerLabelIds = []
          cell.markerStatus = 'unavailable'
        }
      }
      if (change === 'held-layer') {
        floor.status = 'unresolved'
        floor.refusalReason = 'native-layer-unavailable'
        floor.candidates = []
        floor.thresholds = []
        floor.closures = []
        floor.unprovedCavities = []
        floor.unresolvedMarkerLabelIds = []
      }
      await expect(loadFixture(packet, headers)).rejects.toMatchObject({ status: 422 })
    })
  })
  it('allows shared marker claims only when every claimant is genuinely ambiguous', async () => {
    const { packet, headers, floor } = floorFixture()
    const cell = floor.candidates[0]
    if (!cell) throw new Error('Floor fixture is missing')
    cell.markerStatus = 'ambiguous'
    floor.candidates.push({ ...structuredClone(cell), id: 'competing-cavity' })
    expect((await loadFixture(packet, headers)).packet.floorCavities).toEqual(floor)
  })
  it('keeps duplicate parent numbers ambiguous even if a duplicate marker has no candidate', async () => {
    const { packet, headers, floor } = floorFixture()
    const cell = floor.candidates[0]
    if (!cell || !packet.numberCircles) throw new Error('Floor fixture is missing')
    packet.numberCircles.cues.push({ labelId: 'circle-1-extra', sourceNumber: 1 })
    cell.markerStatus = 'ambiguous'
    floor.unresolvedMarkerLabelIds.push('circle-1-extra')
    expect((await loadFixture(packet, headers)).packet.floorCavities).toEqual(floor)
  })
  it('distinguishes unavailable marker search from unmarked cells', async () => {
    const { packet, headers, floor } = floorFixture()
    packet.numberCircles = { status: 'unresolved', refusalReason: 'circle-search-budget', cues: [] }
    floor.markersAvailable = false
    floor.unresolvedMarkerLabelIds = []
    for (const cell of floor.candidates) {
      cell.markerStatus = 'unavailable'
      cell.markerLabelIds = []
    }
    expect((await loadFixture(packet, headers)).packet.floorCavities).toEqual(floor)
  })
  it('accepts an empty atomic refusal without requiring parent candidate layers', async () => {
    const { packet, headers } = fixture()
    packet.floorCavities = {
      status: 'unresolved',
      refusalReason: 'r'.repeat(128),
      markersAvailable: false,
      candidates: [],
      thresholds: [],
      closures: [],
      unprovedCavities: [],
      unresolvedMarkerLabelIds: [],
    }
    expect((await loadFixture(packet, headers)).packet.floorCavities).toEqual(packet.floorCavities)
  })
  it('accepts exactly 4000 cell vertices and the diagnostic count bounds', async () => {
    const { packet, headers, floor } = floorFixture()
    const source = floor.candidates[1]
    if (!source) throw new Error('Floor fixture is missing')
    floor.candidates = Array.from({ length: 40 }, (_, index) => ({
      ...structuredClone(source),
      id: `cell-${index}`,
      polygon: Array.from({ length: 100 }, (_, vertex) => ({
        x: 100 + vertex,
        y: 100 + (vertex % 3),
      })),
    }))
    floor.unresolvedMarkerLabelIds = ['circle-1', 'circle-5', 'circle-8']
    const first = floor.candidates[0]
    if (!first) throw new Error('Floor fixture is missing')
    first.unknownInteriorStrokeCount = 20000
    first.omittedBoundaryInkCount = 6000
    floor.unprovedCavities = Array.from({ length: 100 }, () => ({
      reason: 'r'.repeat(128),
      vertexCount: 100000,
    }))
    expect((await loadFixture(packet, headers)).packet.floorCavities).toEqual(floor)
  })
  it.each([
    'null-layer',
    'status',
    'draft-reason',
    'refusal-with-cells',
    'missing-parent-circles',
    'missing-parent-frames',
    'marker-availability',
    'cell-limit',
    'duplicate-cell',
    'vertices-limit',
    'total-vertices',
    'nonfinite-point',
    'outside-point',
    'point-authority',
    'foreign-marker',
    'duplicate-own-marker',
    'omitted-marker',
    'unresolved-claimed',
    'false-ambiguous',
    'shared-unambiguous',
    'duplicate-number-unambiguous',
    'unknown-closure',
    'duplicate-closure-ref',
    'ambiguous-used-closure',
    'ambiguous-used-threshold',
    'duplicate-threshold',
    'foreign-threshold',
    'closure-id-collision',
    'interior-count',
    'omission-count',
    'bad-source-kind',
    'remaining-count',
    'paint-flag',
    'unproved-reason',
    'unproved-vertices',
    'accepted-floor',
    'room-name',
    'cell-area',
  ])('refuses malformed or overclaimed cavities atomically: %s', async (change) => {
    const { packet, headers, floor } = floorFixture()
    const cell = floor.candidates[0]
    const closure = floor.closures[0]
    const threshold = floor.thresholds[0]
    const point = cell?.polygon[0]
    if (!cell || !closure || !threshold || !point) throw new Error('Floor fixture is missing')
    if (change === 'null-layer') Object.assign(packet, { floorCavities: null })
    if (change === 'status') Object.assign(floor, { status: 'accepted' })
    if (change === 'draft-reason') floor.refusalReason = 'incomplete'
    if (change === 'refusal-with-cells')
      Object.assign(floor, { status: 'unresolved', refusalReason: 'incomplete' })
    if (change === 'missing-parent-circles') delete packet.numberCircles
    if (change === 'missing-parent-frames') delete packet.openingFrames
    if (change === 'marker-availability') floor.markersAvailable = false
    if (change === 'cell-limit') floor.candidates = Array(101).fill(cell)
    if (change === 'duplicate-cell') floor.candidates.push(structuredClone(cell))
    if (change === 'vertices-limit') cell.polygon = Array(101).fill(cell.polygon[0])
    if (change === 'total-vertices')
      floor.candidates = Array.from({ length: 41 }, (_, index) => ({
        ...structuredClone(cell),
        id: `cell-${index}`,
        markerStatus: 'ambiguous',
        polygon: Array.from({ length: 100 }, (_, vertex) => ({
          x: vertex + 100,
          y: 100 + (vertex % 3),
        })),
      }))
    if (change === 'nonfinite-point') point.x = NaN
    if (change === 'outside-point') point.x = -1
    if (change === 'point-authority') Object.assign(point, { sourceProof: 'accepted' })
    if (change === 'foreign-marker') cell.markerLabelIds.push('foreign')
    if (change === 'duplicate-own-marker') cell.markerLabelIds.push('circle-1')
    if (change === 'omitted-marker') floor.unresolvedMarkerLabelIds = []
    if (change === 'unresolved-claimed') floor.unresolvedMarkerLabelIds.push('circle-1')
    if (change === 'false-ambiguous') cell.markerStatus = 'ambiguous'
    if (change === 'shared-unambiguous')
      floor.candidates.push({
        ...structuredClone(cell),
        id: 'competitor',
        markerStatus: 'ambiguous',
      })
    if (change === 'duplicate-number-unambiguous' && packet.numberCircles) {
      packet.numberCircles.cues.push({ labelId: 'extra-1', sourceNumber: 1 })
      floor.unresolvedMarkerLabelIds.push('extra-1')
    }
    if (change === 'unknown-closure') cell.closureIds.push('unknown')
    if (change === 'duplicate-closure-ref') cell.closureIds.push(closure.id)
    if (change === 'ambiguous-used-closure') closure.paintAmbiguous = true
    if (change === 'ambiguous-used-threshold') threshold.paintAmbiguous = true
    if (change === 'duplicate-threshold') floor.thresholds.push({ ...threshold })
    if (change === 'foreign-threshold') threshold.frameId = 'foreign'
    if (change === 'closure-id-collision') closure.id = threshold.frameId
    if (change === 'interior-count') cell.unknownInteriorStrokeCount = 20001
    if (change === 'omission-count') cell.omittedBoundaryInkCount = 6001
    if (change === 'bad-source-kind') Object.assign(closure, { sourceKind: 'inferred-wall' })
    if (change === 'remaining-count') closure.remainingSegmentCount = 20001
    if (change === 'paint-flag') Object.assign(closure, { paintAmbiguous: 'false' })
    if (change === 'unproved-reason') floor.unprovedCavities = [{ reason: ' ', vertexCount: 4 }]
    if (change === 'unproved-vertices')
      floor.unprovedCavities = [{ reason: 'island', vertexCount: 2 }]
    if (change === 'accepted-floor') Object.assign(floor, { completeFloorInventory: true })
    if (change === 'room-name') Object.assign(cell, { roomName: 'Шахта' })
    if (change === 'cell-area') Object.assign(cell, { areaM2: 12 })
    await expect(loadFixture(packet, headers)).rejects.toMatchObject({ status: 422 })
  })
})

describe('bounded source-only symbol links', () => {
  it('preserves checks and group references without adding geometric or readiness evidence', async () => {
    const { packet, headers, links } = sourceLinksFixture()
    const sourceGeometry = structuredClone({
      doors: packet.doorSymbols,
      frames: packet.openingFrames,
      glazing: packet.glazingSymbols,
      faces: packet.faces,
    })
    const loaded = (await loadFixture(packet, headers)).packet
    expect(loaded.sourceLinks).toEqual(links)
    expect({
      doors: loaded.doorSymbols,
      frames: loaded.openingFrames,
      glazing: loaded.glazingSymbols,
      faces: loaded.faces,
    }).toEqual(sourceGeometry)
    expect(loaded.readiness).toEqual({ readOnly: true, readyFor2D: false, readyFor3D: false })
  })
  it.each(['draft', 'unresolved'] as const)('accepts an empty %s contact layer', async (status) => {
    const { packet, headers } = fixture()
    packet.sourceLinks = {
      status,
      refusalReason: status === 'unresolved' ? 'source-link-search-budget' : null,
      doors: [],
      glazing: [],
      groups: [],
    }
    expect((await loadFixture(packet, headers)).packet.sourceLinks).toEqual(packet.sourceLinks)
  })
  it('accepts an atomic refusal without pretending that all available symbols were checked', async () => {
    const { packet, headers } = sourceLinksFixture()
    packet.sourceLinks = {
      status: 'unresolved',
      refusalReason: 'source-link-search-budget',
      doors: [],
      glazing: [],
      groups: [],
    }
    expect((await loadFixture(packet, headers)).packet.sourceLinks?.status).toBe('unresolved')
  })
  it('allows a standalone linked pane and a group without door symbols', async () => {
    const { packet, headers, links } = sourceLinksFixture()
    const group = links.groups[0]
    if (!group) throw new Error('Source group fixture is missing')
    group.doorIds = []
    expect((await loadFixture(packet, headers)).packet.sourceLinks?.groups[0]?.doorIds).toEqual([])
    links.groups = []
    expect((await loadFixture(packet, headers)).packet.sourceLinks?.doors[1]?.status).toBe('linked')
  })
  it('preserves exactly 100 referenced profiles and a bounded 128-character group ID', async () => {
    const { packet, headers, links } = sourceLinksFixture()
    const symbols = packet.glazingSymbols
    const glazing = symbols?.candidates[0]
    if (!symbols || !glazing) throw new Error('Glazing fixture is missing')
    symbols.candidates = Array.from({ length: 100 }, (_, index) => ({
      ...structuredClone(glazing),
      id: `glazing-${index + 1}`,
    }))
    links.glazing = symbols.candidates.map(({ id }) => ({ symbolId: id, status: 'two-sided' }))
    links.groups = [
      {
        id: 'g'.repeat(128),
        glazingIds: symbols.candidates.map(({ id }) => id),
        doorIds: ['door-glazing'],
      },
    ]
    const loaded = (await loadFixture(packet, headers)).packet
    expect(loaded.sourceLinks?.glazing).toHaveLength(100)
    expect(loaded.sourceLinks?.groups[0]?.glazingIds).toHaveLength(100)
  })
  it('preserves exactly 100 linked door checks and group members', async () => {
    const { packet, headers, links } = sourceLinksFixture()
    const symbols = packet.doorSymbols
    const symbol = symbols?.candidates[0]
    const group = links.groups[0]
    if (!symbols || !symbol || !group) throw new Error('Door group fixture is missing')
    symbols.candidates = Array.from({ length: 100 }, (_, index) => ({
      ...structuredClone(symbol),
      id: `door-${index}`,
    }))
    links.doors = symbols.candidates.map(({ id }) => ({
      symbolId: id,
      status: 'linked',
      targetKind: 'glazing-panel',
      targetId: 'glazing-1',
      relation: 'shared-cap-edge',
    }))
    group.doorIds = symbols.candidates.map(({ id }) => id)
    const loaded = (await loadFixture(packet, headers)).packet
    expect(loaded.sourceLinks?.doors).toHaveLength(100)
    expect(loaded.sourceLinks?.groups[0]?.doorIds).toHaveLength(100)
  })
  it('accepts a bounded 128-character refusal without any partial references', async () => {
    const { packet, headers } = fixture()
    packet.sourceLinks = {
      status: 'unresolved',
      refusalReason: 'r'.repeat(128),
      doors: [],
      glazing: [],
      groups: [],
    }
    expect((await loadFixture(packet, headers)).packet.sourceLinks?.refusalReason).toHaveLength(128)
  })
  it.each([
    'null-layer',
    'status',
    'draft-reason',
    'empty-reason',
    'long-reason',
    'refusal-with-doors',
    'refusal-with-glazing',
    'refusal-with-groups',
    'missing-doors',
    'missing-glazing',
    'missing-groups',
    'door-limit',
    'glazing-limit',
    'group-limit',
    'null-door',
    'unknown-door',
    'duplicate-door',
    'missing-door-check',
    'door-status',
    'unknown-target-kind',
    'missing-target',
    'unknown-frame',
    'unknown-glazing',
    'frame-relation',
    'glazing-relation',
    'unresolved-target',
    'ambiguous-target',
    'unresolved-relation',
    'ambiguous-relation',
    'null-glazing',
    'unknown-glazing-check',
    'duplicate-glazing',
    'missing-glazing-check',
    'glazing-status',
    'null-group',
    'blank-group-id',
    'long-group-id',
    'duplicate-group-id',
    'missing-group-glazing',
    'missing-group-doors',
    'singleton-group',
    'group-glazing-limit',
    'group-door-limit',
    'unknown-group-glazing',
    'unresolved-group-glazing',
    'ambiguous-group-glazing',
    'duplicate-group-glazing',
    'globally-duplicate-glazing',
    'unknown-group-door',
    'unresolved-group-door',
    'ambiguous-group-door',
    'frame-group-door',
    'foreign-group-door',
    'duplicate-group-door',
    'refused-door-layer',
    'refused-frame-layer',
    'refused-glazing-layer',
  ])('rejects malformed contact references atomically: %s', async (change) => {
    const { packet, headers, links } = sourceLinksFixture()
    const [frameDoor, glazingDoor, unresolvedDoor, ambiguousDoor] = links.doors
    const [glazing] = links.glazing
    const [group] = links.groups
    if (!frameDoor || !glazingDoor || !unresolvedDoor || !ambiguousDoor || !glazing || !group)
      throw new Error('Source links fixture is missing')
    if (change === 'null-layer') Object.assign(packet, { sourceLinks: null })
    if (change === 'status') Object.assign(links, { status: 'accepted' })
    if (change === 'draft-reason') links.refusalReason = 'source-link-search-budget'
    if (change === 'empty-reason' || change === 'long-reason') {
      Object.assign(links, {
        status: 'unresolved',
        refusalReason: change === 'empty-reason' ? ' ' : 'r'.repeat(129),
        doors: [],
        glazing: [],
        groups: [],
      })
    }
    if (change.startsWith('refusal-with-')) {
      links.status = 'unresolved'
      links.refusalReason = 'source-link-search-budget'
      if (change !== 'refusal-with-doors') links.doors = []
      if (change !== 'refusal-with-glazing') links.glazing = []
      if (change !== 'refusal-with-groups') links.groups = []
    }
    if (change === 'missing-doors') Object.assign(links, { doors: null })
    if (change === 'missing-glazing') Object.assign(links, { glazing: null })
    if (change === 'missing-groups') Object.assign(links, { groups: null })
    if (change === 'door-limit') links.doors = Array(101).fill(frameDoor)
    if (change === 'glazing-limit') links.glazing = Array(101).fill(glazing)
    if (change === 'group-limit') links.groups = Array(101).fill(group)
    if (change === 'null-door') Object.assign(links.doors, { 0: null })
    if (change === 'unknown-door') frameDoor.symbolId = 'unknown-door'
    if (change === 'duplicate-door') links.doors[1] = structuredClone(frameDoor)
    if (change === 'missing-door-check') links.doors.pop()
    if (change === 'door-status') Object.assign(frameDoor, { status: 'accepted' })
    if (change === 'unknown-target-kind') Object.assign(frameDoor, { targetKind: 'wall' })
    if (change === 'missing-target') frameDoor.targetId = null
    if (change === 'unknown-frame') frameDoor.targetId = 'unknown-frame'
    if (change === 'unknown-glazing') glazingDoor.targetId = 'unknown-glazing'
    if (change === 'frame-relation') frameDoor.relation = 'shared-cap-edge'
    if (change === 'glazing-relation') glazingDoor.relation = 'jamb-to-frame'
    if (change === 'unresolved-target') unresolvedDoor.targetId = frameDoor.targetId
    if (change === 'ambiguous-target') ambiguousDoor.targetKind = 'opening-frame'
    if (change === 'unresolved-relation') unresolvedDoor.relation = 'jamb-to-frame'
    if (change === 'ambiguous-relation') ambiguousDoor.relation = 'shared-cap-edge'
    if (change === 'null-glazing') Object.assign(links.glazing, { 0: null })
    if (change === 'unknown-glazing-check') glazing.symbolId = 'unknown-glazing'
    if (change === 'duplicate-glazing') links.glazing[1] = structuredClone(glazing)
    if (change === 'missing-glazing-check') links.glazing.pop()
    if (change === 'glazing-status') Object.assign(glazing, { status: 'linked' })
    if (change === 'null-group') Object.assign(links.groups, { 0: null })
    if (change === 'blank-group-id') group.id = ' '
    if (change === 'long-group-id') group.id = 'g'.repeat(129)
    if (change === 'duplicate-group-id') links.groups.push(structuredClone(group))
    if (change === 'missing-group-glazing') Object.assign(group, { glazingIds: null })
    if (change === 'missing-group-doors') Object.assign(group, { doorIds: null })
    if (change === 'singleton-group') group.glazingIds.pop()
    if (change === 'group-glazing-limit') group.glazingIds = Array(101).fill('glazing-1')
    if (change === 'group-door-limit') group.doorIds = Array(101).fill('door-glazing')
    if (change === 'unknown-group-glazing') group.glazingIds[0] = 'unknown-glazing'
    if (change === 'unresolved-group-glazing') group.glazingIds[0] = 'glazing-unresolved'
    if (change === 'ambiguous-group-glazing') group.glazingIds[0] = 'glazing-ambiguous'
    if (change === 'duplicate-group-glazing') group.glazingIds[1] = 'glazing-1'
    if (change === 'globally-duplicate-glazing')
      links.groups.push({ ...structuredClone(group), id: 'source-group-2', doorIds: [] })
    if (change === 'unknown-group-door') group.doorIds[0] = 'unknown-door'
    if (change === 'unresolved-group-door') group.doorIds[0] = 'door-unresolved'
    if (change === 'ambiguous-group-door') group.doorIds[0] = 'door-ambiguous'
    if (change === 'frame-group-door') group.doorIds[0] = 'door-frame'
    if (change === 'foreign-group-door') {
      glazingDoor.targetId = 'glazing-unresolved'
    }
    if (change === 'duplicate-group-door') group.doorIds.push('door-glazing')
    if (change.startsWith('refused-')) {
      const layer =
        change === 'refused-door-layer'
          ? packet.doorSymbols
          : change === 'refused-frame-layer'
            ? packet.openingFrames
            : packet.glazingSymbols
      if (!layer) throw new Error('Candidate layer fixture is missing')
      Object.assign(layer, {
        status: 'unresolved',
        refusalReason: 'source-search-budget',
        candidates: [],
      })
      if (change === 'refused-door-layer') links.doors = []
      if (change === 'refused-frame-layer') {
        frameDoor.status = 'unresolved'
        frameDoor.targetKind = null
        frameDoor.targetId = null
        frameDoor.relation = null
      }
      if (change === 'refused-glazing-layer') {
        links.glazing = []
        links.groups = []
        glazingDoor.status = 'unresolved'
        glazingDoor.targetKind = null
        glazingDoor.targetId = null
        glazingDoor.relation = null
      }
    }
    await expect(loadFixture(packet, headers)).rejects.toMatchObject({ status: 422 })
  })
})

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
  describe('saved frame-to-manual-zone correspondence', () => {
    function frameRoomsFixture() {
      const result = coveredFixture()
      result.packet.openingFrames = openingFrames()
      result.packet.numberCircles = {
        status: 'draft',
        refusalReason: null,
        cues: [1, 2, 5].map((sourceNumber) => ({
          labelId: `native-label-${sourceNumber}`,
          sourceNumber,
        })),
      }
      const review: Extract<
        NonNullable<NativeReviewPacket['savedFrameRooms']>,
        { status: 'checked' }
      > = {
        status: 'checked',
        frames: [
          {
            frameId: 'native-opening-frame-1:0',
            status: 'two-reviewed-sides',
            sides: [
              {
                roomSourceNumbers: [1, 5],
                openingId: 'manual-zone-1-5-door',
                kind: 'door',
                frameEdgeIndex: 0,
                numberCue: 'inside',
              },
              {
                roomSourceNumbers: [2],
                openingId: 'manual-zone-2-door',
                kind: 'door',
                frameEdgeIndex: 2,
                numberCue: 'inside',
              },
            ],
          },
        ],
      }
      result.packet.savedFrameRooms = review
      return { ...result, review }
    }
    it('preserves manual merged zones without creating geometry or automatic room ownership', async () => {
      const { packet, headers, review } = frameRoomsFixture()
      const loaded = (await loadFixture(packet, headers)).packet
      expect(loaded.savedFrameRooms).toEqual(review)
      expect(loaded.openingFrames).toEqual(packet.openingFrames)
      expect(loaded.faces).toEqual(packet.faces)
      expect(loaded.savedReview).toEqual(packet.savedReview)
      expect(loaded.readiness).toEqual({ readOnly: true, readyFor2D: false, readyFor3D: false })
    })
    it.each(['not-saved', 'unavailable', 'refused'] as const)(
      'accepts bounded %s correspondence states',
      async (status) => {
        const { packet, headers } = fixture()
        packet.savedFrameRooms =
          status === 'not-saved' ? { status } : { status, reason: 'r'.repeat(128) }
        expect((await loadFixture(packet, headers)).packet.savedFrameRooms).toEqual(
          packet.savedFrameRooms,
        )
      },
    )
    it.each(['one-reviewed-side', 'coincident-sides', 'ambiguous', 'unresolved'] as const)(
      'preserves the distinction of %s without approving a physical passage',
      async (status) => {
        const { packet, headers, review } = frameRoomsFixture()
        const frame = review.frames[0]
        if (!frame?.sides[1]) throw new Error('Frame-zone fixture is missing')
        frame.status = status
        if (status === 'one-reviewed-side') frame.sides.pop()
        if (status === 'coincident-sides') frame.sides[1].frameEdgeIndex = 0
        if (status === 'unresolved') frame.sides = []
        expect((await loadFixture(packet, headers)).packet.savedFrameRooms).toEqual(review)
      },
    )
    it.each(['not-inside', 'ambiguous', 'unavailable'] as const)(
      'does not require a matching number observation for %s',
      async (numberCue) => {
        const { packet, headers, review } = frameRoomsFixture()
        for (const side of review.frames[0]?.sides ?? []) side.numberCue = numberCue
        delete packet.numberCircles
        expect((await loadFixture(packet, headers)).packet.savedFrameRooms).toEqual(review)
      },
    )
    it('accepts the exact frame and aggregate side limits with bounded manual identifiers', async () => {
      const { packet, headers, review } = frameRoomsFixture()
      const sourceFrame = packet.openingFrames?.candidates[0]
      const frame = review.frames[0]
      if (!packet.openingFrames || !sourceFrame || !frame)
        throw new Error('Frame-zone fixture is missing')
      packet.openingFrames.candidates = Array.from({ length: 100 }, (_, index) => ({
        ...structuredClone(sourceFrame),
        id: `frame-${index}`,
      }))
      review.frames = packet.openingFrames.candidates.map(({ id }, index) => ({
        ...structuredClone(frame),
        frameId: id,
        sides: frame.sides.map((side) => ({
          ...structuredClone(side),
          openingId: `${side.openingId}-${index}`,
        })),
      }))
      const firstSide = review.frames[0]?.sides[0]
      if (!firstSide) throw new Error('Frame-zone fixture is missing')
      firstSide.openingId = 'o'.repeat(128)
      firstSide.roomSourceNumbers = Array.from({ length: 12 }, (_, index) =>
        index === 11 ? 10000 : index + 1,
      )
      firstSide.numberCue = 'not-inside'
      expect((await loadFixture(packet, headers)).packet.savedFrameRooms).toEqual(review)
    })
    it('accepts exactly 50 ambiguous sides while retaining per-zone opening identity', async () => {
      const { packet, headers, review } = frameRoomsFixture()
      const frame = review.frames[0]
      const side = frame?.sides[0]
      if (!frame || !side) throw new Error('Frame-zone fixture is missing')
      frame.status = 'ambiguous'
      frame.sides = Array.from({ length: 50 }, (_, index) => ({
        ...structuredClone(side),
        openingId: `opening-${index}`,
      }))
      expect((await loadFixture(packet, headers)).packet.savedFrameRooms).toEqual(review)
    })
    it.each(['both', 'only-first', 'neither'] as const)(
      'requires all frames sharing a declaration to remain ambiguous: %s',
      async (ambiguous) => {
        const { packet, headers, review } = frameRoomsFixture()
        const sourceFrame = packet.openingFrames?.candidates[0]
        const frame = review.frames[0]
        if (!packet.openingFrames || !sourceFrame || !frame)
          throw new Error('Frame-zone fixture is missing')
        packet.openingFrames.candidates.push({ ...sourceFrame, id: 'second-native-frame' })
        review.frames.push({ ...structuredClone(frame), frameId: 'second-native-frame' })
        if (ambiguous !== 'neither') frame.status = 'ambiguous'
        const second = review.frames[1]
        if (!second) throw new Error('Second frame is missing')
        if (ambiguous === 'both') second.status = 'ambiguous'
        if (ambiguous === 'both') {
          expect((await loadFixture(packet, headers)).packet.savedFrameRooms).toEqual(review)
        } else {
          await expect(loadFixture(packet, headers)).rejects.toMatchObject({ status: 422 })
        }
      },
    )
    it.each([
      'null-layer',
      'status',
      'not-saved-payload',
      'missing-reason',
      'blank-reason',
      'long-reason',
      'missing-frames',
      'frame-limit',
      'null-frame',
      'unknown-frame',
      'blank-frame',
      'long-frame',
      'duplicate-frame',
      'missing-frame',
      'frame-status',
      'missing-sides',
      'null-side',
      'side-limit',
      'aggregate-side-limit',
      'missing-numbers',
      'empty-numbers',
      'numbers-limit',
      'string-number',
      'fractional-number',
      'zero-number',
      'large-number',
      'unsorted-numbers',
      'duplicate-number',
      'missing-opening',
      'blank-opening',
      'long-opening',
      'duplicate-side',
      'kind',
      'edge-string',
      'edge-fraction',
      'edge-negative',
      'edge-limit',
      'cue',
      'inside-missing-circles',
      'inside-foreign-number',
      'inside-partial-merged-zone',
      'inside-duplicate-number',
      'two-one-side',
      'two-same-zone',
      'two-same-edge',
      'two-adjacent-edges',
      'two-kind-conflict',
      'two-windows',
      'one-two-sides',
      'coincident-one-side',
      'coincident-distinct-edges',
      'coincident-same-zone',
      'ambiguous-empty',
      'unresolved-many',
      'missing-frame-layer',
      'unresolved-frame-layer',
      'not-saved-review',
      'refused-saved-review',
      'room-name',
      'geometry',
      'physical-passage',
    ])('refuses malformed or overclaimed manual correspondence: %s', async (change) => {
      const { packet, headers, review, coverage } = frameRoomsFixture()
      const frame = review.frames[0]
      const first = frame?.sides[0]
      const second = frame?.sides[1]
      if (!frame || !first || !second) throw new Error('Frame-zone fixture is missing')
      if (change === 'null-layer') Object.assign(packet, { savedFrameRooms: null })
      if (change === 'status') Object.assign(review, { status: 'accepted' })
      if (change === 'not-saved-payload') Object.assign(review, { status: 'not-saved' })
      if (change.includes('reason'))
        packet.savedFrameRooms = {
          status: 'unavailable',
          reason:
            change === 'missing-reason'
              ? (undefined as unknown as string)
              : change === 'blank-reason'
                ? ' '
                : 'r'.repeat(129),
        }
      if (change === 'missing-frames') Object.assign(review, { frames: null })
      if (change === 'frame-limit') review.frames = Array(101).fill(frame)
      if (change === 'null-frame') Object.assign(review.frames, { 0: null })
      if (change === 'unknown-frame') frame.frameId = 'foreign-frame'
      if (change === 'blank-frame') frame.frameId = ' '
      if (change === 'long-frame') frame.frameId = 'f'.repeat(129)
      if (change === 'duplicate-frame') review.frames.push(structuredClone(frame))
      if (change === 'missing-frame') review.frames = []
      if (change === 'frame-status') Object.assign(frame, { status: 'paired' })
      if (change === 'missing-sides') Object.assign(frame, { sides: null })
      if (change === 'null-side') Object.assign(frame.sides, { 0: null })
      if (change === 'side-limit') {
        frame.status = 'ambiguous'
        frame.sides = Array(51).fill(first)
      }
      if (change === 'aggregate-side-limit') {
        const sourceFrame = packet.openingFrames?.candidates[0]
        if (!packet.openingFrames || !sourceFrame) throw new Error('Frame fixture is missing')
        packet.openingFrames.candidates = Array.from({ length: 5 }, (_, index) => ({
          ...structuredClone(sourceFrame),
          id: `frame-${index}`,
        }))
        review.frames = packet.openingFrames.candidates.map(({ id }) => ({
          frameId: id,
          status: 'ambiguous',
          sides: Array.from({ length: 41 }, (_, index) => ({
            ...structuredClone(first),
            openingId: `opening-${index}`,
          })),
        }))
      }
      if (change === 'missing-numbers') Object.assign(first, { roomSourceNumbers: null })
      if (change === 'empty-numbers') first.roomSourceNumbers = []
      if (change === 'numbers-limit')
        first.roomSourceNumbers = Array.from({ length: 13 }, (_, index) => index + 1)
      if (change === 'string-number') Object.assign(first, { roomSourceNumbers: ['1'] })
      if (change === 'fractional-number') first.roomSourceNumbers = [1.5]
      if (change === 'zero-number') first.roomSourceNumbers = [0]
      if (change === 'large-number') first.roomSourceNumbers = [10001]
      if (change === 'unsorted-numbers') first.roomSourceNumbers = [5, 1]
      if (change === 'duplicate-number') first.roomSourceNumbers = [1, 1]
      if (change === 'missing-opening') Object.assign(first, { openingId: undefined })
      if (change === 'blank-opening') first.openingId = ' '
      if (change === 'long-opening') first.openingId = 'o'.repeat(129)
      if (change === 'duplicate-side') {
        frame.status = 'ambiguous'
        frame.sides.push(structuredClone(first))
      }
      if (change === 'kind') Object.assign(first, { kind: 'entrance' })
      if (change === 'edge-string') Object.assign(first, { frameEdgeIndex: '0' })
      if (change === 'edge-fraction') first.frameEdgeIndex = 0.5
      if (change === 'edge-negative') first.frameEdgeIndex = -1
      if (change === 'edge-limit') first.frameEdgeIndex = 4
      if (change === 'cue') Object.assign(first, { numberCue: 'confirmed-owner' })
      if (change === 'inside-missing-circles') delete packet.numberCircles
      if (change === 'inside-foreign-number') first.roomSourceNumbers = [9]
      if (change === 'inside-partial-merged-zone') first.roomSourceNumbers = [1, 9]
      if (change === 'inside-duplicate-number')
        packet.numberCircles?.cues.push({ labelId: 'repeated-label-1', sourceNumber: 1 })
      if (change === 'two-one-side') frame.sides.pop()
      if (change === 'two-same-zone') second.roomSourceNumbers = [...first.roomSourceNumbers]
      if (change === 'two-same-edge') second.frameEdgeIndex = 0
      if (change === 'two-adjacent-edges') second.frameEdgeIndex = 1
      if (change === 'two-kind-conflict') second.kind = 'window'
      if (change === 'two-windows') {
        first.kind = 'window'
        second.kind = 'window'
      }
      if (change === 'one-two-sides') frame.status = 'one-reviewed-side'
      if (change === 'coincident-one-side') {
        frame.status = 'coincident-sides'
        frame.sides.pop()
      }
      if (change === 'coincident-distinct-edges') frame.status = 'coincident-sides'
      if (change === 'coincident-same-zone') {
        frame.status = 'coincident-sides'
        second.frameEdgeIndex = 0
        second.roomSourceNumbers = [...first.roomSourceNumbers]
      }
      if (change === 'ambiguous-empty') {
        frame.status = 'ambiguous'
        frame.sides = []
      }
      if (change === 'unresolved-many') {
        frame.status = 'unresolved'
        frame.sides.push({ ...structuredClone(first), openingId: 'third' })
      }
      if (change === 'missing-frame-layer') delete packet.openingFrames
      if (change === 'unresolved-frame-layer')
        packet.openingFrames = {
          status: 'unresolved',
          refusalReason: 'frame-search-budget',
          candidates: [],
        }
      if (change === 'not-saved-review') packet.savedReview = { status: 'not-saved' }
      if (change === 'refused-saved-review') {
        coverage.status = 'refused'
        coverage.refusalReason = 'source-unavailable'
      }
      if (change === 'room-name') Object.assign(first, { roomName: 'Кухня' })
      if (change === 'geometry') Object.assign(review, { floor: [] })
      if (change === 'physical-passage') Object.assign(frame, { physicalPassageAccepted: true })
      await expect(loadFixture(packet, headers)).rejects.toMatchObject({ status: 422 })
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
