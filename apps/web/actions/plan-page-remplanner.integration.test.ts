import { createHash, randomUUID } from 'node:crypto'
import { readFile, writeFile } from 'node:fs/promises'
import { type PlanPageContours, type PlanReading, users } from '@uyut/db'
import { renderProjectHtml } from '@uyut/pdf'
import { eq } from 'drizzle-orm'
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest'
import { getDb } from '@/lib/db'
import { preparePlanPage } from '@/lib/projects/plan-document'
import { planEditRevision } from '@/lib/projects/plan-edit-revision'
import { nativeFillCandidates } from '@/lib/projects/plan-native-fill-candidates'
import { nativeRoomScheduleEvidence } from '@/lib/projects/plan-native-room-schedule'
import { currentWallFacePairs } from '@/lib/projects/plan-opening-face-pairs'
import {
  openingMeasurementSnapshot,
  openingMeasurementWallSnapshot,
} from '@/lib/projects/plan-opening-measurements'
import type { PagePoint } from '@/lib/projects/plan-pdf-linework'
import { sourceOuterWallGaps } from '@/lib/projects/plan-pdf-outer-wall-gaps'
import { planVolume, planVolumeBlocker } from '@/lib/projects/plan-volume'
import {
  createProject,
  getProject,
  setPlanReading,
  setProjectPlan,
} from '@/lib/projects/repository'
import { buildPdfData, loadSnapshot } from '../../../jobs/src/lib/pdf-data'
import { createPlanPageGeometryDraft } from './plan-page-geometry'
import { savePlanPageReview } from './plan-page-review'
import {
  getPlanWallReviewCandidates,
  revokePlanWallReview,
  savePlanWallReview,
} from './plan-wall-review'
import { savePlanGeometry } from './projects'

const local = vi.hoisted(() => ({ owner: '', body: Buffer.alloc(0) }))
vi.mock('server-only', () => ({}))
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

// A person's manual review of Remplanner sheet 4, traced on PDF nodes. Corridor №1 and
// the outer side of walls are hand traces for this run, not recognised geometry. The
// run never supplies a floor level, threshold or height that the sheet does not print.
// Round the balcony too: the outer side of walls must hold every listed room.
const exterior = [
  [112.601, 114.869],
  [670.764, 115.574],
  [670.764, 386.44],
  [573.892, 386.44],
  [573.892, 629.775],
  [439.413, 629.775],
  [439.413, 863.977],
  [112.601, 863.977],
]
// Inner face of the bearing walls, round the riser niche. It crosses the entrance
// doorway along the wall face and the balcony doorway too: that second crossing has
// no painted jamb pair, because the balcony block is a door beside a window.
const floorAcrossBalconyDoor = [
  [182.01, 137.441],
  [652.93, 137.441],
  [652.93, 364.572],
  [470.249, 364.572],
  [470.249, 422.412],
  [549.78, 422.412],
  [549.78, 386.44],
  [564.251, 386.44],
  [564.251, 607.907],
  [429.773, 607.907],
  [429.773, 796.263],
  [348.313, 796.263],
  [348.313, 842.11],
  [131.881, 842.11],
  [131.881, 386.44],
  [182.01, 386.44],
]
// The listed balcony is part of the floor: the boundary passes through the balcony
// doorway along both drawn jambs and round the balcony. Only the entrance gap is left.
const floor = [
  ...floorAcrossBalconyDoor,
  [182.01, 322.955],
  [162.73, 322.955],
  [162.73, 354.698],
  [115.493, 354.698],
  [115.493, 115.574],
  [162.73, 115.574],
  [162.73, 259.471],
  [182.01, 259.471],
]
const corridor = [
  [342.037, 379.384],
  [470.249, 379.384],
  [470.249, 607.907],
  [429.773, 607.907],
  [429.773, 704.545],
  [342.037, 704.545],
]
const bathroom = [
  [474.118, 422.412],
  [549.78, 422.412],
  [549.78, 386.44],
  [564.251, 386.44],
  [564.251, 607.907],
  [474.118, 607.907],
]
const toilet = [
  [336.253, 710.207],
  [429.773, 710.207],
  [429.773, 796.263],
  [348.313, 796.263],
  [348.313, 842.11],
  [336.253, 842.11],
]
const points = (ring: number[][]) => ring.map(([x, y]) => ({ x, y }) as PagePoint)

