import { randomUUID } from 'node:crypto'
import { createDb, type PlanGeometry, projects, users } from '@uyut/db'
import { eq } from 'drizzle-orm'
import {
  inspectManualPlanCompleteness,
  inspectPlanGeometry,
} from '../lib/projects/plan-geometry-inspection'
import { planVolume } from '../lib/projects/plan-volume'

// Only a synthetic scene, using the account from the local PDF browser test.
for (const key of ['DATABASE_URL', 'APP_URL'] as const) {
  const value = process.env[key]
  if (!value || !['localhost', '127.0.0.1', '[::1]'].includes(new URL(value).hostname)) {
    throw new Error(`${key}: проверка разрешена только на локальном стенде`)
  }
}
const [ownerId] = process.argv.slice(2)
if (!ownerId) throw new Error('Укажите владельца локального теста PDF')
const db = createDb(process.env.DATABASE_URL as string)
const [owner] = await db.select().from(users).where(eq(users.id, ownerId))
if (!owner?.email.endsWith('@example.test')) throw new Error('Это не локальный тестовый аккаунт')
const polygon = [
  { xCm: 20, yCm: 20 },
  { xCm: 400, yCm: 20 },
  { xCm: 400, yCm: 300 },
  { xCm: 20, yCm: 300 },
]
const corners = [
  { xCm: 10, yCm: 10 },
  { xCm: 410, yCm: 10 },
  { xCm: 410, yCm: 310 },
  { xCm: 10, yCm: 310 },
]
const geometry: PlanGeometry = {
  version: 1,
  source: 'manual',
  status: 'confirmed',
  widthCm: 420,
  heightCm: 320,
  footprint: polygon,
  rooms: [{ name: 'Контрольная кухня', polygon }],
  walls: corners.map((start, index) => ({
    id: `wall-${index}`,
    kind: 'outer',
    start,
    end: corners[(index + 1) % corners.length] ?? start,
    measuredThicknessCm: 20,
    heightCm: 270,
  })),
  openings: [
    {
      id: 'entry',
      type: 'door',
      wallId: 'wall-2',
      offsetCm: 100,
      widthCm: 90,
      bottomCm: 0,
      heightCm: 210,
    },
    {
      id: 'window',
      type: 'window',
      wallId: 'wall-0',
      offsetCm: 100,
      widthCm: 120,
      bottomCm: 90,
      heightCm: 130,
    },
  ],
  kitchenItems: [
    { id: 'cabinet', kind: 'cabinet', xCm: 100, yCm: 100, widthCm: 60, depthCm: 80, heightCm: 90 },
  ],
  warnings: [],
}
const errors = [
  ...inspectPlanGeometry(geometry),
  ...inspectManualPlanCompleteness(geometry),
].filter((issue) => issue.severity === 'error')
if (errors.length || !planVolume(geometry)) throw new Error(JSON.stringify(errors))
const projectId = randomUUID()
await db.insert(projects).values({
  id: projectId,
  ownerId,
  title: 'Синтетический тест кухни 2D → 3D, не обмер',
  planReading: {
    readAt: new Date().toISOString(),
    planState: 'existing',
    rooms: [{ name: 'Контрольная кухня', kind: 'kitchen' }],
    geometry,
  },
})
console.log(JSON.stringify({ projectId, url: `${process.env.APP_URL}/projects/${projectId}` }))
process.exit(0)
