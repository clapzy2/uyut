import { afterEach, describe, expect, it, vi } from 'vitest'
import * as floors from './plan-native-floor-cavities'
import * as locations from './plan-native-height-locations'
import { nativeHeightObjectEvidence } from './plan-native-height-objects'
import * as heights from './plan-native-height-observations'
import * as schedules from './plan-native-room-number-links'

type Input = Parameters<typeof nativeHeightObjectEvidence>[0]
function present<T>(value: T | undefined): T {
  if (value === undefined) throw new Error('Expected fixture value')
  return value
}
const note =
  'Потолок в квартире - натяжной, отметки потолка в пределах: от 2600 мм до 2800 мм от уровня существующего пола.'

function fixture() {
  const input: Input = {
    source: { sha256: 'b'.repeat(64), pdfPage: 1, state: 'existing' },
    native: {
      source: { sha256: 'a'.repeat(64), page: 1, width: 1000, height: 1000 },
      complete: true,
      originalPdfSha256: 'b'.repeat(64),
      pageNormalizedScale: { x: 1, y: 1 },
      labels: [],
    },
    work: {
      coordinateSystem: 'page-0-1000',
      pageWidth: 1000,
      pageHeight: 1000,
      paths: [],
      skippedCurves: 0,
      clippedPaths: 0,
      unsupportedPaths: 0,
      unsupportedContexts: 0,
      truncated: false,
    },
    lineworkSource: { sha256: 'a'.repeat(64), page: 1, width: 1000, height: 1000 },
  }
  const addLabel = (text: string) => {
    const index = input.native.labels.length
    input.native.labels.push({
      id: `native-text-${index}`,
      nativeIndex: index,
      name: text,
      point: { x: 10, y: 20 },
      pagePoint: { x: 10, y: 20 },
      rotation: 0,
    })
    return index
  }
  addLabel('Натяжной потолок = 2700 мм')
  const observations = [
    {
      labelId: 'native-text-0',
      originalText: present(input.native.labels[0]).name,
      pagePoint: { x: 10, y: 20 },
      valueMm: 2700,
      quantityKind: 'finished-ceiling' as const,
      datum: 'unspecified' as 'unspecified' | 'existing-floor' | 'finished-floor',
      issueCodes: [],
      mayAcceptFor3D: false as const,
    },
  ]
  const locationRows = [
    {
      labelId: 'native-text-0',
      status: 'unresolved' as const,
      cavityIds: [],
      inkSourceOperation: 99,
      reason: 'outboard-height-caption-leader-unverified',
      leader: {
        status: 'linked' as 'linked' | 'unresolved' | 'ambiguous',
        cavityIds: ['cavity-1'],
        reason: null as string | null,
      },
    },
  ]
  const cavities = [
    {
      id: 'cavity-1',
      polygon: [],
      boundaries: [],
      paintColor: '#000000',
      markerLabelIds: ['native-text-3'],
      markerStatus: 'unambiguous' as 'unambiguous' | 'ambiguous',
      closureIds: [],
      unknownInteriorStrokeCount: 0,
      omittedBoundaryInkCount: 0,
    },
  ]
  const rows = [
    {
      sourceNumber: 4,
      name: 'Спальня',
      documentaryAreaM2: 10,
      numberLabelId: 'native-text-4',
      nameLabelId: 'native-text-5',
      areaLabelId: 'native-text-6',
      markerStatus: 'linked' as const,
      markerLabelIds: ['native-text-3'],
    },
  ]
  vi.spyOn(heights, 'nativeHeightObservations').mockImplementation(
    () =>
      ({ status: 'draft', refusalReason: null, observations }) as unknown as ReturnType<
        typeof heights.nativeHeightObservations
      >,
  )
  vi.spyOn(locations, 'nativeHeightSourceLocations').mockImplementation(
    () =>
      ({
        status: 'draft',
        refusalReason: null,
        observations: locationRows,
      }) as unknown as ReturnType<typeof locations.nativeHeightSourceLocations>,
  )
  vi.spyOn(floors, 'nativeFloorCavityCandidates').mockImplementation(
    () =>
      ({ status: 'draft', refusalReason: null, cavities }) as unknown as ReturnType<
        typeof floors.nativeFloorCavityCandidates
      >,
  )
  vi.spyOn(schedules, 'nativeRoomNumberScheduleLinks').mockImplementation(
    () =>
      ({
        report: { status: 'draft', refusalReason: null, rows, unlistedMarkerLabelIds: [] },
      }) as unknown as ReturnType<typeof schedules.nativeRoomNumberScheduleLinks>,
  )
  const addNote = (text = note) => {
    const index = addLabel(text)
    input.native.heightDatumInk ??= {
      source: { sha256: input.source.sha256, pdfPage: 1, pageWidth: 1000, pageHeight: 1000 },
      complete: true,
      refusalReason: null,
      items: [],
      unresolved: [],
    }
    input.native.heightDatumInk.items.push({
      index,
      text,
      fontName: 'F1',
      operationIndex: 100 + index,
      quad: [
        { x: 10, y: 10 },
        { x: 20, y: 10 },
        { x: 20, y: 20 },
        { x: 10, y: 20 },
      ],
      baselineStart: { x: 10, y: 20 },
      baselineEnd: { x: 20, y: 20 },
    })
  }
  return { input, observations, locationRows, cavities, rows, addLabel, addNote }
}
afterEach(() => vi.restoreAllMocks())

