import { randomUUID } from 'node:crypto'
import { projectExports, projects, users } from '@uyut/db'
import { eq } from 'drizzle-orm'
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest'
import { getDb } from '@/lib/db'
import { NotFoundError } from '@/lib/projects/access'
import {
  attachRun,
  claimExport,
  createExport,
  getExport,
  listExports,
  saveContact,
} from './repository'

const queue = vi.hoisted(() => ({ retrieve: vi.fn(), list: vi.fn() }))
const head = vi.hoisted(() => vi.fn())
vi.mock('@/lib/storage', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/lib/storage')>()),
  inspectObject: head,
}))
vi.mock('@trigger.dev/sdk', () => ({ runs: queue }))
vi.mock('@/lib/env', async (importOriginal) => {
  const original = await importOriginal<typeof import('@/lib/env')>()
  return { ...original, getEnv: () => ({ ...original.getEnv(), TRIGGER_SECRET_KEY: 'test-only' }) }
})
queue.retrieve.mockResolvedValue({ status: 'EXECUTING' })
queue.list.mockResolvedValue({ data: [{ id: 'run-test' }] })

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
  it('serializes concurrent claims for a project', async () => {
    await getDb().delete(projectExports).where(eq(projectExports.projectId, paidProjectId))
    const claims = await Promise.all(
      Array.from({ length: 8 }, () => claimExport(ownerId, paidProjectId, {})),
    )
    expect(new Set(claims.map((claim) => claim.id)).size).toBe(1)
    expect(claims.filter((claim) => !claim.existing)).toHaveLength(1)
  })
  it('keeps an old queued export active and reconciles only terminal status', async () => {
    const created = await createExport(ownerId, freeProjectId, {})
    await attachRun(created.id, 'run-old')
    await getDb()
      .update(projectExports)
      .set({ createdAt: new Date(0), status: 'running' })
      .where(eq(projectExports.id, created.id))
    queue.retrieve.mockResolvedValue({ status: 'QUEUED' })
    expect((await getExport(ownerId, created.id)).status).toBe('running')
    queue.retrieve.mockRejectedValueOnce(new Error('Network'))
    expect(await getExport(ownerId, created.id)).toMatchObject({
      status: 'running',
      statusUnconfirmed: true,
    })
    queue.retrieve.mockResolvedValue({ status: 'FAILED' })
    expect((await getExport(ownerId, created.id)).status).toBe('failed')
    queue.retrieve.mockResolvedValue({ status: 'EXECUTING' })
  })

  it('does not return a stale failure when the worker saves the PDF during queue lookup', async () => {
    const created = await createExport(ownerId, freeProjectId, {})
    await attachRun(created.id, 'run-race')
    queue.retrieve.mockImplementationOnce(async () => {
      await getDb()
        .update(projectExports)
        .set({ status: 'ready', pdfKey: 'race.pdf' })
        .where(eq(projectExports.id, created.id))
      return { status: 'COMPLETED' }
    })
    expect((await getExport(ownerId, created.id)).status).toBe('ready')
  })

  it('returns a saved PDF even when the concurrent queue lookup fails', async () => {
    const created = await createExport(ownerId, freeProjectId, {})
    await attachRun(created.id, 'run-queue-unavailable')
    queue.retrieve.mockImplementationOnce(async () => {
      await getDb()
        .update(projectExports)
        .set({ status: 'ready', pdfKey: 'queue-unavailable.pdf' })
        .where(eq(projectExports.id, created.id))
      throw new Error('Queue unavailable after PDF was saved')
    })
    const result = await getExport(ownerId, created.id)
    expect(result.status).toBe('ready')
    expect(result.pdfUrl).toContain('queue-unavailable.pdf')
    expect(result.statusUnconfirmed).not.toBe(true)
  })

  async function checkpoint() {
    const created = await createExport(ownerId, freeProjectId, {})
    const digest = 'a'.repeat(64)
    const pdfKey = `projects/${freeProjectId}/exports/${created.id}-${digest}.pdf`
    await getDb()
      .update(projectExports)
      .set({
        status: 'running',
        pdfKey,
        pages: 7,
        durationMs: null,
      })
      .where(eq(projectExports.id, created.id))
    head.mockReset()
    head.mockResolvedValue({
      ContentType: 'application/pdf',
      ContentLength: 100,
      Metadata: { 'export-id': created.id, 'pdf-sha256': digest },
    })
    queue.retrieve.mockResolvedValue({ status: 'FAILED' })
    return { ...created, pdfKey }
  }

  it.each([false, true])(
    'recovers the same uploaded PDF; queue unavailable=%s',
    async (unavailable) => {
      const saved = await checkpoint()
      if (unavailable) queue.retrieve.mockRejectedValueOnce(new Error('Network'))
      const result = await getExport(ownerId, saved.id)
      expect(result.status).toBe('ready')
      expect(result.pdfUrl).toContain(saved.id)
      expect(result.durationMs).toBeNull()
      expect(result.error).toBeNull()
      expect(result.finishedAt).toBeInstanceOf(Date)
    },
  )

  it('keeps unknown storage reserved, but releases confirmed missing after terminal queue', async () => {
    const saved = await checkpoint()
    head.mockRejectedValueOnce(new Error('403'))
    expect(await getExport(ownerId, saved.id)).toMatchObject({
      status: 'running',
      statusUnconfirmed: true,
    })
    head.mockResolvedValueOnce(null)
    expect((await getExport(ownerId, saved.id)).status).toBe('failed')
  })

  it('does not probe storage while the task is executing', async () => {
    const saved = await checkpoint()
    queue.retrieve.mockResolvedValueOnce({ status: 'EXECUTING' })
    expect((await getExport(ownerId, saved.id)).status).toBe('running')
    expect(head).not.toHaveBeenCalled()
  })

  it('does not confirm a checkpoint replaced during HEAD', async () => {
    const saved = await checkpoint()
    const object = await head()
    head.mockImplementationOnce(async () => {
      await getDb()
        .update(projectExports)
        .set({ pdfKey: saved.pdfKey.replace(/a{64}/, 'b'.repeat(64)) })
        .where(eq(projectExports.id, saved.id))
      return object
    })
    expect(await getExport(ownerId, saved.id)).toMatchObject({
      status: 'running',
      statusUnconfirmed: true,
    })
  })
})
