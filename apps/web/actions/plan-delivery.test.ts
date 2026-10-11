import {
  canonicalPlanDeliveryJson,
  inspectStoredPlanDelivery,
  samePlanDeliveryGeometry,
} from '@uyut/catalog/plan-delivery-record'
import type { PlanGeometry, PlanReading } from '@uyut/db'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { PlanEditConflictError, planEditRevision } from '@/lib/projects/plan-edit-revision'
import { serializeFurnitureDeliveryDraft } from '@/lib/projects/plan-furniture-delivery-archive'

const mocks = vi.hoisted(() => ({
  session: vi.fn(),
  owner: vi.fn(),
  collaborator: vi.fn(),
  save: vi.fn(),
  audit: vi.fn(),
  report: vi.fn(),
  request: vi.fn(),
}))
vi.mock('@/lib/session', () => ({ getSession: mocks.session }))
vi.mock('@/lib/projects/access', () => ({
  AccessError: class AccessError extends Error {},
  assertOwner: mocks.owner,
  assertOwnerOrCollaborator: mocks.collaborator,
}))
vi.mock('@/lib/projects/repository', () => ({ setPlanReading: mocks.save }))
vi.mock('@/lib/audit', () => ({ recordAudit: mocks.audit }))
vi.mock('next/cache', () => ({ revalidatePath: vi.fn() }))
vi.mock('next/headers', () => ({ headers: async () => new Headers() }))
vi.mock('@/lib/projects/plan-furniture-delivery-input', () => ({
  createFurnitureDeliveryRequest: mocks.request,
}))
vi.mock('@/lib/projects/plan-furniture-delivery-report', () => ({
  serializeFurnitureDeliveryReport: mocks.report,
}))

import { AccessError } from '@/lib/projects/access'
import { loadPlanDeliveryMeasurements, savePlanDeliveryMeasurements } from './plan-delivery'

const geometry: PlanGeometry = {
  version: 1,
  source: 'manual',
  status: 'draft',
  widthCm: 300,
  heightCm: 500,
  walls: [],
  openings: [],
  rooms: [
    {
      name: 'Гостиная',
      polygon: [
        { xCm: 0, yCm: 0 },
        { xCm: 300, yCm: 0 },
        { xCm: 300, yCm: 500 },
      ],
    },
  ],
  warnings: [],
}
const profileFields = {
  widthCm: '40',
  depthCm: '60',
  heightCm: '170',
  clearanceCm: '1',
  orientation: '0' as const,
}
const fields = {
  targetRoomId: '0',
  lowerFloorId: 'lower',
  upperFloorId: 'upper',
  direction: 'x' as const,
  travelDirection: 'up' as const,
  startCm: '0',
  crossStartCm: '0',
  widthCm: '120',
  lowerLandingLengthCm: '150',
  upperLandingLengthCm: '150',
  carryClearanceCm: '1',
  sourceReference: ' Обмер 11 октября ',
  tilt: 'none' as const,
  angleDeg: '0',
  steps: [],
}
const text = () => serializeFurnitureDeliveryDraft(geometry, profileFields, fields)
const reading: PlanReading = {
  rooms: [],
  readAt: '2026-10-11',
  geometry,
  deliveryMeasurements: {
    version: 1,
    savedAt: '2026-10-11T00:00:00.000Z',
    draftJson: 'old',
    reportJson: 'old',
  },
}
const project = { planUrl: 'plan.pdf', planReading: reading }
const revision = planEditRevision(project.planUrl, reading)

