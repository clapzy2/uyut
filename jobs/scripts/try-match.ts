// Проверка подбора на живом каталоге: bun run try-match путь/к/фото.jpg sofa [левый верх ш в]
//
// Берёт кусок фотографии интерьера, считает по нему вектор тем же способом, что и задача
// подбора, и показывает, что каталог отдаёт в ответ. Нужна, чтобы посмотреть глазами: к дивану
// на картинке действительно подбираются диваны, а не светильники.
import { readFileSync } from 'node:fs'
import { createVoyageEmbedder } from '@uyut/ai'
import { findSimilar } from '@uyut/catalog'
import type { CatalogCategory } from '@uyut/db'
import sharp from 'sharp'
import { db } from '../src/lib/db'
import { requireEnv } from '../src/lib/env'

const [path, category, ...box] = process.argv.slice(2)
if (!path || !category) {
  console.error(
    'укажите файл и категорию: bun run try-match photo.jpg sofa [left top width height]',
  )
  process.exit(1)
}

const source = sharp(readFileSync(path))
const meta = await source.metadata()
const crop =
  box.length === 4
    ? {
        left: Math.round((Number(box[0]) / 100) * (meta.width ?? 0)),
        top: Math.round((Number(box[1]) / 100) * (meta.height ?? 0)),
        width: Math.round((Number(box[2]) / 100) * (meta.width ?? 0)),
        height: Math.round((Number(box[3]) / 100) * (meta.height ?? 0)),
      }
    : null

const image = await (crop ? sharp(readFileSync(path)).extract(crop) : sharp(readFileSync(path)))
  .resize({ width: 512, height: 512, fit: 'inside', withoutEnlargement: true })
  .jpeg({ quality: 85 })
  .toBuffer()

const embedder = createVoyageEmbedder(requireEnv('VOYAGE_API_KEY'))
const [embedding] = await embedder.embed([{ image: { body: image, contentType: 'image/jpeg' } }])
if (!embedding) {
  console.error('вектор не посчитался')
  process.exit(1)
}

const matches = await findSimilar(db(), {
  embedding,
  category: category as CatalogCategory,
  limit: 6,
})

console.log(
  `\nкусок ${crop ? `${crop.width}×${crop.height}` : 'вся картинка'}, категория ${category}`,
)
for (const match of matches) {
  const price = (match.priceKopecks / 100).toLocaleString('ru-RU')
  console.log(
    `  ${match.similarity.toFixed(3)}  ${price.padStart(9)} ₽  ${match.title.slice(0, 78)}`,
  )
}
process.exit(0)
