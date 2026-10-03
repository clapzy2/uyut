import { createHash, randomUUID } from 'node:crypto'
import { readFile } from 'node:fs/promises'
import { type PlanGeometry, type PlanPageContours, type PlanReading, users } from '@uyut/db'
import { eq } from 'drizzle-orm'
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest'
import { getDb } from '@/lib/db'
import { planEditRevision } from '@/lib/projects/plan-edit-revision'
import {
  openingMeasurementSnapshot,
  openingMeasurementWallSnapshot,
} from '@/lib/projects/plan-opening-measurements'
import {
  createProject,
  getProject,
  setPlanReading,
  setProjectPlan,
} from '@/lib/projects/repository'
import { createPlanPageGeometryDraft } from './plan-page-geometry'
import { confirmPlanRooms, savePlanGeometry } from './projects'

const local = vi.hoisted(() => ({ owner: '', body: Buffer.alloc(0) }))
vi.mock('@/lib/session', () => ({ getSession: async () => ({ user: { id: local.owner } }) }))
vi.mock('@/lib/storage', () => ({
  getObject: async () => ({ body: local.body, contentType: 'application/pdf' }),
  putObject: vi.fn(),
  deleteObject: vi.fn(),
}))
vi.mock('next/cache', () => ({ revalidatePath: vi.fn() }))
vi.mock('next/headers', () => ({ headers: async () => new Headers() }))
vi.mock('@/lib/audit', () => ({ recordAudit: vi.fn() }))
vi.mock('@/lib/projects/plan-reading', () => ({
  PlanReadError: class PlanReadError extends Error {},
  readPlanFromStorage: vi.fn(),
}))

