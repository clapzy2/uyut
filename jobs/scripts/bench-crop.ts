// Сравнение двух рецептов вырезки предмета: bun run bench-crop [--limit 12]
//
// Прямоугольник вокруг предмета тащит в вектор пол, стену и соседнюю мебель. У дивана рамка
// почти целиком занята диваном, у стола между ножек видно половину комнаты. Скрипт берёт
// готовые предметы с рендеров, считает вектор обоими способами и показывает, что находится
// в каталоге по каждому. Считает деньги Voyage, поэтому по умолчанию берёт немного предметов.
import { findSimilar } from '@uyut/catalog'
import { conceptObjects, concepts } from '@uyut/db'
import { and, eq, isNotNull } from 'drizzle-orm'
import sharp from 'sharp'
import { db } from '../src/lib/db'
import { voyageOrNull } from '../src/lib/embed-catalog'
import { readObject } from '../src/lib/s3'
import { cropObject } from '../src/segment-and-match'

function flag(name: string, fallback: number): number {
  const index = process.argv.indexOf(`--${name}`)
  const value = index >= 0 ? Number(process.argv[index + 1]) : Number.NaN
  return Number.isFinite(value) ? value : fallback
}

const limit = flag('limit', 12)
const database = db()
const embedder = voyageOrNull()
if (!embedder) {
  console.error('нет VOYAGE_API_KEY: считать векторы нечем')
  process.exit(1)
}

// Берём поровну от каждой категории: иначе в замер попадает то, чего просто больше,
// а спрашивали нас про столы, которых в списке мало.
const perCategory = Math.max(1, Math.round(limit / 8))
const all = await database
  .select({ object: conceptObjects, concept: concepts })
  .from(conceptObjects)
  .innerJoin(concepts, eq(concepts.id, conceptObjects.conceptId))
  .where(and(isNotNull(conceptObjects.maskUrl), isNotNull(concepts.renderUrl)))
const taken = new Map<string, number>()
const rows = all.filter(({ object }) => {
  const seen = taken.get(object.category) ?? 0
  if (seen >= perCategory) {
    return false
  }
  taken.set(object.category, seen + 1)
  return true
})

console.log(`предметов в замере: ${rows.length}\n`)

const byCategory = new Map<string, { box: number[]; mask: number[] }>()

for (const { object, concept } of rows) {
  if (!concept.renderUrl || !object.maskUrl) {
    continue
  }
  const render = await readObject(concept.renderUrl)
  const meta = await sharp(render.body).metadata()
  const width = meta.width ?? 0
  const height = meta.height ?? 0
  if (!width || !height) {
    continue
  }
  const mask = await readObject(object.maskUrl)
  const detected = { label: object.label, category: object.category, bbox: object.bbox }

  const [byBox, byMask] = await Promise.all([
    cropObject(render.body, width, height, detected, null),
    cropObject(render.body, width, height, detected, mask.body),
  ])
  const [boxVector, maskVector] = await embedder.embed([
    { image: { body: byBox, contentType: 'image/jpeg' } },
    { image: { body: byMask, contentType: 'image/jpeg' } },
  ])
  if (!boxVector || !maskVector) {
    continue
  }

  const [boxHits, maskHits] = await Promise.all([
    findSimilar(database, { embedding: boxVector, category: object.category, limit: 3 }),
    findSimilar(database, { embedding: maskVector, category: object.category, limit: 3 }),
  ])
  const boxBest = boxHits[0]?.similarity ?? 0
  const maskBest = maskHits[0]?.similarity ?? 0

  const stats = byCategory.get(object.category) ?? { box: [], mask: [] }
  stats.box.push(boxBest)
  stats.mask.push(maskBest)
  byCategory.set(object.category, stats)

  const arrow = maskBest > boxBest ? '↑' : maskBest < boxBest ? '↓' : '='
  console.log(
    `${object.category.padEnd(8)} ${object.label.slice(0, 26).padEnd(26)} прямоугольник ${boxBest.toFixed(3)} → маска ${maskBest.toFixed(3)} ${arrow}`,
  )
  console.log(`    прямоугольником: ${boxHits[0]?.title.slice(0, 66) ?? '—'}`)
  console.log(`    по маске:        ${maskHits[0]?.title.slice(0, 66) ?? '—'}`)
}

const mean = (values: number[]): number =>
  values.length ? values.reduce((sum, value) => sum + value, 0) / values.length : 0

console.log('\nпо категориям:')
for (const [category, stats] of byCategory) {
  const before = mean(stats.box)
  const after = mean(stats.mask)
  const sign = after >= before ? '+' : ''
  console.log(
    `  ${category.padEnd(8)} ${stats.box.length} шт.  ${before.toFixed(3)} → ${after.toFixed(3)}  (${sign}${(after - before).toFixed(3)})`,
  )
}
process.exit(0)
