import { createHash, randomUUID } from 'node:crypto'
import { readFile } from 'node:fs/promises'
import {
  accounts,
  createDb,
  type PlanPageContours,
  type PlanReading,
  projects,
  users,
} from '@uyut/db'
import { hashPassword } from '../lib/password'
import { planPageContoursSchema } from '../lib/projects/plan-page-review'
import { putObject } from '../lib/storage'

// Локальный стенд полного PDF-редактора. Не читает план через AI и не подтверждает обмер.
const [pdfPath, reportPath, fixturePath] = process.argv.slice(2)
if (!pdfPath || !reportPath) throw new Error('Укажите исходный PDF и контрольный JSON переноса')
for (const key of ['DATABASE_URL', 'APP_URL', 'S3_ENDPOINT'] as const) {
  const value = process.env[key]
  if (!value || !['localhost', '127.0.0.1', '[::1]'].includes(new URL(value).hostname))
    throw new Error(`${key}: этот тест разрешён только на локальном стенде`)
}
const body = await readFile(pdfPath)
const report = JSON.parse(await readFile(reportPath, 'utf8')) as {
  source: PlanPageContours['source']
  savedContours: PlanPageContours
  sourceRooms: Array<{ sourceNumber: number; name: string }>
  draft: { ok: boolean }
}
const contours = planPageContoursSchema.parse(report.savedContours)
if (
  !report.draft.ok ||
  report.source.state !== 'existing' ||
  createHash('sha256').update(body).digest('hex') !== report.source.sha256 ||
  JSON.stringify(contours.source) !== JSON.stringify(report.source)
)
  throw new Error('PDF и проверенный источник разметки не совпадают')
const fixture = JSON.parse(
  await readFile(
    fixturePath ??
      new URL('../../../docs/qa/fixtures/spb-pobedy-5-open-zones.json', import.meta.url),
    'utf8',
  ),
) as { source: PlanPageContours['source']; rooms: PlanReading['rooms']; synthetic?: boolean }
if (fixture.source.sha256 !== report.source.sha256)
  throw new Error('Список помещений относится к другому исходнику')
const id = randomUUID()
const email = `pdf-editor-${id}@example.test`
const password = 'lampa-u-okna-2026'
const planKey = `qa/${id}/source.pdf`
await putObject(planKey, body, 'application/pdf')
const now = new Date().toISOString()
const reading: PlanReading = {
  sourcePage: report.source.pdfPage,
  planState: 'existing',
  readAt: now,
  confirmedAt: now,
  rooms: fixture.rooms.map((room) => ({
    sourceNumber: room.sourceNumber,
    name: room.name,
    kind: room.kind,
    ...(room.utility ? { utility: true } : {}),
  })),
  pageReview: {
    version: 1,
    savedAt: now,
    contours,
    sourceRooms: report.sourceRooms,
  },
}
const db = createDb(process.env.DATABASE_URL as string)
await db.transaction(async (tx) => {
  await tx.insert(users).values({
    id,
    email,
    emailVerified: true,
    displayName: 'Локальная проверка PDF',
  })
  await tx.insert(accounts).values({
    userId: id,
    accountId: id,
    providerId: 'credential',
    password: await hashPassword(password),
  })
  await tx.insert(projects).values({
    id,
    ownerId: id,
    title: fixture.synthetic
      ? 'Синтетический тест PDF — отдельный пол, не обмер'
      : 'Локальный тест PDF — разметка, не подтверждённый обмер',
    planUrl: planKey,
    planReading: reading,
  })
})
console.log(
  JSON.stringify({
    userId: id,
    projectId: id,
    email,
    password,
    planKey,
    projectUrl: `${process.env.APP_URL}/projects/${id}`,
  }),
)
process.exit(0)
