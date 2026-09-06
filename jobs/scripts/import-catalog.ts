// Импорт ручного дампа каталога: bun run catalog:import путь/к/файлу.csv
// Разбирает CSV, обновляет каталог без дублей и сразу считает векторы, если есть ключ Voyage.
import { readFileSync } from 'node:fs'
import { countItems, parseCsvDump, upsertFeedItems } from '@uyut/catalog'
import { db } from '../src/lib/db'
import { embedPendingCatalog, voyageOrNull } from '../src/lib/embed-catalog'

const path = process.argv[2]
if (!path) {
  console.error('укажите путь к CSV: bun run catalog:import samples/catalog.csv')
  process.exit(1)
}

const parsed = parseCsvDump(readFileSync(path, 'utf8'))
console.log(`разобрано ${parsed.items.length}, пропущено ${parsed.skipped.length}`)
for (const row of parsed.skipped.slice(0, 20)) {
  console.log(`  пропуск: ${row.reason}${row.title ? ` · ${row.title}` : ''}`)
}
if (parsed.items.length === 0) {
  process.exit(1)
}

const database = db()
const summary = await upsertFeedItems(database, parsed.items)
console.log(`каталог: добавлено ${summary.inserted}, обновлено ${summary.updated}`)

const embedder = voyageOrNull()
if (embedder) {
  const embedded = await embedPendingCatalog(database, embedder, { log: (m) => console.log(m) })
  console.log(
    `векторы посчитаны: ${embedded.processed}, картинок не скачалось ${embedded.failedImages}`,
  )
} else {
  console.log('VOYAGE_API_KEY не задан: векторы не посчитаны, подбор работать не будет')
}
const totals = await countItems(database)
console.log(`в каталоге ${totals.total} позиций, с векторами ${totals.embedded}`)
process.exit(0)
