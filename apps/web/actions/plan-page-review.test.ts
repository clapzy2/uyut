import { createHash } from 'node:crypto'
import type { PlanGeometry, PlanPageContours, PlanReading } from '@uyut/db'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { PlanEditConflictError, planEditRevision } from '@/lib/projects/plan-edit-revision'
import { floorHeightFixture } from '@/lib/projects/plan-native-reviewed-floor-heights.fixture'
import { nativeVisiblePaintRegions } from '@/lib/projects/plan-native-visible-paint'
import { planPageGeometryElementId } from '@/lib/projects/plan-page-metric-draft'
import { planPageSourceFloors } from '@/lib/projects/plan-page-source-floors'
import { sourceTopologyDraftIssue } from '@/lib/projects/plan-page-source-topology'
import { edgeDimensionFixture } from '@/lib/projects/test-fixtures/plan-page-edge-dimensions'
import features from '../../../docs/qa/fixtures/apartment-74-77-page-features.json'

const mocks = vi.hoisted(() => ({
  session: vi.fn(),
  owner: vi.fn(),
  object: vi.fn(),
  prepare: vi.fn(),
  save: vi.fn(),
  audit: vi.fn(),
}))
vi.mock('@/lib/session', () => ({ getSession: mocks.session }))
vi.mock('@/lib/projects/access', () => ({
  AccessError: class AccessError extends Error {},
  assertOwner: mocks.owner,
}))
vi.mock('@/lib/storage', () => ({ getObject: mocks.object }))
vi.mock('@/lib/projects/plan-document', () => ({
  PlanReadError: class PlanReadError extends Error {},
  preparePlanPage: mocks.prepare,
}))
vi.mock('@/lib/projects/repository', () => ({ setPlanReading: mocks.save }))
vi.mock('next/cache', () => ({ revalidatePath: vi.fn() }))
vi.mock('next/headers', () => ({ headers: async () => new Headers() }))
vi.mock('@/lib/audit', () => ({ recordAudit: mocks.audit }))

import { AccessError } from '@/lib/projects/access'
import { savePlanPageReview } from './plan-page-review'

const contours: PlanPageContours = {
  source: {
    sha256: createHash('sha256').update('pdf').digest('hex'),
    pdfPage: 6,
    state: 'existing',
  },
  coordinateSystem: 'page-0-1000',
  review: 'manual-source-review',
  pageWidth: 842,
  pageHeight: 1191,
  rooms: [
    {
      roomSourceNumber: 4,
      polygon: [
        { x: 10, y: 10 },
        { x: 30, y: 10 },
        { x: 30, y: 30 },
      ],
    },
  ],
}
const reading: PlanReading = {
  sourcePage: 6,
  planState: 'existing',
  readAt: '2026-09-27',
  rooms: [{ name: 'Спальня', kind: 'bedroom', sourceNumber: 4 }],
}
const project = { planUrl: 'plan.pdf', planReading: reading }
const revision = planEditRevision(project.planUrl, reading)
const page = {
  pageNumber: 6,
  pageCount: 48,
  image: {
    body: Buffer.from('jpeg'),
    contentType: 'image/jpeg',
    planText: JSON.stringify([{ text: '2985', x: 20, y: 10, rotation: 0 }]),
  },
  linework: {
    coordinateSystem: 'page-0-1000',
    pageWidth: 842,
    pageHeight: 1191,
    paths: [
      {
        operationIndex: 1,
        subpathIndex: 0,
        paint: 'stroke',
        closed: false,
        points: [
          { x: 10, y: 10 },
          { x: 30, y: 10 },
          { x: 30, y: 30 },
        ],
      },
    ],
    skippedCurves: 0,
    unsupportedPaths: 0,
    unsupportedContexts: 0,
    clippedPaths: 0,
    truncated: false,
  },
}

