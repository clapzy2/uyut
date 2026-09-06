import { drizzle } from 'drizzle-orm/postgres-js'
import { migrate } from 'drizzle-orm/postgres-js/migrator'
import postgres from 'postgres'

const url = process.env.DATABASE_URL
if (!url) {
  console.error('DATABASE_URL is not set')
  process.exit(1)
}

// В контейнере миграции лежат рядом со скриптом, локально — в пакете
const migrationsFolder = process.env.MIGRATIONS_DIR ?? './drizzle'

const client = postgres(url, { max: 1 })
try {
  await migrate(drizzle(client), { migrationsFolder })
  console.log('migrations applied')
} finally {
  await client.end()
}
