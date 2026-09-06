import { parseServerEnv, type ServerEnv } from './env-schema'

let cached: ServerEnv | undefined

// Ленивое чтение: при сборке Next.js импортирует модули роутов, а переменных там ещё нет.
// Первый реальный вызов делает register() из instrumentation.ts, то есть старт сервера.
export function getEnv(): ServerEnv {
  cached ??= parseServerEnv(process.env)
  return cached
}
