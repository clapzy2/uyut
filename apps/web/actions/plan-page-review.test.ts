import { createHash } from 'node:crypto'
import type { PlanPageContours, PlanReading } from '@uyut/db'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { PlanEditConflictError, planEditRevision } from '@/lib/projects/plan-edit-revision'
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
