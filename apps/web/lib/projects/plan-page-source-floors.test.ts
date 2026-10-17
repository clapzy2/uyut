import { createHash } from 'node:crypto'
import { existsSync } from 'node:fs'
import { readFile } from 'node:fs/promises'
import { fileURLToPath } from 'node:url'
import type { PlanReading } from '@uyut/db'
import { describe, expect, it } from 'vitest'
import { floorHeightFixture } from './plan-native-reviewed-floor-heights.fixture'
import { nativeVisiblePaintRegions } from './plan-native-visible-paint'
import { planPageSourceFloors } from './plan-page-source-floors'
import type { PdfLinework } from './plan-pdf-linework'

function sourceFloorFixture() {
  const evidence = floorHeightFixture()
  const reading: PlanReading = {
    sourcePage: 3,
    planState: 'existing',
    readAt: '2026-10-12',
    rooms: [{ name: 'Спальня', kind: 'bedroom', sourceNumber: 3.1 }],
    paintedFloorReview: {
      version: 1,
      savedAt: '2026-10-12',
      draftJson: JSON.stringify(evidence.reviewedFloors),
    },
  }
  return {
    source: evidence.reviewedFloors.source,
    sourceRevision: 'c'.repeat(64),
    pageWidth: evidence.work.pageWidth,
    pageHeight: evidence.work.pageHeight,
    evidence,
    reading,
  }
}

function materialFixture() {
  const input = sourceFloorFixture()
  const work: PdfLinework = input.evidence.work
  const rectangle = (left: number, top: number, right: number, bottom: number) => [
    { x: left, y: top },
    { x: right, y: top },
    { x: right, y: bottom },
    { x: left, y: bottom },
  ]
  work.paths.push(
    {
      operationIndex: 20,
      subpathIndex: 0,
      paint: 'fill',
      closed: true,
      points: rectangle(300, 150, 320, 250),
    },
    ...[300, 320].map((x, index) => ({
      operationIndex: 30 + index * 10,
      subpathIndex: 0,
      paint: 'stroke' as const,
      closed: false,
      points: [
        { x, y: 140 },
        { x, y: 260 },
      ],
    })),
  )
  work.paintBounds = {
    complete: true,
    refusalReason: null,
    events: work.paths.map((path) => ({
      operationIndex: path.operationIndex,
      kind: 'vector',
      subpathCount: 1,
      bounds: {
        left: Math.min(...path.points.map((point) => point.x)),
        right: Math.max(...path.points.map((point) => point.x)),
        top: Math.min(...path.points.map((point) => point.y)),
        bottom: Math.max(...path.points.map((point) => point.y)),
      },
      reason: null,
    })),
  }
  return input
}

