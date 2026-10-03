import { randomUUID } from 'node:crypto'
import { catalogItems, type PlanGeometry, type PlanReading, projects, rooms, users } from '@uyut/db'
import { eq } from 'drizzle-orm'
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest'
import { getDb } from '@/lib/db'
import { projectLayouts, roomLayout } from '@/lib/shopping/layout'
import {
  addShoppingItem,
  getShoppingList,
  removeShoppingItem,
  setShoppingItemPlacement,
  setShoppingItemQuantity,
  setShoppingItemSize,
} from '@/lib/shopping/repository'
import openApartment from '../../../../jobs/fixtures/open-swiss-apartment-35063-geometry.json'
import { buildPdfData, loadSnapshot } from '../../../../jobs/src/lib/pdf-data'
import { apartmentVolume } from './apartment-volume'
import { getProject } from './repository'
import { roomVolume } from './room-volume'

vi.mock('server-only', () => ({}))

// Проверка передачи известной геометрии, а не доказательство натурного обмера источника.
const geometry: PlanGeometry = {
  ...(openApartment.geometry as PlanGeometry),
  status: 'confirmed',
}
const run = randomUUID()
let ownerId = ''
let projectId = ''
let livingId = ''
let kitchenId = ''
let sofaId = ''
let chairId = ''
const productIds: string[] = []

async function currentOverview() {
  const project = await getProject(ownerId, projectId)
  const list = await getShoppingList(ownerId, projectId)
  const layouts = projectLayouts(project.rooms, list, project.planReading?.geometry)
  const source = project.planReading?.geometry
  if (!source) throw new Error('Не сохранена геометрия контрольной квартиры')
  return { project, list, layouts, overview: apartmentVolume(source, layouts) }
}

