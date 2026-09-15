/** Предварительный расчёт прямоугольной рамки, не подтверждение установки кухни. */
export function kitchenEnvelope(size?: { widthCm?: number; depthCm?: number }) {
  const width = size?.widthCm
  const depth = size?.depthCm
  if (
    !width ||
    !depth ||
    !Number.isFinite(width) ||
    !Number.isFinite(depth) ||
    width <= 0 ||
    depth <= 0
  ) {
    return null
  }
  // Проектные допущения: ряд 60 см, остров 90 см, рабочий проход 120 см.
  // Проход: https://www.ikea.com/gb/en/files/pdf/91/0d/910d49de/ikea-kitchen-planning-guide.pdf
  // Это ориентиры эргономики, не российские строительные нормы или размеры конкретной техники.
  const shortSideCm = Math.min(width, depth)
  const longSideCm = Math.max(width, depth)
  return {
    singleRunClearanceCm: shortSideCm - 60,
    opposingRunClearanceCm: shortSideCm - 120,
    opposingRunsPossible: shortSideCm >= 240,
    // Один ряд + проход + остров + проход; по длине остров 120 см и два прохода.
    islandPossible: shortSideCm >= 390 && longSideCm >= 360,
  }
}

export function kitchenConstraints(size?: { widthCm?: number; depthCm?: number }): string {
  const envelope = kitchenEnvelope(size)
  return [
    'Preserve the stated or visible sink connections, cooking equipment and ventilation locations. Keep refrigerator, oven and dishwasher doors operable and keep the entrance clear.',
    'Provide a continuous preparation surface between sink and hob. Do not invent measured appliance clearances or claim that installation requirements have been verified.',
    envelope
      ? `Preliminary rectangular-envelope check, assuming 60 cm deep cabinet runs: one run leaves ${envelope.singleRunClearanceCm} cm across the room; two opposing runs leave ${envelope.opposingRunClearanceCm} cm. This does not account for openings, recesses or appliance-specific dimensions.`
      : 'Room dimensions are unknown: do not add an island or a second opposing cabinet run; preserve existing equipment shown in a reference photo.',
    envelope && !envelope.opposingRunsPossible
      ? 'Do not add opposing cabinet runs or a U-shaped arrangement: the assumed runs leave less than the 120 cm working-aisle target.'
      : '',
    envelope && !envelope.islandPossible
      ? 'Do not add an island: the assumed island and its working aisles do not fit the room envelope.'
      : '',
    envelope?.islandPossible
      ? 'The envelope alone does not prove an island fits: only include one if actual openings, access routes and appliance clearances also allow it.'
      : '',
  ]
    .filter(Boolean)
    .join(' ')
}
