import { randomUUID } from 'node:crypto'
import { mkdir, writeFile } from 'node:fs/promises'
import { resolve } from 'node:path'
import {
  catalogItems,
  type PlanGeometry,
  type PlanReading,
  projects,
  rooms,
  shoppingListItems,
  users,
} from '@uyut/db'
import { fontFaceCss, renderProjectHtml } from '@uyut/pdf'
import { eq, sql } from 'drizzle-orm'
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest'
import { getDb } from '@/lib/db'
import { apartmentVolume } from '@/lib/projects/apartment-volume'
import { getProject } from '@/lib/projects/repository'
import { projectLayouts } from '@/lib/shopping/layout'
import {
  addShoppingItem,
  getShoppingList,
  removeShoppingItem,
  setShoppingItemPlacement,
  setShoppingItemSize,
} from '@/lib/shopping/repository'
import { buildPdfData, loadSnapshot, type ProjectSnapshot } from '../../../../jobs/src/lib/pdf-data'
import { printPdf } from '../../../../jobs/src/lib/print-pdf'

vi.mock('server-only', () => ({}))

// Известные синтетические мерки: проверяем передачу данных, а не распознавание обмера.
function geometry(widthCm: number, heightCm: number): PlanGeometry {
  const start = { xCm: 0, yCm: 0 }
  const end = { xCm: widthCm, yCm: 0 }
  const floor = [start, end, { xCm: widthCm, yCm: 300 }, { xCm: 0, yCm: 300 }]
  return {
    version: 1,
    status: 'confirmed',
    source: 'manual',
    widthCm,
    heightCm: 300,
    footprint: floor,
    rooms: [{ name: 'Кухня', polygon: floor }],
    walls: [{ id: 'top', kind: 'outer', start, end, heightCm }],
    openings: [
      {
        id: 'window',
        type: 'window',
        wallId: 'top',
        offsetCm: 100,
        widthCm: 120,
        bottomCm: 90,
        heightCm: 130,
      },
    ],
    kitchenItems: [
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
    ],
    warnings: [],
  }
}

function reading(source: PlanGeometry): PlanReading {
  return {
    readAt: '2026-10-04T00:00:00.000Z',
    planState: 'existing',
    rooms: [{ name: 'Кухня', kind: 'kitchen' }],
    geometry: source,
  }
}

async function pdf(snapshot: ProjectSnapshot) {
  return buildPdfData({
    snapshot,
    kind: 'free',
    options: {},
    rates: { roughRubPerM2: 15_000, finishRubPerM2: 5_000 },
    brief: null,
    summary: null,
  })
}

async function snapshot(projectId: string) {
  const result = await loadSnapshot(projectId)
  if (!result) throw new Error('Не загружен тестовый проект')
  return result
}