describe('save source page review action', () => {
  beforeEach(() => {
    vi.resetAllMocks()
    mocks.session.mockResolvedValue({ user: { id: 'owner' } })
    mocks.owner.mockResolvedValue(project)
    mocks.object.mockResolvedValue({ body: Buffer.from('pdf') })
    mocks.prepare.mockResolvedValue(page)
    mocks.save.mockResolvedValue(undefined)
  })

  function sourceActionFixture() {
    const evidence = floorHeightFixture()
    evidence.native.originalPdfSha256 = contours.source.sha256
    evidence.reviewedFloors.source.sha256 = contours.source.sha256
    evidence.work.paths.push(
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
    const piece = nativeVisiblePaintRegions(evidence).regions.find(
      (region) => region.candidateId === 'native-fill-10:0',
    )?.pieces[0]
    const selection = evidence.reviewedFloors.floors[0]
    if (!piece || !selection) throw new Error('Missing source selection')
    Object.assign(selection, {
      polygon: piece.polygon,
      holes: piece.holes,
      boundaryRoles: piece.polygon.map((_, edgeIndex) => ({ edgeIndex, kind: 'unresolved' })),
    })
    const before: PlanReading = {
      sourcePage: 3,
      planState: 'existing',
      readAt: '2026-10-12',
      rooms: [{ name: 'Спальня', sourceNumber: 3.1, kind: 'bedroom' }],
      paintedFloorReview: {
        version: 1,
        savedAt: 'old',
        draftJson: JSON.stringify(evidence.reviewedFloors),
      },
    }
    const source = evidence.reviewedFloors.source
    const reference = planPageSourceFloors({
      source,
      sourceRevision: 'c'.repeat(64),
      reading: before,
      evidence,
      pageWidth: 1000,
      pageHeight: 1000,
    })
    const floor = reference.floors[0]
    if (!floor) throw new Error('Missing fresh source floor')
    const selected: PlanPageContours = {
      source,
      coordinateSystem: 'page-0-1000',
      review: 'manual-source-review',
      pageWidth: 1000,
      pageHeight: 1000,
      rooms: [
        {
          roomSourceNumber: 3.1,
          polygon: floor.polygon,
          sourceTopology: {
            kind: 'unclassified-source-paint',
            floorId: floor.id,
            exactPointKeys: floor.exactPointKeys,
            holes: floor.holes,
            holeExactPointKeys: floor.holeExactPointKeys,
          },
        },
      ],
    }
    const prepared = {
      ...page,
      pageNumber: 3,
      linework: evidence.work,
      nativeTextAnchors: evidence.native,
      lineworkRasterSource: evidence.lineworkSource,
    }
    mocks.owner.mockResolvedValue({ ...project, planReading: before })
    mocks.prepare.mockResolvedValue(prepared)
    return { before, selected, evidence }
  }

  it('saves exact source intersections and holes and revalidates their persisted snapshot without metric acceptance', async () => {
    const input = sourceActionFixture()
    const before = structuredClone(input.before)
    const result = await savePlanPageReview(
      'project',
      input.selected,
      planEditRevision('plan.pdf', input.before),
    )
    expect(result.ok).toBe(true)
    if (!result.ok) throw new Error(result.error)
    const saved = result.data.reading.pageReview?.contours
    expect(saved).toEqual(input.selected)
    if (!saved) throw new Error('Missing saved source topology')
    expect(
      sourceTopologyDraftIssue({
        contours: JSON.parse(JSON.stringify(saved)),
        reading: result.data.reading,
        source: input.selected.source,
        linework: input.evidence.work,
        evidence: input.evidence,
      }),
    ).toBeUndefined()
    expect(result.data.reading.geometry).toBeUndefined()
    expect(result.data.reading.rooms).toEqual(before.rooms)
    expect(input.before).toEqual(before)
    expect(mocks.prepare).toHaveBeenCalledWith(Buffer.from('pdf'), true, 3, true, true)
  })

  it.each(['keys', 'holes', 'owner', 'missing-source', 'revision'])(
    'rejects %s without saving a partially valid source snapshot',
    async (fault) => {
      const input = sourceActionFixture()
      const room = input.selected.rooms[0]
      if (!room?.sourceTopology) throw new Error('Missing source snapshot')
      if (fault === 'keys') room.sourceTopology.exactPointKeys[0] = '1/1:1/1'
      if (fault === 'holes') {
        room.sourceTopology.holes = []
        room.sourceTopology.holeExactPointKeys = []
      }
      if (fault === 'owner') room.sourceTopology.floorId = 'other-source-floor'
      if (fault === 'missing-source')
        mocks.prepare.mockResolvedValue({ ...page, pageNumber: 3, linework: input.evidence.work })
      expect(
        (
          await savePlanPageReview(
            'project',
            input.selected,
            fault === 'revision' ? 'stale' : planEditRevision('plan.pdf', input.before),
          )
        ).ok,
      ).toBe(false)
      expect(mocks.save).not.toHaveBeenCalled()
    },
  )

  it('preserves legacy edge bindings beside an unclassified source snapshot', async () => {
    const input = sourceActionFixture()
    const legacy = edgeDimensionFixture(0)
    input.before.rooms.push(...legacy.reading.rooms)
    input.selected.rooms.push(...structuredClone(legacy.contours.rooms))
    input.evidence.work.paths.push(
      ...legacy.work.paths.map((path) => ({ ...path, operationIndex: path.operationIndex + 200 })),
    )
    mocks.owner.mockResolvedValue({ ...project, planReading: input.before })
    mocks.prepare.mockResolvedValue({
      ...page,
      pageNumber: 3,
      linework: input.evidence.work,
      nativeTextAnchors: input.evidence.native,
      lineworkRasterSource: input.evidence.lineworkSource,
      image: { ...page.image, planText: legacy.context.planText },
    })
    const result = await savePlanPageReview(
      'project',
      input.selected,
      planEditRevision('plan.pdf', input.before),
    )
    if (!result.ok) throw new Error(result.error)
    expect(result.data.reading.pageReview?.contours).toEqual(input.selected)
    expect(result.data.reading.geometry).toBeUndefined()
    expect(mocks.save).toHaveBeenCalledTimes(1)
  })

  it.each(['single', 'group'])(
    'blocks source marker removal through a %s replacement, preserving holes',
    async (kind) => {
      const input = sourceActionFixture()
      input.before.rooms.push({ name: 'Другая комната', sourceNumber: 4, kind: 'bedroom' })
      input.before.pageReview = {
        version: 1,
        savedAt: 'old',
        contours: structuredClone(input.selected),
      }
      const original = input.selected.rooms[0]
      if (!original) throw new Error('Missing source room')
      input.selected.rooms = [
        kind === 'single'
          ? { roomSourceNumber: 3.1, polygon: original.polygon }
          : { roomSourceNumbers: [3.1, 4], polygon: original.polygon },
      ]
      const result = await savePlanPageReview(
        'project',
        input.selected,
        planEditRevision('plan.pdf', input.before),
      )
      expect(result.ok).toBe(false)
      expect(mocks.prepare).not.toHaveBeenCalled()
      expect(mocks.save).not.toHaveBeenCalled()
    },
  )

  it.each(['first-review', 'exact-key-change'])(
    'demotes related confirmed metric geometry on %s without changing measured data',
    async (kind) => {
      const input = sourceActionFixture()
      input.before.geometry = {
        ...importedGeometry(),
        pdfCalibration: {
          sourceSha256: input.selected.source.sha256,
          pdfPage: 3,
          cmPerPoint: 1,
          origin: { x: 0, y: 0 },
          anchorRoomNumbers: [3.1],
          labelIndexes: [],
          derivedOpeningIds: [],
        },
      }
      if (kind === 'exact-key-change') {
        input.before.pageReview = {
          version: 1,
          savedAt: 'old',
          contours: structuredClone(input.selected),
        }
        const old = input.before.pageReview.contours.rooms[0]?.sourceTopology
        if (!old) throw new Error('Missing prior source snapshot')
        old.exactPointKeys[0] = '1/1:1/1'
      }
      const result = await savePlanPageReview(
        'project',
        input.selected,
        planEditRevision('plan.pdf', input.before),
      )
      if (!result.ok) throw new Error(result.error)
      expect(result.data.reading.geometry).toMatchObject({
        status: 'draft',
        requiresSourceReviewReimport: true,
        walls: input.before.geometry.walls,
      })
      expect(result.data.reading.geometry).not.toHaveProperty('confirmedAt')
      expect(input.before.geometry.status).toBe('confirmed')
    },
  )

  function separateFloorFixture() {
    const polygon = (start: number, end: number) => [
      { x: start, y: start },
      { x: end, y: start },
      { x: end, y: end },
      { x: start, y: end },
    ]
    const reviewed: PlanPageContours = {
      ...contours,
      exterior: { boundaryRole: 'outer-wall-envelope', polygon: polygon(0, 40) },
      floor: { polygon: polygon(5, 35) },
    }
    const native = {
      ...page,
      linework: {
        ...page.linework,
        paths: [
          ...page.linework.paths,
          ...[reviewed.exterior, reviewed.floor].map((boundary, index) => ({
            operationIndex: 2 + index,
            subpathIndex: 0,
            paint: 'stroke',
            closed: true,
            points: boundary?.polygon ?? [],
          })),
        ],
      },
    }
    return { reviewed, native }
  }

  function importedGeometry(): PlanGeometry {
    return {
      version: 1,
      source: 'manual',
      status: 'confirmed',
      confirmedAt: '2026-10-11T12:00:00.000Z',
      widthCm: 100,
      heightCm: 100,
      walls: [
        {
          id: planPageGeometryElementId(contours.source, '4', 'wall', 0),
          kind: 'inner',
          start: { xCm: 10, yCm: 10 },
          end: { xCm: 30, yCm: 10 },
          heightCm: 267.5,
        },
      ],
      rooms: [],
      openings: [],
      warnings: [],
    }
  }

  it.each(['calibrated', 'legacy'] as const)(
    'holds %s imported geometry after a genuine floor change, preserving raw data',
    async (kind) => {
      const { reviewed, native } = separateFloorFixture()
      mocks.prepare.mockResolvedValue(native)
      const geometry = importedGeometry()
      if (kind === 'calibrated')
        geometry.pdfCalibration = {
          sourceSha256: contours.source.sha256,
          pdfPage: 6,
          cmPerPoint: 1,
          origin: { x: 0, y: 0 },
          anchorRoomNumbers: [4],
          labelIndexes: [],
          derivedOpeningIds: [],
        }
      const before: PlanReading = {
        ...reading,
        confirmedAt: '2026-10-11T12:00:00.000Z',
        geometry,
        pageReview: { version: 1, savedAt: 'old', contours },
        deliveryMeasurements: {
          version: 1,
          savedAt: 'old',
          draftJson: 'raw survey',
          reportJson: 'old proof',
        },
      }
      mocks.owner.mockResolvedValue({ planUrl: 'plan.pdf', planReading: before })
      const result = await savePlanPageReview(
        'project',
        reviewed,
        planEditRevision('plan.pdf', before),
      )
      if (!result.ok) throw new Error(result.error)
      expect(result.data.reading.geometry).toMatchObject({
        status: 'draft',
        requiresSourceReviewReimport: true,
        walls: geometry.walls,
      })
      expect(result.data.reading.geometry).not.toHaveProperty('confirmedAt')
      expect(result.data.reading.geometry?.warnings.join(' ')).toContain('обмеры сохранены')
      expect(result.data.reading.confirmedAt).toBe(before.confirmedAt)
      expect(result.data.reading.deliveryMeasurements).toEqual({
        version: 1,
        savedAt: 'old',
        draftJson: 'raw survey',
      })
      expect(before.geometry?.status).toBe('confirmed')
      expect(before.deliveryMeasurements?.reportJson).toBe('old proof')
    },
  )

  it('does not invalidate an unrelated manual drawing when source contours change', async () => {
    const { reviewed, native } = separateFloorFixture()
    mocks.prepare.mockResolvedValue(native)
    const geometry = importedGeometry()
    if (geometry.walls[0]) geometry.walls[0].id = 'manual_unrelated'
    const before = {
      ...reading,
      geometry,
      pageReview: { version: 1 as const, savedAt: 'old', contours },
    }
    mocks.owner.mockResolvedValue({ planUrl: 'plan.pdf', planReading: before })
    const result = await savePlanPageReview(
      'project',
      reviewed,
      planEditRevision('plan.pdf', before),
    )
    if (!result.ok) throw new Error(result.error)
    expect(result.data.reading.geometry).toEqual(geometry)
  })

  it('recognizes legacy imported IDs after JSONB reorders the persisted source keys', async () => {
    const { reviewed, native } = separateFloorFixture()
    mocks.prepare.mockResolvedValue(native)
    const geometry = importedGeometry()
    const reorderedContours = {
      ...contours,
      source: {
        state: contours.source.state,
        pdfPage: contours.source.pdfPage,
        sha256: contours.source.sha256,
      },
    }
    expect(JSON.stringify(reorderedContours.source)).not.toBe(JSON.stringify(contours.source))
    const before = {
      ...reading,
      geometry,
      pageReview: { version: 1 as const, savedAt: 'old', contours: reorderedContours },
    }
    mocks.owner.mockResolvedValue({ planUrl: 'plan.pdf', planReading: before })
    const result = await savePlanPageReview(
      'project',
      reviewed,
      planEditRevision('plan.pdf', before),
    )
    if (!result.ok) throw new Error(result.error)
    expect(result.data.reading.geometry).toMatchObject({
      status: 'draft',
      requiresSourceReviewReimport: true,
    })
    expect(result.data.reading.geometry).not.toHaveProperty('confirmedAt')
    expect(before.geometry.status).toBe('confirmed')
  })

  it('keeps imported confirmation for identical contours and refreshed proof metadata', async () => {
    const geometry = importedGeometry()
    const metadataOnly = {
      ...contours,
      rooms: contours.rooms.map((room) => ({ ...room, vertexProofs: [] })),
    }
    const before = {
      ...reading,
      geometry,
      pageReview: { version: 1 as const, savedAt: 'old', contours },
    }
    mocks.owner.mockResolvedValue({ planUrl: 'plan.pdf', planReading: before })
    const result = await savePlanPageReview(
      'project',
      metadataOnly,
      planEditRevision('plan.pdf', before),
    )
    if (!result.ok) throw new Error(result.error)
    expect(result.data.reading.geometry).toEqual(geometry)
  })

  it('saves separate floor only after rereading its native PDF vertices', async () => {
    const { reviewed, native } = separateFloorFixture()
    mocks.prepare.mockResolvedValue(native)
    const result = await savePlanPageReview('project', reviewed, revision)
    expect(result.ok).toBe(true)
    if (!result.ok) throw new Error(result.error)
    expect(result.data.reading.pageReview?.contours).toEqual(reviewed)
    expect(result.data.reading.geometry).toBeUndefined()
    expect(mocks.audit.mock.calls[0]?.[0].metadata.floorVertices).toBe(4)
  })

  it.each(['role', 'native-vertex', 'room-outside'] as const)(
    'refuses invalid floor %s with an actionable explanation and no write',
    async (change) => {
      const { reviewed, native } = separateFloorFixture()
      mocks.prepare.mockResolvedValue(structuredClone(native))
      if (!reviewed.exterior || !reviewed.floor) throw new Error('Missing boundary fixture')
      if (change === 'role') reviewed.exterior.boundaryRole = 'floor'
      if (change === 'native-vertex') {
        const point = reviewed.floor.polygon[0]
        if (!point) throw new Error('Missing vertex fixture')
        point.x += 0.1
      }
      if (change === 'room-outside')
        reviewed.floor.polygon = [
          { x: 5, y: 5 },
          { x: 20, y: 5 },
          { x: 20, y: 20 },
          { x: 5, y: 20 },
        ]
      const result = await savePlanPageReview('project', reviewed, revision)
      expect(result.ok).toBe(false)
      if (result.ok) throw new Error('Unexpected floor save')
      expect(result.error).toContain(
        change === 'role'
          ? 'Наружная сторона стен'
          : change === 'native-vertex'
            ? 'к узлу исходного PDF'
            : 'выходит за границу пола',
      )
      expect(mocks.save).not.toHaveBeenCalled()
      expect(mocks.audit).not.toHaveBeenCalled()
    },
  )

  it('сохраняет выбор сторон только после привязки свежих линий и подписей', async () => {
    const f = edgeDimensionFixture()
    const reviewed = structuredClone(f.contours)
    reviewed.source.sha256 = createHash('sha256').update('pdf').digest('hex')
    const before = { ...project, planReading: f.reading }
    mocks.owner.mockResolvedValue(before)
    mocks.prepare.mockResolvedValue({
      ...page,
      pageNumber: 1,
      linework: f.work,
      image: { ...page.image, planText: f.context.planText },
    })
    const result = await savePlanPageReview(
      'project',
      reviewed,
      planEditRevision('plan.pdf', f.reading),
    )
    expect(result.ok).toBe(true)
    expect(mocks.save).toHaveBeenCalledWith(
      'owner',
      'project',
      expect.objectContaining({ pageReview: expect.objectContaining({ contours: reviewed }) }),
      before,
    )
  })

  it.each(['подпись', 'выносная линия'])(
    'не сохраняет выбор при изменении источника: %s',
    async (change) => {
      const f = edgeDimensionFixture()
      const reviewed = structuredClone(f.contours)
      reviewed.source.sha256 = createHash('sha256').update('pdf').digest('hex')
      mocks.owner.mockResolvedValue({ ...project, planReading: f.reading })
      mocks.prepare.mockResolvedValue({
        ...page,
        pageNumber: 1,
        linework: {
          ...f.work,
          paths:
            change === 'выносная линия'
              ? f.work.paths.filter((path) => path.operationIndex !== 7)
              : f.work.paths,
        },
        image: {
          ...page.image,
          planText:
            change === 'подпись' ? JSON.stringify([f.labels[1], f.labels[0]]) : f.context.planText,
        },
      })
      const result = await savePlanPageReview(
        'project',
        reviewed,
        planEditRevision('plan.pdf', f.reading),
      )
      expect(result.ok).toBe(false)
      expect(mocks.save).not.toHaveBeenCalled()
      expect(mocks.audit).not.toHaveBeenCalled()
    },
  )

  it('saves a versioned review using fresh native PDF proof and atomic source guard', async () => {
    const result = await savePlanPageReview('project', contours, revision)
    if (!result.ok) throw new Error(result.error)
    expect(mocks.prepare).toHaveBeenCalledWith(Buffer.from('pdf'), true, 6, true)
    expect(result.data.reading.pageReview).toMatchObject({ version: 1, contours })
    expect(result.data.reading).not.toHaveProperty('confirmedAt')
    expect(mocks.save).toHaveBeenCalledWith('owner', 'project', result.data.reading, project)
    expect(result.data.revision).toBe(planEditRevision('plan.pdf', result.data.reading))
    expect(mocks.audit).toHaveBeenCalledWith({
      action: 'project.plan_page_reviewed',
      actorId: 'owner',
      targetType: 'project',
      targetId: 'project',
      headers: expect.any(Headers),
      metadata: { page: 6, planState: 'existing', contours: 1, openings: 0, obstacles: 0 },
    })
    const saveOrder = mocks.save.mock.invocationCallOrder[0]
    const auditOrder = mocks.audit.mock.invocationCallOrder[0]
    if (saveOrder === undefined || auditOrder === undefined)
      throw new Error('Missing save or audit')
    expect(saveOrder).toBeLessThan(auditOrder)
  })

  it('сохраняет найденный на том же листе перечень помещений без добавления размеров', async () => {
    mocks.prepare.mockResolvedValue({
      ...page,
      image: {
        ...page.image,
        planText: JSON.stringify([
          { text: 'Экспликация помещений:', x: 630, y: 642, rotation: 0 },
          { text: '01-Прихожая - 9,99 м', x: 630, y: 660, rotation: 0 },
          { text: '02-Кухня - 8,51м', x: 630, y: 679, rotation: 0 },
          { text: '03-Спальня - 25,51м', x: 630, y: 697, rotation: 0 },
          { text: '04-Спальня - 16,54м', x: 630, y: 715, rotation: 0 },
        ]),
      },
    })
    const result = await savePlanPageReview('project', contours, revision)
    if (!result.ok) throw new Error(result.error)
    expect(result.data.reading.pageReview?.sourceRooms).toEqual([
      { sourceNumber: 1, name: 'Прихожая' },
      { sourceNumber: 2, name: 'Кухня' },
      { sourceNumber: 3, name: 'Спальня' },
      { sourceNumber: 4, name: 'Спальня' },
    ])
    expect(result.data.reading.rooms).toEqual(reading.rooms)
  })

  it('сохраняет исходную таблицу обмера без переименования помещения', async () => {
    mocks.prepare.mockResolvedValue({
      ...page,
      image: {
        ...page.image,
        planText: JSON.stringify([
          { text: '№', x: 707, y: 147, rotation: 0 },
          { text: 'Наименование', x: 802, y: 147, rotation: 0 },
          { text: 'Площадь', x: 939, y: 147, rotation: 0 },
          { text: '01', x: 707, y: 186, rotation: 0 },
          { text: 'Помещение', x: 741, y: 186, rotation: 0 },
          { text: '40,13', x: 948, y: 186, rotation: 0 },
          { text: '02', x: 707, y: 213, rotation: 0 },
          { text: 'Балкон 01', x: 741, y: 213, rotation: 0 },
          { text: '4,75', x: 950, y: 213, rotation: 0 },
          { text: '03', x: 707, y: 240, rotation: 0 },
          { text: 'Балкон 02', x: 741, y: 240, rotation: 0 },
          { text: '3,34', x: 950, y: 240, rotation: 0 },
        ]),
      },
    })

    const result = await savePlanPageReview('project', contours, revision)
    if (!result.ok) throw new Error(result.error)
    expect(result.data.reading.pageReview?.sourceRooms).toEqual([
      { sourceNumber: 1, name: 'Помещение' },
      { sourceNumber: 2, name: 'Балкон 01' },
      { sourceNumber: 3, name: 'Балкон 02' },
    ])
    expect(result.data.reading.rooms).toEqual(reading.rooms)
  })

  it('refuses a missing session, malformed payload, or stale revision before reading storage', async () => {
    mocks.session.mockResolvedValueOnce(null)
    expect((await savePlanPageReview('project', contours, revision)).ok).toBe(false)
    expect((await savePlanPageReview('project', null, revision)).ok).toBe(false)
    expect(await savePlanPageReview('project', contours, 'stale')).toMatchObject({
      ok: false,
      code: 'plan-conflict',
    })
    expect(mocks.object).not.toHaveBeenCalled()
    expect(mocks.save).not.toHaveBeenCalled()
  })
  it('derives a printed opening width from fresh native evidence without creating metric layout geometry', async () => {
    const sourceRoom = features.rooms.find((room) => room.roomSourceNumber === 4)
    if (!sourceRoom) throw new Error('Missing native source room')
    const input: PlanPageContours = {
      ...contours,
      rooms: [
        {
          roomSourceNumber: 4,
          polygon: sourceRoom.polygon,
          openings: sourceRoom.openings.map(({ id, wallEdgeIndex, start, end }) => ({
            id,
            kind: 'door',
            wallEdgeIndex,
            start,
            end,
          })),
        },
      ],
    }
    const labels = Array.from({ length: 170 }, () => ({ text: '', x: 0, y: 0, rotation: 0 }))
    for (const { index, ...label } of features.labels) labels[index] = label
    mocks.prepare.mockResolvedValue({
      ...page,
      image: { ...page.image, planText: JSON.stringify(labels) },
      linework: { ...page.linework, paths: [...features.wallPaths, ...features.dimensionPaths] },
    })
    const result = await savePlanPageReview('project', input, revision)
    if (!result.ok) throw new Error(result.error)
    expect(result.data.reading.pageReview?.featureChecks?.openings).toEqual([
      {
        roomSourceNumber: 4,
        openingId: 'room-4-existing-door',
        status: 'candidate',
        widthMm: 896,
        labelIndex: 59,
      },
    ])
    expect(result.data.reading).not.toHaveProperty('geometry')
    expect(result.data.reading).not.toHaveProperty('confirmedAt')
    expect(mocks.save).toHaveBeenCalledWith('owner', 'project', result.data.reading, project)
  })

  it('refuses dimensions injected into submitted feature annotations before storage access', async () => {
    const input = structuredClone(contours)
    const room = input.rooms[0]
    if (!room) throw new Error('Missing room')
    Object.assign(room, {
      openings: [
        {
          id: 'door',
          kind: 'door',
          wallEdgeIndex: 0,
          start: room.polygon[0],
          end: room.polygon[1],
          widthMm: 900,
        },
      ],
    })
    expect((await savePlanPageReview('project', input, revision)).ok).toBe(false)
    expect(mocks.object).not.toHaveBeenCalled()
    expect(mocks.save).not.toHaveBeenCalled()
  })

  it('refuses changed source bytes before PDF processing', async () => {
    mocks.object.mockResolvedValue({ body: Buffer.from('new-pdf') })
    expect(await savePlanPageReview('project', contours, revision)).toMatchObject({
      ok: false,
      code: 'plan-conflict',
    })
    expect(mocks.prepare).not.toHaveBeenCalled()
    expect(mocks.save).not.toHaveBeenCalled()
  })

  it('keeps editing owner-only even when a collaborator can preview the source', async () => {
    mocks.owner.mockRejectedValue(new AccessError('Это может сделать только владелец проекта.'))
    expect(await savePlanPageReview('project', contours, revision)).toMatchObject({ ok: false })
    expect(mocks.object).not.toHaveBeenCalled()
    expect(mocks.save).not.toHaveBeenCalled()
  })

  it('rejects a forged unsnapped contour even when the client bypasses the editor', async () => {
    const changed = structuredClone(contours)
    const vertex = changed.rooms[0]?.polygon[0]
    if (!vertex) throw new Error('Missing contour vertex')
    vertex.x += 0.1
    expect((await savePlanPageReview('project', changed, revision)).ok).toBe(false)
    expect(mocks.save).not.toHaveBeenCalled()
    expect(mocks.audit).not.toHaveBeenCalled()
  })

  it.each([
    { ...page, linework: undefined },
    { ...page, image: { ...page.image, planText: undefined } },
    { ...page, linework: { ...page.linework, paths: [] } },
    { ...page, linework: { ...page.linework, truncated: true } },
  ])('does not save a page without usable native proof', async (prepared) => {
    mocks.prepare.mockResolvedValue(prepared)
    expect((await savePlanPageReview('project', contours, revision)).ok).toBe(false)
    expect(mocks.save).not.toHaveBeenCalled()
  })

  it('does not accept an unknown page state or another selected page', async () => {
    const unknown = { ...project, planReading: { ...reading, planState: 'unknown' as const } }
    mocks.owner.mockResolvedValue(unknown)
    expect(
      (
        await savePlanPageReview(
          'project',
          contours,
          planEditRevision('plan.pdf', unknown.planReading),
        )
      ).ok,
    ).toBe(false)
    expect(mocks.object).not.toHaveBeenCalled()
  })

  it('reports concurrent file replacement as a conflict at the final write', async () => {
    mocks.save.mockRejectedValue(new PlanEditConflictError())
    expect(await savePlanPageReview('project', contours, revision)).toMatchObject({
      ok: false,
      code: 'plan-conflict',
    })
  })
})
