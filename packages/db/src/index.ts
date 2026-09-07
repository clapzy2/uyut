import { drizzle } from 'drizzle-orm/postgres-js'
import postgres from 'postgres'
import * as schema from './schema'

export function createDb(connectionString: string) {
  // Пул задаётся явно: у веб-сервера и воркера он свой, и без ограничения несколько процессов
  // разом упираются в лимит соединений Postgres. Простаивающие соединения освобождаются сами.
  const client = postgres(connectionString, { max: 10, idle_timeout: 20 })
  return drizzle(client, { schema })
}

export type Database = ReturnType<typeof createDb>

export * from './schema'