describe('fresh raw source floor reference for the contour editor', () => {
  const decoSource = fileURLToPath(
    new URL('../../../../tmp/pdfs/deco-art-dvushka-source.pdf', import.meta.url),
  )
  it.skipIf(!existsSync(decoSource))(
    'shows independent DECO body spans without reviving the old floor fill',
    async () => {
      const body = await readFile(decoSource)
      const sha256 = createHash('sha256').update(body).digest('hex')
      expect(sha256).toBe('fee92486f301e8a40886914c74b9a83ce77747c6ee14dd4ee0a666dec4a647fd')
      const { preparePlanPage } = await import('./plan-document')
      const { nativePaintedFloorProposal } = await import('./plan-native-painted-floor-proposal')
      const page = await preparePlanPage(body, true, 3, true, true)
      if (!page.nativeTextAnchors || !page.linework || !page.lineworkRasterSource)
        throw new Error('Missing original DECO source layers')
      const evidence = {
        native: page.nativeTextAnchors,
        work: page.linework,
        lineworkSource: page.lineworkRasterSource,
      }
      const reviewed = nativePaintedFloorProposal(evidence).proposal
      if (!reviewed) throw new Error('Missing DECO source-only proposal')
      const result = planPageSourceFloors({
        evidence,
        source: reviewed.source,
        sourceRevision: 'c'.repeat(64),
        pageWidth: page.linework.pageWidth,
        pageHeight: page.linework.pageHeight,
        includeSpanVisibility: true,
        reading: {
          sourcePage: 3,
          planState: 'existing',
          readAt: '2026-10-17',
          rooms: [],
          paintedFloorReview: {
            version: 1,
            savedAt: '2026-10-17',
            draftJson: JSON.stringify(reviewed),
          },
        },
      })
      const floor = result.floors[0]
      expect(result.openingInspection?.status).toBe('checked')
      expect(
        result.openingInspection?.targets.filter((target) => target.kind === 'joined-panel-end'),
      ).toHaveLength(24)
      expect(
        result.openingInspection?.targets
          .filter((target) => target.objectId === 'native-filled-panel-9379:0')
          .map((target) => target.independentSourceRefs[0]?.operationIndex),
      ).toEqual([9436, 9460])
      expect(
        result.openingInspection?.targets.every(
          (target) =>
            target.contacts.length === 0 ||
            (target.visibility?.status === 'unoccluded' &&
              target.independentVisibility?.every(
                (source) => source.visibility.status === 'unoccluded',
              )) ||
            target.status !== 'matched',
        ),
      ).toBe(true)
      expect(result.status).toBe('checked')
      expect(floor?.materialSupports?.spans).toHaveLength(17)
      expect(
        floor?.materialSupports?.spans.filter(
          (span) => span.classification?.kind === 'framed-panel',
        ),
      ).toHaveLength(10)
      expect(
        floor?.materialSupports?.spans.filter(
          (span) => span.classification?.kind === 'unclassified-body',
        ),
      ).toHaveLength(7)
      const framed = floor?.materialSupports?.spans.filter(
        (span) => span.classification?.kind === 'framed-panel',
      )
      expect(
        framed
          ?.find((span) => span.classification?.profileId === 'native-filled-panel-9379:0')
          ?.classification?.endEvidence?.map((end) => end.sourceVisibility?.[0]?.status),
      ).toEqual(['held', 'held'])
      expect(
        framed
          ?.find((span) => span.classification?.profileId === 'native-filled-panel-9379:0')
          ?.classification?.endEvidence?.every(
            (end) => end.sourceVisibility?.[0]?.blockerOperations.length,
          ),
      ).toBe(true)
      expect(new Set(framed?.map((span) => span.classification?.profileId)).size).toBe(5)
      expect(
        framed?.every(
          (span) =>
            span.classification?.endEvidence?.length === 2 &&
            span.classification.endEvidence.every(
              (end) =>
                end.status === 'matched' &&
                end.coverage === 'complete' &&
                end.sourceRefs.length === 1 &&
                end.sourceVisibility?.length === 1 &&
                ['unoccluded', 'held'].includes(end.sourceVisibility[0]?.status ?? '') &&
                end.physicalJambAccepted === false,
            ),
        ),
      ).toBe(true)
      expect(
        framed
          ?.find((span) => span.classification?.profileId === 'native-filled-panel-9379:0')
          ?.classification?.endEvidence?.map((end) => end.sourceRefs[0]?.operationIndex),
      ).toEqual([9436, 9460])
      const paths = new Map(
        page.linework.paths.map((path) => [`${path.operationIndex}:${path.subpathIndex}`, path]),
      )
      for (const span of floor?.materialSupports?.spans ?? []) {
        const classification = span.classification
        expect(classification?.physicalBoundariesAccepted).toBe(false)
        for (const ref of classification?.sourceRefs ?? []) {
          const path = paths.get(`${ref.operationIndex}:${ref.subpathIndex}`)
          expect(path).toBeDefined()
          expect(path?.points[ref.segmentIndex]).toBeDefined()
        }
        if (classification?.kind === 'framed-panel')
          expect(classification.sourceRefs).toContainEqual(span.strokeSegment)
      }
      expect(floor?.materialSupports).toMatchObject({
        status: 'diagnostic',
        semanticStatus: 'unclassified',
        physicalBoundariesAccepted: false,
        completeInventory: false,
      })
      expect(floor?.materialSupports?.spans).toContainEqual(
        expect.objectContaining({
          nativeSegment: { operationIndex: 8881, subpathIndex: 0, segmentIndex: 3 },
          strokeSegment: { operationIndex: 15228, subpathIndex: 0, segmentIndex: 0 },
        }),
      )
      expect(floor?.boundarySupports?.every((edge) => edge.declaredRole === 'unresolved')).toBe(
        true,
      )
      expect(
        floor?.boundarySupports?.every((edge) =>
          edge.contacts.every((contact) => contact.visibility?.status === 'held'),
        ),
      ).toBe(true)
      expect(result.physicalBoundariesAccepted).toBe(false)
      const { sourceFloorReferenceFromResponse } = await import(
        '../../components/plan-page-source-floor-model'
      )
      const preview = {
        sha256,
        page: 3,
        pageCount: page.pageCount,
        width: result.pageWidth,
        height: result.pageHeight,
      }
      expect(
        sourceFloorReferenceFromResponse(result, preview, result.sourceRevision),
      ).not.toBeNull()
      expect(sourceFloorReferenceFromResponse(result, preview, 'd'.repeat(64))).toBeNull()
      expect(
        sourceFloorReferenceFromResponse(
          result,
          { ...preview, sha256: 'd'.repeat(64) },
          result.sourceRevision,
        ),
      ).toBeNull()
    },
    30_000,
  )

  it('keeps independent opposite-side bodies separate from old fill visibility and roles', () => {
    const input = materialFixture()
    const before = structuredClone(input)
    const result = planPageSourceFloors({ ...input, includeSpanVisibility: true })
    expect(result.floors[0]?.materialSupports).toMatchObject({
      source: input.source,
      sourceRevision: input.sourceRevision,
      status: 'diagnostic',
      spans: [
        {
          source: { operationIndex: 20, subpathIndex: 0 },
          start: { x: 300, y: 150 },
          end: { x: 300, y: 250 },
          strokeSegment: { operationIndex: 30, subpathIndex: 0, segmentIndex: 0 },
          oppositeFace: {
            start: { x: 320, y: 150 },
            end: { x: 320, y: 250 },
            strokeSegment: { operationIndex: 40, subpathIndex: 0, segmentIndex: 0 },
          },
          classification: {
            status: 'diagnostic',
            kind: 'unclassified-body',
            reason: 'no-exact-joined-filled-panel',
            physicalBoundariesAccepted: false,
            profileId: null,
            sourceRefs: [],
          },
        },
      ],
    })
    expect(
      result.floors[0]?.boundarySupports?.every((edge) => edge.declaredRole === 'unresolved'),
    ).toBe(true)
    expect(result.floors[0]?.boundarySupports?.[1]?.contacts[0]?.visibility?.status).toBe('held')
    expect(result.physicalBoundariesAccepted).toBe(false)
    expect(input).toEqual(before)
  })

  it('does not revive an independent stroke covered by later paint', () => {
    const input = materialFixture()
    const work: PdfLinework = input.evidence.work
    work.paintBounds?.events.push({
      operationIndex: 50,
      kind: 'image',
      bounds: { left: 299, top: 140, right: 321, bottom: 260 },
      reason: null,
    })
    expect(planPageSourceFloors(input).floors[0]?.materialSupports?.spans).toEqual([])
  })

  it('classifies joined source panels without declaring a wall, glazing or physical jamb', () => {
    const input = materialFixture()
    const work: PdfLinework = input.evidence.work
    for (const [operationIndex, top, bottom] of [
      [21, 130, 150],
      [22, 250, 270],
    ] as const) {
      work.paths.push({
        operationIndex,
        subpathIndex: 0,
        paint: 'fill',
        closed: true,
        points: [
          { x: 300, y: top },
          { x: 320, y: top },
          { x: 320, y: bottom },
          { x: 300, y: bottom },
        ],
      })
      work.paintBounds?.events.push({
        operationIndex,
        kind: 'vector',
        subpathCount: 1,
        bounds: { left: 300, right: 320, top, bottom },
        reason: null,
      })
    }
    const result = planPageSourceFloors(input)
    const span = result.floors[0]?.materialSupports?.spans.find(
      (support) => support.source.operationIndex === 20,
    )
    expect(span?.classification).toMatchObject({
      status: 'diagnostic',
      kind: 'framed-panel',
      reason: 'exact-joined-filled-panel',
      physicalBoundariesAccepted: false,
      profileId: 'native-filled-panel-20:0',
    })
    expect(span?.classification?.sourceRefs).toHaveLength(14)
    for (const operationIndex of [20, 21, 22])
      expect(
        span?.classification?.sourceRefs.filter((ref) => ref.operationIndex === operationIndex),
      ).toHaveLength(4)
    expect(result.physicalBoundariesAccepted).toBe(false)
    expect(result).not.toHaveProperty('geometry')
    expect(
      result.floors[0]?.boundarySupports?.every((edge) => edge.declaredRole === 'unresolved'),
    ).toBe(true)
  })

  it('does not use a stroke painted before the material body as an independent witness', () => {
    const input = materialFixture()
    const work: PdfLinework = input.evidence.work
    const stroke = work.paths.find((path) => path.operationIndex === 30)
    const event = work.paintBounds?.events.find((event) => event.operationIndex === 30)
    if (!stroke || !event) throw new Error('Missing independent stroke fixture')
    stroke.operationIndex = 15
    event.operationIndex = 15
    expect(planPageSourceFloors(input).floors[0]?.materialSupports?.spans).toEqual([])
  })

  it('holds non-decimal source topology without changing its source-only floor reference', () => {
    const input = sourceFloorFixture()
    input.evidence.work.paths.push({
      operationIndex: 30,
      subpathIndex: 0,
      paint: 'fill',
      closed: true,
      points: [
        { x: 251, y: 80 },
        { x: 310, y: 111 },
        { x: 270, y: 141 },
      ],
    })
    const piece = nativeVisiblePaintRegions(input.evidence).regions.find(
      (region) => region.candidateId === 'native-fill-10:0',
    )?.pieces[0]
    const floor = input.evidence.reviewedFloors.floors[0]
    if (!piece || !floor || !input.reading.paintedFloorReview)
      throw new Error('Missing rational source fixture')
    Object.assign(floor, {
      polygon: piece.polygon,
      holes: piece.holes,
      boundaryRoles: piece.polygon.map((_, edgeIndex) => ({ edgeIndex, kind: 'unresolved' })),
    })
    input.reading.paintedFloorReview.draftJson = JSON.stringify(input.evidence.reviewedFloors)
    const result = planPageSourceFloors(input)
    expect(result.status).toBe('checked')
    expect(result.floors[0]?.holes).toEqual([])
    expect(result.floors[0]?.nonDecimalVertices).toBeGreaterThan(0)
    expect(result.floors[0]?.materialSupports).toMatchObject({
      status: 'held',
      reason: 'material-support-rational-topology-not-supported',
      spans: [],
    })
  })

  it('preserves source coordinates and subnumbers without changing reading or confirming physical geometry', () => {
    const input = sourceFloorFixture()
    const before = structuredClone(input)
    const result = planPageSourceFloors(input)
    expect(result).toMatchObject({
      status: 'checked',
      coordinateSystem: 'page-0-1000',
      readOnly: true,
      physicalBoundariesAccepted: false,
    })
    expect(result.floors[0]?.sourceRoomKey).toBe('3.1')
    expect(result.floors[0]?.polygon).toEqual(input.evidence.reviewedFloors.floors[0]?.polygon)
    expect(result.floors[0]?.nonDecimalVertices).toBe(0)
    expect(result).not.toHaveProperty('geometry')
    expect(input).toEqual(before)
  })
  it('retains an enclosed hole and exact diagonal intersections in the source reference', () => {
    const input = sourceFloorFixture()
    input.evidence.work.paths.push(
      {
        operationIndex: 20,
        subpathIndex: 0,
        paint: 'fill',
        closed: true,
        points: [
          { x: 200, y: 200 },
          { x: 230, y: 200 },
          { x: 230, y: 230 },
          { x: 200, y: 230 },
        ],
      },
      {
        operationIndex: 30,
        subpathIndex: 0,
        paint: 'fill',
        closed: true,
        points: [
          { x: 251, y: 80 },
          { x: 310, y: 111 },
          { x: 270, y: 141 },
        ],
      },
    )
    const piece = nativeVisiblePaintRegions(input.evidence).regions.find(
      (region) => region.candidateId === 'native-fill-10:0',
    )?.pieces[0]
    const floor = input.evidence.reviewedFloors.floors[0]
    if (!piece || !floor || !input.reading.paintedFloorReview)
      throw new Error('Missing source fixture')
    Object.assign(floor, {
      polygon: piece.polygon,
      holes: piece.holes,
      boundaryRoles: piece.polygon.map((_, edgeIndex) => ({ edgeIndex, kind: 'unresolved' })),
    })
    input.reading.paintedFloorReview.draftJson = JSON.stringify(input.evidence.reviewedFloors)
    const result = planPageSourceFloors(input)
    expect(result.status).toBe('checked')
    expect(result.floors[0]?.holes).toEqual(piece.holes)
    expect(result.floors[0]?.holeExactPointKeys).toHaveLength(1)
    expect(result.floors[0]?.nonDecimalVertices).toBeGreaterThan(0)
    expect(result.floors[0]?.materialSupports).toMatchObject({
      status: 'held',
      reason: 'material-support-holes-not-supported',
      spans: [],
    })
    expect(result.physicalBoundariesAccepted).toBe(false)
  })
  it.each([
    'hash',
    'page',
    'state',
    'format',
    'json',
    'stale-point',
    'missing-evidence',
    'revision',
  ])('holds %s evidence without returning an old region', (fault) => {
    const input = sourceFloorFixture()
    if (fault === 'hash') input.source = { ...input.source, sha256: 'd'.repeat(64) }
    if (fault === 'page') input.source = { ...input.source, pdfPage: 4 }
    if (fault === 'state') input.reading.planState = 'proposed'
    if (fault === 'format') input.pageHeight = 800
    if (fault === 'revision') input.sourceRevision = 'not-a-revision'
    if (fault === 'json' && input.reading.paintedFloorReview)
      input.reading.paintedFloorReview.draftJson = '{}'
    if (fault === 'stale-point') {
      const point = input.evidence.work.paths[0]?.points[0]
      if (!point) throw new Error('Missing source vertex')
      point.x += 0.001
    }
    const result = planPageSourceFloors(
      fault === 'missing-evidence' ? { ...input, evidence: undefined } : input,
    )
    expect(result.status).toBe('held')
    expect(result.floors).toEqual([])
  })
  it('returns not-saved when there is no selected source region, never inferring one', () => {
    const input = sourceFloorFixture()
    delete input.reading.paintedFloorReview
    expect(planPageSourceFloors(input)).toMatchObject({ status: 'not-saved', floors: [] })
  })
})
