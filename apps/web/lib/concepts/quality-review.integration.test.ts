import { randomUUID } from 'node:crypto'
import { type ConceptQualityReview, concepts, users } from '@uyut/db'
import { inArray } from 'drizzle-orm'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { getDb } from '@/lib/db'
import { NotFoundError } from '@/lib/projects/access'
import { createProject, createRoom } from '@/lib/projects/repository'
import { getConceptPage } from './objects'

const ids: string[] = []
let owner = ''
let stranger = ''
let roomId = ''
const review: ConceptQualityReview = {
  version: 1,
  status: 'review',
  model: 'test',
  checkedAt: new Date().toISOString(),
  description: 'Кухня.',
  issues: [{ code: 'blocked_access', detail: 'Возможное перекрытие входа.', confidence: 0.9 }],
}

beforeAll(async () => {
  for (let i = 0; i < 2; i++) {
    const [user] = await getDb()
      .insert(users)
      .values({ email: `quality-${randomUUID()}@example.test`, displayName: 'QA' })
      .returning()
    if (!user) throw new Error('No test user')
    ids.push(user.id)
  }
  owner = ids[0] as string
  stranger = ids[1] as string
  const project = await createProject(owner, { title: 'Quality test' })
  roomId = (await createRoom(owner, project.id, { name: 'Кухня', kind: 'kitchen' })).id
})

afterAll(async () => {
  if (ids.length) await getDb().delete(users).where(inArray(users.id, ids))
})

describe('отчёт качества в карточке концепта', () => {
  it('доходит из БД до карточки и недоступен чужому пользователю', async () => {
    const [concept] = await getDb()
      .insert(concepts)
      .values({
        roomId,
        batchId: randomUUID(),
        orderIndex: 0,
        prompt: 'test',
        aiModel: 'test',
        status: 'ready',
        qualityReview: review,
        note: review.description,
      })
      .returning()
    if (!concept) throw new Error('No concept')
    expect((await getConceptPage(owner, concept.id)).concept.qualityReview).toEqual(review)
    await expect(getConceptPage(stranger, concept.id)).rejects.toBeInstanceOf(NotFoundError)
  })

  it('старый концепт не становится проверенным задним числом', async () => {
    const [concept] = await getDb()
      .insert(concepts)
      .values({
        roomId,
        batchId: randomUUID(),
        orderIndex: 0,
        prompt: 'legacy',
        aiModel: 'test',
        status: 'ready',
      })
      .returning()
    if (!concept) throw new Error('No concept')
    expect((await getConceptPage(owner, concept.id)).concept.qualityReview).toBeNull()
  })
})
