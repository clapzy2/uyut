import { describe, expect, it } from 'vitest'
import { pdfNativePageDimensionChain } from './plan-pdf-dimension-chain'
import type { PagePoint, PdfLinework, PdfVectorPath } from './plan-pdf-linework'

const source = { sha256: 'a'.repeat(64), pdfPage: 1, state: 'existing' as const }

function fixture(angleDegrees: number, arrowCount: number) {
  const pointAt = (angle: number, row: number) => {
    const radians = (angle * Math.PI) / 180
    return (x: number, y: number): PagePoint => ({
      x: 500 + (x - 500) * Math.cos(radians) - (y - row) * Math.sin(radians),
      y: row + (x - 500) * Math.sin(radians) + (y - row) * Math.cos(radians),
    })
  }
  const primaryPoint = pointAt(angleDegrees, 500)
  const competingPoint = pointAt(angleDegrees + 0.5, 501)
  const path = (
    operationIndex: number,
    points: PagePoint[],
    paint: PdfVectorPath['paint'] = 'stroke',
  ): PdfVectorPath => ({
    operationIndex,
    subpathIndex: 0,
    paint,
    closed: paint !== 'stroke',
    points,
  })
  const primary = [
    path(1, [primaryPoint(100, 500), primaryPoint(600, 500)]),
    path(2, [primaryPoint(98, 498), primaryPoint(102, 502)]),
    path(3, [primaryPoint(598, 498), primaryPoint(602, 502)]),
  ]
  const competing = [path(11, [competingPoint(100, 501), competingPoint(600, 501)])]
  for (let index = 0; index < arrowCount; index++) {
    competing.push(
      path(
        100 + index,
        [competingPoint(95, 501), competingPoint(100, 500.5), competingPoint(100, 501.5)],
        'fill',
      ),
      path(
        1000 + index,
        [competingPoint(605, 501), competingPoint(600, 500.5), competingPoint(600, 501.5)],
        'fill',
      ),
    )
  }
  const work: PdfLinework = {
    coordinateSystem: 'page-0-1000',
    pageWidth: 1000,
    pageHeight: 1000,
    skippedCurves: 0,
    unsupportedPaths: 0,
    unsupportedContexts: 0,
    clippedPaths: 0,
    truncated: false,
    paths: [...primary, ...competing],
  }
  const labels = [{ ...primaryPoint(500, 498), index: 0, text: '5000', rotation: -angleDegrees }]
  const check = (paths = work.paths) =>
    pdfNativePageDimensionChain({ ...work, paths }, source, labels, 5000, 'aligned')
  return { work, labels, primary, competing, check }
}

describe('бюджет конкурирующих наклонных размерных линий', () => {
  it.each([27, -17, 77, 123])(
    'не принимает другое направление %i° после исчерпания бюджета',
    (angle) => {
      const f = fixture(angle, 45)
      const before = structuredClone({ work: f.work, labels: f.labels })
      expect(f.check(f.primary)).toMatchObject({ status: 'candidate', lineOperations: [1] })
      for (const paths of [f.work.paths, [...f.competing, ...f.primary]]) {
        expect(f.check(paths)).toMatchObject({
          status: 'ambiguous',
          reason: 'dimension-span-budget-exceeded',
        })
      }
      expect(f.check(f.competing)).toMatchObject({
        status: 'ambiguous',
        reason: 'dimension-span-budget-exceeded',
      })
      expect({ work: f.work, labels: f.labels }).toEqual(before)
    },
  )

  it('сохраняет неоднозначность конкурирующих стрелок ниже бюджета', () => {
    const f = fixture(27, 44)
    expect(f.check()).toMatchObject({ status: 'ambiguous', reason: 'multiple-dimension-lines' })
  })
})