// Explicit local inputs: not a substitute for production auth, S3 or automatic contour recognition.
const enabled = Boolean(process.env.QA_PLAN_PDF && process.env.QA_PLAN_TRANSFER_REPORT)
describe.skipIf(!enabled)('real reviewed PDF through actions and PostgreSQL', () => {
  let owner = ''
  let contours: PlanPageContours
  let expectedGeometry: PlanGeometry
  let reading: PlanReading

  beforeAll(async () => {
    const databaseUrl = new URL(process.env.DATABASE_URL ?? '')
    if (!['127.0.0.1', 'localhost', '[::1]'].includes(databaseUrl.hostname))
      throw new Error('Real PDF persistence QA requires a local PostgreSQL database')
    local.body = await readFile(process.env.QA_PLAN_PDF as string)
    const report = JSON.parse(await readFile(process.env.QA_PLAN_TRANSFER_REPORT as string, 'utf8'))
    if (
      !report.draft?.ok ||
      report.source?.state !== 'existing' ||
      createHash('sha256').update(local.body).digest('hex') !== report.source.sha256
    )
      throw new Error('Real PDF and successful control report do not match')
    contours = report.savedContours
    expectedGeometry = report.draft.geometry
    const fixture = JSON.parse(
      await readFile(
        new URL('../../../docs/qa/fixtures/spb-pobedy-5-open-zones.json', import.meta.url),
        'utf8',
      ),
    )
    reading = {
      sourcePage: contours.source.pdfPage,
      planState: 'existing',
      readAt: '2026-10-03',
      confirmedAt: '2026-10-03T00:00:00.000Z',
      rooms: fixture.rooms.map((room: PlanReading['rooms'][number]) => ({
        sourceNumber: room.sourceNumber,
        name: room.name,
        kind: room.kind,
      })),
      pageReview: { version: 1, savedAt: '2026-10-03T00:00:00.000Z', contours },
    }
    const [user] = await getDb()
      .insert(users)
      .values({ email: `real-plan-save-${randomUUID()}@example.test`, displayName: 'Real PDF QA' })
      .returning({ id: users.id })
    if (!user) throw new Error('Local QA user was not created')
    owner = user.id
    local.owner = owner
  })

  afterAll(async () => {
    if (owner) await getDb().delete(users).where(eq(users.id, owner))
  })

  it('reopens every contour and opening; rejects confirmation, stale edits and forged proofs', async () => {
    const project = await createProject(owner, { title: 'Real PDF draft persistence QA' })
    await setProjectPlan(owner, project.id, 'qa/real-edge-plan.pdf', project)
    const empty = await getProject(owner, project.id)
    await setPlanReading(owner, project.id, reading, empty)
    const source = await getProject(owner, project.id)
    const created = await createPlanPageGeometryDraft(
      project.id,
      reading.rooms.map((room) => room.sourceNumber),
      planEditRevision(source.planUrl, source.planReading),
      undefined,
      true,
    )
    if (!created.ok) throw new Error(created.error)
    expect(created.data.geometry).toEqual(expectedGeometry)
    const reopened = await getProject(owner, project.id)
    expect(reopened.planReading?.geometry).toEqual(expectedGeometry)
    expect(reopened.planReading?.pageReview?.contours).toEqual(contours)
    expect(reopened.planReading?.pageReview?.sourceRooms).toHaveLength(10)

    const saved = await savePlanGeometry(
      project.id,
      {
        ...expectedGeometry,
        pdfCalibration: {
          ...expectedGeometry.pdfCalibration,
          cmPerPoint: 999,
          derivedOpeningIds: [],
        },
      },
      'draft',
      created.data.revision,
    )
    if (!saved.ok) throw new Error(saved.error)
    expect(saved.data.geometry.pdfCalibration?.edgeDimensions).toEqual(
      expectedGeometry.pdfCalibration?.edgeDimensions,
    )
    expect(saved.data.geometry.pdfCalibration?.cmPerPoint).toBe(
      expectedGeometry.pdfCalibration?.cmPerPoint,
    )
    expect(saved.data.geometry.pdfCalibration?.derivedOpeningIds).toHaveLength(16)
    expect(saved.data.geometry.pdfCalibration).toEqual(expectedGeometry.pdfCalibration)
    expect(saved.data.geometry.walls).toEqual(expectedGeometry.walls)
    expect(saved.data.geometry.rooms).toEqual(expectedGeometry.rooms)
    expect(saved.data.geometry.openings).toEqual(expectedGeometry.openings)
    expect(saved.data.geometry.warnings).toEqual(expectedGeometry.warnings)
    expect(saved.data.geometry.status).toBe('draft')
    expect(saved.data.geometry.confirmedAt).toBeUndefined()
    const persisted = await getProject(owner, project.id)
    expect(persisted.planReading?.geometry).toEqual(saved.data.geometry)
    const confirm = await savePlanGeometry(
      project.id,
      saved.data.geometry,
      'confirm',
      saved.data.revision,
    )
    expect(confirm).toMatchObject({ ok: false })
    if (!confirm.ok) expect(confirm.error).toContain('№06')
    expect((await getProject(owner, project.id)).planReading).toEqual(persisted.planReading)
    expect(await savePlanGeometry(project.id, saved.data.geometry, 'draft', 'stale')).toMatchObject(
      {
        ok: false,
        code: 'plan-conflict',
      },
    )
    expect((await getProject(owner, project.id)).planReading).toEqual(persisted.planReading)
    local.owner = randomUUID()
    expect(
      await savePlanGeometry(project.id, saved.data.geometry, 'draft', saved.data.revision),
    ).toMatchObject({ ok: false })
    local.owner = owner
    expect((await getProject(owner, project.id)).planReading).toEqual(persisted.planReading)
  })

  it('stores user-provided measurement provenance in JSONB and invalidates it on a host edit', async () => {
    const project = await createProject(owner, {
      title: 'Synthetic measurement on real PDF geometry QA',
    })
    await setProjectPlan(owner, project.id, 'qa/real-edge-measurement.pdf', project)
    const empty = await getProject(owner, project.id)
    await setPlanReading(owner, project.id, { ...reading, geometry: expectedGeometry }, empty)
    const source = await getProject(owner, project.id)
    const opening = expectedGeometry.openings.find((item) =>
      expectedGeometry.pdfCalibration?.derivedOpeningIds.includes(item.id),
    )
    const wall = expectedGeometry.walls.find((item) => item.id === opening?.wallId)
    if (!opening || !wall) throw new Error('Missing real PDF opening fixture')
    // Same numbers deliberately exercise persistence only; they are NOT a verified real-world survey.
    const saved = await savePlanGeometry(
      project.id,
      {
        ...expectedGeometry,
        openingMeasurementRequests: [
          {
            action: 'verify',
            opening: openingMeasurementSnapshot(opening),
            wall: openingMeasurementWallSnapshot(wall),
            source: {
              kind: 'site-measurement',
              reference: 'Синтетическая проверка сохранения, не натурный обмер',
            },
            acknowledged: true,
          },
        ],
      },
      'draft',
      planEditRevision(source.planUrl, source.planReading),
    )
    if (!saved.ok) throw new Error(saved.error)
    expect(saved.data.geometry.pdfCalibration?.derivedOpeningIds).toHaveLength(15)
    expect(saved.data.geometry.pdfCalibration?.measurementRequiredOpeningIds).toHaveLength(16)
    const measurement = saved.data.geometry.pdfCalibration?.openingMeasurements?.[0]
    expect(measurement).toMatchObject({
      verifiedBy: owner,
      opening: openingMeasurementSnapshot(opening),
      wall: openingMeasurementWallSnapshot(wall),
    })
    expect(Number.isFinite(Date.parse(measurement?.verifiedAt ?? ''))).toBe(true)
    const reopened = await getProject(owner, project.id)
    expect(reopened.planReading?.geometry).toEqual(saved.data.geometry)
    const unchanged = await savePlanGeometry(
      project.id,
      saved.data.geometry,
      'draft',
      saved.data.revision,
    )
    if (!unchanged.ok) throw new Error(unchanged.error)
    expect(unchanged.data.geometry.pdfCalibration?.openingMeasurements).toEqual([measurement])
    const changed = await savePlanGeometry(
      project.id,
      {
        ...unchanged.data.geometry,
        walls: unchanged.data.geometry.walls.map((item) =>
          item.id === wall.id ? { ...item, kind: item.kind === 'inner' ? 'outer' : 'inner' } : item,
        ),
      },
      'draft',
      unchanged.data.revision,
    )
    if (!changed.ok) throw new Error(changed.error)
    expect(changed.data.geometry.pdfCalibration?.openingMeasurements).toEqual([])
    expect(changed.data.geometry.pdfCalibration?.derivedOpeningIds).toContain(opening.id)
    expect((await getProject(owner, project.id)).planReading?.geometry).toEqual(
      changed.data.geometry,
    )
    const confirmation = await savePlanGeometry(
      project.id,
      changed.data.geometry,
      'confirm',
      changed.data.revision,
    )
    expect(confirmation.ok).toBe(false)
    if (!confirmation.ok) expect(confirmation.error).toContain('№06')
  })

  it('adds the missing source room without inventing dimensions or creating furniture rooms', async () => {
    const project = await createProject(owner, { title: 'Missing source room persistence QA' })
    await setProjectPlan(owner, project.id, 'qa/real-room-inventory.pdf', project)
    const empty = await getProject(owner, project.id)
    await setPlanReading(owner, project.id, reading, empty)
    const reviewed = await getProject(owner, project.id)
    const draft = await createPlanPageGeometryDraft(
      project.id,
      reading.rooms.map((room) => room.sourceNumber),
      planEditRevision(reviewed.planUrl, reviewed.planReading),
      undefined,
      true,
    )
    if (!draft.ok) throw new Error(draft.error)
    const source = await getProject(owner, project.id)
    const result = await confirmPlanRooms(
      project.id,
      {
        ceilingCm: '',
        condition: 'bare',
        rooms: [
          ...reading.rooms.map((room) => ({
            name: room.name,
            kind: room.kind,
            sourceNumber: room.sourceNumber,
            include: false,
            roomId: '',
            widthCm: '',
            depthCm: '',
            areaM2: '',
            ceilingCm: '',
            wish: '',
          })),
          {
            name: 'Спальня №06',
            kind: 'bedroom',
            sourceNumber: 6,
            include: false,
            roomId: '',
            widthCm: '',
            depthCm: '',
            areaM2: '',
            ceilingCm: '',
            wish: '',
          },
        ],
      },
      planEditRevision(source.planUrl, source.planReading),
    )
    if (!result.ok) throw new Error(result.error)
    expect(result.data).toMatchObject({ created: 0, updated: 0 })
    const reopened = await getProject(owner, project.id)
    expect(reopened.planReading?.rooms).toHaveLength(10)
    expect(reopened.planReading?.rooms.find((room) => room.sourceNumber === 6)).toEqual({
      name: 'Спальня №06',
      kind: 'bedroom',
      sourceNumber: 6,
      dimensionSources: {},
    })
    expect(reopened.planReading?.pageReview?.sourceRooms).toHaveLength(10)
    expect(reopened.planReading?.geometry?.rooms).toEqual(expectedGeometry.rooms)
    expect(reopened.planReading?.geometry?.status).toBe('draft')
    expect(reopened.planReading?.geometry?.confirmedAt).toBeUndefined()
    expect(reopened.planReading?.ceilingCm).toBeUndefined()
    const confirmation = await savePlanGeometry(
      project.id,
      expectedGeometry,
      'confirm',
      result.data.revision,
    )
    expect(confirmation.ok).toBe(false)
    if (!confirmation.ok) expect(confirmation.error).toContain('№06')
    expect((await getProject(owner, project.id)).planReading).toEqual(reopened.planReading)
  })
})
