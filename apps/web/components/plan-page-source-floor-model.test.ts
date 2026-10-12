import { describe, expect, it } from 'vitest'
import { exactNativePointKey } from '@/lib/projects/plan-native-exact-intersections'
import type { SourceFloorReference } from '@/lib/projects/plan-page-source-floors'
import { pageContourRoomsForSave } from './plan-page-contour-editor-model'
import {
  sourceFloorDraft,
  sourceFloorReferenceFromResponse,
  sourceFloorReferencePath,
} from './plan-page-source-floor-model'

const polygon = [
  { x: 10, y: 10 },
  { x: 30, y: 10 },
  { x: 30, y: 30 },
  { x: 10, y: 30 },
]
const page = { sha256: 'a'.repeat(64), page: 3, pageCount: 5, width: 842, height: 1191 }
const reference = (): SourceFloorReference => ({
  version: 1,
  coordinateSystem: 'page-0-1000',
  source: { sha256: page.sha256, pdfPage: 3, state: 'existing' },
  sourceRevision: 'b'.repeat(64),
  pageWidth: page.width,
  pageHeight: page.height,
  status: 'checked',
  reason: null,
  readOnly: true,
  physicalBoundariesAccepted: false,
  floors: [
    {
      id: 'source-floor-3.1',
      sourceRoomKey: '3.1',
      name: 'Гардероб',
      polygon: structuredClone(polygon),
      holes: [],
      exactPointKeys: polygon.map((p) => exactNativePointKey(p) as string),
      holeExactPointKeys: [],
      nonDecimalVertices: 0,
      omittedStrokeCount: 0,
      boundaryInkComplete: true,
    },
  ],
})
function floor() {
  const value = reference().floors[0]
  if (!value) throw new Error('Missing source reference')
  return value
}
describe('source reference parsing and lossless whole-ring draft copy', () => {
  it('keeps raw PDF coordinates with non-square page axes, not a raster conversion', () => {
    const input = reference()
    const before = structuredClone(input)
    const checked = sourceFloorReferenceFromResponse(input, page, input.sourceRevision)
    expect(checked).toEqual(input)
    expect(checked?.floors[0]?.polygon).toEqual(polygon)
    expect(input).toEqual(before)
  })
  it.each([
    'hash',
    'page',
    'revision',
    'width',
    'height',
    'authority',
    'keys',
    'holes',
    'subnumber',
    'duplicate-owner',
    'precision-count',
  ])('rejects inconsistent %s metadata', (fault) => {
    const input = reference()
    const first = input.floors[0]
    if (!first) throw new Error('Missing source reference')
    if (fault === 'hash') input.source.sha256 = 'd'.repeat(64)
    if (fault === 'page') input.source.pdfPage = 4
    if (fault === 'revision') input.sourceRevision = 'd'.repeat(64)
    if (fault === 'width') input.pageWidth = 1000
    if (fault === 'height') input.pageHeight = 1000
    if (fault === 'authority') Object.assign(input, { physicalBoundariesAccepted: true })
    if (fault === 'keys') first.exactPointKeys.pop()
    if (fault === 'holes') first.holes.push(structuredClone(polygon))
    if (fault === 'subnumber') first.sourceRoomKey = '3.10'
    if (fault === 'duplicate-owner') input.floors.push(structuredClone(first))
    if (fault === 'precision-count') first.nonDecimalVertices = 1
    expect(sourceFloorReferenceFromResponse(input, page, 'b'.repeat(64))).toBeNull()
  })
  it('copies already supported native endpoints unchanged into an unconfirmed room draft', () => {
    const source = floor(),
      before = structuredClone(source)
    const result = sourceFloorDraft(source)
    expect(result.kind).toBe('candidate')
    if (result.kind !== 'candidate') throw new Error('Expected eligible source contour')
    expect(result.draft).toMatchObject({
      roomSourceNumber: 3.1,
      polygon,
      closed: true,
      sourceTopology: {
        kind: 'unclassified-source-paint',
        floorId: source.id,
        exactPointKeys: source.exactPointKeys,
      },
    })
    expect(pageContourRoomsForSave([result.draft], polygon, [])?.[0]?.sourceTopology).toEqual(
      result.draft.sourceTopology,
    )
    expect(result.draft).not.toHaveProperty('measurementsConfirmed')
    expect(result.draft).not.toHaveProperty('geometry')
    expect(source).toEqual(before)
  })
  it('retains the whole source snapshot without inventing physical stroke evidence', () => {
    const source = floor()
    const native = polygon.filter((p) => !(p.x === 30 && p.y === 10))
    const segments = [
      {
        operationIndex: 1,
        subpathIndex: 0,
        segmentIndex: 0,
        start: { x: 10, y: 10 },
        end: { x: 40, y: 10 },
      },
      {
        operationIndex: 2,
        subpathIndex: 0,
        segmentIndex: 0,
        start: { x: 30, y: 0 },
        end: { x: 30, y: 30 },
      },
    ]
    const result = sourceFloorDraft(source)
    expect(result.kind).toBe('candidate')
    if (result.kind !== 'candidate') throw new Error('Expected exact crossing')
    expect(result.draft.sourceTopology?.exactPointKeys).toEqual(source.exactPointKeys)
    expect(result.draft).not.toHaveProperty('vertexProofs')
    expect(pageContourRoomsForSave([result.draft], native, segments)?.[0]?.polygon).toEqual(polygon)
  })
  it.each(['holes', 'rational', 'missing-source', 'nearby-node'])(
    'retains %s only as an exact source snapshot rather than approximating or dropping parts',
    (fault) => {
      const source = floor()
      let native = structuredClone(polygon)
      if (fault === 'holes')
        source.holes.push([
          { x: 15, y: 15 },
          { x: 20, y: 15 },
          { x: 20, y: 20 },
        ])
      if (fault === 'holes')
        source.holeExactPointKeys = source.holes.map((ring) =>
          ring.map((point) => exactNativePointKey(point) as string),
        )
      if (fault === 'rational') source.exactPointKeys[0] = '31/3:10/1'
      if (fault === 'missing-source') native = native.slice(1)
      if (fault === 'nearby-node') native[0] = { x: 10.001, y: 10 }
      const before = structuredClone(source)
      const copied = sourceFloorDraft(source)
      expect(copied.kind).toBe('candidate')
      if (copied.kind !== 'candidate') throw new Error('Expected source snapshot')
      expect(copied.draft.polygon).toEqual(source.polygon)
      expect(copied.draft.sourceTopology).toMatchObject({
        kind: 'unclassified-source-paint',
        floorId: source.id,
        exactPointKeys: source.exactPointKeys,
        holes: source.holes,
        holeExactPointKeys: source.holeExactPointKeys,
      })
      expect(copied.draft).not.toHaveProperty('vertexProofs')
      expect(pageContourRoomsForSave([copied.draft], native, [])?.[0]?.sourceTopology).toEqual(
        copied.draft.sourceTopology,
      )
      expect(source).toEqual(before)
    },
  )
  it('preserves holes as separate SVG rings without a technical-void inference', () => {
    const source = floor()
    source.holes = [
      [
        { x: 15, y: 15 },
        { x: 20, y: 15 },
        { x: 20, y: 20 },
      ],
    ]
    const path = sourceFloorReferencePath(source)
    expect(path.match(/M /g)).toHaveLength(2)
    expect(path.match(/ Z/g)).toHaveLength(2)
    source.holeExactPointKeys = source.holes.map((ring) =>
      ring.map((point) => exactNativePointKey(point) as string),
    )
    const copied = sourceFloorDraft(source)
    expect(copied.kind).toBe('candidate')
    if (copied.kind !== 'candidate') throw new Error('Expected source snapshot')
    expect(copied.draft.sourceTopology?.holes).toEqual(source.holes)
    expect(copied.draft).not.toHaveProperty('obstacles')
  })
})
