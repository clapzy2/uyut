import type { PlanReading } from '@uyut/ai'
import reference from '../../../docs/qa/fixtures/apartment-74-77.json'

/** QA only: preserve declared numbers before the production parser rejects their evidence. */
export function evaluateDeclaredPlanReference(raw: string) {
  const start = raw.indexOf('{')
  const end = raw.lastIndexOf('}')
  if (start < 0 || end <= start) throw new Error('Нет JSON для сравнения исходных заявлений.')
  const answer = JSON.parse(raw.slice(start, end + 1)) as Record<string, unknown>
  if (!Array.isArray(answer.rooms)) throw new Error('Нет списка комнат в исходном ответе.')
  const numeric = (value: unknown) =>
    typeof value === 'number' && Number.isFinite(value) ? value : undefined
  const centimetres = (value: unknown) => {
    const millimetres = numeric(value)
    return millimetres === undefined ? undefined : millimetres / 10
  }
  const reading: PlanReading = {
    ...(answer.planState === 'existing' ||
    answer.planState === 'proposed' ||
    answer.planState === 'unknown'
      ? { planState: answer.planState }
      : {}),
    totalAreaM2: numeric(answer.totalAreaM2),
    ceilingCm: centimetres(answer.ceilingMm),
    rooms: answer.rooms.flatMap((entry) => {
      if (!entry || typeof entry !== 'object') return []
      const room = entry as Record<string, unknown>
      return [
        {
          name: typeof room.name === 'string' ? room.name : '',
          kind: 'living' as const,
          sourceNumber: numeric(room.sourceNumber),
          areaM2: numeric(room.areaM2),
          widthCm: centimetres(room.widthMm),
          depthCm: centimetres(room.depthMm),
          ceilingCm: centimetres(room.ceilingMm),
        },
      ]
    }),
  }
  return evaluatePlanReference(reading)
}

/** QA only. Printed room numbers, not answer order or approximate names, identify controls. */
export function evaluatePlanReference(reading: PlanReading) {
  const rooms = reference.rooms.map((expected) => {
    const candidates = reading.rooms.filter((room) => room.sourceNumber === expected.number)
    const found = candidates.length === 1 ? candidates[0] : undefined
    const dimensions = (['width', 'depth'] as const).map((side) => {
      const actualCm = found?.[`${side}Cm`]
      const actualMm = actualCm === undefined ? null : actualCm * 10
      const expectedMm = expected[`${side}Mm`]
      return {
        side,
        expectedMm,
        actualMm,
        matches:
          actualMm !== null && expectedMm !== null && Math.abs(actualMm - expectedMm) < 0.0000001,
      }
    })
    return {
      sourceNumber: expected.number,
      expectedName: expected.name,
      actualName: found?.name ?? null,
      found: found !== undefined,
      candidates: candidates.length,
      expectedAreaM2: expected.areaM2,
      actualAreaM2: found?.areaM2 ?? null,
      areaMatches: found?.areaM2 === expected.areaM2,
      ...('ceilingMm' in expected
        ? {
            expectedCeilingMm: expected.ceilingMm,
            actualCeilingMm: found?.ceilingCm === undefined ? null : found.ceilingCm * 10,
            ceilingMatches:
              found?.ceilingCm !== undefined &&
              typeof expected.ceilingMm === 'number' &&
              Math.abs(found.ceilingCm * 10 - expected.ceilingMm) < 0.0000001,
          }
        : {}),
      dimensions,
    }
  })
  const dimensions = rooms.flatMap((room) => room.dimensions)
  const known = dimensions.filter((dimension) => dimension.expectedMm !== null)
  const ceilings = rooms.filter((room) => 'expectedCeilingMm' in room)
  return {
    totalAreaMatches: reading.totalAreaM2 === reference.totalAreaM2,
    planStateMatches: reading.planState === reference.source.state,
    actualRoomCount: reading.rooms.length,
    rooms,
    summary: {
      uniqueMatchedRooms: rooms.filter((room) => room.found).length,
      expectedRooms: reference.rooms.length,
      correctAreas: rooms.filter((room) => room.areaMatches).length,
      expectedAreas: reference.rooms.length,
      correctKnownDimensions: known.filter((dimension) => dimension.matches).length,
      expectedKnownDimensions: known.length,
      missingKnownDimensions: known.filter((dimension) => dimension.actualMm === null).length,
      wrongKnownDimensions: known.filter(
        (dimension) => dimension.actualMm !== null && !dimension.matches,
      ).length,
      // These controls are unannotated, not proof that the source lacks every dimension.
      unknownReferenceSidesReturned: dimensions.filter(
        (dimension) => dimension.expectedMm === null && dimension.actualMm !== null,
      ).length,
      correctIndividualCeilings: ceilings.filter((room) => room.ceilingMatches).length,
      expectedIndividualCeilings: ceilings.length,
      unexpectedUniformCeiling: reading.ceilingCm !== undefined,
      unidentifiedRooms: reading.rooms.filter(
        (room) => !reference.rooms.some((expected) => expected.number === room.sourceNumber),
      ).length,
      duplicateRoomNumbers: rooms
        .filter((room) => room.candidates > 1)
        .map((room) => room.sourceNumber),
    },
  }
}
