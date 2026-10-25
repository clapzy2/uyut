import type { LayoutItem } from '@uyut/catalog/layout'
import {
  createProjectedContourBinding,
  projectedContourOptions,
  projectedGeometryKey,
  projectedLayoutWithMeasurements,
} from '@uyut/catalog/projected-room-layout'
import { layoutWithMeasurements } from '@uyut/catalog/reviewed-layout-with-measurements'
import { roomVolume } from '@uyut/catalog/room-volume'
import type { PlanGeometry, RoomMeasurements } from '@uyut/db'
import { describe, expect, it } from 'vitest'

function geometry(): PlanGeometry {
  return {
    version: 1,
    source: 'manual',
    status: 'draft',
    widthCm: 1000,
    heightCm: 800,
    warnings: ['Проектный источник'],
    walls: [
      { id: 'top', kind: 'outer', start: { xCm: 100, yCm: 50 }, end: { xCm: 500, yCm: 50 } },
      { id: 'left', kind: 'inner', start: { xCm: 100, yCm: 50 }, end: { xCm: 100, yCm: 350 } },
    ],
    openings: [
      { id: 'window', type: 'window', wallId: 'top', offsetCm: 120, widthCm: 100 },
      { id: 'door', type: 'door', wallId: 'left', offsetCm: 180, widthCm: 90 },
    ],
    rooms: [
      {
        sourceNumber: 4,
        name: 'Гостиная',
        polygon: [
          { xCm: 100, yCm: 50 },
          { xCm: 500, yCm: 50 },
          { xCm: 500, yCm: 200 },
          { xCm: 300, yCm: 200 },
          { xCm: 300, yCm: 350 },
          { xCm: 100, yCm: 350 },
        ],
      },
    ],
    pdfCalibration: {
      sourceSha256: 'a'.repeat(64),
      sourceState: 'proposed',
      pdfPage: 2,
      cmPerPoint: 1.7,
      origin: { x: 131.881, y: 137.441 },
      anchorRoomNumbers: [],
      labelIndexes: [],
      derivedOpeningIds: ['door', 'window'],
    },
  }
}

function measurements(plan: PlanGeometry, roomIndex = 0): RoomMeasurements {
  const binding = createProjectedContourBinding(plan, roomIndex)
  if (!binding) throw new Error('Missing projected binding')
  return { widthCm: 900, depthCm: 700, projectedContour: binding }
}

const chair: LayoutItem = {
  id: 'chair',
  title: 'Стул',
  category: 'chair',
  dimensions: { width: 45, depth: 45 },
  quantity: 1,
}