describe('account delivery measurements', () => {
  beforeEach(() => {
    vi.resetAllMocks()
    mocks.session.mockResolvedValue({ user: { id: 'owner' } })
    mocks.owner.mockResolvedValue(project)
    mocks.collaborator.mockResolvedValue(project)
    mocks.save.mockResolvedValue(undefined)
    mocks.request.mockReturnValue({ survey: {}, profile: {}, targetRoomId: '0' })
    mocks.report.mockReturnValue({ text: JSON.stringify(storedReport()) })
  })

  it('saves owner draft by CAS preserving reading and removes old report', async () => {
    const response = await savePlanDeliveryMeasurements('project', text(), revision)
    expect(response.ok).toBe(true)
    expect(mocks.owner).toHaveBeenCalledWith('owner', 'project')
    const saved = mocks.save.mock.calls[0]?.[2]
    expect(saved).toEqual({
      ...reading,
      deliveryMeasurements: expect.objectContaining({ version: 1, draftJson: text() }),
    })
    expect(saved.deliveryMeasurements.reportJson).toBeUndefined()
    expect(mocks.save.mock.calls[0]?.[3]).toBe(project)
    if (response.ok) expect(response.data.revision).toBe(planEditRevision('plan.pdf', saved))
    expect(mocks.report).not.toHaveBeenCalled()
  })

  it('rechecks on server and binds exact complete draft, never accepts report', async () => {
    const response = await savePlanDeliveryMeasurements('project', text(), revision, true)
    expect(response.ok).toBe(true)
    expect(mocks.request).toHaveBeenCalledWith(geometry, profileFields, fields, true)
    const stored = mocks.save.mock.calls[0]?.[2].deliveryMeasurements
    expect(JSON.parse(stored.reportJson)).toEqual(storedReport())
    if (response.ok) expect(response.data.record).not.toHaveProperty('reportJson')
    const forged = JSON.stringify({
      ...JSON.parse(text()),
      reportJson: 'client certificate',
      acknowledged: true,
    })
    mocks.save.mockClear()
    expect((await savePlanDeliveryMeasurements('project', forged, revision, true)).ok).toBe(false)
    expect(mocks.save).not.toHaveBeenCalled()
  })

  it('allows JSONB object reordering but not array/value changes', async () => {
    const reordered = JSON.parse(JSON.stringify(geometry))
    reordered.rooms[0] = Object.fromEntries(Object.entries(reordered.rooms[0]).reverse())
    mocks.owner.mockResolvedValue({ ...project, planReading: { ...reading, geometry: reordered } })
    expect((await savePlanDeliveryMeasurements('project', text(), revision)).ok).toBe(true)
    reordered.rooms[0].polygon.reverse()
    const updated = { ...reading, geometry: reordered }
    mocks.owner.mockResolvedValue({ ...project, planReading: updated })
    const result = await savePlanDeliveryMeasurements(
      'project',
      text(),
      planEditRevision('plan.pdf', updated),
    )
    expect(result).toMatchObject({ ok: false, code: 'plan-conflict' })
  })

  it('saves editor empty collections against legacy storage without allowing unknown/null values', async () => {
    const displayed = { ...geometry, obstacles: [], kitchenItems: [] }
    const editorText = serializeFurnitureDeliveryDraft(displayed, profileFields, fields)
    expect((await savePlanDeliveryMeasurements('project', editorText, revision)).ok).toBe(true)
    expect(samePlanDeliveryGeometry(geometry, displayed)).toBe(true)
    expect(samePlanDeliveryGeometry(geometry, { ...displayed, obstacles: null })).toBe(false)
    expect(samePlanDeliveryGeometry(geometry, { ...displayed, kitchenItems: null })).toBe(false)
    expect(samePlanDeliveryGeometry(geometry, { ...displayed, walls: null })).toBe(false)
    expect(samePlanDeliveryGeometry(geometry, { ...displayed, widthCm: 301 })).toBe(false)
  })

  it.each(['stale-revision', 'solver', 'database-cas', 'owner'])(
    'fails closed for %s',
    async (reason) => {
      if (reason === 'solver') mocks.report.mockReturnValue({ error: 'Маршрут не подтверждён' })
      if (reason === 'database-cas') mocks.save.mockRejectedValue(new PlanEditConflictError())
      if (reason === 'owner') mocks.owner.mockRejectedValue(new AccessError('Проект не найден'))
      const result = await savePlanDeliveryMeasurements(
        'project',
        text(),
        reason === 'stale-revision' ? 'old' : revision,
        true,
      )
      expect(result.ok).toBe(false)
      if (reason !== 'database-cas') expect(mocks.save).not.toHaveBeenCalled()
      expect(mocks.audit).not.toHaveBeenCalled()
    },
  )

  it.each(['{', JSON.stringify({}), 'x'.repeat(2 * 1024 * 1024 + 1)])(
    'rejects malformed/oversized draft without writing',
    async (input) => {
      expect((await savePlanDeliveryMeasurements('project', input, revision)).ok).toBe(false)
      expect(mocks.save).not.toHaveBeenCalled()
    },
  )

  it('rejects UTF8 oversized strings and nonboolean checked', async () => {
    expect((await savePlanDeliveryMeasurements('project', 'я'.repeat(1100000), revision)).ok).toBe(
      false,
    )
    expect(
      (await savePlanDeliveryMeasurements('project', text(), revision, 'yes' as unknown as boolean))
        .ok,
    ).toBe(false)
    expect(mocks.save).not.toHaveBeenCalled()
  })

  it('requires login for read/write; collaborator can read but not write', async () => {
    mocks.session.mockResolvedValue(null)
    expect((await savePlanDeliveryMeasurements('project', text(), revision)).ok).toBe(false)
    expect((await loadPlanDeliveryMeasurements('project')).ok).toBe(false)
    expect(mocks.owner).not.toHaveBeenCalled()
    mocks.session.mockResolvedValue({ user: { id: 'partner' } })
    expect(await loadPlanDeliveryMeasurements('project')).toEqual({
      ok: true,
      data: {
        revision,
        record: {
          version: reading.deliveryMeasurements?.version,
          savedAt: reading.deliveryMeasurements?.savedAt,
          draftJson: reading.deliveryMeasurements?.draftJson,
        },
      },
    })
    expect(mocks.collaborator).toHaveBeenCalledWith('partner', 'project')
    mocks.owner.mockRejectedValue(new AccessError('Только владелец'))
    expect((await savePlanDeliveryMeasurements('project', text(), revision)).ok).toBe(false)
    expect(mocks.save).not.toHaveBeenCalled()
  })
})

