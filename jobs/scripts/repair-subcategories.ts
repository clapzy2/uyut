// Проставляет вид предмета уже собранному каталогу: bun run catalog:repair-subcategories [--apply]
//
// Категория «стол» собрала обеденные, журнальные и письменные вместе, и подбор искал по всем
// сразу. На боевых данных, когда на рендере обеденный стол, победителем по всей категории
// восемь раз из пятнадцати оказывался письменный. Без --apply только показывает разбивку.
import { subcategoryFromText } from '@uyut/catalog'
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
    description: catalogItems.description,
    subcategory: catalogItems.subcategory,
  })
  .from(catalogItems)

const counts = new Map<string, number>()
let changed = 0
let unknown = 0

for (const row of rows) {
  const next = subcategoryFromText(row.category, row.title, row.description) ?? null
  const key = `${row.category}/${next ?? 'не распознан'}`
  counts.set(key, (counts.get(key) ?? 0) + 1)
  if (next === null) {
    unknown += 1
  }
  if (next === row.subcategory) {
    continue
  }
  changed += 1
  if (apply) {
    await database
      .update(catalogItems)
      .set({ subcategory: next })
      .where(eq(catalogItems.id, row.id))
  }
}

console.log(`товаров в каталоге: ${rows.length}`)
console.log(`вид изменился у ${changed}, не распознан у ${unknown}\n`)
for (const [key, count] of [...counts.entries()].sort((left, right) => right[1] - left[1])) {
  console.log(`  ${key.padEnd(24)} ${count}`)
}
console.log(apply ? '\nзаписано в базу' : '\nничего не записано, для записи добавьте --apply')
process.exit(0)
