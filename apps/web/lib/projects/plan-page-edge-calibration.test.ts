import { describe, expect, it } from 'vitest'
import {
  contourDraftsFromSaved,
  pageContourRoomsForSave,
} from '../../components/plan-page-contour-editor-model'
import { planPageMetricDraft } from './plan-page-metric-draft'
import { planPageContoursSchema } from './plan-page-review'
import { pdfDimensionForEdge } from './plan-pdf-edge-dimension'
import type { PagePoint } from './plan-pdf-linework'
import { pdfContourIdentity, pdfPointDistance } from './plan-pdf-room-binding'

import {
  edgeDimensionFixture as fixture,
  required,
} from './test-fixtures/plan-page-edge-dimensions'

describe('привязка наклонных размеров и метрический перенос', () => {
  it.each([27, -17, 77])(
    'переносит непрямоугольный контур %i° одним масштабом без изменения исходника',
    (angle) => {
      const f = fixture(angle)
      const before = structuredClone({ reading: f.reading, context: f.context })
      const bound = f.binding()
      expect(bound).toMatchObject({
        status: 'candidate',
        axis: 'aligned',
        wallEdgeIndex: 0,
        totalMm: 3000,
        wallRef: { operationIndex: 0 },
        endpointRefs: [{ operationIndex: 7 }, { operationIndex: 8 }],
      })
      if (bound.status !== 'candidate') throw new Error(bound.reason)
      expect(bound.sourceEdge[0]).toBe(f.contours.rooms[0]?.polygon[0])
      const result = planPageMetricDraft(f.reading, f.context, [1])
      if (!result.ok) throw new Error(result.error)
      expect(result.geometry.status).toBe('draft')
      expect(result.geometry.rooms[0]?.polygon).toHaveLength(4)
      expect(result.geometry.walls).toHaveLength(4)
      expect(result.geometry.pdfCalibration).toMatchObject({
        anchorRoomNumbers: [1],
        labelIndexes: [0, 1],
      })
      expect(result.geometry.pdfCalibration?.cmPerPoint).toBeCloseTo(1, 12)
      expect(result.geometry.pdfCalibration?.edgeDimensions).toHaveLength(2)
      const top = result.geometry.walls[0]
      if (!top) throw new Error('Нет стены')
      expect(Math.hypot(top.end.xCm - top.start.xCm, top.end.yCm - top.start.yCm)).toBeCloseTo(
        300,
        0,
      )
      // Наклонную длину 300 см не назначаем шириной комнаты.
      expect(f.reading.rooms[0]?.widthCm).toBeUndefined()
      expect(result.geometry).not.toHaveProperty('ceilingCm')
      expect(JSON.parse(JSON.stringify(result.geometry))).toEqual(result.geometry)
      expect({ reading: f.reading, context: f.context }).toEqual(before)
    },
  )

  it('сохраняет выбранные подписи при закрытии и повторном открытии разметки', () => {
    const f = fixture()
    const nodes = f.work.paths.flatMap((path) => path.points)
    const opened = contourDraftsFromSaved(JSON.parse(JSON.stringify(f.contours.rooms)))
    const saved = pageContourRoomsForSave(opened, nodes)
    expect(saved).toEqual(f.contours.rooms)
    expect(saved?.[0]?.dimensionEdges).not.toBe(opened[0]?.dimensionEdges)
    const reopened = planPageContoursSchema.parse({ ...f.contours, rooms: saved })
    const result = planPageMetricDraft(f.reading, { ...f.context, contours: reopened }, [1])
    expect(result.ok).toBe(true)
  })

  it('не включает новый маршрут без явного выбора и не смешивает два способа масштаба', () => {
    const f = fixture()
    expect(planPageMetricDraft(f.reading, { ...f.context, useEdgeDimensions: false }, [1]).ok).toBe(
      false,
    )
    expect(
      planPageMetricDraft(f.reading, { ...f.context, calibrationRoomNumbers: [1] }, [1]),
    ).toMatchObject({ ok: false, error: expect.stringContaining('один способ') })
  })

  it.each([7, 8])('отклоняет отсутствующую выносную линию %i', (operation) => {
    const f = fixture()
    f.work.paths = f.work.paths.filter((path) => path.operationIndex !== operation)
    expect(f.binding()).toMatchObject({
      status: 'unresolved',
      reason: 'missing-bounded-endpoint-connection',
    })
  })

  it('связывает размер через настоящий соседний стеновой штрих без выдуманной выносной', () => {
    const f = fixture(0)
    // Put the dimension inside the room, where the actual two side walls connect its tips.
    required(f.work.paths[4]).points = [f.point(0, 20), f.point(300, 20)]
    required(f.work.paths[5]).points = [f.point(-2, 18), f.point(2, 22)]
    required(f.work.paths[6]).points = [f.point(298, 18), f.point(302, 22)]
    required(f.work.paths[1]).points = [f.point(300, 0), f.point(300, 200)]
    required(f.work.paths[2]).points = [f.point(300, 200), f.point(0, 200)]
    f.room.polygon[2] = f.point(300, 200)
    f.work.paths = f.work.paths.filter((path) => ![7, 8].includes(path.operationIndex))
    f.labels[0] = { ...f.point(150, 18), index: 0, text: '3000', rotation: 0 }
    expect(f.binding()).toMatchObject({
      status: 'candidate',
      endpointRefs: [{ operationIndex: 3 }, { operationIndex: 1 }],
    })
    // A marked doorway on the connecting portion invalidates the same native witness.
    f.room.openings = [
      {
        id: 'side-door',
        kind: 'door',
        wallEdgeIndex: 3,
        start: f.point(0, 5),
        end: f.point(0, 15),
      },
    ]
    expect(f.binding()).toMatchObject({
      status: 'unresolved',
      reason: 'endpoint-connection-crosses-opening',
    })
  })

  it('не продлевает выносную до стены и не подтверждает стену только по двум вершинам', () => {
    const f = fixture()
    const extension = f.work.paths[7]
    if (!extension) throw new Error('Нет линии')
    extension.points[0] = f.point(0, -5)
    expect(f.binding()).toMatchObject({
      status: 'unresolved',
      reason: 'missing-bounded-endpoint-connection',
    })
    const g = fixture()
    g.work.paths = g.work.paths.filter((path) => path.operationIndex !== 0)
    expect(g.binding()).toMatchObject({
      status: 'unresolved',
      reason: 'no-continuous-native-wall-edge',
    })
  })

  it('отклоняет другую сторону и чужую комнату', () => {
    const f = fixture()
    expect(f.binding(2)).toMatchObject({
      status: 'unresolved',
      reason: 'dimension-does-not-span-declared-edge',
    })
    expect(
      pdfDimensionForEdge(
        f.work,
        f.context.source,
        f.contours,
        { roomSourceNumber: 2 },
        { wallEdgeIndex: 0, labelIndexes: [0] },
        [f.labels[0]],
      ),
    ).toMatchObject({ status: 'unresolved', reason: 'no-annotated-room' })
  })

  it('не скрывает узкую чужую зону между стеной и размерной цепью', () => {
    const f = fixture()
    f.contours.rooms.push({
      roomSourceNumber: 2,
      polygon: [f.point(21, -15), f.point(23, -15), f.point(23, -5), f.point(21, -5)],
    })
    expect(f.binding()).toMatchObject({
      status: 'unresolved',
      reason: 'dimension-crosses-other-room',
    })
  })

  it('отклоняет равноудалённую конкурирующую грань', () => {
    const f = fixture()
    f.contours.rooms.push({
      roomSourceNumber: 2,
      polygon: [f.point(0, -40), f.point(300, -40), f.point(300, -60), f.point(0, -60)],
    })
    expect(f.binding()).toMatchObject({ status: 'ambiguous', reason: 'competing-dimension-edge' })
  })

  it('не выбирает одну из двух выносных или двух одинаковых стен', () => {
    const f = fixture()
    const extension = required(f.work.paths[7])
    f.work.paths.push({ ...extension, operationIndex: 100 })
    expect(f.binding()).toMatchObject({
      status: 'ambiguous',
      reason: 'multiple-endpoint-connections',
    })
    const g = fixture()
    g.work.paths.push({ ...required(g.work.paths[0]), operationIndex: 100 })
    expect(g.binding()).toMatchObject({ status: 'ambiguous', reason: 'multiple-native-wall-edges' })
  })

  it('не выдаёт условную границу или сторону с проёмом за непрерывную стену', () => {
    const f = fixture()
    f.room.conditionalEdges = [{ wallEdgeIndex: 0 }]
    expect(f.binding()).toMatchObject({
      status: 'unresolved',
    })
    const g = fixture()
    g.room.openings = [
      { id: 'door', kind: 'door', wallEdgeIndex: 0, start: g.point(100, 0), end: g.point(180, 0) },
    ]
    expect(g.binding().status).toBe('unresolved')
    expect(planPageMetricDraft(g.reading, g.context, [1]).ok).toBe(false)
  })

  it('сохраняет идентичность общей зоны целиком', () => {
    const f = fixture()
    const { roomSourceNumber: _number, ...fields } = f.room
    const room = { ...fields, roomSourceNumbers: [1, 2] }
    f.contours.rooms = [room]
    expect(
      pdfDimensionForEdge(
        f.work,
        f.context.source,
        f.contours,
        pdfContourIdentity(room),
        required(room.dimensionEdges?.[0]),
        [f.labels[0]],
      ).status,
    ).toBe('candidate')
    expect(f.binding()).toMatchObject({ status: 'unresolved', reason: 'no-annotated-room' })
  })

  it('отклоняет отсечённые линии, смену PDF и проектное состояние', () => {
    const f = fixture()
    f.work.clippedPaths = 1
    expect(f.binding()).toMatchObject({ status: 'unresolved', reason: 'clipped-edge-evidence' })
    const g = fixture()
    g.context.source = { ...g.context.source, sha256: 'b'.repeat(64) }
    expect(planPageMetricDraft(g.reading, g.context, [1]).ok).toBe(false)
    const h = fixture()
    h.context.source.state = 'proposed' as 'existing'
    expect(h.binding().status).toBe('unresolved')
  })

  it('проверяет общий масштаб и не подгоняет второе направление', () => {
    const f = fixture()
    f.labels[1].text = '2100'
    f.context.planText = JSON.stringify(f.labels)
    expect(planPageMetricDraft(f.reading, f.context, [1])).toMatchObject({
      ok: false,
      error: expect.stringContaining('единый масштаб'),
    })
    const g = fixture()
    g.room.dimensionEdges = [{ wallEdgeIndex: 0, labelIndexes: [0] }]
    expect(planPageMetricDraft(g.reading, g.context, [1]).ok).toBe(false)
    const h = fixture()
    required(h.room.dimensionEdges)[1] = { wallEdgeIndex: 0, labelIndexes: [0] }
    expect(planPageMetricDraft(h.reading, h.context, [1]).ok).toBe(false)
  })

  it('требует исходную полную длину, а не середину стены', () => {
    const f = fixture()
    const chain = required(f.work.paths[4])
    chain.points[1] = f.point(290, -20)
    required(f.work.paths[6]).points = [f.point(288, -22), f.point(292, -18)]
    expect(f.binding()).toMatchObject({
      status: 'unresolved',
      reason: 'dimension-does-not-span-declared-edge',
    })
    expect(
      pdfPointDistance(f.work, ...(f.room.polygon.slice(0, 2) as [PagePoint, PagePoint])),
    ).toBeCloseTo(300)
  })
})
