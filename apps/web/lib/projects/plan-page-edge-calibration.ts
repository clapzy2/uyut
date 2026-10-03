import { planMeasurementTextItems } from '@uyut/ai'
import type { PlanPageContours } from '@uyut/db'
import { type PdfEdgeDimension, pdfDimensionForEdge } from './plan-pdf-edge-dimension'
import type { PdfLinework } from './plan-pdf-linework'
import {
  type PdfPlanSource,
  pdfContourIdentity,
  pdfContourRoomNumbers,
  pdfPointDistance,
} from './plan-pdf-room-binding'

type Edge = Extract<PdfEdgeDimension, { status: 'candidate' }>
type Result = { ok: true; chains: Edge[]; anchorNumbers: number[] } | { ok: false; error: string }

/** Общий масштаб — только из явно выбранных, независимых исходных граней. */
export function planPageEdgeCalibration(
  source: PdfPlanSource,
  work: PdfLinework,
  contours: PlanPageContours,
  planText: string | undefined,
): Result {
  const fail = (error: string): Result => ({ ok: false, error })
  const annotations = contours.rooms.flatMap((room) =>
    (room.dimensionEdges ?? []).map((edge) => ({ room, edge })),
  )
  if (annotations.length < 2 || annotations.length > 12)
    return fail('Для масштаба выберите от двух до двенадцати подписанных сторон на исходном листе.')
  const items = planMeasurementTextItems(planText)
  if (!items) return fail('Для масштаба нужны исходные подписи размеров PDF.')
  const usedLabels = new Set<number>()
  const usedLines = new Set<number>()
  const usedConnections = new Set<string>()
  const usedEdges = new Set<string>()
  const chains: Edge[] = []
  for (const { room, edge } of annotations) {
    const labels = edge.labelIndexes.flatMap((index) => {
      const label = items[index]
      return label && label.x !== undefined && label.y !== undefined
        ? [{ ...label, x: label.x, y: label.y, index }]
        : []
    })
    const binding = pdfDimensionForEdge(
      work,
      source,
      contours,
      pdfContourIdentity(room),
      edge,
      labels,
    )
    if (binding.status !== 'candidate')
      return fail(
        `Сторона ${edge.wallEdgeIndex + 1}, комната № ${pdfContourRoomNumbers(room).join(' + ')}: проверьте подписи, всю грань и связь обоих концов размера с её углами на PDF. Однозначная связь пока не подтверждена.`,
      )
    const wallKey = JSON.stringify(binding.wallRef)
    const connectionKeys = binding.endpointRefs.map((item) => JSON.stringify(item))
    if (
      binding.labelIndexes.some((index) => usedLabels.has(index)) ||
      binding.lineOperations.some((index) => usedLines.has(index)) ||
      connectionKeys.some((key) => usedConnections.has(key)) ||
      usedEdges.has(wallKey)
    )
      return fail('Для проверки масштаба нужны независимые стороны, подписи и размерные линии.')
    for (const index of binding.labelIndexes) usedLabels.add(index)
    for (const index of binding.lineOperations) usedLines.add(index)
    for (const key of connectionKeys) usedConnections.add(key)
    usedEdges.add(wallKey)
    chains.push(binding)
  }
  const direction = (edge: Edge) => {
    const [a, b] = edge.sourceEdge
    const length = pdfPointDistance(work, a, b)
    return {
      x: ((b.x - a.x) * work.pageWidth) / 1000 / length,
      y: ((b.y - a.y) * work.pageHeight) / 1000 / length,
    }
  }
  if (
    !chains.some((chain, index) => {
      const a = direction(chain)
      return chains.slice(index + 1).some((other) => {
        const b = direction(other)
        return Math.abs(a.x * b.y - a.y * b.x) >= 0.5
      })
    })
  )
    return fail('Выберите стороны в двух разных направлениях, с углом между ними не меньше 30°.')
  return {
    ok: true,
    chains,
    anchorNumbers: [...new Set(chains.flatMap((chain) => [...pdfContourRoomNumbers(chain)]))],
  }
}
