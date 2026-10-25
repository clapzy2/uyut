import {
  currentProjectedVerticalEvidence,
  parsePrintedProjectValue,
  projectedVerticalEvidenceSchema,
} from '@uyut/catalog/plan-projected-vertical-evidence'
import type { PlanGeometry, PlanProjectedVerticalEvidence } from '@uyut/db'
import { describe, expect, it } from 'vitest'
import { planVolume, planVolumeBlocker } from './plan-volume'

function required<T>(value: T | undefined): T {
  if (value === undefined) throw new Error('Missing test fixture value')
  return value
}

function fixture(): PlanGeometry {
  const geometry: PlanGeometry = {
    version: 1,
    status: 'draft',
    widthCm: 400,
    heightCm: 300,
    walls: [{ id: 'wall', kind: 'outer', start: { xCm: 0, yCm: 0 }, end: { xCm: 400, yCm: 0 } }],
    openings: [{ id: 'door', type: 'door', wallId: 'wall', offsetCm: 100, widthCm: 70 }],
    rooms: [
      {
        name: 'Санузел',
        sourceNumber: 8,
        polygon: [
          { xCm: 0, yCm: 0 },
          { xCm: 400, yCm: 0 },
          { xCm: 400, yCm: 300 },
          { xCm: 0, yCm: 300 },
        ],
      },
    ],
    warnings: [],
    pdfCalibration: {
      sourceSha256: 'a'.repeat(64),
      pdfPage: 2,
      sourceState: 'proposed',
      cmPerPoint: 1,
      origin: { x: 0, y: 0 },
      anchorRoomNumbers: [8],
      labelIndexes: [],
      derivedOpeningIds: [],
    },
  }
  geometry.projectedVerticalEvidence = [
    {
      id: 'wet-floor',
      quantity: 'floor-level',
      printedValue: '-0.050',
      unit: 'm',
      valueCm: -5,
      target: { kind: 'room', room: structuredClone(required(geometry.rooms[0])) },
      geometrySource: { sha256: 'a'.repeat(64), pdfPage: 2, state: 'proposed' },
      source: {
        sha256: 'a'.repeat(64),
        pdfPage: 3,
        captionIndexes: [18],
        captionTexts: ['-0.050'],
      },
      reviewedAt: '2026-10-25T00:00:00.000Z',
      reviewedBy: 'owner',
    },
  ]
  return geometry
}

function evidence(geometry: PlanGeometry): PlanProjectedVerticalEvidence {
  const value = geometry.projectedVerticalEvidence?.[0]
  if (!value) throw new Error('Missing evidence fixture')
  return value
}

describe('printed project value conversion', () => {
  it.each([
    ['-0.050', 'm', -5],
    ['+0,150', 'm', 15],
    ['−300', 'mm', -30],
    ['±0.000', 'm', 0],
    ['2680', 'mm', 268],
    ['1.001', 'm', 100.1],
    ['.1', 'mm', 0.01],
    ['0', 'cm', 0],
  ])('converts %s %s without interpreting its datum', (token, unit, expected) => {
    expect(parsePrintedProjectValue(token, unit)).toBe(expected)
  })

  it.each([
    '3080-300',
    '2e3',
    '1 000',
    '1/2',
    'H=2360',
    '±0.1',
    '1.2.3',
    'Infinity',
    '1.',
    '--1',
    '',
  ])('rejects non-single numeric token %s', (token) => {
    expect(parsePrintedProjectValue(token, 'mm')).toBeUndefined()
  })

  it('requires a known unit and bounded token', () => {
    expect(parsePrintedProjectValue('3', 'ft')).toBeUndefined()
    expect(parsePrintedProjectValue(3, 'm')).toBeUndefined()
    expect(parsePrintedProjectValue('1'.repeat(101), 'm')).toBeUndefined()
  })
})

