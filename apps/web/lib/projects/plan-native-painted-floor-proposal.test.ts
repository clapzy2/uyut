import { createHash } from 'node:crypto'
import { existsSync } from 'node:fs'
import { readFile } from 'node:fs/promises'
import { describe, expect, it } from 'vitest'
import { preparePlanPage } from './plan-document'
import { nativePaintedFloorProposal } from './plan-native-painted-floor-proposal'
import { nativePaintedFloorReview } from './plan-native-painted-floor-review'
import { nativeRoomNumberScheduleLinks } from './plan-native-room-number-links'
import { nativeVisiblePaintRegions } from './plan-native-visible-paint'
import type { PdfVectorPath } from './plan-pdf-linework'
import {
  addCircledNativeRoomMarker,
  addNativeRoomLabel,
  numberedNativeRoomFixture,
} from './test-fixtures/native-numbered-rooms'

function required<T>(value: T | undefined): T {
  if (value === undefined) throw new Error('Missing test fixture')
  return value
}

function fixture() {
  const source = { sha256: 'a'.repeat(64), page: 3, width: 1000, height: 1000 }
  const paths: PdfVectorPath[] = [
    {
      operationIndex: 10,
      subpathIndex: 0,
      paint: 'fill',
      closed: true,
      points: [
        { x: 100, y: 100 },
        { x: 300, y: 100 },
        { x: 300, y: 300 },
        { x: 100, y: 300 },
      ],
    },
  ]
  return {
    native: {
      source,
      originalPdfSha256: 'b'.repeat(64),
      complete: true,
      pageNormalizedScale: { x: 1, y: 1 },
      labels: [
        {
          id: 'native-text-1',
          nativeIndex: 1,
          name: 'Спальня',
          point: { x: 150, y: 160 },
          pagePoint: { x: 150, y: 160 },
          rotation: 0,
        },
        {
          id: 'native-text-2',
          nativeIndex: 2,
          name: '3',
          point: { x: 150, y: 180 },
          pagePoint: { x: 150, y: 180 },
          rotation: 0,
        },
      ],
    },
    lineworkSource: source,
    work: {
      coordinateSystem: 'page-0-1000' as const,
      pageWidth: 1000,
      pageHeight: 1000,
      paths,
      skippedCurves: 0,
      clippedPaths: 0,
      unsupportedPaths: 0,
      unsupportedContexts: 0,
      truncated: false,
    },
  }
}

function scheduleFixture() {
  const input = numberedNativeRoomFixture()
  const marker = input.native.labels.find(
    (label) => label.name === '3' && label.pagePoint?.y === 150,
  )
  if (!marker) throw new Error('Missing source marker')
  addCircledNativeRoomMarker(input, marker)
  return input
}

