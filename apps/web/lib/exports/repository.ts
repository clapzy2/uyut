import {
  type ExportKind,
  type ExportOptions,
  type ExportStatus,
  type ProjectContact,
  projectExports,
  projects,
} from '@uyut/db'
import { and, desc, eq, inArray } from 'drizzle-orm'
import { getPlan } from '@/lib/billing/repository'
import { getDb } from '@/lib/db'
import { getEnv } from '@/lib/env'
import {
  assertOwner,
  assertOwnerOrCollaborator,
  isUuid,
  NotFoundError,
} from '@/lib/projects/access'
import { presignedObjectUrl } from '@/lib/storage'
import { exportQueueStatus } from './run-status'

export type ExportView = {
  statusUnconfirmed?: boolean
  id: string
  kind: ExportKind
  status: ExportStatus
  options: ExportOptions
  /** Подписанная ссылка на файл, пока экспорт готов */
  pdfUrl: string | null
  pages: number | null
  durationMs: number | null
  error: string | null
  runId: string | null
  createdAt: Date
  finishedAt: Date | null
}

async function toView(
  row: typeof projectExports.$inferSelect & { statusUnconfirmed?: boolean },
): Promise<ExportView> {
  const ttl = getEnv().PDF_URL_TTL_HOURS * 60 * 60
  return {
    statusUnconfirmed: row.statusUnconfirmed,
    id: row.id,
    kind: row.kind,
    status: row.status,
    options: row.options ?? {},
    pdfUrl: row.status === 'ready' && row.pdfKey ? await presignedObjectUrl(row.pdfKey, ttl) : null,
    pages: row.pages,
    durationMs: row.durationMs,
    error: row.error,
    runId: row.runId,
    createdAt: row.createdAt,
    finishedAt: row.finishedAt,
  }
}

async function reconcile(rows: Array<typeof projectExports.$inferSelect>) {
  return Promise.all(
    rows.map(async (row) => {
      if (row.status !== 'pending' && row.status !== 'running') return row
      const status = await exportQueueStatus(row.id, row.runId).catch(() => null)
      if (!status) return { ...row, statusUnconfirmed: true }
      if (status.terminal) {
        await getDb()
          .update(projectExports)
          .set({
            status: 'failed',
            error: 'Задача завершилась без готового PDF. Можно собрать заново.',
            finishedAt: new Date(),
          })
          .where(
            and(
              eq(projectExports.id, row.id),
              inArray(projectExports.status, ['pending', 'running']),
            ),
          )
      } else if (!row.runId) {
        await attachRun(row.id, status.runId)
      }
      // The worker may have saved the PDF while the queue request was in flight.
      const [fresh] = await getDb()
        .select()
        .from(projectExports)
        .where(eq(projectExports.id, row.id))
      return fresh ?? row
    }),
  )
}

export async function listExports(
  userId: string,
  projectId: string,
  limit = 5,
): Promise<ExportView[]> {
  const project = await assertOwnerOrCollaborator(userId, projectId)
  const rows = await getDb()
    .select()
    .from(projectExports)
    .where(eq(projectExports.projectId, project.id))
    .orderBy(desc(projectExports.createdAt))
    .limit(limit)
  return Promise.all((await reconcile(rows)).map(toView))
}

export async function getExport(userId: string, exportId: string): Promise<ExportView> {
  if (!isUuid(exportId)) {
    throw new NotFoundError('Экспорт не найден')
  }
  const [row] = await getDb()
    .select()
    .from(projectExports)
    .where(eq(projectExports.id, exportId))
    .limit(1)
  if (!row) {
    throw new NotFoundError('Экспорт не найден')
  }
  await assertOwnerOrCollaborator(userId, row.projectId)
  return toView((await reconcile([row]))[0] ?? row)
}

/** Оплаченный проект или владелец с Pro получают чистый документ, остальные — с водяным знаком */
export async function createExport(
  userId: string,
  projectId: string,
  options: ExportOptions,
): Promise<{ id: string; kind: ExportKind }> {
  const project = await assertOwner(userId, projectId)
  const kind: ExportKind = project.isPaid || (await getPlan(userId)) === 'pro' ? 'paid' : 'free'
  const [row] = await getDb()
    .insert(projectExports)
    .values({ projectId: project.id, kind, options })
    .returning({ id: projectExports.id })
  if (!row) {
    throw new Error('export insert returned nothing')
  }
  return { id: row.id, kind }
}

export async function claimExport(userId: string, projectId: string, options: ExportOptions) {
  const project = await assertOwner(userId, projectId)
  const kind: ExportKind = project.isPaid || (await getPlan(userId)) === 'pro' ? 'paid' : 'free'
  return getDb().transaction(async (tx) => {
    await tx
      .select({ id: projects.id })
      .from(projects)
      .where(eq(projects.id, project.id))
      .for('update')
    const [active] = await tx
      .select()
      .from(projectExports)
      .where(
        and(
          eq(projectExports.projectId, project.id),
          inArray(projectExports.status, ['pending', 'running']),
        ),
      )
      .limit(1)
    if (active) return { id: active.id, kind: active.kind, existing: true }
    const [created] = await tx
      .insert(projectExports)
      .values({ projectId: project.id, kind, options })
      .returning({ id: projectExports.id })
    if (!created) throw new Error('export insert returned nothing')
    return { id: created.id, kind, existing: false }
  })
}

export async function attachRun(exportId: string, runId: string): Promise<void> {
  await getDb()
    .update(projectExports)
    .set({ runId })
    .where(
      and(eq(projectExports.id, exportId), inArray(projectExports.status, ['pending', 'running'])),
    )
}

export async function markExportFailed(exportId: string, error: string): Promise<void> {
  await getDb()
    .update(projectExports)
    .set({ status: 'failed', error: error.slice(0, 500), finishedAt: new Date() })
    .where(
      and(eq(projectExports.id, exportId), inArray(projectExports.status, ['pending', 'running'])),
    )
}

/** Имя, адрес и телефон хранятся в проекте; в документ попадают только по галочкам */
export async function saveContact(
  userId: string,
  projectId: string,
  contact: ProjectContact,
): Promise<void> {
  const project = await assertOwner(userId, projectId)
  const merged: ProjectContact = { ...(project.contact ?? {}), ...contact }
  await getDb().update(projects).set({ contact: merged }).where(eq(projects.id, project.id))
}
