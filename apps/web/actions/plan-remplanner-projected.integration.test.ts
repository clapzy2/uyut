import { createHash, randomUUID } from 'node:crypto'
import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { projectedFloorPreview } from '@uyut/catalog/plan-projected-floor-preview'
import { currentProjectedVerticalEvidence } from '@uyut/catalog/plan-projected-vertical-evidence'
import { type PlanPageContours, type PlanReading, type RoomKind, roomKinds, users } from '@uyut/db'
import { fontFaceCss, renderProjectHtml } from '@uyut/pdf'
import { eq } from 'drizzle-orm'
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest'
import { getDb } from '@/lib/db'
import { preparePlanPage } from '@/lib/projects/plan-document'
import { planEditRevision } from '@/lib/projects/plan-edit-revision'
import { planPageGeometryElementId } from '@/lib/projects/plan-page-metric-draft'
import { floorEdgeGaps } from '@/lib/projects/plan-page-review'
import { planVolume } from '@/lib/projects/plan-volume'
import {
  createProject,
  getProject,
  setPlanReading,
  setProjectPlan,
} from '@/lib/projects/repository'
import fixture from '../../../docs/qa/fixtures/remplanner-proposed-rooms-levels.json'
import { buildPdfData, loadSnapshot } from '../../../jobs/src/lib/pdf-data'
import { createPlanPageGeometryDraft } from './plan-page-geometry'
import { savePlanPageReview } from './plan-page-review'
import {
  reviewProjectedFloorContour,
  saveProjectedVerticalEvidence,
} from './plan-projected-evidence'
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

function point(pair: number[]) {
  const [x, y] = pair
  if (x === undefined || y === undefined) throw new Error('Incomplete source point')
  return { x, y }
}
function contours(): PlanPageContours {
  return {
    source: { ...fixture.source, state: 'proposed' },
    coordinateSystem: 'page-0-1000',
    review: 'manual-source-review',
    pageWidth: fixture.pageWidth,
    pageHeight: fixture.pageHeight,
    floor: {
      polygon: fixture.floor.points.map(point),
      scope: { ...fixture.floor.scope, kind: 'partial' },
    },
    rooms: fixture.regions.map((region) => {
      const number = region.numbers[0]
      if (number === undefined) throw new Error('Missing room identity')
      return {
        ...(region.numbers.length === 1
          ? { roomSourceNumber: number }
          : { roomSourceNumbers: region.numbers }),
        polygon: region.points.map(point),
        openings: region.openings.map((opening) => {
          const [start, end] = opening.points.map(point)
          if (!start || !end || opening.kind !== 'door') throw new Error('Invalid door fixture')
          return { id: opening.id, kind: 'door' as const, wallEdgeIndex: opening.edge, start, end }
        }),
      }
    }),
  }
}