describe('source-exact painted-floor proposal', () => {
  it('prepares only a reviewable draft with unresolved physical boundary roles', () => {
    const input = fixture()
    const result = nativePaintedFloorProposal(input)
    expect(result).toMatchObject({ suggested: 1, skipped: 0, reason: null })
    expect(result.proposal?.floors[0]?.owner.sourceRoomKey).toBe('3')
    expect(
      result.proposal?.floors[0]?.boundaryRoles.every((role) => role.kind === 'unresolved'),
    ).toBe(true)
    if (!result.proposal) throw new Error('Missing proposal')
    expect(nativePaintedFloorReview({ ...input, reviewed: result.proposal })).toMatchObject({
      status: 'reviewed-draft',
      readyFor2D: false,
      readyFor3D: false,
    })
  })

  it('holds an area with two possible room numbers instead of guessing', () => {
    const input = fixture()
    input.native.labels.push({
      id: 'native-text-3',
      nativeIndex: 3,
      name: '4',
      point: { x: 160, y: 180 },
      pagePoint: { x: 160, y: 180 },
      rotation: 0,
    })
    expect(nativePaintedFloorProposal(input)).toMatchObject({ proposal: null, suggested: 0 })
  })

  it('does not infer ownership from a schedule label outside the painted piece', () => {
    const input = fixture()
    const number = required(input.native.labels[1])
    number.point = { x: 350, y: 350 }
    number.pagePoint = { x: 350, y: 350 }
    expect(nativePaintedFloorProposal(input).proposal).toBeNull()
  })

  it('proposes a table-linked circled number as an unconfirmed source region', () => {
    const input = scheduleFixture()
    expect(nativeRoomNumberScheduleLinks(input).report.rows[2]?.markerStatus).toBe('linked')
    expect(nativeVisiblePaintRegions(input).regions[2]).toMatchObject({
      status: 'diagnostic',
      boundaryInkComplete: false,
      omittedStrokeCount: 1,
    })
    const result = nativePaintedFloorProposal(input)
    expect(result.proposal, JSON.stringify(result)).not.toBeNull()
    const floor = result.proposal?.floors[0]
    expect(floor?.owner).toMatchObject({
      sourceRoomKey: '3',
      association: 'schedule-linked-circle',
    })
    expect(result.suggested).toBe(1)
    expect(floor?.boundaryRoles.every((role) => role.kind === 'unresolved')).toBe(true)
    if (!result.proposal) throw new Error('Missing source proposal')
    expect(nativePaintedFloorReview({ ...input, reviewed: result.proposal })).toMatchObject({
      status: 'reviewed-draft',
      physicalBoundariesAccepted: false,
      readyFor2D: false,
      readyFor3D: false,
    })
  })

  it('does not use a table row without a circled marker or accept a forged link', () => {
    const input = scheduleFixture()
    const proposed = nativePaintedFloorProposal(input).proposal
    if (!proposed) throw new Error('Missing source proposal')
    const forged = structuredClone(proposed)
    const owner = forged.floors[0]?.owner
    if (!owner) throw new Error('Missing floor owner')
    owner.nameLabelId = input.native.labels.find((label) => label.name === 'Спальня')?.id ?? ''
    expect(nativePaintedFloorReview({ ...input, reviewed: forged }).refusalReason).toBe(
      'invalid-painted-floor-schedule-link',
    )
    input.work.curvePaths = []
    input.work.skippedCurves = 0
    input.work.skippedCurveBounds = []
    expect(nativePaintedFloorProposal(input).proposal).toBeNull()
  })

  it('holds the proposed owner when a second circled number makes the source ambiguous', () => {
    const input = scheduleFixture()
    const proposed = nativePaintedFloorProposal(input).proposal
    if (!proposed) throw new Error('Missing source proposal')
    const duplicate = addNativeRoomLabel(input.native.labels, '3', 675, 175)
    addCircledNativeRoomMarker(input, duplicate)
    expect(nativeRoomNumberScheduleLinks(input).report.rows[2]?.markerStatus).toBe('ambiguous')
    expect(nativePaintedFloorProposal(input).proposal).toBeNull()
    expect(nativePaintedFloorReview({ ...input, reviewed: proposed }).refusalReason).toBe(
      'invalid-painted-floor-schedule-link',
    )
  })

  it('does not choose one of two different linked room markers in one painted region', () => {
    const input = scheduleFixture()
    const proposed = nativePaintedFloorProposal(input).proposal
    if (!proposed) throw new Error('Missing source proposal')
    const secondRoom = addNativeRoomLabel(input.native.labels, '2', 675, 175)
    addCircledNativeRoomMarker(input, secondRoom)
    expect(nativeRoomNumberScheduleLinks(input).report.rows[1]?.markerStatus).toBe('linked')
    expect(nativePaintedFloorProposal(input).proposal).toBeNull()
    expect(nativePaintedFloorReview({ ...input, reviewed: proposed }).refusalReason).toBe(
      'ambiguous-painted-floor-schedule-owner',
    )
  })

  it('does not ignore an extra circled number absent from the room schedule', () => {
    const input = scheduleFixture()
    const proposed = nativePaintedFloorProposal(input).proposal
    if (!proposed) throw new Error('Missing source proposal')
    const unlisted = addNativeRoomLabel(input.native.labels, '99', 675, 175)
    addCircledNativeRoomMarker(input, unlisted)
    expect(nativeRoomNumberScheduleLinks(input).report.unlistedMarkerLabelIds).toContain(
      unlisted.id,
    )
    expect(nativePaintedFloorProposal(input).proposal).toBeNull()
    expect(nativePaintedFloorReview({ ...input, reviewed: proposed }).refusalReason).toBe(
      'ambiguous-painted-floor-schedule-owner',
    )
  })

  const source = new URL(
    '../../../../output/pdf/source-search-20261003/rebrina-original.pdf',
    import.meta.url,
  )
  it.skipIf(!existsSync(source))(
    'proposes exactly the eight caption-owned pieces from a real PDF, not a ninth room',
    async () => {
      const body = await readFile(source)
      expect(createHash('sha256').update(body).digest('hex')).toBe(
        '2e141c135812c81719e1f4783173cb5202e20041ac494d3cc799eb37ad62ad4e',
      )
      const page = await preparePlanPage(body, true, 3, true, true)
      const result = nativePaintedFloorProposal({
        native: required(page.nativeTextAnchors),
        work: required(page.linework),
        lineworkSource: required(page.lineworkRasterSource),
      })
      if (!result.proposal) throw new Error(JSON.stringify(result))
      expect(result.proposal?.floors.map((floor) => floor.owner.sourceRoomKey).sort()).toEqual([
        '1',
        '2',
        '3',
        '3.1',
        '4',
        '5',
        '6',
        '7',
      ])
    },
    30_000,
  )

  const muhanova = new URL(
    '../../../../output/pdf/source-search-20261016/muhanova-original.pdf',
    import.meta.url,
  )
  it.skipIf(!existsSync(muhanova))(
    'proposes the real loggia marker only as a reviewable painted region',
    async () => {
      const body = await readFile(muhanova)
      expect(createHash('sha256').update(body).digest('hex')).toBe(
        '510480920eab5103181e959c1d847c4a7f29ff88653bfd8930ead5d149141d12',
      )
      const page = await preparePlanPage(body, true, 4, true, true)
      const input = {
        native: required(page.nativeTextAnchors),
        work: required(page.linework),
        lineworkSource: required(page.lineworkRasterSource),
      }
      const result = nativePaintedFloorProposal(input)
      expect(result.proposal?.floors.map((floor) => floor.owner.sourceRoomKey).sort()).toEqual([
        '1',
        '2',
        '3',
        '4',
        '5',
      ])
      expect(result.proposal?.floors).toContainEqual(
        expect.objectContaining({
          owner: expect.objectContaining({
            sourceRoomKey: '3',
            nameLabelId: 'native-text-175',
            numberLabelId: 'native-text-147',
            association: 'schedule-linked-circle',
          }),
        }),
      )
      if (!result.proposal) throw new Error('Missing real-source proposal')
      const report = nativePaintedFloorReview({ ...input, reviewed: result.proposal })
      expect(report).toMatchObject({
        status: 'reviewed-draft',
        physicalBoundariesAccepted: false,
        readyFor2D: false,
        readyFor3D: false,
      })
      expect(report.floors.find((floor) => floor.owner.sourceRoomKey === '3')).toMatchObject({
        omittedStrokeCount: 1,
        boundaryInkComplete: false,
      })
    },
    30_000,
  )
})
