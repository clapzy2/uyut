// Пересчёт габаритов уже собранного каталога: bun run catalog:repair-dimensions [--apply]
//
// Прежний разбор знал только сантиметры и читал не больше трёх цифр подряд, поэтому
// «Кровать, 2042×946×700 мм» становилась кроватью шириной 42 см. Такие числа хуже пустого поля:
// на пустое поле не полагаешься, а неверному веришь. Скрипт перечитывает название и описание
// заново и переписывает размеры. Без --apply только показывает, что изменится.
import { hasAnyDimension, parseDimensionsCm } from '@uyut/catalog'
import { catalogItems } from '@uyut/db'
import { eq } from 'drizzle-orm'
import { db } from '../src/lib/db'

const apply = process.argv.includes('--apply')
const database = db()

const rows = await database
  .select({
    id: catalogItems.id,
    title: catalogItems.title,
    description: catalogItems.description,
    attributes: catalogItems.attributes,
  })
  .from(catalogItems)

let changed = 0
let gained = 0
let lost = 0
const samples: string[] = []

for (const row of rows) {
  const before = row.attributes?.dimensionsCm
  const after = parseDimensionsCm(`${row.title} ${row.description ?? ''}`)
  const next = hasAnyDimension(after) ? after : undefined
  if (JSON.stringify(before ?? null) === JSON.stringify(next ?? null)) {
    continue
  }
  changed += 1
  if (!before && next) {
    gained += 1
  }
  if (before && !next) {
    lost += 1
  }
  if (samples.length < 12) {
    samples.push(
      `  ${JSON.stringify(before ?? null)} → ${JSON.stringify(next ?? null)}  ${row.title.slice(0, 70)}`,
    )
  }
  if (apply) {
    await database
      .update(catalogItems)
      .set({ attributes: { ...(row.attributes ?? {}), dimensionsCm: next } })
      .where(eq(catalogItems.id, row.id))
  }
}

console.log(`товаров в каталоге: ${rows.length}`)
console.log(`размеры изменились у ${changed}: появились у ${gained}, отброшены у ${lost}`)
console.log(samples.join('\n'))
console.log(apply ? 'записано в базу' : 'ничего не записано, для записи добавьте --apply')
process.exit(0)
