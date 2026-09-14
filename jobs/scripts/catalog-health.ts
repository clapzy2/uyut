// Состояние каталога без изменений в базе: bun run catalog:health
import { countItems } from '@uyut/catalog'
import { db } from '../src/lib/db'

try {
  const health = await countItems(db())
  const percent = (part: number) =>
    health.total === 0 ? 0 : Math.round((part / health.total) * 100)

  console.log(`доступных товаров: ${health.total}`)
  console.log(`с векторами: ${health.embedded} (${percent(health.embedded)}%)`)
  console.log(`с шириной и глубиной: ${health.withDimensions} (${percent(health.withDimensions)}%)`)
  console.log(`не обновлялись больше 48 часов: ${health.stale}`)

  if (health.total === 0) {
    console.error('каталог пуст: подбор товаров работать не будет')
    process.exitCode = 1
  }
} catch {
  console.error('не удалось прочитать каталог: проверьте DATABASE_URL и доступность PostgreSQL')
  process.exitCode = 1
}
