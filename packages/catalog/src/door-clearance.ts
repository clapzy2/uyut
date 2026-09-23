import type { PlanGeometry, PlanOpening, PlanPoint } from '@uyut/db'

export type DoorClearanceZone = {
  id: string
  ownerId: string
  door: true
  label: string
  polygon: PlanPoint[]
}

export function doorClearanceZone(
  opening: PlanOpening,
  geometry: PlanGeometry,
): DoorClearanceZone | undefined {
  if (!opening.clearance || opening.type === 'window') return undefined
  const wall = geometry.walls.find((candidate) => candidate.id === opening.wallId)
  if (!wall) return undefined
  const length = Math.hypot(wall.end.xCm - wall.start.xCm, wall.end.yCm - wall.start.yCm)
  if (length < 1e-7) return undefined
  const ux = (wall.end.xCm - wall.start.xCm) / length
  const uy = (wall.end.yCm - wall.start.yCm) / length
  const sign = opening.clearance.side === 'left' ? 1 : -1
  const nx = -uy * sign
  const ny = ux * sign
  const a = {
    xCm: wall.start.xCm + ux * opening.offsetCm,
    yCm: wall.start.yCm + uy * opening.offsetCm,
  }
  const b = { xCm: a.xCm + ux * opening.widthCm, yCm: a.yCm + uy * opening.widthCm }
  let polygon: PlanPoint[]
  if (opening.clearance.shape === 'swing') {
    const hingeAtEnd = opening.clearance.hinge === 'end'
    const hinge = hingeAtEnd ? b : a
    const closedX = ux * (hingeAtEnd ? -1 : 1)
    const closedY = uy * (hingeAtEnd ? -1 : 1)
    polygon = [hinge]
    const subdivisions = 24
    for (let index = 0; index <= subdivisions; index += 1) {
      const angle = (Math.PI / 2) * (index / subdivisions)
      polygon.push({
        xCm:
          hinge.xCm +
          opening.clearance.depthCm * (closedX * Math.cos(angle) + nx * Math.sin(angle)),
        yCm:
          hinge.yCm +
          opening.clearance.depthCm * (closedY * Math.cos(angle) + ny * Math.sin(angle)),
      })
    }
  } else {
    const offsetX = nx * opening.clearance.depthCm
    const offsetY = ny * opening.clearance.depthCm
    polygon = [
      a,
      b,
      { xCm: b.xCm + offsetX, yCm: b.yCm + offsetY },
      { xCm: a.xCm + offsetX, yCm: a.yCm + offsetY },
    ]
  }
  return {
    id: `door-${opening.id}`,
    ownerId: opening.id,
    door: true,
    label: `${opening.type === 'balcony' ? 'Балконный блок' : 'Дверь'} ${opening.id}: свободная зона`,
    polygon,
  }
}
