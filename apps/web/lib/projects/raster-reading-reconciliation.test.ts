import { createRasterPlanReader, parseFloorPlan, reconcileRasterReadings } from '@uyut/ai'
import { describe, expect, it, vi } from 'vitest'

function reading(segments = [2516], area = 14.9) {
  return parseFloorPlan(
    JSON.stringify({
      rooms: [
        {
          name: 'Гостиная',
          areaM2: area,
          depthMm: segments.reduce((a, b) => a + b, 0),
          measurementEvidence: {
            depth: {
              kind: 'vertical-chain',
              scope: 'room',
              roomName: 'Гостиная',
              complete: true,
              segmentsMm: segments,
            },
          },
        },
      ],
    }),
    { requireMeasurementEvidence: true },
  )
}
describe('raster reread disagreement, not source verification', () => {
  it('does not match identical numbers assigned to different room semantics', () => {
    const first = reading(),
      second = reading()
    const a = first.rooms[0],
      b = second.rooms[0]
    if (!a || !b) throw new Error('Missing room')
    a.sourceNumber = 2
    b.sourceNumber = 2
    b.name = 'Балкон'
    b.spaceKind = 'balcony'
    const result = reconcileRasterReadings(first, second)
    expect(result.rooms[0]?.depthCm).toBeUndefined()
    expect(result.rooms[0]?.areaM2).toBeUndefined()
    expect(result.rooms[0]?.measurementEvidence?.depth).toBeUndefined()
  })
  it('never promotes a matching model floor or confirmation timestamp', () => {
    const first = reading()
    first.geometry = {
      version: 1,
      status: 'confirmed',
      confirmedAt: '2026-10-09',
      widthCm: 500,
      heightCm: 500,
      walls: [],
      openings: [],
      obstacles: [],
      rooms: [],
      warnings: [],
      footprint: [
        { xCm: 0, yCm: 0 },
        { xCm: 500, yCm: 0 },
        { xCm: 500, yCm: 500 },
      ],
    }
    const result = reconcileRasterReadings(first, structuredClone(first))
    expect(result.geometry?.status).toBe('draft')
    expect(result.geometry?.footprint).toBeUndefined()
    expect(result.geometry?.confirmedAt).toBeUndefined()
    expect(first.geometry?.footprint).toHaveLength(3)
  })
  it('does not pair duplicate identities or invent missing dimensions from the second reading', () => {
    const first = reading(),
      second = reading()
    second.rooms.push(structuredClone(second.rooms[0] ?? { name: 'x', kind: 'living' }))
    expect(reconcileRasterReadings(first, second).rooms[0]?.depthCm).toBeUndefined()
    delete first.rooms[0]?.depthCm
    expect(reconcileRasterReadings(first, reading()).rooms[0]?.depthCm).toBeUndefined()
  })
  it('removes a disputed partial side and evidence regardless of area fit', () => {
    const first = reading(),
      before = structuredClone(first)
    const result = reconcileRasterReadings(first, reading([1600, 528, 2516]))
    expect(result.rooms[0]?.depthCm).toBeUndefined()
    expect(result.rooms[0]?.measurementEvidence?.depth).toBeUndefined()
    expect(
      result.rooms[0]?.measurementWarnings?.some((value) => value.includes('не согласованы')),
    ).toBe(true)
    expect(first).toEqual(before)
  })
  it('does not treat equal sums with different segment chains as agreement', () => {
    expect(
      reconcileRasterReadings(reading([2516]), reading([1000, 1516])).rooms[0]?.depthCm,
    ).toBeUndefined()
  })
  it('keeps agreeing values warned, never rechecked', () => {
    const result = reconcileRasterReadings(reading(), reading())
    expect(result.rooms[0]?.depthCm).toBe(251.6)
    expect(result.rooms[0]?.rechecked).toBeUndefined()
    expect(
      result.rooms[0]?.measurementWarnings?.some((value) =>
        value.includes('независимо не подтверждены'),
      ),
    ).toBe(true)
  })
  it('clears unreadable sides, disputed area and geometry', () => {
    const first = reading(),
      other = reading()
    delete other.rooms[0]?.depthCm
    if (other.rooms[0]) other.rooms[0].areaM2 = 15
    const result = reconcileRasterReadings(first, other)
    expect(result.rooms[0]?.depthCm).toBeUndefined()
    expect(result.rooms[0]?.areaM2).toBeUndefined()
  })
  it('makes only two calls and distinguishes failed second reading from agreement', async () => {
    const read = vi
      .fn()
      .mockResolvedValueOnce(reading())
      .mockRejectedValueOnce(new Error('transport failure'))
    const result = await createRasterPlanReader(read)({
      body: Buffer.from('image'),
      contentType: 'image/jpeg',
    })
    expect(read).toHaveBeenCalledTimes(2)
    expect(
      result.rooms[0]?.measurementWarnings?.some((value) => value.includes('не выполнено')),
    ).toBe(true)
    expect(result.geometry).toBeUndefined()
  })
  it('does not retry a failed first reading', async () => {
    const read = vi.fn().mockRejectedValue(new Error('failed'))
    await expect(
      createRasterPlanReader(read)({ body: Buffer.from('image'), contentType: 'image/jpeg' }),
    ).rejects.toThrow('failed')
    expect(read).toHaveBeenCalledTimes(1)
  })
})
