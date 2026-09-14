import { sql } from 'drizzle-orm'
import {
  bigint,
  boolean,
  index,
  integer,
  jsonb,
  pgTable,
  text,
  timestamp,
  uuid,
} from 'drizzle-orm/pg-core'
import { projects, rooms } from './projects'

export const conceptStatuses = ['pending', 'ready', 'failed'] as const
export type ConceptStatus = (typeof conceptStatuses)[number]

export const objectsStatuses = ['pending', 'ready', 'failed', 'skipped'] as const
export type ObjectsStatus = (typeof objectsStatuses)[number]

export type ConceptEdit = { objectId: string; swatchId: string }

/** Рекомендательная проверка исходного рендера, не подтверждение точности размеров. */
export type ConceptQualityReview = {
  version: 1
  status: 'checked' | 'review' | 'unavailable'
  model: string
  checkedAt: string
  issues: Array<{
    code:
      | 'not_interior'
      | 'wrong_room'
      | 'broken_geometry'
      | 'blocked_access'
      | 'opening_conflict'
      | 'brief_conflict'
      | 'requirement_unconfirmed'
    detail: string
    confidence: number
  }>
  description: string | null
}

// Обычный запуск или «варианты на двоих»: три рендера на пересечении вкусов двух людей
// edit — правка выбранного рендера: основа не фото комнаты, а другой концепт
export const conceptBatchKinds = ['regular', 'duo', 'edit'] as const
export type ConceptBatchKind = (typeof conceptBatchKinds)[number]

// Концепты: варианты дизайна одной комнаты. Строки создаются сразу при запуске генерации,
// чтобы прогресс было видно, и дозаполняются по мере готовности рендеров.
export const concepts = pgTable(
  'concepts',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    roomId: uuid('room_id')
      .notNull()
      .references(() => rooms.id, { onDelete: 'cascade' }),
    // Одна кнопка «Сгенерировать» = один batchId на пять концептов
    batchId: uuid('batch_id').notNull(),
    batchKind: text('batch_kind', { enum: conceptBatchKinds }).notNull().default('regular'),
    orderIndex: integer('order_index').notNull().default(0),
    // Название варианта на двоих, например «Тёплый сканди с графитовым акцентом»
    title: text('title'),
    status: text('status', { enum: conceptStatuses }).notNull().default('pending'),
    errorText: text('error_text'),
    // Ключи объектов в приватном bucket, наружу отдаются подписанными ссылками
    renderUrl: text('render_url'),
    renderThumbUrl: text('render_thumb_url'),
    prompt: text('prompt').notNull(),
    styleTags: text('style_tags').array().notNull().default(sql`'{}'::text[]`),
    aiModel: text('ai_model').notNull(),
    seed: bigint('seed', { mode: 'number' }),
    likedByOwner: boolean('liked_by_owner'),
    likedByPartner: boolean('liked_by_partner'),
    // От какого рендера отталкивалась правка. Без внешнего ключа: концепт-основа может быть удалён,
    // а правка остаётся самостоятельным результатом и падать вместе с ним не должна.
    baseConceptId: uuid('base_concept_id'),
    // Что именно просили поменять, словами человека: показываем над карточкой
    editRequest: text('edit_request'),
    // Подбор предметов идёт отдельной задачей после рендера
    objectsStatus: text('objects_status', { enum: objectsStatuses }).notNull().default('pending'),
    objectsError: text('objects_error'),
    // Перекраска: оригинал остаётся в render_url, отредактированная версия и список правок рядом
    editedRenderUrl: text('edited_render_url'),
    edits: jsonb('edits').$type<ConceptEdit[]>(),
    // Короткое описание варианта; у новых рендеров — по изображению из автопроверки.
    note: text('note'),
    qualityReview: jsonb('quality_review').$type<ConceptQualityReview>(),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    index('concepts_room_idx').on(table.roomId),
    index('concepts_batch_idx').on(table.batchId),
  ],
)

// Лайки картинок из библиотеки стилей на шаге онбординга «Ваш стиль»
export const styleVotes = pgTable(
  'style_votes',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    projectId: uuid('project_id')
      .notNull()
      .references(() => projects.id, { onDelete: 'cascade' }),
    // Идентификатор картинки из style-lib.json, например 03-scandi-japandi
    styleId: text('style_id').notNull(),
    liked: boolean('liked').notNull(),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [index('style_votes_project_idx').on(table.projectId, table.styleId)],
)

export type Concept = typeof concepts.$inferSelect
export type NewConcept = typeof concepts.$inferInsert
export type StyleVote = typeof styleVotes.$inferSelect
export type NewStyleVote = typeof styleVotes.$inferInsert
