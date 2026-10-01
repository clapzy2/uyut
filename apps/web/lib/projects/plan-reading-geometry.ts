import { type PlanReading, planMeasurementTextItems, validatePlanMeasurement } from '@uyut/ai'
import { type PageAreaConflict, planPageAreaConflicts } from './plan-page-area-conflicts'
import { pdfDepthChain, pdfWidthChain } from './plan-pdf-dimension-chain'
import { pdfCalloutLeader } from './plan-pdf-leaders'
import type { PdfLinework } from './plan-pdf-linework'
import {
  type PdfPlanSource,
  type PdfRoomContours,
  pdfContourIssue,
  pdfRoomAtPoint,
} from './plan-pdf-room-binding'

export type PlanReadingGeometryContext = {
  /** Hash/page of the actual prepared file, not copied from the review annotation. */
  source: PdfPlanSource
  linework: PdfLinework
  planText?: string
  contours: PdfRoomContours
}

const fields = { width: 'widthCm', depth: 'depthCm', ceiling: 'ceilingCm' } as const
const titles = { width: 'Ширина', depth: 'Глубина', ceiling: 'Высота потолка' } as const

/**
 * Optional reviewed-page gate after the usual parser. Never supplies numbers or contours
 * from the annotation and never marks an AI reading as a confirmed on-site measurement.
 */
export function verifyPlanReadingGeometry(
  reading: PlanReading,
  context: PlanReadingGeometryContext,
): PlanReading {
  const { source, linework, contours } = context
  const sourceIssue = pdfContourIssue(linework, source, contours)
  const sameState = reading.planState === source.state
  const samePage = reading.sourcePage === undefined || reading.sourcePage === source.pdfPage
  const textItems = planMeasurementTextItems(context.planText)
  const areaConflicts = new Map<number, PageAreaConflict>(
    !sourceIssue && sameState && samePage
      ? planPageAreaConflicts(context).map((conflict) => [conflict.sourceNumber, conflict])
      : [],
  )
  const counts = new Map<number, number>()
  for (const room of reading.rooms) {
    if (room.sourceNumber !== undefined)
      counts.set(room.sourceNumber, (counts.get(room.sourceNumber) ?? 0) + 1)
  }
  const rooms = reading.rooms.map((original) => {
    const room = {
      ...original,
      ...(original.measurementEvidence
        ? { measurementEvidence: { ...original.measurementEvidence } }
        : {}),
      ...(original.measurementWarnings
        ? { measurementWarnings: [...original.measurementWarnings] }
        : {}),
    }
    for (const side of ['width', 'depth', 'ceiling'] as const) {
      const field = fields[side]
      const value = room[field]
      if (value === undefined) {
        delete room.measurementEvidence?.[side]
        continue
      }
      const evidence = room.measurementEvidence?.[side]
      const number = room.sourceNumber
      let accepted = false
      if (
        !sourceIssue &&
        sameState &&
        samePage &&
        textItems &&
        number !== undefined &&
        counts.get(number) === 1 &&
        validatePlanMeasurement(
          evidence,
          value * 10,
          side,
          { name: room.name, sourceNumber: number, uniqueName: false },
          textItems,
        )
      ) {
        const labels = (evidence?.textItemIndexes ?? []).flatMap((index) => {
          const item = textItems[index]
          return item && item.x !== undefined && item.y !== undefined
            ? [{ index, ...item, x: item.x, y: item.y }]
            : []
        })
        if (labels.length === evidence?.segmentsMm.length) {
          if (side === 'ceiling') {
            const label = labels[0]
            const leader = label ? pdfCalloutLeader(linework, label) : undefined
            const owner =
              leader?.status === 'candidate'
                ? pdfRoomAtPoint(linework, source, contours, leader.arrow.tip)
                : undefined
            accepted = owner?.status === 'candidate' && owner.roomSourceNumber === number
          } else {
            const chain = (side === 'width' ? pdfWidthChain : pdfDepthChain)(
              linework,
              source,
              contours,
              number,
              labels,
              Math.round(value * 10),
            )
            // A matching total is insufficient if the evidence assigned each number to the wrong label.
            accepted =
              chain.status === 'candidate' &&
              chain.segments.every((segment) => {
                const index = evidence?.textItemIndexes?.indexOf(segment.labelIndex) ?? -1
                return index >= 0 && evidence?.segmentsMm[index] === segment.valueMm
              })
          }
        }
      }
      if (accepted) continue
      delete room[field]
      delete room.measurementEvidence?.[side]
      if (side !== 'ceiling') {
        room.estimated = room.estimated?.filter((axis) => axis !== side)
        room.rechecked = room.rechecked?.filter((axis) => axis !== side)
        if (!room.estimated?.length) delete room.estimated
        if (!room.rechecked?.length) delete room.rechecked
      }
      const warning = `${titles[side]}: сверьте линию или выноску с этой комнатой на выбранном листе — поле оставлено для уточнения.`
      room.measurementWarnings = [...new Set([...(room.measurementWarnings ?? []), warning])]
    }
    if (room.measurementEvidence && Object.keys(room.measurementEvidence).length === 0)
      delete room.measurementEvidence
    const areaConflict =
      room.sourceNumber === undefined ? undefined : areaConflicts.get(room.sourceNumber)
    if (areaConflict) {
      delete room.areaM2
      const warning = `Площадь: на плане ${areaConflict.planAreaM2.toLocaleString('ru-RU')} м², в экспликации ${areaConflict.scheduleAreaM2.toLocaleString('ru-RU')} м². Уточните исходный обмер; значение оставлено пустым.`
      room.measurementWarnings = [...new Set([...(room.measurementWarnings ?? []), warning])]
    }
    return room
  })
  const result = { ...reading, rooms }
  if (!sameState) result.planState = 'unknown'
  if (sourceIssue || !sameState || !samePage) {
    for (const room of result.rooms) {
      const warning =
        'Для сверки размеров уточните состояние плана и разметку выбранного исходного листа.'
      room.measurementWarnings = [...new Set([...(room.measurementWarnings ?? []), warning])]
    }
  }
  // Room contours cannot prove one apartment-wide ceiling or validate an AI-generated global mesh.
  if (result.ceilingCm !== undefined || result.ceilingEvidence !== undefined) {
    delete result.ceilingCm
    delete result.ceilingEvidence
    for (const room of result.rooms) {
      const warning =
        'Общая высота: для проекта уточните единую высоту квартиры или высоты отдельных комнат.'
      room.measurementWarnings = [...new Set([...(room.measurementWarnings ?? []), warning])]
    }
  }
  delete result.geometry
  if (reading.geometry) {
    for (const room of result.rooms) {
      const warning =
        'Для общей 2D-схемы подтвердите масштаб и взаимное положение комнат; прочитанные размеры сохраняются отдельно.'
      room.measurementWarnings = [...new Set([...(room.measurementWarnings ?? []), warning])]
    }
  }
  return result
}
