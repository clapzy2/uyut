import {
  type ExportKind,
  type ExportOptions,
  type ExportStatus,
  type ProjectContact,
  projectExports,
  projects,
} from '@uyut/db'
import { desc, eq } from 'drizzle-orm'
import { getDb } from '@/lib/db'
import { getEnv } from '@/lib/env'
import { assertOwnerOrCollaborator, isUuid, NotFoundError } from '@/lib/projects/access'
import { presignedObjectUrl } from '@/lib/storage'

export type ExportView = {
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

async function toView(row: typeof projectExports.$inferSelect): Promise<ExportView> {
  const ttl = getEnv().PDF_URL_TTL_HOURS * 60 * 60
  return {
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
  return Promise.all(rows.map(toView))
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
  return toView(row)
}

/** Оплаченный проект получает чистый документ, остальные — с водяным знаком */
export async function createExport(
  userId: string,
  projectId: string,
  options: ExportOptions,
): Promise<{ id: string; kind: ExportKind }> {
  const project = await assertOwnerOrCollaborator(userId, projectId)
  const kind: ExportKind = project.isPaid ? 'paid' : 'free'
  const [row] = await getDb()
    .insert(projectExports)
    .values({ projectId: project.id, kind, options })
    .returning({ id: projectExports.id })
  if (!row) {
    throw new Error('export insert returned nothing')
  }
  return { id: row.id, kind }
}

export async function attachRun(exportId: string, runId: string): Promise<void> {
  await getDb().update(projectExports).set({ runId }).where(eq(projectExports.id, exportId))
}

export async function markExportFailed(exportId: string, error: string): Promise<void> {
  await getDb()
    .update(projectExports)
    .set({ status: 'failed', error: error.slice(0, 500), finishedAt: new Date() })
    .where(eq(projectExports.id, exportId))
}

/** Имя, адрес и телефон хранятся в проекте; в документ попадают только по галочкам */
export async function saveContact(
  userId: string,
  projectId: string,
  contact: ProjectContact,
): Promise<void> {
  const project = await assertOwnerOrCollaborator(userId, projectId)
  const merged: ProjectContact = { ...(project.contact ?? {}), ...contact }
  await getDb().update(projects).set({ contact: merged }).where(eq(projects.id, project.id))
}
