/** Local-only check of independently reviewed existing-state PDF pages. */
import { createHash } from 'node:crypto'
import { readFile } from 'node:fs/promises'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { preparePlanPage } from '../lib/projects/plan-document'

type Label = { index: number; text: string }
type Chain = { total: Label; parts: Label[] }
type Source = {
  file: string
  sha256: string
  pages: number
  existingPage: number
  minNativePaths: number
  textLayer: 'extractable' | 'outlined'
  labels: Label[]
  chains?: Chain[]
}

const sourceDirectory = process.argv[2]
if (!sourceDirectory) {
  throw new Error('Usage: bun run scripts/qa-independent-pdf-corpus.ts <PDF directory>')
}

const scriptDirectory = dirname(fileURLToPath(import.meta.url))
const fixturePath = resolve(
  scriptDirectory,
  '../../../docs/qa/fixtures/independent-pdf-corpus.json',
)
const sources = JSON.parse(await readFile(fixturePath, 'utf8')) as Source[]

function dimension(label: Label): number {
  if (!/^\d[\d ]*$/.test(label.text)) {
    throw new Error(`Not a millimetre dimension: ${label.text}`)
  }
  return Number(label.text.replaceAll(' ', ''))
}

const results = []
for (const source of sources) {
  if (!/^[a-z0-9_-]+\.pdf$/.test(source.file)) {
    throw new Error(`Invalid corpus filename: ${source.file}`)
  }
  const body = await readFile(join(sourceDirectory, source.file))
  const hash = createHash('sha256').update(body).digest('hex')
  if (hash !== source.sha256) {
    throw new Error(`${source.file}: source hash changed; review the PDF again`)
  }

  const page = await preparePlanPage(body, true, source.existingPage, true)
  const linework = page.linework
  if (
    page.pageCount !== source.pages ||
    !linework ||
    linework.truncated ||
    linework.unsupportedPaths > 0 ||
    linework.paths.length < source.minNativePaths
  ) {
    throw new Error(`${source.file}: native existing-page extraction is incomplete or changed`)
  }

  const text = JSON.parse(page.image.planText ?? '[]') as Array<{ text: string }>
  if (source.textLayer === 'outlined' && text.length !== 0) {
    throw new Error(`${source.file}: outlined text assumption changed; review the page again`)
  }
  if (source.textLayer === 'extractable' && text.length === 0) {
    throw new Error(`${source.file}: the measured page has no extractable text`)
  }

  const checkLabel = (label: Label) => {
    if (text[label.index]?.text !== label.text) {
      throw new Error(`${source.file}: native label ${label.index} changed`)
    }
  }
  for (const label of source.labels) checkLabel(label)
  for (const chain of source.chains ?? []) {
    checkLabel(chain.total)
    for (const part of chain.parts) checkLabel(part)
    const sum = chain.parts.reduce((total, part) => total + dimension(part), 0)
    if (sum !== dimension(chain.total)) {
      throw new Error(`${source.file}: printed dimension chain does not close`)
    }
  }

  results.push({
    file: source.file,
    page: source.existingPage,
    nativePaths: linework.paths.length,
    nativeLabels: text.length,
    closedPrintedChains: source.chains?.length ?? 0,
    clippedPaths: linework.clippedPaths,
    skippedCurves: linework.skippedCurves,
  })
}

console.log(JSON.stringify({ checked: results.length, results }, null, 2))
