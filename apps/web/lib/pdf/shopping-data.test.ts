import type { Concept, Room } from '@uyut/db'
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

afterEach(() => {
  vi.unstubAllGlobals()
  vi.unstubAllEnvs()
})

describe('selected shopping variant in PDF data without AI or external requests', () => {
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
})
