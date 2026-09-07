import {
  createFalDuoProposer,
  type DuoConcept,
  type DuoInput,
  type DuoProposal,
  duoHash,
} from '@uyut/ai'
import { type Concept, concepts } from '@uyut/db'
import { asc, eq } from 'drizzle-orm'
import { getCollaboration, ownerDisplayName } from '@/lib/collaboration/repository'
import { getDb } from '@/lib/db'
import { getEnv } from '@/lib/env'
import { AccessError } from '@/lib/projects/access'
import { getRoom, type RoomWithProject } from '@/lib/projects/repository'
import { getRedis } from '@/lib/redis'
import { type DuoEligibility, duoEligibility } from './votes'

const CACHE_TTL_S = 7 * 24 * 60 * 60

export class DuoUnavailableError extends AccessError {
  constructor(message: string) {
    super(message)
    this.name = 'DuoUnavailableError'
  }
}

export type DuoOffer = {
  eligibility: DuoEligibility
  proposal: DuoProposal | null
  hash: string | null
}

/** Номер концепта такой же, как в интерфейсе: по порядку запусков и карточек */
function numbered(rows: Concept[]): Array<Concept & { index: number }> {
  return rows.map((row, position) => ({ ...row, index: position + 1 }))
}

function describeConcept(row: Concept & { index: number }, shared: string): DuoConcept {
  return {
    index: row.index,
    title: row.title,
    note: row.note,
    variation: row.prompt.startsWith(shared) ? row.prompt.slice(shared.length).trim() : row.prompt,
  }
}

/** Общий префикс промптов: то, что одинаково у всех рендеров, модели читать незачем */
function sharedPrefix(prompts: string[]): string {
  const [first, ...rest] = prompts
  if (!first) {
    return ''
  }
  let prefix = first
  for (const prompt of rest) {
    while (!prompt.startsWith(prefix) && prefix.length > 0) {
      prefix = prefix.slice(0, -1)
    }
  }
  return prefix
}

export function buildDuoInput(
  room: Pick<RoomWithProject, 'name' | 'kind' | 'project'>,
  rows: Concept[],
  names: { owner: string; partner: string },
): DuoInput {
  const shared = sharedPrefix(rows.map((row) => row.prompt))
  const items = numbered(rows)
  const side = (who: 'owner' | 'partner', name: string) => ({
    name,
    liked: items
      .filter((row) => (who === 'owner' ? row.likedByOwner : row.likedByPartner) === true)
      .map((row) => describeConcept(row, shared)),
    disliked: items
      .filter((row) => (who === 'owner' ? row.likedByOwner : row.likedByPartner) === false)
      .map((row) => describeConcept(row, shared)),
  })
  return {
    roomName: room.name,
    roomKind: room.kind,
    styleTags: room.project.styleTags,
    household: room.project.household ?? null,
    owner: side('owner', names.owner),
    partner: side('partner', names.partner),
  }
}

async function roomConcepts(roomId: string): Promise<Concept[]> {
  return getDb()
    .select()
    .from(concepts)
    .where(eq(concepts.roomId, roomId))
    .orderBy(asc(concepts.createdAt), asc(concepts.orderIndex))
}

function cacheKey(roomId: string, hash: string): string {
  return `duo:${roomId}:${hash}`
}

/**
 * Предложение вариантов на двоих: считается, только когда оба оценили не меньше десяти
 * концептов и ни один не понравился обоим. Ответ модели кэшируется по отметкам,
 * поэтому владелец и второй участник видят одно и то же.
 */
export async function getDuoOffer(userId: string, roomId: string): Promise<DuoOffer> {
  const room = await getRoom(userId, roomId)
  const rows = await roomConcepts(room.id)
  const eligibility = duoEligibility(
    rows.map((row) => ({
      owner: row.likedByOwner,
      partner: row.likedByPartner,
      status: row.status,
      batchKind: row.batchKind,
    })),
  )
  const collaboration = await getCollaboration(room.projectId)
  if (!collaboration.partner || !eligibility.eligible) {
    return { eligibility, proposal: null, hash: null }
  }
  const input = buildDuoInput(
    room,
    rows.filter((row) => row.status === 'ready'),
    {
      owner: await ownerDisplayName(room.project.ownerId),
      partner: collaboration.partner.name,
    },
  )
  const hash = duoHash(input)
  const redis = getRedis()
  const cached = await redis.get<DuoProposal>(cacheKey(room.id, hash))
  if (cached) {
    return { eligibility, proposal: cached, hash }
  }
  const key = getEnv().FAL_KEY
  if (!key) {
    throw new DuoUnavailableError(
      'Варианты на двоих пока не подключены: в настройках сервиса нет ключа модели.',
    )
  }
  const proposal = await createFalDuoProposer(key).propose(input)
  await redis.set(cacheKey(room.id, hash), proposal, { ex: CACHE_TTL_S })
  return { eligibility, proposal, hash }
}
