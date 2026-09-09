// Импорт дампа каталога: bun run catalog:import путь/к/файлу.csv [--source gdeslon] [--max 5000]
// Разбирает CSV, обновляет каталог без дублей и сразу считает векторы, если есть ключ Voyage.
import { readFileSync } from 'node:fs'
import { countItems, parseCsvDump, upsertFeedItems } from '@uyut/catalog'
import { type CatalogSource, catalogSources } from '@uyut/db'
import { db } from '../src/lib/db'
import { embedPendingCatalog, voyageOrNull } from '../src/lib/embed-catalog'

function flag(name: string): string | undefined {
  const index = process.argv.indexOf(`--${name}`)
  return index >= 0 ? process.argv[index + 1] : undefined
}

const path = process.argv[2]
if (!path || path.startsWith('--')) {
  console.error('укажите путь к CSV: bun run catalog:import samples/catalog.csv')
  process.exit(1)
}

const source = (flag('source') ?? 'dump') as CatalogSource
if (!(catalogSources as readonly string[]).includes(source)) {
  console.error(`источник должен быть одним из: ${catalogSources.join(', ')}`)
  process.exit(1)
}
// Векторы считаются пачками с паузой под лимит Voyage, поэтому потолок задаётся снаружи:
// на большом дампе счёт идёт часами и запуск хочется дробить.
const maxItems = Number(flag('max') ?? 5000)

const parsed = parseCsvDump(readFileSync(path, 'utf8'), source)
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
  const embedded = await embedPendingCatalog(database, embedder, {
    maxItems,
    log: (m) => console.log(m),
  })
  console.log(
    `векторы посчитаны: ${embedded.processed}, картинок не скачалось ${embedded.failedImages}`,
  )
} else {
  console.log('VOYAGE_API_KEY не задан: векторы не посчитаны, подбор работать не будет')
}
const totals = await countItems(database)
console.log(`в каталоге ${totals.total} позиций, с векторами ${totals.embedded}`)
process.exit(0)
