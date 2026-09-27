import {
  mergeReadings,
  parseFloorPlan,
  parseSideRecheck,
  planPolygonAreaM2,
  validatePlanGeometryEdit,
} from '@uyut/ai'
import { layoutRoom, roomLayoutInputFromGeometry } from '@uyut/catalog'
import { rectBlocksFloorReservation, rectInsideFloor } from '@uyut/catalog/layout'
import { describe, expect, it } from 'vitest'
import reference from '../../../../docs/qa/fixtures/apartment-74-77.json'
import { planRoomsSchema } from '../validation/projects'
import { planRows, totalAreaCheck } from './plan-rows'

const raw = {
  planState: reference.source.state,
  totalAreaM2: reference.totalAreaM2,
  ceilingMm: reference.uniformCeilingMm,
  rooms: reference.rooms.map((room) => ({ ...room, sourceNumber: room.number, aspect: 1 })),
}

const contourRooms = reference.rooms.filter(
  (room) => 'localContourMm' in room && room.localContourMm !== undefined,
)

function localGeometry(room: (typeof reference.rooms)[number]) {
  if (!('localContourMm' in room) || !room.localContourMm || !room.widthMm || !room.depthMm) {
    throw new Error('Missing manually annotated contour')
  }
  const widthMm = room.widthMm
  const depthMm = room.depthMm
  const polygon = room.localContourMm.map(([xMm, yMm]) => ({ xMm, yMm }))
  const walls = polygon.map((start, index) => ({
    id: `w${index}`,
    start,
    end: polygon[(index + 1) % polygon.length],
    kind: 'inner',
  }))
  const openings = ('openingChecks' in room ? room.openingChecks : [])?.map((opening, index) => {
    const wallIndex = opening.side === 'top' ? 0 : opening.side === 'bottom' ? 2 : walls.length - 1
    return {
      id: `o${index}`,
      type: opening.type,
      wallId: `w${wallIndex}`,
      offsetMm:
        opening.side === 'top'
          ? opening.offsetMm
          : (opening.side === 'bottom' ? widthMm : depthMm) - opening.offsetMm - opening.widthMm,
      widthMm: opening.widthMm,
    }
  })
  return {
    widthMm,
    heightMm: depthMm,
    walls,
    openings,
    rooms: [{ name: room.name, sourceNumber: room.number, polygon }],
  }
}

