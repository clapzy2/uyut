import { type PlanRoomArea, reconcilePlanGeometryRooms } from '@uyut/ai/geometry'
import { planVerticalRoomSnapshot } from '@uyut/catalog/plan-vertical-reference'
import type {
  PlanGeometry,
  PlanOpening,
  PlanRoomShape,
  PlanVerticalReference,
  PlanWall,
} from '@uyut/db'
import { currentOpeningFacePairs, currentOpeningWidthProofs } from './plan-opening-face-pairs'
import { applyPlanVerticalReference, currentPlanVerticalReference } from './plan-vertical-reference'

type WallSnapshot = PlanVerticalReference['wallBases'][number]['wall']
type OpeningSnapshot = PlanVerticalReference['thresholds'][number]['bindings'][number]['opening']

export type VerticalReferenceDraft = {
  id: string
  kind: PlanVerticalReference['kind'] | ''
  zeroFloorId: string
  sourceKind: PlanVerticalReference['source']['kind'] | ''
  sourceReference: string
  floors: Array<{
    id: string
    room: PlanRoomShape
    surface: PlanVerticalReference['kind'] | ''
    elevation: string
    ceiling: string
    ceilingId: string
  }>
  wallBases: Array<{ wall: WallSnapshot; floorId: string }>
  thresholds: Array<{ id: string; bindings: [OpeningSnapshot, OpeningSnapshot]; elevation: string }>
  geometrySnapshot: string
}

type ReferenceRequest = Omit<
  PlanVerticalReference,
  'contextSnapshot' | 'verifiedAt' | 'verifiedBy'
> & {
  acknowledged: true
}

/** Match the server's room reconciliation before, never after, reviewing owners. */
export function prepareVerticalReferenceGeometry(
  geometry: PlanGeometry,
  readings: readonly PlanRoomArea[],
): { ok: true; geometry: PlanGeometry } | { ok: false; error: string } {
  const reconciled = reconcilePlanGeometryRooms(
    { ...geometry, obstacles: geometry.obstacles ?? [] },
    readings,
  )
  if (
    !reconciled ||
    reconciled.rooms.length === 0 ||
    reconciled.rooms.length !== geometry.rooms.length
  ) {
    return {
      ok: false,
      error:
        'Сначала исправьте горизонтальные привязки помещений: названия, номера, площади и размеры. Сверка высот не может удалить или заменить владельцев пола.',
    }
  }
  return { ok: true, geometry: { ...geometry, rooms: reconciled.rooms } }
}

function canonical(value: unknown): string {
  return JSON.stringify(value, (_key, entry) => {
    if (entry && typeof entry === 'object' && !Array.isArray(entry)) {
      return Object.fromEntries(Object.entries(entry).sort(([a], [b]) => a.localeCompare(b)))
    }
    return entry
  })
}

function wallSnapshot({ id, kind, start, end, thicknessCm }: PlanWall): WallSnapshot {
  return structuredClone({ id, kind, start, end, thicknessCm })
}

function openingSnapshot({ id, type, wallId, offsetCm, widthCm }: PlanOpening): OpeningSnapshot {
  return { id, type, wallId, offsetCm, widthCm }
}

function sorted(values: unknown[]) {
  return values.map(canonical).sort()
}

/** A review is bound to exact owners/source, not to local aperture or wall height edits. */
export function verticalReferenceDraftSnapshot(geometry: PlanGeometry): string {
  return canonical({
    rooms: sorted(geometry.rooms.map(planVerticalRoomSnapshot)),
    walls: sorted(geometry.walls.map(wallSnapshot)),
    openings: sorted(geometry.openings.map(openingSnapshot)),
    footprint: geometry.footprint,
    voids: geometry.voids,
    pdfCalibration: geometry.pdfCalibration,
    imageCalibration: geometry.imageCalibration,
  })
}

