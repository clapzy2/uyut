import type { PlanGeometry, PlanVerticalReference } from '@uyut/db'
import { z } from 'zod'
import type { PlanGeometryIssue } from './plan-geometry-inspection'
import { currentOpeningFacePairs, currentOpeningWidthProofs } from './plan-opening-face-pairs'

type ReferenceGeometry = Pick<PlanGeometry, 'walls' | 'openings' | 'rooms'> &
  Partial<
    Pick<
      PlanGeometry,
      'verticalReference' | 'pdfCalibration' | 'imageCalibration' | 'footprint' | 'voids'
    >
  >

const id = z
  .string()
  .min(1)
  .max(100)
  .refine((value) => value === value.trim())
const coordinate = z.number().finite().min(-10000).max(10000)
const point = z.object({ xCm: coordinate, yCm: coordinate }).strict()
const pixel = z.object({ x: z.number().finite().min(0), y: z.number().finite().min(0) }).strict()
const imageDimension = {
  pixelStart: pixel,
  pixelEnd: pixel,
  lengthCm: z.number().finite().positive(),
}
const imageCalibration = z
  .object({
    ...imageDimension,
    sourceSha256: z
      .string()
      .regex(/^[a-f0-9]{64}$/)
      .optional(),
    pdfPage: z.number().int().positive().optional(),
    imageWidthPx: z.number().int().positive(),
    imageHeightPx: z.number().int().positive(),
    worldStart: point,
    direction: z.enum(['right', 'left', 'down', 'up']),
    verificationLines: z.array(z.object(imageDimension).strict()).max(200).optional(),
  })
  .strict()
const elevation = z.number().finite().min(-600).max(600)
const room = z
  .object({
    name: z.string().min(1).max(200),
    polygon: z.array(point).min(3).max(200),
    spaceKind: z.enum(['interior', 'balcony', 'loggia']).optional(),
    sourceNumber: z.number().int().positive().optional(),
    sourceNumbers: z.array(z.number().int().positive()).min(1).max(200).optional(),
  })
  .strict()
  .refine((value) => !(value.sourceNumber !== undefined && value.sourceNumbers !== undefined))
  .refine(
    (value) =>
      !value.sourceNumbers || new Set(value.sourceNumbers).size === value.sourceNumbers.length,
  )
const wall = z
  .object({
    id,
    kind: z.enum(['outer', 'inner']),
    start: point,
    end: point,
    thicknessCm: z.number().finite().positive().max(100).optional(),
  })
  .strict()
const opening = z
  .object({
    id,
    type: z.enum(['door', 'window', 'balcony']),
    wallId: id,
    offsetCm: z.number().finite().min(0).max(10000),
    widthCm: z.number().finite().positive().max(10000),
  })
  .strict()
const binding = z.object({ opening, floorId: id }).strict()
const requestFields = {
  version: z.literal(1),
  id,
  kind: z.enum(['existing-floor', 'finished-floor']),
  zeroFloorId: id,
  floors: z
    .array(
      z
        .object({
          id,
          room,
          surface: z.enum(['existing-floor', 'finished-floor']),
          elevationCm: elevation,
        })
        .strict(),
    )
    .min(1)
    .max(200),
  ceilings: z
    .array(z.object({ id, floorId: id, elevationCm: elevation }).strict())
    .max(200)
    .optional(),
  wallBases: z.array(z.object({ wall, floorId: id }).strict()).max(200),
  thresholds: z
    .array(z.object({ id, bindings: z.tuple([binding, binding]), elevationCm: elevation }).strict())
    .max(200),
  source: z
    .object({
      kind: z.enum(['site-measurement', 'dimensioned-drawing']),
      reference: z.string().trim().min(1).max(1000),
    })
    .strict(),
}
const requestSchema = z.object({ ...requestFields, acknowledged: z.literal(true) }).strict()
const storedSchema = z
  .object({
    ...requestFields,
    contextSnapshot: z
      .object({
        footprint: z.array(point).max(200).optional(),
        voids: z
          .array(z.object({ id, polygon: z.array(point).min(3).max(200) }).strict())
          .max(200)
          .optional(),
        imageCalibration: imageCalibration.optional(),
        pdfCalibration: z
          .object({
            sourceSha256: z.string().regex(/^[a-f0-9]{64}$/),
            pdfPage: z.number().int().positive(),
            cmPerPoint: z.number().finite().positive(),
            origin: z.object({ x: coordinate, y: coordinate }).strict(),
          })
          .strict()
          .optional(),
      })
      .strict(),
    verifiedAt: z.string().datetime(),
    verifiedBy: id,
  })
  .strict()

