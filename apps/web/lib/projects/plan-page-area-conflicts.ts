import { planMeasurementTextItems, planRoomSchedule } from '@uyut/ai'
import type { PdfLinework } from './plan-pdf-linework'
import { type PdfPlanSource, type PdfRoomContours, pdfRoomAtPoint } from './plan-pdf-room-binding'

type PageAreaContext = {
  source: PdfPlanSource
  linework: PdfLinework
  contours: PdfRoomContours
  planText?: string
}

export type PageAreaConflict = {
  sourceNumber: number
  planAreaM2: number
  scheduleAreaM2: number
}

/** Contradictions between a signed in-room area and its numbered room schedule. */
export function planPageAreaConflicts(context: PageAreaContext): PageAreaConflict[] {
  if (context.source.state !== 'existing') return []
  const items = planMeasurementTextItems(context.planText)
  const schedule = planRoomSchedule(items)
  if (!items || !schedule) return []

  const conflicts: PageAreaConflict[] = []
  for (const [sourceNumber, scheduled] of schedule) {
    const localAreas: number[] = []
    for (const number of items) {
      if (
        !/^0?[1-9]\d?$/.test(number.text.trim()) ||
        Number(number.text) !== sourceNumber ||
        number.x === undefined ||
        number.y === undefined ||
        number.rotation !== 0
      )
        continue
      const numberOwner = pdfRoomAtPoint(context.linework, context.source, context.contours, {
        x: number.x,
        y: number.y,
      })
      if (numberOwner.status !== 'candidate' || numberOwner.roomSourceNumber !== sourceNumber)
        continue

      for (const area of items) {
        const match = /^(\d{1,3}[,.]\d{1,2})(?:\s*[мm](?:²|2)?)?$/iu.exec(area.text.trim())
        if (
          !match?.[1] ||
          area.x === undefined ||
          area.y === undefined ||
          area.rotation !== 0 ||
          Math.abs(area.x - number.x) > 10 ||
          area.y - number.y < 5 ||
          area.y - number.y > 25
        )
          continue
        const areaX = area.x
        const areaY = area.y
        const hasUnit =
          /[мm]/iu.test(area.text) ||
          items.some(
            (unit) =>
              /^[мm]$/iu.test(unit.text.trim()) &&
              unit.x !== undefined &&
              unit.y !== undefined &&
              unit.x > areaX &&
              unit.x - areaX <= 100 &&
              Math.abs(unit.y - areaY) <= 5,
          )
        if (!hasUnit) continue
        const areaOwner = pdfRoomAtPoint(context.linework, context.source, context.contours, {
          x: areaX,
          y: areaY,
        })
        if (areaOwner.status !== 'candidate' || areaOwner.roomSourceNumber !== sourceNumber)
          continue
        localAreas.push(Number(match[1].replace(',', '.')))
      }
    }
    const localArea = localAreas.length === 1 ? localAreas[0] : undefined
    if (localArea === undefined || Math.abs(localArea - scheduled.areaM2) <= 0.005) continue
    conflicts.push({
      sourceNumber,
      planAreaM2: localArea,
      scheduleAreaM2: scheduled.areaM2,
    })
  }
  return conflicts
}