function thresholdCandidates(geometry: PlanGeometry): Array<[OpeningSnapshot, OpeningSnapshot]> {
  const relations: Array<[PlanOpening, PlanOpening]> = currentOpeningFacePairs(geometry).map(
    ({ bindings }) => [bindings[0].opening, bindings[1].opening],
  )
  for (const proof of currentOpeningWidthProofs(geometry)) {
    if (
      proof.sameOpeningAs?.openingId === proof.oppositeBinding?.opening.id &&
      proof.oppositeBinding
    ) {
      relations.push([proof.opening, proof.oppositeBinding.opening])
    }
  }
  const partners = new Map<string, Set<string>>()
  const pairs = new Map<string, [OpeningSnapshot, OpeningSnapshot]>()
  for (const [a, b] of relations) {
    if (a.id === b.id || a.wallId === b.wallId || a.type === 'window' || b.type === 'window')
      continue
    const pair: [OpeningSnapshot, OpeningSnapshot] =
      a.id.localeCompare(b.id) < 0
        ? [openingSnapshot(a), openingSnapshot(b)]
        : [openingSnapshot(b), openingSnapshot(a)]
    pairs.set(canonical(pair), pair)
    const sides: Array<[string, string]> = [
      [a.id, b.id],
      [b.id, a.id],
    ]
    for (const [owner, other] of sides) {
      const set = partners.get(owner) ?? new Set<string>()
      set.add(other)
      partners.set(owner, set)
    }
  }
  return [...pairs.values()].filter(
    ([a, b]) => partners.get(a.id)?.size === 1 && partners.get(b.id)?.size === 1,
  )
}

export function createVerticalReferenceDraft(
  geometry: PlanGeometry,
  idFactory: () => string,
): VerticalReferenceDraft {
  const reference = currentPlanVerticalReference(geometry)
  const floors = geometry.rooms.map((room) => {
    const saved = reference?.floors.find(
      (floor) => canonical(floor.room) === canonical(planVerticalRoomSnapshot(room)),
    )
    const ceiling = reference?.ceilings?.find((value) => value.floorId === saved?.id)
    return {
      id: saved?.id ?? idFactory(),
      room: structuredClone(planVerticalRoomSnapshot(room)),
      surface: saved?.surface ?? ('' as const),
      elevation: saved ? String(saved.elevationCm) : '',
      ceiling: ceiling ? String(ceiling.elevationCm) : '',
      ceilingId: ceiling?.id ?? idFactory(),
    }
  })
  return {
    id: reference?.id ?? idFactory(),
    kind: reference?.kind ?? '',
    zeroFloorId: reference?.zeroFloorId ?? '',
    sourceKind: reference?.source.kind ?? '',
    sourceReference: reference?.source.reference ?? '',
    floors,
    wallBases: geometry.walls.map((wall) => ({
      wall: wallSnapshot(wall),
      floorId:
        reference?.wallBases.find((base) => canonical(base.wall) === canonical(wallSnapshot(wall)))
          ?.floorId ?? '',
    })),
    thresholds: thresholdCandidates(geometry).map((bindings) => {
      const saved = reference?.thresholds.find(
        (threshold) =>
          canonical(sorted(threshold.bindings.map((side) => side.opening))) ===
          canonical(sorted(bindings)),
      )
      return {
        id: saved?.id ?? idFactory(),
        bindings,
        elevation: saved ? String(saved.elevationCm) : '',
      }
    }),
    geometrySnapshot: verticalReferenceDraftSnapshot(geometry),
  }
}

function decimal(value: string): number | undefined {
  const trimmed = value.trim()
  if (!/^[+-]?(?:\d+(?:[.,]\d+)?|[.,]\d+)$/.test(trimmed)) return undefined
  const result = Number(trimmed.replace(',', '.'))
  return Number.isFinite(result) && Math.abs(result) <= 600 ? result : undefined
}

function sameInventory(actual: unknown[], expected: unknown[]): boolean {
  return canonical(sorted(actual)) === canonical(sorted(expected))
}

// The ordinary editable canvas save uses millimetres. Do not approve finer
// coordinates that that save would subsequently change underneath the owners.
function editableGeometryUsesMillimetres(geometry: PlanGeometry): boolean {
  const points = [
    ...geometry.rooms.flatMap((room) => room.polygon),
    ...geometry.walls.flatMap((wall) => [wall.start, wall.end]),
  ]
  const dimensions = [
    geometry.widthCm,
    geometry.heightCm,
    ...points.flatMap((point) => [point.xCm, point.yCm]),
    ...geometry.walls.flatMap((wall) => (wall.thicknessCm === undefined ? [] : [wall.thicknessCm])),
    ...geometry.openings.flatMap((opening) => [opening.offsetCm, opening.widthCm]),
  ]
  return dimensions.every(
    (value) => Number.isFinite(value) && value === Math.round(value * 10) / 10,
  )
}