describe('покупки разных комнат: база → 2D → общий объём → печатные данные', () => {
  beforeAll(async () => {
    const connection = process.env.DATABASE_URL
    if (
      !connection ||
      !['localhost', '127.0.0.1', '[::1]'].includes(new URL(connection).hostname)
    ) {
      throw new Error('Контрольная квартира разрешена только в локальной базе')
    }
    const db = getDb()
    const [owner] = await db
      .insert(users)
      .values({ email: `apartment-${run}@example.test` })
      .returning()
    if (!owner) throw new Error('Не создан контрольный владелец')
    ownerId = owner.id
    const [project] = await db
      .insert(projects)
      .values({
        ownerId,
        title: 'Контроль нескольких комнат',
        planReading: {
          planState: 'unknown',
          readAt: new Date().toISOString(),
          rooms: openApartment.rooms as PlanReading['rooms'],
          geometry,
        },
      })
      .returning()
    if (!project) throw new Error('Не создан контрольный проект')
    projectId = project.id
    const savedRooms = await db
      .insert(rooms)
      .values([
        {
          projectId,
          name: 'Гостиная',
          kind: 'living' as const,
          orderIndex: 0,
          measurements: { widthCm: 384.9, depthCm: 535 },
        },
        { projectId, name: 'Кухня', kind: 'kitchen' as const, orderIndex: 1 },
      ])
      .returning()
    livingId = savedRooms[0]?.id ?? ''
    kitchenId = savedRooms[1]?.id ?? ''
    const products = await db
      .insert(catalogItems)
      .values([
        {
          source: 'dump' as const,
          externalId: `apartment-sofa-${run}`,
          category: 'sofa' as const,
          title: 'Контрольный диван',
          priceKopecks: 50_000_00,
          affiliateUrl: 'https://example.test/sofa',
          images: [],
          contentHash: run,
          attributes: {
            dimensionsCm: { width: 210, depth: 90 },
            dimensionsSource: {
              width: 'store-parameters' as const,
              depth: 'store-parameters' as const,
            },
          },
        },
        {
          source: 'dump' as const,
          externalId: `apartment-chair-${run}`,
          category: 'chair' as const,
          title: 'Контрольный стул',
          priceKopecks: 5_000_00,
          affiliateUrl: 'https://example.test/chair',
          images: [],
          contentHash: run,
          attributes: { dimensionsCm: { width: 45, depth: 55 } },
        },
      ])
      .returning()
    productIds.push(...products.map((product) => product.id))
    if (!products[0] || !products[1]) throw new Error('Не созданы контрольные товары')
    const sofa = await addShoppingItem(ownerId, {
      projectId,
      roomId: livingId,
      catalogItemId: products[0].id,
    })
    sofaId = sofa.itemId
    await setShoppingItemSize(ownerId, sofaId, { height: 85 })
    await setShoppingItemPlacement(ownerId, sofaId, { xCm: 100, yCm: 150, rotation: 90 })
    const chair = await addShoppingItem(ownerId, {
      projectId,
      roomId: kitchenId,
      catalogItemId: products[1].id,
      quantity: 2,
    })
    chairId = chair.itemId
  })

  afterAll(async () => {
    if (!ownerId) return
    const db = getDb()
    if (projectId) await db.delete(projects).where(eq(projects.id, projectId))
    for (const id of productIds) await db.delete(catalogItems).where(eq(catalogItems.id, id))
    if (ownerId) await db.delete(users).where(eq(users.id, ownerId))
  })

  it('сохраняет количество, поворот, высоты и реальные контуры без изменения базы', async () => {
    const { project, list, layouts, overview } = await currentOverview()
    expect(list.count).toBe(3)
    expect(list.items.find((item) => item.id === sofaId)).toMatchObject({
      dimensionsCm: { width: 210, depth: 90, height: 85 },
      sizeReading: { source: 'mixed', confidence: 'reported' },
    })
    expect(layouts).toHaveLength(2)
    expect(layouts.map((room) => room.layout.placed.length)).toEqual([1, 2])
    expect(overview.notes).toEqual([])
    const furniture = overview.model?.furniture ?? []
    expect(furniture).toHaveLength(3)
    expect(new Set(furniture.map((item) => item.id)).size).toBe(3)
    for (const room of layouts) {
      const source = geometry.rooms.find((candidate) => candidate.name === room.roomName)
      if (!source) throw new Error('Не найден исходный контур комнаты')
      const originX = Math.min(...source.polygon.map((point) => point.xCm))
      const originY = Math.min(...source.polygon.map((point) => point.yCm))
      const local = roomVolume(room.layout)
      for (const item of local?.furniture ?? []) {
        const global = furniture.find(
          (candidate) => candidate.id === JSON.stringify([room.roomId, item.id]),
        )
        expect(global?.floor).toEqual(
          item.floor.map((point) => ({
            xCm: point.xCm + originX,
            yCm: point.yCm + originY,
          })),
        )
        expect(global?.heightCm).toBe(item.heightCm)
        expect(global?.itemId).toBe(item.itemId)
      }
    }
    expect(layouts[0]?.layout.placed[0]).toMatchObject({
      xCm: 100,
      yCm: 150,
      widthCm: 90,
      depthCm: 210,
    })
    expect(
      furniture
        .filter((item) => item.itemId === chairId)
        .every((item) => item.heightCm === undefined),
    ).toBe(true)
    const room = project.rooms.find((candidate) => candidate.id === livingId)
    if (!room) throw new Error('Не найдена сохранённая гостиная')
    expect(
      await roomLayout(
        ownerId,
        projectId,
        room.id,
        room.name,
        room.measurements,
        geometry,
        room.kind,
      ),
    ).toEqual(layouts[0]?.layout)
    expect((await getProject(ownerId, projectId)).planReading?.geometry).toEqual(geometry)
  })

  it('использует те же размеры и расстановки в печатной выгрузке', async () => {
    const { layouts } = await currentOverview()
    const snapshot = await loadSnapshot(projectId)
    if (!snapshot) throw new Error('Не загружен контрольный проект для печати')
    const pdf = await buildPdfData({
      snapshot,
      kind: 'free',
      options: {},
      rates: { roughRubPerM2: 15_000, finishRubPerM2: 5_000 },
      brief: null,
      summary: null,
    })
    for (const room of layouts) {
      expect(pdf.rooms.find((candidate) => candidate.id === room.roomId)?.plan).toEqual(room.layout)
    }
    const sofa = pdf.shopping
      .flatMap((group) => group.items)
      .find((item) => item.title === 'Контрольный диван')
    expect(sofa?.meta).toContain('ширина 210 см, глубина 90 см, высота 85 см')
    expect(sofa?.meta).toContain(
      'высота — введено вами; ширина, глубина — из характеристик магазина',
    )
    expect(sofa?.meta).not.toContain('размеры введены вами')
  })

  it('не переносит мебель в случайную комнату после переименования', async () => {
    await getDb().update(rooms).set({ name: 'Другая гостиная' }).where(eq(rooms.id, livingId))
    try {
      const { overview } = await currentOverview()
      expect(overview.model?.furniture?.some((item) => item.itemId === sofaId)).toBe(false)
      expect(overview.notes.join(' ')).toContain('нет комнаты с этим названием')
    } finally {
      await getDb().update(rooms).set({ name: 'Гостиная' }).where(eq(rooms.id, livingId))
    }
  })

  it('пересчитывает изменения мерок и количества, а при пустом списке оставляет исходный план', async () => {
    await setShoppingItemSize(ownerId, sofaId, { width: 200, height: 95 })
    await setShoppingItemQuantity(ownerId, chairId, 1)
    let current = await currentOverview()
    expect(current.overview.model?.furniture).toHaveLength(2)
    expect(current.layouts[0]?.layout.placed[0]).toMatchObject({ widthCm: 90, depthCm: 200 })
    expect(
      current.overview.model?.furniture?.find((item) => item.itemId === sofaId)?.heightCm,
    ).toBe(95)
    await setShoppingItemSize(ownerId, sofaId, {})
    current = await currentOverview()
    expect(current.list.items.find((item) => item.id === sofaId)?.dimensionsCm).toEqual({
      width: 210,
      depth: 90,
    })
    expect(
      current.overview.model?.furniture?.find((item) => item.itemId === sofaId)?.heightCm,
    ).toBeUndefined()
    await removeShoppingItem(ownerId, sofaId)
    await removeShoppingItem(ownerId, chairId)
    current = await currentOverview()
    expect(current.layouts).toEqual([])
    expect(current.overview.model?.floor).toEqual(geometry.footprint)
    expect(current.overview.model?.furniture).toEqual([])
    expect(current.overview.model?.walls.length).toBeGreaterThan(0)
    expect(current.project.planReading?.geometry).toEqual(geometry)
  })
})
