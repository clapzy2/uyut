import { getRedis } from '@/lib/redis'

// Живой канал проекта на Redis: версия лайков и присутствие участников. Страница держит SSE,
// сервер раз в две секунды сверяет версию и ключи присутствия; ничего внешнего не нужно.

const PRESENCE_TTL_S = 45
const VERSION_TTL_S = 30 * 24 * 60 * 60
const LAST_SEEN_TTL_S = 30 * 24 * 60 * 60

export type Presence = { roomId: string | null; at: number }

function versionKey(projectId: string): string {
  return `live:${projectId}:v`
}

function presenceKey(projectId: string, userId: string): string {
  return `live:${projectId}:p:${userId}`
}

function lastSeenKey(projectId: string, userId: string): string {
  return `live:${projectId}:seen:${userId}`
}

/** Любой лайк в проекте поднимает версию: открытые страницы перечитывают отметки комнаты */
export async function bumpProjectVersion(projectId: string): Promise<number> {
  const redis = getRedis()
  const version = await redis.incr(versionKey(projectId))
  if (version === 1) {
    await redis.expire(versionKey(projectId), VERSION_TTL_S)
  }
  return version
}

export async function touchPresence(
  projectId: string,
  userId: string,
  roomId: string | null,
): Promise<void> {
  const presence: Presence = { roomId, at: Date.now() }
  await getRedis().set(presenceKey(projectId, userId), presence, { ex: PRESENCE_TTL_S })
}

/** Ушёл со страницы: присутствие снимается сразу, а не по истечении ключа */
export async function clearPresence(projectId: string, userId: string): Promise<void> {
  const redis = getRedis()
  await redis.del(presenceKey(projectId, userId))
  await redis.set(lastSeenKey(projectId, userId), Date.now(), { ex: LAST_SEEN_TTL_S })
}

export type LiveSnapshot = {
  version: number
  presence: Presence | null
  lastSeenAt: number | null
}

/** Одна команда на опрос: версия проекта, присутствие второго участника и когда он был */
export async function readLive(
  projectId: string,
  otherUserId: string | null,
): Promise<LiveSnapshot> {
  const redis = getRedis()
  if (!otherUserId) {
    const version = await redis.get<number>(versionKey(projectId))
    return { version: version ?? 0, presence: null, lastSeenAt: null }
  }
  const [version, presence, lastSeen] = await redis.mget<
    [number | null, Presence | null, number | null]
  >(versionKey(projectId), presenceKey(projectId, otherUserId), lastSeenKey(projectId, otherUserId))
  return { version: version ?? 0, presence: presence ?? null, lastSeenAt: lastSeen ?? null }
}