// Sorted object keys make equality independent of JSON property insertion order.
// Array order and every exact coordinate/label remain significant.
function canonical(value: unknown): string {
  return JSON.stringify(value, (_key, entry) => {
    if (entry && typeof entry === 'object' && !Array.isArray(entry)) {
      return Object.fromEntries(Object.entries(entry).sort(([a], [b]) => a.localeCompare(b)))
    }
    return entry
  })
}
function same(a: unknown, b: unknown) {
  return canonical(a) === canonical(b)
}
function sameContour(
  a: ReferenceGeometry['rooms'][number]['polygon'],
  b: ReferenceGeometry['rooms'][number]['polygon'],
) {
  if (a.length !== b.length) return false
  return b.some((_point, offset) =>
    [1, -1].some((direction) =>
      a.every((point, index) => same(point, b[(offset + direction * index + b.length) % b.length])),
    ),
  )
}
function wallSnapshot(value: ReferenceGeometry['walls'][number]) {
  const { id, kind, start, end, thicknessCm } = value
  return { id, kind, start, end, thicknessCm }
}
function openingSnapshot(value: ReferenceGeometry['openings'][number]) {
  const { id, type, wallId, offsetCm, widthCm } = value
  return { id, type, wallId, offsetCm, widthCm }
}
function contextSnapshot(geometry: ReferenceGeometry): PlanVerticalReference['contextSnapshot'] {
  const pdf = geometry.pdfCalibration
  return structuredClone({
    footprint: geometry.footprint,
    voids: geometry.voids,
    imageCalibration: geometry.imageCalibration,
    pdfCalibration: pdf
      ? {
          sourceSha256: pdf.sourceSha256,
          pdfPage: pdf.pdfPage,
          cmPerPoint: pdf.cmPerPoint,
          origin: pdf.origin,
        }
      : undefined,
  })
}

