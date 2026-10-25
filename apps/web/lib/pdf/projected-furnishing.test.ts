import { type LayoutItem, subcategoryFromText } from '@uyut/catalog'
import { createProjectedContourBinding } from '@uyut/catalog/projected-room-layout'
import { roomVolume } from '@uyut/catalog/room-volume'
import type { Concept, PlanGeometry, Room } from '@uyut/db'
import { renderProjectHtml } from '@uyut/pdf'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { buildPdfData, type ProjectSnapshot } from '../../../../jobs/src/lib/pdf-data'
import { layoutWithMeasurements } from '../projects/layout-with-measurements'
import { projectLayouts } from '../shopping/layout'

vi.mock('server-only', () => ({}))
vi.mock('../shopping/repository', () => ({ getShoppingList: vi.fn() }))

function fixture() {
  const geometry: PlanGeometry = {
    version: 1,
    status: 'draft',
    source: 'manual',
    widthCm: 600,
    heightCm: 400,
    walls: [],
    openings: [],
    warnings: [],
    rooms: [
      {
        name: 'Проектная общая зона',
        sourceNumbers: [1, 2, 3],
        polygon: [
          { xCm: 0, yCm: 0 },
          { xCm: 600, yCm: 0 },
          { xCm: 600, yCm: 200 },
          { xCm: 300, yCm: 200 },
          { xCm: 300, yCm: 400 },
          { xCm: 0, yCm: 400 },
        ],
      },
    ],
    pdfCalibration: {
      sourceSha256: 'a'.repeat(64),
      pdfPage: 1,
      sourceState: 'proposed',
      cmPerPoint: 1,
      origin: { x: 0, y: 0 },
      anchorRoomNumbers: [],
      labelIndexes: [],
      derivedOpeningIds: [],
    },
  }
  const binding = createProjectedContourBinding(geometry, 0)
  if (!binding) throw new Error('Синтетический проектный контур должен подходить для связывания')
  const room: Room = {
    id: 'projected-room',
    projectId: 'synthetic-project',
    name: 'Старая комната',
    kind: 'living',
    spaceKind: 'interior',
    areaM2: 18,
    condition: 'bare',
    refreshFinish: false,
    photoUrl: null,
    planUrl: null,
    notes: null,
    measurements: { widthCm: 320, depthCm: 600, ceilingCm: 270, projectedContour: binding },
    orderIndex: 0,
    generationRunId: null,
    generationStartedAt: null,
    generationBatchId: null,
  }
  const title = 'Синтетический диван для проверки PDF'
  const item: LayoutItem = {
    id: 'synthetic-sofa',
    title,
    category: 'sofa',
    subcategory: subcategoryFromText('sofa', title),
    dimensions: { width: 50, depth: 40, height: 80 },
    quantity: 1,
    operationClearance: { front: 70 },
    placement: { xCm: 50, yCm: 50, rotation: 0, frontDirection: 'right' },
  }
  const snapshot: ProjectSnapshot = {
    project: {
      id: room.projectId,
      title: 'Синтетическая проектная расстановка, не обмер',
      styleTags: [],
      budgetKopecks: null,
      totalAreaM2: null,
      household: null,
      contact: null,
      ownerId: 'synthetic-owner',
      houseSeries: null,
      styleReferenceEmbedding: null,
      planUrl: null,
      referenceUrl: null,
      onboardedAt: null,
      isPaid: false,
      createdAt: new Date('2026-10-25T00:00:00Z'),
      updatedAt: new Date('2026-10-25T00:00:00Z'),
      deletedAt: null,
      planReading: {
        readAt: '2026-10-25T00:00:00Z',
        planState: 'proposed',
        sourcePage: 1,
        rooms: [{ name: 'Проектная общая зона', sourceNumber: 1, kind: 'living' }],
        geometry,
      },
    },
    rooms: [room],
    // Keep the room page present after a stale binding; no render URL or network call is needed.
    concepts: new Map([
      [
        room.id,
        {
          main: { renderUrl: null, editedRenderUrl: null, note: null } as Concept,
          alternates: [],
        },
      ],
    ]),
    objects: new Map(),
    shopping: [
      {
        roomName: room.name,
        item: {
          id: item.id,
          roomId: room.id,
          quantity: 1,
          dimensionsCm: item.dimensions,
          operationClearanceCm: item.operationClearance,
          placementCm: item.placement,
          selectedVariant: null,
        } as ProjectSnapshot['shopping'][number]['item'],
        product: {
          id: 'synthetic-product',
          externalId: 'synthetic-pdf-sofa',
          title,
          category: 'sofa',
          source: 'dump',
          subcategory: null,
          description: null,
          brand: null,
          priceKopecks: 10000,
          oldPriceKopecks: null,
          currency: 'RUB',
          affiliateUrl: 'https://example.test/synthetic-sofa',
          images: [],
          inStock: true,
          attributes: {},
          variants: null,
          imageEmbedding: null,
          textEmbedding: null,
          contentHash: 'synthetic-sofa',
          embeddedHash: null,
          lastSyncedAt: new Date('2026-10-25T00:00:00Z'),
        },
      },
    ],
  }
  return { snapshot, geometry, room, item }
}

