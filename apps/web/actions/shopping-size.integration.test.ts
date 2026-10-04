import assert from 'node:assert/strict'
import { randomUUID } from 'node:crypto'
import { mkdir, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { catalogItems, projects, rooms, shoppingLists, users } from '@uyut/db'
import { fontFaceCss, renderProjectHtml } from '@uyut/pdf'
import { eq } from 'drizzle-orm'
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest'
import { getDb } from '@/lib/db'
import { addShoppingItem, getShoppingList } from '@/lib/shopping/repository'
import { buildPdfData, loadSnapshot } from '../../../jobs/src/lib/pdf-data'
import { printPdf } from '../../../jobs/src/lib/print-pdf'

const session = vi.hoisted(() => ({ userId: '' }))
vi.mock('@/lib/session', () => ({
  getSession: async () => ({ user: { id: session.userId } }),
}))
vi.mock('@/lib/audit', () => ({ recordAudit: vi.fn() }))
vi.mock('next/cache', () => ({ revalidatePath: vi.fn() }))
vi.mock('@/lib/projects/repository', () => ({ updateRoom: vi.fn() }))

import { setItemOperationClearance, setItemPlacement, setItemSize } from './shopping'

const run = randomUUID()
let projectId = ''
let productId = ''
let itemId = ''

async function printedHtml(stage: 'first' | 'second') {
  const snapshot = await loadSnapshot(projectId)
  assert(snapshot)
  const data = await buildPdfData({
    snapshot,
    kind: 'free',
    options: {},
    rates: { roughRubPerM2: 15000, finishRubPerM2: 5000 },
    brief: null,
    summary: null,
  })
  const html = renderProjectHtml(data, { fontCss: fontFaceCss() })
  // Необязательная локальная печать для визуальной приёмки тем же принтером, что в worker.
  const output = process.env.QA_SIZE_PDF_OUTPUT
  if (output) {
    await mkdir(output, { recursive: true })
    await writeFile(join(output, `size-${stage}.pdf`), await printPdf(html, data.project.title))
  }
  return html
}

describe('сохранение дробных мерок через действие и настоящую базу', () => {
  beforeAll(async () => {
    const connection = new URL(process.env.DATABASE_URL ?? '')
    if (!['localhost', '127.0.0.1'].includes(connection.hostname) || connection.port === '58032') {
      throw new Error(
        'Этот тест запускается только в отдельной локальной базе, не через production-туннель',
      )
    }
    const db = getDb()
    const [owner] = await db
      .insert(users)
      .values({ email: `size-${run}@example.test` })
      .returning()
    assert(owner)
    session.userId = owner.id
    const [project] = await db
      .insert(projects)
      .values({
        ownerId: session.userId,
        title: `Проверка дробных мерок ${run}`,
      })
      .returning()
    assert(project)
    projectId = project.id
    const [room] = await db
      .insert(rooms)
      .values({
        projectId,
        kind: 'living',
        name: 'Гостиная',
        areaM2: 20,
      })
      .returning()
    const [product] = await db
      .insert(catalogItems)
      .values({
        source: 'dump',
        externalId: `size-${run}`,
        category: 'chair',
        title: 'Стул для проверки мерок',
        priceKopecks: 10000,
        affiliateUrl: 'https://example.test/chair',
        images: [],
        inStock: true,
        contentHash: run,
      })
      .returning()
    assert(product && room)
    productId = product.id
    itemId = (
      await addShoppingItem(session.userId, {
        projectId,
        roomId: room.id,
        catalogItemId: productId,
      })
    ).itemId
  })

  afterAll(async () => {
    const db = getDb()
    if (projectId) {
      await db.delete(shoppingLists).where(eq(shoppingLists.projectId, projectId))
      await db.delete(projects).where(eq(projects.id, projectId))
    }
    if (productId) await db.delete(catalogItems).where(eq(catalogItems.id, productId))
    if (session.userId) await db.delete(users).where(eq(users.id, session.userId))
  })

  it('повторное чтение сохраняет габариты, положение и рабочую зону без округления', async () => {
    expect((await setItemSize(itemId, { width: '105,6', depth: '70.4', height: '85,2' })).ok).toBe(
      true,
    )
    expect(
      (await setItemOperationClearance(itemId, { front: '50,4', side: '', around: '' })).ok,
    ).toBe(true)
    expect(
      (
        await setItemPlacement(itemId, {
          mode: 'exact',
          xCm: '220,4',
          yCm: '200,2',
          rotation: '90',
        })
      ).ok,
    ).toBe(true)
    const item = (await getShoppingList(session.userId, projectId)).items[0]
    assert(item)
    expect(item.dimensionsCm).toEqual({ width: 105.6, depth: 70.4, height: 85.2 })
    expect(item.operationClearanceCm).toEqual({ front: 50.4 })
    expect(item.placementCm).toEqual({ xCm: 220.4, yCm: 200.2, rotation: 90 })
    expect(await printedHtml('first')).toContain('ширина 105.6 см, глубина 70.4 см, высота 85.2 см')
  })

  it('удалённая высота не возвращается при повторном чтении', async () => {
    expect((await setItemSize(itemId, { width: '105,6', depth: '70,4', height: '' })).ok).toBe(true)
    expect((await getShoppingList(session.userId, projectId)).items[0]?.dimensionsCm).toEqual({
      width: 105.6,
      depth: 70.4,
    })
    const printed = await printedHtml('second')
    expect(printed).toContain('ширина 105.6 см, глубина 70.4 см')
    expect(printed).not.toContain('высота 85.2 см')
  })
})
