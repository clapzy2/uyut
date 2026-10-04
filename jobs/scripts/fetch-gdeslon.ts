// Ручной сбор CSV; тот же нормализатор используется ночным обновлением.
import { writeFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { requireEnv } from '../src/lib/env'
import { collectGdeslon, toCsv } from '../src/lib/gdeslon-catalog'

export { toCsv, toRow } from '../src/lib/gdeslon-catalog'

function argValue(name: string, fallback: string): string {
  const index = process.argv.indexOf(`--${name}`)
  return index >= 0 ? (process.argv[index + 1] ?? fallback) : fallback
}

async function main(): Promise<void> {
  const result = await collectGdeslon(requireEnv('GDESLON_TOKEN'), {
    pages: Number(argValue('pages', '3')),
  })
  if (result.failedPages > 0) {
    throw new Error(`Сбор неполный: ${result.failedPages} страниц не получены. CSV не заменён.`)
  }
  if (result.items.length === 0) throw new Error('Нет товаров с готовой рекламной пометкой')
  const out = argValue('out', 'gdeslon.csv')
  writeFileSync(out, toCsv(result.rows), 'utf8')
  console.log(
    `Собрано ${result.items.length} товаров → ${out}; без пометки: ${result.withoutDisclosure}`,
  )
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  await main()
}
