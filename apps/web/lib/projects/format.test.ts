import { describe, expect, it } from 'vitest'
import { formatArea, pluralRooms, projectMeta } from './format'

describe('project formatting', () => {
  it('declines rooms in Russian', () => {
    expect(pluralRooms(1)).toBe('1 комната')
    expect(pluralRooms(3)).toBe('3 комнаты')
    expect(pluralRooms(5)).toBe('5 комнат')
    expect(pluralRooms(11)).toBe('11 комнат')
    expect(pluralRooms(21)).toBe('21 комната')
  })

  it('formats area with a comma and one decimal at most', () => {
    expect(formatArea(18.5)).toBe('18,5 м²')
    expect(formatArea(54)).toBe('54 м²')
    expect(formatArea(null)).toBeNull()
  })

  it('skips missing facts in the meta line', () => {
    expect(projectMeta({ houseSeries: null, totalAreaM2: null, roomCount: 0 })).toBe('0 комнат')
    expect(projectMeta({ houseSeries: 'П-44', totalAreaM2: 54, roomCount: 3 })).toBe(
      'П-44 · 54 м² · 3 комнаты',
    )
  })
})
