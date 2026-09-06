import { randomUUID } from 'node:crypto'
import { nearestStyles, styleLibrary } from '@uyut/ai'
import { users } from '@uyut/db'
import { inArray } from 'drizzle-orm'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { createBatch, latestBatch, setConceptLike } from '@/lib/concepts/repository'
import { getDb } from '@/lib/db'
import { NotFoundError } from '@/lib/projects/access'
import { getRoom } from '@/lib/projects/repository'
import {
  completeOnboarding,
  createFromApartment,
  getOnboardingState,
  saveBudget,
  saveHousehold,
  saveStyleVotes,
} from './repository'

const userIds: string[] = []

async function createUser(): Promise<string> {
  const [user] = await getDb()
    .insert(users)
    .values({ email: `onboarding-${randomUUID()}@example.test`, displayName: 'Тест' })
    .returning({ id: users.id })
  if (!user) {
    throw new Error('user insert returned nothing')
  }
  userIds.push(user.id)
  return user.id
}

describe('onboarding and concepts in a real database', () => {
  let owner = ''
  let stranger = ''
  let projectId = ''
  let roomId = ''

  beforeAll(async () => {
    owner = await createUser()
    stranger = await createUser()
    const created = await createFromApartment(owner, {
      mode: 'series',
      title: 'Квартира из серии',
      seriesId: 'p-44',
      roomCount: 2,
    })
    projectId = created.project.id
    roomId = created.rooms[0]?.id ?? ''
  })

  afterAll(async () => {
    await getDb().delete(users).where(inArray(users.id, userIds))
  })

  it('шаблон серии создаёт комнаты с площадями и считает общую площадь', async () => {
    const state = await getOnboardingState(owner, projectId)
    expect(state.rooms.map((room) => room.kind)).toEqual(['living', 'bedroom', 'kitchen'])
    expect(state.rooms.every((room) => (room.areaM2 ?? 0) > 0)).toBe(true)
    expect(state.totalAreaM2 ?? 0).toBeGreaterThan(30)
    expect(state.houseSeries).toBe('p-44')
  })

  it('семья и бюджет сохраняются между шагами', async () => {
    await saveHousehold(owner, projectId, {
      adults: 2,
      kids: 1,
      pets: true,
      cookHome: true,
      receiveGuests: false,
      wfh: true,
    })
    await saveBudget(owner, projectId, { budgetKopecks: 900_000_00 })
    const state = await getOnboardingState(owner, projectId)
    expect(state.household).toMatchObject({ adults: 2, kids: 1, pets: true, wfh: true })
    expect(state.budgetKopecks).toBe(900_000_00)
  })

  it('лайки стилей превращаются в вектор и теги, а повтор шага не удваивает голоса', async () => {
    const scandi = styleLibrary.filter((style) => style.family === 'scandi').slice(0, 2)
    const loft = styleLibrary.filter((style) => style.family === 'loft').slice(0, 1)
    const votes = [
      ...scandi.map((style) => ({ styleId: style.id, liked: true })),
      ...loft.map((style) => ({ styleId: style.id, liked: false })),
    ]
    await saveStyleVotes(owner, projectId, votes)
    await saveStyleVotes(owner, projectId, votes)

    const state = await getOnboardingState(owner, projectId)
    expect(state.likedStyleIds.sort()).toEqual(scandi.map((style) => style.id).sort())
    expect(state.styleTags).toEqual(['scandi'])
    const vector = state.styleReferenceEmbedding ?? []
    expect(vector).toHaveLength(1024)
    expect(nearestStyles(vector, 2).map((style) => style.family)).toEqual(['scandi', 'scandi'])
  })

  it('чужой проект не открывается на шагах онбординга', async () => {
    await expect(getOnboardingState(stranger, projectId)).rejects.toBeInstanceOf(NotFoundError)
    await expect(
      saveBudget(stranger, projectId, { budgetKopecks: 100_000_00 }),
    ).rejects.toBeInstanceOf(NotFoundError)
  })

  it('концепты пишутся пачкой и лайкаются только владельцем', async () => {
    await completeOnboarding(owner, projectId)
    const room = await getRoom(owner, roomId)
    const batchId = randomUUID()
    const created = await createBatch({
      room,
      batchId,
      plan: { shared: 'Общая часть задания', variations: ['A', 'B'], source: 'template' },
      model: 'nano-banana-2',
      styleTags: ['scandi'],
    })
    expect(created).toHaveLength(2)
    expect(created.every((concept) => concept.status === 'pending')).toBe(true)
    expect(created[0]?.prompt).toContain('Общая часть задания')

    const batch = await latestBatch(owner, roomId)
    expect(batch.batchId).toBe(batchId)
    expect(batch.items.map((item) => item.orderIndex)).toEqual([0, 1])

    const first = created[0]
    if (!first) {
      throw new Error('пустая пачка концептов')
    }
    await setConceptLike(owner, first.id, true)
    const afterLike = await latestBatch(owner, roomId)
    expect(afterLike.items.find((item) => item.id === first.id)?.likedByOwner).toBe(true)

    await expect(setConceptLike(stranger, first.id, false)).rejects.toBeInstanceOf(NotFoundError)
    await expect(latestBatch(stranger, roomId)).rejects.toBeInstanceOf(NotFoundError)
  })
})