async function build(snapshot: ProjectSnapshot) {
  vi.stubEnv('APP_URL', 'https://domitsa.example')
  const fetch = vi.fn(() => {
    throw new Error('В этом тесте запрещены сетевые запросы')
  })
  vi.stubGlobal('fetch', fetch)
  const pdf = await buildPdfData({
    snapshot,
    kind: 'free',
    options: {},
    rates: { roughRubPerM2: 15000, finishRubPerM2: 5000 },
    brief: null,
    summary: null,
  })
  expect(fetch).not.toHaveBeenCalled()
  return pdf
}

afterEach(() => {
  vi.unstubAllGlobals()
  vi.unstubAllEnvs()
})

describe('проектный Г-контур в данных и HTML PDF, синтетическая проверка без генерации', () => {
  it('сохраняет ту же форму и мебель, что сайт, без старого потолка и выдуманных стен', async () => {
    const { snapshot, geometry, room, item } = fixture()
    const website = layoutWithMeasurements(
      room.name,
      room.measurements,
      geometry,
      [item],
      room.kind,
    )
    expect(website).not.toBeNull()
    const pdf = await build(snapshot)
    const page = pdf.rooms.find((entry) => entry.id === room.id)
    expect(page?.plan).toEqual(website)
    const projectedHtml = renderProjectHtml(pdf, { fontCss: '' })
    expect(projectedHtml).toContain('Проёмы перенесены как проектные предложения и требуют сверки.')
    expect(projectedHtml).not.toContain('Проёмы учтены по подтверждённой 2D-схеме.')
    const plan = page?.plan
    if (!plan) throw new Error('Ожидается явная проектная расстановка')
    expect(plan.floorPolygon).toEqual(geometry.rooms[0]?.polygon)
    expect(plan).toMatchObject({
      widthCm: 600,
      depthCm: 400,
      safetySummary: { status: 'needs-data' },
    })
    expect(plan.placed).toHaveLength(1)
    expect(plan.measurementNote).toContain('не натурный обмер')
    expect(plan.measurementNote).toContain('1 + 2 + 3')
    expect(page?.measurementNotes).toEqual([])
    const volume = roomVolume(plan)
    expect(volume?.furniture?.[0]?.heightCm).toBe(80)
    expect(volume?.walls).toEqual([])
    expect(volume?.verticalDatum).toBeUndefined()
    const html = renderProjectHtml(pdf, { fontCss: '' })
    expect(html).toContain('Проектный контур')
    expect(html).toContain('не натурный обмер')
    expect(html).toContain('<polygon')
    expect(html).not.toContain('Высота потолка по мерке комнаты: 270')
  })

  it('keeps linked empty rooms in the overview and PDF with the same missing-data status', async () => {
    const { snapshot, geometry, room } = fixture()
    room.kind = 'kid'
    snapshot.shopping = []
    const overview = projectLayouts(
      [room, { ...room, id: 'unlinked', measurements: null }],
      { items: [] },
      geometry,
    )
    expect(overview).toHaveLength(1)
    const pdf = await build(snapshot)
    const plan = pdf.rooms.find((entry) => entry.id === room.id)?.plan
    expect(plan).toEqual(overview[0]?.layout)
    expect(plan?.safetySummary.status).toBe('needs-data')
    expect(plan?.placed).toEqual([])
    expect(plan?.floorPolygon).toHaveLength(6)
    expect(
      plan?.functionChecks.some(
        (entry) => entry.importance === 'required' && entry.status === 'missing',
      ),
    ).toBe(true)
    if (!plan) throw new Error('Missing empty projected layout')
    expect(roomVolume(plan)?.furniture).toEqual([])
    expect(renderProjectHtml(pdf, { fontCss: '' })).toContain('Дополните данные для проверки')

    if (!geometry.pdfCalibration) throw new Error('Missing source calibration')
    geometry.pdfCalibration.sourceSha256 = 'b'.repeat(64)
    expect(projectLayouts([room], { items: [] }, geometry)).toEqual([])
    const stalePdf = await build(snapshot)
    expect(stalePdf.rooms.find((entry) => entry.id === room.id)?.plan).toBeNull()
  })

  it.each(['polygon', 'source', 'reimport'] as const)(
    'не подставляет прямоугольник после изменения %s',
    async (change) => {
      const { snapshot, geometry, room, item } = fixture()
      if (change === 'polygon') {
        const vertex = geometry.rooms[0]?.polygon[2]
        if (!vertex) throw new Error('В фикстуре должен быть угол Г-контура')
        vertex.xCm = 580
      }
      if (change === 'source') {
        if (!geometry.pdfCalibration) throw new Error('В фикстуре должна быть PDF-калибровка')
        geometry.pdfCalibration.sourceSha256 = 'b'.repeat(64)
      }
      if (change === 'reimport') geometry.requiresSourceReviewReimport = true
      expect(
        layoutWithMeasurements(room.name, room.measurements, geometry, [item], room.kind),
      ).toBeNull()
      const pdf = await build(snapshot)
      const page = pdf.rooms.find((entry) => entry.id === room.id)
      expect(page?.plan).toBeNull()
      expect(page?.measurementNotes).toEqual([])
      expect(renderProjectHtml(pdf, { fontCss: '' })).not.toContain(
        'Высота потолка по мерке комнаты: 270',
      )
      expect(pdf.shopping).not.toHaveLength(0)
    },
  )
})
