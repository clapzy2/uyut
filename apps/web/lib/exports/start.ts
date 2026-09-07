import { tasks, auth as triggerAuth } from '@trigger.dev/sdk'
import type { ExportKind, ExportOptions } from '@uyut/db'
import { recordAudit } from '@/lib/audit'
import { attachRun, createExport, markExportFailed } from '@/lib/exports/repository'

export type ExportRun = {
  exportId: string
  runId: string
  accessToken: string
  kind: ExportKind
}

/**
 * Создаёт запись экспорта и ставит задачу в очередь. Общий путь для кнопки на странице итогов
 * и для автоматической сборки чистого документа после оплаты.
 */
export async function startExport(
  userId: string,
  projectId: string,
  options: ExportOptions,
): Promise<ExportRun> {
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
  return { exportId: created.id, runId: handle.id, accessToken, kind: created.kind }
}
