import { describe, expect, it } from 'vitest'
import { bindObservedRegionLabels } from './plan-raster-region-labels'

const frame = { sha256: 'a'.repeat(64), width: 300, height: 200, page: 1 }
const rectangle = (left: number, right: number) => [
  { x: left, y: 20 },
  { x: right, y: 20 },
  { x: right, y: 180 },
  { x: left, y: 180 },
]
const regions = [
  { id: 'left', polygon: rectangle(20, 140) },
  { id: 'right', polygon: rectangle(160, 280) },
]
const labels = [
  { id: 'bedroom-1', name: 'Спальня', point: { x: 80, y: 80 } },
  { id: 'bedroom-2', name: 'Спальня', point: { x: 220, y: 80 } },
]
const input = { regionSource: frame, labelSource: frame, regions, labels }
describe('caption identity independent of repeated names', () => {
  it('keeps an unknown ink membership unresolved and as a shared-region competitor', () => {
    const result = bindObservedRegionLabels({
      ...input,
      regions: [{ id: 'shared', polygon: rectangle(20, 280) }],
      pixelMembership: {
        source: frame,
        points: labels.map((label, index) => ({
          id: label.id,
          point: label.point,
          regionId: index === 0 ? null : 'shared',
        })),
      },
    })
    expect(result.assignments).toEqual([])
    expect(result.unresolvedLabelIds).toEqual(['bedroom-1', 'bedroom-2'])
    expect(result.ambiguities).toEqual([
      { regionId: 'shared', labelIds: ['bedroom-1', 'bedroom-2'] },
    ])
  })
  it('does not assign a solitary unknown membership using polygon containment', () => {
    const result = bindObservedRegionLabels({
      ...input,
      pixelMembership: {
        source: frame,
        points: labels.map((label) => ({ id: label.id, point: label.point, regionId: null })),
      },
    })
    expect(result.assignments).toEqual([])
  })
  it('rejects stale membership coordinates and mismatched source frames', () => {
    const points = labels.map((label) => ({
      id: label.id,
      point: { ...label.point, x: label.point.x + 1 },
      regionId: null,
    }))
    expect(() =>
      bindObservedRegionLabels({ ...input, pixelMembership: { source: frame, points } }),
    ).toThrow()
    expect(() =>
      bindObservedRegionLabels({
        ...input,
        pixelMembership: { source: { ...frame, page: 2 }, points: [] },
      }),
    ).toThrow()
  })
  it('binds two identical captions using their observed positions and separate IDs', () => {
    const result = bindObservedRegionLabels(input)
    expect(result.assignments).toEqual([
      { labelId: 'bedroom-1', name: 'Спальня', regionId: 'left' },
      { labelId: 'bedroom-2', name: 'Спальня', regionId: 'right' },
    ])
    expect(result.unresolvedLabelIds).toEqual([])
    expect(result.status).toBe('draft')
  })
  it('does not split a shared open area or assign it to just one of its captions', () => {
    const result = bindObservedRegionLabels({
      ...input,
      regions: [{ id: 'shared', polygon: rectangle(20, 280) }],
    })
    expect(result.assignments).toEqual([])
    expect(result.unresolvedLabelIds).toEqual(['bedroom-1', 'bedroom-2'])
    expect(result.ambiguities).toEqual([
      { regionId: 'shared', labelIds: ['bedroom-1', 'bedroom-2'] },
    ])
  })
  it('does not guess when a label is inside both a room envelope and a furniture region', () => {
    const result = bindObservedRegionLabels({
      ...input,
      regions: [...regions, { id: 'furniture', polygon: rectangle(40, 120) }],
    })
    expect(result.unresolvedLabelIds).toContain('bedroom-1')
    expect(result.overlappingLabelIds).toEqual(['bedroom-1'])
  })
  it('counts an overlapping caption when checking a shared region for ambiguity', () => {
    const result = bindObservedRegionLabels({
      ...input,
      regions: [
        { id: 'shared', polygon: rectangle(20, 280) },
        { id: 'furniture', polygon: rectangle(40, 120) },
      ],
    })
    expect(result.assignments).toEqual([])
    expect(result.unresolvedLabelIds).toEqual(['bedroom-1', 'bedroom-2'])
    expect(result.ambiguities).toEqual([
      { regionId: 'shared', labelIds: ['bedroom-1', 'bedroom-2'] },
    ])
    expect(result.overlappingLabelIds).toEqual(['bedroom-1'])
  })
  it.each([
    { ...frame, sha256: 'b'.repeat(64) },
    { ...frame, page: 2 },
    { ...frame, width: 301 },
  ])('rejects mixed file/page/pixel frames', (labelSource) => {
    expect(() => bindObservedRegionLabels({ ...input, labelSource })).toThrow()
  })
  it('does not bind a caption on a boundary', () => {
    expect(
      bindObservedRegionLabels({
        ...input,
        labels: [{ id: 'edge', name: 'Спальня', point: { x: 20, y: 80 } }],
      }).assignments,
    ).toEqual([])
  })
  it('rejects duplicate identity or self-crossing region input', () => {
    const duplicate = { id: 'same', name: 'Спальня', point: { x: 80, y: 80 } }
    expect(() => bindObservedRegionLabels({ ...input, labels: [duplicate, duplicate] })).toThrow()
    expect(() =>
      bindObservedRegionLabels({
        ...input,
        regions: [
          {
            id: 'bad',
            polygon: [
              { x: 20, y: 20 },
              { x: 100, y: 100 },
              { x: 100, y: 20 },
              { x: 20, y: 100 },
            ],
          },
        ],
      }),
    ).toThrow()
  })
})
