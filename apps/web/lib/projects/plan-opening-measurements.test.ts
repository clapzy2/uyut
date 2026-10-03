import type { PlanGeometry } from '@uyut/db'
import { describe, expect, it } from 'vitest'
import {
  applyOpeningMeasurementRequests,
  currentOpeningMeasurements,
  openingMeasurementSnapshot,
  openingMeasurementWallSnapshot,
  unresolvedOpeningMeasurementIds,
} from './plan-opening-measurements'

const geometry: PlanGeometry = {
  version: 1,
  status: 'draft',
  source: 'manual',
  widthCm: 500,
  heightCm: 400,
  walls: [{ id: 'host', kind: 'outer', start: { xCm: 0, yCm: 0 }, end: { xCm: 500, yCm: 0 } }],
  openings: [{ id: 'door', type: 'door', wallId: 'host', widthCm: 90, offsetCm: 100 }],
  rooms: [],
  warnings: [],
  pdfCalibration: {
    sourceSha256: 'a'.repeat(64),
    pdfPage: 2,
    cmPerPoint: 1.2,
    origin: { x: 10, y: 20 },
    anchorRoomNumbers: [1],
    labelIndexes: [],
    derivedOpeningIds: ['door'],
  },
}
const host = geometry.walls[0]
const opening = geometry.openings[0]
const calibration = geometry.pdfCalibration
if (!host || !opening || !calibration) throw new Error('Missing measurement fixture')
const request = {
  action: 'verify' as const,
  opening: openingMeasurementSnapshot(opening),
  wall: openingMeasurementWallSnapshot(host),
  source: { kind: 'site-measurement' as const, reference: '  Обмер 3 октября, входная дверь  ' },
  acknowledged: true as const,
}
const date = '2026-10-03T12:00:00.000Z'

function verifiedGeometry() {
  const result = applyOpeningMeasurementRequests(geometry, [request], 'owner', date)
  if (!result.ok) throw new Error(result.error)
  return { ...structuredClone(geometry), pdfCalibration: result.pdfCalibration }
}

