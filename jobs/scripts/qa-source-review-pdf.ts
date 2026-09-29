/** Print the local source-review map without network requests or database access. */
import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { dirname, join, resolve } from 'node:path'
import { printPdf } from '../src/lib/print-pdf'

const [htmlPath, outputPath] = process.argv.slice(2)
if (!htmlPath || !outputPath || !htmlPath.endsWith('.html') || !outputPath.endsWith('.pdf')) {
  throw new Error('Usage: bun run scripts/qa-source-review-pdf.ts <review.html> <output.pdf>')
}
if (resolve(htmlPath) === resolve(outputPath)) {
  throw new Error('The source review must not be overwritten.')
}

const html = await readFile(htmlPath, 'utf8')
const imageReference = 'href="source-page-6.jpg"'
if (!html.includes(imageReference)) {
  throw new Error('The source-review page does not reference its checked source image.')
}
const image = await readFile(join(dirname(htmlPath), 'source-page-6.jpg'))
const embeddedHtml = html.replaceAll(
  imageReference,
  `href="data:image/jpeg;base64,${image.toString('base64')}"`,
)
const pdf = await printPdf(embeddedHtml, 'Проверка обмерного плана')
await mkdir(dirname(resolve(outputPath)), { recursive: true })
await writeFile(outputPath, pdf)
console.log(`Карта для уточнения обмера: ${resolve(outputPath)}`)
