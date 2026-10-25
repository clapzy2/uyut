import { subcategoryFromText } from '@uyut/catalog'
import { applyPlanVerticalReference } from '@uyut/catalog/plan-vertical-reference'
import type { Concept, PlanGeometry, Room } from '@uyut/db'
import { renderProjectHtml } from '@uyut/pdf'
import sharp from 'sharp'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { briefInput, buildPdfData, type ProjectSnapshot } from '../../../../jobs/src/lib/pdf-data'
import { layoutWithMeasurements } from '../projects/layout-with-measurements'

function snapshot(): ProjectSnapshot {
  return {
    project: {
      id: 'test-project',
      title: 'Тест ткани',
      styleTags: [],
      budgetKopecks: null,
      totalAreaM2: null,
      household: null,
      contact: null,
      ownerId: 'test-owner',
      houseSeries: null,
      styleReferenceEmbedding: null,
      planUrl: null,
      planReading: null,
      referenceUrl: null,
      onboardedAt: null,
      isPaid: false,
      createdAt: new Date('2026-09-26T10:00:00Z'),
      updatedAt: new Date('2026-09-26T10:00:00Z'),
      deletedAt: null,
    },
    rooms: [],
    concepts: new Map(),
    objects: new Map(),
    shopping: [
      {
        roomName: 'Гостиная',
        item: {
          id: 'test-item',
          roomId: 'test-room',
          quantity: 2,
          dimensionsCm: { width: 210, depth: 90 },
          selectedVariant: {
            color: 'зелёная ткань',
            priceKopecks: 800_000,
            affiliateUrl: 'https://shop.example/green',
            imageUrl: 'https://cdn.example/green.png',
          },
        } as ProjectSnapshot['shopping'][number]['item'],
        product: {
          title: 'Диван',
          category: 'sofa',
          source: 'askona',
          brand: 'Askona',
          priceKopecks: 700_000,
          affiliateUrl: 'https://shop.example/base',
          images: [{ url: 'https://cdn.example/base.png' }],
          inStock: false,
          attributes: { dimensionsCm: { width: 200 }, adDisclosure: 'Реклама. erid test' },
        } as ProjectSnapshot['shopping'][number]['product'],
      },
    ],
  }
}

function signedGeometry(touchingVoid = false, singleRoom = false): PlanGeometry {
  const box = (x: number, y: number, width: number, depth: number) => [
    { xCm: x, yCm: y },
    { xCm: x + width, yCm: y },
    { xCm: x + width, yCm: y + depth },
    { xCm: x, yCm: y + depth },
  ]
  const geometry: PlanGeometry = {
    version: 1,
    status: 'confirmed',
    widthCm: 400,
    heightCm: 500,
    warnings: [],
    walls: [],
    openings: [],
    footprint: box(0, 0, 400, 500),
    rooms: [
      {
        name: 'Гостиная',
        polygon: box(0, 0, 400, 300),
        ...(singleRoom ? { sourceNumber: 1 } : { sourceNumbers: [1, 5] }),
      },
      {
        name: 'Балкон <тест>',
        polygon: box(0, 320, 400, 150),
        sourceNumber: 3,
        spaceKind: 'balcony',
      },
    ],
    voids: [{ id: 'shaft', polygon: box(touchingVoid ? 0 : 50, 50, 30, 30) }],
  }
  const result = applyPlanVerticalReference(
    geometry,
    {
      version: 1,
      id: 'datum-test',
      kind: 'finished-floor',
      zeroFloorId: 'interior',
      acknowledged: true,
      floors: geometry.rooms.map((room, index) => ({
        id: index === 0 ? 'interior' : 'balcony',
        room: structuredClone(room),
        surface: 'finished-floor',
        elevationCm: index === 0 ? 0 : -15,
      })),
      wallBases: [],
      thresholds: [],
      ceilings: [],
      source: { kind: 'site-measurement', reference: 'Synthetic <survey>, not user measurements' },
    },
    'fixture-owner',
    '2026-10-11T09:00:00.000Z',
  )
  if (!result.ok) throw new Error(result.error)
  return result.geometry
}

