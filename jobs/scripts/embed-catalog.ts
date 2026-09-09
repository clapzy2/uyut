// Первичный расчёт векторов каталога: bun run catalog:embed [--max 5000]
//
// Ночная задача считает понемногу и укладывается в отведённое ей время. На первую загрузку
// каталога этого мало: Voyage пропускает около пятнадцати товаров в минуту, и несколько тысяч
// позиций считаются часами. Поэтому большой счёт запускается руками и переживает обрывы связи:
// канал до Voyage рвётся регулярно, а всё посчитанное уже сохранено и заново не считается.
import { countItems } from '@uyut/catalog'
import { db } from '../src/lib/db'
import { embedPendingCatalog, voyageOrNull } from '../src/lib/embed-catalog'

function flag(name: string): string | undefined {
  const index = process.argv.indexOf(`--${name}`)
  return index >= 0 ? process.argv[index + 1] : undefined
}

const maxItems = Number(flag('max') ?? 20_000)
const ATTEMPTS = 60
const WAIT_AFTER_BREAK_MS = 30_000

const embedder = voyageOrNull()
if (!embedder) {
  console.error('VOYAGE_API_KEY не задан: считать нечем')
  process.exit(1)
}

const database = db()
let processed = 0
for (let attempt = 1; attempt <= ATTEMPTS; attempt += 1) {
  try {
    const summary = await embedPendingCatalog(database, embedder, {
      maxItems: maxItems - processed,
      log: (message) => console.log(message),
    })
    processed += summary.processed
    if (summary.processed === 0) {
      break
    }
  } catch (error) {
    console.log(`обрыв на ${processed}: ${String(error).slice(0, 90)}`)
    if (attempt === ATTEMPTS) {
      throw error
    }
    await new Promise((resolve) => setTimeout(resolve, WAIT_AFTER_BREAK_MS))
  }
}

const totals = await countItems(database)
console.log(`в каталоге ${totals.total} позиций, с векторами ${totals.embedded}`)
process.exit(0)
