import type { PlanReading } from '@uyut/ai'
import reference from '../../../docs/qa/fixtures/basis-existing-reader-reference.json'

export function evaluateBasisReader(reading: PlanReading) {
  const balconyDepthMm = reference.spatialBalconyDimensions[0]?.depthMm
  if (
    balconyDepthMm === undefined ||
    reference.spatialBalconyDimensions.some((balcony) => balcony.depthMm !== balconyDepthMm)
  ) {
    throw new Error('Reference must prove one common balcony depth before unassigned scoring')
  }
  const checks = reference.rooms.map((expected) => {
    const matches = reading.rooms.filter((room) => room.sourceNumber === expected.sourceNumber)
    const room = matches.length === 1 ? matches[0] : undefined
    const areaDeltaM2 = room?.areaM2 === undefined ? null : room.areaM2 - expected.areaM2
    return {
      sourceNumber: expected.sourceNumber,
      expectedName: expected.name,
      name: room?.name ?? null,
      matchCount: matches.length,
      areaM2: room?.areaM2 ?? null,
      expectedAreaM2: expected.areaM2,
      areaDeltaM2,
      areaLabelPass: areaDeltaM2 !== null && Math.abs(areaDeltaM2) < 0.005,
      labelNamePreserved:
        room?.name.trim().toLocaleLowerCase('ru').replace(/\s+/g, '') ===
        expected.name.toLocaleLowerCase('ru').replace(/\s+/g, ''),
      widthCm: room?.widthCm ?? null,
      depthCm: room?.depthCm ?? null,
      ceilingCm: room?.ceilingCm ?? null,
    }
  })
  const main = reading.rooms.filter((room) => room.sourceNumber === 1)
  const primary = main.length === 1 ? main[0] : undefined
  const widthDeltaCm =
    primary?.widthCm === undefined ? null : primary.widthCm - reference.mainEnvelope.widthMm / 10
  const depthDeltaCm =
    primary?.depthCm === undefined ? null : primary.depthCm - reference.mainEnvelope.depthMm / 10
  return {
    existingStatePass: reading.planState === reference.source.state,
    rooms: checks,
    unexpectedRooms: reading.rooms
      .filter(
        (room) => !reference.rooms.some((expected) => expected.sourceNumber === room.sourceNumber),
      )
      .map((room) => ({ name: room.name, sourceNumber: room.sourceNumber ?? null })),
    inventoryPass:
      reading.rooms.length === reference.rooms.length &&
      checks.every((check) => check.matchCount === 1),
    mainEnvelope: {
      widthDeltaCm,
      depthDeltaCm,
      scope: reference.mainEnvelope.scope,
      ownership: 'manual main-zone span review, not proof of clear furniture space',
    },
    totalArea: {
      actualM2: reading.totalAreaM2 ?? null,
      printedTableM2: reference.printedTableTotalM2,
      printedTitleM2: reference.printedTitleAreaM2,
      sourceConflict: true,
      selectedLabel:
        reading.totalAreaM2 === reference.printedTableTotalM2
          ? 'table'
          : reading.totalAreaM2 === reference.printedTitleAreaM2
            ? 'title'
            : 'other-or-unknown',
      resolved: false,
      conflictWithheld: reading.totalAreaM2 === undefined,
    },
    // Both source balconies have the same depth. No left/right table-number assignment is inferred.
    balconyDepth: checks
      .filter((room) => room.sourceNumber !== 1)
      .map((room) => ({
        sourceNumber: room.sourceNumber,
        expectedCommonDepthCm: balconyDepthMm / 10,
        depthDeltaCm: room.depthCm === null ? null : room.depthCm - balconyDepthMm / 10,
        numberToSpatialContourVerified: false,
      })),
    ceilingPass:
      reading.ceilingCm === undefined &&
      reading.rooms.every((room) => room.ceilingCm === undefined),
    geometryCorrectness:
      'not-scored: independent complete metric contours/wall/opening golden unavailable',
    readyFor2D: false,
    readyFor3D: false,
  }
}

/** Counts alone do not measure repeatability of shape; include the actual semantic draft data. */
export function compareBasisReadings(first: PlanReading, second: PlanReading) {
  const order = (reading: PlanReading) =>
    [...reading.rooms]
      .sort((a, b) => (a.sourceNumber ?? 0) - (b.sourceNumber ?? 0))
      .map((room) => ({
        sourceNumber: room.sourceNumber ?? null,
        name: room.name,
        kind: room.kind,
        spaceKind: room.spaceKind ?? null,
        utility: room.utility ?? false,
        areaM2: room.areaM2 ?? null,
        widthCm: room.widthCm ?? null,
        depthCm: room.depthCm ?? null,
        ceilingCm: room.ceilingCm ?? null,
        segments: room.measurementEvidence,
      }))
  return {
    roomValuesRepeat:
      first.rooms.length && second.rooms.length
        ? JSON.stringify(order(first)) === JSON.stringify(order(second))
        : null,
    apartmentValuesRepeat:
      first.planState === second.planState &&
      first.totalAreaM2 === second.totalAreaM2 &&
      first.ceilingCm === second.ceilingCm &&
      JSON.stringify(first.ceilingEvidence) === JSON.stringify(second.ceilingEvidence),
    geometryExactRepeat:
      first.geometry && second.geometry
        ? JSON.stringify(first.geometry) === JSON.stringify(second.geometry)
        : null,
    agreementProvesCorrectness: false,
  }
}
