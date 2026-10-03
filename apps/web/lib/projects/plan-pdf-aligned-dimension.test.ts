import { describe, expect, it } from 'vitest'
import { pdfNativePageDimensionChain } from './plan-pdf-dimension-chain'
import type { PagePoint, PdfLinework, PdfVectorPath } from './plan-pdf-linework'

// Синтетические размерные линии: никакой приёмки реального обмера.
const source = { sha256: 'a'.repeat(64), pdfPage: 1, state: 'existing' as const }
function fixture(angleDegrees = 27) {
  const angle = (angleDegrees * Math.PI) / 180
  const point = (x: number, y: number): PagePoint => ({
    x: 500 + (x - 500) * Math.cos(angle) - (y - 350) * Math.sin(angle),
    y: ((350 + (x - 500) * Math.sin(angle) + (y - 350) * Math.cos(angle)) * 1000) / 700,
  })
  const path = (operationIndex: number, start: [number, number], end: [number, number]) => ({
    operationIndex,
    subpathIndex: 0,
    closed: false,
    paint: 'stroke' as const,
    points: [point(...start), point(...end)],
  })
  const work: PdfLinework = {
    coordinateSystem: 'page-0-1000',
    pageWidth: 1000,
    pageHeight: 700,
    skippedCurves: 0,
    unsupportedPaths: 0,
    unsupportedContexts: 0,
    clippedPaths: 0,
    truncated: false,
    paths: [
      path(1, [100, 200], [300, 200]),
      path(2, [300, 200], [600, 200]),
      path(3, [98, 198], [102, 202]),
      path(4, [298, 198], [302, 202]),
      path(5, [598, 198], [602, 202]),
    ],
  }
  const labels = [
    { ...point(190, 198), index: 0, text: '2000', rotation: -angleDegrees },
    { ...point(400, 198), index: 1, text: '3000', rotation: -angleDegrees },
  ]
  return { work, labels, path, point }
}

function check(work: PdfLinework, labels: ReturnType<typeof fixture>['labels']) {
  return pdfNativePageDimensionChain(work, source, labels, 5000, 'aligned')
}