describe('сверка горизонтальных мерок проёма', () => {
  it('фиксирует источник, пользователя и обе мерки; сохраняет исходный список требующих сверки', () => {
    const result = verifiedGeometry()
    expect(result.pdfCalibration?.derivedOpeningIds).toEqual([])
    expect(result.pdfCalibration?.measurementRequiredOpeningIds).toEqual(['door'])
    expect(result.pdfCalibration?.openingMeasurements?.[0]).toMatchObject({
      verifiedAt: date,
      verifiedBy: 'owner',
      sourceSha256: geometry.pdfCalibration?.sourceSha256,
      opening: request.opening,
      wall: request.wall,
      source: { kind: 'site-measurement', reference: request.source.reference.trim() },
    })
    expect(unresolvedOpeningMeasurementIds(result)).toEqual([])
    expect(geometry.pdfCalibration?.derivedOpeningIds).toEqual(['door'])
  })

  it('не подтверждает простое редактирование числа без отдельной сверки', () => {
    expect(applyOpeningMeasurementRequests(geometry, [], 'owner', date)).toEqual({
      ok: true,
      pdfCalibration: geometry.pdfCalibration,
    })
    expect(unresolvedOpeningMeasurementIds(geometry)).toEqual(['door'])
  })

  it('сохраняет сверку после JSON-перечитывания с другим порядком ключей', () => {
    const saved = verifiedGeometry()
    const reopened = JSON.parse(
      JSON.stringify(saved, (_key, value) => {
        if (!value || typeof value !== 'object' || Array.isArray(value)) return value
        return Object.fromEntries(Object.entries(value).sort(([a], [b]) => a.localeCompare(b)))
      }),
    ) as PlanGeometry
    expect(currentOpeningMeasurements(reopened)).toHaveLength(1)
    const result = applyOpeningMeasurementRequests(reopened, [], 'owner', date)
    expect(result.ok).toBe(true)
    if (result.ok) expect(result.pdfCalibration).toEqual(saved.pdfCalibration)
  })

  it.each([
    'width',
    'offset',
    'type',
    'host',
    'wall-start',
    'wall-end',
    'wall-kind',
    'wall-thickness',
    'delete-opening',
    'delete-wall',
    'source',
    'page',
    'scale',
    'origin',
  ])('сбрасывает сверку после изменения: %s', (change) => {
    const changed = verifiedGeometry()
    const opening = changed.openings[0]
    const wall = changed.walls[0]
    const calibration = changed.pdfCalibration
    if (!opening || !wall || !calibration) throw new Error('Missing verified fixture')
    if (change === 'width') opening.widthCm += 1
    if (change === 'offset') opening.offsetCm += 1
    if (change === 'type') opening.type = 'window'
    if (change === 'host') opening.wallId = 'other'
    if (change === 'wall-start') wall.start.xCm += 1
    if (change === 'wall-end') wall.end.xCm -= 1
    if (change === 'wall-kind') wall.kind = 'inner'
    if (change === 'wall-thickness') wall.thicknessCm = 20
    if (change === 'delete-opening') changed.openings = []
    if (change === 'delete-wall') changed.walls = []
    if (change === 'source') calibration.sourceSha256 = 'b'.repeat(64)
    if (change === 'page') calibration.pdfPage += 1
    if (change === 'scale') calibration.cmPerPoint += 0.1
    if (change === 'origin') calibration.origin.x += 1
    expect(currentOpeningMeasurements(changed)).toEqual([])
    expect(unresolvedOpeningMeasurementIds(changed)).toEqual(['door'])
    const saved = applyOpeningMeasurementRequests(changed, [], 'owner', date)
    expect(saved.ok).toBe(true)
    if (saved.ok) {
      expect(saved.pdfCalibration?.openingMeasurements).toEqual([])
      expect(saved.pdfCalibration?.derivedOpeningIds).toEqual(['door'])
    }
  })

  it('вертикальные мерки не выдаются за часть сверки ширины и не стирают её', () => {
    const changed = verifiedGeometry()
    const opening = changed.openings[0]
    const wall = changed.walls[0]
    if (!opening || !wall) throw new Error('Missing verified fixture')
    Object.assign(opening, { bottomCm: 0, heightCm: 210, sillHeightCm: 80 })
    wall.heightCm = 270
    expect(currentOpeningMeasurements(changed)).toHaveLength(1)
  })

  it('снимает сверку явно и не восстанавливает её после сохранения отредактированного элемента', () => {
    const verified = verifiedGeometry()
    const removed = applyOpeningMeasurementRequests(
      verified,
      [{ action: 'remove', openingId: 'door' }],
      'owner',
      date,
    )
    expect(removed.ok).toBe(true)
    if (!removed.ok) return
    expect(removed.pdfCalibration?.derivedOpeningIds).toEqual(['door'])
    expect(removed.pdfCalibration?.openingMeasurements).toEqual([])
    expect(
      currentOpeningMeasurements({ ...geometry, pdfCalibration: removed.pdfCalibration }),
    ).toEqual([])
  })

  it.each([
    { ...request, acknowledged: false },
    { ...request, source: { ...request.source, reference: ' ' } },
    { ...request, source: { ...request.source, kind: 'ai' } },
    { ...request, source: { ...request.source, reference: 'x'.repeat(301) } },
    { ...request, opening: { ...request.opening, widthCm: 0 } },
    { ...request, opening: { ...request.opening, offsetCm: Number.NaN } },
    { ...request, verifiedBy: 'forged', verifiedAt: date },
    { ...request, opening: { ...request.opening, id: 'unknown' } },
    { ...request, wall: { ...request.wall, end: { xCm: 499, yCm: 0 } } },
  ])('отклоняет неполный, поддельный или устаревший запрос %#', (invalid) => {
    expect(applyOpeningMeasurementRequests(geometry, [invalid], 'owner', date).ok).toBe(false)
  })

  it('не разрешает повторяющиеся запросы и мерки вне стены', () => {
    expect(applyOpeningMeasurementRequests(geometry, [request, request], 'owner', date).ok).toBe(
      false,
    )
    const outsideOpening = { ...opening, offsetCm: 450 }
    const outside = { ...geometry, openings: [outsideOpening] }
    expect(
      applyOpeningMeasurementRequests(
        outside,
        [{ ...request, opening: openingMeasurementSnapshot(outsideOpening) }],
        'owner',
        date,
      ).ok,
    ).toBe(false)
  })

  it('сверка одного проёма не снимает проверку остальных', () => {
    const two = {
      ...geometry,
      pdfCalibration: { ...calibration, derivedOpeningIds: ['door', 'second'] },
    }
    const result = applyOpeningMeasurementRequests(two, [request], 'owner', date)
    expect(result.ok).toBe(true)
    if (result.ok) expect(result.pdfCalibration?.derivedOpeningIds).toEqual(['second'])
  })

  it('не создаёт бессрочный долг после удаления вручную добавленного сверенного проёма', () => {
    const manual = { ...geometry, pdfCalibration: { ...calibration, derivedOpeningIds: [] } }
    const verified = applyOpeningMeasurementRequests(manual, [request], 'owner', date)
    if (!verified.ok) throw new Error(verified.error)
    const deleted = applyOpeningMeasurementRequests(
      { ...manual, openings: [], pdfCalibration: verified.pdfCalibration },
      [],
      'owner',
      date,
    )
    expect(deleted.ok).toBe(true)
    if (deleted.ok) {
      expect(deleted.pdfCalibration?.derivedOpeningIds).toEqual([])
      expect(deleted.pdfCalibration?.openingMeasurements).toEqual([])
    }
  })

  it('показывает утрату печатного размера окна сразу после правки, до сохранения', () => {
    const window = { ...opening, type: 'window' as const }
    const printed = {
      ...geometry,
      openings: [window],
      pdfCalibration: {
        ...calibration,
        derivedOpeningIds: [],
        openingWidthProofs: [{ opening: window, wall: host, labelIndex: 1 }],
        wallFaceRoomPolygons: [],
      },
    }
    expect(unresolvedOpeningMeasurementIds(printed)).toEqual([])
    const changed = { ...printed, openings: [{ ...window, widthCm: 91 }] }
    expect(unresolvedOpeningMeasurementIds(changed)).toEqual(['door'])
    const verified = applyOpeningMeasurementRequests(
      changed,
      [{ ...request, opening: openingMeasurementSnapshot(changed.openings[0] ?? window) }],
      'owner',
      date,
    )
    expect(verified.ok).toBe(true)
    if (verified.ok)
      expect(
        unresolvedOpeningMeasurementIds({ ...changed, pdfCalibration: verified.pdfCalibration }),
      ).toEqual([])
  })
})