function storedReport() {
  const draft = JSON.parse(text())
  const point = { xCm: 100, yCm: 100, zCm: 0 }
  const polygon = geometry.rooms[0]?.polygon ?? []
  return {
    kind: 'domitsa-furniture-delivery-report',
    version: 1,
    units: 'cm',
    coordinateSystem: 'cm',
    limitations: [],
    geometry,
    request: {
      profile: { widthCm: 40, depthCm: 60, heightCm: 170, clearanceCm: 1, orientation: 0 },
      targetRoomId: '0',
      survey: {
        geometryKey: draft.geometryKey,
        referenceKey: draft.referenceKey,
        acknowledged: true,
        source: { kind: 'site-measurement', reference: fields.sourceReference.trim() },
      },
    },
    scope: { completeRoute: true, exteriorChecked: false, leavesChecked: false },
    result: {
      points: [point],
      targetRoomId: '0',
      checkedNodes: 3,
      segments: { entry: [point], stairs: [point], exit: [point] },
      stairs: {
        referenceId: 'ref',
        travelDirection: 'up',
        tilt: 'none',
        angleDeg: 0,
        carried: { widthCm: 40, depthCm: 60, heightCm: 170 },
        sweepHeightCm: 170,
        points: [point],
        regions: Array.from({ length: 3 }, (_, index) => ({
          index,
          kind: 'landing',
          polygon,
          elevationCm: 0,
          ceilingElevationCm: 300,
        })),
        stages: [
          {
            kind: 'translate',
            from: point,
            to: point,
            bounds: {
              leftCm: 50,
              topCm: 50,
              rightCm: 150,
              bottomCm: 150,
              bottomElevationCm: 0,
              topElevationCm: 170,
            },
          },
        ],
      },
    },
    notes: ['Не гарантия доставки'],
    savedDraftKey: canonicalPlanDeliveryJson(draft),
  }
}

describe('stored delivery presentation', () => {
  function record(report = storedReport()) {
    return {
      version: 1 as const,
      savedAt: '2026-10-11T12:00:00.000Z',
      draftJson: text(),
      reportJson: JSON.stringify(report),
    }
  }
  it('reads strict bounded current server snapshot', () => {
    expect(inspectStoredPlanDelivery(geometry, record())).toMatchObject({
      status: 'checked',
      targetRoomName: 'Гостиная',
      exteriorChecked: false,
    })
    expect(inspectStoredPlanDelivery(geometry, undefined)).toBeUndefined()
    expect(
      inspectStoredPlanDelivery(geometry, { ...record(), reportJson: undefined }),
    ).toMatchObject({ status: 'held' })
  })
  it('canonical comparison preserves arrays and rejects changed furniture/stairs draft linkage', () => {
    expect(samePlanDeliveryGeometry({ b: 2, a: [1, 2] }, { a: [1, 2], b: 2 })).toBe(true)
    expect(samePlanDeliveryGeometry([1, 2], [2, 1])).toBe(false)
    const changed = JSON.parse(text())
    changed.fields.widthCm = '999'
    expect(
      inspectStoredPlanDelivery(geometry, { ...record(), draftJson: JSON.stringify(changed) }),
    ).toMatchObject({ status: 'held' })
    expect(inspectStoredPlanDelivery({ ...geometry, widthCm: 301 }, record())).toMatchObject({
      status: 'held',
    })
  })
  it.each(['points', 'bounds', 'profile', 'target', 'scope', 'timestamp', 'binding'])(
    'holds malformed %s',
    (kind) => {
      const report = storedReport()
      const firstPoint = report.result.points[0]
      const firstStage = report.result.stairs.stages[0]
      if (!firstPoint || !firstStage) throw new Error('Incomplete test fixture')
      if (kind === 'points') firstPoint.xCm = Number.POSITIVE_INFINITY
      if (kind === 'bounds') firstStage.bounds.rightCm = 0
      if (kind === 'profile') report.request.profile.widthCm = 41
      if (kind === 'target') report.result.targetRoomId = '1'
      if (kind === 'scope') report.scope.exteriorChecked = true
      if (kind === 'binding') report.savedDraftKey = '{}'
      const input = record(report)
      if (kind === 'timestamp') input.savedAt = 'invalid'
      expect(inspectStoredPlanDelivery(geometry, input)).toMatchObject({ status: 'held' })
    },
  )
})
