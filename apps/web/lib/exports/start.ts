import { ApiError, tasks, auth as triggerAuth } from '@trigger.dev/sdk'
import type { ExportKind, ExportOptions } from '@uyut/db'
import { recordAudit } from '@/lib/audit'
import { attachRun, claimExport, getExport, markExportFailed } from '@/lib/exports/repository'

import { ExportStatusUnknownError, exportRunTag } from './run-status'

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
  let created = await claimExport(userId, projectId, options)
  if (created.existing) {
    const current = await getExport(userId, created.id)
    // Сборка могла закончиться, пока повторный запрос проверял очередь.
    // Показываем её результат через проверку статуса, а не запускаем ещё один PDF.
    if (current.status !== 'failed') throw new ExportStatusUnknownError()
    created = await claimExport(userId, projectId, options)
    if (created.existing) throw new ExportStatusUnknownError()
  }
  let handle: Awaited<ReturnType<typeof tasks.trigger>>
  try {
    handle = await tasks.trigger(
      'export-pdf',
      { exportId: created.id },
      { idempotencyKey: created.id, tags: [exportRunTag(created.id)] },
      { retry: { maxAttempts: 1 } },
    )
  } catch (error) {
    if (error instanceof ApiError && [400, 401, 403, 404, 422, 429].includes(error.status ?? 0)) {
      await markExportFailed(created.id, `очередь отклонила задачу: ${String(error)}`)
      throw error
    }
    throw new ExportStatusUnknownError()
  }
  try {
    await attachRun(created.id, handle.id)
    await recordAudit({
      action: 'export.requested',
      actorId: userId,
      targetType: 'project_export',
      targetId: created.id,
      metadata: { projectId, kind: created.kind, runId: handle.id, options },
    }).catch((error) => console.error('export audit failed', error))
    const accessToken =
      handle.publicAccessToken ??
      (await triggerAuth.createPublicToken({ scopes: { read: { runs: [handle.id] } } }))
    return { exportId: created.id, runId: handle.id, accessToken, kind: created.kind }
  } catch {
    throw new ExportStatusUnknownError()
  }
}
