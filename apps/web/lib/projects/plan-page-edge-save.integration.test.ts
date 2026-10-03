import { randomUUID } from 'node:crypto'
import { type PlanReading, users } from '@uyut/db'
import { eq } from 'drizzle-orm'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { getDb } from '@/lib/db'
import { PlanEditConflictError } from './plan-edit-revision'
import { planPageMetricDraft } from './plan-page-metric-draft'
import { planPageContoursSchema } from './plan-page-review'
import { createProject, getProject, setPlanReading, setProjectPlan } from './repository'
import { edgeDimensionFixture, required } from './test-fixtures/plan-page-edge-dimensions'

// Synthetic source evidence tests JSONB persistence, not PDF recognition or an on-site survey.
describe('database round trip of reviewed tilted edge dimensions', () => {
  let owner = ''

  beforeAll(async () => {
    const databaseUrl = new URL(process.env.DATABASE_URL ?? '')
    if (!['127.0.0.1', 'localhost', '[::1]'].includes(databaseUrl.hostname)) {
      throw new Error('Edge persistence QA requires a local PostgreSQL database')
    }
    const [user] = await getDb()
      .insert(users)
      .values({ email: `edge-save-${randomUUID()}@example.test`, displayName: 'Edge save QA' })
      .returning({ id: users.id })
    owner = required(user).id
  })

  afterAll(async () => {
    if (owner) await getDb().delete(users).where(eq(users.id, owner))
  })

  it('retains source edges, refs and scale through rereading and refuses stale writes', async () => {
    const fixture = edgeDimensionFixture()
    const project = await createProject(owner, { title: 'Synthetic tilted edge persistence QA' })
    await setProjectPlan(owner, project.id, 'qa/synthetic-edge-source.pdf', project)
    const empty = await getProject(owner, project.id)
    await setPlanReading(owner, project.id, fixture.reading, empty)
    const source = await getProject(owner, project.id)
    const reviewed: PlanReading = {
      ...required(source.planReading ?? undefined),
      pageReview: {
        version: 1,
        savedAt: '2026-10-03T00:00:00.000Z',
        contours: planPageContoursSchema.parse(fixture.contours),
      },
    }
    await setPlanReading(owner, project.id, reviewed, source)

    const reopened = await getProject(owner, project.id)
    const reopenedReading = required(reopened.planReading ?? undefined)
    const reopenedReview = required(reopenedReading.pageReview)
    expect(reopenedReading).toEqual(reviewed)
    expect(reopenedReview.contours.rooms[0]?.dimensionEdges).toEqual([
      { wallEdgeIndex: 0, labelIndexes: [0] },
      { wallEdgeIndex: 3, labelIndexes: [1] },
    ])
    const draft = planPageMetricDraft(
      reopenedReading,
      { ...fixture.context, contours: reopenedReview.contours, useEdgeDimensions: true },
      [1],
    )
    if (!draft.ok) throw new Error(draft.error)
    const calibration = required(draft.geometry.pdfCalibration)
    expect(calibration.cmPerPoint).toBeCloseTo(1, 12)
    expect(calibration.edgeDimensions).toEqual([
      {
        roomSourceNumber: 1,
        wallEdgeIndex: 0,
        totalMm: 3000,
        labelIndexes: [0],
        lineOperations: [4],
        sourceEdge: [fixture.room.polygon[0], fixture.room.polygon[1]],
        wallRef: { operationIndex: 0, subpathIndex: 0, segmentIndex: 0 },
        endpointRefs: [
          { operationIndex: 7, subpathIndex: 0, segmentIndex: 0 },
          { operationIndex: 8, subpathIndex: 0, segmentIndex: 0 },
        ],
      },
      {
        roomSourceNumber: 1,
        wallEdgeIndex: 3,
        totalMm: 2000,
        labelIndexes: [1],
        lineOperations: [9],
        sourceEdge: [fixture.room.polygon[3], fixture.room.polygon[0]],
        wallRef: { operationIndex: 3, subpathIndex: 0, segmentIndex: 0 },
        endpointRefs: [
          { operationIndex: 13, subpathIndex: 0, segmentIndex: 0 },
          { operationIndex: 12, subpathIndex: 0, segmentIndex: 0 },
        ],
      },
    ])

    const withGeometry: PlanReading = { ...reopenedReading, geometry: draft.geometry }
    await expect(setPlanReading(owner, project.id, withGeometry, source)).rejects.toBeInstanceOf(
      PlanEditConflictError,
    )
    expect((await getProject(owner, project.id)).planReading).toEqual(reopenedReading)
    await setPlanReading(owner, project.id, withGeometry, reopened)
    const saved = await getProject(owner, project.id)
    const savedReading = required(saved.planReading ?? undefined)
    const savedGeometry = required(savedReading.geometry)
    expect(savedGeometry).toEqual(draft.geometry)
    expect(savedGeometry.pdfCalibration?.edgeDimensions).toEqual(calibration.edgeDimensions)
    expect(savedGeometry.pdfCalibration?.cmPerPoint).toBe(calibration.cmPerPoint)
    expect(savedGeometry.status).toBe('draft')
    expect(savedGeometry.openings).toEqual([])
    expect(savedGeometry).not.toHaveProperty('ceilingCm')
    expect(savedGeometry.walls.every((wall) => wall.heightCm === undefined)).toBe(true)
    expect(savedReading.rooms[0]).not.toHaveProperty('widthCm')
    expect(savedReading.rooms[0]).not.toHaveProperty('depthCm')
    expect(savedReading).not.toHaveProperty('ceilingCm')
    expect(savedReading).not.toHaveProperty('confirmedAt')

    const rebuilt = planPageMetricDraft(
      savedReading,
      {
        ...fixture.context,
        contours: required(savedReading.pageReview).contours,
        useEdgeDimensions: true,
      },
      [1],
    )
    if (!rebuilt.ok) throw new Error(rebuilt.error)
    expect(rebuilt.geometry.pdfCalibration).toEqual(savedGeometry.pdfCalibration)
    expect(rebuilt.geometry.status).toBe('draft')

    await setProjectPlan(owner, project.id, 'qa/replacement-edge-source.pdf', saved)
    await expect(setPlanReading(owner, project.id, withGeometry, saved)).rejects.toBeInstanceOf(
      PlanEditConflictError,
    )
    const replacement = await getProject(owner, project.id)
    expect(replacement.planUrl).toBe('qa/replacement-edge-source.pdf')
    expect(replacement.planReading).toBeNull()
  })

  it('persists floor independently from the exterior without adding floor walls', async () => {
    const fixture = edgeDimensionFixture()
    const envelope = [
      fixture.point(-30, -30),
      fixture.point(360, -30),
      fixture.point(360, 230),
      fixture.point(-30, 230),
    ]
    const floor = [
      fixture.point(-10, -10),
      fixture.point(340, -10),
      fixture.point(340, 210),
      fixture.point(-10, 210),
    ]
    for (const polygon of [envelope, floor]) {
      fixture.work.paths.push({
        operationIndex: fixture.work.paths.length,
        subpathIndex: 0,
        paint: 'stroke',
        closed: true,
        points: polygon,
      })
    }
    const contours = planPageContoursSchema.parse({
      ...fixture.contours,
      exterior: { boundaryRole: 'outer-wall-envelope', polygon: envelope },
      floor: { polygon: floor },
    })
    const envelopeOnly = planPageMetricDraft(
      fixture.reading,
      { ...fixture.context, contours: { ...contours, floor: undefined } },
      [1],
    )
    const draft = planPageMetricDraft(fixture.reading, { ...fixture.context, contours }, [1])
    if (!envelopeOnly.ok) throw new Error(envelopeOnly.error)
    if (!draft.ok) throw new Error(draft.error)
    expect(envelopeOnly.geometry.footprint).toBeUndefined()
    expect(draft.geometry.footprint).toHaveLength(4)
    expect(draft.geometry.walls).toEqual(envelopeOnly.geometry.walls)
    expect(draft.geometry.walls).toHaveLength(8)
    const project = await createProject(owner, { title: 'Synthetic independent floor QA' })
    await setProjectPlan(owner, project.id, 'qa/synthetic-floor-source.pdf', project)
    const source = await getProject(owner, project.id)
    const saved: PlanReading = {
      ...fixture.reading,
      geometry: draft.geometry,
      pageReview: { version: 1, savedAt: '2026-10-03T00:00:00.000Z', contours },
    }
    await setPlanReading(owner, project.id, saved, source)
    const reopened = await getProject(owner, project.id)
    expect(reopened.planReading).toEqual(saved)
    const rebuilt = planPageMetricDraft(
      required(reopened.planReading ?? undefined),
      { ...fixture.context, contours: required(reopened.planReading?.pageReview).contours },
      [1],
    )
    if (!rebuilt.ok) throw new Error(rebuilt.error)
    expect(rebuilt.geometry).toEqual(draft.geometry)
  })
})
