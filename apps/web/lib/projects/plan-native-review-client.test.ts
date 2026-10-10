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
