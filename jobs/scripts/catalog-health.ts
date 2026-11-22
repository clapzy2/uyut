// Состояние каталога без изменений в базе: bun run catalog:health
import { countItems } from '@uyut/catalog'
import { db } from '../src/lib/db'

try {
  const health = await countItems(db())
  const percent = (part: number) =>
    health.total === 0 ? 0 : Math.round((part / health.total) * 100)

  console.log(`отмечены в наличии в базе: ${health.total}`)
  console.log(`свежие предложения: ${health.fresh} (${percent(health.fresh)}%)`)
  console.log(`свежие с актуальным вектором изображения: ${health.freshWithImageVector}`)
  console.log(`все записи с векторами: ${health.embedded} (${percent(health.embedded)}%)`)
  console.log(`с шириной и глубиной: ${health.withDimensions} (${percent(health.withDimensions)}%)`)
  console.log(`не обновлялись больше 48 часов: ${health.stale}`)

  if (health.fresh === 0) {
    console.error('нет свежих предложений для нового подбора')
    process.exitCode = 1
  }
} catch {
  console.error('не удалось прочитать каталог: проверьте DATABASE_URL и доступность PostgreSQL')
  process.exitCode = 1
}
