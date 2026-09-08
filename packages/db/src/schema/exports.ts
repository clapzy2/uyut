import { index, integer, jsonb, pgTable, text, timestamp, uuid } from 'drizzle-orm/pg-core'
import { projects } from './projects'

export const exportKinds = ['free', 'paid'] as const
export type ExportKind = (typeof exportKinds)[number]

export const exportStatuses = ['pending', 'running', 'ready', 'failed'] as const
export type ExportStatus = (typeof exportStatuses)[number]

/** Что из личных данных попадает в PDF; по умолчанию ничего */
export type ExportOptions = {
  includeClientName?: boolean
  includeAddress?: boolean
  includePhone?: boolean
}

/** ТЗ мастеру: разделы по комнатам и вопросы заказчику, как их отдала модель */
export type ContractorBrief = {
  summary?: string
  rooms: Array<{ name: string; sections: Array<{ title: string; items: string[] }> }>
  questions: string[]
}

// История экспортов PDF. Хранит ключ файла в приватном bucket, кэш ТЗ и хэш входных данных:
// повторный экспорт без изменений не ходит в модель.
export const projectExports = pgTable(
  'project_exports',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    projectId: uuid('project_id')
      .notNull()
      .references(() => projects.id, { onDelete: 'cascade' }),
    kind: text('kind', { enum: exportKinds }).notNull(),
    status: text('status', { enum: exportStatuses }).notNull().default('pending'),
    options: jsonb('options').$type<ExportOptions>(),
    runId: text('run_id'),
    pdfKey: text('pdf_key'),
    brief: jsonb('brief').$type<ContractorBrief>(),
    contentHash: text('content_hash'),
    pages: integer('pages'),
    durationMs: integer('duration_ms'),
    error: text('error'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    finishedAt: timestamp('finished_at', { withTimezone: true }),
  },
  (table) => [index('project_exports_project_idx').on(table.projectId, table.createdAt)],
)

export type ProjectExport = typeof projectExports.$inferSelect
export type NewProjectExport = typeof projectExports.$inferInsert
