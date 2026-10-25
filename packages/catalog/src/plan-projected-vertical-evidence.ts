import type { PlanGeometry, PlanProjectedVerticalEvidence } from '@uyut/db'
import { isPlanRoomSourceNumber } from '@uyut/db/source-room-number'
import { z } from 'zod'
import { planVerticalRoomSnapshot } from './plan-vertical-reference'

export const PROJECTED_VERTICAL_LABELS: Record<PlanProjectedVerticalEvidence['quantity'], string> =
  {
    'floor-level': 'Отметка пола',
    'ceiling-drop': 'Опуск потолка',
    'section-headroom': 'Высота из развёртки',
    'opening-height': 'Высота проёма',
    'glazing-height': 'Высота остекления',
    'sill-height': 'Высота подоконника',
    'slab-height': 'Между перекрытиями',
  }

/** Unit conversion only: this never evaluates an expression or infers an elevation. */
export function parsePrintedProjectValue(token: unknown, unit: unknown): number | undefined {
  if (typeof token !== 'string' || token.length > 100) return undefined
  if (unit !== 'mm' && unit !== 'cm' && unit !== 'm') return undefined
  const normalized = token.trim().replace(/−/g, '-').replace(',', '.')
  if (!/^[+\-±]?(?:\d+(?:\.\d+)?|\.\d+)$/.test(normalized)) return undefined
  const unsigned = normalized.replace(/^[+\-±]/, '')
  if (normalized.startsWith('±') && /[1-9]/.test(unsigned)) return undefined
  const [whole = '', fraction = ''] = unsigned.split('.')
  const digits = whole + fraction
  const decimalPosition = whole.length + (unit === 'm' ? 2 : unit === 'mm' ? -1 : 0)
  const converted =
    decimalPosition <= 0
      ? `0.${'0'.repeat(-decimalPosition)}${digits}`
      : decimalPosition >= digits.length
        ? digits + '0'.repeat(decimalPosition - digits.length)
        : `${digits.slice(0, decimalPosition)}.${digits.slice(decimalPosition)}`
  const value = Number(`${normalized.startsWith('-') ? '-' : ''}${converted}`)
  return Number.isFinite(value) ? (value === 0 ? 0 : value) : undefined
}

const id = z.string().trim().min(1).max(100)
const coordinate = z.number().finite().min(-10000).max(10000)
const point = z.object({ xCm: coordinate, yCm: coordinate }).strict()
const room = z
  .object({
    name: z.string().min(1).max(200),
    polygon: z.array(point).min(3).max(200),
    spaceKind: z.enum(['interior', 'balcony', 'loggia']).optional(),
    sourceNumber: z.number().refine(isPlanRoomSourceNumber).optional(),
    sourceNumbers: z.array(z.number().refine(isPlanRoomSourceNumber)).min(1).max(200).optional(),
  })
  .strict()
  .refine((value) => !(value.sourceNumber !== undefined && value.sourceNumbers !== undefined))
  .refine(
    (value) =>
      !value.sourceNumbers || new Set(value.sourceNumbers).size === value.sourceNumbers.length,
  )
const sha = z.string().regex(/^[a-f0-9]{64}$/)
const page = z.number().int().positive().max(10000)

