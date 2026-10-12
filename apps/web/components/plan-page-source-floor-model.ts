import { isPlanRoomSourceNumber } from '@uyut/db/source-room-number'
import { z } from 'zod'
import { exactNativePointKey } from '@/lib/projects/plan-native-exact-intersections'
import type { SourceFloorReference } from '@/lib/projects/plan-page-source-floors'
import type { PageContourDraft, PlanPagePreview } from './plan-page-contour-editor-model'

const point = z.strictObject({ x: z.number().min(0).max(1000), y: z.number().min(0).max(1000) })
const ring = z.array(point).min(3).max(100)
const keys = z
  .array(
    z
      .string()
      .max(256)
      .regex(/^(0|[1-9]\d*)\/[1-9]\d*:(0|[1-9]\d*)\/[1-9]\d*$/),
  )
  .min(3)
  .max(100)
const referenceSchema = z.strictObject({
  version: z.literal(1),
  coordinateSystem: z.literal('page-0-1000'),
  source: z.strictObject({
    sha256: z.string().regex(/^[a-f0-9]{64}$/),
    pdfPage: z.number().int().positive(),
    state: z.literal('existing'),
  }),
  sourceRevision: z.string().regex(/^[a-f0-9]{64}$/),
  pageWidth: z.number().positive().max(100000),
  pageHeight: z.number().positive().max(100000),
  status: z.enum(['not-saved', 'held', 'checked']),
  reason: z.string().max(256).nullable(),
  readOnly: z.literal(true),
  physicalBoundariesAccepted: z.literal(false),
  floors: z
    .array(
      z.strictObject({
        id: z.string().min(1).max(128),
        sourceRoomKey: z.string().min(1).max(32),
        name: z.string().min(1).max(200),
        polygon: ring,
        holes: z.array(ring).max(50),
        exactPointKeys: keys,
        holeExactPointKeys: z.array(keys).max(50),
        nonDecimalVertices: z.number().int().min(0).max(5100),
        omittedStrokeCount: z.number().int().min(0).max(6000),
        boundaryInkComplete: z.boolean(),
      }),
    )
    .max(50),
})

export function sourceFloorReferenceFromResponse(
  value: unknown,
  page: PlanPagePreview,
  revision: string,
): SourceFloorReference | null {
  const parsed = referenceSchema.safeParse(value)
  if (!parsed.success) return null
  const report = parsed.data
  if (
    report.source.sha256 !== page.sha256 ||
    report.source.pdfPage !== page.page ||
    report.sourceRevision !== revision ||
    report.pageWidth !== page.width ||
    report.pageHeight !== page.height ||
    (report.status !== 'checked' && report.floors.length !== 0) ||
    (report.status === 'held' ? !report.reason : report.reason !== null)
  )
    return null
  let pointCount = 0
  const owners = new Set<string>()
  const ids = new Set<string>()
  for (const floor of report.floors) {
    const number = Number(floor.sourceRoomKey)
    if (
      !isPlanRoomSourceNumber(number) ||
      String(number) !== floor.sourceRoomKey ||
      owners.has(floor.sourceRoomKey) ||
      ids.has(floor.id)
    )
      return null
    owners.add(floor.sourceRoomKey)
    ids.add(floor.id)
    if (
      floor.exactPointKeys.length !== floor.polygon.length ||
      floor.holeExactPointKeys.length !== floor.holes.length
    )
      return null
    let nonDecimal = 0
    for (const [index, polygon] of [floor.polygon, ...floor.holes].entries()) {
      const sourceKeys = index === 0 ? floor.exactPointKeys : floor.holeExactPointKeys[index - 1]
      if (!sourceKeys || sourceKeys.length !== polygon.length) return null
      pointCount += polygon.length
      nonDecimal += polygon.filter(
        (point, vertexIndex) => exactNativePointKey(point) !== sourceKeys[vertexIndex],
      ).length
    }
    if (
      pointCount > 10000 ||
      nonDecimal !== floor.nonDecimalVertices ||
      floor.boundaryInkComplete !== (floor.omittedStrokeCount === 0)
    )
      return null
  }
  return report
}

export type SourceFloorDraftResult =
  | { kind: 'candidate'; draft: PageContourDraft }
  | {
      kind: 'held'
      reason: 'missing-selection' | 'holes' | 'rational-precision' | 'unproved-vertex'
    }

/** Whole-ring copy only. No holes become voids, and no nearby node replaces a source vertex. */
export function sourceFloorDraft(
  floor: SourceFloorReference['floors'][number] | undefined,
): SourceFloorDraftResult {
  if (!floor) return { kind: 'held', reason: 'missing-selection' }
  return {
    kind: 'candidate',
    draft: {
      roomSourceNumber: Number(floor.sourceRoomKey),
      polygon: structuredClone(floor.polygon),
      closed: true,
      sourceTopology: {
        kind: 'unclassified-source-paint',
        floorId: floor.id,
        exactPointKeys: [...floor.exactPointKeys],
        holes: structuredClone(floor.holes),
        holeExactPointKeys: structuredClone(floor.holeExactPointKeys),
      },
    },
  }
}

export function sourceFloorReferencePath(
  floor: Pick<SourceFloorReference['floors'][number], 'polygon' | 'holes'>,
): string {
  return [floor.polygon, ...floor.holes]
    .map(
      (ring) =>
        ring.map((point, index) => `${index === 0 ? 'M' : 'L'} ${point.x} ${point.y}`).join(' ') +
        ' Z',
    )
    .join(' ')
}