async function build(data: ProjectSnapshot) {
  vi.stubEnv('APP_URL', 'https://domitsa.example')
  const image = await sharp({ create: { width: 2, height: 2, channels: 3, background: '#008800' } })
    .png()
    .toBuffer()
  const fetchImage = vi.fn().mockResolvedValue(new Response(image))
  vi.stubGlobal('fetch', fetchImage)
  const pdf = await buildPdfData({
    snapshot: data,
    kind: 'free',
    options: {},
    rates: { roughRubPerM2: 15_000, finishRubPerM2: 5_000 },
    brief: null,
    summary: null,
  })
  return { pdf, fetchImage }
}

function addRoom(data: ProjectSnapshot): Room {
  const room: Room = {
    id: 'test-room',
    projectId: data.project.id,
    name: 'Гостиная',
    kind: 'living',
    spaceKind: 'interior',
    areaM2: 12,
    condition: 'bare',
    refreshFinish: false,
    photoUrl: null,
    planUrl: null,
    notes: null,
    measurements: { widthCm: 400, depthCm: 300 },
    orderIndex: 0,
    generationRunId: null,
    generationStartedAt: null,
    generationBatchId: null,
  }
  data.rooms = [room]
  data.concepts.set(room.id, {
    main: {
      renderUrl: null,
      editedRenderUrl: null,
      note: null,
    } as Concept,
    alternates: [],
  })
  const row = data.shopping[0]
  if (!row) throw new Error('Missing shopping fixture')
  row.item.quantity = 1
  return room
}

describe('данные нового задания для мастера', () => {
  it('сохраняет в PDF название неподобранной тумбы с визуализации', async () => {
    const data = snapshot()
    const room = addRoom(data)
    const entry = data.concepts.get(room.id)
    if (!entry) throw new Error('Нет тестового концепта')
    entry.main.prompt = 'Тестовый интерьер спальни'
    data.objects.set(room.id, [
      { index: 1, category: 'table', label: 'a bedside table', product: null, priceKopecks: null },
      { index: 2, category: 'storage', label: 'unknown object', product: null, priceKopecks: null },
    ])

    const { pdf } = await build(data)
    expect(pdf.rooms[0]?.objects.map((object) => object.category)).toEqual([
      'Прикроватная тумба',
      'Хранение',
    ])
    expect(briefInput(data).rooms[0]?.concept?.objects.map((object) => object.category)).toEqual([
      'прикроватная тумба',
      'хранение',
    ])
    const html = renderProjectHtml(pdf, { fontCss: '' })
    expect(html).toContain('Прикроватная тумба')
  })

  it('exports saved room dimensions without purchases, a concept or a confirmed floor', async () => {
    const data = snapshot()
    const room = addRoom(data)
    room.measurements = { widthCm: 300, depthCm: 400, ceilingCm: 270 }
    data.shopping = []
    data.concepts.clear()

    const { pdf } = await build(data)
    expect(pdf.rooms).toHaveLength(1)
    expect(pdf.rooms[0]?.plan?.placed).toEqual([])

    const html = renderProjectHtml(pdf, { fontCss: '' })
    expect(html).toContain('Гостиная · сохранённые мерки')
    expect(html).toContain('Сохранённые габариты комнаты: 300 × 400 см')
    expect(html).toContain('Высота потолка по мерке комнаты: 270 см')
    expect(html).not.toContain('2D-схема · выбранные товары')
  })

  it('передаёт пожелание перекраски и предупреждение неподтверждённого варианта', () => {
    const data = snapshot()
    addRoom(data)
    data.concepts.clear()
    const row = data.shopping[0]
    if (!row) throw new Error('Нет тестового товара')
    row.item.selectedVariant = { swatchId: 'linen-milk', color: 'молочный лён' }
    expect(briefInput(data).rooms[0]?.shopping?.[0]).toMatchObject({
      variant: 'молочный лён',
      variantIsWish: true,
      priceRub: 7000,
    })
    row.item.selectedVariant = { color: 'несуществующая ткань', priceKopecks: 999999 }
    const item = briefInput(data).rooms[0]?.shopping?.[0]
    expect(item).toMatchObject({ variantIsWish: false, priceRub: 9999.99 })
    expect(item?.catalogNotice).toContain('не подтверждён текущим каталогом')
  })

  it('передаёт ручные покупки без концепта и не смешивает пожелания комнат', () => {
    const data = snapshot()
    const living = addRoom(data)
    living.notes = 'Оставить зелёную ткань.'
    data.concepts.clear()
    data.rooms.push({
      ...living,
      id: 'second-room',
      name: 'Балкон',
      spaceKind: 'balcony',
      areaM2: null,
      notes: 'Не утеплять.',
      refreshFinish: true,
    })
    const row = data.shopping[0]
    if (!row?.item.selectedVariant) throw new Error('Нет выбранного варианта')
    row.item.quantity = 2
    row.item.selectedVariant.priceKopecks = 800_049
    const result = briefInput(data)
    expect(result.project.clientNotes).toBeNull()
    expect(result.rooms[0]).toMatchObject({
      notes: 'Оставить зелёную ткань.',
      concept: null,
      shopping: [{ product: 'Диван', quantity: 2, priceRub: 8000.49, variant: 'зелёная ткань' }],
    })
    expect(result.rooms[1]).toMatchObject({
      notes: 'Не утеплять.',
      areaM2: null,
      spaceKind: 'balcony',
      refreshFinish: true,
      shopping: [],
    })
  })
})

