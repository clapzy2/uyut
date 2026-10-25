import { layoutRoom } from '@uyut/catalog'
import type { PlanGeometry, PlanWallFacePair } from '@uyut/db'
import { renderProjectHtml } from '@uyut/pdf'
import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { ExportComposition } from '@/components/summary/export-composition'
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

function exportPreview(geometry: PlanGeometry) {
  return renderToStaticMarkup(
    createElement(ExportComposition, { projectId: 'project', rooms: [], items: [], geometry }),
  ).replace(/<!--.*?-->/g, '')
}

describe('human wall review provenance in PDF', () => {
  it('labels a proposed source before any geometry exists, without claiming a draft was built', async () => {
    const source = snapshot(geometry())
    source.project.planReading = {
      readAt: '2026-10-25',
      rooms: [],
      planState: 'proposed',
      sourcePage: 1,
    }
    vi.stubEnv('APP_URL', 'https://domitsa.example')
    const data = await buildPdfData({
      snapshot: source,
      kind: 'free',
      options: {},
      rates: { roughRubPerM2: 15_000, finishRubPerM2: 5_000 },
      brief: null,
      summary: null,
    })
    const html = renderProjectHtml(data, { fontCss: '' })
    expect(html).toContain('Проектное состояние, страница 1')
    expect(html).toContain('Подтверждённой схемы пока нет')
    expect(html).not.toContain('Схема остаётся черновиком')
    const preview = renderToStaticMarkup(
      createElement(ExportComposition, {
        projectId: 'project',
        rooms: [],
        items: [],
        planState: 'proposed',
        sourcePage: 1,
      }),
    ).replace(/<!--.*?-->/g, '')
    expect(preview).toContain('Источник схемы: проектное состояние, страница 1')
  })
  it('preserves proposed source state in the export preview and generated PDF', async () => {
    const proposed = geometry()
    if (!proposed.pdfCalibration) throw new Error('Missing PDF fixture')
    proposed.pdfCalibration.sourceState = 'proposed'
    const data = await build(proposed)
    expect(data.project.facts).toContainEqual({
      label: 'Источник схемы',
      value:
        'Проектное состояние, страница 4. Будущая планировка, не существующий обмер. Схема остаётся черновиком.',
    })
    expect(renderProjectHtml(data, { fontCss: '' })).toContain(
      'Будущая планировка, не существующий обмер',
    )
    expect(exportPreview(proposed)).toContain('Источник схемы: проектное состояние, страница 4')
    expect(
      (await build(geometry())).project.facts.some((fact) => fact.label === 'Источник схемы'),
    ).toBe(false)
  })
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
    expect(exportPreview(geometry())).toContain(
      'В схеме квартиры сверено человеком пар граней стен: 1',
    )
    expect(exportPreview(geometry())).toContain('она не подтверждает все стены, комнаты или обмеры')
  })

  it('does not attach an apartment-wide review to an old measurement-only room', async () => {
    const data = await build(geometry())
    data.rooms.push({
      id: 'old-kitchen',
      name: 'Кухня из прежнего QA',
      areaM2: 4.6,
      conditionLabel: 'Черновая отделка',
      hasConcept: false,
      render: null,
      before: null,
      alternates: [],
      note: null,
      objects: [],
      plan: layoutRoom({ widthCm: 230, depthCm: 202 }, []),
      measurementNotes: ['Сохранённая высота потолка: 250 см.'],
    })
    const html = renderProjectHtml(data, { fontCss: '' })
    expect(html.match(/class="small wall-face-review"/g)).toHaveLength(1)
    const roomPage = html.match(/<section class="page plan-page">[\s\S]*?<\/section>/)?.[0]
    expect(roomPage).toContain('Кухня из прежнего QA')
    expect(roomPage).toContain('230 × 202 см')
    expect(roomPage).toContain('Сохранённая высота потолка: 250 см.')
    expect(roomPage).not.toContain('сверено человеком')
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
    expect(exportPreview(plan)).not.toContain('сверено человеком')
  })
})