describe('explicit projected furnishing geometry', () => {
  it('keeps missing room functions and furniture data visible in the summary', () => {
    const plan = geometry()
    const cases: Array<{ items: LayoutItem[]; kind: 'kid' | 'bedroom' | 'living' }> = [
      { items: [], kind: 'kid' },
      {
        items: [
          {
            id: 'bed',
            title: 'Кровать без габаритов',
            category: 'bed',
            dimensions: null,
            quantity: 1,
          },
        ],
        kind: 'bedroom',
      },
      {
        items: [
          {
            id: 'sofa',
            title: 'Диван без данных о раскрытии',
            category: 'sofa',
            dimensions: { width: 150, depth: 80, height: 83 },
            quantity: 1,
          },
        ],
        kind: 'living',
      },
    ]
    for (const entry of cases) {
      const layout = projectedLayoutWithMeasurements(
        'Проектная комната',
        measurements(plan),
        plan,
        entry.items,
        entry.kind,
      )
      expect(layout?.safetySummary.status).toBe('needs-data')
      expect(layout?.measurementNote).toContain('не натурный обмер')
      expect(layout?.safetyChecks).toContainEqual(
        expect.objectContaining({ id: 'projected-source', status: 'preliminary' }),
      )
    }
  })

  it('does not hide a blocked pinned position behind the project source status', () => {
    const plan = geometry()
    const layout = projectedLayoutWithMeasurements(
      'Проектная комната',
      measurements(plan),
      plan,
      [{ ...chair, placement: { xCm: 350, yCm: 250, rotation: 0 } }],
      'living',
    )
    expect(layout?.safetySummary.status).toBe('blocked')
    expect(layout?.placed).toEqual([])
  })

  it('retains room-specific source warnings in both the layout and PDF-facing note', () => {
    const plan = geometry()
    const warning = 'Гостиная: площадь по контуру отличается от таблицы. Сверьте границы.'
    plan.warnings.push(warning)
    const result = projectedLayoutWithMeasurements('Новое имя', measurements(plan), plan, [])
    expect(result?.missingSafetyData).toContain(warning)
    expect(result?.measurementNote).toContain(warning)
  })

  it('requires a deliberate binding and never binds an old room by its name', () => {
    const plan = geometry()
    expect(
      projectedLayoutWithMeasurements('Гостиная', { widthCm: 900, depthCm: 700 }, plan, []),
    ).toBeNull()
    const selected = projectedLayoutWithMeasurements(
      'Новое проектное задание',
      measurements(plan),
      plan,
      [],
    )
    expect(selected).toMatchObject({ widthCm: 400, depthCm: 300 })
    expect(selected?.floorPolygon).toHaveLength(6)
    expect(selected?.missingSafetyData.some((line) => line.includes('мерка 900'))).toBe(true)
    expect(plan.status).toBe('draft')
  })

  it('keeps JSONB object-key reorder stable without ignoring array order or calibration', () => {
    const plan = geometry()
    const reordered = JSON.parse(JSON.stringify(plan), (_key, value) => {
      if (value && typeof value === 'object' && !Array.isArray(value))
        return Object.fromEntries(Object.entries(value).reverse())
      return value
    }) as PlanGeometry
    expect(projectedGeometryKey(reordered)).toBe(projectedGeometryKey(plan))
    expect(
      projectedLayoutWithMeasurements('Same', measurements(plan), reordered, []),
    ).not.toBeNull()
    reordered.rooms.reverse()
    reordered.walls.reverse()
    expect(projectedGeometryKey(reordered)).not.toBe(projectedGeometryKey(plan))
  })

  it.each(['polygon', 'calibration', 'source', 'page', 'opening', 'warnings'] as const)(
    'rejects a stale %s snapshot and never uses rectangular fallback',
    (change) => {
      const plan = geometry()
      const bound = measurements(plan)
      const room = plan.rooms[0]
      const source = plan.pdfCalibration
      const opening = plan.openings[0]
      if (!room || !source || !opening) throw new Error('Missing fixture')
      if (change === 'polygon') room.polygon[0] = { xCm: 101, yCm: 50 }
      if (change === 'calibration') source.cmPerPoint += 0.01
      if (change === 'source') source.sourceSha256 = 'b'.repeat(64)
      if (change === 'page') source.pdfPage = 3
      if (change === 'opening') opening.widthCm = 99
      if (change === 'warnings') plan.warnings.push('Changed source warning')
      expect(layoutWithMeasurements('Гостиная', bound, plan, [])).toBeNull()
    },
  )

  it('rejects altered binding identifiers and malformed binding without fallback', () => {
    const plan = geometry()
    for (const patch of [
      { roomIndex: 1 },
      { sourceNumbers: [6] },
      { pdfPage: 3 },
      { sourceSha256: 'b'.repeat(64) },
    ]) {
      const bound = measurements(plan)
      if (!bound.projectedContour) throw new Error('Missing binding')
      bound.projectedContour = { ...bound.projectedContour, ...patch }
      expect(layoutWithMeasurements('Гостиная', bound, plan, [])).toBeNull()
    }
    const malformed = {
      widthCm: 900,
      depthCm: 700,
      projectedContour: null,
    } as unknown as RoomMeasurements
    expect(layoutWithMeasurements('Гостиная', malformed, plan, [])).toBeNull()
  })

  it('offers a grouped open zone as one physical region and excludes explicit wet-room names', () => {
    const plan = geometry()
    const room = plan.rooms[0]
    if (!room) throw new Error('Missing room')
    plan.rooms = [
      {
        ...room,
        name: 'Прихожая / Гостиная / Кухня',
        sourceNumber: undefined,
        sourceNumbers: [1, 2, 3],
      },
      {
        name: 'Гостевой санузел',
        sourceNumber: 8,
        polygon: [
          { xCm: 600, yCm: 50 },
          { xCm: 800, yCm: 50 },
          { xCm: 800, yCm: 200 },
          { xCm: 600, yCm: 200 },
        ],
      },
    ]
    expect(projectedContourOptions(plan)).toMatchObject([
      { roomIndex: 0, sourceNumbers: [1, 2, 3] },
    ])
    const layout = layoutWithMeasurements('Гостиная', measurements(plan), plan, [chair], 'living')
    expect(layout?.floorPolygon).toHaveLength(6)
    expect(layout?.measurementNote).toContain('1 + 2 + 3')
    expect(createProjectedContourBinding(plan, 1)).toBeNull()
  })

  it('preserves concave cuts, holes, fixed obstacles and draft opening positions', () => {
    const plan = geometry()
    plan.voids = [
      {
        id: 'shaft',
        polygon: [
          { xCm: 150, yCm: 100 },
          { xCm: 180, yCm: 100 },
          { xCm: 180, yCm: 130 },
          { xCm: 150, yCm: 130 },
        ],
      },
    ]
    plan.obstacles = [{ id: 'column', kind: 'column', xCm: 250, yCm: 80, widthCm: 40, depthCm: 40 }]
    const blocked = { ...chair, placement: { xCm: 300, yCm: 240, rotation: 0 as const } }
    const layout = layoutWithMeasurements('Гостиная', measurements(plan), plan, [blocked], 'living')
    expect(layout?.floorPolygon).toEqual([
      { xCm: 0, yCm: 0 },
      { xCm: 400, yCm: 0 },
      { xCm: 400, yCm: 150 },
      { xCm: 200, yCm: 150 },
      { xCm: 200, yCm: 300 },
      { xCm: 0, yCm: 300 },
    ])
    expect(layout?.placed).toEqual([])
    expect(layout?.keepClearZones).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          label: 'Техническая пустота shaft',
          polygon: expect.arrayContaining([{ xCm: 50, yCm: 50 }]),
        }),
        expect.objectContaining({ label: 'Колонна' }),
      ]),
    )
    expect(layout?.floorReservations).toHaveLength(2)
    expect(layout?.missingSafetyData.some((line) => line.includes('подоконника'))).toBe(true)
  })

  it('always announces preliminary source state and never fabricates walls or heights', () => {
    const plan = geometry()
    const layout = layoutWithMeasurements('Гостиная', measurements(plan), plan, [chair], 'living')
    expect(layout?.safetyChecks).toContainEqual(
      expect.objectContaining({ id: 'projected-source', status: 'preliminary' }),
    )
    expect(layout?.missingSafetyData.length).toBeGreaterThan(0)
    expect(layout?.measurementNote).toContain('не натурный обмер')
    expect(layout?.safetySummary.status).not.toBe('checked')
    expect(layout?.safetyChecks.every((check) => check.status !== 'checked')).toBe(true)
    expect(layout?.floorLevel).toBeUndefined()
    if (!layout) throw new Error('Missing layout')
    const volume = roomVolume(layout)
    expect(volume?.walls).toEqual([])
    expect(volume?.solidFaces).toEqual([])
    expect(volume?.verticalDatum).toBeUndefined()
    expect(volume?.furniture?.length).toBe(1)
    expect(volume?.furniture?.every((item) => item.heightCm === undefined)).toBe(true)
  })

  it('fails closed for unsupported source/status, vertical reference, invalid rings and overlapping identities', () => {
    const plans = [geometry(), geometry(), geometry(), geometry(), geometry(), geometry()]
    const [confirmed, stale, existing, vertical, crossed, duplicate] = plans
    if (
      !confirmed ||
      !stale ||
      !existing?.pdfCalibration ||
      !vertical ||
      !crossed?.rooms[0] ||
      !duplicate?.rooms[0]
    )
      throw new Error('Missing fixtures')
    confirmed.status = 'confirmed'
    stale.requiresSourceReviewReimport = true
    existing.pdfCalibration.sourceState = 'existing'
    vertical.verticalReference = {} as NonNullable<PlanGeometry['verticalReference']>
    crossed.rooms[0].polygon = [
      { xCm: 100, yCm: 50 },
      { xCm: 500, yCm: 350 },
      { xCm: 100, yCm: 350 },
      { xCm: 500, yCm: 50 },
    ]
    duplicate.rooms.push(structuredClone(duplicate.rooms[0]))
    for (const plan of plans) expect(projectedContourOptions(plan)).toEqual([])
  })

  it('bounds canonical snapshots and rejects nonfinite values instead of serializing them as null', () => {
    const plan = geometry()
    plan.warnings = ['x'.repeat(300_001)]
    expect(projectedGeometryKey(plan)).toBeNull()
    plan.warnings = []
    plan.widthCm = Number.NaN
    expect(projectedGeometryKey(plan)).toBeNull()
    expect(projectedContourOptions(plan)).toEqual([])
  })
})