describe('documentary proposed vertical evidence', () => {
  it('holds documentary values while source review requires reimport', () => {
    const geometry = fixture()
    geometry.requiresSourceReviewReimport = true
    expect(currentProjectedVerticalEvidence(geometry)).toEqual([])
    expect(geometry.projectedVerticalEvidence).toHaveLength(1)
  })

  it('retains a source statement without adding physical measurements or releasing 3D', () => {
    const geometry = fixture()
    const before = structuredClone(geometry)
    const blocker = planVolumeBlocker(geometry)
    expect(currentProjectedVerticalEvidence(geometry)).toEqual(geometry.projectedVerticalEvidence)
    expect(geometry).toEqual(before)
    expect(geometry.verticalReference).toBeUndefined()
    expect(geometry.walls[0]?.heightCm).toBeUndefined()
    expect(geometry.openings[0]?.heightCm).toBeUndefined()
    expect(planVolume(geometry)).toBeNull()
    expect(blocker).toBeTruthy()
    const without = { ...geometry, projectedVerticalEvidence: undefined }
    expect(planVolumeBlocker(without)).toEqual(blocker)
  })

  it.each(['existing', undefined] as const)('rejects source state %s', (state) => {
    const geometry = fixture()
    required(geometry.pdfCalibration).sourceState = state
    expect(currentProjectedVerticalEvidence(geometry)).toEqual([])
  })

  it.each(['sha', 'page', 'room-name', 'room-number', 'room-polygon'] as const)(
    'invalidates changed %s',
    (change) => {
      const geometry = fixture()
      if (change === 'sha') required(geometry.pdfCalibration).sourceSha256 = 'b'.repeat(64)
      if (change === 'page') required(geometry.pdfCalibration).pdfPage = 4
      if (change === 'room-name') required(geometry.rooms[0]).name = 'Balcony'
      if (change === 'room-number') required(geometry.rooms[0]).sourceNumber = 7
      if (change === 'room-polygon') required(required(geometry.rooms[0]).polygon[0]).xCm = 1
      expect(currentProjectedVerticalEvidence(geometry)).toEqual([])
    },
  )

  it.each([
    { valueCm: -50 },
    { unit: 'ft' },
    { reviewedAt: 'yesterday' },
    { reviewedBy: '' },
    { valueCm: Number.NaN },
    { quantity: 'opening-height' },
    {
      source: {
        sha256: 'a'.repeat(64),
        pdfPage: 3,
        captionIndexes: [18, 19],
        captionTexts: ['-0.050'],
      },
    },
    { source: { sha256: 'a'.repeat(64), pdfPage: 3, captionIndexes: [], captionTexts: [] } },
    {
      source: {
        sha256: 'b'.repeat(64),
        pdfPage: 3,
        captionIndexes: [18],
        captionTexts: ['-0.050'],
      },
    },
  ])('rejects malformed or inconsistent record %j', (change) => {
    const geometry = fixture()
    Object.assign(evidence(geometry), change)
    expect(currentProjectedVerticalEvidence(geometry)).toEqual([])
  })

  it('retains named shower and ceiling subareas as documentary scopes', () => {
    const geometry = fixture()
    const shower = {
      ...structuredClone(evidence(geometry)),
      id: 'shower',
      scopeLabel: 'Душевой поддон',
      printedValue: '+0.150',
      valueCm: 15,
    }
    const ceiling = {
      ...structuredClone(evidence(geometry)),
      id: 'ceiling',
      quantity: 'ceiling-drop' as const,
      scopeLabel: 'Полоса у окна',
      printedValue: '-300',
      unit: 'mm' as const,
      valueCm: -30,
    }
    required(geometry.projectedVerticalEvidence).push(shower, ceiling)
    expect(currentProjectedVerticalEvidence(geometry)).toHaveLength(3)
    expect(geometry.rooms).toHaveLength(1)
  })

  it('rejects all repeated record IDs and ambiguous duplicate room owners', () => {
    const geometry = fixture()
    required(geometry.projectedVerticalEvidence).push(structuredClone(evidence(geometry)))
    expect(currentProjectedVerticalEvidence(geometry)).toEqual([])
    required(geometry.projectedVerticalEvidence).pop()
    geometry.rooms.push(structuredClone(required(geometry.rooms[0])))
    expect(currentProjectedVerticalEvidence(geometry)).toEqual([])
  })

  it('binds an opening statement to its exact horizontal opening and wall', () => {
    const geometry = fixture()
    const value = evidence(geometry)
    Object.assign(value, {
      quantity: 'opening-height',
      printedValue: '2360',
      unit: 'mm',
      valueCm: 236,
      target: {
        kind: 'opening',
        opening: structuredClone(geometry.openings[0]),
        wall: structuredClone(geometry.walls[0]),
      },
    })
    expect(currentProjectedVerticalEvidence(geometry)).toHaveLength(1)
    required(geometry.walls[0]).end.xCm = 401
    expect(currentProjectedVerticalEvidence(geometry)).toEqual([])
  })

  it('allows a project slab statement without converting it to room height', () => {
    const geometry = fixture()
    Object.assign(evidence(geometry), {
      quantity: 'slab-height',
      printedValue: '3080',
      unit: 'mm',
      valueCm: 308,
      target: { kind: 'project' },
    })
    required(geometry.rooms[0]).name = 'Changed room'
    expect(currentProjectedVerticalEvidence(geometry)).toHaveLength(1)
    expect(geometry.walls[0]?.heightCm).toBeUndefined()
  })

  it('bounds and validates source caption arrays', () => {
    const value = evidence(fixture())
    for (const source of [
      { ...value.source, captionIndexes: [18, 18], captionTexts: ['-0.050', '-0.050'] },
      { ...value.source, captionTexts: ['   '] },
      { ...value.source, pdfPage: 0 },
      {
        ...value.source,
        captionIndexes: Array.from({ length: 9 }, (_, index) => index),
        captionTexts: Array.from({ length: 9 }, () => '-0.050'),
      },
    ]) {
      expect(projectedVerticalEvidenceSchema.safeParse({ ...value, source }).success).toBe(false)
    }
  })

  it('rejects duplicate opening IDs even when only one snapshot matches', () => {
    const geometry = fixture()
    Object.assign(evidence(geometry), {
      quantity: 'opening-height',
      printedValue: '2360',
      unit: 'mm',
      valueCm: 236,
      target: {
        kind: 'opening',
        opening: structuredClone(geometry.openings[0]),
        wall: structuredClone(geometry.walls[0]),
      },
    })
    geometry.openings.push({ ...required(geometry.openings[0]), offsetCm: 200 })
    expect(currentProjectedVerticalEvidence(geometry)).toEqual([])
  })

  it.each([
    ['floor-level', '10001', 'cm'],
    ['ceiling-drop', '-601', 'cm'],
    ['section-headroom', '0', 'cm'],
    ['glazing-height', '1001', 'cm'],
    ['sill-height', '-1', 'cm'],
  ])('enforces quantity bounds for %s', (quantity, token, unit) => {
    const value = {
      ...evidence(fixture()),
      quantity,
      printedValue: token,
      unit,
      valueCm: parsePrintedProjectValue(token, unit),
    }
    expect(projectedVerticalEvidenceSchema.safeParse(value).success).toBe(false)
  })
})
