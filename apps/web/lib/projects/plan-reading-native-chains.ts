import { type PlanReading, planMeasurementTextItems, validatePlanMeasurement } from '@uyut/ai'
import { createPdfNativePageDimensionChainVerifier } from './plan-pdf-dimension-chain'
import type { PdfLinework } from './plan-pdf-linework'
import type { PdfPlanSource } from './plan-pdf-room-binding'

const axes = { width: 'widthCm', depth: 'depthCm' } as const
const titles = { width: 'Ширина', depth: 'Глубина' } as const

/**
 * Ordinary PDF reading: fail closed on unproved printed chains, not just model arithmetic.
 * Even a native line candidate is not an independently owned, complete room measurement.
 */
export function verifyPlanReadingNativeChains(
  reading: PlanReading,
  context: { source?: PdfPlanSource; linework?: PdfLinework; planText?: string },
): PlanReading {
  const result = structuredClone(reading)
  const items = planMeasurementTextItems(context.planText)
  const work = context.linework
  const source = context.source
  const omitted = work?.skippedCurveBounds ?? []
  const usable =
    source &&
    /^[a-f0-9]{64}$/.test(source.sha256) &&
    Number.isSafeInteger(source.pdfPage) &&
    source.pdfPage > 0 &&
    source.state === 'existing' &&
    reading.planState === source.state &&
    (reading.sourcePage === undefined || reading.sourcePage === source.pdfPage) &&
    work &&
    work.coordinateSystem === 'page-0-1000' &&
    !work.truncated &&
    !work.skippedCurveBoundsTruncated &&
    !work.clippedPathBoundsTruncated &&
    Number.isSafeInteger(work.skippedCurves) &&
    work.skippedCurves === omitted.length &&
    omitted.length <= 3000 &&
    omitted.every(
      ({ bounds }) =>
        [bounds.left, bounds.top, bounds.right, bounds.bottom].every(Number.isFinite) &&
        bounds.left <= bounds.right &&
        bounds.top <= bounds.bottom,
    ) &&
    work.clippedPaths === 0 &&
    work.unsupportedPaths === 0 &&
    work.unsupportedContexts === 0 &&
    work.paths.length <= 3000 &&
    work.paths.reduce((sum, path) => sum + path.points.length, 0) <= 20_000 &&
    new Set(work.paths.map((path) => `${path.operationIndex}:${path.subpathIndex}`)).size ===
      work.paths.length &&
    work.paths.every(
      (path) =>
        [path.operationIndex, path.subpathIndex].every(
          (value) => Number.isSafeInteger(value) && value >= 0,
        ) &&
        path.points.every((point) =>
          [point.x, point.y].every(
            (value) => Number.isFinite(value) && value >= 0 && value <= 1000,
          ),
        ),
    ) &&
    [work.pageWidth, work.pageHeight].every((value) => Number.isFinite(value) && value > 0)
  const verify = usable ? createPdfNativePageDimensionChainVerifier(work, source) : undefined
  const nameCounts = new Map<string, number>()
  for (const room of result.rooms) nameCounts.set(room.name, (nameCounts.get(room.name) ?? 0) + 1)
  let checks = 0
  for (const room of result.rooms) {
    for (const side of ['width', 'depth'] as const) {
      const value = room[axes[side]]
      if (value === undefined) continue
      const evidence = room.measurementEvidence?.[side]
      const valid =
        items &&
        validatePlanMeasurement(
          evidence,
          value * 10,
          side,
          {
            name: room.name,
            sourceNumber: room.sourceNumber,
            uniqueName: nameCounts.get(room.name) === 1,
          },
          items,
        )
      const labels = (valid?.textItemIndexes ?? []).flatMap((index) => {
        const item = items?.[index]
        return item && item.x !== undefined && item.y !== undefined
          ? [{ ...item, index, x: item.x, y: item.y }]
          : []
      })
      const chain =
        valid && verify && ++checks <= 40 ? verify(labels, Math.round(value * 10), side) : undefined
      const matched =
        chain?.status === 'candidate' &&
        work &&
        chain.segments.every((segment) => {
          const label = labels.find((label) => label.index === segment.labelIndex)
          if (!label) return false
          // Curves elsewhere (e.g. a door swing) do not invalidate this local rail.
          // An omitted path near the rail, endpoints or label may hide a competing source line.
          const x = [segment.start.x, segment.end.x, label.x]
          const y = [segment.start.y, segment.end.y, label.y]
          const padX = (6 * 1000) / work.pageWidth
          const padY = (6 * 1000) / work.pageHeight
          return !omitted.some(
            ({ bounds }) =>
              bounds.right >= Math.min(...x) - padX &&
              bounds.left <= Math.max(...x) + padX &&
              bounds.bottom >= Math.min(...y) - padY &&
              bounds.top <= Math.max(...y) + padY,
          )
        }) &&
        chain.segments.every((segment) => {
          const index = valid?.textItemIndexes?.indexOf(segment.labelIndex) ?? -1
          return index >= 0 && valid?.segmentsMm[index] === segment.valueMm
        })
      let warning: string
      if (matched) {
        warning = `${titles[side]}: нативная линия-кандидат найдена, но связь подписи с линией требует сверки. Принадлежность и полный охват этой комнаты не подтверждены — сверьте исходный лист перед переносом.`
      } else {
        delete room[axes[side]]
        delete room.measurementEvidence?.[side]
        room.estimated = room.estimated?.filter((axis) => axis !== side)
        room.rechecked = room.rechecked?.filter((axis) => axis !== side)
        if (!room.estimated?.length) delete room.estimated
        if (!room.rechecked?.length) delete room.rechecked
        warning = `${titles[side]}: соединённая размерная цепочка не подтверждена на исходном PDF-листе; поле оставлено для уточнения. Числа не заменены расчётом из площади.`
      }
      room.measurementWarnings = [...new Set([...(room.measurementWarnings ?? []), warning])]
    }
    if (room.measurementEvidence && Object.keys(room.measurementEvidence).length === 0)
      delete room.measurementEvidence
  }
  // Matching labels/rails do not validate a vision-model metric mesh or a complete floor.
  if (result.geometry) {
    delete result.geometry
    for (const room of result.rooms) {
      const warning =
        'Геометрия модели не подтверждена исходным листом. Для 2D/3D сверьте и перенесите контуры отдельно.'
      room.measurementWarnings = [...new Set([...(room.measurementWarnings ?? []), warning])]
    }
  }
  return result
}
