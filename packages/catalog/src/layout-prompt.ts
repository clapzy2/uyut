import type { RoomLayout } from './layout'

const wallName = {
  top: 'top wall',
  right: 'right wall',
  bottom: 'bottom wall',
  left: 'left wall',
  perimeter: 'a perimeter wall',
  center: 'the central floor area',
} as const

const relationshipText = {
  'sofa-tv':
    'preserve the opposite placement of sofa and TV furniture; the screen axis is not measured',
  'sofa-coffee': 'the coffee table remains directly usable from the sofa',
  'bed-storage': 'the bed and storage keep their operating clearances separate',
  'desk-window': 'the desk remains close to the window without blocking it',
  'kitchen-workflow': 'the refrigerator stays on the same or an adjacent wall to the kitchen run',
} as const

/**
 * Turns the verified top-down calculation into a compact contract for an image model.
 * Coordinates remain in the text on purpose: the renderer may ignore them, but it must never
 * receive a vaguer assignment than the one the product has already calculated.
 */
export function layoutPromptContract(layout: RoomLayout): string {
  if (layout.widthCm <= 0 || layout.depthCm <= 0 || layout.placed.length === 0) return ''

  const heights = new Map(layout.placementInputs.map((item) => [item.id, item.heightCm]))
  const placements = layout.placed.map((item) => {
    const wall = wallName[item.wall]
    const heightCm = heights.get(item.itemId)
    const height =
      heightCm !== undefined && Number.isFinite(heightCm) && heightCm > 0
        ? `height ${heightCm} cm`
        : 'height unknown'
    return `${item.title}: ${item.widthCm} by ${item.depthCm} cm footprint, ${height}, at x=${item.xCm} cm and y=${item.yCm} cm from the top-left plan corner, against ${wall}`
  })
  const relationships = layout.relationships
    .filter((item) => item.status === 'checked')
    .map((item) => relationshipText[item.kind])

  return [
    `Verified top-down furniture contract for a ${layout.widthCm} by ${layout.depthCm} cm room.`,
    'Coordinates describe the floor plan, not image pixels. Preserve the stated wall and relative position of every item; perspective may hide an item but must not move it.',
    'Preserve every stated furniture height. Unknown heights are not verified dimensions; do not infer a ceiling-height fit from the furniture type.',
    `Furniture: ${placements.join('; ')}.`,
    relationships.length > 0 ? `Functional relationships: ${relationships.join('; ')}.` : '',
    `The calculated narrowest clear route is ${layout.walkwayCm} cm. Do not add furniture that reduces it.`,
  ]
    .filter(Boolean)
    .join(' ')
}
