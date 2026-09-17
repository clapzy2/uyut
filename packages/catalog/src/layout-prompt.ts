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
  'sofa-tv': 'the sofa faces the TV zone from the opposite side of the room',
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

  const placements = layout.placed.map((item) => {
    const wall = wallName[item.wall]
    return `${item.title}: ${item.widthCm} by ${item.depthCm} cm footprint, at x=${item.xCm} cm and y=${item.yCm} cm from the top-left plan corner, against ${wall}`
  })
  const relationships = layout.relationships
    .filter((item) => item.status === 'checked')
    .map((item) => relationshipText[item.kind])

  return [
    `Verified top-down furniture contract for a ${layout.widthCm} by ${layout.depthCm} cm room.`,
    'Coordinates describe the floor plan, not image pixels. Preserve the stated wall and relative position of every item; perspective may hide an item but must not move it.',
    `Furniture: ${placements.join('; ')}.`,
    relationships.length > 0 ? `Functional relationships: ${relationships.join('; ')}.` : '',
    `The calculated narrowest clear route is ${layout.walkwayCm} cm. Do not add furniture that reduces it.`,
  ]
    .filter(Boolean)
    .join(' ')
}
