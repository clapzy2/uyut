import type { projectExports } from '@uyut/db'
import { beforeEach, expect, it, vi } from 'vitest'

const head = vi.hoisted(() => vi.fn())
vi.mock('@/lib/storage', () => ({ inspectObject: head }))

import { recoverableUpload } from './upload-recovery'

const digest = 'a'.repeat(64)
const row = {
  id: 'export',
  projectId: 'project',
  kind: 'free',
  pages: 7,
  pdfKey: `projects/project/exports/export-${digest}.pdf`,
} as typeof projectExports.$inferSelect
const object = {
  ContentType: 'application/pdf',
  ContentLength: 1234,
  Metadata: { 'export-id': 'export', 'pdf-sha256': digest },
}
beforeEach(() => {
  vi.resetAllMocks()
  head.mockResolvedValue(object)
})
it('accepts only the matching uploaded checkpoint', async () => {
  expect(await recoverableUpload(row)).toBe('ready')
  expect(head).toHaveBeenCalledWith(row.pdfKey)
})
it.each([
  { ContentType: 'image/png' },
  { ContentLength: 0 },
  { Metadata: { 'export-id': 'other', 'pdf-sha256': digest } },
  { Metadata: { 'export-id': 'export', 'pdf-sha256': 'b'.repeat(64) } },
])('keeps mismatched object unknown: %j', async (patch) => {
  head.mockResolvedValue({ ...object, ...patch })
  expect(await recoverableUpload(row)).toBe('unknown')
})
it('distinguishes missing object from inaccessible storage', async () => {
  head.mockResolvedValueOnce(null).mockRejectedValueOnce(new Error('403'))
  expect(await recoverableUpload(row)).toBe('missing')
  expect(await recoverableUpload(row)).toBe('unknown')
})
it('does not probe legacy keys or another project', async () => {
  expect(await recoverableUpload({ ...row, pdfKey: 'projects/project/exports/export.pdf' })).toBe(
    'legacy',
  )
  expect(await recoverableUpload({ ...row, projectId: 'other' })).toBe('legacy')
  expect(head).not.toHaveBeenCalled()
})
it('requires valid pages and the paid brief before trusting the file', async () => {
  expect(await recoverableUpload({ ...row, pages: 0 })).toBe('unknown')
  expect(await recoverableUpload({ ...row, kind: 'paid', brief: null })).toBe('unknown')
  expect(head).not.toHaveBeenCalled()
})
