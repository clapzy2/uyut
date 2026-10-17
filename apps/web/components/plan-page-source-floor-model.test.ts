import { describe, expect, it } from 'vitest'
import { exactNativePointKey } from '@/lib/projects/plan-native-exact-intersections'
import { floorHeightFixture } from '@/lib/projects/plan-native-reviewed-floor-heights.fixture'
import type { SourceFloorReference } from '@/lib/projects/plan-page-source-floors'
import { planPageSourceFloors } from '@/lib/projects/plan-page-source-floors'
import type { PdfLinework } from '@/lib/projects/plan-pdf-linework'
import { findPlanPageWallBodySupports } from '@/lib/projects/plan-pdf-wall-body-support'
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

function inspectedReference(visibility = false) {
  const evidence = floorHeightFixture()
  if (visibility)
    evidence.work.paintBounds = {
      complete: true,
      refusalReason: null,
      events: [
        {
          operationIndex: 10,
          kind: 'vector',
          subpathCount: 1,
          bounds: { left: 100, top: 100, right: 300, bottom: 300 },
          reason: null,
        },
        {
          operationIndex: 1000,
          kind: 'image',
          bounds: { left: 90, top: 90, right: 310, bottom: 310 },
          reason: null,
        },
      ],
    }
  const report = planPageSourceFloors({
    source: evidence.reviewedFloors.source,
    sourceRevision: 'b'.repeat(64),
    pageWidth: 1000,
    pageHeight: 1000,
    evidence,
    includeSpanVisibility: visibility,
    reading: {
      sourcePage: 3,
      planState: 'existing',
      readAt: '2026-10-13',
      rooms: [{ name: 'Спальня', kind: 'bedroom', sourceNumber: 3.1 }],
      paintedFloorReview: {
        version: 1,
        savedAt: 'old',
        draftJson: JSON.stringify(evidence.reviewedFloors),
      },
    },
  })
  const preview = { ...page, sha256: report.source.sha256, width: 1000, height: 1000 }
  return { report, preview }
}
describe('source reference parsing and lossless whole-ring draft copy', () => {
  function materialReference() {
    const report = reference()
    const selected = report.floors[0]
    if (!selected) throw new Error('Missing material floor')
    selected.materialSupports = {
      status: 'diagnostic',
      semanticStatus: 'unclassified',
      physicalBoundariesAccepted: false,
      completeInventory: false,
      source: structuredClone(report.source),
      sourceRevision: report.sourceRevision,
      reason: null,
      spans: [
        {
          source: { operationIndex: 20, subpathIndex: 0 },
          nativeSegment: { operationIndex: 20, subpathIndex: 0, segmentIndex: 0 },
          contourKey: selected.sourceRoomKey,
          wallEdgeIndex: 0,
          start: { x: 10, y: 10 },
          end: { x: 30, y: 10 },
          strokeSegment: { operationIndex: 30, subpathIndex: 0, segmentIndex: 0 },
          oppositeFace: {
            start: { x: 10, y: 5 },
            end: { x: 30, y: 5 },
            nativeSegment: { operationIndex: 20, subpathIndex: 0, segmentIndex: 2 },
            strokeSegment: { operationIndex: 31, subpathIndex: 0, segmentIndex: 0 },
          },
        },
      ],
    }
    return report
  }

  it('accepts independently stroked material spans only as an unclassified source diagnostic', () => {
    const report = materialReference()
    expect(sourceFloorReferenceFromResponse(report, page, report.sourceRevision)).toEqual(report)
    const copied = sourceFloorDraft(report.floors[0])
    expect(copied).not.toHaveProperty('draft.materialSupports')
    expect(copied).not.toHaveProperty('draft.sourceTopology.materialSupports')
    expect(copied).not.toHaveProperty('draft.openings')
  })

  it('keeps a framed-panel hint diagnostic and rejects changed source refs or physical claims', () => {
    const report = materialReference()
    const span = report.floors[0]?.materialSupports?.spans[0]
    if (!span?.oppositeFace) throw new Error('Missing material span or opposite face')
    span.classification = {
      status: 'diagnostic',
      kind: 'framed-panel',
      reason: 'exact-joined-filled-panel',
      physicalBoundariesAccepted: false,
      profileId: 'native-filled-panel-20:0',
      sourceRefs: [
        ...[20, 21, 22].flatMap((operationIndex) =>
          Array.from({ length: 4 }, (_, segmentIndex) => ({
            operationIndex,
            subpathIndex: 0,
            segmentIndex,
          })),
        ),
        span.strokeSegment,
        span.oppositeFace.strokeSegment,
      ],
      endEvidence: [
        {
          status: 'matched',
          coverage: 'complete',
          sourceRefs: [{ operationIndex: 50, subpathIndex: 0, segmentIndex: 0 }],
          physicalJambAccepted: false,
        },
        {
          status: 'unobserved',
          coverage: 'unproved',
          sourceRefs: [],
          physicalJambAccepted: false,
        },
      ],
    }
    expect(sourceFloorReferenceFromResponse(report, page, report.sourceRevision)).toEqual(report)
    expect(sourceFloorDraft(report.floors[0])).not.toHaveProperty('draft.materialSupports')

    const firstEnd = span.classification.endEvidence?.[0]
    const secondEnd = span.classification.endEvidence?.[1]
    const fillRef = span.classification.sourceRefs[0]
    if (!firstEnd || !secondEnd || !fillRef) throw new Error('Missing panel end evidence')
    Object.assign(firstEnd, { physicalJambAccepted: true })
    expect(sourceFloorReferenceFromResponse(report, page, report.sourceRevision)).toBeNull()
    Object.assign(firstEnd, { physicalJambAccepted: false })
    secondEnd.sourceRefs.push(fillRef)
    expect(sourceFloorReferenceFromResponse(report, page, report.sourceRevision)).toBeNull()
    secondEnd.sourceRefs.pop()

    span.classification.sourceRefs = span.classification.sourceRefs.filter(
      (ref) => ref.operationIndex !== span.strokeSegment.operationIndex,
    )
    expect(sourceFloorReferenceFromResponse(report, page, report.sourceRevision)).toBeNull()
    span.classification.sourceRefs.push(span.strokeSegment)
    span.classification.sourceRefs.sort(
      (left, right) =>
        left.operationIndex - right.operationIndex ||
        left.subpathIndex - right.subpathIndex ||
        left.segmentIndex - right.segmentIndex,
    )
    Object.assign(span.classification, { physicalBoundariesAccepted: true })
    expect(sourceFloorReferenceFromResponse(report, page, report.sourceRevision)).toBeNull()
  })

  it('roundtrips decimal material spans from the server without a floating translation check', () => {
    const report = materialReference()
    const floor = report.floors[0]
    const material = floor?.materialSupports
    if (!floor || !material) throw new Error('Missing material reference')
    floor.polygon = [
      { x: 4.2, y: 20 },
      { x: 28.2, y: 20 },
      { x: 28.2, y: 40 },
      { x: 4.2, y: 40 },
    ]
    floor.exactPointKeys = floor.polygon.map((point) => exactNativePointKey(point) as string)
    const work: PdfLinework = {
      coordinateSystem: 'page-0-1000',
      pageWidth: page.width,
      pageHeight: page.height,
      skippedCurves: 0,
      clippedPaths: 0,
      unsupportedPaths: 0,
      unsupportedContexts: 0,
      truncated: false,
      paths: [
        {
          operationIndex: 20,
          subpathIndex: 0,
          paint: 'fill',
          closed: true,
          points: [
            { x: 0.2, y: 20 },
            { x: 30.2, y: 20 },
            { x: 30.3, y: 10 },
            { x: 0.3, y: 10 },
          ],
        },
        {
          operationIndex: 30,
          subpathIndex: 0,
          paint: 'stroke',
          closed: false,
          points: [
            { x: 4.2, y: 20 },
            { x: 28.2, y: 20 },
          ],
        },
        {
          operationIndex: 40,
          subpathIndex: 0,
          paint: 'stroke',
          closed: false,
          points: [
            { x: 0.3, y: 10 },
            { x: 30.3, y: 10 },
          ],
        },
      ],
    }
    work.paintBounds = {
      complete: true,
      refusalReason: null,
      events: work.paths.map((path) => ({
        operationIndex: path.operationIndex,
        kind: 'vector',
        subpathCount: 1,
        reason: null,
        bounds: {
          left: Math.min(...path.points.map((point) => point.x)),
          right: Math.max(...path.points.map((point) => point.x)),
          top: Math.min(...path.points.map((point) => point.y)),
          bottom: Math.max(...path.points.map((point) => point.y)),
        },
      })),
    }
    material.spans = findPlanPageWallBodySupports(work, {
      source: report.source,
      coordinateSystem: 'page-0-1000',
      pageWidth: page.width,
      pageHeight: page.height,
      review: 'manual-source-review',
      rooms: [{ roomSourceNumber: Number(floor.sourceRoomKey), polygon: floor.polygon }],
    })
    expect(material.spans).toHaveLength(1)
    const span = material.spans[0]
    const opposite = span?.oppositeFace
    if (!span || !opposite) throw new Error('Missing server opposite material face')
    expect(span.end.x + (opposite.start.x - span.start.x)).not.toBe(opposite.end.x)
    expect(sourceFloorReferenceFromResponse(report, page, report.sourceRevision)).toEqual(report)
    expect(report.physicalBoundariesAccepted).toBe(false)

    opposite.end.x = 28.300000001
    expect(sourceFloorReferenceFromResponse(report, page, report.sourceRevision)).toBeNull()
  })

  it.each([
    'hash',
    'page',
    'state',
    'revision',
    'floor',
    'edge',
    'off-edge',
    'extended-span',
    'zero-span',
    'fill-operation',
    'fill-subpath',
    'early-stroke',
    'duplicate',
    'opposite-operation',
    'opposite-subpath',
    'opposite-segment',
    'opposite-stroke',
    'opposite-span',
    'physical-role',
    'physical-accepted',
    'complete-inventory',
    'diagnostic-reason',
    'held-nonempty',
    'unknown-property',
  ] as const)('rejects malformed material source correspondence: %s', (fault) => {
    const report = materialReference()
    const material = report.floors[0]?.materialSupports
    const span = material?.spans[0]
    const opposite = span?.oppositeFace
    if (!material || !span || !opposite) throw new Error('Missing material fixture')
    if (fault === 'hash') material.source.sha256 = 'd'.repeat(64)
    if (fault === 'page') material.source.pdfPage = 4
    if (fault === 'state') material.source.state = 'proposed'
    if (fault === 'revision') material.sourceRevision = 'd'.repeat(64)
    if (fault === 'floor') span.contourKey = '4'
    if (fault === 'edge') span.wallEdgeIndex = 3
    if (fault === 'off-edge') span.start.y = 11
    if (fault === 'extended-span') span.end.x = 31
    if (fault === 'zero-span') span.end = { ...span.start }
    if (fault === 'fill-operation') span.nativeSegment.operationIndex = 21
    if (fault === 'fill-subpath') span.nativeSegment.subpathIndex = 1
    if (fault === 'early-stroke') span.strokeSegment.operationIndex = 20
    if (fault === 'duplicate') material.spans.push(structuredClone(span))
    if (fault === 'opposite-operation') opposite.nativeSegment.operationIndex = 21
    if (fault === 'opposite-subpath') opposite.nativeSegment.subpathIndex = 1
    if (fault === 'opposite-segment') opposite.nativeSegment.segmentIndex = 0
    if (fault === 'opposite-stroke') opposite.strokeSegment.operationIndex = 19
    if (fault === 'opposite-span') opposite.end.x = 29
    if (fault === 'physical-role') Object.assign(material, { semanticStatus: 'wall-face' })
    if (fault === 'physical-accepted') Object.assign(material, { physicalBoundariesAccepted: true })
    if (fault === 'complete-inventory') Object.assign(material, { completeInventory: true })
    if (fault === 'diagnostic-reason') material.reason = 'held'
    if (fault === 'held-nonempty') {
      material.status = 'held'
      material.reason = 'held'
    }
    if (fault === 'unknown-property') Object.assign(span, { physicalJambAccepted: true })
    expect(sourceFloorReferenceFromResponse(report, page, report.sourceRevision)).toBeNull()
  })

  it.each(['holes', 'rational'] as const)(
    'keeps unsupported %s material diagnostics held and empty',
    (kind) => {
      const report = materialReference()
      const selected = report.floors[0]
      const material = selected?.materialSupports
      if (!selected || !material) throw new Error('Missing material fixture')
      if (kind === 'holes') {
        selected.holes = [
          [
            { x: 15, y: 15 },
            { x: 20, y: 15 },
            { x: 20, y: 20 },
          ],
        ]
        selected.holeExactPointKeys = selected.holes.map((ring) =>
          ring.map((point) => exactNativePointKey(point) as string),
        )
      } else {
        selected.exactPointKeys[0] = '31/3:10/1'
        selected.nonDecimalVertices = 1
      }
      expect(sourceFloorReferenceFromResponse(report, page, report.sourceRevision)).toBeNull()
      material.status = 'held'
      material.reason =
        kind === 'holes'
          ? 'material-support-holes-not-supported'
          : 'material-support-rational-topology-not-supported'
      material.spans = []
      expect(sourceFloorReferenceFromResponse(report, page, report.sourceRevision)).toEqual(report)
      material.reason = null
      expect(sourceFloorReferenceFromResponse(report, page, report.sourceRevision)).toBeNull()
    },
  )

  it('bounds material span inventory across all floors rather than just each floor', () => {
    const report = materialReference()
    const selected = report.floors[0]
    const material = selected?.materialSupports
    const span = material?.spans[0]
    if (!selected || !material || !span) throw new Error('Missing material fixture')
    material.spans = Array.from({ length: 1000 }, (_, segmentIndex) => ({
      ...structuredClone(span),
      strokeSegment: { ...span.strokeSegment, segmentIndex },
    }))
    expect(sourceFloorReferenceFromResponse(report, page, report.sourceRevision)).toEqual(report)
    const extra = structuredClone(selected)
    extra.id = 'source-floor-4'
    extra.sourceRoomKey = '4'
    if (!extra.materialSupports) throw new Error('Missing copied material fixture')
    extra.materialSupports.spans = [{ ...structuredClone(span), contourKey: '4' }]
    report.floors.push(extra)
    expect(sourceFloorReferenceFromResponse(report, page, report.sourceRevision)).toBeNull()
  })

  it('accepts fresh later-paint holds without copying visibility proof into saved geometry', () => {
    const { report, preview } = inspectedReference(true)
    expect(
      sourceFloorReferenceFromResponse(JSON.parse(JSON.stringify(report)), preview, 'b'.repeat(64)),
    ).toEqual(report)
    const contact = report.floors[0]?.boundarySupports?.[0]?.contacts[0]
    expect(contact?.visibility).toMatchObject({
      status: 'held',
      reason: 'later-paint-may-cover-source-span',
      blockerOperations: [1000],
    })
    expect(contact?.visibility?.sourceRef).not.toHaveProperty('start')
    expect(sourceFloorDraft(report.floors[0])).not.toHaveProperty('draft.sourceTopology.visibility')
  })
  it.each([
    'false-clear',
    'source-ref',
    'early-blocker',
    'duplicate-blocker',
    'unknown-reason',
  ] as const)('rejects invalid visibility proof %s', (fault) => {
    const { report, preview } = inspectedReference(true)
    const visibility = report.floors[0]?.boundarySupports?.[0]?.contacts[0]?.visibility
    if (!visibility?.sourceRef) throw new Error('Missing visibility fixture')
    if (fault === 'false-clear') visibility.status = 'unoccluded'
    if (fault === 'source-ref') visibility.sourceRef.segmentIndex = 3
    if (fault === 'early-blocker') visibility.blockerOperations = [1]
    if (fault === 'duplicate-blocker') visibility.blockerOperations = [1000, 1000]
    if (fault === 'unknown-reason') visibility.reason = 'physical-wall-confirmed'
    expect(sourceFloorReferenceFromResponse(report, preview, 'b'.repeat(64))).toBeNull()
  })
  function openingReference() {
    const input = inspectedReference()
    const floor = input.report.floors[0]
    if (!floor) throw new Error('Missing floor')
    input.report.openingInspection = {
      status: 'checked',
      reason: null,
      completeOpeningInventory: false,
      physicalJambAccepted: false,
      physicalPassageAccepted: false,
      finalPaintVisibilityProved: false,
      targets: [
        {
          id: 'native-opening-frame-20:0:frame-side:0',
          objectId: 'native-opening-frame-20:0',
          kind: 'frame-side',
          sourceRef: { operationIndex: 20, subpathIndex: 0, segmentIndex: 0 },
          startKey: '100/1:100/1',
          endKey: '300/1:100/1',
          frameInteriorSide: 'right',
          independentSourceRefs: [],
          sourceEndStatus: null,
          omittedInkCount: 1,
          laterPaintCount: null,
          status: 'matched',
          coverage: 'complete',
          contacts: [
            {
              floorId: floor.id,
              ringIndex: 0,
              edgeIndex: 0,
              startKey: '100/1:100/1',
              endKey: '300/1:100/1',
              regionSide: 'left',
            },
          ],
        },
      ],
    }
    return input
  }

  it('validates exact opening contacts but never persists them as physical topology', () => {
    const { report, preview } = openingReference()
    expect(
      sourceFloorReferenceFromResponse(JSON.parse(JSON.stringify(report)), preview, 'b'.repeat(64)),
    ).toEqual(report)
    const copy = sourceFloorDraft(report.floors[0])
    expect(copy).not.toHaveProperty('draft.openingInspection')
    expect(copy).not.toHaveProperty('draft.sourceTopology.openingInspection')
  })

  it.each([
    'floor',
    'ring',
    'edge',
    'span',
    'direction',
    'coverage',
    'status',
    'same-interior',
    'duplicate',
    'held',
    'physical',
  ] as const)('rejects invalid source-opening correspondence: %s', (fault) => {
    const { report, preview } = openingReference()
    const inspection = report.openingInspection
    const target = inspection?.targets[0]
    const contact = target?.contacts[0]
    if (!inspection || !target || !contact) throw new Error('Missing opening fixture')
    if (fault === 'floor') contact.floorId = 'missing'
    if (fault === 'ring') contact.ringIndex = 1
    if (fault === 'edge') contact.edgeIndex = 3
    if (fault === 'span') contact.endKey = '400/1:100/1'
    if (fault === 'direction') contact.regionSide = 'right'
    if (fault === 'coverage') target.coverage = 'partial'
    if (fault === 'status') target.status = 'ambiguous'
    if (fault === 'same-interior') target.frameInteriorSide = 'left'
    if (fault === 'duplicate') target.contacts.push(structuredClone(contact))
    if (fault === 'held') {
      inspection.status = 'held'
      inspection.reason = 'budget'
    }
    if (fault === 'physical') Object.assign(inspection, { physicalPassageAccepted: true })
    expect(sourceFloorReferenceFromResponse(report, preview, 'b'.repeat(64))).toBeNull()
  })

  it('accepts an atomically held opening inspection without blocking source copy', () => {
    const { report, preview } = openingReference()
    if (!report.openingInspection) throw new Error('Missing inspection')
    report.openingInspection.status = 'held'
    report.openingInspection.reason = 'source-opening-work-limit'
    report.openingInspection.targets = []
    expect(sourceFloorReferenceFromResponse(report, preview, 'b'.repeat(64))).toEqual(report)
    expect(sourceFloorDraft(report.floors[0]).kind).toBe('candidate')
  })

  it('accepts fresh exact support rows without copying them into physical or saved topology', () => {
    const { report, preview } = inspectedReference()
    expect(report.boundaryInspection).toEqual({ status: 'checked', reason: null })
    expect(
      sourceFloorReferenceFromResponse(JSON.parse(JSON.stringify(report)), preview, 'b'.repeat(64)),
    ).toEqual(report)
    const selected = report.floors[0]
    if (!selected) throw new Error('Missing source snapshot')
    const copy = sourceFloorDraft(selected)
    if (copy.kind !== 'candidate') throw new Error('Source copy held')
    expect(copy.draft).not.toHaveProperty('boundarySupports')
    expect(copy.draft.sourceTopology).not.toHaveProperty('boundarySupports')
  })

  it.each([
    'missing-row',
    'duplicate-row',
    'ring',
    'edge',
    'region-side',
    'invalid-role',
    'span',
    'sub-double-gap',
    'coverage',
    'duplicate-contact',
    'competing-contact',
    'missing-status',
    'held-status',
    'authority',
  ] as const)('rejects inconsistent boundary support metadata: %s', (fault) => {
    const { report, preview } = inspectedReference()
    const selected = report.floors[0]
    const rows = selected?.boundarySupports
    const row = rows?.[0]
    const contact = row?.contacts[0]
    if (!selected || !rows || !row || !contact) throw new Error('Missing boundary fixture')
    if (fault === 'missing-row') rows.pop()
    if (fault === 'duplicate-row') rows[1] = structuredClone(row)
    if (fault === 'ring') row.ringIndex = 1
    if (fault === 'edge') row.edgeIndex = 99
    if (fault === 'region-side') row.sourceRegionSide = 'right'
    if (fault === 'invalid-role') Object.assign(row, { declaredRole: 'confirmed-wall' })
    if (fault === 'span') contact.endKey = '400/1:100/1'
    if (fault === 'sub-double-gap') {
      const denominator = 10n ** 40n
      contact.startKey = `${100n * denominator + 1n}/${denominator}:100/1`
    }
    if (fault === 'coverage') row.coverage = 'partial'
    if (fault === 'duplicate-contact') row.contacts.push(structuredClone(contact))
    if (fault === 'competing-contact')
      row.contacts.push({ ...contact, operationIndex: 20, paintSide: 'opposite-region' })
    if (fault === 'missing-status') delete report.boundaryInspection
    if (fault === 'held-status')
      report.boundaryInspection = { status: 'held', reason: 'source-boundary-work-limit' }
    if (fault === 'authority') Object.assign(row, { physicalJambAccepted: true })
    expect(sourceFloorReferenceFromResponse(report, preview, 'b'.repeat(64))).toBeNull()
  })

  it('keeps the source reference usable when inspection is held, without stale proof rows', () => {
    const { report, preview } = inspectedReference()
    report.boundaryInspection = { status: 'held', reason: 'source-boundary-work-limit' }
    if (report.openingInspection) {
      report.openingInspection.status = 'held'
      report.openingInspection.reason = 'source-boundary-inspection-unavailable'
      report.openingInspection.targets = []
    }
    for (const selected of report.floors) delete selected.boundarySupports
    expect(sourceFloorReferenceFromResponse(report, preview, 'b'.repeat(64))).toEqual(report)
    expect(sourceFloorDraft(report.floors[0]).kind).toBe('candidate')
  })

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