/** Storage validation only: it does not certify automatic recognition or enable consumers. */
export function inspectPlanVerticalReference(geometry: ReferenceGeometry): PlanGeometryIssue[] {
  if (geometry.verticalReference === undefined) return []
  const fail = (reason: string): PlanGeometryIssue[] => [
    {
      id: 'vertical-reference',
      severity: 'error',
      message: `Высотный отсчёт не подтверждён: ${reason}`,
    },
  ]
  const parsed = storedSchema.safeParse(geometry.verticalReference)
  if (!parsed.success) return fail('неверный формат отметок или подтверждения.')
  if (geometry.rooms.length > 200 || geometry.walls.length > 200 || geometry.openings.length > 200)
    return fail('слишком много элементов для ограниченной проверки отсчёта.')
  const reference = geometry.verticalReference
  if (!same(reference.contextSnapshot, contextSnapshot(geometry)))
    return fail('изменились контуры, масштаб или источник.')
  const unique = (values: string[]) => new Set(values).size === values.length
  if (
    geometry.rooms.some((room, index) =>
      geometry.rooms.slice(index + 1).some((other) => sameContour(room.polygon, other.polygon)),
    )
  )
    return fail(
      'один физический контур нельзя разделять на несколько владельцев по названиям или подписям.',
    )
  if (
    geometry.rooms.some(
      ({ polygon }) =>
        polygon.reduce((area, start, index) => {
          const end = polygon[(index + 1) % polygon.length]
          return area + (end ? start.xCm * end.yCm - end.xCm * start.yCm : 0)
        }, 0) === 0,
    )
  )
    return fail('пол должен иметь ненулевую площадь.')
  if (
    !unique(geometry.walls.map((value) => value.id)) ||
    !unique(geometry.openings.map((value) => value.id))
  )
    return fail('повторяются идентификаторы элементов.')
  if (
    !unique(reference.floors.map((value) => value.id)) ||
    reference.floors.length !== geometry.rooms.length ||
    reference.floors.some(
      (floor) => geometry.rooms.filter((value) => same(value, floor.room)).length !== 1,
    ) ||
    geometry.rooms.some(
      (value) => reference.floors.filter((floor) => same(value, floor.room)).length !== 1,
    )
  )
    return fail('каждый физический контур пола должен иметь одну актуальную привязку.')
  const floors = new Map(reference.floors.map((value) => [value.id, value]))
  if (floors.get(reference.zeroFloorId)?.elevationCm !== 0)
    return fail('нулевой пол должен иметь отметку ровно 0.')
  if (floors.get(reference.zeroFloorId)?.surface !== reference.kind)
    return fail('поверхность нулевого пола должна соответствовать виду общего отсчёта.')
  if (
    !unique(reference.wallBases.map((value) => value.wall.id)) ||
    reference.wallBases.length !== geometry.walls.length ||
    reference.wallBases.some(
      (base) =>
        !floors.has(base.floorId) ||
        !geometry.walls.some((value) => same(wallSnapshot(value), base.wall)),
    )
  )
    return fail('основания всех стен должны быть привязаны к актуальным полам.')
  const ceilings = reference.ceilings ?? []
  if (
    !unique(ceilings.map((value) => value.id)) ||
    !unique(ceilings.map((value) => value.floorId)) ||
    ceilings.some(
      (value) =>
        !floors.has(value.floorId) ||
        value.elevationCm <= (floors.get(value.floorId)?.elevationCm ?? Infinity) ||
        value.elevationCm - (floors.get(value.floorId)?.elevationCm ?? -Infinity) > 600,
    )
  )
    return fail('потолок должен быть выше своего пола без противоречивых привязок.')
  const sourcePairs = currentOpeningFacePairs(geometry).map((pair) =>
    pair.bindings.map((value) => value.opening.id),
  )
  for (const proof of currentOpeningWidthProofs(geometry)) {
    if (
      proof.sameOpeningAs &&
      proof.oppositeBinding &&
      proof.sameOpeningAs.openingId === proof.oppositeBinding.opening.id
    )
      sourcePairs.push([proof.opening.id, proof.oppositeBinding.opening.id])
  }
  const partners = new Map<string, Set<string>>()
  for (const pair of sourcePairs) {
    const [first, second] = pair
    if (!first || !second) continue
    for (const [owner, other] of [
      [first, second],
      [second, first],
    ]) {
      if (!owner || !other) continue
      const known = partners.get(owner) ?? new Set<string>()
      known.add(other)
      partners.set(owner, known)
    }
  }
  if (!unique(reference.thresholds.map((value) => value.id)))
    return fail('повторяются идентификаторы порогов.')
  const seenOpenings = new Set<string>()
  for (const threshold of reference.thresholds) {
    const [a, b] = threshold.bindings
    if (
      a.floorId === b.floorId ||
      a.opening.wallId === b.opening.wallId ||
      a.opening.id === b.opening.id ||
      partners.get(a.opening.id)?.size !== 1 ||
      partners.get(b.opening.id)?.size !== 1 ||
      !sourcePairs.some((pair) => pair.includes(a.opening.id) && pair.includes(b.opening.id))
    )
      return fail('порог требует двух подтверждённых сторон одного проёма и разных полов.')
    for (const side of threshold.bindings) {
      const floor = floors.get(side.floorId)
      const actual = geometry.openings.find((value) => value.id === side.opening.id)
      const base = reference.wallBases.find((value) => value.wall.id === side.opening.wallId)
      if (
        !floor ||
        !actual ||
        side.opening.type === 'window' ||
        !same(openingSnapshot(actual), side.opening) ||
        base?.floorId !== side.floorId ||
        seenOpenings.has(side.opening.id) ||
        threshold.elevationCm < floor.elevationCm ||
        !openingOnFloorBoundary(geometry, side.opening.id, floor.room.polygon)
      )
        return fail('устарела сторона порога, её хозяин или отметка верха.')
      seenOpenings.add(side.opening.id)
    }
  }
  return []
}

