import { type PlanReading, planMeasurementTextItems, validatePlanMeasurement } from '@uyut/ai'
import type { NativeDimensionCaptionContext } from './plan-pdf-caption-binding'
import { createPdfNativePageDimensionChainVerifier } from './plan-pdf-dimension-chain'
import {
  pdfNativeDimensionChainIsUnobscured,
  pdfNativeDimensionSourceIssue,
} from './plan-pdf-dimension-source'
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
  context: {
    source?: PdfPlanSource
    linework?: PdfLinework
    planText?: string
    nativeCaptionGeometry?: NativeDimensionCaptionContext
  },
): PlanReading {
  const result = structuredClone(reading)
  const items = planMeasurementTextItems(context.planText)
  const work = context.linework
  const source = context.source
  const usable =
    source &&
    reading.planState === source.state &&
    (reading.sourcePage === undefined || reading.sourcePage === source.pdfPage) &&
    work &&
    !pdfNativeDimensionSourceIssue(source, work)
  const verify = usable
    ? createPdfNativePageDimensionChainVerifier(work, source, context.nativeCaptionGeometry)
    : undefined
  const nameCounts = new Map<string, number>()
  for (const room of result.rooms) nameCounts.set(room.name, (nameCounts.get(room.name) ?? 0) + 1)
  let checks = 0
  for (const room of result.rooms) {
    // Text/value agreement cannot prove which room owns a ceiling callout.
    // The ordinary PDF route has no reviewed contours or height-owner proof.
    if (room.ceilingCm !== undefined || room.measurementEvidence?.ceiling !== undefined) {
      delete room.ceilingCm
      delete room.measurementEvidence?.ceiling
      const warning =
        'Высота потолка: привязка исходной подписи или выноски к этой комнате не подтверждена. Сверьте её на листе или по обмеру — поле оставлено для уточнения.'
      room.measurementWarnings = [...new Set([...(room.measurementWarnings ?? []), warning])]
    }
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
        pdfNativeDimensionChainIsUnobscured(work, chain, labels) &&
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
  if (result.ceilingCm !== undefined || result.ceilingEvidence !== undefined) {
    delete result.ceilingCm
    delete result.ceilingEvidence
    for (const room of result.rooms) {
      const warning =
        'Общая высота: единая высота всех помещений не подтверждена исходным PDF-листом. Сверьте высоты отдельных комнат; значение оставлено пустым.'
      room.measurementWarnings = [...new Set([...(room.measurementWarnings ?? []), warning])]
    }
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