export const projectedVerticalEvidenceSchema = z
  .object({
    id,
    quantity: z.enum([
      'floor-level',
      'ceiling-drop',
      'section-headroom',
      'opening-height',
      'glazing-height',
      'sill-height',
      'slab-height',
    ]),
    printedValue: z.string().min(1).max(100),
    unit: z.enum(['mm', 'cm', 'm']),
    valueCm: z.number().finite(),
    scopeLabel: z.string().trim().min(1).max(300).optional(),
    target: z.discriminatedUnion('kind', [
      z.object({ kind: z.literal('room'), room }).strict(),
      z
        .object({
          kind: z.literal('opening'),
          opening: z
            .object({
              id,
              type: z.enum(['door', 'window', 'balcony']),
              wallId: id,
              offsetCm: z.number().finite().min(0).max(10000),
              widthCm: z.number().finite().positive().max(10000),
            })
            .strict(),
          wall: z
            .object({
              id,
              kind: z.enum(['outer', 'inner']),
              start: point,
              end: point,
              thicknessCm: z.number().finite().positive().max(100).optional(),
            })
            .strict(),
        })
        .strict(),
      z.object({ kind: z.literal('project') }).strict(),
    ]),
    geometrySource: z.object({ sha256: sha, pdfPage: page, state: z.literal('proposed') }).strict(),
    source: z
      .object({
        sha256: sha,
        pdfPage: page,
        captionIndexes: z.array(z.number().int().min(0)).min(1).max(8),
        captionTexts: z.array(z.string().trim().min(1).max(1000)).min(1).max(8),
      })
      .strict(),
    reviewNote: z.string().trim().min(1).max(1000).optional(),
    reviewedAt: z.string().datetime(),
    reviewedBy: id,
  })
  .strict()
  .refine((value) => {
    if (parsePrintedProjectValue(value.printedValue, value.unit) !== value.valueCm) return false
    if (value.source.sha256 !== value.geometrySource.sha256) return false
    if (value.source.captionIndexes.length !== value.source.captionTexts.length) return false
    if (new Set(value.source.captionIndexes).size !== value.source.captionIndexes.length)
      return false
    const targetKind =
      value.quantity === 'slab-height'
        ? 'project'
        : value.quantity === 'opening-height'
          ? 'opening'
          : 'room'
    if (value.target.kind !== targetKind) return false
    if (value.quantity === 'floor-level') return Math.abs(value.valueCm) <= 10000
    if (value.quantity === 'ceiling-drop') return Math.abs(value.valueCm) <= 600
    return (
      value.valueCm <= 1000 &&
      (value.quantity === 'sill-height' ? value.valueCm >= 0 : value.valueCm > 0)
    )
  })

function same(first: unknown, second: unknown): boolean {
  const canonical = (value: unknown) =>
    JSON.stringify(value, (_key, entry) =>
      entry && typeof entry === 'object' && !Array.isArray(entry)
        ? Object.fromEntries(Object.entries(entry).sort(([a], [b]) => a.localeCompare(b)))
        : entry,
    )
  return canonical(first) === canonical(second)
}

type EvidenceGeometry = Pick<
  PlanGeometry,
  | 'rooms'
  | 'walls'
  | 'openings'
  | 'pdfCalibration'
  | 'projectedVerticalEvidence'
  | 'requiresSourceReviewReimport'
>

/** Documentary freshness only; this grants no physical floor, height or 3D proof. */
export function currentProjectedVerticalEvidence(
  geometry: EvidenceGeometry,
): PlanProjectedVerticalEvidence[] {
  const calibration = geometry.pdfCalibration
  const evidence = geometry.projectedVerticalEvidence
  if (
    geometry.requiresSourceReviewReimport ||
    calibration?.sourceState !== 'proposed' ||
    !Array.isArray(evidence) ||
    evidence.length > 200
  )
    return []
  const idCounts = new Map<unknown, number>()
  for (const value of evidence) {
    const key = value && typeof value === 'object' ? value.id : undefined
    idCounts.set(key, (idCounts.get(key) ?? 0) + 1)
  }
  return evidence.filter((value) => {
    const parsed = projectedVerticalEvidenceSchema.safeParse(value)
    if (!parsed.success || idCounts.get(parsed.data.id) !== 1) return false
    const record = parsed.data
    if (
      record.geometrySource.sha256 !== calibration.sourceSha256 ||
      record.geometrySource.pdfPage !== calibration.pdfPage
    )
      return false
    const target = record.target
    if (target.kind === 'project') return true
    if (target.kind === 'room') {
      return (
        geometry.rooms.filter((candidate) => same(planVerticalRoomSnapshot(candidate), target.room))
          .length === 1
      )
    }
    if (
      geometry.openings.filter(({ id }) => id === target.opening.id).length !== 1 ||
      geometry.walls.filter(({ id }) => id === target.wall.id).length !== 1
    )
      return false
    const openingMatches = geometry.openings.filter(({ id, type, wallId, offsetCm, widthCm }) =>
      same({ id, type, wallId, offsetCm, widthCm }, target.opening),
    )
    const wallMatches = geometry.walls.filter(({ id, kind, start, end, thicknessCm }) =>
      same({ id, kind, start, end, thicknessCm }, target.wall),
    )
    return (
      target.opening.wallId === target.wall.id &&
      openingMatches.length === 1 &&
      wallMatches.length === 1
    )
  })
}
