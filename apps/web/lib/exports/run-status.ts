import { runs } from '@trigger.dev/sdk'
import { getEnv } from '@/lib/env'
import { isTerminalRunStatus } from '@/lib/queue/run-status'

export class ExportStatusUnknownError extends Error {
  constructor() {
    super(
      'Статус сборки пока не подтверждён. Сборка могла начаться. Сначала проверьте статус, прежде чем запускать новую.',
    )
  }
}

export function exportRunTag(exportId: string): string {
  return `project-export:${exportId}`
}

export async function exportQueueStatus(exportId: string, savedRunId: string | null) {
  if (!getEnv().TRIGGER_SECRET_KEY) throw new ExportStatusUnknownError()
  let timer: ReturnType<typeof setTimeout> | undefined
  try {
    return await Promise.race([
      (async () => {
        let runId = savedRunId
        if (!runId) {
          const page = await runs.list(
            { taskIdentifier: 'export-pdf', tag: exportRunTag(exportId), limit: 2 },
            { retry: { maxAttempts: 1 } },
          )
          if (page.data.length !== 1 || !page.data[0]) throw new ExportStatusUnknownError()
          runId = page.data[0].id
        }
        const run = await runs.retrieve(runId, { retry: { maxAttempts: 1 } })
        return { runId, terminal: isTerminalRunStatus(run.status) }
      })(),
      new Promise<never>((_, reject) => {
        timer = setTimeout(() => reject(new ExportStatusUnknownError()), 4000)
      }),
    ])
  } catch {
    throw new ExportStatusUnknownError()
  } finally {
    clearTimeout(timer)
  }
}
