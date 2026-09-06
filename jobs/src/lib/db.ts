import { createDb, type Database } from '@uyut/db'
import { requireEnv } from './env'

let cached: Database | undefined

// Одно подключение на процесс воркера: задачи короткие, пул переживает несколько запусков подряд
export function db(): Database {
  if (!cached) {
    cached = createDb(requireEnv('DATABASE_URL'))
  }
  return cached
}
