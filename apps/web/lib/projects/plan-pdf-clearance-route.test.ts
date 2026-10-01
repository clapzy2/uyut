import type { PlanGeometry, PlanOpeningBinding, PlanPoint } from '@uyut/db'
import { describe, expect, it } from 'vitest'
import { inspectMetricClearanceRoutes } from './plan-metric-clearance-route'
import { inspectPdfClearanceRoutes } from './plan-pdf-clearance-route'

const point = (xCm: number, yCm: number): PlanPoint => ({ xCm, yCm })
const box = (left: number, top: number, right: number, bottom: number) => [
  point(left, top),
  point(right, top),
  point(right, bottom),
  point(left, bottom),
]

function fixture(gap = 10): PlanGeometry {
  const entry: PlanOpeningBinding = {
    wall: { id: 'entry-wall', kind: 'inner', start: point(0, 0), end: point(200, 0) },
    opening: {
      id: 'entry',
      type: 'door',
      wallId: 'entry-wall',
      offsetCm: 50,
      widthCm: 100,
      clearance: { side: 'left', depthCm: 100, shape: 'rectangle' },
    },
    cut: [point(50, 0), point(150, 0)],
  }
  const first: PlanOpeningBinding = {
    wall: { id: 'first-face', kind: 'inner', start: point(200, 0), end: point(200, 200) },
    opening: { id: 'first', type: 'door', wallId: 'first-face', offsetCm: 60, widthCm: 80 },
    cut: [point(200, 60), point(200, 140)],
  }
  const secondTop = gap ? 0 : 40
  const second: PlanOpeningBinding = {
    wall: {
      id: 'second-face',
      kind: 'inner',
      start: point(200 + gap, secondTop),
      end: point(200 + gap, 200 + secondTop),
    },
    opening: {
      id: 'second',
      type: 'door',
      wallId: 'second-face',
      offsetCm: 60 - secondTop,
      widthCm: 80,
    },
    cut: [point(200 + gap, 60), point(200 + gap, 140)],
  }
  const geometry: PlanGeometry = {
    version: 1,
    status: 'draft',
    widthCm: 410,
    heightCm: 240,
    walls: [entry.wall, first.wall, second.wall].map((wall) => structuredClone(wall)),
    openings: [entry.opening, first.opening, second.opening].map((opening) =>
      structuredClone(opening),
    ),
    rooms: [
      { name: 'Прихожая', polygon: box(0, 0, 200, 200) },
      { name: 'Комната', polygon: box(200 + gap, secondTop, 400 + gap, 200 + secondTop) },
    ],
    warnings: [],
    routeWidthCm: 70,
    routeStartOpeningId: 'entry',
    pdfCalibration: {
      sourceSha256: 'a'.repeat(64),
      pdfPage: 1,
      cmPerPoint: 1,
      origin: { x: 0, y: 0 },
      anchorRoomNumbers: [1],
      labelIndexes: [1],
      derivedOpeningIds: [],
      openingWidthProofs: [{ ...entry, labelIndex: 1 }],
      openingFacePairs: gap
        ? [
            {
              bindings: [first, second],
              jambs: [
                { operationIndex: 1, subpathIndex: 0, segmentIndex: 0 },
                { operationIndex: 1, subpathIndex: 0, segmentIndex: 1 },
              ],
            },
          ]
        : [],
    },
  }
  const calibration = geometry.pdfCalibration
  if (!calibration) throw new Error('Нет тестовой калибровки')
  calibration.wallFaceRoomPolygons = structuredClone(geometry.rooms.map((room) => room.polygon))
  if (!gap)
    calibration.openingWidthProofs?.push({
      ...first,
      labelIndex: 2,
      sameOpeningAs: { roomSourceNumber: 2, openingId: 'second' },
      oppositeBinding: second,
    })
  return geometry
}

function pair(geometry: PlanGeometry) {
  const value = geometry.pdfCalibration?.openingFacePairs?.[0]
  if (!value) throw new Error('Нет тестовой пары')
  return value
}

