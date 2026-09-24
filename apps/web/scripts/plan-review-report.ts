import { conceptPlanReviews, concepts, createDb, projects, roomKinds, rooms } from '@uyut/db'
import { eq, isNull } from 'drizzle-orm'
import { planReviewSource } from '../lib/concepts/plan-review'
import { planReviewMetrics } from '../lib/concepts/plan-review-metrics'

const databaseUrl = process.env.DATABASE_URL
if (!databaseUrl) {
  throw new Error('Для отчёта нужен DATABASE_URL')
}

const db = createDb(databaseUrl)
const rows = await db
  .select({
    projectId: projects.id,
    roomId: rooms.id,
    roomKind: rooms.kind,
    roomName: rooms.name,
    projectPlanKey: projects.planUrl,
    roomPlanKey: rooms.planUrl,
    planReading: projects.planReading,
    renderKey: concepts.renderUrl,
    editedRenderKey: concepts.editedRenderUrl,
    qualityReview: concepts.qualityReview,
    review: conceptPlanReviews.review,
  })
  .from(conceptPlanReviews)
  .innerJoin(concepts, eq(conceptPlanReviews.conceptId, concepts.id))
  .innerJoin(rooms, eq(concepts.roomId, rooms.id))
  .innerJoin(projects, eq(rooms.projectId, projects.id))
  .where(isNull(projects.deletedAt))
  .catch(() => {
    console.error('Не удалось прочитать оценки из базы. Проверьте подключение и миграции.')
    process.exit(1)
  })

const metrics = planReviewMetrics(
  rows.map((row) => {
    const source = planReviewSource(
      row.roomPlanKey ?? row.projectPlanKey,
      row.editedRenderKey ?? row.renderKey,
      row.planReading?.geometry,
      row.roomName,
    )
    return {
      projectId: row.projectId,
      roomId: row.roomId,
      roomKind: row.roomKind,
      review: row.review,
      currentSourceHash: source?.hash ?? null,
      currentArchitecture: source?.architecture ?? null,
      usesEditedRender: Boolean(row.editedRenderKey),
      qualityReview: row.qualityReview,
    }
  }),
)

// Output aggregates only: no project identifiers, images, plan coordinates or personal data.
console.log(`Сохранённых ручных оценок: ${metrics.saved}`)
console.log(
  `Исключено: устаревшие ${metrics.stale}, исправленные изображения ${metrics.editedRender}, ` +
    `неполные/неразличимые ${metrics.incomplete}, без автопроверки ${metrics.autoUnavailable}, ` +
    `без сопоставимой архитектуры в автопроверке ${metrics.autoArchitectureMissing}`,
)
console.log(
  `Сравнимых пар: ${metrics.compared} (${metrics.rooms} комнат, ${metrics.projects} проектов)`,
)
console.log(
  `Подтверждённые противоречия: найдены ${metrics.truePositive}, ` +
    `пропущены ${metrics.falseNegative}`,
)
console.log(
  `Без видимых противоречий: ложные тревоги ${metrics.falsePositive}, ` +
    `не отмечены ${metrics.trueNegative}`,
)
const roomKindLabels = {
  living: 'гостиные',
  bedroom: 'спальни',
  kitchen: 'кухни',
  bath: 'санузлы',
  kid: 'детские',
} as const
for (const kind of roomKinds) {
  const counts = metrics.byRoomKind[kind]
  if (!counts) continue
  console.log(
    `${roomKindLabels[kind]}: ${counts.compared} пар, ` +
      `пропуски ${counts.missed}, ложные тревоги ${counts.falseAlarms}`,
  )
}
console.log('Это оценка по размеченной выборке, не гарантия точности размеров или всей квартиры.')
