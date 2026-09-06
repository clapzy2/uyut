import { createDb, type Database } from '@uyut/db'
import { getEnv } from './env'

// Один пул соединений на процесс. В dev модуль перезагружается при каждом изменении,
// поэтому клиент живёт в globalThis, а не в переменной модуля.
const globalForDb = globalThis as unknown as { db?: Database }

export function getDb(): Database {
  if (!globalForDb.db) {
    globalForDb.db = createDb(getEnv().DATABASE_URL)
  }
  return globalForDb.db
}
