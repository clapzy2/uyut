import type { PlanGeometry, PlanWallFacePair } from '@uyut/db'
import { renderProjectHtml } from '@uyut/pdf'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { buildPdfData, type ProjectSnapshot } from '../../../../jobs/src/lib/pdf-data'

const first = {
  id: 'outer-face',
  kind: 'outer' as const,
  start: { xCm: 0, yCm: 0 },
  end: { xCm: 100, yCm: 0 },
}
const second = {
  id: 'inner-face',
  kind: 'inner' as const,
  start: { xCm: 0, yCm: 20 },
  end: { xCm: 100, yCm: 20 },
}
const pair: PlanWallFacePair = {
  faces: [first, second].map((wall, index) => ({
    wall,
    start: wall.start,
    end: wall.end,
    nativeSegment: { operationIndex: 10, subpathIndex: 0, segmentIndex: index },
  })) as PlanWallFacePair['faces'],
  openings: [],
  verification: { kind: 'human-source-review', reviewedAt: '2026-10-24T08:00:00.000Z' },
}

function geometry(): PlanGeometry {
  return {
    version: 1,
    status: 'draft',
    source: 'manual',
    widthCm: 100,
    heightCm: 100,
    rooms: [],
    walls: [first, second],
    openings: [],
    warnings: [],
    pdfCalibration: {
      sourceSha256: 'a'.repeat(64),
      pdfPage: 4,
      cmPerPoint: 1,
      origin: { x: 0, y: 0 },
      anchorRoomNumbers: [],
      labelIndexes: [],
      derivedOpeningIds: [],
      sourceWallFacePairs: [pair],
      wallFaceRoomPolygons: [],
    },
  }
}

function snapshot(plan: PlanGeometry): ProjectSnapshot {
  return {
    project: {
      id: 'wall-review-project',
      title: 'Проверка граней',
      styleTags: [],
      budgetKopecks: null,
      totalAreaM2: null,
      household: null,
      contact: null,
      ownerId: 'owner',
      houseSeries: null,
      styleReferenceEmbedding: null,
      planUrl: 'source.pdf',
      planReading: { readAt: '2026-10-24', rooms: [], geometry: plan },
      referenceUrl: null,
      onboardedAt: null,
      isPaid: false,
      createdAt: new Date('2026-10-24T08:00:00.000Z'),
      updatedAt: new Date('2026-10-24T08:00:00.000Z'),
      deletedAt: null,
    },
    rooms: [],
    concepts: new Map(),
    objects: new Map(),
    shopping: [],
  }
}

async function build(plan: PlanGeometry) {
  vi.stubEnv('APP_URL', 'https://domitsa.example')
  return buildPdfData({
    snapshot: snapshot(plan),
    kind: 'free',
    options: {},
    rates: { roughRubPerM2: 15_000, finishRubPerM2: 5_000 },
    brief: null,
    summary: null,
  })
}

afterEach(() => vi.unstubAllEnvs())

describe('human wall review provenance in PDF', () => {
  it('keeps current human review visible even while floor levels and volume are unavailable', async () => {
    const data = await build(geometry())
    expect(data.wallFaceReview).toEqual({
      sourceSha256: 'a'.repeat(64),
      pdfPage: 4,
      humanReviewedPairs: 1,
    })
    expect(data.verticalPlan).toBeUndefined()
    expect(renderProjectHtml(data, { fontCss: '' })).toContain('со статусом «сверено человеком»: 1')
    expect(renderProjectHtml(data, { fontCss: '' })).toContain('Исходный PDF, страница 4')
  })

  it.each([
    'edited-wall',
    'edited-opening',
    'edited-room',
    'source-reimport',
    'automatic-pair',
  ] as const)('does not print a human review label for %s', async (kind) => {
    const plan = geometry()
    if (kind === 'edited-wall') plan.walls[0] = { ...first, end: { xCm: 90, yCm: 0 } }
    if (kind === 'edited-opening')
      plan.openings.push({ id: 'door', type: 'door', wallId: first.id, offsetCm: 10, widthCm: 80 })
    if (kind === 'edited-room')
      plan.rooms.push({
        name: 'Добавленная комната',
        polygon: [
          { xCm: 0, yCm: 0 },
          { xCm: 100, yCm: 0 },
          { xCm: 100, yCm: 100 },
        ],
      })
    if (kind === 'source-reimport') plan.requiresSourceReviewReimport = true
    if (kind === 'automatic-pair' && plan.pdfCalibration)
      plan.pdfCalibration.sourceWallFacePairs = [{ ...pair, verification: undefined }]
    const data = await build(plan)
    expect(data.wallFaceReview).toBeUndefined()
    expect(renderProjectHtml(data, { fontCss: '' })).not.toContain('сверено человеком')
  })
})
