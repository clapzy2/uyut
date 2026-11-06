import type { RoomLayout } from './layout'
import { furnitureFaces, roomVolume } from './room-volume'

type Point = { xCm: number; yCm: number; zCm: number }
type ScreenPoint = { x: number; y: number }
const colours = ['#dec2a6', '#b7cdbb', '#c4cde0', '#dbbfcc', '#d9d09e', '#b4d3d5']

function xml(value: string): string {
  return value.replace(
    /[&<>"']/g,
    (character) =>
      ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&apos;' })[character] ??
      character,
  )
}

function pointsText(points: readonly ScreenPoint[]): string {
  return points.map((point) => `${point.x.toFixed(2)},${point.y.toFixed(2)}`).join(' ')
}

function documentSvg(title: string, content: string): string {
  return `<svg xmlns="http://www.w3.org/2000/svg" width="1200" height="900" viewBox="0 0 1200 900"><title>${title}</title><rect width="1200" height="900" fill="#faf8f2"/><g font-family="Arial" fill="#242424">${content}</g></svg>`
}

/** Technical input for a renderer, never a proof that the resulting image follows the plan. */
export function layoutGuideSvgs(
  layout: RoomLayout,
  ceilingCm: number | undefined,
): { perspective: string; plan: string } | undefined {
  const { widthCm: width, depthCm: depth } = layout
  if (
    !Number.isFinite(ceilingCm) ||
    !ceilingCm ||
    ceilingCm <= 0 ||
    ceilingCm > 1000 ||
    !Number.isFinite(width) ||
    !Number.isFinite(depth) ||
    width <= 0 ||
    depth <= 0 ||
    width > 5000 ||
    depth > 5000 ||
    layout.projectedContour ||
    layout.floorLevel ||
    layout.safetySummary.status !== 'checked' ||
    layout.problems.length ||
    layout.unmeasured.length ||
    layout.relationships.some((relation) => relation.status !== 'checked') ||
    !layout.placed.length ||
    layout.placed.length > 12
  )
    return undefined

  // First release only supports an actual rectangular floor, not its bounding rectangle.
  const corners = new Set(layout.floorPolygon?.map((point) => `${point.xCm},${point.yCm}`))
  if (
    corners.size !== 4 ||
    layout.floorPolygon?.length !== 4 ||
    !['0,0', `${width},0`, `${width},${depth}`, `0,${depth}`].every((point) =>
      corners.has(point),
    ) ||
    layout.floorPolygon.some((point, index, polygon) => {
      const next = polygon[(index + 1) % polygon.length]
      return !next || (point.xCm !== next.xCm && point.yCm !== next.yCm)
    })
  )
    return undefined
  const volume = roomVolume(layout)
  const furniture = volume?.furniture
  if (
    !furniture ||
    furniture.length !== layout.placed.length ||
    furniture.some(
      (item) =>
        !Number.isFinite(item.heightCm) ||
        !item.heightCm ||
        item.heightCm <= 0 ||
        item.heightCm > ceilingCm ||
        item.floor.some(
          (point) =>
            !Number.isFinite(point.xCm) ||
            !Number.isFinite(point.yCm) ||
            point.xCm < 0 ||
            point.xCm > width ||
            point.yCm < 0 ||
            point.yCm > depth,
        ),
    )
  )
    return undefined

  const camera = { xCm: width / 2, yCm: depth * 1.4, zCm: ceilingCm * 0.65 }
  const forwardY = depth * 0.2 - camera.yCm
  const forwardZ = ceilingCm * 0.3 - camera.zCm
  const length = Math.hypot(forwardY, forwardZ)
  const fy = forwardY / length
  const fz = forwardZ / length
  const distance = (point: Point) => (point.yCm - camera.yCm) * fy + (point.zCm - camera.zCm) * fz
  const project = (point: Point): ScreenPoint => ({
    x: (point.xCm - camera.xCm) / distance(point),
    y: -((point.yCm - camera.yCm) * fz - (point.zCm - camera.zCm) * fy) / distance(point),
  })
  const floor = layout.floorPolygon.map((point) => ({ ...point, zCm: 0 }))
  const back = [
    { xCm: 0, yCm: 0, zCm: 0 },
    { xCm: width, yCm: 0, zCm: 0 },
    { xCm: width, yCm: 0, zCm: ceilingCm },
    { xCm: 0, yCm: 0, zCm: ceilingCm },
  ]
  const faces = furnitureFaces(furniture)
  const openings = layout.floorReservations.filter((opening) =>
    ['door', 'window', 'balcony'].includes(opening.kind),
  )
  if (openings.length > 50) return undefined
  const openingPoints = openings.flatMap((opening) =>
    [opening.start, opening.end].map((point) => ({
      ...point,
      zCm: opening.kind === 'window' ? (opening.sillHeightCm ?? 0) : 0,
    })),
  )
  if (
    openingPoints.some(
      (point) =>
        !Number.isFinite(point.xCm) ||
        !Number.isFinite(point.yCm) ||
        !Number.isFinite(point.zCm) ||
        point.xCm < 0 ||
        point.xCm > width ||
        point.yCm < 0 ||
        point.yCm > depth ||
        point.zCm < 0 ||
        point.zCm > ceilingCm,
    )
  )
    return undefined
  const vertices = [...floor, ...back, ...faces.flatMap((face) => face.points), ...openingPoints]
  if (vertices.some((point) => distance(point) <= 0)) return undefined
  const projected = vertices.map(project)
  const minX = Math.min(...projected.map((point) => point.x))
  const maxX = Math.max(...projected.map((point) => point.x))
  const minY = Math.min(...projected.map((point) => point.y))
  const maxY = Math.max(...projected.map((point) => point.y))
  const scale = Math.min(1080 / (maxX - minX), 580 / (maxY - minY))
  const screen = (point: Point): ScreenPoint => {
    const projectedPoint = project(point)
    return {
      x: 600 + (projectedPoint.x - (minX + maxX) / 2) * scale,
      y: 380 + (projectedPoint.y - (minY + maxY) / 2) * scale,
    }
  }
  const palette = new Map(
    furniture.map((item, index) => [item.id, colours[index % colours.length] ?? '#ddd']),
  )
  const surfaces = [
    { points: floor, colour: '#e6dac6' },
    { points: back, colour: '#eeeae1' },
    ...faces
      .map((face) => ({ points: face.points, colour: palette.get(face.furnitureId) ?? '#ddd' }))
      .sort(
        (a, b) =>
          b.points.reduce((sum, point) => sum + distance(point), 0) / b.points.length -
          a.points.reduce((sum, point) => sum + distance(point), 0) / a.points.length,
      ),
  ]
  const perspective = surfaces.map(
    (face) =>
      `<polygon points="${pointsText(face.points.map(screen))}" fill="${face.colour}" stroke="#666" stroke-width="1"/>`,
  )
  const planScale = Math.min(1000 / width, 580 / depth)
  const planPoint = (point: { xCm: number; yCm: number }): ScreenPoint => ({
    x: 600 + (point.xCm - width / 2) * planScale,
    y: 380 + (point.yCm - depth / 2) * planScale,
  })
  const plan = [
    `<polygon points="${pointsText(floor.map(planPoint))}" fill="#eeeae1" stroke="#333" stroke-width="3"/>`,
  ]
  const legend: string[] = []
  for (const [index, item] of furniture.entries()) {
    if (item.heightCm === undefined) return undefined
    const centre = {
      xCm: item.floor.reduce((sum, point) => sum + point.xCm, 0) / item.floor.length,
      yCm: item.floor.reduce((sum, point) => sum + point.yCm, 0) / item.floor.length,
    }
    const front = layout.functionalZones.find(
      (zone) => zone.placementId === item.id && zone.kind === 'front',
    )?.direction
    const direction = front && front !== 'around' ? ` front ${front}` : ''
    const label = `${index + 1}. ${item.heightCm} cm${direction}`
    legend.push(
      `<text x="${index % 2 ? 620 : 50}" y="${710 + Math.floor(index / 2) * 20}" font-size="14">${index + 1}. ${xml(item.title.slice(0, 44))} (${item.heightCm} cm)${direction}</text>`,
    )
    const top = screen({ ...centre, zCm: item.heightCm })
    perspective.push(
      `<text x="${top.x.toFixed(2)}" y="${(top.y - 10).toFixed(2)}" text-anchor="middle" font-size="16" stroke="#faf8f2" stroke-width="4" paint-order="stroke">${label}</text>`,
    )
    plan.push(
      `<polygon points="${pointsText(item.floor.map(planPoint))}" fill="${palette.get(item.id)}" stroke="#555"/>`,
    )
    const position = planPoint(centre)
    plan.push(
      `<text x="${position.x.toFixed(2)}" y="${position.y.toFixed(2)}" text-anchor="middle" font-size="17">${index + 1}</text>`,
    )
  }
  for (const opening of openings) {
    const sill = opening.kind === 'window' ? (opening.sillHeightCm ?? 0) : 0
    const ends = [opening.start, opening.end]
    const label = `${xml(opening.kind)}${sill ? ` sill ${sill} cm` : ' position only'}`
    const top = ends.map((point) => screen({ ...point, zCm: sill }))
    const [start, end] = top
    if (!start || !end) return undefined
    perspective.push(
      `<polyline points="${pointsText(top)}" stroke="#1785a5" stroke-width="4"/><text x="${((start.x + end.x) / 2).toFixed(2)}" y="${((start.y + end.y) / 2 - 8).toFixed(2)}" text-anchor="middle" font-size="13">${label}</text>`,
    )
    plan.push(
      `<polyline points="${pointsText(ends.map(planPoint))}" stroke="#1785a5" stroke-width="6"/>`,
    )
  }
  const header = `<text x="600" y="35" text-anchor="middle" font-size="20">Furniture layout guide - ${width} x ${depth} cm - ceiling ${ceilingCm} cm</text>`
  const footer =
    '<text x="600" y="865" text-anchor="middle" font-size="15">Boxes show furniture dimensions. Opening markers do not specify opening heights.</text>'
  return {
    perspective: documentSvg(
      'Perspective furniture layout guide',
      header + perspective.join('') + legend.join('') + footer,
    ),
    plan: documentSvg(
      'Top-down furniture layout guide',
      header + plan.join('') + legend.join('') + footer,
    ),
  }
}