// Thresholds use source wall faces, not arbitrary nearby wall axes or room names.
function openingOnFloorBoundary(
  geometry: ReferenceGeometry,
  openingId: string,
  polygon: ReferenceGeometry['rooms'][number]['polygon'],
) {
  const cut = geometry.openings.find((value) => value.id === openingId)
  const host = geometry.walls.find((value) => value.id === cut?.wallId)
  if (!cut || !host || !opening.safeParse(openingSnapshot(cut)).success) return false
  const dx = host.end.xCm - host.start.xCm
  const dy = host.end.yCm - host.start.yCm
  const length = Math.hypot(dx, dy)
  if (!length) return false
  const sourceBindings = currentOpeningFacePairs(geometry).flatMap((pair) => pair.bindings)
  for (const proof of currentOpeningWidthProofs(geometry)) {
    sourceBindings.push(proof)
    if (proof.oppositeBinding) sourceBindings.push(proof.oppositeBinding)
  }
  const preservedCuts = sourceBindings
    .filter((binding) => binding.opening.id === openingId && binding.cut !== undefined)
    .map((binding) => binding.cut)
  const preserved = preservedCuts[0]
  if (
    preserved &&
    preservedCuts.some((other) => !same(preserved, other) && !same([...preserved].reverse(), other))
  )
    return false
  if (!preserved && cut.offsetCm + cut.widthCm > length) return false
  const endpoints =
    preserved ??
    [cut.offsetCm, cut.offsetCm + cut.widthCm].map((offset) => ({
      xCm: host.start.xCm + (dx * offset) / length,
      yCm: host.start.yCm + (dy * offset) / length,
    }))
  if (
    endpoints.some((value) => !point.safeParse(value).success) ||
    same(endpoints[0], endpoints[1])
  )
    return false
  const onSegment = (start: typeof host.start, end: typeof host.end) =>
    endpoints.every(
      (value) =>
        (end.xCm - start.xCm) * (value.yCm - start.yCm) ===
          (end.yCm - start.yCm) * (value.xCm - start.xCm) &&
        value.xCm >= Math.min(start.xCm, end.xCm) &&
        value.xCm <= Math.max(start.xCm, end.xCm) &&
        value.yCm >= Math.min(start.yCm, end.yCm) &&
        value.yCm <= Math.max(start.yCm, end.yCm),
    )
  if (!onSegment(host.start, host.end)) return false
  const containsCut = (boundary: typeof polygon) =>
    boundary.some((start, index) => {
      const end = boundary[(index + 1) % boundary.length]
      return end !== undefined && onSegment(start, end)
    })
  // Coincident faces on a shared edge do not identify the interior owner.
  // Hold both assignments until source-facing ownership is represented explicitly.
  return (
    containsCut(polygon) && geometry.rooms.filter((room) => containsCut(room.polygon)).length === 1
  )
}

/** Fresh physical ownership, independent of a merely declared wall-base association. */
export function openingOnVerticalFloorBoundary(
  geometry: ReferenceGeometry,
  openingId: string,
  floorId: string,
): boolean {
  const reference = currentPlanVerticalReference(geometry)
  const floor = reference?.floors.find((value) => value.id === floorId)
  const opening = geometry.openings.find((value) => value.id === openingId)
  const base = reference?.wallBases.find((value) => value.wall.id === opening?.wallId)
  return (
    floor !== undefined &&
    base?.floorId === floorId &&
    openingOnFloorBoundary(geometry, openingId, floor.room.polygon)
  )
}

export function wallFloorElevation(
  geometry: ReferenceGeometry,
  wallId: string,
): number | undefined {
  if (!geometry.verticalReference || inspectPlanVerticalReference(geometry).length) return undefined
  const base = geometry.verticalReference.wallBases.find((value) => value.wall.id === wallId)
  return geometry.verticalReference.floors.find((value) => value.id === base?.floorId)?.elevationCm
}

export function currentPlanVerticalReference(
  geometry: ReferenceGeometry,
): PlanVerticalReference | undefined {
  return inspectPlanVerticalReference(geometry).length ? undefined : geometry.verticalReference
}

/** Fresh reference only; each consumer must also validate the physical floor geometry. */
export function referenceTransferIssue(geometry: ReferenceGeometry): PlanGeometryIssue | undefined {
  return inspectPlanVerticalReference(geometry)[0]
}

/** Missing request preserves only fresh approval; null explicitly removes the model. */
export function applyPlanVerticalReference(
  geometry: PlanGeometry,
  input: unknown,
  userId: string,
  verifiedAt: string,
): { ok: true; geometry: PlanGeometry } | { ok: false; error: string } {
  if (input === null) {
    const { verticalReference: _removed, ...withoutReference } = geometry
    return { ok: true, geometry: withoutReference }
  }
  if (input === undefined) {
    const issues = inspectPlanVerticalReference(geometry)
    return issues.length
      ? { ok: false, error: issues[0]?.message ?? 'Устарело подтверждение.' }
      : { ok: true, geometry }
  }
  const parsed = requestSchema.safeParse(input)
  if (!parsed.success)
    return { ok: false, error: 'Проверьте отметки и явно подтвердите общий высотный отсчёт.' }
  const { acknowledged: _acknowledged, ...values } = parsed.data
  const candidate: PlanGeometry = {
    ...geometry,
    verticalReference: {
      ...values,
      contextSnapshot: contextSnapshot(geometry),
      verifiedAt,
      verifiedBy: userId,
    } as PlanVerticalReference,
  }
  const issues = inspectPlanVerticalReference(candidate)
  return issues.length
    ? { ok: false, error: issues[0]?.message ?? 'Неверный отсчёт.' }
    : { ok: true, geometry: candidate }
}
