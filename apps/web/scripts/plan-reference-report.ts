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
      planState: reference.source.state,
      ceilingMm: reference.uniformCeilingMm,
      rooms: reference.rooms.map((room) => ({ ...room, sourceNumber: room.number })),
    })
const reading = parseFloorPlan(raw)
const nameCounts = new Map<string, number>()

const rooms = reference.rooms.map((expected) => {
  const count = (nameCounts.get(expected.name) ?? 0) + 1
  nameCounts.set(expected.name, count)
  const name = count === 1 ? expected.name : `${expected.name} ${count}`
  const found =
    reading.rooms.find((room) => room.sourceNumber === expected.number) ??
    reading.rooms.find((room) => room.sourceNumber === undefined && room.name === name)
  const dimensions = (['width', 'depth'] as const).map((side) => {
    const expectedMm = expected[`${side}Mm`]
    const actualCm = found?.[`${side}Cm`]
    const actualMm = actualCm === undefined ? null : Math.round(actualCm * 10)
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
    name: found?.name ?? name,
    found: found !== undefined,
    expectedAreaM2: expected.areaM2,
    actualAreaM2: found?.areaM2 ?? null,
    areaMatchesReference: found?.areaM2 === expected.areaM2,
    sourceNumberMatches: found?.sourceNumber === expected.number,
    ...('ceilingMm' in expected
      ? {
          expectedCeilingMm: expected.ceilingMm,
          actualCeilingMm: found?.ceilingCm === undefined ? null : Math.round(found.ceilingCm * 10),
          ceilingMatchesReference:
            found?.ceilingCm !== undefined &&
            Math.round(found.ceilingCm * 10) === expected.ceilingMm,
        }
      : {}),
    dimensions,
  }
})

const unknownSides = reference.rooms.filter(
  (room) => room.widthMm === null || room.depthMm === null,
)
const knownDimensions = rooms
  .flatMap((room) => room.dimensions)
  .filter((side) => side.expectedMm !== null)
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
      planState: reading.planState,
      planStateMatchesReference: reading.planState === reference.source.state,
      expectedUniformCeilingMm: reference.uniformCeilingMm,
      actualUniformCeilingMm: reading.ceilingCm === undefined ? null : reading.ceilingCm * 10,
      rooms,
      summary: {
        correctAreas: rooms.filter((room) => room.areaMatchesReference).length,
        expectedAreas: reference.rooms.length,
        correctKnownDimensions: knownDimensions.filter((side) => side.matchesReference).length,
        expectedKnownDimensions: knownDimensions.length,
        missingKnownDimensions: knownDimensions.filter((side) => side.actualMm === null).length,
        unknownReferenceSidesReturned: rooms
          .flatMap((room) => room.dimensions)
          .filter((side) => side.expectedMm === null && side.actualMm !== null).length,
      },
      unknownSidesWithDemonstrationAspect: fallbackProbe.rooms,
      limitations: [
        'Без --answer это проверка парсера на ручном JSON, не точность OCR/AI.',
        'Если ответ не содержит номера помещения, сравнение одинаковых названий зависит от порядка.',
        'Габаритные размеры не являются полным контуром непрямоугольной комнаты.',
        'Контуры, координаты проёмов и препятствий этим эталоном пока не проверяются.',
        'Правильная арифметика не доказывает, что AI верно прочитал размерную линию.',
      ],
    },
    null,
    2,
  ),
)
