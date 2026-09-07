import { randomUUID } from 'node:crypto'
import { projectExports, projects, users } from '@uyut/db'
import { eq } from 'drizzle-orm'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { getDb } from '@/lib/db'
import { NotFoundError } from '@/lib/projects/access'
import { attachRun, createExport, getExport, listExports, saveContact } from './repository'

// Настоящая база: владелец, чужой пользователь, неоплаченный и оплаченный проекты
const run = randomUUID().slice(0, 8)
let ownerId = ''
let strangerId = ''
let freeProjectId = ''
let paidProjectId = ''

describe('project exports in a real database', () => {
  beforeAll(async () => {
    const db = getDb()
    const [owner] = await db
      .insert(users)
      .values({ email: `export-owner-${run}@example.test` })
      .returning({ id: users.id })
    const [stranger] = await db
      .insert(users)
      .values({ email: `export-stranger-${run}@example.test` })
      .returning({ id: users.id })
    ownerId = owner?.id ?? ''
    strangerId = stranger?.id ?? ''
    const [free] = await db
      .insert(projects)
      .values({ ownerId, title: `Бесплатный ${run}` })
      .returning({ id: projects.id })
    const [paid] = await db
      .insert(projects)
      .values({ ownerId, title: `Оплаченный ${run}`, isPaid: true })
      .returning({ id: projects.id })
    freeProjectId = free?.id ?? ''
    paidProjectId = paid?.id ?? ''
  })

  afterAll(async () => {
    const db = getDb()
    await db.delete(projects).where(eq(projects.id, freeProjectId))
    await db.delete(projects).where(eq(projects.id, paidProjectId))
    await db.delete(users).where(eq(users.id, ownerId))
    await db.delete(users).where(eq(users.id, strangerId))
  })

  it('creates a watermarked export for an unpaid project and a clean one for a paid project', async () => {
    const free = await createExport(ownerId, freeProjectId, { includeAddress: true })
    const paid = await createExport(ownerId, paidProjectId, {})
    expect(free.kind).toBe('free')
    expect(paid.kind).toBe('paid')
    const view = await getExport(ownerId, free.id)
    expect(view.status).toBe('pending')
    expect(view.options).toEqual({ includeAddress: true })
    expect(view.pdfUrl).toBeNull()
  })

  it('lists exports newest first and signs a link only for ready files', async () => {
    const first = await createExport(ownerId, freeProjectId, {})
    await attachRun(first.id, 'run_test')
    await getDb()
      .update(projectExports)
      .set({
        status: 'ready',
        pdfKey: `projects/${freeProjectId}/exports/${first.id}.pdf`,
        pages: 9,
      })
      .where(eq(projectExports.id, first.id))
    const list = await listExports(ownerId, freeProjectId)
    expect(list[0]?.id).toBe(first.id)
    expect(list[0]?.runId).toBe('run_test')
    expect(list[0]?.pdfUrl).toMatch(/exports\//)
    expect(list.find((item) => item.status === 'pending')?.pdfUrl).toBeNull()
  })

  it('keeps contact details on the project without wiping other fields', async () => {
    await saveContact(ownerId, freeProjectId, { clientName: 'Анна', phone: '+7 900 000-00-00' })
    await saveContact(ownerId, freeProjectId, { address: 'Мира, 10' })
    const [project] = await getDb()
      .select({ contact: projects.contact })
      .from(projects)
      .where(eq(projects.id, freeProjectId))
    expect(project?.contact).toEqual({
      clientName: 'Анна',
      phone: '+7 900 000-00-00',
      address: 'Мира, 10',
    })
  })

  it('hides exports from a stranger', async () => {
    const [existing] = await listExports(ownerId, freeProjectId)
    await expect(listExports(strangerId, freeProjectId)).rejects.toBeInstanceOf(NotFoundError)
    await expect(createExport(strangerId, freeProjectId, {})).rejects.toBeInstanceOf(NotFoundError)
    if (existing) {
      await expect(getExport(strangerId, existing.id)).rejects.toBeInstanceOf(NotFoundError)
    }
  })
})
