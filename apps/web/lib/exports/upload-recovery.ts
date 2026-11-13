import type { projectExports } from '@uyut/db'
import { inspectObject } from '@/lib/storage'

type ExportRow = typeof projectExports.$inferSelect
export type UploadRecovery = 'legacy' | 'ready' | 'missing' | 'unknown'

export async function recoverableUpload(row: ExportRow): Promise<UploadRecovery> {
  const prefix = `projects/${row.projectId}/exports/${row.id}-`
  if (!row.pdfKey?.startsWith(prefix)) return 'legacy'
  const suffix = row.pdfKey.slice(prefix.length)
  if (!/^[a-f0-9]{64}\.pdf$/.test(suffix)) return 'unknown'
  if (!row.pages || row.pages < 1 || (row.kind === 'paid' && !row.brief)) return 'unknown'
  try {
    const object = await inspectObject(row.pdfKey)
    if (!object) return 'missing'
    const digest = suffix.slice(0, 64)
    return object.ContentType === 'application/pdf' &&
      (object.ContentLength ?? 0) > 0 &&
      object.Metadata?.['export-id'] === row.id &&
      object.Metadata?.['pdf-sha256'] === digest
      ? 'ready'
      : 'unknown'
  } catch {
    return 'unknown'
  }
}