function required<T>(value: T | undefined): T {
  if (value === undefined) throw new Error('Неполный тестовый пример')
  return value
}

describe('проходы между исходными PDF-контурами', () => {
  it('соединяет две комнаты через точные дверные грани без осей и толщины стен', () => {
    const geometry = fixture()
    expect(inspectMetricClearanceRoutes(geometry).result).toMatchObject({
      status: 'constructive-routes',
    })
    expect(inspectPdfClearanceRoutes(geometry).result?.routes).toHaveLength(2)
  })

  it('не находит широкий путь в обход узкой двери по остальной общей границе', () => {
    const geometry = fixture(0)
    geometry.routeWidthCm = 90
    expect(inspectPdfClearanceRoutes(geometry).result?.unresolvedRoomIds).toEqual(['1'])
  })

  it('открывает доказанный общий порог, не добавляя фиктивное тело перехода', () => {
    expect(inspectPdfClearanceRoutes(fixture(0)).result?.routes).toHaveLength(2)
  })

  it('не открывает соприкасающиеся контуры без доказательства порога', () => {
    const geometry = fixture(0)
    const calibration = required(geometry.pdfCalibration)
    calibration.openingWidthProofs = required(calibration.openingWidthProofs).slice(0, 1)
    expect(inspectPdfClearanceRoutes(geometry).result?.unresolvedRoomIds).toEqual(['1'])
  })

  it('не расширяет исходный проём до округлённой ширины', () => {
    const geometry = fixture()
    geometry.routeWidthCm = 80
    for (const binding of pair(geometry).bindings) required(binding.cut)[1].yCm = 139.9
    expect(inspectPdfClearanceRoutes(geometry).result?.unresolvedRoomIds).toEqual(['1'])
  })

  it.each(['width', 'offset', 'host', 'room'] as const)(
    'снимает допуск после правки: %s',
    (edit) => {
      const geometry = fixture()
      const opening = required(geometry.openings[1])
      if (edit === 'width') opening.widthCm += 1
      if (edit === 'offset') opening.offsetCm += 1
      if (edit === 'host') required(geometry.walls[1]).end.yCm += 1
      if (edit === 'room') required(required(geometry.rooms[1]).polygon[0]).xCm += 1
      expect(inspectPdfClearanceRoutes(geometry).result).toBeUndefined()
    },
  )

  it.each(['cut', 'window', 'off-host', 'different-span'] as const)(
    'отклоняет неподтверждённый переход: %s',
    (edit) => {
      const geometry = fixture()
      const binding = pair(geometry).bindings[1]
      if (edit === 'cut') delete binding.cut
      if (edit === 'window') {
        binding.opening.type = 'window'
        required(geometry.openings[2]).type = 'window'
      }
      if (edit === 'off-host') required(binding.cut)[0].xCm += 1
      if (edit === 'different-span') required(binding.cut)[1].yCm -= 0.1
      expect(inspectPdfClearanceRoutes(geometry).result).toBeUndefined()
    },
  )

  it('не восстанавливает отсутствующие точные концы стартовой двери из ширины и смещения', () => {
    const geometry = fixture()
    const proofs = required(required(geometry.pdfCalibration).openingWidthProofs)
    delete required(proofs[0]).cut
    expect(inspectPdfClearanceRoutes(geometry).missing).toContain('исходными концами')
  })

  it.each(['wall', 'opening', 'pair'] as const)(
    'отклоняет неоднозначный идентификатор: %s',
    (duplicate) => {
      const geometry = fixture()
      if (duplicate === 'wall') geometry.walls.push(structuredClone(required(geometry.walls[1])))
      if (duplicate === 'opening')
        geometry.openings.push(structuredClone(required(geometry.openings[1])))
      if (duplicate === 'pair')
        required(required(geometry.pdfCalibration).openingFacePairs).push(
          structuredClone(pair(geometry)),
        )
      expect(inspectPdfClearanceRoutes(geometry).result).toBeUndefined()
    },
  )

  it('отклоняет перекрывающиеся комнаты', () => {
    const geometry = fixture()
    geometry.rooms.push({
      name: 'Дубликат',
      polygon: structuredClone(required(geometry.rooms[0]).polygon),
    })
    expect(inspectPdfClearanceRoutes(geometry).missing).toContain('перекрываются')
  })

  it('не создаёт переход через третью комнату', () => {
    const geometry = fixture()
    geometry.rooms.push({ name: 'Третья', polygon: box(201, 50, 209, 150) })
    required(geometry.pdfCalibration).wallFaceRoomPolygons = structuredClone(
      geometry.rooms.map((room) => room.polygon),
    )
    expect(inspectPdfClearanceRoutes(geometry).missing).toContain('пересекает')
  })

  it('не вырезает противоречащую дверному переходу доказанную полосу стены', () => {
    const geometry = fixture()
    const [first, second] = pair(geometry).bindings
    const stripFace = (binding: PlanOpeningBinding) => ({
      wall: structuredClone(binding.wall),
      start: required(binding.cut)[0],
      end: required(binding.cut)[1],
      nativeSegment: { operationIndex: 2, subpathIndex: 0, segmentIndex: 0 },
    })
    required(geometry.pdfCalibration).wallFacePairs = [
      {
        faces: [stripFace(first), stripFace(second)],
        openings: structuredClone(geometry.openings.slice(1)),
      },
    ]
    expect(inspectPdfClearanceRoutes(geometry).missing).toContain('пересекает')
  })

  it('не забывает исходную связь, удалённую при сохранении изменённого черновика', () => {
    const geometry = fixture()
    const calibration = required(geometry.pdfCalibration)
    calibration.sourceOpeningFacePairs = structuredClone(calibration.openingFacePairs)
    calibration.openingFacePairs = []
    expect(inspectPdfClearanceRoutes(geometry).missing).toContain('После правки')
  })

  it.each(['fixed', 'void', 'kitchen'] as const)(
    'сохраняет препятствие внутри дверного перехода: %s',
    (kind) => {
      const geometry = fixture()
      if (kind === 'fixed')
        geometry.obstacles = [
          { id: 'fixed', kind: 'fixed', xCm: 203, yCm: 60, widthCm: 4, depthCm: 80 },
        ]
      if (kind === 'void') geometry.voids = [{ id: 'shaft', polygon: box(203, 60, 207, 140) }]
      if (kind === 'kitchen')
        geometry.kitchenItems = [
          { id: 'module', kind: 'cabinet', xCm: 203, yCm: 60, widthCm: 4, depthCm: 80 },
        ]
      expect(inspectPdfClearanceRoutes(geometry).result?.unresolvedRoomIds).toEqual(['1'])
    },
  )

  it('не принимает стартовую зону снаружи комнаты', () => {
    const geometry = fixture()
    required(required(geometry.openings[0]).clearance).side = 'right'
    expect(inspectPdfClearanceRoutes(geometry).missing).toContain('внутри комнаты')
  })

  it('учитывает добавленную стену внутри комнаты, не только контур пола', () => {
    const geometry = fixture()
    geometry.walls.push({
      id: 'new-wall',
      kind: 'inner',
      start: point(150, 0),
      end: point(150, 200),
    })
    expect(inspectPdfClearanceRoutes(geometry).result?.unresolvedRoomIds).toEqual(['1'])
  })

  it('не открывает добавленную стену, совпавшую с гранью доказанной двери', () => {
    const geometry = fixture()
    geometry.walls.push({ ...structuredClone(required(geometry.walls[1])), id: 'extra-face' })
    expect(inspectPdfClearanceRoutes(geometry).result?.unresolvedRoomIds).toEqual(['1'])
  })

  it('не смешивает PDF-грани с физическими осями и толщиной', () => {
    const geometry = fixture()
    required(geometry.walls[1]).thicknessCm = 10
    expect(inspectPdfClearanceRoutes(geometry).missing).toContain('смешаны')
  })
})
