import { createHash } from 'node:crypto'
import { roomLayoutInputFromGeometry } from '@uyut/catalog/geometry'
import type {
  PlanGeometry,
  PlanOpeningFacePair,
  PlanOpeningWidthProof,
  PlanReading,
  PlanWallFacePair,
} from '@uyut/db'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { AccessError } from '@/lib/projects/access'
import { PlanEditConflictError, planEditRevision } from '@/lib/projects/plan-edit-revision'
import openApartmentSource from '../../../jobs/fixtures/open-swiss-apartment-35063.json'
import openApartment from '../../../jobs/fixtures/open-swiss-apartment-35063-geometry.json'

const mocks = vi.hoisted(() => ({
  assertOwner: vi.fn(),
  audit: vi.fn(),
  getSession: vi.fn(),
  revalidate: vi.fn(),
  setPlanReading: vi.fn(),
  getObject: vi.fn(),
  preparePlanPage: vi.fn(),
}))

vi.mock('@/lib/projects/access', () => ({
  AccessError: class AccessError extends Error {},
  assertOwner: mocks.assertOwner,
}))
vi.mock('@/lib/projects/repository', () => ({ setPlanReading: mocks.setPlanReading }))
vi.mock('@/lib/projects/plan-document', () => ({ preparePlanPage: mocks.preparePlanPage }))
vi.mock('@/lib/storage', () => ({
  deleteObject: vi.fn(),
  getObject: mocks.getObject,
  putObject: vi.fn(),
}))
vi.mock('@/lib/projects/plan-reading', () => ({
  PlanReadError: class PlanReadError extends Error {},
  readPlanFromStorage: vi.fn(),
}))
vi.mock('@/lib/session', () => ({ getSession: mocks.getSession }))
vi.mock('@/lib/audit', () => ({ recordAudit: mocks.audit }))
vi.mock('next/cache', () => ({ revalidatePath: mocks.revalidate }))
vi.mock('next/headers', () => ({ headers: async () => new Headers() }))

import { savePlanGeometry as saveGeometryAction } from './projects'

let source: { planUrl: string; planReading: PlanReading }

function savePlanGeometry(id: string, input: unknown, mode: 'draft' | 'confirm') {
  return saveGeometryAction(id, input, mode, planEditRevision(source.planUrl, source.planReading))
}

const projectId = 'f6fcb42e-2b4e-4b39-bb5c-31c9bfbe9f2f'
const emptyManualGeometry = {
  version: 1 as const,
  source: 'manual' as const,
  status: 'draft' as const,
  widthCm: 500,
  heightCm: 400,
  walls: [],
  openings: [],
  rooms: [],
  warnings: [],
}

const calibratedImage = {
  imageWidthPx: 1000,
  imageHeightPx: 800,
  pixelStart: { x: 100, y: 100 },
  pixelEnd: { x: 400, y: 100 },
  worldStart: { xCm: 0, yCm: 0 },
  lengthCm: 300,
  direction: 'right' as const,
}

const corners = [
  { xCm: 0, yCm: 0 },
  { xCm: 500, yCm: 0 },
  { xCm: 500, yCm: 400 },
  { xCm: 0, yCm: 400 },
]
const closedWalls = corners.map((start, index) => {
  const end = corners[(index + 1) % corners.length]
  if (!end) throw new Error('Missing rectangle corner')
  return {
    id: `manual_${String(index + 1).padStart(24, '0')}`,
    kind: 'outer' as const,
    start,
    end,
  }
})
const kitchenContour = [
  {
    name: 'Кухня',
    polygon: [
      { xCm: 0, yCm: 0 },
      { xCm: 300, yCm: 0 },
      { xCm: 300, yCm: 180 },
      { xCm: 0, yCm: 180 },
    ],
  },
]

