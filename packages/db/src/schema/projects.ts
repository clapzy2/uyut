import { sql } from 'drizzle-orm'
import {
  bigint,
  boolean,
  index,
  integer,
  jsonb,
  numeric,
  pgTable,
  text,
  timestamp,
  uuid,
  vector,
} from 'drizzle-orm/pg-core'
import { EMBEDDING_DIMENSIONS } from './embedding'
import { users } from './users'

export const roomKinds = ['living', 'bedroom', 'kitchen', 'bath', 'kid'] as const
export type RoomKind = (typeof roomKinds)[number]

// Черновая отделка или готовый ремонт: от этого зависит, просит ли промпт сделать ремонт
/**
 * Что делаем с комнатой. От этого зависит и задание для модели, и работы в смете.
 *
 * bare — комната без отделки, рисуем ремонт и обстановку с нуля.
 * finished — ремонт уже есть, но человек хочет другой интерьер: мебель и отделку рисуем заново.
 * keep — ремонт и обстановка остаются, меняем только то, о чём человек попросил словами.
 */
export const roomConditions = ['bare', 'finished', 'keep'] as const
export type RoomCondition = (typeof roomConditions)[number]

export type Household = {
  adults?: number
  kids?: number
  pets?: boolean
  cookHome?: boolean
  receiveGuests?: boolean
  wfh?: boolean
}

/** Данные для PDF, вводятся один раз при экспорте и попадают в документ только по галочкам */
export type ProjectContact = {
  clientName?: string
  address?: string
  phone?: string
}

/**
 * Комната, прочитанная с плана квартиры. Живёт у проекта, а не у комнаты, потому что появляется
 * раньше комнат: сначала мы показываем прочитанное на правку, и только подтверждённое становится
 * комнатами проекта.
 */
export type PlanRoomReading = {
  name: string
  kind: RoomKind
  widthCm?: number
  depthCm?: number
  areaM2?: number
  /** Подписанная площадь не сошлась с размерами: строку показываем человеку отдельно */
  suspicious?: boolean
  /** Стороны, которые пришлось перечитать по отрезкам цепочки, чтобы площадь сошлась */
  rechecked?: Array<'width' | 'depth'>
  /** Стороны, посчитанные из подписанной площади, а не прочитанные с размерной линии */
  estimated?: Array<'width' | 'depth'>
  /** Форма комнаты со слов модели: во сколько раз шире, чем глубже */
  aspect?: number
  /** Прихожая, коридор, кладовая: размеры сохраняем, мебель не подбираем */
  utility?: boolean
}

/**
 * Разбор загруженного плана. Хранится целиком, в том числе после подтверждения: по паре
 * «что прочитали» и «что поправил человек» видно, где чтение врёт, а спросить об этом больше некого.
 */
export type PlanReading = {
  ceilingCm?: number
  /** Общая площадь квартиры с плана: сверяется с суммой площадей комнат */
  totalAreaM2?: number
  rooms: PlanRoomReading[]
  /** Когда прочитали, ISO-строкой: в jsonb дата всё равно станет строкой */
  readAt: string
  confirmedAt?: string
}

// Одна квартира = один проект. Бюджет, состав семьи и вкус заполняет онбординг.
export const projects = pgTable(
  'projects',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    ownerId: uuid('owner_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    title: text('title').notNull(),
    houseSeries: text('house_series'),
    totalAreaM2: numeric('total_area_m2', { precision: 6, scale: 2, mode: 'number' }),
    budgetKopecks: bigint('budget_kopecks', { mode: 'number' }),
    styleTags: text('style_tags').array().notNull().default(sql`'{}'::text[]`),
    // Усреднённый вектор лайкнутых картинок стиля, смешанный с референсом пользователя
    styleReferenceEmbedding: vector('style_reference_embedding', {
      dimensions: EMBEDDING_DIMENSIONS,
    }),
    household: jsonb('household').$type<Household>(),
    contact: jsonb('contact').$type<ProjectContact>(),
    // Ключи объектов в приватном bucket, наружу отдаются подписанной ссылкой
    planUrl: text('plan_url'),
    planReading: jsonb('plan_reading').$type<PlanReading>(),
    referenceUrl: text('reference_url'),
    onboardedAt: timestamp('onboarded_at', { withTimezone: true }),
    isPaid: boolean('is_paid').notNull().default(false),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true })
      .notNull()
      .defaultNow()
      .$onUpdate(() => new Date()),
    deletedAt: timestamp('deleted_at', { withTimezone: true }),
  },
  (table) => [index('projects_owner_idx').on(table.ownerId).where(sql`${table.deletedAt} is null`)],
)

/** Участок стены, куда что-то ставят: «простенок под окном», 140 см. */
export type RoomSpot = { name: string; widthCm: number }

/**
 * Мерки комнаты в сантиметрах. Источника два: рулетка человека и план квартиры.
 * widthCm и depthCm — коробка комнаты, из неё растёт вид сверху и проверка проходов;
 * spots — отдельные простенки, их с плана не прочитать, их меряют руками.
 */
export type RoomMeasurements = {
  ceilingCm?: number
  widthCm?: number
  depthCm?: number
  spots?: RoomSpot[]
}

export const rooms = pgTable(
  'rooms',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    projectId: uuid('project_id')
      .notNull()
      .references(() => projects.id, { onDelete: 'cascade' }),
    kind: text('kind', { enum: roomKinds }).notNull(),
    name: text('name').notNull(),
    areaM2: numeric('area_m2', { precision: 6, scale: 2, mode: 'number' }),
    condition: text('condition', { enum: roomConditions }).notNull().default('bare'),
    // Для комнаты с готовой отделкой: заказчик всё же хочет обновить чистовую, смета это учитывает
    refreshFinish: boolean('refresh_finish').notNull().default(false),
    photoUrl: text('photo_url'),
    planUrl: text('plan_url'),
    notes: text('notes'),
    /**
     * Что человек промерил рулеткой. Единственный источник настоящих размеров: из площади
     * длину стены не вывести (двенадцать метров — это и 3×4, и 2×6), а рисующая модель сантиметров не знает вовсе.
     * Одним jsonb, а не колонками: участков стены бывает сколько угодно и зовутся они по-разному.
     */
    measurements: jsonb('measurements').$type<RoomMeasurements>(),
    orderIndex: integer('order_index').notNull().default(0),
    // Идущая генерация концептов. Живёт у комнаты, а не в состоянии страницы: иначе обновление
    // теряет ожидание целиком, и человек видит экран так, будто ничего не запускал.
    generationRunId: text('generation_run_id'),
    generationStartedAt: timestamp('generation_started_at', { withTimezone: true }),
    // Запуск этого прогона: по нему видно, готовы ли уже его концепты. Без него не отличить
    // «строки ещё не созданы» от «давно готовы», а это разные экраны.
    generationBatchId: uuid('generation_batch_id'),
  },
  (table) => [index('rooms_project_idx').on(table.projectId)],
)

export type Project = typeof projects.$inferSelect
export type NewProject = typeof projects.$inferInsert
export type Room = typeof rooms.$inferSelect
export type NewRoom = typeof rooms.$inferInsert
