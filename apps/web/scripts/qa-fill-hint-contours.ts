/**
 * Проверка подсказок-заливок на реальном PDF. Без вызовов модели, без записи в проект
 * и без подтверждения геометрии: скрипт только показывает, какие заливки можно взять
 * в обводку и что с ними делает обычная серверная проверка листа.
 *
 * bun run apps/web/scripts/qa-fill-hint-contours.ts <PDF> <страница> [№:ширина_см:глубина_см]
 *
 * Третий аргумент — опорная комната, у которой человек подтвердил обе печатные стороны.
 * Он нужен только чтобы увидеть, доходит ли лист до метрического 2D-черновика.
 */
import { createHash } from 'node:crypto'
import { readFile } from 'node:fs/promises'
import { preparePlanPage } from '../lib/projects/plan-document'
import { nativeFillCandidates } from '../lib/projects/plan-native-fill-candidates'
import { nativeNumberedFillHints } from '../lib/projects/plan-native-numbered-fill-hints'
import { nativeOuterEnvelope } from '../lib/projects/plan-native-outer-envelope'
import { nativeRoomScheduleEvidence } from '../lib/projects/plan-native-room-schedule'
import { planPageMetricDraft } from '../lib/projects/plan-page-metric-draft'
import { planPageFeaturesIssue } from '../lib/projects/plan-page-review'
import { pdfContourIssue } from '../lib/projects/plan-pdf-room-binding'

const [path, pageArgument, anchorArgument] = process.argv.slice(2)
const pageNumber = Number(pageArgument)
if (!path || !Number.isSafeInteger(pageNumber) || pageNumber < 1)
  throw new Error('Usage: bun run scripts/qa-fill-hint-contours.ts <PDF> <страница> [№:ш:г]')

const body = await readFile(path)
const sha256 = createHash('sha256').update(body).digest('hex')
const page = await preparePlanPage(body, true, pageNumber, true, true)
if (!page.nativeTextAnchors || !page.linework || !page.lineworkRasterSource)
  throw new Error('У этого листа нет полного нативного слоя PDF.')

const linework = page.linework
const input = {
  native: page.nativeTextAnchors,
  work: linework,
  lineworkSource: page.lineworkRasterSource,
}
const inventory = nativeFillCandidates(input)
const schedule = nativeRoomScheduleEvidence(input)
const hints = nativeNumberedFillHints({ native: page.nativeTextAnchors, inventory, schedule })
const byId = new Map(inventory.candidates.map((candidate) => [candidate.id, candidate]))
const source = { sha256, pdfPage: pageNumber, state: 'existing' as const }
const base = {
  source,
  coordinateSystem: 'page-0-1000' as const,
  review: 'manual-source-review' as const,
  pageWidth: linework.pageWidth,
  pageHeight: linework.pageHeight,
}
const check = (rooms: { roomSourceNumber: number; polygon: { x: number; y: number }[] }[]) => {
  const contours = { ...base, rooms }
  return pdfContourIssue(linework, source, contours) || planPageFeaturesIssue(contours) || null
}

console.log(
  `SHA ${sha256.slice(0, 12)}, лист ${pageNumber}, строк экспликации ${hints.rows.length}`,
)
for (const row of hints.rows) {
  if (!row.fillIds.length) {
    console.log(`№${row.sourceNumber} ${row.name}: заливка под номером не найдена`)
    continue
  }
  for (const id of row.fillIds) {
    const fill = byId.get(id)
    if (!fill) continue
    const issue = check([{ roomSourceNumber: row.sourceNumber, polygon: fill.polygon }])
    console.log(
      `№${row.sourceNumber} ${row.name} ${id}: вершин ${fill.polygon.length}, ` +
        (issue ? `отказ проверки — ${issue}` : 'проверка листа принимает'),
    )
  }
}

// Лист целиком собирается только из однозначных комнат: выбор между вариантами делает человек.
const unambiguous = hints.rows.flatMap((row) => {
  const fill = row.fillIds.length === 1 ? byId.get(row.fillIds[0] as string) : undefined
  return fill ? [{ roomSourceNumber: row.sourceNumber, polygon: fill.polygon }] : []
})
console.log(
  `\nоднозначных комнат ${unambiguous.length} из ${hints.rows.length}` +
    (unambiguous.length
      ? `; лист целиком: ${check(unambiguous) ?? 'проверка принимает'}`
      : '; собрать лист целиком нельзя'),
)
// Наружная оболочка по краске листа: предложение для сверки, не подтверждённая граница.
const envelope = nativeOuterEnvelope({ inventory, work: linework })
console.log(
  `наружная оболочка: ${
    envelope.polygon
      ? `${envelope.polygon.length} углов, незакрашенных областей внутри ${envelope.holes}`
      : `не предлагается — ${envelope.reason}`
  }`,
)
if (!unambiguous.length) process.exit(0)

const [anchorNumber, anchorWidthCm, anchorDepthCm] = (anchorArgument ?? '')
  .split(':')
  .map((value) => Number(value))
const reading = {
  rooms: schedule.rows.map((row) => ({
    name: row.name,
    sourceNumber: row.sourceNumber,
    kind: 'living' as const,
    areaM2: row.documentaryAreaM2,
    ...(row.sourceNumber === anchorNumber
      ? { widthCm: anchorWidthCm, depthCm: anchorDepthCm }
      : {}),
  })),
  readAt: new Date().toISOString().slice(0, 10),
  planState: 'existing' as const,
  sourcePage: pageNumber,
}
const numbers = unambiguous.map((room) => room.roomSourceNumber).slice(0, 12)
const context = {
  source,
  linework,
  planText: page.image.planText,
  contours: { ...base, rooms: unambiguous },
  ...(Number.isFinite(anchorNumber) ? { calibrationRoomNumbers: [anchorNumber as number] } : {}),
}
const draft = planPageMetricDraft(reading, context, numbers)
console.log(
  `метрический 2D-черновик: ${draft.ok ? `построен, комнат ${draft.geometry.rooms?.length ?? 0}` : `отказ — ${draft.error}`}`,
)
