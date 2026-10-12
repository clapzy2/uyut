import { describe, expect, it } from 'vitest'
import {
  bindReviewedNumberedCaptions,
  type ReviewedNumberedCaptions,
} from './plan-numbered-region-labels'

const source = { sha256: 'a'.repeat(64), width: 1000, height: 1000, page: 3 }
const labels = [
  { id: 'row-1-number', name: '1', point: { x: 50, y: 700 } },
  { id: 'row-1-name', name: 'Спальня', point: { x: 100, y: 700 } },
  { id: 'row-2-number', name: '2', point: { x: 50, y: 730 } },
  { id: 'row-2-name', name: 'Спальня', point: { x: 100, y: 730 } },
  { id: 'room-1', name: '1', point: { x: 200, y: 200 } },
  { id: 'room-2', name: '2', point: { x: 700, y: 200 } },
  { id: 'dimension', name: '1', point: { x: 350, y: 300 } },
  { id: 'sheet', name: '1', point: { x: 900, y: 900 } },
]
const reviewed: ReviewedNumberedCaptions = {
  review: 'manual-source-review',
  source,
  rows: [
    { sourceNumber: 1, numberLabelId: 'row-1-number', nameLabelId: 'row-1-name' },
    { sourceNumber: 2, numberLabelId: 'row-2-number', nameLabelId: 'row-2-name' },
  ],
  markers: [
    { sourceNumber: 1, labelId: 'room-1' },
    { sourceNumber: 2, labelId: 'room-2' },
  ],
}
const rectangle = (left: number, right: number) => [
  { x: left, y: 50 },
  { x: right, y: 50 },
  { x: right, y: 500 },
  { x: left, y: 500 },
]
const input = {
  regionSource: source,
  regions: [
    { id: 'left', polygon: rectangle(50, 450) },
    { id: 'right', polygon: rectangle(550, 950) },
  ],
  native: { source, complete: true, labels },
  reviewed,
}
describe('reviewed numbered caption provenance', () => {
  it('preserves manually reviewed subroom 3.1 independently of parent 3', () => {
    const draft = structuredClone(input)
    for (const [index, sourceNumber] of [3, 3.1].entries()) {
      const row = draft.reviewed.rows[index]
      const marker = draft.reviewed.markers[index]
      if (!row || !marker) throw new Error('Missing reviewed caption fixture')
      row.sourceNumber = sourceNumber
      marker.sourceNumber = sourceNumber
      for (const label of draft.native.labels) {
        if (label.id === row.numberLabelId || label.id === marker.labelId)
          label.name = String(sourceNumber)
      }
    }
    expect(bindReviewedNumberedCaptions(draft).evidence.map((row) => row.sourceNumber)).toEqual([
      3, 3.1,
    ])
    const child = draft.reviewed.rows[1]
    if (!child) throw new Error('Missing reviewed subroom fixture')
    child.sourceNumber = 3.1001
    expect(() => bindReviewedNumberedCaptions(draft)).toThrow()
  })
  it('maps repeated names through reviewed row and interior IDs, ignoring dimension and sheet numbers', () => {
    const result = bindReviewedNumberedCaptions(input)
    expect(result.assignments).toEqual([
      { labelId: 'room-1', name: 'Спальня', regionId: 'left' },
      { labelId: 'room-2', name: 'Спальня', regionId: 'right' },
    ])
    expect(result.evidence[0]).toMatchObject({
      sourceNumber: 1,
      numberLabelId: 'row-1-number',
      nameLabelId: 'row-1-name',
      markerLabelId: 'room-1',
    })
    expect(result.unresolvedSourceNumbers).toEqual([])
    expect(result.status).toBe('draft')
  })
  it('does not invent a missing interior marker', () => {
    const result = bindReviewedNumberedCaptions({
      ...input,
      reviewed: { ...reviewed, markers: reviewed.markers.slice(1) },
    })
    expect(result.unresolvedSourceNumbers).toEqual([1])
    expect(result.assignments).toHaveLength(1)
  })
  it('leaves repeated selected occurrences of one number unresolved', () => {
    const result = bindReviewedNumberedCaptions({
      ...input,
      reviewed: {
        ...reviewed,
        markers: [...reviewed.markers, { sourceNumber: 1, labelId: 'dimension' }],
      },
    })
    expect(result.unresolvedSourceNumbers).toEqual([1])
    expect(result.assignments.map((entry) => entry.labelId)).toEqual(['room-2'])
  })
  it('propagates shared open-region ambiguity to both source numbers', () => {
    const result = bindReviewedNumberedCaptions({
      ...input,
      regions: [{ id: 'shared', polygon: rectangle(50, 950) }],
    })
    expect(result.assignments).toEqual([])
    expect(result.unresolvedSourceNumbers).toEqual([1, 2])
  })
  it('keeps ambiguous number occurrences as competitors in a shared region', () => {
    const result = bindReviewedNumberedCaptions({
      ...input,
      regions: [{ id: 'shared', polygon: rectangle(50, 950) }],
      reviewed: {
        ...reviewed,
        markers: [...reviewed.markers, { sourceNumber: 1, labelId: 'dimension' }],
      },
    })
    expect(result.assignments).toEqual([])
    expect(result.unresolvedSourceNumbers).toEqual([1, 2])
    expect(result.unresolvedLabelIds).toEqual(['room-1', 'dimension', 'room-2'])
  })
  it('does not assign repeated number occurrences even in separate regions', () => {
    const result = bindReviewedNumberedCaptions({
      ...input,
      native: {
        ...input.native,
        labels: [...labels, { id: 'extra-1', name: '1', point: { x: 700, y: 200 } }],
      },
      reviewed: {
        ...reviewed,
        rows: reviewed.rows.slice(0, 1),
        markers: [
          { sourceNumber: 1, labelId: 'room-1' },
          { sourceNumber: 1, labelId: 'extra-1' },
        ],
      },
    })
    expect(result.assignments).toEqual([])
    expect(result.ignoredRegionIds).toEqual(['left', 'right'])
    expect(result.unresolvedLabelIds).toEqual(['room-1', 'extra-1'])
  })
  it.each(['1.0', '1 см', '01.0', '100'])(
    'does not treat %s as an interior number token',
    (name) => {
      const changed = labels.map((label) => (label.id === 'room-1' ? { ...label, name } : label))
      expect(() =>
        bindReviewedNumberedCaptions({ ...input, native: { ...input.native, labels: changed } }),
      ).toThrow()
    },
  )
  it.each([
    { ...reviewed, source: { ...source, page: 4 } },
    { ...reviewed, source: { ...source, sha256: 'b'.repeat(64) } },
    { ...reviewed, markers: [{ sourceNumber: 1, labelId: 'row-1-number' }] },
    { ...reviewed, markers: [{ sourceNumber: 1, labelId: 'room-2' }] },
    { ...reviewed, markers: [{ sourceNumber: 1, labelId: 'missing' }] },
    { ...reviewed, rows: [reviewed.rows[0], reviewed.rows[0]] },
  ])('rejects changed frames, reused table IDs and invalid review selections', (invalid) => {
    expect(() =>
      bindReviewedNumberedCaptions({ ...input, reviewed: invalid as ReviewedNumberedCaptions }),
    ).toThrow()
  })
  it('rejects incomplete native extraction', () => {
    expect(() =>
      bindReviewedNumberedCaptions({ ...input, native: { ...input.native, complete: false } }),
    ).toThrow()
  })
  it('rejects a different native frame or duplicated native identity', () => {
    expect(() =>
      bindReviewedNumberedCaptions({
        ...input,
        native: { ...input.native, source: { ...source, page: 4 } },
      }),
    ).toThrow()
    const extra = { id: 'room-1', name: '1', point: { x: 220, y: 220 } }
    expect(() =>
      bindReviewedNumberedCaptions({
        ...input,
        native: { ...input.native, labels: [...labels, extra] },
      }),
    ).toThrow()
  })
  it('propagates boundary and nested-region failures to source numbers', () => {
    const boundaryLabels = labels.map((label) =>
      label.id === 'room-1' ? { ...label, point: { x: 50, y: 200 } } : label,
    )
    const edge = bindReviewedNumberedCaptions({
      ...input,
      native: { ...input.native, labels: boundaryLabels },
    })
    expect(edge.unresolvedSourceNumbers).toEqual([1])
    const nested = bindReviewedNumberedCaptions({
      ...input,
      regions: [...input.regions, { id: 'nested', polygon: rectangle(100, 400) }],
    })
    expect(nested.unresolvedSourceNumbers).toEqual([1])
    expect(nested.overlappingLabelIds).toEqual(['room-1'])
  })
})
