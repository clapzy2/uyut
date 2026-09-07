'use server'

import { tasks, auth as triggerAuth } from '@trigger.dev/sdk'
import { revalidatePath } from 'next/cache'
import { z } from 'zod'
import { recordAudit } from '@/lib/audit'
import { getEnv } from '@/lib/env'
import {
  attachRun,
  createExport,
  type ExportView,
  getExport,
  listExports,
  markExportFailed,
  saveContact,
} from '@/lib/exports/repository'
import { NotFoundError } from '@/lib/projects/access'
import { getExportsByUserLimiter } from '@/lib/redis'
import { getSession } from '@/lib/session'

export type ActionResult<T = undefined> = { ok: true; data: T } | { ok: false; error: string }

const SESSION_EXPIRED = 'Сессия закончилась. Войдите снова.'
const GENERIC = 'Не получилось. Попробуйте ещё раз, а если повторится, напишите нам.'
const NO_QUEUE = 'Сборка PDF пока не подключена: в настройках сервиса нет ключа очереди.'

const optionalText = (max: number) =>
  z.preprocess(
    (value) => (typeof value === 'string' && value.trim() === '' ? undefined : value),
    z.string().trim().max(max).optional(),
  )

const exportInputSchema = z.object({
  projectId: z.uuid(),
  options: z
    .object({
      includeClientName: z.boolean().optional(),
      includeAddress: z.boolean().optional(),
      includePhone: z.boolean().optional(),
    })
    .default({}),
  contact: z
    .object({
      clientName: optionalText(80),
      address: optionalText(200),
      phone: optionalText(30),
    })
    .optional(),
})

export type ExportInput = z.input<typeof exportInputSchema>

export type ExportRun = {
  exportId: string
  runId: string
  accessToken: string
  kind: 'free' | 'paid'
}

async function currentUserId(): Promise<string | null> {
  const session = await getSession()
  return session?.user.id ?? null
}

function failure(error: unknown): { ok: false; error: string } {
  if (error instanceof NotFoundError) {
    return { ok: false, error: error.message }
  }
  console.error(error)
  return { ok: false, error: GENERIC }
}

/** Запускает сборку PDF; кнопка одна, а водяной знак решается по оплате проекта */
export async function exportProjectPdf(input: ExportInput): Promise<ActionResult<ExportRun>> {
  const userId = await currentUserId()
  if (!userId) {
    return { ok: false, error: SESSION_EXPIRED }
  }
  const parsed = exportInputSchema.safeParse(input)
  if (!parsed.success) {
    return { ok: false, error: 'Проверьте поля: что-то не прошло проверку.' }
  }
  if (!getEnv().TRIGGER_SECRET_KEY) {
    return { ok: false, error: NO_QUEUE }
  }
  const { projectId, options, contact } = parsed.data
  try {
    const { success } = await getExportsByUserLimiter().limit(userId)
    if (!success) {
      return { ok: false, error: 'Слишком много сборок подряд. Попробуйте через час.' }
    }
    if (contact) {
      await saveContact(userId, projectId, contact)
    }
    const created = await createExport(userId, projectId, options)
    let handle: Awaited<ReturnType<typeof tasks.trigger>>
    try {
      handle = await tasks.trigger('export-pdf', { exportId: created.id })
    } catch (error) {
      await markExportFailed(created.id, `очередь не приняла задачу: ${String(error)}`)
      throw error
    }
    await attachRun(created.id, handle.id)
    await recordAudit({
      action: 'export.requested',
      actorId: userId,
      targetType: 'project_export',
      targetId: created.id,
      metadata: { projectId, kind: created.kind, runId: handle.id, options },
    })
    const accessToken =
      handle.publicAccessToken ??
      (await triggerAuth.createPublicToken({ scopes: { read: { runs: [handle.id] } } }))
    revalidatePath(`/projects/${projectId}/summary`)
    return {
      ok: true,
      data: { exportId: created.id, runId: handle.id, accessToken, kind: created.kind },
    }
  } catch (error) {
    return failure(error)
  }
}

export async function loadExports(projectId: string): Promise<ActionResult<ExportView[]>> {
  const userId = await currentUserId()
  if (!userId) {
    return { ok: false, error: SESSION_EXPIRED }
  }
  try {
    return { ok: true, data: await listExports(userId, projectId) }
  } catch (error) {
    return failure(error)
  }
}

export async function loadExport(exportId: string): Promise<ActionResult<ExportView>> {
  const userId = await currentUserId()
  if (!userId) {
    return { ok: false, error: SESSION_EXPIRED }
  }
  try {
    return { ok: true, data: await getExport(userId, exportId) }
  } catch (error) {
    return failure(error)
  }
}