const enabled = Boolean(process.env.QA_REMPLANNER_PDF)
describe.skipIf(!enabled)('Remplanner sheet 4 through actions and PostgreSQL', () => {
  let owner = ''
  let reading: PlanReading
  let reviewed: PlanPageContours

  beforeAll(async () => {
    const databaseUrl = new URL(process.env.DATABASE_URL ?? '')
    if (!['127.0.0.1', 'localhost', '[::1]'].includes(databaseUrl.hostname))
      throw new Error('Remplanner QA requires a local PostgreSQL database')
    local.body = await readFile(process.env.QA_REMPLANNER_PDF as string)
    const sha256 = createHash('sha256').update(local.body).digest('hex')
    expect(sha256).toBe('d04de01407f66521282deea2eca5bfca84495bec7652a5eaeae836575e2fcfd5')
    const page = await preparePlanPage(local.body, true, 4, true, true)
    if (!page.linework || !page.nativeTextAnchors || !page.lineworkRasterSource)
      throw new Error('Remplanner sheet 4 has no complete native layer')
    const input = {
      native: page.nativeTextAnchors,
      work: page.linework,
      lineworkSource: page.lineworkRasterSource,
    }
    const fills = nativeFillCandidates(input).candidates
    const fill = (id: string) => {
      const found = fills.find((candidate) => candidate.id === id)
      if (!found) throw new Error(`Missing source fill ${id}`)
      return found.polygon.map((point) => ({ ...point }))
    }
    const nativeNodes = new Set(
      page.linework.paths.flatMap((path) => path.points.map((point) => `${point.x}:${point.y}`)),
    )
    for (const point of [...exterior, ...floor, ...corridor, ...bathroom, ...toilet])
      if (!nativeNodes.has(`${point[0]}:${point[1]}`))
        throw new Error(`Manual trace point ${point} is not a PDF node`)
    const bedroom = fill('native-fill-333:0')
    const bedroomEdge = bedroom.findIndex(
      (point, index) => point.x === 182.01 && bedroom[(index + 1) % bedroom.length]?.x === 182.01,
    )
    const ordered = (ring: PagePoint[], edge: number, a: PagePoint, b: PagePoint) => {
      const from = ring[edge] as PagePoint
      const to = ring[(edge + 1) % ring.length] as PagePoint
      return (b.x - a.x) * (to.x - from.x) + (b.y - a.y) * (to.y - from.y) >= 0
        ? { start: a, end: b }
        : { start: b, end: a }
    }
    const hall = points(corridor)
    const hallEdge = 3
    reviewed = {
      source: { sha256, pdfPage: 4, state: 'existing' },
      coordinateSystem: 'page-0-1000',
      review: 'manual-source-review',
      pageWidth: page.linework.pageWidth,
      pageHeight: page.linework.pageHeight,
      exterior: { boundaryRole: 'outer-wall-envelope', polygon: points(exterior) },
      floor: { polygon: points(floor) },
      rooms: [
        {
          roomSourceNumber: 1,
          polygon: hall,
          openings: [
            {
              id: 'entry',
              kind: 'door',
              wallEdgeIndex: hallEdge,
              ...ordered(hall, hallEdge, { x: 429.773, y: 629.775 }, { x: 429.773, y: 704.545 }),
            },
          ],
        },
        { roomSourceNumber: 2, polygon: fill('native-fill-323:0') },
        { roomSourceNumber: 3, polygon: fill('native-fill-328:0') },
        {
          roomSourceNumber: 4,
          polygon: bedroom,
          openings: [
            {
              id: 'balcony-door',
              kind: 'balcony',
              wallEdgeIndex: bedroomEdge,
              ...ordered(
                bedroom,
                bedroomEdge,
                { x: 182.01, y: 259.471 },
                { x: 182.01, y: 322.955 },
              ),
            },
          ],
        },
        { roomSourceNumber: 5, polygon: fill('native-fill-1563:0') },
        { roomSourceNumber: 6, polygon: points(bathroom) },
        { roomSourceNumber: 7, polygon: points(toilet) },
        { roomSourceNumber: 8, polygon: fill('native-fill-1286:0') },
      ],
    }
    const schedule = nativeRoomScheduleEvidence(input)
    expect(schedule.rows.map((row) => row.sourceNumber)).toEqual([1, 2, 3, 4, 5, 6, 7, 8])
    reading = {
      sourcePage: 4,
      planState: 'existing',
      readAt: '2026-10-23',
      confirmedAt: '2026-10-23T00:00:00.000Z',
      rooms: schedule.rows.map((row) => ({
        sourceNumber: row.sourceNumber,
        name: row.name,
        kind: 'living' as const,
      })),
    }
    const [user] = await getDb()
      .insert(users)
      .values({ email: `remplanner-chain-${randomUUID()}@example.test`, displayName: 'QA' })
      .returning({ id: users.id })
    if (!user) throw new Error('Local QA user was not created')
    owner = user.id
    local.owner = owner
  })

  afterAll(async () => {
    if (owner) await getDb().delete(users).where(eq(users.id, owner))
  })

  async function freshProject(title: string) {
    const project = await createProject(owner, { title })
    await setProjectPlan(owner, project.id, 'qa/remplanner-interior.pdf', project)
    await setPlanReading(owner, project.id, reading, await getProject(owner, project.id))
    const ready = await getProject(owner, project.id)
    return { id: project.id, ready, revision: planEditRevision(ready.planUrl, ready.planReading) }
  }

  it.skipIf(!process.env.QA_REMPLANNER_PROPOSED_PDF)(
    'saves and reopens the real proposed wardrobe with a native page scale and its door',
    async () => {
      const previousBody = local.body
      try {
        local.body = await readFile(process.env.QA_REMPLANNER_PROPOSED_PDF as string)
        const sha256 = createHash('sha256').update(local.body).digest('hex')
        expect(sha256).toBe('534b78f2ef68bf7e9d9f2b515b15e61510e1c427208bc46a9b17234298740fab')
        const { id, ready } = await freshProject('Real proposed Remplanner wardrobe')
        const proposed: PlanReading = {
          sourcePage: 2,
          planState: 'proposed',
          readAt: '2026-10-25T00:00:00.000Z',
          confirmedAt: '2026-10-25T00:00:00.000Z',
          rooms: [{ sourceNumber: 5, name: 'Гардеробная комната', kind: 'living', areaM2: 3.64 }],
        }
        await setPlanReading(owner, id, proposed, ready)
        const before = await getProject(owner, id)
        const page = await preparePlanPage(local.body, true, 2, true, true)
        if (!page.linework) throw new Error('Missing real proposed native layer')
        // Manual source review of the four wall-face corners and the drawn jambs.
        // No cabinet boundary is substituted for an apartment floor or exterior.
        const contours: PlanPageContours = {
          source: { sha256, pdfPage: 2, state: 'proposed' },
          coordinateSystem: 'page-0-1000',
          review: 'manual-source-review',
          pageWidth: page.linework.pageWidth,
          pageHeight: page.linework.pageHeight,
          rooms: [
            {
              roomSourceNumber: 5,
              polygon: points([
                [336.975, 137.441],
                [427.844, 137.441],
                [427.844, 272.873],
                [336.975, 272.873],
              ]),
              openings: [
                {
                  id: 'wardrobe-door',
                  kind: 'door',
                  wallEdgeIndex: 2,
                  start: { x: 399.251, y: 272.873 },
                  end: { x: 365.51, y: 272.873 },
                },
              ],
            },
          ],
        }
        expect(page.linework.truncated).toBe(false)
        expect(page.linework.paths.length).toBe(11136)
        const review = await savePlanPageReview(
          id,
          contours,
          planEditRevision(before.planUrl, before.planReading),
        )
        if (!review.ok) throw new Error(review.error)
        const draft = await createPlanPageGeometryDraft(
          id,
          [5],
          review.data.revision,
          undefined,
          false,
          false,
          true,
        )
        if (!draft.ok) throw new Error(draft.error)
        expect(draft.data.geometry.pdfCalibration).toMatchObject({
          sourceState: 'proposed',
          pdfPage: 2,
          pageScale: { chainCounts: { x: 3, y: 3 } },
        })
        expect(draft.data.geometry.pdfCalibration?.cmPerPoint).toBeCloseTo(1.74260318, 7)
        expect(draft.data.geometry.rooms).toHaveLength(1)
        expect(draft.data.geometry.walls).toHaveLength(4)
        expect(draft.data.geometry.openings).toMatchObject([{ type: 'door', widthCm: 70 }])
        expect(draft.data.geometry.footprint).toBeUndefined()
        expect(draft.data.geometry.verticalReference).toBeUndefined()
        const saved = await savePlanGeometry(id, draft.data.geometry, 'draft', draft.data.revision)
        if (!saved.ok) throw new Error(saved.error)
        expect((await getProject(owner, id)).planReading?.geometry).toEqual(saved.data.geometry)
        expect(
          (await savePlanGeometry(id, saved.data.geometry, 'confirm', saved.data.revision)).ok,
        ).toBe(false)
        const snapshot = await loadSnapshot(id)
        if (!snapshot) throw new Error('Missing proposed project snapshot')
        const pdf = await buildPdfData({
          snapshot,
          kind: 'free',
          options: {},
          rates: { roughRubPerM2: 15_000, finishRubPerM2: 5_000 },
          brief: null,
          summary: null,
        })
        expect(
          pdf.project.facts.some((fact) => fact.value.includes('Проектное состояние, страница 2')),
        ).toBe(true)
        expect(pdf.verticalPlan).toBeUndefined()
      } finally {
        local.body = previousBody
      }
    },
  )

  it('persists a proposed-state control through the same actions without allowing as-built confirmation', async () => {
    // State isolation control on the same real source coordinates. This does not
    // claim that sheet 4 is the album's proposed nine-room layout.
    const { id, ready } = await freshProject('Proposed-state persistence control')
    const proposedReading = { ...structuredClone(reading), planState: 'proposed' as const }
    await setPlanReading(owner, id, proposedReading, ready)
    const before = await getProject(owner, id)
    const contours = structuredClone(reviewed)
    contours.source.state = 'proposed'
    const review = await savePlanPageReview(
      id,
      contours,
      planEditRevision(before.planUrl, before.planReading),
    )
    if (!review.ok) throw new Error(review.error)
    const draft = await createPlanPageGeometryDraft(
      id,
      [1, 2, 3, 4, 5, 6, 7, 8],
      review.data.revision,
      undefined,
      false,
      false,
      true,
    )
    if (!draft.ok) throw new Error(draft.error)
    expect(draft.data.geometry.pdfCalibration?.sourceState).toBe('proposed')
    expect(draft.data.geometry.status).toBe('draft')
    const reopened = await getProject(owner, id)
    expect(reopened.planReading?.geometry).toEqual(draft.data.geometry)
    const saved = await savePlanGeometry(id, draft.data.geometry, 'draft', draft.data.revision)
    if (!saved.ok) throw new Error(saved.error)
    expect((await getProject(owner, id)).planReading?.geometry?.pdfCalibration?.sourceState).toBe(
      'proposed',
    )
    expect(
      await savePlanGeometry(
        id,
        { ...saved.data.geometry, pdfCalibration: undefined },
        'confirm',
        saved.data.revision,
      ),
    ).toMatchObject({ ok: false, error: expect.stringContaining('Проектный 2D-черновик') })
    expect(planVolume({ ...saved.data.geometry, status: 'confirmed' })).toBeNull()
  })

  it('refuses a floor that leaves out the balcony or crosses its unproven doorway', async () => {
    const { id, ready, revision } = await freshProject('Remplanner floor refusals')
    const across = { ...reviewed, floor: { polygon: points(floorAcrossBalconyDoor) } }
    // Every listed room must stand on the reviewed floor, the balcony included.
    const outside = await savePlanPageReview(id, across, revision)
    expect(outside).toMatchObject({ ok: false })
    if (!outside.ok) expect(outside.error).toContain('выходит за границу пола')
    // Without the balcony room the gap itself is named, with the reason it stays open.
    const gap = await savePlanPageReview(
      id,
      { ...across, rooms: across.rooms.filter((room) => room.roomSourceNumber !== 8) },
      revision,
    )
    expect(gap).toMatchObject({ ok: false })
    if (!gap.ok) {
      expect(gap.error).toContain(
        'между 16-м и 1-м углами, от 182.01, 322.95 до 182.01, 259.47 (проём отмечен',
      )
      // The entrance gap is closed by its paired source jambs and is not reported.
      expect(gap.error).not.toContain('429.77')
    }
    expect((await getProject(owner, id)).planReading).toEqual(ready.planReading)
  })

  it('saves and reopens the reviewed floor; confirmation and 3D stop on named blockers', async () => {
    const { id, revision } = await freshProject('Remplanner reviewed floor chain')
    const saved = await savePlanPageReview(id, reviewed, revision)
    if (!saved.ok) throw new Error(saved.error)
    const reopened = await getProject(owner, id)
    const contours = reopened.planReading?.pageReview?.contours
    expect(contours?.exterior).toEqual(reviewed.exterior)
    expect(contours?.floor).toEqual(reviewed.floor)
    expect(contours?.rooms.map((room) => room.roomSourceNumber)).toEqual([1, 2, 3, 4, 5, 6, 7, 8])
    expect(contours?.rooms.flatMap((room) => room.openings ?? []).map((item) => item.id)).toEqual([
      'entry',
      'balcony-door',
    ])

    const draft = await createPlanPageGeometryDraft(
      id,
      [1, 2, 3, 4, 5, 6, 7, 8],
      saved.data.revision,
      undefined,
      false,
      false,
      true,
    )
    if (!draft.ok) throw new Error(draft.error)
    const geometry = draft.data.geometry
    expect(geometry.status).toBe('draft')
    expect(geometry.footprint).toHaveLength(floor.length)
    expect(geometry.verticalReference).toBeUndefined()
    expect(geometry.pdfCalibration?.exteriorBoundaryRole).toBe('outer-wall-envelope')
    expect(geometry.pdfCalibration?.pageScale).toBeDefined()
    expect(geometry.rooms).toHaveLength(8)
    expect(geometry.pdfCalibration?.sourceWallFacePairs).toHaveLength(8)
    expect(
      geometry.pdfCalibration?.sourceWallFacePairs?.every((pair) =>
        pair.faces.every((face) => face.wall.kind !== 'outer'),
      ),
    ).toBe(true)
    const sourceGaps = sourceOuterWallGaps(geometry, contours, currentWallFacePairs(geometry))
    expect(sourceGaps).toHaveLength(exterior.length)
    expect(sourceGaps[0]).toMatchObject({
      edgeIndex: 0,
      start: { x: exterior[0]?.[0], y: exterior[0]?.[1] },
      end: { x: exterior[1]?.[0], y: exterior[1]?.[1] },
    })
    expect((await getProject(owner, id)).planReading?.geometry).toEqual(geometry)

    // Both widths are printed on the sheet (1060 and 900 mm). A person checks the
    // transferred widths against those prints; nothing is typed in to match them.
    const printed = { door: 106, balcony: 90, window: undefined }
    expect(geometry.openings.map((opening) => opening.type).sort()).toEqual(['balcony', 'door'])
    const requests = geometry.openings.map((opening) => {
      expect(opening.widthCm).toBe(printed[opening.type])
      const wall = geometry.walls.find((item) => item.id === opening.wallId)
      if (!wall) throw new Error('Opening host wall is missing')
      return {
        action: 'verify' as const,
        opening: openingMeasurementSnapshot(opening),
        wall: openingMeasurementWallSnapshot(wall),
        source: {
          kind: 'dimensioned-drawing' as const,
          reference: 'Remplanner, обмерный план, лист 4: размерные цепи проёмов 1060 и 900 мм',
        },
        acknowledged: true as const,
      }
    })
    const checked = await savePlanGeometry(
      id,
      { ...geometry, openingMeasurementRequests: requests },
      'draft',
      draft.data.revision,
    )
    if (!checked.ok) throw new Error(checked.error)
    const confirmed = await savePlanGeometry(
      id,
      checked.data.geometry,
      'confirm',
      checked.data.revision,
    )
    // Room faces and the outer side of walls are linked only by source face pairs of one
    // wall body. This sheet gives such pairs between rooms only, so confirmation refuses
    // rather than joining faces with invented lines.
    expect(confirmed).toMatchObject({ ok: false })
    if (!confirmed.ok)
      expect(confirmed.error).toContain(
        'Внутренние и наружные грани не связаны исходными парами одного тела стены',
      )
    const pairs = checked.data.geometry.pdfCalibration?.sourceWallFacePairs ?? []
    const outerIds = new Set(
      checked.data.geometry.walls.filter((wall) => wall.kind === 'outer').map((wall) => wall.id),
    )
    expect(pairs.length).toBeGreaterThan(0)
    expect(pairs.some((pair) => pair.faces.some(({ wall }) => outerIds.has(wall.id)))).toBe(false)
    const stored = (await getProject(owner, id)).planReading?.geometry
    if (!stored) throw new Error('Draft geometry was not stored')
    expect(stored).toEqual(checked.data.geometry)
    expect(stored.status).toBe('draft')
    expect(stored.footprint).toEqual(geometry.footprint)
    // Neither the draft nor a reviewed floor is a level: no conditional zero makes 3D.
    expect(stored.verticalReference).toBeUndefined()
    expect(planVolume(stored)).toBeNull()
    expect(planVolumeBlocker(stored)).toContain('подтверждённой 2D-схеме')
    expect(planVolumeBlocker({ ...stored, status: 'confirmed' })).toContain(
      'Нужен общий отсчёт высот',
    )

    const snapshot = await loadSnapshot(id)
    if (!snapshot) throw new Error('Project snapshot was not loaded')
    const pdf = await buildPdfData({
      snapshot,
      kind: 'free',
      options: {},
      rates: { roughRubPerM2: 15_000, finishRubPerM2: 5_000 },
      brief: null,
      summary: null,
    })
    expect(pdf.verticalPlan).toBeUndefined()
    const html = renderProjectHtml(pdf, { fontCss: '' })
    expect(html).not.toContain('data-project-floor=')
    expect(html).not.toContain('data-signed-room-floor=')
  })

  it('saves an explicit human wall review and carries its provenance through 2D and PDF', async () => {
    const { id, revision } = await freshProject('Remplanner human wall review')
    const saved = await savePlanPageReview(id, reviewed, revision)
    if (!saved.ok) throw new Error(saved.error)
    const draft = await createPlanPageGeometryDraft(
      id,
      [1, 2, 3, 4, 5, 6, 7, 8],
      saved.data.revision,
      undefined,
      false,
      false,
      true,
    )
    if (!draft.ok) throw new Error(draft.error)
    const offered = await getPlanWallReviewCandidates(id, draft.data.revision)
    if (!offered.ok) throw new Error(offered.error)
    const candidate = offered.data.candidates.find(
      (candidate) =>
        candidate.pair.faces.some((face) => face.contourKey === '5') &&
        candidate.pair.faces.some((face) => face.contourKey === 'exterior'),
    )
    if (!candidate) throw new Error('No source-backed room/exterior pair was offered for review')
    expect(candidate.visibilityIssues.length).toBeGreaterThan(0)
    const accepted = await savePlanWallReview(
      id,
      { candidateId: candidate.id, acknowledged: true },
      draft.data.revision,
    )
    if (!accepted.ok) throw new Error(accepted.error)
    const reopened = await getProject(owner, id)
    const geometry = reopened.planReading?.geometry
    if (!geometry) throw new Error('Missing saved geometry')
    expect(geometry).toEqual(accepted.data.reading.geometry)
    const human = currentWallFacePairs(geometry).filter(
      (pair) => pair.verification?.kind === 'human-source-review',
    )
    expect(human).toHaveLength(1)
    expect(human[0]?.faces.map((face) => face.nativeSegment.operationIndex)).toEqual(
      candidate.pair.faces.map((face) => face.nativeSegment.operationIndex),
    )
    expect(geometry.verticalReference).toBeUndefined()
    const requests = geometry.openings.map((opening) => {
      const wall = geometry.walls.find((wall) => wall.id === opening.wallId)
      if (!wall) throw new Error('Missing opening wall')
      return {
        action: 'verify' as const,
        opening: openingMeasurementSnapshot(opening),
        wall: openingMeasurementWallSnapshot(wall),
        source: {
          kind: 'dimensioned-drawing' as const,
          reference: 'Remplanner, лист 4: напечатанные 1060 и 900 мм',
        },
        acknowledged: true as const,
      }
    })
    const checked = await savePlanGeometry(
      id,
      { ...geometry, openingMeasurementRequests: requests },
      'draft',
      accepted.data.revision,
    )
    if (!checked.ok) throw new Error(checked.error)
    const confirmed = await savePlanGeometry(
      id,
      checked.data.geometry,
      'confirm',
      checked.data.revision,
    )
    expect(confirmed.ok).toBe(false)
    if (!confirmed.ok) expect(confirmed.error).toContain('отрезков вне общей связи: 34')
    expect(
      currentWallFacePairs(checked.data.geometry).some(
        (pair) => pair.verification?.kind === 'human-source-review',
      ),
    ).toBe(true)
    expect(planVolume(checked.data.geometry)).toBeNull()
    expect(planVolumeBlocker({ ...checked.data.geometry, status: 'confirmed' })).toContain(
      'Нужен общий отсчёт высот',
    )
    const snapshot = await loadSnapshot(id)
    if (!snapshot) throw new Error('Missing PDF snapshot')
    const pdf = await buildPdfData({
      snapshot,
      kind: 'free',
      options: {},
      rates: { roughRubPerM2: 15_000, finishRubPerM2: 5_000 },
      brief: null,
      summary: null,
    })
    expect(pdf.wallFaceReview?.humanReviewedPairs).toBe(1)
    expect(renderProjectHtml(pdf, { fontCss: '' })).toContain('сверено человеком')
    if (process.env.QA_HUMAN_WALL_PDF) {
      const { printPdf } = await import('../../../jobs/src/lib/print-pdf')
      await writeFile(
        process.env.QA_HUMAN_WALL_PDF,
        await printPdf(renderProjectHtml(pdf, { fontCss: '' }), pdf.project.title),
      )
    }
    const offeredAgain = await getPlanWallReviewCandidates(id, checked.data.revision)
    if (!offeredAgain.ok) throw new Error(offeredAgain.error)
    expect(offeredAgain.data.candidates.some((option) => option.id === candidate.id)).toBe(false)
    const reviewId = offeredAgain.data.reviews?.[0]?.id
    if (!reviewId) throw new Error('Missing saved human review')
    const revoked = await revokePlanWallReview(id, { reviewId }, checked.data.revision)
    if (!revoked.ok) throw new Error(revoked.error)
    const afterRevoke = (await getProject(owner, id)).planReading?.geometry
    if (!afterRevoke) throw new Error('Missing revoked geometry')
    expect(currentWallFacePairs(afterRevoke).filter((pair) => pair.verification)).toEqual([])
    expect(afterRevoke.pdfCalibration?.sourceWallFacePairs).toHaveLength(8)
    expect(afterRevoke.walls).toEqual(checked.data.geometry.walls)
    expect(afterRevoke.verticalReference).toBeUndefined()
  })
})