describe('published apartment: parser regression, not a vision accuracy test', () => {
  it('preserves all printed millimetres and hundredths of square metres', () => {
    const reading = parseFloorPlan(JSON.stringify(raw))
    expect(reading.totalAreaM2).toBe(74.77)
    expect(reading.rooms).toHaveLength(8)
    for (const expected of reference.rooms) {
      const room = reading.rooms.find((room) => room.sourceNumber === expected.number)
      expect(room?.areaM2).toBe(expected.areaM2)
      expect(room?.widthCm).toBe(expected.widthMm === null ? undefined : expected.widthMm / 10)
      expect(room?.depthCm).toBe(expected.depthMm === null ? undefined : expected.depthMm / 10)
      expect(room?.estimated).toBeUndefined()
    }
    expect(reading.ceilingCm).toBeUndefined()
    expect(reading.rooms.find((room) => room.sourceNumber === 4)?.ceilingCm).toBe(266.3)
    expect(reading.rooms.find((room) => room.sourceNumber === 6)?.ceilingCm).toBe(267.2)
  })

  it('identifies bedrooms by printed number even when response order changes', () => {
    const reading = parseFloorPlan(JSON.stringify({ ...raw, rooms: [...raw.rooms].reverse() }))
    expect(reading.rooms.find((room) => room.name === 'Спальня 4')?.areaM2).toBe(15.39)
    expect(reading.rooms.find((room) => room.name === 'Спальня 6')?.areaM2).toBe(12.23)
  })

  it('distinguishes existing, proposed and unknown sheets', () => {
    expect(parseFloorPlan(JSON.stringify(raw)).planState).toBe('existing')
    expect(parseFloorPlan(JSON.stringify({ ...raw, planState: 'proposed' })).planState).toBe(
      'proposed',
    )
    expect(parseFloorPlan(JSON.stringify({ ...raw, planState: 'guessed' })).planState).toBe(
      'unknown',
    )
  })

  it('retains decimal values through the editable form and its validation', () => {
    const reading = parseFloorPlan(JSON.stringify(raw))
    const rows = planRows({ ...reading, readAt: '2026-09-26T00:00:00.000Z' })
    const input = {
      ceilingCm: '',
      condition: 'bare',
      rooms: rows.map((row) => ({
        include: row.include,
        roomId: '',
        name: row.name,
        kind: row.kind,
        sourceNumber: row.sourceNumber,
        ceilingCm: row.ceiling ?? '',
        widthCm: row.width,
        depthCm: row.depth,
        areaM2: row.area,
        wish: '',
      })),
    }
    const saved = planRoomsSchema.parse(input)
    expect(saved.rooms.find((room) => room.sourceNumber === 2)).toMatchObject({
      widthCm: 296.4,
      depthCm: 420.5,
      areaM2: 12.35,
    })
    expect(saved.rooms.find((room) => room.sourceNumber === 1)).toMatchObject({
      widthCm: null,
      depthCm: null,
    })
    expect(saved.rooms.find((room) => room.sourceNumber === 4)?.ceilingCm).toBe(266.3)
    expect(totalAreaCheck(rows, reading.totalAreaM2)).toEqual({
      sum: '74,77',
      total: '74,77',
      agrees: true,
    })
  })

  it('adds chain segments locally without rounding away millimetres', () => {
    expect(
      parseSideRecheck(JSON.stringify({ segments: [525, 563, 926, 950], totalMm: 2999 })),
    ).toBe(296.4)
  })

  it('cannot combine measured and proposed sheets into one reading', () => {
    const existing = parseFloorPlan(JSON.stringify(raw))
    const proposed = parseFloorPlan(JSON.stringify({ ...raw, planState: 'proposed' }))
    expect(() => mergeReadings([existing, proposed])).toThrow('Нельзя объединять')
    expect(mergeReadings([existing]).planState).toBe('existing')
  })

  it('keeps separate rows if a reader repeats the same printed number', () => {
    const reading = parseFloorPlan(
      JSON.stringify({
        rooms: [
          { name: 'Спальня', sourceNumber: 4, widthMm: 2985 },
          { name: 'Спальня', sourceNumber: 4, widthMm: 2945 },
        ],
      }),
    )
    expect(new Set(reading.rooms.map((room) => room.name)).size).toBe(2)
    expect(reading.rooms.every((room) => room.sourceNumber === undefined)).toBe(true)
  })

  it('does not spread an inconsistent shared ceiling across rooms', () => {
    const reading = parseFloorPlan(JSON.stringify({ ...raw, ceilingMm: 2700 }))
    expect(reading.ceilingCm).toBeUndefined()
    expect(reading.rooms.find((room) => room.sourceNumber === 4)?.ceilingCm).toBe(266.3)
    expect(reading.rooms.find((room) => room.sourceNumber === 6)?.ceilingCm).toBe(267.2)
  })

  it.each(contourRooms)('binds the local contour of room $number by printed number', (expected) => {
    const reading = parseFloorPlan(
      JSON.stringify({
        ...raw,
        rooms: [...raw.rooms].reverse(),
        geometry: localGeometry(expected),
      }),
    )
    const shape = reading.geometry?.rooms[0]
    expect(shape?.name).toBe(
      reading.rooms.find((room) => room.sourceNumber === expected.number)?.name,
    )
    expect(shape?.sourceNumber).toBe(expected.number)
    expect(shape?.polygon).toHaveLength(expected.localContourMm?.length ?? 0)
    expect(planPolygonAreaM2(shape?.polygon ?? [])).toBeCloseTo(expected.areaM2, 2)
    expect(reading.geometry?.status).toBe('draft')
    expect(reading.geometry?.openings).toHaveLength(expected.openingChecks?.length ?? 0)
    const edited = validatePlanGeometryEdit(reading.geometry, 'draft')
    expect(edited?.rooms[0]?.sourceNumber).toBe(expected.number)
  })

  it('does not assign an unnumbered bedroom contour by response order', () => {
    const bedroom = contourRooms.find((room) => room.number === 4)
    if (!bedroom) throw new Error('Missing bedroom reference')
    const geometry = localGeometry(bedroom)
    const reading = parseFloorPlan(
      JSON.stringify({
        ...raw,
        geometry: {
          ...geometry,
          rooms: geometry.rooms.map((room) => ({ ...room, sourceNumber: null })),
        },
      }),
    )
    expect(reading.geometry?.rooms).toEqual([])
    expect(reading.geometry?.warnings.join(' ')).toContain('привязка')
  })

  it('rejects a contour with a foreign printed number instead of falling back to its name', () => {
    const kitchen = contourRooms.find((room) => room.number === 2)
    if (!kitchen) throw new Error('Missing kitchen reference')
    const geometry = localGeometry(kitchen)
    const reading = parseFloorPlan(
      JSON.stringify({
        ...raw,
        geometry: {
          ...geometry,
          rooms: geometry.rooms.map((room) => ({ ...room, sourceNumber: 49 })),
        },
      }),
    )
    expect(reading.geometry?.rooms).toEqual([])
  })

  it('does not accept equal area as proof of the correct axes of a contour', () => {
    const bedroom = contourRooms.find((room) => room.number === 4)
    if (!bedroom) throw new Error('Missing bedroom reference')
    const geometry = localGeometry(bedroom)
    const transpose = ({ xMm, yMm }: { xMm: number | undefined; yMm: number | undefined }) => ({
      xMm: yMm,
      yMm: xMm,
    })
    const reading = parseFloorPlan(
      JSON.stringify({
        ...raw,
        geometry: {
          ...geometry,
          widthMm: geometry.heightMm,
          heightMm: geometry.widthMm,
          walls: geometry.walls.map((wall) => ({
            ...wall,
            start: transpose(wall.start),
            end: wall.end ? transpose(wall.end) : undefined,
          })),
          openings: [],
          rooms: geometry.rooms.map((room) => ({ ...room, polygon: room.polygon.map(transpose) })),
        },
      }),
    )
    expect(reading.geometry?.rooms).toEqual([])
    expect(reading.geometry?.warnings.join(' ')).toContain('габариты')
  })

  it('rejects repeated contour numbers without retaining an arbitrary first polygon', () => {
    const bedroom = contourRooms.find((room) => room.number === 4)
    if (!bedroom) throw new Error('Missing bedroom reference')
    const geometry = localGeometry(bedroom)
    const reading = parseFloorPlan(
      JSON.stringify({
        ...raw,
        geometry: { ...geometry, rooms: [...geometry.rooms, ...geometry.rooms] },
      }),
    )
    expect(reading.geometry?.rooms).toEqual([])
    expect(reading.geometry?.warnings.join(' ')).toContain('привязка')
  })

  it('keeps the bedroom window on its labelled wall without inventing a sill or door swing', () => {
    const bedroom = contourRooms.find((room) => room.number === 4)
    if (!bedroom) throw new Error('Missing bedroom reference')
    const reading = parseFloorPlan(JSON.stringify({ ...raw, geometry: localGeometry(bedroom) }))
    if (!reading.geometry) throw new Error('Missing geometry')
    // Only exercise the layout conversion: this is not user confirmation of actual measurements.
    const input = roomLayoutInputFromGeometry(
      { ...reading.geometry, status: 'confirmed' },
      'Спальня 4',
      null,
    )
    expect(input?.reservations).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ kind: 'window', wall: 'top', fromCm: 93.9, toCm: 228.3 }),
        expect.objectContaining({ kind: 'door', wall: 'bottom', fromCm: 14, toCm: 103.6 }),
      ]),
    )
    expect(input?.missingSafetyData.join(' ')).toContain('высоту подоконника')
    expect(input?.missingSafetyData.join(' ')).toContain('зону открывания')
  })

  it('does not call the bedroom checked when the door location is still unknown', () => {
    const bedroom = contourRooms.find((room) => room.number === 6)
    if (!bedroom) throw new Error('Missing bedroom reference')
    const reading = parseFloorPlan(JSON.stringify({ ...raw, geometry: localGeometry(bedroom) }))
    if (!reading.geometry) throw new Error('Missing geometry')
    const input = roomLayoutInputFromGeometry(
      { ...reading.geometry, status: 'confirmed' },
      'Спальня 6',
      null,
    )
    if (!input) throw new Error('Missing local layout input')
    const layout = layoutRoom({ ...input, roomKind: 'bedroom' }, [
      {
        id: 'bed',
        title: 'Тестовая кровать',
        category: 'bed',
        quantity: 1,
        dimensions: { width: 90, depth: 200 },
        operationClearance: { side: 35 },
      },
    ])
    expect(layout.safetySummary.status).not.toBe('checked')
    expect(layout.safetyChecks).toContainEqual(
      expect.objectContaining({ id: 'operation-zone-access', status: 'needs-data' }),
    )
  })

  it.each([
    {
      number: 2,
      name: 'Кухня',
      kind: 'kitchen' as const,
      category: 'storage' as const,
      width: 180,
      depth: 60,
    },
    {
      number: 3,
      name: 'Гостиная',
      kind: 'living' as const,
      category: 'sofa' as const,
      width: 210,
      depth: 90,
    },
  ])('keeps furniture inside room $number without blocking its labelled entrances', (scenario) => {
    const referenceRoom = contourRooms.find((room) => room.number === scenario.number)
    if (!referenceRoom) throw new Error('Missing manual reference')
    const reading = parseFloorPlan(
      JSON.stringify({ ...raw, geometry: localGeometry(referenceRoom) }),
    )
    if (!reading.geometry) throw new Error('Missing local geometry')
    // Test geometry conversion and layout only; not actual confirmation or a catalog product.
    const input = roomLayoutInputFromGeometry(
      { ...reading.geometry, status: 'confirmed' },
      scenario.name,
      null,
    )
    if (!input?.floorPolygon) throw new Error('Missing floor outline')
    const layout = layoutRoom({ ...input, roomKind: scenario.kind }, [
      {
        id: 'test-furniture',
        title: 'Тестовый предмет',
        category: scenario.category,
        quantity: 1,
        dimensions: { width: scenario.width, depth: scenario.depth, height: 90 },
        operationClearance: { front: 90 },
      },
    ])
    expect(layout.placed).toHaveLength(1)
    for (const placed of layout.placed) {
      expect(rectInsideFloor(placed, input.floorPolygon)).toBe(true)
      for (const opening of input.floorReservations.filter(
        (opening) => opening.kind !== 'window',
      )) {
        expect(rectBlocksFloorReservation(placed, opening)).toBe(false)
      }
    }
    expect(layout.floorPolygon).toEqual(input.floorPolygon)
    expect(layout.safetySummary.status).not.toBe('checked')
    expect(input.missingSafetyData.join(' ')).toContain('зону открывания')
    expect(input.floorReservations.filter((opening) => opening.kind !== 'window')).toHaveLength(
      scenario.number === 2 ? 2 : 1,
    )
    if (scenario.number === 3) {
      // The 576 mm opening is a second window, not an entrance with a narrow route.
      expect(input.floorReservations.filter((opening) => opening.kind === 'window')).toHaveLength(2)
      expect(input.missingSafetyData.join(' ')).not.toContain('57.6 см')
    }
  })
})
