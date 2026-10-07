// Read-only partner-feed inspection. No database writes, network calls or embeddings.

import { createHash } from 'node:crypto'
import { readFileSync } from 'node:fs'
import type { CatalogSource } from '@uyut/db'
import { parseAdmitadCsv } from '../../packages/catalog/src/csv'

const [source, file] = process.argv.slice(2)
if (!source || !['divan', 'askona', 'bestmebelshop'].includes(source) || !file) {
  console.error('Usage: bun run scripts/inspect-admitad-feed.ts divan path/to/feed.csv')
  process.exit(1)
}
const text = readFileSync(file, 'utf8')
const parsed = parseAdmitadCsv(text, source as CatalogSource)
const categories: Record<string, number> = {}
const skipped: Record<string, number> = {}
for (const item of parsed.items) categories[item.category] = (categories[item.category] ?? 0) + 1
for (const row of parsed.skipped) skipped[row.reason] = (skipped[row.reason] ?? 0) + 1
const withFootprint = parsed.items.filter(
  (item) =>
    item.attributes?.dimensionsCm?.width !== undefined &&
    item.attributes.dimensionsCm.depth !== undefined,
)
console.log(
  JSON.stringify(
    {
      source,
      sha256: createHash('sha256').update(text).digest('hex'),
      accepted: parsed.items.length,
      skipped,
      categories,
      withFootprint: withFootprint.length,
      missingDisclosure: parsed.items.filter((item) => !item.attributes?.adDisclosure).length,
      missingErid: parsed.items.filter(
        (item) => !new URL(item.affiliateUrl).searchParams.get('erid'),
      ).length,
      bedComponentCandidates: parsed.items
        .filter((item) => item.category === 'bed' && !/^кровать(?![а-яё])/i.test(item.title))
        .slice(0, 10)
        .map((item) => ({ id: item.externalId, title: item.title })),
      samples: parsed.items.slice(0, 8).map((item) => ({
        id: item.externalId,
        title: item.title,
        category: item.category,
        priceRub: item.priceKopecks / 100,
        dimensions: item.attributes?.dimensionsCm,
      })),
    },
    null,
    2,
  ),
)
