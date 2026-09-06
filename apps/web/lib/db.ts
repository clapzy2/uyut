import { createDb, type Database } from '@uyut/db'
import { getEnv } from './env'

// В dev модуль перезагружается при каждом изменении; пул соединений переживает это в globalThis
const globalForDb = globalThis as unknown as { db?: Database }

export function getDb(): Database {
  if (globalForDb.db) {
    return globalForDb.db
  }
  const env = getEnv()
  const db = createDb(env.DATABASE_URL)
  if (env.NODE_ENV !== 'production') {
    globalForDb.db = db
  }
  return db
}
