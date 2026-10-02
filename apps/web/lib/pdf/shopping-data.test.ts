import { subcategoryFromText } from '@uyut/catalog'
import type { Concept, PlanGeometry, Room } from '@uyut/db'
import { renderProjectHtml } from '@uyut/pdf'
import sharp from 'sharp'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { buildPdfData, type ProjectSnapshot } from '../../../../jobs/src/lib/pdf-data'
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
      expect(html).toContain(`${name} · расстановка`)
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
      expect(renderProjectHtml(pdf, { fontCss: '' })).toContain('прямоугольное превью по меркам')
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
})