describe('наклонные нативные размерные цепи', () => {
  it.each([14, -17, 77, 123])(
    'проверяет направление %i° без изменения исходных концов',
    (angle) => {
      const { work, labels } = fixture(angle)
      const before = structuredClone({ work, labels })
      const result = check(work, [...labels].reverse())
      expect(result).toMatchObject({
        status: 'candidate',
        axis: 'aligned',
        totalMm: 5000,
        labelIndexes: [0, 1],
        lineOperations: [1, 2],
      })
      if (result.status !== 'candidate') throw new Error('Цепь не принята')
      expect(result.ends[0]).toBe(work.paths[0]?.points[0])
      expect(result.ends[1]).toBe(work.paths[1]?.points[1])
      expect({ work, labels }).toEqual(before)
    },
  )

  it('не меняет прежний строгий режим ширины и глубины', () => {
    const { work, labels } = fixture()
    for (const axis of ['width', 'depth'] as const) {
      expect(pdfNativePageDimensionChain(work, source, labels, 5000, axis)).toMatchObject({
        status: 'unresolved',
        reason: 'invalid-dimension-labels',
      })
    }
  })

  it('принимает связанные встречные стрелки и возвращает их исходные вершины', () => {
    const { work, labels, path, point } = fixture()
    const arrow = (operationIndex: number, tip: number, base: number): PdfVectorPath => ({
      operationIndex,
      subpathIndex: 0,
      closed: true,
      paint: 'fill',
      points: [point(tip, 200), point(base, 199.5), point(base, 200.5)],
    })
    const paths = [
      path(1, [104, 200], [296, 200]),
      path(2, [304, 200], [596, 200]),
      arrow(3, 100, 104),
      arrow(4, 300, 296),
      arrow(5, 300, 304),
      arrow(6, 600, 596),
    ]
    const result = check({ ...work, paths }, labels)
    expect(result).toMatchObject({ status: 'candidate', lineOperations: [1, 2] })
    if (result.status !== 'candidate') throw new Error('Стрелки не приняты')
    expect(result.ends[0]).toBe(paths[2]?.points[0])
    expect(result.ends[1]).toBe(paths[5]?.points[0])
  })

  it('не накапливает малые отклонения в ломаную вместо одной размерной цепи', () => {
    const { work, path, point } = fixture()
    const nodes = Array.from(
      { length: 6 },
      (_, index) => [100 + index * 100, 200 + Math.max(0, index - 1) * 0.08] as [number, number],
    )
    const rails = nodes.slice(1).map((end, index) => {
      const start = nodes[index]
      if (!start) throw new Error('Нет начала линии')
      return path(index + 1, start, end)
    })
    const ticks = nodes.map(([x, y], index) => path(index + 10, [x - 2, y - 2], [x + 2, y + 2]))
    const labels = nodes
      .slice(1)
      .map(([x, y], index) => ({ ...point(x - 50, y - 2), index, text: '1000', rotation: -27 }))
    expect(check({ ...work, paths: [...rails, ...ticks] }, labels)).toMatchObject({
      status: 'unresolved',
      reason: 'non-collinear-dimension-chain',
    })
  })

  it.each([3, 4, 5])('отказывает без концевой метки %i', (operation) => {
    const { work, labels } = fixture()
    expect(
      check(
        { ...work, paths: work.paths.filter((path) => path.operationIndex !== operation) },
        labels,
      ).status,
    ).not.toBe('candidate')
  })

  it.each([1, 3])('не выбирает из дубликатов линии или метки %i', (operation) => {
    const { work, labels } = fixture()
    const duplicate = work.paths.find((path) => path.operationIndex === operation)
    if (!duplicate) throw new Error('Нет контрольного пути')
    expect(
      check({ ...work, paths: [...work.paths, { ...duplicate, operationIndex: 50 }] }, labels),
    ).toMatchObject({ status: 'ambiguous' })
  })

  it('не выбирает близкую параллельную цепь', () => {
    const { work, labels, path } = fixture()
    const parallel = [
      path(11, [100, 201], [300, 201]),
      path(12, [300, 201], [600, 201]),
      path(13, [98, 199], [102, 203]),
      path(14, [298, 199], [302, 203]),
      path(15, [598, 199], [602, 203]),
    ]
    expect(check({ ...work, paths: [...work.paths, ...parallel] }, labels)).toMatchObject({
      status: 'ambiguous',
    })
  })

  it('удачный поворот не скрывает дубликат другой допустимой наклонной линии', () => {
    const { work } = fixture()
    const chain = (degrees: number, row: number, offset: number): PdfVectorPath[] => {
      const angle = (degrees * Math.PI) / 180
      const point = (x: number, y: number) => ({
        x: 500 + (x - 500) * Math.cos(angle) - (y - row) * Math.sin(angle),
        y: row + (x - 500) * Math.sin(angle) + (y - row) * Math.cos(angle),
      })
      return [
        [point(100, row), point(600, row)],
        [point(98, row - 2), point(102, row + 2)],
        [point(598, row - 2), point(602, row + 2)],
      ].map((points, index) => ({
        operationIndex: offset + index + 1,
        subpathIndex: 0,
        closed: false,
        paint: 'stroke',
        points,
      }))
    }
    const primary = chain(27, 300, 0)
    const secondary = chain(27.5, 301, 10)
    const rail = secondary[0]
    if (!rail) throw new Error('Нет второй линии')
    const labels = [{ x: 500, y: 298, index: 0, text: '5000', rotation: -27 }]
    const square = { ...work, pageHeight: 1000 }
    for (const paths of [primary, secondary])
      expect(check({ ...square, paths }, labels).status).toBe('candidate')
    const conflict = [...primary, ...secondary, { ...rail, operationIndex: 50 }]
    for (const paths of [conflict, [...conflict].reverse()])
      expect(check({ ...square, paths }, labels).status).toBe('ambiguous')
  })

  it('отказывает при ответвлении от конца размерной линии', () => {
    const { work, labels, path } = fixture()
    const branch = path(20, [100, 200], [100, 220])
    expect(check({ ...work, paths: [...work.paths, branch] }, labels)).toMatchObject({
      status: 'ambiguous',
    })
  })

  it('не принимает арифметически верную сумму при неверных пропорциях сегментов', () => {
    const { work, labels } = fixture()
    const changed = labels.map((label, index) => ({
      ...label,
      text: index === 0 ? '1000' : '4000',
    }))
    expect(check(work, changed)).toMatchObject({
      status: 'unresolved',
      reason: 'dimension-scale-conflict',
    })
  })

  it('не связывает равное число с соседним отрезком', () => {
    const { work, labels } = fixture()
    const first = labels[0]
    const second = labels[1]
    if (!first || !second) throw new Error('Нет контрольных подписей')
    const changed = [first, { ...second, x: first.x, y: first.y }]
    expect(check(work, changed)).toMatchObject({
      status: 'unresolved',
      reason: 'reused-dimension-line',
    })
  })

  it('не переносит подпись по другую сторону линии или за её конец', () => {
    const { work, labels, path } = fixture()
    for (const position of [
      [190, 202],
      [99, 198],
    ] as const) {
      const location = path(99, [...position], [...position]).points[0]
      if (!location) throw new Error('Нет контрольной точки')
      const changed = labels.map((label, index) =>
        index === 0 ? { ...label, ...location } : label,
      )
      expect(check(work, changed).status).not.toBe('candidate')
    }
  })

  it('учитывает округление угла подписи, но не физический допуск обмера в пять градусов', () => {
    const { work, labels } = fixture(27.4)
    expect(
      check(
        work,
        labels.map((label) => ({ ...label, rotation: -27 })),
      ),
    ).toMatchObject({ status: 'candidate' })
    expect(
      check(
        work,
        labels.map((label) => ({ ...label, rotation: -23 })),
      ),
    ).toMatchObject({ status: 'unresolved' })
  })

  it('отказывает проектному состоянию, усечению и нечисловым координатам', () => {
    const { work, labels } = fixture()
    expect(
      pdfNativePageDimensionChain(work, { ...source, state: 'proposed' }, labels, 5000, 'aligned'),
    ).toMatchObject({ reason: 'not-existing-state' })
    expect(check({ ...work, truncated: true }, labels)).toMatchObject({
      reason: 'incomplete-native-page',
    })
    const bad: PdfVectorPath = {
      operationIndex: 99,
      subpathIndex: 0,
      paint: 'stroke',
      closed: false,
      points: [{ x: NaN, y: 0 }],
    }
    expect(check({ ...work, paths: [...work.paths, bad] }, labels)).toMatchObject({
      reason: 'invalid-dimension-labels',
    })
  })
})
