import { describe, expect, it } from 'vitest'
import { inspectSourceDoorConnectivity } from './plan-source-door-connectivity'

function rectangle(left: number, top: number, right: number, bottom: number) {
  return [
    { xCm: left, yCm: top },
    { xCm: right, yCm: top },
    { xCm: right, yCm: bottom },
    { xCm: left, yCm: bottom },
  ]
}

function fixture() {
  return {
    rooms: [
      { id: 'hall', polygon: rectangle(0, 0, 200, 200) },
      { id: 'room', polygon: rectangle(210, 0, 410, 200) },
    ],
    walls: [
      { id: 'partition', polygon: rectangle(200, 0, 210, 200) },
      { id: 'exterior', polygon: rectangle(0, -10, 200, 0) },
    ],
    openings: [
      {
        id: 'entry',
        kind: 'entrance' as const,
        polygon: rectangle(40, -10.5, 120, 0.5),
        axis: [
          { xCm: 40, yCm: -5 },
          { xCm: 120, yCm: -5 },
        ] as [{ xCm: number; yCm: number }, { xCm: number; yCm: number }],
      },
      {
        id: 'door',
        kind: 'door' as const,
        polygon: rectangle(199.5, 60, 210.5, 140),
        axis: [
          { xCm: 205, yCm: 60 },
          { xCm: 205, yCm: 140 },
        ] as [{ xCm: number; yCm: number }, { xCm: number; yCm: number }],
      },
    ],
    voids: [] as Array<{ id: string; polygon: ReturnType<typeof rectangle> }>,
  }
}

describe('source doorway topology', () => {
  it('connects the entrance through a positive-area threshold to both rooms', () => {
    const result = inspectSourceDoorConnectivity(fixture())
    expect(result.status).toBe('connected-topology')
    expect(result.reachedRoomIds).toEqual(['hall', 'room'])
    expect(result.freeComponentCount).toBe(1)
    expect(result.doors.every((door) => door.status === 'connected-portal')).toBe(true)
  })

  it('does not treat internal connectivity as an entrance certificate', () => {
    const input = fixture()
    input.openings.splice(0, 1)
    const result = inspectSourceDoorConnectivity(input)
    expect(result.freeComponentCount).toBe(1)
    expect(result.status).toBe('unresolved')
    expect(result.reachedRoomIds).toEqual([])
  })

  it('does not snap a door that merely touches the room floors', () => {
    const input = fixture()
    const door = input.openings[1]
    if (!door) throw new Error('Missing fixture door')
    door.polygon = rectangle(200, 60, 210, 140)
    expect(inspectSourceDoorConnectivity(input).doors[1]?.reason).toBe('floor-owners')
  })

  it('preserves a technical obstruction inside the threshold', () => {
    const input = fixture()
    input.voids.push({ id: 'shaft', polygon: rectangle(204, 50, 206, 150) })
    const result = inspectSourceDoorConnectivity(input)
    expect(result.doors[1]?.reason).toBe('blocked-portal')
    expect(result.reachedRoomIds).toEqual(['hall'])
    expect(result.status).toBe('unresolved')
  })

  it('never cuts another wall to force a doorway through it', () => {
    const input = fixture()
    input.walls.push({ id: 'other-wall', polygon: rectangle(204, 50, 206, 150) })
    expect(inspectSourceDoorConnectivity(input).doors[1]?.reason).toBe('wall-host')
  })

  it('keeps narrow topological connections separate from a clearance certificate', () => {
    const input = fixture()
    const door = input.openings[1]
    if (!door) throw new Error('Missing fixture door')
    door.polygon = rectangle(199.5, 60, 210.5, 126)
    door.axis[1].yCm = 126
    const result = inspectSourceDoorConnectivity(input)
    expect(result.status).toBe('connected-topology')
    expect(result.doors[1]?.widthCm).toBe(66)
  })

  it('does not use a window as a door', () => {
    const input = fixture()
    const result = inspectSourceDoorConnectivity({
      ...input,
      openings: input.openings.map((opening, index) =>
        index === 1 ? { ...opening, kind: 'window' as const } : opening,
      ),
    })
    expect(result.status).toBe('unresolved')
    expect(result.doors).toHaveLength(1)
  })

  it('rejects owners on the same side of the opening axis', () => {
    const input = fixture()
    input.rooms[1] = { id: 'room', polygon: rectangle(190, 0, 200, 200) }
    expect(inspectSourceDoorConnectivity(input).doors[1]?.reason).toBe('same-side')
  })

  it('rejects an entrance split by a preserved obstruction', () => {
    const input = fixture()
    input.voids.push({ id: 'entry-block', polygon: rectangle(30, -6, 130, -4) })
    const result = inspectSourceDoorConnectivity(input)
    expect(result.doors[0]?.reason).toBe('blocked-portal')
    expect(result.reachedRoomIds).toEqual([])
  })

  it('rejects an entrance whose exterior half is obstructed', () => {
    const input = fixture()
    input.voids.push({ id: 'outside-block', polygon: rectangle(30, -20, 130, -4) })
    expect(inspectSourceDoorConnectivity(input).doors[0]?.reason).toBe('blocked-portal')
  })
})