describe('согласованный PDF при сохранении и конкурентной правке проекта', () => {
  let ownerId = ''
  let productId = ''

  beforeAll(async () => {
    const url = process.env.DATABASE_URL
    if (!url || !['localhost', '127.0.0.1', '[::1]'].includes(new URL(url).hostname)) {
      throw new Error('Проверка экспорта разрешена только на локальной тестовой БД')
    }
    const run = randomUUID()
    const [owner] = await getDb()
      .insert(users)
      .values({ email: `export-snapshot-${run}@example.test` })
      .returning()
    if (!owner) throw new Error('Не создан тестовый владелец')
    ownerId = owner.id
    const [product] = await getDb()
      .insert(catalogItems)
      .values({
        source: 'dump',
        externalId: `export-chair-${run}`,
        category: 'chair',
        title: 'Синтетический стул',
        priceKopecks: 500_000,
        affiliateUrl: 'https://example.test/chair',
        images: [],
        contentHash: run,
        attributes: { dimensionsCm: { width: 50, depth: 60 } },
      })
      .returning()
    if (!product) throw new Error('Не создан тестовый товар')
    productId = product.id
  })

  afterAll(async () => {
    if (ownerId) await getDb().delete(users).where(eq(users.id, ownerId))
    if (productId) await getDb().delete(catalogItems).where(eq(catalogItems.id, productId))
  })

  async function seed() {
    const [project] = await getDb()
      .insert(projects)
      .values({
        ownerId,
        title: 'Синтетический контроль экспорта',
        planReading: reading(geometry(400, 270)),
      })
      .returning()
    if (!project) throw new Error('Не создан тестовый проект')
    const [room] = await getDb()
      .insert(rooms)
      .values({
        projectId: project.id,
        name: 'Кухня',
        kind: 'kitchen',
        measurements: { widthCm: 400, depthCm: 300, ceilingCm: 270 },
      })
      .returning()
    if (!room) throw new Error('Не создана тестовая комната')
    const { itemId } = await addShoppingItem(ownerId, {
      projectId: project.id,
      roomId: room.id,
      catalogItemId: productId,
    })
    await setShoppingItemSize(ownerId, itemId, { height: 85 })
    await setShoppingItemPlacement(ownerId, itemId, { xCm: 300, yCm: 100, rotation: 0 })
    return { project, room, itemId }
  }

  it('не смешивает старый план с новыми мерками и покупками между SELECT', async () => {
    const { project, room, itemId } = await seed()
    const changed = geometry(500, 310)
    const window = changed.openings[0]
    const cabinet = changed.kitchenItems?.[0]
    if (!window || !cabinet) throw new Error('Нет тестового окна или модуля')
    window.offsetCm = 200
    cabinet.xCm = 180
    let pending: Promise<ProjectSnapshot | null> | undefined

    try {
      await getDb().transaction(async (writer) => {
        // Читатель успевает прочитать проект, но ждёт перед чтением комнат.
        // Это реальный конфликт блокировок PostgreSQL, без подмены результатов запросов.
        await writer.execute(sql`LOCK TABLE rooms IN ACCESS EXCLUSIVE MODE`)
        pending = loadSnapshot(project.id)
        // Устанавливаем обработчик сразу, чтобы ошибка читателя не стала unhandled rejection.
        void pending.catch(() => {})
        let waiting = false
        for (let attempt = 0; attempt < 250; attempt += 1) {
          // pg_stat_activity кешируется внутри транзакции наблюдателя.
          await writer.execute(sql`select pg_stat_clear_snapshot()`)
          const active = await writer.execute<{ waiting: number }>(sql`
            select count(*)::int as waiting from pg_stat_activity
            where datname = current_database() and pid <> pg_backend_pid()
              and wait_event_type = 'Lock' and query like '%"rooms"%'
          `)
          if (active[0]?.waiting) {
            waiting = true
            break
          }
          await new Promise((done) => setTimeout(done, 20))
        }
        expect(waiting, 'Читатель должен ждать между чтением проекта и комнат').toBe(true)
        await writer
          .update(projects)
          .set({ planReading: reading(changed) })
          .where(eq(projects.id, project.id))
        await writer
          .update(rooms)
          .set({ measurements: { widthCm: 500, depthCm: 300, ceilingCm: 310 } })
          .where(eq(rooms.id, room.id))
        await writer
          .update(shoppingListItems)
          .set({
            placementCm: { xCm: 380, yCm: 100, rotation: 0 },
            dimensionsCm: { height: 95 },
          })
          .where(eq(shoppingListItems.id, itemId))
        // Не ждём читателя до commit: иначе блокировка не будет снята.
      })
      const old = await pending
      if (!old) throw new Error('Не получен конкурентный снимок')
      const fresh = await snapshot(project.id)
      expect(old.project.planReading?.geometry?.widthCm).toBe(400)
      expect(old.rooms[0]?.measurements?.widthCm).toBe(400)
      expect(old.shopping[0]?.item.placementCm?.xCm).toBe(300)
      expect(old.shopping[0]?.item.dimensionsCm?.height).toBe(85)
      expect(fresh.project.planReading?.geometry).toEqual(changed)
      expect(fresh.rooms[0]?.measurements?.widthCm).toBe(500)
      expect(fresh.shopping[0]?.item.placementCm?.xCm).toBe(380)
      expect(fresh.shopping[0]?.item.dimensionsCm?.height).toBe(95)
      const oldPdf = await pdf(old)
      const freshPdf = await pdf(fresh)
      expect(oldPdf.rooms[0]?.plan?.widthCm).toBe(400)
      expect(freshPdf.rooms[0]?.plan?.widthCm).toBe(500)
      expect(oldPdf.rooms[0]?.plan?.placed[0]?.xCm).toBe(300)
      expect(freshPdf.rooms[0]?.plan?.placed[0]?.xCm).toBe(380)
    } finally {
      // При ошибке проверок writer откатывается и освобождает читателя.
      await pending?.catch(() => {})
    }
  })

  it('пересобирает сохранённые правки и удаление без устаревших модулей и высот', async () => {
    const { project, room, itemId } = await seed()
    const changed = geometry(500, 310)
    const cabinet = changed.kitchenItems?.[0]
    const wall = changed.walls[0]
    const window = changed.openings[0]
    if (!cabinet || !wall || !window) throw new Error('Нет тестового модуля, стены или окна')
    Object.assign(cabinet, {
      xCm: 180,
      widthCm: 80,
      front: 'right',
      openingDepthCm: 10,
      passageCm: 20,
    })
    delete cabinet.heightCm
    await getDb()
      .update(projects)
      .set({ planReading: reading(changed) })
      .where(eq(projects.id, project.id))
    await getDb()
      .update(rooms)
      .set({ measurements: { widthCm: 500, depthCm: 300, ceilingCm: 310 } })
      .where(eq(rooms.id, room.id))
    await setShoppingItemPlacement(ownerId, itemId, { xCm: 380, yCm: 100, rotation: 90 })
    await setShoppingItemSize(ownerId, itemId, { width: 55.5, height: 95 })

    const saved = await getProject(ownerId, project.id)
    const list = await getShoppingList(ownerId, project.id)
    const layouts = projectLayouts(saved.rooms, list, saved.planReading?.geometry)
    const overview = apartmentVolume(changed, layouts)
    const edited = await pdf(await snapshot(project.id))
    expect(saved.planReading?.geometry).toEqual(changed)
    expect(edited.rooms[0]?.plan).toEqual(layouts[0]?.layout)
    expect(layouts[0]?.layout.placed[0]).toMatchObject({
      xCm: 380,
      yCm: 100,
      widthCm: 60,
      depthCm: 55.5,
    })
    expect(overview.notes).toEqual([])
    expect(overview.model?.furniture?.find((item) => item.itemId === itemId)?.heightCm).toBe(95)
    expect(
      overview.model?.furniture?.find((item) => item.id === 'kitchen:cabinet')?.heightCm,
    ).toBeUndefined()
    const kitchenZones = overview.model?.floorZones?.filter((zone) =>
      zone.id.startsWith('kitchen-zone:'),
    )
    expect(kitchenZones).toHaveLength(2)
    expect(kitchenZones?.[0]?.floor).toEqual([
      { xCm: 260, yCm: 100 },
      { xCm: 290, yCm: 100 },
      { xCm: 290, yCm: 160 },
      { xCm: 260, yCm: 160 },
    ])
    expect(edited.rooms[0]?.measurementNotes?.join(' ')).toContain('высота не указана')
    const editedHtml = renderProjectHtml(edited, { fontCss: fontFaceCss() })

    changed.kitchenItems = []
    delete wall.heightCm
    delete window.heightCm
    delete window.bottomCm
    await getDb()
      .update(projects)
      .set({ planReading: reading(changed) })
      .where(eq(projects.id, project.id))
    await getDb()
      .update(rooms)
      .set({ measurements: { widthCm: 500, depthCm: 300 } })
      .where(eq(rooms.id, room.id))
    await removeShoppingItem(ownerId, itemId)
    const empty = await snapshot(project.id)
    const removed = await pdf(empty)
    expect(removed.rooms[0]?.plan?.widthCm).toBe(500)
    expect(removed.rooms[0]?.plan?.placed).toEqual([])
    expect(removed.rooms[0]?.plan?.keepClearZones).toEqual([])
    expect(removed.rooms[0]?.measurementNotes).toEqual([])
    expect(removed.shopping).toEqual([])
    const restored = empty.project.planReading?.geometry
    if (!restored) throw new Error('Не сохранён пустой план')
    const emptyVolume = apartmentVolume(restored, [])
    expect(emptyVolume.model?.floor).toEqual(changed.footprint)
    expect(emptyVolume.model?.floorZones).toEqual([])
    expect(emptyVolume.model?.walls.every((wall) => wall.topCm === undefined)).toBe(true)
    expect(renderProjectHtml(edited, { fontCss: fontFaceCss() })).toBe(editedHtml)
    expect((await getProject(ownerId, project.id)).planReading?.geometry).toEqual(changed)

    // Артефакты создаются только при явном запуске визуальной проверки, не на каждом CI.
    if (process.env.QA_PRINT_PDF === '1') {
      const output = resolve('../../output/pdf')
      await mkdir(output, { recursive: true })
      for (const [name, data] of [
        ['edited', edited],
        ['removed', removed],
      ] as const) {
        const bytes = await printPdf(
          renderProjectHtml(data, { fontCss: fontFaceCss() }),
          data.project.title,
        )
        expect(bytes.subarray(0, 5).toString()).toBe('%PDF-')
        await writeFile(resolve(output, `qa-snapshot-${name}.pdf`), bytes)
      }
    }
  })
})
