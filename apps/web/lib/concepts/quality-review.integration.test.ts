import { randomUUID } from 'node:crypto'
import {
  type ConceptPlanReview,
  type ConceptQualityReview,
  conceptPlanReviews,
  concepts,
  type PlanGeometry,
  projects,
  users,
} from '@uyut/db'
import { eq, inArray } from 'drizzle-orm'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { getDb } from '@/lib/db'
import { NotFoundError } from '@/lib/projects/access'
import { createProject, createRoom } from '@/lib/projects/repository'
import { getConceptPage } from './objects'
import { planReviewSource } from './plan-review'

const ids: string[] = []
let owner = ''
let stranger = ''
let roomId = ''
let projectId = ''
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
  projectId = project.id
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

  it('после переноса окна сохраняет описание, но помечает автосверку как прежнюю', async () => {
    const geometry: PlanGeometry = {
      version: 1,
      status: 'confirmed',
      widthCm: 300,
      heightCm: 300,
      walls: [{ id: 'top', kind: 'outer', start: { xCm: 0, yCm: 0 }, end: { xCm: 300, yCm: 0 } }],
      openings: [
        { id: 'window', type: 'window', wallId: 'top', offsetCm: 50, widthCm: 100 },
        { id: 'door', type: 'door', wallId: 'top', offsetCm: 200, widthCm: 80 },
      ],
      rooms: [
        {
          name: 'Кухня',
          polygon: [
            { xCm: 0, yCm: 0 },
            { xCm: 300, yCm: 0 },
            { xCm: 300, yCm: 300 },
            { xCm: 0, yCm: 300 },
          ],
        },
      ],
      warnings: [],
    }
    const planKey = `projects/${projectId}/quality-plan.jpg`
    const renderKey = `projects/${projectId}/quality-render.webp`
    const reading = { rooms: [], geometry, readAt: new Date().toISOString() }
    const [savedProject] = await getDb()
      .update(projects)
      .set({ planUrl: planKey, planReading: reading })
      .where(eq(projects.id, projectId))
      .returning()
    try {
      // Jobs reads its geometry from JSONB, not from the pre-persistence fixture.
      const source = planReviewSource(
        planKey,
        renderKey,
        savedProject?.planReading?.geometry,
        'Кухня',
      )
      if (!source) throw new Error('missing source')
      const savedReview: ConceptQualityReview = {
        ...review,
        architecture: source.architecture,
        architectureSourceHash: source.hash,
      }
      const [concept] = await getDb()
        .insert(concepts)
        .values({
          roomId,
          batchId: randomUUID(),
          orderIndex: 0,
          prompt: 'versioned review',
          aiModel: 'test',
          status: 'ready',
          renderUrl: renderKey,
          qualityReview: savedReview,
          note: savedReview.description,
        })
        .returning()
      if (!concept) throw new Error('No concept')
      // Старая версия извлечения видела только дверь. Её позиционная отметка
      // не должна перейти на восстановленное окно при том же хеше исходника.
      const oldManual: ConceptPlanReview = {
        version: 1,
        sourceHash: source.hash,
        shape: 'matches',
        openings: ['matches'],
        reviewedAt: new Date().toISOString(),
      }
      await getDb().insert(conceptPlanReviews).values({ conceptId: concept.id, review: oldManual })
      const before = await getConceptPage(owner, concept.id)
      expect(before.concept.qualityPlanStatus).toBe('current')
      expect(before.plan?.review).toBeNull()
      const [savedManual] = await getDb()
        .select()
        .from(conceptPlanReviews)
        .where(eq(conceptPlanReviews.conceptId, concept.id))
      expect(savedManual?.review).toEqual(oldManual)
      const currentManual = {
        ...oldManual,
        openings: source.architecture.openings.map(() => 'matches' as const),
      }
      await getDb()
        .update(conceptPlanReviews)
        .set({ review: currentManual })
        .where(eq(conceptPlanReviews.conceptId, concept.id))
      expect((await getConceptPage(owner, concept.id)).plan?.review).toEqual(currentManual)
      const opening = geometry.openings[0]
      if (!opening) throw new Error('missing opening')
      await getDb()
        .update(projects)
        .set({
          planReading: {
            ...reading,
            geometry: {
              ...geometry,
              openings: [{ ...opening, offsetCm: 60 }, ...geometry.openings.slice(1)],
            },
          },
        })
        .where(eq(projects.id, projectId))
      const after = await getConceptPage(owner, concept.id)
      expect(after.concept.qualityPlanStatus).toBe('changed')
      expect(after.concept.qualityReview).toEqual(savedReview)
      expect(after.concept.note).toBe('Кухня.')
      expect(after.plan?.review).toBeNull()
      expect(after.plan?.architecture).toEqual(before.plan?.architecture)
      expect(after.plan?.sourceHash).not.toBe(before.plan?.sourceHash)
    } finally {
      await getDb()
        .update(projects)
        .set({ planUrl: null, planReading: null })
        .where(eq(projects.id, projectId))
    }
  })
})
