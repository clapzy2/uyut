import { nearestStyles, styleTagsFromVector, styleVector } from '@uyut/ai'
import { type Project, projects, type Room, rooms, styleVotes } from '@uyut/db'
import { and, asc, eq, max } from 'drizzle-orm'
import { getDb } from '@/lib/db'
import { assertOwner } from '@/lib/projects/access'
import type {
  ApartmentInput,
  BudgetInput,
  HouseholdInput,
  StyleVoteInput,
} from '@/lib/validation/onboarding'
import { seriesLayout, totalAreaOf } from './house-series'

export type OnboardingState = Project & { rooms: Room[]; likedStyleIds: string[] }

export async function getOnboardingState(
  userId: string,
  projectId: string,
): Promise<OnboardingState> {
  const project = await assertOwner(userId, projectId)
  const db = getDb()
  const [roomList, votes] = await Promise.all([
    db
      .select()
      .from(rooms)
      .where(eq(rooms.projectId, project.id))
      .orderBy(asc(rooms.orderIndex), asc(rooms.name)),
    db
      .select({ styleId: styleVotes.styleId })
      .from(styleVotes)
      .where(and(eq(styleVotes.projectId, project.id), eq(styleVotes.liked, true))),
  ])
  return { ...project, rooms: roomList, likedStyleIds: votes.map((vote) => vote.styleId) }
}

/** Шаг 1: проект появляется вместе с комнатами, дальше онбординг только дополняет его. */
export async function createFromApartment(
  userId: string,
  input: ApartmentInput,
): Promise<{ project: Project; rooms: Room[] }> {
  const db = getDb()
  const layout = input.mode === 'series' ? seriesLayout(input.seriesId, input.roomCount) : []
  const manual = input.mode === 'manual' ? input.rooms : []
  const totalAreaM2 =
    input.mode === 'series'
      ? totalAreaOf(layout)
      : input.mode === 'manual'
        ? (input.totalAreaM2 ?? null)
        : (input.totalAreaM2 ?? null)

  const [project] = await db
    .insert(projects)
    .values({
      ownerId: userId,
      title: input.title,
      houseSeries: input.mode === 'series' ? input.seriesId : null,
      totalAreaM2,
    })
    .returning()
  if (!project) {
    throw new Error('project insert returned nothing')
  }

  const planned = input.mode === 'series' ? layout : manual
  if (planned.length === 0) {
    return { project, rooms: [] }
  }
  const created = await db
    .insert(rooms)
    .values(
      planned.map((room, index) => ({
        projectId: project.id,
        kind: room.kind,
        name: room.name,
        areaM2: room.areaM2 ?? null,
        orderIndex: index,
      })),
    )
    .returning()
  return { project, rooms: created }
}

export async function saveHousehold(
  userId: string,
  projectId: string,
  input: HouseholdInput,
): Promise<void> {
  const project = await assertOwner(userId, projectId)
  await getDb().update(projects).set({ household: input }).where(eq(projects.id, project.id))
}

export async function saveBudget(
  userId: string,
  projectId: string,
  input: BudgetInput,
): Promise<void> {
  const project = await assertOwner(userId, projectId)
  await getDb()
    .update(projects)
    .set({ budgetKopecks: input.budgetKopecks })
    .where(eq(projects.id, project.id))
}

/**
 * Шаг 4: лайки картинок превращаются в вектор вкуса и в теги семейств стилей.
 * Голоса переписываются целиком, чтобы возврат на шаг назад не удваивал их.
 */
export async function saveStyleVotes(
  userId: string,
  projectId: string,
  votes: StyleVoteInput[],
): Promise<{ likedCount: number; styleTags: string[] }> {
  const project = await assertOwner(userId, projectId)
  const db = getDb()
  await db.delete(styleVotes).where(eq(styleVotes.projectId, project.id))
  if (votes.length > 0) {
    await db.insert(styleVotes).values(votes.map((vote) => ({ projectId: project.id, ...vote })))
  }
  const liked = votes.filter((vote) => vote.liked).map((vote) => vote.styleId)
  const vector = styleVector(liked)
  const styleTags = styleTagsFromVector(vector)
  await db
    .update(projects)
    .set({
      styleTags,
      styleReferenceEmbedding: liked.length > 0 ? vector : null,
    })
    .where(eq(projects.id, project.id))
  return { likedCount: liked.length, styleTags }
}

export async function saveReference(
  userId: string,
  projectId: string,
  key: string | null,
): Promise<{ previousKey: string | null }> {
  const project = await assertOwner(userId, projectId)
  await getDb().update(projects).set({ referenceUrl: key }).where(eq(projects.id, project.id))
  return { previousKey: project.referenceUrl }
}

export async function completeOnboarding(userId: string, projectId: string): Promise<void> {
  const project = await assertOwner(userId, projectId)
  await getDb().update(projects).set({ onboardedAt: new Date() }).where(eq(projects.id, project.id))
}

/** Ведущий стиль и ближайшие к нему для промпта. Пустой вектор означает «вкус не собран». */
export function stylesOf(project: Project) {
  const vector = project.styleReferenceEmbedding ?? []
  return nearestStyles(vector, 3)
}

export async function nextRoomOrderIndex(projectId: string): Promise<number> {
  const [last] = await getDb()
    .select({ maxIndex: max(rooms.orderIndex) })
    .from(rooms)
    .where(eq(rooms.projectId, projectId))
  return (last?.maxIndex ?? -1) + 1
}
