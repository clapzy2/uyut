// Чистка каталога от сантехники и зарубежных лотов: bun run catalog:clean [--apply]
//
// В гостиной владельца лучшим стеллажом четыре раза подряд выходила полка из ванной, а барным
// стулом — стульчик для ванной. Такие товары снимают на белом фоне крупно, и по картинке они
// выигрывают у настоящей мебели. Без --apply только показывает, кого выкинет.
import { isNotFurniture } from '@uyut/catalog'
import { catalogItems } from '@uyut/db'
import { eq } from 'drizzle-orm'
import { db } from '../src/lib/db'

const apply = process.argv.includes('--apply')
const database = db()

const rows = await database
  .select({
    id: catalogItems.id,
    category: catalogItems.category,
    title: catalogItems.title,
    affiliateUrl: catalogItems.affiliateUrl,
  })
  .from(catalogItems)

const doomed = rows.filter(isNotFurniture)
const byCategory = new Map<string, number>()
for (const row of doomed) {
  byCategory.set(row.category, (byCategory.get(row.category) ?? 0) + 1)
}

console.log(`в каталоге ${rows.length}, под нож ${doomed.length}\n`)
for (const [category, count] of [...byCategory].sort((left, right) => right[1] - left[1])) {
  console.log(`  ${category.padEnd(9)} ${count}`)
}
console.log('\nпримеры:')
for (const row of doomed.slice(0, 16)) {
  console.log(`  ${row.category.padEnd(9)} ${row.title.slice(0, 66)}`)
}

if (apply) {
  for (const row of doomed) {
    await database.delete(catalogItems).where(eq(catalogItems.id, row.id))
  }
  console.log(`\nудалено ${doomed.length}`)
} else {
  console.log('\nничего не удалено, для удаления добавьте --apply')
}
process.exit(0)