/** Preview only. The editor must separately obtain acknowledgment of this exact review. */
export function buildVerticalReferenceRequest(
  geometry: PlanGeometry,
  draft: VerticalReferenceDraft,
): { ok: true; request: ReferenceRequest } | { ok: false; error: string } {
  const fail = (error: string) => ({ ok: false as const, error })
  if (draft.geometrySnapshot !== verticalReferenceDraftSnapshot(geometry)) {
    return fail('Изменились контуры или источник. Начните сверку высот заново.')
  }
  if (!editableGeometryUsesMillimetres(geometry)) {
    return fail(
      'Координаты редактируемой схемы точнее миллиметра. Сохраните обычный черновик, откройте его заново и повторно сверьте высоты либо вручную исправьте координаты. Высотные привязки автоматически не округляются.',
    )
  }
  const candidates = thresholdCandidates(geometry)
  if (
    !sameInventory(
      draft.floors.map((floor) => floor.room),
      geometry.rooms.map(planVerticalRoomSnapshot),
    ) ||
    !sameInventory(
      draft.wallBases.map((base) => base.wall),
      geometry.walls.map(wallSnapshot),
    ) ||
    !sameInventory(
      draft.thresholds.map((threshold) => sorted(threshold.bindings)),
      candidates.map(sorted),
    ) ||
    new Set(draft.floors.map((floor) => floor.id)).size !== draft.floors.length ||
    new Set(draft.thresholds.map((threshold) => threshold.id)).size !== draft.thresholds.length
  ) {
    return fail('Изменился или повторяется владелец пола, стены или порога. Начните сверку заново.')
  }
  if (!draft.kind || !draft.sourceKind || !draft.zeroFloorId) {
    return fail('Выберите вид отсчёта, нулевой пол и источник измерений.')
  }
  const floors: PlanVerticalReference['floors'] = []
  const ceilings: NonNullable<PlanVerticalReference['ceilings']> = []
  for (const floor of draft.floors) {
    const elevationCm = decimal(floor.elevation)
    if (elevationCm === undefined || !floor.surface)
      return fail('Укажите поверхность и отметку каждого пола; пустое поле не означает 0.')
    floors.push({
      id: floor.id,
      room: structuredClone(floor.room),
      surface: floor.surface,
      elevationCm,
    })
    if (floor.ceiling.trim() !== '') {
      const ceilingCm = decimal(floor.ceiling)
      if (ceilingCm === undefined)
        return fail('Проверьте отметку потолка: требуется число в сантиметрах.')
      ceilings.push({ id: floor.ceilingId, floorId: floor.id, elevationCm: ceilingCm })
    }
  }
  const thresholds: PlanVerticalReference['thresholds'] = []
  for (const threshold of draft.thresholds) {
    if (threshold.elevation.trim() === '') continue
    const elevationCm = decimal(threshold.elevation)
    if (elevationCm === undefined)
      return fail('Проверьте отметку верха порога: требуется число в сантиметрах.')
    const bindings = threshold.bindings.map((opening) => ({
      opening: structuredClone(opening),
      floorId: draft.wallBases.find((base) => base.wall.id === opening.wallId)?.floorId ?? '',
    })) as PlanVerticalReference['thresholds'][number]['bindings']
    thresholds.push({ id: threshold.id, bindings, elevationCm })
  }
  const request: ReferenceRequest = {
    version: 1,
    id: draft.id,
    kind: draft.kind,
    zeroFloorId: draft.zeroFloorId,
    floors,
    ceilings,
    wallBases: structuredClone(draft.wallBases),
    thresholds,
    source: { kind: draft.sourceKind, reference: draft.sourceReference },
    acknowledged: true,
  }
  const preview = applyPlanVerticalReference(
    geometry,
    request,
    'pending-client',
    '2026-10-11T00:00:00.000Z',
  )
  return preview.ok ? { ok: true, request } : fail(preview.error)
}
