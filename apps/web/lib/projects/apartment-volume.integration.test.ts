import { createHash, randomUUID } from 'node:crypto'
import { layoutWithMeasurements } from '@uyut/catalog/layout-with-measurements'
import { catalogItems, type PlanGeometry, type PlanReading, projects, rooms, users } from '@uyut/db'
import { eq } from 'drizzle-orm'
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest'
import { getDb } from '@/lib/db'
import { projectLayoutGaps, projectLayouts, roomLayout } from '@/lib/shopping/layout'
import {
  addShoppingItem,
  getShoppingList,
  removeShoppingItem,
  setShoppingItemPlacement,
  setShoppingItemQuantity,
  setShoppingItemSize,
} from '@/lib/shopping/repository'
import apartmentSource from '../../../../jobs/fixtures/open-swiss-apartment-35063.json'
import openApartment from '../../../../jobs/fixtures/open-swiss-apartment-35063-geometry.json'
import { buildPdfData, loadSnapshot } from '../../../../jobs/src/lib/pdf-data'
import { apartmentVolume } from './apartment-volume'
import { buildPlanScene } from './plan-scene-geometry'
import { getProject, setPlanReading, updateRoom } from './repository'
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
      .values(
        (openApartment.rooms as PlanReading['rooms']).map((room, orderIndex) => ({
          projectId,
          name: room.name,
          kind: room.kind,
          orderIndex,
          measurements: room.name === 'Гостиная' ? { widthCm: 384.9, depthCm: 535 } : null,
        })),
      )
      .returning()
    livingId = savedRooms.find((room) => room.name === 'Гостиная')?.id ?? ''
    kitchenId = savedRooms.find((room) => room.name === 'Кухня')?.id ?? ''
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
    expect(layouts.find((room) => room.roomId === livingId)?.layout.placed).toHaveLength(1)
    expect(layouts.find((room) => room.roomId === kitchenId)?.layout.placed).toHaveLength(2)
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
    const livingLayout = layouts.find((room) => room.roomId === livingId)?.layout
    expect(livingLayout?.placed[0]).toMatchObject({
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
    ).toEqual(livingLayout)
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

  it('сохраняет все восемь исходных контуров и неизвестные высоты после чтения базы', async () => {
    const sourceHash = createHash('sha256')
      .update(JSON.stringify(apartmentSource.rows.map(({ row }) => row)))
      .digest('hex')
    expect(sourceHash).toBe(openApartment.sourceSha256)
    const { project, overview } = await currentOverview()
    expect(project.rooms).toHaveLength(8)
    expect(project.planReading?.planState).toBe('unknown')
    for (const room of project.rooms) {
      const source = geometry.rooms.find((candidate) => candidate.name === room.name)
      if (!source) throw new Error(`Нет исходного контура: ${room.name}`)
      const originX = Math.min(...source.polygon.map((point) => point.xCm))
      const originY = Math.min(...source.polygon.map((point) => point.yCm))
      const layout = layoutWithMeasurements(room.name, null, project.planReading?.geometry, [])
      expect(layout?.floorPolygon).toEqual(
        source.polygon.map((point) => ({
          xCm: point.xCm - originX,
          yCm: point.yCm - originY,
        })),
      )
    }
    expect(overview.model?.walls).toHaveLength(38)
    expect(overview.model?.openings).toHaveLength(9)
    expect(overview.model?.walls.every((wall) => wall.topCm === undefined)).toBe(true)
    expect(overview.model?.openings.every((opening) => !opening.cut)).toBe(true)
    const model = overview.model
    if (!model) throw new Error('Нет общего обзора')
    const scene = buildPlanScene(model)
    try {
      expect(scene.surfaces.filter((surface) => surface.kind === 'wall')).toEqual([])
      expect(scene.lines.every((line) => line.unknown)).toBe(true)
      const chairs = model.furniture?.filter((item) => item.itemId === chairId) ?? []
      expect(chairs).toHaveLength(2)
      for (const chair of chairs) {
        const surfaces = scene.surfaces.filter((surface) => surface.furnitureId === chair.id)
        expect(surfaces).toHaveLength(1)
        expect(surfaces[0]?.footprintOnly).toBe(true)
      }
    } finally {
      for (const element of [...scene.surfaces, ...scene.lines]) element.geometry.dispose()
    }
  })

  it('после сохранения правок контура и окна обновляет 2D, объём и печатные планы вместе', async () => {
    const before = await currentOverview()
    if (!before.project.planReading) throw new Error('Нет исходного чтения квартиры')
    const changed = structuredClone(geometry)
    const livingContour = changed.rooms.find((room) => room.name === 'Гостиная')
    const window = changed.openings.find((opening) => opening.type === 'window')
    const vertex = livingContour?.polygon[0]
    if (!vertex || !window) throw new Error('Нет контрольной вершины или окна')
    // Искусственные правки проверяют пересчёт; это не уточнение исходного обмера.
    vertex.xCm += 1.4
    window.offsetCm += 5.4
    window.widthCm -= 10.2
    await updateRoom(ownerId, livingId, { measurements: null })
    try {
      await setPlanReading(
        ownerId,
        projectId,
        { ...before.project.planReading, geometry: changed },
        before.project,
      )
      const current = await currentOverview()
      expect(current.project.planReading?.geometry).toEqual(changed)
      expect(current.overview.notes).toEqual([])
      expect(current.overview.model?.rooms?.find((room) => room.id === livingId)?.floor).toEqual(
        livingContour?.polygon,
      )
      expect(
        current.layouts.find((room) => room.roomId === livingId)?.layout.floorPolygon,
      ).not.toEqual(before.layouts.find((room) => room.roomId === livingId)?.layout.floorPolygon)
      expect(current.overview.model?.openings).not.toEqual(before.overview.model?.openings)
      const beforeBedroom = layoutWithMeasurements('Спальня', null, geometry, [])
      const changedBedroom = layoutWithMeasurements('Спальня', null, changed, [])
      const beforeWindows = beforeBedroom?.floorReservations.filter(
        (item) => item.kind === 'window',
      )
      const changedWindows = changedBedroom?.floorReservations.filter(
        (item) => item.kind === 'window',
      )
      expect(beforeWindows).toHaveLength(1)
      expect(changedWindows).toHaveLength(1)
      expect(changedWindows).not.toEqual(beforeWindows)
      expect(current.list.items.map((item) => item.placementCm)).toEqual(
        before.list.items.map((item) => item.placementCm),
      )
      const snapshot = await loadSnapshot(projectId)
      if (!snapshot) throw new Error('Нет снимка изменённой квартиры')
      const pdf = await buildPdfData({
        snapshot,
        kind: 'free',
        options: {},
        rates: { roughRubPerM2: 15_000, finishRubPerM2: 5_000 },
        brief: null,
        summary: null,
      })
      for (const room of current.project.rooms) {
        const expected =
          current.layouts.find((candidate) => candidate.roomId === room.id)?.layout ??
          layoutWithMeasurements(room.name, room.measurements, changed, [], room.kind)
        expect(pdf.rooms.find((candidate) => candidate.id === room.id)?.plan).toEqual(expected)
      }
      expect(current.overview.model?.walls.every((wall) => wall.topCm === undefined)).toBe(true)
      expect(
        current.overview.model?.furniture?.find((item) => item.itemId === chairId)?.heightCm,
      ).toBeUndefined()
    } finally {
      const latest = await getProject(ownerId, projectId)
      await setPlanReading(ownerId, projectId, before.project.planReading, latest)
      await updateRoom(ownerId, livingId, {
        measurements:
          before.project.rooms.find((room) => room.id === livingId)?.measurements ?? null,
      })
    }
  })

  it('не теряет покупки комнаты без мерок и объясняет её отсутствие в общем обзоре', async () => {
    const before = await currentOverview()
    await updateRoom(ownerId, kitchenId, { name: 'Кухня — мерки уточняются', measurements: null })
    try {
      const current = await currentOverview()
      expect(current.list.count).toBe(before.list.count)
      expect(current.list.items.map((item) => item.id)).toEqual(
        before.list.items.map((item) => item.id),
      )
      expect(current.layouts.map((room) => room.roomId)).toEqual([livingId])
      expect(projectLayoutGaps(current.project.rooms, current.list, current.layouts)).toEqual([
        { roomId: kitchenId, roomName: 'Кухня — мерки уточняются', itemCount: 2 },
      ])
      expect(current.overview.model?.furniture?.some((item) => item.itemId === chairId)).toBe(false)
      const snapshot = await loadSnapshot(projectId)
      if (!snapshot) throw new Error('Нет снимка частичной квартиры')
      const pdf = await buildPdfData({
        snapshot,
        kind: 'free',
        options: {},
        rates: { roughRubPerM2: 15_000, finishRubPerM2: 5_000 },
        brief: null,
        summary: null,
      })
      const shopping = pdf.shopping.flatMap((group) => group.items)
      expect(shopping.find((item) => item.title === 'Контрольный стул')?.quantity).toBe(2)
      expect(pdf.rooms.find((room) => room.id === kitchenId)?.plan).toBeFalsy()
    } finally {
      await updateRoom(ownerId, kitchenId, { name: 'Кухня' })
    }
  })

  it('пересчитывает изменения мерок и количества, а при пустом списке оставляет исходный план', async () => {
    await setShoppingItemSize(ownerId, sofaId, { width: 200, height: 95 })
    await setShoppingItemQuantity(ownerId, chairId, 1)
    let current = await currentOverview()
    expect(current.overview.model?.furniture).toHaveLength(2)
    expect(
      current.layouts.find((room) => room.roomId === livingId)?.layout.placed[0],
    ).toMatchObject({
      widthCm: 90,
      depthCm: 200,
    })
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
