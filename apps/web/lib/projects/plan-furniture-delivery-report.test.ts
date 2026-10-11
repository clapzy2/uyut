import type { PlanGeometry } from '@uyut/db'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { inspectFurnitureDeliveryViaStairs } from './plan-furniture-delivery'
import {
  type FurnitureDeliveryReportRequest,
  serializeFurnitureDeliveryReport,
} from './plan-furniture-delivery-report'

vi.mock('./plan-furniture-delivery', () => ({ inspectFurnitureDeliveryViaStairs: vi.fn() }))

const geometry: PlanGeometry = {
  version: 1,
  status: 'draft',
  widthCm: 100,
  heightCm: 100,
  rooms: [],
  walls: [],
  openings: [],
  warnings: [],
}
const request: FurnitureDeliveryReportRequest = {
  survey: {},
  profile: { widthCm: 40, depthCm: 60, heightCm: 170, clearanceCm: 1, orientation: 0 },
  targetRoomId: '0',
}

beforeEach(() => vi.resetAllMocks())

describe('delivery report export boundaries', () => {
  it('always invokes the full checker with current inputs and cannot accept a cached result', () => {
    vi.mocked(inspectFurnitureDeliveryViaStairs).mockReturnValue({
      notes: [],
      error: 'Needs new measurements',
    })
    expect(serializeFurnitureDeliveryReport(geometry, request)).toEqual({
      error: 'Needs new measurements',
    })
    expect(inspectFurnitureDeliveryViaStairs).toHaveBeenCalledExactlyOnceWith(
      geometry,
      request.survey,
      request.profile,
      request.targetRoomId,
      undefined,
    )
  })

  it('does not serialize a partial result supplied alongside a checker error', () => {
    vi.mocked(inspectFurnitureDeliveryViaStairs).mockReturnValue({
      notes: [],
      error: 'Not complete',
      result: {} as NonNullable<ReturnType<typeof inspectFurnitureDeliveryViaStairs>['result']>,
    })
    expect(serializeFurnitureDeliveryReport(geometry, request)).toEqual({ error: 'Not complete' })
  })

  it('does not produce an empty success document when no result is present', () => {
    vi.mocked(inspectFurnitureDeliveryViaStairs).mockReturnValue({ notes: [] })
    expect(serializeFurnitureDeliveryReport(geometry, request).text).toBeUndefined()
  })

  it('returns a controlled error if the checker unexpectedly throws', () => {
    vi.mocked(inspectFurnitureDeliveryViaStairs).mockImplementation(() => {
      throw new Error('Unexpected')
    })
    const response = serializeFurnitureDeliveryReport(geometry, request)
    expect(response.text).toBeUndefined()
    expect(response.error).toContain('Не удалось')
  })

  it('bounds the exported UTF-8 bytes even for short multibyte text', () => {
    vi.mocked(inspectFurnitureDeliveryViaStairs).mockReturnValue({
      notes: ['Я'.repeat(4 * 1024 * 1024)],
      result: {} as NonNullable<ReturnType<typeof inspectFurnitureDeliveryViaStairs>['result']>,
    })
    const response = serializeFurnitureDeliveryReport(geometry, request)
    expect(response.text).toBeUndefined()
    expect(response.error).toContain('8 МБ')
  })
})