function roomGeometry(name: string): PlanGeometry {
  return {
    version: 1,
    status: 'confirmed',
    widthCm: 400,
    heightCm: 300,
    warnings: [],
    walls: [
      { id: 'entry-wall', kind: 'outer', start: { xCm: 0, yCm: 0 }, end: { xCm: 0, yCm: 300 } },
    ],
    openings: [
      {
        id: 'entry',
        type: 'door',
        wallId: 'entry-wall',
        offsetCm: 100,
        widthCm: 90,
        clearance: { side: 'right', depthCm: 90, shape: 'rectangle' },
      },
    ],
    rooms: [
      {
        name,
        polygon: [
          { xCm: 0, yCm: 0 },
          { xCm: 400, yCm: 0 },
          { xCm: 400, yCm: 300 },
          { xCm: 0, yCm: 300 },
        ],
      },
    ],
  }
}

afterEach(() => {
  vi.unstubAllGlobals()
  vi.unstubAllEnvs()
})

describe('selected shopping variant in PDF data without AI or external requests', () => {
  it.each([false, true])(
    'exports source-only signed floors and voids without concepts or purchases (touching=%s)',
    async (touching) => {
      const data = snapshot()
      data.shopping = []
      const geometry = signedGeometry(touching)
      const before = structuredClone(geometry)
      data.project.planReading = { rooms: [], geometry, readAt: '2026-10-11T09:00:00Z' }
      const { pdf, fetchImage } = await build(data)
      expect(fetchImage).not.toHaveBeenCalled()
      expect(pdf.rooms).toHaveLength(0)
      expect(pdf.verticalPlan?.status).toBe('confirmed')
      if (pdf.verticalPlan?.status !== 'confirmed') throw new Error('Missing confirmed signed plan')
      expect(pdf.verticalPlan.floors.map((floor) => floor.elevationCm)).toEqual([0, -15])
      expect(pdf.verticalPlan.floors[0]?.voids.length).toBe(touching ? 0 : 1)
      expect(pdf.verticalPlan.floors[0]?.floor.length).toBe(touching ? 8 : 4)
      const html = renderProjectHtml(pdf, { fontCss: '' })
      expect(html).toContain('Полы и пороги')
      expect(html).toContain('data-project-floor="balcony:0"')
      expect(html).toContain('Балкон &lt;тест&gt;')
      expect(html).toContain('Synthetic &lt;survey&gt;')
      expect(html).toContain('Сверено пользователем: 2026-10-11T09:00:00.000Z')
      expect(html).toContain('Неизвестна')
      expect(html).toContain('Это не означает, что порогов нет')
      expect(html).not.toContain('data-project-floor="floor"')
      expect(geometry).toEqual(before)
    },
  )

  it.each(['draft', 'stale', 'malformed'] as const)(
    'holds signed PDF geometry rather than printing a local-zero fallback: %s',
    async (edit) => {
      const data = snapshot()
      addRoom(data)
      data.concepts.clear()
      data.shopping = []
      const geometry = signedGeometry()
      if (edit === 'draft') geometry.status = 'draft'
      const first = geometry.rooms[0]?.polygon[0]
      if (!first) throw new Error('Missing fixture point')
      if (edit === 'stale') first.xCm += 1
      if (edit === 'malformed') first.xCm = Number.NaN
      data.project.planReading = { rooms: [], geometry, readAt: '2026-10-11T09:00:00Z' }
      const { pdf } = await build(data)
      expect(pdf.verticalPlan?.status).toBe('held')
      expect(pdf.rooms).toHaveLength(0)
      const html = renderProjectHtml(pdf, { fontCss: '' })
      expect(html).toContain('Перенос уровней приостановлен')
      expect(html).not.toContain('data-project-floor=')
      expect(html).not.toContain('data-signed-room-floor=')
    },
  )

  it('uses clipped signed floor paths and notes unknown furniture height without inventing a top', async () => {
    const data = snapshot()
    const room = addRoom(data)
    data.project.planReading = {
      rooms: [],
      geometry: signedGeometry(false, true),
      readAt: '2026-10-11T09:00:00Z',
    }
    const row = data.shopping[0]
    if (!row) throw new Error('Missing shopping fixture')
    row.item.quantity = 1
    row.item.placementCm = { xCm: 120, yCm: 100, rotation: 0 }
    const { pdf } = await build(data)
    expect(pdf.rooms[0]?.id).toBe(room.id)
    expect(pdf.rooms[0]?.plan?.floorLevel?.surfaces[0]?.voids).toHaveLength(1)
    const html = renderProjectHtml(pdf, { fontCss: '' })
    expect(html).toContain('data-signed-room-floor="interior"')
    expect(html).toContain('отметка верха неизвестна')
    expect(html).toContain('Отметка потолка этого пола неизвестна')
  })

  it('exports kitchen geometry and zones without purchases, and reads later edits', async () => {
    const data = snapshot()
    const room = addRoom(data)
    room.name = 'Кухня'
    room.kind = 'kitchen'
    data.shopping = []
    data.concepts.clear()
    const geometry = roomGeometry(room.name)
    geometry.kitchenItems = [
      {
        id: 'cabinet',
        kind: 'cabinet',
        xCm: 100,
        yCm: 100,
        widthCm: 60,
        depthCm: 60,
        heightCm: 90,
        front: 'bottom',
        openingDepthCm: 40,
        passageCm: 70,
        installationGaps: { top: 0, right: 5, bottom: 0, left: 0 },
      },
    ]
    data.project.planReading = { rooms: [], geometry, readAt: '2026-10-04T00:00:00Z' }
    const before = await build(data)
    expect(before.pdf.rooms).toHaveLength(1)
    expect(before.pdf.rooms[0]?.plan?.keepClearZones.map((zone) => zone.label)).toContain(
      'Модуль 1: открывание и проход',
    )
    const html = renderProjectHtml(before.pdf, { fontCss: '' })
    expect(html).toContain('Кухонный модуль 1')
    expect(html).toContain('высота 90 см')
    expect(html).toContain('<title>Модуль 1: монтажный габарит</title>')
    const cabinet = geometry.kitchenItems[0]
    if (!cabinet) throw new Error('Missing cabinet')
    cabinet.xCm = 180
    delete cabinet.heightCm
    const after = await build(data)
    const footprint = after.pdf.rooms[0]?.plan?.keepClearZones.find(
      (zone) => zone.label === 'Кухонный модуль 1',
    )
    expect(footprint?.polygon[0]?.xCm).toBe(180)
    expect(renderProjectHtml(after.pdf, { fontCss: '' })).toContain('высота не указана')
    expect(renderProjectHtml(after.pdf, { fontCss: '' })).not.toContain('высота 90 см')
    geometry.kitchenItems = []
    const removed = await build(data)
    expect(renderProjectHtml(removed.pdf, { fontCss: '' })).not.toContain('Кухонный модуль 1')
    expect(removed.pdf.rooms[0]?.plan?.floorPolygon).toHaveLength(4)
  })

  describe.each([
    { name: 'Спальня', kind: 'bedroom' as const },
    { name: 'Детская', kind: 'kid' as const },
  ])('$name: saved measurements and layout status in PDF', ({ name, kind }) => {
    function fixture() {
      const data = snapshot()
      const room = addRoom(data)
      room.name = name
      room.kind = kind
      data.concepts.clear()
      const row = data.shopping[0]
      if (!row) throw new Error('Missing shopping fixture')
      row.roomName = name
      row.product.title = 'Кровать'
      row.product.category = 'bed'
      row.item.dimensionsCm = { width: 140, depth: 200 }
      return { data, room, row }
    }

    it('recalculates a pinned bed after a smaller manual measurement without hiding the rejection', async () => {
      const { data, room, row } = fixture()
      row.item.placementCm = { xCm: 250, yCm: 0, rotation: 0 }
      const before = await build(data)
      expect(before.pdf.rooms[0]?.plan?.placed).toHaveLength(1)
      room.measurements = { widthCm: 300, depthCm: 300 }
      const { pdf } = await build(data)
      expect(pdf.rooms[0]?.plan?.widthCm).toBe(300)
      expect(pdf.rooms[0]?.plan?.placed).toHaveLength(0)
      expect(pdf.rooms[0]?.plan?.safetySummary.status).toBe('blocked')
      const html = renderProjectHtml(pdf, { fontCss: '' })
      expect(html).toContain(`${name} · сохранённые мерки`)
      expect(html).toContain('Сохранённые габариты комнаты: 300 × 300 см')
      expect(html).toContain('Требуется перестановка')
      expect(html).toContain('Кровать')
    })

    it('keeps the same contour/measurement conflict as the website calculation', async () => {
      const { data, room } = fixture()
      room.measurements = { widthCm: 360, depthCm: 300 }
      const geometry = roomGeometry(name)
      data.project.planReading = { rooms: [], geometry, readAt: '2026-09-27T10:00:00Z' }
      const { pdf } = await build(data)
      const expected = layoutWithMeasurements(
        name,
        room.measurements,
        geometry,
        [
          {
            id: 'test-item',
            title: 'Кровать',
            category: 'bed',
            subcategory: subcategoryFromText('bed', 'Кровать'),
            quantity: 1,
            dimensions: { width: 140, depth: 200 },
          },
        ],
        kind,
      )
      expect(pdf.rooms[0]?.plan).toEqual(expected)
      expect(pdf.rooms[0]?.plan?.functionProfile).toBe(kind)
      expect(pdf.rooms[0]?.plan?.safetySummary.status).not.toBe('checked')
      expect(pdf.rooms[0]?.plan?.missingSafetyData.join(' ')).toContain(
        'контур 400.0 см, мерка 360.0 см',
      )
      expect(renderProjectHtml(pdf, { fontCss: '' })).toContain('контур 400.0 см, мерка 360.0 см')
    })

    it('keeps a blocked entrance in the document rather than approving the bed footprint alone', async () => {
      const { data, row } = fixture()
      const geometry = roomGeometry(name)
      data.project.planReading = { rooms: [], geometry, readAt: '2026-09-27T10:00:00Z' }
      row.item.placementCm = { xCm: 0, yCm: 100, rotation: 0 }
      const { pdf } = await build(data)
      expect(pdf.rooms[0]?.plan?.safetySummary.status).toBe('blocked')
      expect(pdf.rooms[0]?.plan?.floorReservations).toHaveLength(1)
      expect(renderProjectHtml(pdf, { fontCss: '' })).toContain('Требуется перестановка')
    })

    it('explains a draft contour fallback next to the printed scheme', async () => {
      const { data } = fixture()
      const geometry = { ...roomGeometry(name), status: 'draft' as const }
      data.project.planReading = { rooms: [], geometry, readAt: '2026-09-27T10:00:00Z' }
      const { pdf } = await build(data)
      expect(pdf.rooms[0]?.plan?.safetySummary.status).toBe('needs-data')
      expect(pdf.rooms[0]?.plan?.floorReservations).toHaveLength(0)
      expect(renderProjectHtml(pdf, { fontCss: '' })).toContain('прямоугольные габариты по меркам')
    })

    it('does not promise a drawing on a measurements-only page with a draft geometry', async () => {
      const { data } = fixture()
      data.shopping = []
      data.project.planReading = {
        rooms: [],
        geometry: { ...roomGeometry(name), status: 'draft' },
        readAt: '2026-10-17T14:00:00Z',
      }
      const { pdf } = await build(data)
      const html = renderProjectHtml(pdf, { fontCss: '' })
      const planPage = html.match(/<section class="page plan-page">[\s\S]*?<\/section>/)?.[0]
      expect(planPage).toContain(`${name} · сохранённые мерки`)
      expect(planPage).toContain('известны только прямоугольные габариты по меркам')
      expect(planPage).not.toContain('показано прямоугольное превью')
      expect(planPage).not.toContain('<svg ')
    })
  })

  it('exports an existing 2D layout without requiring an AI concept', async () => {
    const data = snapshot()
    const room = addRoom(data)
    data.concepts.clear()
    const { pdf } = await build(data)
    expect(pdf.rooms[0]?.plan).toBeDefined()
    expect(pdf.rooms[0]?.plan).not.toBeNull()
    expect(pdf.rooms[0]?.id).toBe(room.id)
    const html = renderProjectHtml(pdf, { fontCss: '' })
    expect(html).toContain('Гостиная · расстановка')
    expect(html).not.toContain('Предметы на рендере')
    expect(html).not.toContain('расстановка не утверждена')
  })

  it('takes the cover from a later concept when the first room has only a 2D scheme', async () => {
    const data = snapshot()
    const room = addRoom(data)
    data.concepts.clear()
    const kitchen: Room = { ...room, id: 'kitchen', name: 'Кухня', kind: 'kitchen', orderIndex: 1 }
    data.rooms.push(kitchen)
    data.concepts.set(kitchen.id, {
      main: {
        renderUrl: 'https://cdn.example/kitchen.png',
        editedRenderUrl: null,
        note: null,
      } as Concept,
      alternates: [],
    })
    const { pdf } = await build(data)
    expect(pdf.rooms[0]?.render).toBeNull()
    expect(pdf.rooms[0]?.hasConcept).toBe(false)
    expect(pdf.cover).toEqual(pdf.rooms[1]?.render)
    expect(pdf.cover?.alt).toBe('Кухня, концепт')
  })
  it('matches the website lower-bound layout and carries its measurement warning', async () => {
    const data = snapshot()
    const room = addRoom(data)
    room.measurements = {
      widthCm: 400,
      depthCm: 300,
      toleranceCm: 2,
      finishStage: 'after',
      verification: {
        widthCm: 400,
        depthCm: 300,
        toleranceCm: 2,
        finishStage: 'after',
        confirmedAt: '2026-09-26T10:00:00Z',
      },
    }
    const { pdf } = await build(data)
    const expected = layoutWithMeasurements(
      room.name,
      room.measurements,
      undefined,
      [
        {
          id: 'test-item',
          title: 'Диван',
          category: 'sofa',
          quantity: 1,
          dimensions: { width: 210, depth: 90 },
        },
      ],
      room.kind,
    )
    expect(pdf.rooms[0]?.plan).toEqual(expected)
    expect(pdf.rooms[0]?.plan?.widthCm).toBe(398)
    expect(pdf.rooms[0]?.plan?.measurementNote).toContain('по нижней границе')
  })

  it('preserves a confirmed non-rectangular contour instead of printing a box', async () => {
    const data = snapshot()
    const room = addRoom(data)
    const polygon = [
      { xCm: 0, yCm: 0 },
      { xCm: 400, yCm: 0 },
      { xCm: 400, yCm: 200 },
      { xCm: 300, yCm: 200 },
      { xCm: 300, yCm: 300 },
      { xCm: 0, yCm: 300 },
    ]
    data.project.planReading = {
      rooms: [],
      readAt: '2026-09-26T10:00:00Z',
      geometry: {
        version: 1,
        status: 'confirmed',
        widthCm: 400,
        heightCm: 300,
        walls: [],
        openings: [],
        warnings: [],
        rooms: [{ name: room.name, polygon }],
      },
    }
    const { pdf } = await build(data)
    expect(pdf.rooms[0]?.plan?.floorPolygon).toEqual(polygon)
    expect(pdf.rooms[0]?.plan?.measurementNote).toContain('Схема предварительная')
    expect(pdf.rooms[0]?.plan?.functionProfile).toBe('living')
  })
  it('uses variant photo, link, price and user dimensions rather than the base product', async () => {
    const { pdf, fetchImage } = await build(snapshot())
    const item = pdf.shopping[0]?.items[0]
    expect(fetchImage.mock.calls[0]?.[0]).toBe('https://cdn.example/green.png')
    expect(item).toMatchObject({
      affiliateUrl: 'https://shop.example/green',
      quantity: 2,
      priceKopecks: 800_000,
      totalKopecks: 1_600_000,
      adDisclosure: 'Реклама. erid test',
    })
    expect(item?.image?.src).toMatch(/^data:image\/jpeg;base64,/)
    expect(item?.meta).toContain('зелёная ткань')
    expect(item?.meta).toContain('ширина 210 см, глубина 90 см')
    expect(item?.meta).toContain('размеры введены вами')
    expect(item?.meta).toContain('нет в наличии')
    expect(item?.meta).not.toContain('ширина 200 см')
    expect(pdf.estimate.furnitureKopecks).toBe(1_600_000)
  })

  it('labels recoloring as a wish and uses base store price and image', async () => {
    const data = snapshot()
    const row = data.shopping[0]
    if (!row) throw new Error('Missing shopping fixture')
    row.item.selectedVariant = { swatchId: 'linen-milk', color: 'молочный лён' }
    const { pdf, fetchImage } = await build(data)
    expect(fetchImage.mock.calls[0]?.[0]).toBe('https://cdn.example/base.png')
    expect(pdf.shopping[0]?.items[0]).toMatchObject({
      priceKopecks: 700_000,
      affiliateUrl: 'https://shop.example/base',
    })
    expect(pdf.shopping[0]?.items[0]?.meta).toContain('цвет — пожелание из концепта')
  })

  it('falls back to base product values and does not invent absent dimensions', async () => {
    const data = snapshot()
    const row = data.shopping[0]
    if (!row) throw new Error('Missing shopping fixture')
    row.item.selectedVariant = null
    row.item.dimensionsCm = null
    row.product.attributes = null
    const { pdf, fetchImage } = await build(data)
    expect(fetchImage.mock.calls[0]?.[0]).toBe('https://cdn.example/base.png')
    expect(pdf.shopping[0]?.items[0]).toMatchObject({
      affiliateUrl: 'https://shop.example/base',
      priceKopecks: 700_000,
      totalKopecks: 1_400_000,
    })
    expect(pdf.shopping[0]?.items[0]?.meta).toContain('габариты не указаны')
    expect(pdf.estimate.furnitureKopecks).toBe(1_400_000)
  })

  it('prints the current variant price/photo and preserves the update notice', async () => {
    const data = snapshot()
    const row = data.shopping[0]
    if (!row?.item.selectedVariant) throw new Error('Missing shopping fixture')
    row.product.variants = [
      {
        ...row.item.selectedVariant,
        priceKopecks: 900_000,
        imageUrl: 'https://cdn.example/current.png',
      },
    ]
    const { pdf, fetchImage } = await build(data)
    expect(pdf.shopping[0]?.items[0]).toMatchObject({
      priceKopecks: 900_000,
      totalKopecks: 1_800_000,
    })
    expect(pdf.estimate.furnitureKopecks).toBe(1_800_000)
    expect(fetchImage.mock.calls[0]?.[0]).toBe('https://cdn.example/current.png')
    expect(renderProjectHtml(pdf, { fontCss: '' })).toContain('Цена выбранного варианта обновлена')
  })

  it('prints partial dimensions without implying a complete footprint', async () => {
    const data = snapshot()
    const row = data.shopping[0]
    if (!row) throw new Error('Missing shopping fixture')
    row.item.dimensionsCm = null
    row.product.attributes = { dimensionsCm: { height: 70 } }
    const { pdf } = await build(data)
    const meta = pdf.shopping[0]?.items[0]?.meta
    expect(meta).toContain('высота 70 см')
    expect(meta).toContain('уточните ширину и глубину')
    expect(meta).not.toContain('ширина 70')
  })

  it('не печатает машинный шум в габаритах товара и не меняет сохранённые мерки', async () => {
    const data = snapshot()
    const row = data.shopping[0]
    if (!row) throw new Error('Нет тестового товара')
    row.item.dimensionsCm = { width: 310.4 - 10.1, depth: 95.4, height: 95.3 - 10.1 }
    const original = structuredClone(row.item.dimensionsCm)
    const { pdf } = await build(data)
    expect(pdf.shopping[0]?.items[0]?.meta).toContain(
      'ширина 300.3 см, глубина 95.4 см, высота 85.2 см',
    )
    expect(row.item.dimensionsCm).toEqual(original)
  })
})
