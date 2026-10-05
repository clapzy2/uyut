import { drizzleAdapter } from '@better-auth/drizzle-adapter'
import { accounts, sessions, users, verifications } from '@uyut/db'
import { betterAuth } from 'better-auth'
import { getDb } from '../lib/db'
import { getEnv } from '../lib/env'
import { createAuthStorage } from '../lib/redis'
import {
  SESSION_COOKIE_CACHE_ENABLED,
  SESSION_COOKIE_CACHE_VERSION,
} from '../lib/security/session-cookie-version'

async function main() {
  let input = ''
  for await (const chunk of process.stdin) {
    input += chunk.toString()
    if (input.length > 1024) throw new Error('Confirmation too large')
  }
  if (JSON.parse(input).confirmation !== 'revoke-domitsa-old-sessions')
    throw new Error('Confirmation required')
  const env = getEnv()
  if (
    env.APP_URL !== 'https://domitsa.ru' ||
    process.env.DOMITSA_AUTH_TRAFFIC_DRAINED !== '1' ||
    SESSION_COOKIE_CACHE_ENABLED ||
    SESSION_COOKIE_CACHE_VERSION === ('1' as string)
  )
    throw new Error('Expected the updated production application')
  const db = getDb()
  const previous = await db.select({ token: sessions.token }).from(sessions)
  const members = await db.select({ id: users.id }).from(users)
  if (members.length > 10000 || previous.length > 100000) throw new Error('Unexpected scope')
  // Тот же адаптер и вторичный кэш, но без импорта UI/plugins/нативного хеширования паролей.
  // Здесь нет обслуживаемых HTTP-маршрутов: используется только операция отзыва SDK.
  const context = await betterAuth({
    baseURL: env.APP_URL,
    secret: env.BETTER_AUTH_SECRET,
    database: drizzleAdapter(db, {
      provider: 'pg',
      schema: { user: users, session: sessions, account: accounts, verification: verifications },
    }),
    secondaryStorage: createAuthStorage(),
    user: { fields: { name: 'displayName', image: 'avatarUrl' } },
    session: { storeSessionInDatabase: true },
    advanced: { database: { generateId: false } },
  }).$context
  // Adapter removes both database sessions and their token/user-index cache.
  // Rate-limit keys and account/password tables are not cleared.
  for (const member of members) await context.internalAdapter.deleteUserSessions(member.id)
  if ((await db.select({ token: sessions.token }).from(sessions)).length !== 0)
    throw new Error('Some database sessions remain')
  const storage = createAuthStorage()
  // При потерянном active-sessions индексе остаются известные БД токены.
  // Удаляем и их; это не очистка всего auth: пространства или rate-limit ключей.
  for (const entry of previous) await storage.delete(entry.token)
  for (const entry of previous)
    if (await storage.get(entry.token)) throw new Error('Some cached sessions remain')
  console.log(
    JSON.stringify({
      status: 'passed',
      previousSessionCount: previous.length,
      userSessionIndexesCleared: members.length,
      cookieCacheVersionUpdated: true,
      browserSessionCacheDisabled: true,
      authTrafficDrained: true,
      databaseAndTokenCacheCleared: true,
      accountAndPasswordChanges: 0,
      projectChanges: 0,
    }),
  )
  await db.$client.end()
}

try {
  await main()
} catch {
  console.error(
    JSON.stringify({
      status: 'failed',
      message: 'Session revocation not fully accepted; private details hidden.',
    }),
  )
  process.exitCode = 1
}
