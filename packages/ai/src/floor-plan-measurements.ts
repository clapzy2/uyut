import type { PlanMeasurementEvidence } from '@uyut/db'
import { planRoomSourceNumber } from './floor-plan-geometry'

type TextItem = { text: string; rotation: number }
type MeasurementOwner = { name: string; sourceNumber?: number; uniqueName: boolean }

export function planMeasurementTextItems(raw: string | undefined): TextItem[] | undefined {
  if (!raw) return undefined
  try {
    const items: unknown = JSON.parse(raw)
    if (!Array.isArray(items) || items.length === 0) return undefined
    return items.map((item) => ({
      text: typeof item?.text === 'string' ? item.text : '',
      rotation: typeof item?.rotation === 'number' ? item.rotation : Number.NaN,
    }))
  } catch {
    return undefined
  }
}

function positiveNumber(raw: unknown): number | undefined {
  if (typeof raw !== 'number' && typeof raw !== 'string') return undefined
  const value = Number(raw)
  return Number.isFinite(value) && value > 0 ? value : undefined
}

function labelMillimetres(text: string, ceiling: boolean, apartment: boolean): number | undefined {
  const normalized = text.trim().toLocaleLowerCase('ru')
  if (ceiling && (!/потол|натяж/.test(normalized) || /h[12]|балк|про[её]м/.test(normalized))) {
    return undefined
  }
  if (ceiling && /(?:^|\s)(?:от|до)(?:\s|$)|диапазон|\d+\s*(?:мм)?\s*[-–]\s*\d+/.test(normalized)) {
    return undefined
  }
  if (apartment && !/квартир|общая высота|единая высота/.test(normalized)) return undefined
  const match = ceiling
    ? normalized.match(/(?:-|=|\s)(\d+(?:[.,]\d+)?)\s*(мм|см|м)$/)
    : normalized.match(/^(\d+(?:[.,]\d+)?)\s*(мм|см|м)?$/)
  if (!match?.[1]) return undefined
  const multiplier = match[2] === 'м' ? 1000 : match[2] === 'см' ? 10 : 1
  return Number(match[1].replace(',', '.')) * multiplier
}

/** Проверяет назначение и арифметику цепочки, но не угадывает её комнату по близости текста. */
export function validatePlanMeasurement(
  raw: unknown,
  declaredMm: unknown,
  side: 'width' | 'depth' | 'ceiling',
  owner: MeasurementOwner | undefined,
  textItems: readonly TextItem[] | undefined,
): PlanMeasurementEvidence | undefined {
  if (!raw || typeof raw !== 'object') return undefined
  const evidence = raw as Record<string, unknown>
  const expectedKind =
    side === 'width' ? 'horizontal-chain' : side === 'depth' ? 'vertical-chain' : 'ceiling'
  if (evidence.kind !== expectedKind || evidence.complete !== true) return undefined
  if (evidence.scope !== (owner ? 'room' : 'apartment')) return undefined

  const sourceNumber = planRoomSourceNumber(evidence.sourceNumber)
  const roomName = typeof evidence.roomName === 'string' ? evidence.roomName.trim() : undefined
  if (owner) {
    if (sourceNumber !== undefined) {
      if (sourceNumber !== owner.sourceNumber) return undefined
    } else {
      if (evidence.sourceNumber != null || !owner.uniqueName || !roomName) return undefined
      const normalize = (name: string) => name.trim().toLocaleLowerCase('ru').replaceAll('ё', 'е')
      if (normalize(roomName) !== normalize(owner.name)) return undefined
    }
  } else if (evidence.sourceNumber != null || roomName) {
    return undefined
  }

  const declared = positiveNumber(declaredMm)
  const rawSegments = Array.isArray(evidence.segmentsMm) ? evidence.segmentsMm : []
  if (!declared || rawSegments.length === 0 || rawSegments.length > 30) return undefined
  if (side === 'ceiling' && rawSegments.length !== 1) return undefined
  const segments = rawSegments.map(positiveNumber)
  if (segments.some((segment) => segment === undefined)) return undefined
  const segmentsMm = segments.filter((segment): segment is number => segment !== undefined)
  const totalMm = segmentsMm.reduce((sum, segment) => sum + segment, 0)
  if (Math.abs(totalMm - declared) > 0.01) return undefined

  let textItemIndexes: number[] | undefined
  if (textItems) {
    const indexes = Array.isArray(evidence.textItemIndexes) ? evidence.textItemIndexes : []
    if (indexes.length !== segmentsMm.length || new Set(indexes).size !== indexes.length) {
      return undefined
    }
    for (const [index, rawIndex] of indexes.entries()) {
      if (!Number.isInteger(rawIndex) || rawIndex < 0 || rawIndex >= textItems.length)
        return undefined
      const item = textItems[rawIndex]
      if (!item || labelMillimetres(item.text, side === 'ceiling', !owner) !== segmentsMm[index]) {
        return undefined
      }
      if (side !== 'ceiling') {
        const rotation = ((item.rotation % 180) + 180) % 180
        const axisDifference =
          side === 'width' ? Math.min(rotation, 180 - rotation) : Math.abs(rotation - 90)
        if (!Number.isFinite(axisDifference) || axisDifference > 5) return undefined
      }
    }
    textItemIndexes = indexes
  }
  return {
    kind: expectedKind,
    scope: owner ? 'room' : 'apartment',
    ...(sourceNumber === undefined ? {} : { sourceNumber }),
    ...(roomName ? { roomName } : {}),
    complete: true,
    segmentsMm,
    ...(textItemIndexes ? { textItemIndexes } : {}),
  }
}
