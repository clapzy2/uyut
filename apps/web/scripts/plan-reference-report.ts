// Бесплатная сверка ответа читателя с ручной разметкой листа 03.
// Без --answer проверяет только нормализацию ручного JSON, НЕ зрячую модель.
// bun run scripts/plan-reference-report.ts [--answer path/to/raw-reader-answer.txt]

import { readFile } from 'node:fs/promises'
import { resolve } from 'node:path'
import { parseFloorPlan } from '@uyut/ai'
import reference from '../../../docs/qa/fixtures/apartment-74-77.json'

const answerIndex = process.argv.indexOf('--answer')
const answerPath = answerIndex < 0 ? undefined : process.argv[answerIndex + 1]
if (answerIndex >= 0 && (!answerPath || answerPath.startsWith('--'))) {
  throw new Error('После --answer нужен путь к сохранённому ответу читателя.')
}

const raw = answerPath
  ? await readFile(resolve(answerPath), 'utf8')
  : JSON.stringify({
      totalAreaM2: reference.totalAreaM2,
      ceilingMm: reference.uniformCeilingMm,
      rooms: reference.rooms,
    })
const reading = parseFloorPlan(raw)
const nameCounts = new Map<string, number>()

const rooms = reference.rooms.map((expected) => {
  const count = (nameCounts.get(expected.name) ?? 0) + 1
  nameCounts.set(expected.name, count)
  const name = count === 1 ? expected.name : `${expected.name} ${count}`
  const found = reading.rooms.find((room) => room.name === name)
  const dimensions = (['width', 'depth'] as const).map((side) => {
    const expectedMm = expected[`${side}Mm`]
    const actualCm = found?.[`${side}Cm`]
    const actualMm = actualCm === undefined ? null : actualCm * 10
    return {
      side,
      expectedMm,
      actualMm,
      matchesReference: expectedMm === actualMm,
      estimated: found?.estimated?.includes(side) === true,
    }
  })
  return {
    sourceRoomNumber: expected.number,
    name,
    found: found !== undefined,
    expectedAreaM2: expected.areaM2,
    actualAreaM2: found?.areaM2 ?? null,
    areaMatchesReference: found?.areaM2 === expected.areaM2,
    dimensions,
  }
})

const unknownSides = reference.rooms.filter(
  (room) => room.widthMm === null || room.depthMm === null,
)
// aspect=1 — намеренно заданное демонстрационное значение, не измерение квартиры.
// Оно показывает, что происходит с null, если модель вернёт оценку формы по промпту.
const fallbackProbe = parseFloorPlan(
  JSON.stringify({ rooms: unknownSides.map((room) => ({ ...room, aspect: 1 })) }),
)

console.log(
  JSON.stringify(
    {
      mode: answerPath ? 'saved-reader-answer' : 'manual-normalization-probe',
      savedAnswerCompared: answerPath !== undefined,
      visionCallMade: false,
      paidCalls: 0,
      source: reference.source,
      expectedRoomCount: reference.rooms.length,
      actualRoomCount: reading.rooms.length,
      extraRooms: reading.rooms.filter(
        (room) => !rooms.some((expected) => expected.name === room.name),
      ),
      expectedTotalAreaM2: reference.totalAreaM2,
      actualTotalAreaM2: reading.totalAreaM2 ?? null,
      totalAreaMatchesReference: reading.totalAreaM2 === reference.totalAreaM2,
      expectedUniformCeilingMm: reference.uniformCeilingMm,
      actualUniformCeilingMm: reading.ceilingCm === undefined ? null : reading.ceilingCm * 10,
      rooms,
      unknownSidesWithDemonstrationAspect: fallbackProbe.rooms,
      limitations: [
        'Без --answer это проверка парсера на ручном JSON, не точность OCR/AI.',
        'Сопоставление одинаковых названий зависит от порядка; номера помещений модель пока не возвращает.',
        'Габаритные размеры не являются полным контуром непрямоугольной комнаты.',
        'Контуры, координаты проёмов и препятствий этим эталоном пока не проверяются.',
        'Схема ответа читателя пока не сохраняет потолки отдельных помещений и состояние листа.',
      ],
    },
    null,
    2,
  ),
)