describe.skipIf(!process.env.QA_REMPLANNER_PROPOSED_PDF)(
  'nine proposed Remplanner rooms through PostgreSQL and source evidence',
  () => {
    beforeAll(async () => {
      const url = new URL(process.env.DATABASE_URL ?? '')
      if (!['127.0.0.1', 'localhost', '[::1]'].includes(url.hostname))
        throw new Error('Local PostgreSQL only')
      local.body = await readFile(process.env.QA_REMPLANNER_PROPOSED_PDF as string)
      expect(createHash('sha256').update(local.body).digest('hex')).toBe(fixture.source.sha256)
      const [owner] = await getDb()
        .insert(users)
        .values({ email: `proposed-levels-${randomUUID()}@example.test`, displayName: 'QA' })
        .returning({ id: users.id })
      if (!owner) throw new Error('Local owner missing')
      local.owner = owner.id
    })
    afterAll(async () => {
      if (local.owner) await getDb().delete(users).where(eq(users.id, local.owner))
    })
    it('keeps all nine identities, a partial free floor, source-scoped heights and every hold after reopening', async () => {
      const created = await createProject(local.owner, {
        title: 'Remplanner proposed full draft QA',
      })
      await setProjectPlan(local.owner, created.id, 'qa/remplanner-proposed.pdf', created)
      const rooms: PlanReading['rooms'] = fixture.rooms.map((room) => {
        if (!roomKinds.includes(room.kind as RoomKind)) throw new Error('Unknown fixture kind')
        return { ...room, kind: room.kind as RoomKind }
      })
      const reading: PlanReading = {
        sourcePage: 2,
        planState: 'proposed',
        readAt: '2026-10-25',
        confirmedAt: '2026-10-25T00:00:00.000Z',
        rooms,
      }
      await setPlanReading(
        local.owner,
        created.id,
        reading,
        await getProject(local.owner, created.id),
      )
      let project = await getProject(local.owner, created.id)
      const page = await preparePlanPage(local.body, true, 2, true, true)
      if (!page.linework) throw new Error('Missing native door page')
      expect(floorEdgeGaps(contours(), page.linework)).toEqual([])
      const review = await savePlanPageReview(
        created.id,
        contours(),
        planEditRevision(project.planUrl, project.planReading),
      )
      if (!review.ok) throw new Error(review.error)
      const draft = await createPlanPageGeometryDraft(
        created.id,
        [1, 2, 3, 4, 5, 6, 7, 8, 9],
        review.data.revision,
        undefined,
        false,
        false,
        true,
      )
      if (!draft.ok) throw new Error(draft.error)
      expect(draft.data.geometry.rooms).toHaveLength(7)
      expect(
        draft.data.geometry.rooms
          .flatMap((room) => room.sourceNumbers ?? [room.sourceNumber])
          .sort((a, b) => (a ?? 0) - (b ?? 0)),
      ).toEqual([1, 2, 3, 4, 5, 6, 7, 8, 9])
      expect(draft.data.geometry.footprint).toHaveLength(94)
      expect(draft.data.geometry.pdfCalibration?.floorScope).toMatchObject({ kind: 'partial' })
      expect(draft.data.geometry.openings).toHaveLength(13)
      expect(
        draft.data.geometry.warnings.some(
          (warning) => warning.includes('10.57') && warning.includes('15.16'),
        ),
      ).toBe(true)
      expect(draft.data.geometry.verticalReference).toBeUndefined()
      project = await getProject(local.owner, created.id)
      expect(project.planReading?.geometry).toEqual(draft.data.geometry)
      const geometry = draft.data.geometry
      const requests = fixture.projectedEvidence.map((entry) => {
        const { roomNumber, openingSourceId, ...value } = entry
        const roomIndex = geometry.rooms.findIndex((room) =>
          (room.sourceNumbers ?? [room.sourceNumber]).includes(roomNumber),
        )
        const target = openingSourceId
          ? {
              kind: 'opening',
              openingId: planPageGeometryElementId(
                { ...fixture.source, state: 'proposed' },
                String(roomNumber),
                'opening',
                openingSourceId,
              ),
            }
          : roomNumber === undefined
            ? { kind: 'project' }
            : { kind: 'room', roomIndex }
        return { ...value, target }
      })
      for (const request of requests) {
        const saved = await saveProjectedVerticalEvidence(
          created.id,
          { ...request, sourceSha256: fixture.source.sha256, acknowledged: true },
          planEditRevision(project.planUrl, project.planReading),
        )
        if (!saved.ok) throw new Error(saved.error)
        project = await getProject(local.owner, created.id)
      }
      expect(
        project.planReading?.geometry && projectedFloorPreview(project.planReading.geometry),
      ).toBeUndefined()
      const wholeFloors = fixture.projectedEvidence.filter(
        (entry) => entry.quantity === 'floor-level' && entry.roomNumber !== 8,
      )
      for (const source of wholeFloors) {
        const record = project.planReading?.geometry?.projectedVerticalEvidence?.find(
          (entry) =>
            entry.quantity === 'floor-level' &&
            entry.source.captionIndexes[0] === source.captionIndex,
        )
        if (!record) throw new Error('Missing floor record')
        const reviewed = await reviewProjectedFloorContour(
          created.id,
          {
            mode: 'apply',
            evidenceId: record.id,
            zeroCaptionIndex: 239,
            roomContourAcknowledged: true,
            commonZeroAcknowledged: true,
          },
          planEditRevision(project.planUrl, project.planReading),
        )
        if (!reviewed.ok) throw new Error(reviewed.error)
        project = await getProject(local.owner, created.id)
      }
      const stored = project.planReading?.geometry
      if (!stored) throw new Error('Missing stored proposed geometry')
      expect(currentProjectedVerticalEvidence(stored)).toHaveLength(requests.length)
      const preview = projectedFloorPreview(stored)
      expect(preview?.floors).toHaveLength(6)
      expect(preview?.floors.map((floor) => floor.elevationCm).sort((a, b) => a - b)).toEqual([
        -5, 0, 0, 0, 0, 0,
      ])
      expect(preview?.heldRooms.map((room) => room.name)).toEqual(['Санузел'])
      expect(
        preview?.heldRooms[0]?.levels.map((level) => [
          level.printedValue,
          level.pdfPage,
          ...level.captionIndexes,
        ]),
      ).toEqual([
        ['-0.050', 3, 244],
        ['+0.150', 3, 246],
      ])
      const wcFloor = stored.projectedVerticalEvidence?.find(
        (entry) =>
          entry.quantity === 'floor-level' &&
          entry.valueCm === -5 &&
          entry.target.kind === 'room' &&
          entry.target.room.sourceNumber === 8,
      )
      if (!wcFloor) throw new Error('Missing conflicting WC floor')
      expect(
        (
          await reviewProjectedFloorContour(
            created.id,
            {
              mode: 'apply',
              evidenceId: wcFloor.id,
              zeroCaptionIndex: 239,
              roomContourAcknowledged: true,
              commonZeroAcknowledged: true,
            },
            planEditRevision(project.planUrl, project.planReading),
          )
        ).ok,
      ).toBe(false)
      expect(stored.rooms).toEqual(geometry.rooms)
      expect(stored.verticalReference).toBeUndefined()
      expect(stored.walls.some((wall) => wall.heightCm !== undefined)).toBe(false)
      expect(stored.openings.some((opening) => opening.bottomCm !== undefined)).toBe(false)
      const saved = await savePlanGeometry(
        created.id,
        { ...stored, projectedVerticalEvidence: [] },
        'draft',
        planEditRevision(project.planUrl, project.planReading),
      )
      if (!saved.ok) throw new Error(saved.error)
      expect(currentProjectedVerticalEvidence(saved.data.geometry)).toHaveLength(requests.length)
      expect(projectedFloorPreview(saved.data.geometry)).toEqual(preview)
      expect(planVolume({ ...saved.data.geometry, status: 'confirmed' })).toBeNull()
      expect(
        (await savePlanGeometry(created.id, saved.data.geometry, 'confirm', saved.data.revision))
          .ok,
      ).toBe(false)
      const reimported = await createPlanPageGeometryDraft(
        created.id,
        [1, 2, 3, 4, 5, 6, 7, 8, 9],
        saved.data.revision,
        undefined,
        false,
        true,
        true,
      )
      if (!reimported.ok) throw new Error(reimported.error)
      expect(projectedFloorPreview(reimported.data.geometry)).toEqual(preview)
      const snapshot = await loadSnapshot(created.id)
      if (!snapshot) throw new Error('Missing PDF snapshot')
      const pdf = await buildPdfData({
        snapshot,
        kind: 'free',
        options: {},
        rates: { roughRubPerM2: 15000, finishRubPerM2: 5000 },
        brief: null,
        summary: null,
      })
      expect(pdf.projectedPlan?.rows).toHaveLength(requests.length)
      expect(pdf.projectedPlan?.drawing?.rooms).toHaveLength(7)
      expect(pdf.projectedPlan?.drawing?.floor).toHaveLength(94)
      expect(pdf.projectedPlan?.floorPreview?.floors).toHaveLength(6)
      expect(pdf.projectedPlan?.drawing?.rooms.flatMap((room) => room.sourceNumbers)).toHaveLength(
        9,
      )
      expect(pdf.projectedPlan?.floorScopeNote).toContain('Балкон')
      expect(pdf.verticalPlan).toBeUndefined()
      const html = renderProjectHtml(pdf, { fontCss: fontFaceCss() })
      const floorPage = html
        .split('<section class="page projected-floor-preview">')[1]
        ?.split('</section>')[0]
      expect(floorPage).toContain('Подписи без поверхности')
      expect(floorPage).toContain('Поднятая душевая часть: +0.150 м (PDF, стр. 3, подпись 246)')
      expect(floorPage).toContain('Место текста не задаёт точку пола в 3D')
      expect(html).toContain('Проектные отметки')
      expect(html).toContain('Поднятая душевая часть')
      expect(html).toContain('не высота от проектного чистого пола')
      if (process.env.QA_REMPLANNER_OUTPUT) {
        const output = process.env.QA_REMPLANNER_OUTPUT
        await mkdir(output, { recursive: true })
        await writeFile(join(output, 'projected-report.html'), html)
        await writeFile(join(output, 'projected-pdf-data.json'), JSON.stringify(pdf, null, 2))
        await writeFile(join(output, 'projected-geometry.json'), JSON.stringify(stored, null, 2))
      }
      if (!snapshot.project.planReading?.geometry) throw new Error('Missing PDF geometry')
      snapshot.project.planReading.geometry.requiresSourceReviewReimport = true
      const heldPdf = await buildPdfData({
        snapshot,
        kind: 'free',
        options: {},
        rates: { roughRubPerM2: 15000, finishRubPerM2: 5000 },
        brief: null,
        summary: null,
      })
      expect(heldPdf.projectedPlan?.rows).toEqual([])
      expect(heldPdf.projectedPlan?.drawing).toBeUndefined()
      expect(heldPdf.projectedPlan?.floorPreview).toBeUndefined()
      expect(heldPdf.projectedPlan?.staleCount).toBe(requests.length)
    }, 120000)
  },
)
