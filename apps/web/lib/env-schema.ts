import { z } from 'zod'

// Пустая строка в .env означает «не задано», а не «пустой URL»
const optionalUrl = z.preprocess((value) => (value === '' ? undefined : value), z.url().optional())
const optionalText = z.preprocess(
  (value) => (value === '' ? undefined : value),
  z.string().min(1).optional(),
)

export const serverEnvSchema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  APP_URL: z.url(),
  DATABASE_URL: z.url(),
  UPSTASH_REDIS_REST_URL: z.url(),
  UPSTASH_REDIS_REST_TOKEN: z.string().min(1),
  S3_ENDPOINT: z.url(),
  S3_REGION: z.string().min(1),
  S3_BUCKET: z.string().min(1),
  S3_ACCESS_KEY: z.string().min(1),
  S3_SECRET_KEY: z.string().min(1),
  SENTRY_DSN: optionalUrl,
  BETTER_AUTH_SECRET: z.string().min(32, 'не короче 32 символов'),
  SMTP_URL: z.url(),
  EMAIL_FROM: z.string().min(3),
  MAILPIT_URL: optionalUrl,
  // Внешние модели. Пустое значение означает «ключа нет»: приложение поднимается и работает
  // на запасных вариантах, чтобы разработка и CI не зависели от платных сервисов.
  FAL_KEY: optionalText,
  CONCEPT_MODEL: z.enum(['nano-banana-2', 'kontext-pro']).default('nano-banana-2'),
  ANTHROPIC_API_KEY: optionalText,
  VOYAGE_API_KEY: optionalText,
  TRIGGER_SECRET_KEY: optionalText,
  // Ориентировочные ставки работ для сметы, рублей за квадратный метр
  WORKS_ROUGH_RUB_PER_M2: z.coerce.number().int().positive().default(15_000),
  WORKS_FINISH_RUB_PER_M2: z.coerce.number().int().positive().default(5_000),
})

export type ServerEnv = z.infer<typeof serverEnvSchema>

export function parseServerEnv(source: Record<string, string | undefined>): ServerEnv {
  const result = serverEnvSchema.safeParse(source)
  if (!result.success) {
    throw new Error(`Некорректные переменные окружения:\n${z.prettifyError(result.error)}`)
  }
  return result.data
}