describe('manual plan draft', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mocks.getSession.mockResolvedValue({ user: { id: 'owner' } })
    source = {
      planUrl: 'plan.webp',
      planReading: {
        readAt: '2026-09-24T00:00:00.000Z',
        confirmedAt: '2026-09-24T00:00:00.000Z',
        rooms: [{ name: 'Кухня', kind: 'kitchen', areaM2: 5.4 }],
        geometry: emptyManualGeometry,
      },
    }
    mocks.assertOwner.mockResolvedValue(source)
    mocks.setPlanReading.mockResolvedValue(undefined)
    mocks.audit.mockResolvedValue(undefined)
  })

  it('сохраняет проверенные границу пола и пустоты из источника, а не из правки браузера', async () => {
    const voids = [
      {
        id: 'shaft',
        polygon: [
          { xCm: 20, yCm: 20 },
          { xCm: 40, yCm: 20 },
          { xCm: 40, yCm: 40 },
          { xCm: 20, yCm: 40 },
        ],
      },
    ]
    source.planReading.geometry = { ...emptyManualGeometry, footprint: corners, voids }
    const result = await savePlanGeometry(
      projectId,
      { ...emptyManualGeometry, footprint: [], voids: [] },
      'draft',
    )

    expect(result.ok).toBe(true)
    if (result.ok) {
      expect(result.data.geometry.footprint).toEqual(corners)
      expect(result.data.geometry.voids).toEqual(voids)
    }
    expect(mocks.setPlanReading.mock.calls[0]?.[2].geometry.voids).toEqual(voids)
  })

  it('передаёт подтверждённый контур из сохранения схемы в расстановку', async () => {
    const innerWall = {
      id: 'manual_000000000000000000000005',
      kind: 'inner' as const,
      start: { xCm: 450, yCm: 0 },
      end: { xCm: 450, yCm: 400 },
    }
    const room = {
      name: 'Кухня',
      polygon: [
        { xCm: 0, yCm: 0 },
        { xCm: 450, yCm: 0 },
        { xCm: 450, yCm: 400 },
        { xCm: 0, yCm: 400 },
      ],
    }
    const voids = [
      {
        id: 'shaft',
        polygon: [
          { xCm: 450, yCm: 0 },
          { xCm: 500, yCm: 0 },
          { xCm: 500, yCm: 400 },
          { xCm: 450, yCm: 400 },
        ],
      },
    ]
    source.planReading.rooms = [{ name: 'Кухня', kind: 'kitchen', areaM2: 18 }]
    source.planReading.geometry = {
      ...emptyManualGeometry,
      walls: [...closedWalls, innerWall],
      rooms: [room],
      footprint: corners,
      voids,
    }

    const result = await savePlanGeometry(projectId, source.planReading.geometry, 'confirm')

    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.data.geometry.status).toBe('confirmed')
    expect(result.data.geometry.footprint).toEqual(corners)
    expect(result.data.geometry.voids).toEqual(voids)
    expect(roomLayoutInputFromGeometry(result.data.geometry, 'Кухня', null)?.floorPolygon).toEqual(
      room.polygon,
    )
  })

  it('keeps server calibration and cannot confirm an unresolved opening by omitting it from input', async () => {
    const pdfCalibration = {
      sourceSha256: 'a'.repeat(64),
      pdfPage: 6,
      cmPerPoint: 1.7,
      origin: { x: 10, y: 20 },
      anchorRoomNumbers: [4],
      labelIndexes: [1, 2],
      derivedOpeningIds: ['manual_123456789012345678901234'],
    }
    source.planReading.geometry = { ...emptyManualGeometry, pdfCalibration }
    const input = { ...emptyManualGeometry, walls: closedWalls, rooms: kitchenContour }
    const draft = await savePlanGeometry(projectId, input, 'draft')
    expect(draft.ok).toBe(true)
    if (draft.ok) expect(draft.data.geometry.pdfCalibration).toEqual(pdfCalibration)
    source.planReading.rooms = [{ name: 'Кухня', kind: 'kitchen', areaM2: 20 }]
    const confirmed = await savePlanGeometry(
      projectId,
      {
        ...input,
        rooms: [{ name: 'Кухня', polygon: corners }],
        pdfCalibration: { ...pdfCalibration, derivedOpeningIds: [] },
      },
      'confirm',
    )
    expect(confirmed.ok).toBe(false)
    if (!confirmed.ok) expect(confirmed.error).toContain('проёмы')
  })

  it('не подтверждает квартиру, если экспликация PDF содержит пропущенную комнату', async () => {
    source.planReading.rooms = [{ name: 'Кухня №09', sourceNumber: 9, kind: 'kitchen', areaM2: 20 }]
    source.planReading.pageReview = {
      version: 1,
      savedAt: '2026-09-30T00:00:00.000Z',
      contours: {
        source: { sha256: 'a'.repeat(64), pdfPage: 2, state: 'existing' },
        coordinateSystem: 'page-0-1000',
        review: 'manual-source-review',
        pageWidth: 1000,
        pageHeight: 1000,
        rooms: [
          {
            roomSourceNumber: 9,
            polygon: corners.map((point) => ({ x: point.xCm, y: point.yCm })),
          },
        ],
      },
      sourceRooms: [
        { sourceNumber: 6, name: 'Спальня' },
        { sourceNumber: 9, name: 'Кухня' },
      ],
    }
    source.planReading.geometry = {
      ...emptyManualGeometry,
      walls: closedWalls,
      rooms: [{ name: 'Кухня №09', sourceNumber: 9, polygon: corners }],
    }
    const result = await savePlanGeometry(projectId, source.planReading.geometry, 'confirm')
    expect(result).toMatchObject({ ok: false })
    if (!result.ok) expect(result.error).toContain('№06 Спальня')
    expect(mocks.setPlanReading).not.toHaveBeenCalled()
  })

  it('сверяет экспликацию PDF и для старого черновика без сохранённого списка', async () => {
    const body = Buffer.from('old reviewed plan')
    const sha256 = createHash('sha256').update(body).digest('hex')
    source.planUrl = 'plan.pdf'
    source.planReading.rooms = [{ name: 'Кухня №01', sourceNumber: 1, kind: 'kitchen', areaM2: 20 }]
    source.planReading.pageReview = {
      version: 1,
      savedAt: '2026-09-30T00:00:00.000Z',
      contours: {
        source: { sha256, pdfPage: 2, state: 'existing' },
        coordinateSystem: 'page-0-1000',
        review: 'manual-source-review',
        pageWidth: 1000,
        pageHeight: 1000,
        rooms: [
          {
            roomSourceNumber: 1,
            polygon: corners.map((point) => ({ x: point.xCm, y: point.yCm })),
          },
        ],
      },
    }
    source.planReading.geometry = {
      ...emptyManualGeometry,
      walls: closedWalls,
      rooms: [{ name: 'Кухня №01', sourceNumber: 1, polygon: corners }],
    }
    mocks.getObject.mockResolvedValue({ body })
    mocks.preparePlanPage.mockResolvedValue({
      image: {
        body: Buffer.from('image'),
        contentType: 'image/jpeg',
        planText: JSON.stringify([
          { text: 'Экспликация помещений:', x: 630, y: 100, rotation: 0 },
          { text: '01-Кухня - 20,00м', x: 630, y: 120, rotation: 0 },
          { text: '02-Спальня - 15,00м', x: 630, y: 139, rotation: 0 },
          { text: '03-Санузел - 5,00м', x: 630, y: 158, rotation: 0 },
        ]),
      },
    })

    const result = await savePlanGeometry(projectId, source.planReading.geometry, 'confirm')

    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.error).toContain('№02 Спальня')
    expect(mocks.preparePlanPage).toHaveBeenCalledWith(body, true, 2)
    expect(mocks.setPlanReading).not.toHaveBeenCalled()
  })

  it('rejects an old editor revision without writing or announcing success', async () => {
    const result = await saveGeometryAction(projectId, emptyManualGeometry, 'draft', '0'.repeat(64))
    expect(result.ok).toBe(false)
    expect(mocks.setPlanReading).not.toHaveBeenCalled()
    expect(mocks.audit).not.toHaveBeenCalled()
    expect(mocks.revalidate).not.toHaveBeenCalled()
  })

  it.each(['unchanged', 'width', 'host', 'removed', 'added', 'contour', 'forged-contour'] as const)(
    'preserves only current server-owned face pairs after %s edits',
    async (edit) => {
      const firstWall = closedWalls[0]
      const secondWall = closedWalls[2]
      if (!firstWall?.end || !secondWall?.end) throw new Error('Missing wall fixtures')
      const openings = [firstWall, secondWall].map((wall, index) => ({
        id: `manual_${String(index + 101).padStart(24, '0')}`,
        type: 'door' as const,
        wallId: wall.id,
        offsetCm: 100,
        widthCm: 90,
      }))
      const firstOpening = openings[0]
      const secondOpening = openings[1]
      if (!firstOpening || !secondOpening) throw new Error('Missing opening fixtures')
      const pair: PlanOpeningFacePair = {
        bindings: [
          { opening: firstOpening, wall: firstWall },
          { opening: secondOpening, wall: secondWall },
        ],
        jambs: [
          { operationIndex: 5, subpathIndex: 0, segmentIndex: 0 },
          { operationIndex: 6, subpathIndex: 0, segmentIndex: 0 },
        ],
      }
      const wallPair: PlanWallFacePair = {
        faces: [firstWall, secondWall].map((wall, segmentIndex) => ({
          wall: structuredClone(wall),
          start: { ...wall.start },
          end: { ...wall.end },
          nativeSegment: { operationIndex: 7, subpathIndex: 0, segmentIndex },
        })) as PlanWallFacePair['faces'],
        openings: structuredClone(openings),
      }
      const geometry: PlanGeometry = {
        ...emptyManualGeometry,
        walls: structuredClone(closedWalls),
        openings,
        rooms: structuredClone(kitchenContour),
        pdfCalibration: {
          sourceSha256: 'a'.repeat(64),
          pdfPage: 6,
          cmPerPoint: 1.7,
          origin: { x: 10, y: 20 },
          anchorRoomNumbers: [4],
          labelIndexes: [1, 2],
          derivedOpeningIds: [],
          openingFacePairs: [structuredClone(pair)],
          wallFacePairs: [structuredClone(wallPair)],
          wallFaceRoomPolygons: [structuredClone(kitchenContour[0]?.polygon ?? [])],
        },
      }
      // The snapshots are separate from editable geometry; client metadata is not trusted.
      source.planReading.geometry = geometry
      const input = structuredClone(geometry)
      const jamb = input.pdfCalibration?.openingFacePairs?.[0]?.jambs[0]
      const opening = input.openings[0]
      const wall = input.walls[0]
      const nativeSegment = input.pdfCalibration?.wallFacePairs?.[0]?.faces[0].nativeSegment
      if (!jamb || !opening || !wall || !nativeSegment) throw new Error('Missing editable fixtures')
      jamb.operationIndex = 999
      nativeSegment.operationIndex = 999
      if (edit === 'width') opening.widthCm += 1
      if (edit === 'host') wall.start.xCm += 1
      if (edit === 'removed') input.openings = input.openings.slice(1)
      if (edit === 'contour' || edit === 'forged-contour') {
        const point = input.rooms[0]?.polygon[0]
        if (!point) throw new Error('Missing editable contour')
        point.xCm += 1
        if (edit === 'forged-contour' && input.pdfCalibration)
          input.pdfCalibration.wallFaceRoomPolygons = input.rooms.map(({ polygon }) =>
            structuredClone(polygon),
          )
      }
      if (edit === 'added')
        input.openings.push({
          ...opening,
          id: 'manual_000000000000000000000103',
          offsetCm: 250,
        })
      const result = await savePlanGeometry(projectId, input, 'draft')
      expect(result.ok).toBe(true)
      if (result.ok) {
        expect(result.data.geometry.pdfCalibration?.openingFacePairs).toEqual(
          edit === 'unchanged' || edit === 'added' ? [pair] : [],
        )
        expect(result.data.geometry.pdfCalibration?.wallFacePairs).toEqual(
          edit === 'unchanged' ? [wallPair] : [],
        )
        expect(result.data.geometry.pdfCalibration?.sourceOpeningFacePairs).toEqual([pair])
        expect(result.data.geometry.pdfCalibration?.sourceWallFacePairs).toEqual([wallPair])
        if (edit === 'width') {
          source.planReading = mocks.setPlanReading.mock.calls[0]?.[2] as PlanReading
          const confirmed = await savePlanGeometry(projectId, result.data.geometry, 'confirm')
          expect(confirmed.ok).toBe(false)
          if (!confirmed.ok) expect(confirmed.error).toContain('PDF')
          expect(mocks.setPlanReading).toHaveBeenCalledTimes(1)
        }
      }
    },
  )

  it.each(['unchanged', 'width', 'host', 'donor-width', 'contour'] as const)(
    'retains printed-width evidence only after %s edits',
    async (edit) => {
      const firstWall = closedWalls[0]
      const donorWall = closedWalls[2]
      if (!firstWall || !donorWall) throw new Error('Missing walls')
      const opening = {
        id: 'manual_000000000000000000000201',
        type: 'door' as const,
        wallId: firstWall.id,
        offsetCm: 100,
        widthCm: 90,
      }
      const donor = { ...opening, id: 'manual_000000000000000000000202', wallId: donorWall.id }
      const proof: PlanOpeningWidthProof = {
        opening: structuredClone(opening),
        wall: structuredClone(firstWall),
        labelIndex: 84,
        sameOpeningAs: { roomSourceNumber: 6, openingId: 'room-6-door' },
        oppositeBinding: {
          opening: structuredClone(donor),
          wall: structuredClone(donorWall),
        },
      }
      const geometry: PlanGeometry = {
        ...emptyManualGeometry,
        walls: structuredClone(closedWalls),
        openings: [opening, donor],
        rooms: structuredClone(kitchenContour),
        pdfCalibration: {
          sourceSha256: 'a'.repeat(64),
          pdfPage: 6,
          cmPerPoint: 1.7,
          origin: { x: 10, y: 20 },
          anchorRoomNumbers: [4],
          labelIndexes: [84],
          derivedOpeningIds: [],
          openingWidthProofs: [proof],
          wallFaceRoomPolygons: [structuredClone(kitchenContour[0]?.polygon ?? [])],
        },
      }
      source.planReading.geometry = geometry
      const input = structuredClone(geometry)
      if (edit === 'width' && input.openings[0]) input.openings[0].widthCm += 1
      if (edit === 'host' && input.walls[0]) input.walls[0].start.xCm += 1
      if (edit === 'donor-width' && input.openings[1]) input.openings[1].widthCm += 1
      if (edit === 'contour' && input.rooms[0]?.polygon[0]) {
        input.rooms[0].polygon[0].xCm += 1
      }
      const clientProof = input.pdfCalibration?.openingWidthProofs?.[0]
      if (clientProof) clientProof.labelIndex = 999

      const result = await savePlanGeometry(projectId, input, 'draft')
      expect(result.ok).toBe(true)
      if (!result.ok) return
      expect(result.data.geometry.pdfCalibration?.openingWidthProofs).toEqual(
        edit === 'unchanged' ? [proof] : [],
      )
      expect(result.data.geometry.pdfCalibration?.derivedOpeningIds).toEqual(
        edit === 'unchanged' ? [] : [opening.id],
      )
    },
  )

  it('does not introduce client-provided PDF calibration or face proofs', async () => {
    const result = await savePlanGeometry(
      projectId,
      {
        ...emptyManualGeometry,
        pdfCalibration: { openingFacePairs: [{ forged: true }], wallFacePairs: [{ forged: true }] },
      },
      'draft',
    )
    expect(result.ok).toBe(true)
    if (result.ok) expect(result.data.geometry).not.toHaveProperty('pdfCalibration')
  })

  it('requires a source revision even when called outside the editor', async () => {
    expect(await saveGeometryAction(projectId, emptyManualGeometry, 'draft')).toMatchObject({
      ok: false,
      code: 'plan-conflict',
    })
    expect(mocks.setPlanReading).not.toHaveBeenCalled()
  })

  it('does not save without a session or owner permission', async () => {
    mocks.getSession.mockResolvedValueOnce(null)
    expect((await savePlanGeometry(projectId, emptyManualGeometry, 'draft')).ok).toBe(false)
    expect(mocks.assertOwner).not.toHaveBeenCalled()
    mocks.assertOwner.mockRejectedValueOnce(new AccessError('Проект не найден'))
    expect(await savePlanGeometry(projectId, emptyManualGeometry, 'draft')).toEqual({
      ok: false,
      error: 'Проект не найден',
    })
    expect(mocks.setPlanReading).not.toHaveBeenCalled()
  })

  it('returns a conflict if the source changes between validation and the database write', async () => {
    mocks.setPlanReading.mockRejectedValueOnce(new PlanEditConflictError())
    expect(await savePlanGeometry(projectId, emptyManualGeometry, 'draft')).toMatchObject({
      ok: false,
      code: 'plan-conflict',
    })
    expect(mocks.audit).not.toHaveBeenCalled()
    expect(mocks.revalidate).not.toHaveBeenCalled()
  })

  it('allows retry after a failed write and only then records success', async () => {
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => {})
    try {
      mocks.setPlanReading.mockRejectedValueOnce(new Error('Synthetic database failure'))
      expect((await savePlanGeometry(projectId, emptyManualGeometry, 'draft')).ok).toBe(false)
      expect(mocks.audit).not.toHaveBeenCalled()
      expect(mocks.revalidate).not.toHaveBeenCalled()
      const retry = await savePlanGeometry(projectId, emptyManualGeometry, 'draft')
      expect(retry.ok).toBe(true)
      if (retry.ok) {
        expect(retry.data.revision).toBe(
          planEditRevision(source.planUrl, {
            ...source.planReading,
            geometry: retry.data.geometry,
          }),
        )
      }
      expect(mocks.audit).toHaveBeenCalledOnce()
      expect(mocks.revalidate).toHaveBeenCalledOnce()
    } finally {
      consoleError.mockRestore()
    }
  })

  it('revalidates a saved draft before giving it a new confirmation', async () => {
    source.planReading.rooms = [{ name: 'Кухня', kind: 'kitchen', areaM2: 20 }]
    const result = await savePlanGeometry(
      projectId,
      {
        ...emptyManualGeometry,
        walls: closedWalls,
        rooms: [{ name: 'Кухня', polygon: corners }],
        confirmedAt: 'forged-old-confirmation',
      },
      'confirm',
    )
    expect(result.ok).toBe(true)
    if (result.ok) {
      expect(result.data.geometry.status).toBe('confirmed')
      expect(result.data.geometry.confirmedAt).toMatch(/^2026-/)
      expect(result.data.geometry.confirmedAt).not.toBe('forged-old-confirmation')
    }
  })

  it('saves further edits as a draft and removes the old geometry confirmation', async () => {
    source.planReading.geometry = {
      ...emptyManualGeometry,
      status: 'confirmed',
      confirmedAt: '2026-09-26T00:00:00.000Z',
    }
    const result = await savePlanGeometry(projectId, emptyManualGeometry, 'draft')
    expect(result.ok).toBe(true)
    const saved = mocks.setPlanReading.mock.calls[0]?.[2]
    expect(saved.geometry.status).toBe('draft')
    expect(saved.geometry).not.toHaveProperty('confirmedAt')
    expect(saved.confirmedAt).toBe(source.planReading.confirmedAt)
  })

  it('saves an empty draft without upgrading it to confirmed geometry', async () => {
    const result = await savePlanGeometry(projectId, emptyManualGeometry, 'draft')

    expect(result.ok).toBe(true)
    expect(mocks.setPlanReading).toHaveBeenCalledWith(
      'owner',
      projectId,
      expect.objectContaining({
        geometry: expect.objectContaining({ status: 'draft', walls: [], source: 'manual' }),
      }),
      source,
    )
    expect(mocks.audit).toHaveBeenCalledWith(
      expect.objectContaining({ action: 'project.plan_geometry_drafted' }),
    )
  })

  it('persists a calibrated underlay with a draft', async () => {
    const checkedCalibration = {
      ...calibratedImage,
      verificationLines: [
        {
          pixelStart: { x: 200, y: 500 },
          pixelEnd: { x: 340, y: 500 },
          lengthCm: 140,
        },
      ],
    }
    const result = await savePlanGeometry(
      projectId,
      { ...emptyManualGeometry, imageCalibration: checkedCalibration },
      'draft',
    )
    expect(result.ok).toBe(true)
    expect(mocks.setPlanReading).toHaveBeenCalledWith(
      'owner',
      projectId,
      expect.objectContaining({
        geometry: expect.objectContaining({ imageCalibration: checkedCalibration }),
      }),
      source,
    )
  })

  it('rejects a calibration outside the canvas', async () => {
    const result = await savePlanGeometry(
      projectId,
      {
        ...emptyManualGeometry,
        imageCalibration: { ...calibratedImage, worldStart: { xCm: 400, yCm: 0 } },
      },
      'draft',
    )
    expect(result.ok).toBe(false)
    expect(mocks.setPlanReading).not.toHaveBeenCalled()
  })

  it('rejects fabricated verification lines outside the image', async () => {
    const result = await savePlanGeometry(
      projectId,
      {
        ...emptyManualGeometry,
        imageCalibration: {
          ...calibratedImage,
          verificationLines: [
            { pixelStart: { x: 900, y: 500 }, pixelEnd: { x: 1200, y: 500 }, lengthCm: 140 },
          ],
        },
      },
      'draft',
    )
    expect(result.ok).toBe(false)
    expect(mocks.setPlanReading).not.toHaveBeenCalled()
  })

  it('does not confirm geometry when independent dimensions contradict the scale', async () => {
    const result = await savePlanGeometry(
      projectId,
      {
        ...emptyManualGeometry,
        walls: closedWalls,
        rooms: kitchenContour,
        imageCalibration: {
          ...calibratedImage,
          verificationLines: [
            { pixelStart: { x: 100, y: 500 }, pixelEnd: { x: 200, y: 500 }, lengthCm: 140 },
          ],
        },
      },
      'confirm',
    )
    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.error).toContain('не сходятся')
    expect(mocks.setPlanReading).not.toHaveBeenCalled()
  })

  it('does not confirm a room contour that disagrees with its labelled area', async () => {
    const result = await savePlanGeometry(
      projectId,
      {
        ...emptyManualGeometry,
        walls: closedWalls,
        rooms: [
          {
            name: 'Кухня',
            polygon: [
              { xCm: 0, yCm: 0 },
              { xCm: 300, yCm: 0 },
              { xCm: 300, yCm: 150 },
              { xCm: 0, yCm: 150 },
            ],
          },
        ],
      },
      'confirm',
    )
    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.error).toContain('на плане подписано')
    expect(mocks.setPlanReading).not.toHaveBeenCalled()
  })

  it('never confirms an unfinished apartment', async () => {
    const walls = [
      [
        { xCm: 0, yCm: 0 },
        { xCm: 500, yCm: 0 },
      ],
      [
        { xCm: 500, yCm: 0 },
        { xCm: 500, yCm: 400 },
      ],
      [
        { xCm: 500, yCm: 400 },
        { xCm: 0, yCm: 0 },
      ],
    ].map(([start, end], index) => ({
      id: `manual_${String(index + 1).padStart(24, '0')}`,
      kind: 'outer',
      start,
      end,
    }))
    const result = await savePlanGeometry(projectId, { ...emptyManualGeometry, walls }, 'confirm')

    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.error).toContain('контуры всех комнат')
    expect(mocks.setPlanReading).not.toHaveBeenCalled()
  })

  it('rejects an isolated wall when confirming, but still saves the draft', async () => {
    const walls = [
      ...closedWalls,
      {
        id: 'manual_000000000000000000000005',
        kind: 'inner' as const,
        start: { xCm: 200, yCm: 100 },
        end: { xCm: 300, yCm: 100 },
      },
    ]
    const submitted = { ...emptyManualGeometry, walls, rooms: kitchenContour }

    const rejected = await savePlanGeometry(projectId, submitted, 'confirm')
    expect(rejected.ok).toBe(false)
    if (!rejected.ok) expect(rejected.error).toContain('не соединена')
    expect(mocks.setPlanReading).not.toHaveBeenCalled()

    const draft = await savePlanGeometry(projectId, submitted, 'draft')
    expect(draft.ok).toBe(true)
  })

  it('confirms a complete independent apartment without losing its floor or shafts', async () => {
    const sourceSha256 = createHash('sha256')
      .update(JSON.stringify(openApartmentSource.rows.map(({ row }) => row)))
      .digest('hex')
    expect(openApartment.sourceSha256).toBe(sourceSha256)
    const geometry = openApartment.geometry as PlanGeometry
    source.planReading = {
      readAt: '2026-09-30T00:00:00.000Z',
      planState: 'unknown',
      rooms: openApartment.rooms as PlanReading['rooms'],
      geometry,
    }

    const result = await savePlanGeometry(
      projectId,
      { ...geometry, footprint: [], voids: [] },
      'confirm',
    )

    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.data.geometry.status).toBe('confirmed')
    expect(result.data.geometry.walls).toHaveLength(38)
    expect(result.data.geometry.openings).toHaveLength(9)
    expect(result.data.geometry.rooms).toHaveLength(8)
    expect(result.data.geometry.footprint).toEqual(geometry.footprint)
    expect(result.data.geometry.voids).toEqual(geometry.voids)
    const bedroom = geometry.rooms.find((room) => room.name === 'Спальня')
    const layoutFloor = roomLayoutInputFromGeometry(
      result.data.geometry,
      'Спальня',
      null,
    )?.floorPolygon
    const firstPoint = bedroom?.polygon[0]
    const localFirstPoint = layoutFloor?.[0]
    if (!bedroom || !firstPoint || !localFirstPoint) {
      throw new Error('Missing bedroom in independent fixture or layout')
    }
    expect(layoutFloor).toHaveLength(bedroom.polygon.length)
    expect(localFirstPoint.xCm).toBeCloseTo(
      firstPoint.xCm - Math.min(...bedroom.polygon.map((point) => point.xCm)),
    )
    expect(localFirstPoint.yCm).toBeCloseTo(
      firstPoint.yCm - Math.min(...bedroom.polygon.map((point) => point.yCm)),
    )
    expect(mocks.setPlanReading).toHaveBeenCalledOnce()

    mocks.setPlanReading.mockClear()
    const incomplete = await savePlanGeometry(
      projectId,
      { ...geometry, walls: geometry.walls.slice(0, 3) },
      'confirm',
    )
    expect(incomplete.ok).toBe(false)
    expect(mocks.setPlanReading).not.toHaveBeenCalled()
  })
})