describe('nativeHeightObjectEvidence', () => {
  it('proposes the source numbered ceiling without accepting geometry or a shared zero', () => {
    const { input, addNote } = fixture()
    addNote()
    const before = structuredClone(input)
    const result = nativeHeightObjectEvidence(input)
    expect(result.bindings[0]).toMatchObject({
      objectStatus: 'proposed',
      targets: [{ sourceRoomNumber: 4, roomName: 'Спальня', markerLabelId: 'native-text-3' }],
      datumEvidence: {
        status: 'documentary',
        kind: 'existing-floor',
        sourceLabelIds: ['native-text-1'],
      },
    })
    expect(result).toMatchObject({
      readOnly: true,
      commonZeroConfirmed: false,
      geometryOwnersConfirmed: false,
      mayTransfer2D3D: false,
    })
    expect(input).toEqual(before)
  })
  it('holds shared cavity markers without choosing the nearest name', () => {
    const { input, cavities, rows } = fixture()
    present(cavities[0]).markerStatus = 'ambiguous'
    present(cavities[0]).markerLabelIds.push('native-text-7')
    rows.push({
      ...present(rows[0]),
      sourceNumber: 5,
      name: 'Кухня',
      markerLabelIds: ['native-text-7'],
    })
    expect(nativeHeightObjectEvidence(input).bindings[0]).toMatchObject({
      objectStatus: 'ambiguous',
      targets: [{ sourceRoomNumber: 4 }, { sourceRoomNumber: 5 }],
    })
  })
  it('keeps two separately linked ceilings attached to their own source markers', () => {
    const { input, observations, locationRows, cavities, rows, addLabel } = fixture()
    addLabel('Натяжной потолок = 2750 мм')
    observations.push({ ...present(observations[0]), labelId: 'native-text-1', valueMm: 2750 })
    locationRows.push({
      ...present(locationRows[0]),
      labelId: 'native-text-1',
      leader: { status: 'linked', cavityIds: ['cavity-2'], reason: null },
    })
    cavities.push({ ...present(cavities[0]), id: 'cavity-2', markerLabelIds: ['native-text-7'] })
    rows.push({ ...present(rows[0]), sourceNumber: 6, markerLabelIds: ['native-text-7'] })
    expect(nativeHeightObjectEvidence(input).bindings).toMatchObject([
      {
        labelId: 'native-text-0',
        objectStatus: 'proposed',
        targets: [{ cavityId: 'cavity-1', sourceRoomNumber: 4 }],
      },
      {
        labelId: 'native-text-1',
        objectStatus: 'proposed',
        targets: [{ cavityId: 'cavity-2', sourceRoomNumber: 6 }],
      },
    ])
  })
  it.each(['omittedBoundaryInkCount'] as const)('holds floor with %s', (field) => {
    const { input, cavities } = fixture()
    present(cavities[0])[field] = 1
    expect(nativeHeightObjectEvidence(input).bindings[0]).toMatchObject({
      objectStatus: 'unresolved',
      targets: [],
      objectReason: 'height-object-floor-unverified',
    })
  })
  it('recomputes leader links instead of accepting cached output', () => {
    const { input, locationRows } = fixture()
    expect(present(nativeHeightObjectEvidence(input).bindings[0]).objectStatus).toBe('proposed')
    present(locationRows[0]).leader.status = 'unresolved'
    expect(present(nativeHeightObjectEvidence(input).bindings[0]).objectStatus).toBe('unresolved')
  })
  it('keeps ceiling proposals while missing note glyph evidence holds datum', () => {
    const { input, addLabel } = fixture()
    addLabel(note)
    expect(nativeHeightObjectEvidence(input)).toMatchObject({
      declarations: [{ status: 'unresolved', reason: 'height-datum-ink-unavailable' }],
      bindings: [{ objectStatus: 'proposed', datumEvidence: { status: 'unresolved' } }],
    })
  })
  it('keeps unknown annotation strokes distinct from accepted floor clearance', () => {
    const { input, cavities } = fixture()
    present(cavities[0]).unknownInteriorStrokeCount = 166
    expect(nativeHeightObjectEvidence(input)).toMatchObject({
      geometryOwnersConfirmed: false,
      mayTransfer2D3D: false,
      bindings: [{ objectStatus: 'proposed' }],
    })
  })
  it('accounts for an unresolved competing font note rather than using only the readable one', () => {
    const { input, addNote, addLabel } = fixture()
    addNote()
    const index = addLabel(note)
    present(input.native.heightDatumInk).complete = false
    present(input.native.heightDatumInk).unresolved.push({
      index,
      reason: 'unsupported-native-text-ink-glyph',
    })
    expect(present(nativeHeightObjectEvidence(input).bindings[0]).datumEvidence.status).toBe(
      'unresolved',
    )
  })
  it.each([
    `${note} Кроме спальни.`,
    note.replace('натяжной', 'предположительно натяжной'),
    note.replace('Потолок', 'Потолок\u200b'),
  ])('holds a competing unsupported scope note: %s', (unsupported) => {
    const { input, addNote } = fixture()
    addNote()
    addNote(unsupported)
    const result = nativeHeightObjectEvidence(input)
    expect(result.unsupportedDeclarations).toEqual([
      {
        labelId: 'native-text-2',
        originalText: unsupported,
        reason: 'unsupported-ceiling-datum-declaration',
      },
    ])
    expect(result.bindings[0]).toMatchObject({
      objectStatus: 'proposed',
      datumEvidence: {
        status: 'unresolved',
        kind: null,
        sourceLabelIds: ['native-text-1', 'native-text-2'],
        reason: 'unsupported-ceiling-datum-declarations',
      },
    })
  })
  it('does not bypass an unsupported scope note with a verified inline datum', () => {
    const { input, observations, addNote } = fixture()
    present(observations[0]).datum = 'existing-floor'
    addNote(`${note} Кроме спальни.`)
    expect(nativeHeightObjectEvidence(input).bindings[0]).toMatchObject({
      objectStatus: 'proposed',
      datumEvidence: {
        status: 'unresolved',
        sourceLabelIds: ['native-text-0', 'native-text-1'],
        reason: 'unsupported-ceiling-datum-declarations',
      },
    })
  })
  it.each(['missing', 'foreign', 'invalid-shape'] as const)(
    'still validates the unsupported note inventory: %s',
    (mutation) => {
      const { input, addNote } = fixture()
      addNote()
      addNote(`${note} Кроме спальни.`)
      const ink = present(input.native.heightDatumInk)
      if (mutation === 'missing') ink.items.pop()
      if (mutation === 'foreign') present(ink.items[1]).index = 999
      if (mutation === 'invalid-shape') present(present(ink.items[1]).quad[2]).x += 1
      expect(nativeHeightObjectEvidence(input)).toMatchObject({
        status: 'unresolved',
        declarations: [],
        unsupportedDeclarations: [],
        bindings: [],
      })
    },
  )
  it.each(['finished-floor', 'different-range'])(
    'holds all conflicting %s declarations',
    (variant) => {
      const { input, addNote } = fixture()
      addNote()
      addNote(
        variant === 'finished-floor'
          ? note.replace('существующего', 'чистого')
          : note.replace('2600', '2650'),
      )
      const result = nativeHeightObjectEvidence(input)
      expect(
        result.declarations.every(
          (row) =>
            row.status === 'unresolved' && row.reason === 'conflicting-ceiling-datum-declarations',
        ),
      ).toBe(true)
      expect(present(result.bindings[0]).datumEvidence.sourceLabelIds).toEqual([
        'native-text-1',
        'native-text-2',
      ])
    },
  )
  it('uses verified inline datum independently when no global note exists', () => {
    const { input, observations } = fixture()
    present(observations[0]).datum = 'finished-floor'
    expect(present(nativeHeightObjectEvidence(input).bindings[0]).datumEvidence).toEqual({
      status: 'documentary',
      kind: 'finished-floor',
      sourceLabelIds: ['native-text-0'],
      reason: null,
    })
  })
  it('holds contradictory inline and global datum', () => {
    const { input, observations, addNote } = fixture()
    present(observations[0]).datum = 'finished-floor'
    addNote()
    expect(present(nativeHeightObjectEvidence(input).bindings[0]).datumEvidence.reason).toBe(
      'inline-global-height-datum-conflict',
    )
  })
  it('does not average a ceiling outside the declared range', () => {
    const { input, observations, addNote } = fixture()
    addNote()
    present(observations[0]).valueMm = 2900
    expect(nativeHeightObjectEvidence(input).bindings[0]).toMatchObject({
      objectStatus: 'proposed',
      datumEvidence: { status: 'unresolved', reason: 'ceiling-height-outside-declared-range' },
    })
  })
  it.each(['beam-level', 'opening-height', 'threshold-level', 'unclassified-height'] as const)(
    'does not assign a %s to a room ceiling',
    (kind) => {
      const { input, observations } = fixture()
      present(observations[0]).quantityKind = kind as 'finished-ceiling'
      expect(nativeHeightObjectEvidence(input).bindings).toHaveLength(1)
      expect(nativeHeightObjectEvidence(input).bindings[0]).toMatchObject({
        objectStatus: 'unresolved',
        targets: [],
        datumEvidence: { status: 'unresolved' },
      })
    },
  )
  it.each(['source', 'incomplete', 'duplicate', 'text', 'baseline', 'quad'] as const)(
    'atomically refuses %s note inventory',
    (mutation) => {
      const { input, addNote } = fixture()
      addNote()
      const ink = present(input.native.heightDatumInk)
      if (mutation === 'source') ink.source.sha256 = 'c'.repeat(64)
      if (mutation === 'incomplete') ink.items = []
      if (mutation === 'duplicate') ink.items.push(structuredClone(present(ink.items[0])))
      if (mutation === 'text') present(ink.items[0]).text += '!'
      if (mutation === 'baseline') present(ink.items[0]).baselineStart.x += 0.01
      if (mutation === 'quad') present(present(ink.items[0]).quad[2]).x += 1
      expect(nativeHeightObjectEvidence(input)).toMatchObject({
        status: 'unresolved',
        bindings: [],
        declarations: [],
      })
    },
  )
})
