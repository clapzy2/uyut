import { createHash } from 'node:crypto'
import { existsSync } from 'node:fs'
import { readFile } from 'node:fs/promises'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import { nativeAnnotationFixture } from '../../scripts/qa-native-annotation-fixture'
import { nativeFinishedFloorHeightReference } from './plan-native-height-datum-caption'
import { nativeHeightFloorReferenceEvidence } from './plan-native-height-floor-reference'

const literal = '1. Все отметки высот на замере даны от чистового пола'
function fixture() {
  const common = nativeAnnotationFixture()
  common.native.labels = [
    {
      id: 'native-text-0',
      nativeIndex: 0,
      name: literal,
      pagePoint: { x: 10, y: 20 },
      point: { x: 10, y: 20 },
      rotation: 0,
    },
  ]
  common.native.heightFloorReferenceInk = {
    source: { ...common.reviewed.source, pageWidth: 1000, pageHeight: 1000 },
    complete: true,
    refusalReason: null,
    unresolved: [],
    items: [
      {
        index: 0,
        fontName: 'fixture-font',
        text: literal,
        operationIndex: 100,
        baselineStart: { x: 10, y: 20 },
        baselineEnd: { x: 100, y: 20 },
        quad: [
          { x: 10, y: 10 },
          { x: 100, y: 10 },
          { x: 100, y: 20 },
          { x: 10, y: 20 },
        ],
      },
    ],
  }
  common.work.paintBounds = {
    complete: true,
    refusalReason: null,
    events: [
      {
        operationIndex: 100,
        kind: 'text',
        bounds: null,
        reason: 'text-paint-envelope-unavailable',
      },
    ],
  }
  return { ...common, source: common.reviewed.source }
}
describe('local finished-floor height reference, not a common world zero', () => {
  it('verifies literal source ink without accepting elevation, owners or transfer', () => {
    const result = nativeHeightFloorReferenceEvidence(fixture())
    expect(result).toMatchObject({
      status: 'draft',
      refusalReason: null,
      references: [
        {
          labelId: 'native-text-0',
          status: 'verified',
          datum: 'local-finished-floor',
          inkSourceOperations: [100],
        },
      ],
      commonWorldZeroConfirmed: false,
      coplanarFloorsConfirmed: false,
      geometryOwnersConfirmed: false,
      mayTransfer2D3D: false,
    })
    expect(result).not.toHaveProperty('floorElevationMm')
  })
  it('holds the reference when a later image may cover its whole source caption', () => {
    const input = fixture()
    input.work.paintBounds = {
      complete: true,
      refusalReason: null,
      events: [
        {
          operationIndex: 100,
          kind: 'text',
          bounds: null,
          reason: 'text-paint-envelope-unavailable',
        },
        {
          operationIndex: 200,
          kind: 'image',
          bounds: { left: 50, top: 12, right: 60, bottom: 18 },
          reason: null,
        },
      ],
    }
    expect(nativeHeightFloorReferenceEvidence(input).references[0]).toMatchObject({
      status: 'unresolved',
      datum: null,
      reason: 'later-paint-may-cover-floor-reference',
    })
    input.work.paintBounds.events[1] = {
      operationIndex: 200,
      kind: 'image',
      bounds: { left: 400, top: 400, right: 500, bottom: 500 },
      reason: null,
    }
    expect(nativeHeightFloorReferenceEvidence(input).references[0]?.status).toBe('verified')
  })
  it.each(['missing', 'incomplete'])(
    'does not verify a local datum with %s paint inventory',
    (fault) => {
      const input = fixture()
      if (fault === 'missing') delete input.work.paintBounds
      else if (input.work.paintBounds) input.work.paintBounds.complete = false
      expect(nativeHeightFloorReferenceEvidence(input).references[0]).toMatchObject({
        status: 'unresolved',
        datum: null,
        inkSourceOperations: [],
        reason: 'floor-reference-paint-inventory-unavailable',
      })
    },
  )
  it.each([
    'Все отметки высот на замере даны от существующего пола',
    `${literal}, кроме кухни`,
    `${literal}\u200b`,
    `${literal}. Все полы на одном уровне`,
  ])('rejects unsupported qualifications: %s', (text) => {
    expect(nativeFinishedFloorHeightReference(text)).toBe(false)
  })
  it('retains an unavailable note as unresolved and never substitutes zero', () => {
    const input = fixture()
    delete input.native.heightFloorReferenceInk
    expect(nativeHeightFloorReferenceEvidence(input).references[0]).toMatchObject({
      status: 'unresolved',
      datum: null,
      inkSourceOperations: [],
    })
  })
  it.each(['rotation', 'nan-start', 'infinite-end', 'outside-end', 'zero-baseline'])(
    'withholds a local reference with invalid %s source geometry',
    (fault) => {
      const input = fixture()
      const item = input.native.heightFloorReferenceInk?.items[0]
      const label = input.native.labels[0]
      if (!item || !label) throw new Error('Missing synthetic reference')
      if (fault === 'rotation') label.rotation = 90
      if (fault === 'nan-start') item.baselineStart.x = Number.NaN
      if (fault === 'infinite-end') item.baselineEnd.x = Number.POSITIVE_INFINITY
      if (fault === 'outside-end') item.baselineEnd.x = 1001
      if (fault === 'zero-baseline') item.baselineEnd = { ...item.baselineStart }
      const before = structuredClone(input)
      const result = nativeHeightFloorReferenceEvidence(input)
      expect(result.refusalReason).toBe('invalid-floor-reference-provenance')
      expect(result.references).toEqual([])
      expect(result.commonWorldZeroConfirmed).toBe(false)
      expect(result.mayTransfer2D3D).toBe(false)
      expect(input).toEqual(before)
    },
  )
  it('checks a rotated reference in physical PDF axes rather than square image axes', () => {
    const input = fixture()
    const item = input.native.heightFloorReferenceInk?.items[0]
    const label = input.native.labels[0]
    if (!item || !label || !input.native.heightFloorReferenceInk)
      throw new Error('Missing synthetic reference')
    input.work.pageWidth = input.native.heightFloorReferenceInk.source.pageWidth = 2000
    label.rotation = 45
    item.baselineEnd = { x: 20, y: 0 }
    item.quad = [
      { x: 5, y: 10 },
      { x: 15, y: -10 },
      { x: 20, y: 0 },
      { x: 10, y: 20 },
    ]
    // Keep every source point on the page while preserving the same physical angle.
    for (const point of item.quad) point.y += 30
    item.baselineStart.y += 30
    item.baselineEnd.y += 30
    label.pagePoint = { ...item.baselineStart }
    label.point = { ...item.baselineStart }
    expect(nativeHeightFloorReferenceEvidence(input).references[0]?.status).toBe('verified')
    label.rotation = (Math.atan2(20, 10) * 180) / Math.PI
    expect(nativeHeightFloorReferenceEvidence(input).refusalReason).toBe(
      'invalid-floor-reference-provenance',
    )
  })
  it('refuses changed source, duplicate indices and misplaced origin', () => {
    for (const mutate of [
      (input: ReturnType<typeof fixture>) => {
        if (input.native.heightFloorReferenceInk)
          input.native.heightFloorReferenceInk.source.sha256 = 'c'.repeat(64)
      },
      (input: ReturnType<typeof fixture>) => {
        const ink = input.native.heightFloorReferenceInk
        if (ink?.items[0]) ink.items.push(structuredClone(ink.items[0]))
      },
      (input: ReturnType<typeof fixture>) => {
        const item = input.native.heightFloorReferenceInk?.items[0]
        if (item) item.baselineStart.x += 1
      },
    ]) {
      const input = fixture()
      mutate(input)
      const result = nativeHeightFloorReferenceEvidence(input)
      expect(result.status).toBe('unresolved')
      expect(result.references).toEqual([])
    }
  })
  const original = fileURLToPath(
    new URL('../../../../output/pdf/source-search-20261003/rebrina-original.pdf', import.meta.url),
  )
  it.skipIf(!existsSync(original))(
    'verifies the original floor-reference note, keeping two rises and every world zero held',
    async () => {
      const body = await readFile(original)
      const sha256 = createHash('sha256').update(body).digest('hex')
      expect(sha256).toBe('2e141c135812c81719e1f4783173cb5202e20041ac494d3cc799eb37ad62ad4e')
      const { preparePlanPage } = await import('./plan-document')
      const page = await preparePlanPage(body, true, 3, true, true)
      if (!page.nativeTextAnchors || !page.linework || !page.lineworkRasterSource)
        throw new Error('Missing source')
      const input = {
        native: page.nativeTextAnchors,
        work: page.linework,
        lineworkSource: page.lineworkRasterSource,
        source: { sha256, pdfPage: 3, state: 'existing' as const },
      }
      const result = nativeHeightFloorReferenceEvidence(input)
      expect(result.references).toMatchObject([
        {
          labelId: 'native-text-230',
          status: 'verified',
          datum: 'local-finished-floor',
          inkSourceOperations: [14006, 14009, 14012],
        },
      ])
      expect(result.commonWorldZeroConfirmed).toBe(false)
      const { nativeHeightObservations } = await import('./plan-native-height-observations')
      const heights = nativeHeightObservations(input)
      expect(heights.observations.filter((row) => row.valueMm === 360)).toHaveLength(2)
      expect(heights.observations.every((row) => row.mayAcceptFor3D === false)).toBe(true)
    },
    20_000,
  )
})
