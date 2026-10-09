import { parseFloorPlan } from '@uyut/ai'
import { describe, expect, it } from 'vitest'
import native from '../../../../docs/qa/fixtures/apartment-74-77-native-labels.json'
import annotated from '../../../../docs/qa/fixtures/apartment-74-77-page-contours.json'
import {
  createPdfNativePageDimensionChainVerifier,
  pdfNativePageDimensionChain,
} from './plan-pdf-dimension-chain'
import type { PdfLinework, PdfVectorPath } from './plan-pdf-linework'
import { verifyPlanReadingNativeChains } from './plan-reading-native-chains'

// Selected native rails used as a unit control, not proof of full-page or room ownership coverage.
const linework: PdfLinework = {
  coordinateSystem: 'page-0-1000',
  pageWidth: 842,
  pageHeight: 1191,
  paths: annotated.dimensionPaths as PdfVectorPath[],
  skippedCurves: 0,
  clippedPaths: 0,
  unsupportedPaths: 0,
  unsupportedContexts: 0,
  truncated: false,
}
const items = Array.from({ length: native.originalTextItemCount }, () => ({
  text: '',
  x: 0,
  y: 0,
  rotation: 0,
}))
for (const { index, ...item } of native.items) items[index] = item
const expected = annotated.rooms.find((room) => room.roomSourceNumber === 4)
if (!expected) throw new Error('Missing unit control')
const source = { ...annotated.source, state: 'existing' as const }
const context = { source, linework, planText: JSON.stringify(items) }
function reading(indexes = expected?.widthLabels ?? []) {
  const segments = indexes.map((index) => Number(items[index]?.text))
  return parseFloorPlan(
    JSON.stringify({
      planState: 'existing',
      rooms: [
        {
          name: 'Спальня',
          sourceNumber: 4,
          areaM2: 15.39,
          widthMm: segments.reduce((sum, value) => sum + value, 0),
          measurementEvidence: {
            width: {
              kind: 'horizontal-chain',
              scope: 'room',
              sourceNumber: 4,
              complete: true,
              segmentsMm: segments,
              textItemIndexes: indexes,
            },
          },
        },
      ],
    }),
    { requireMeasurementEvidence: true, planText: context.planText },
  )
}

describe('ordinary PDF native-chain containment, not room ownership acceptance', () => {
  it('retains a native candidate with explicit ownership/full-span warning, without mutating inputs', () => {
    const input = reading()
    const before = structuredClone({ input, context })
    const result = verifyPlanReadingNativeChains(input, context)
    expect(result.rooms[0]?.widthCm).toBe(298.5)
    expect(result.rooms[0]?.areaM2).toBe(15.39)
    expect(result.rooms[0]?.measurementWarnings?.join(' ')).toContain(
      'Принадлежность и полный охват',
    )
    expect({ input, context }).toEqual(before)
  })
  it('does not silently promote a genuine local span to the whole room size', () => {
    const input = reading([expected.widthLabels[0] ?? -1])
    const result = verifyPlanReadingNativeChains(input, context)
    expect(result.rooms[0]?.widthCm).toBe(input.rooms[0]?.widthCm)
    expect(result.rooms[0]?.measurementWarnings?.join(' ')).toContain('не подтверждены')
  })
  it('removes a disconnected partial chain and its evidence instead of filling from area', () => {
    const indexes = [expected.widthLabels[0], expected.widthLabels.at(-1)].filter(
      (index): index is number => index !== undefined,
    )
    const result = verifyPlanReadingNativeChains(reading(indexes), context)
    expect(result.rooms[0]?.widthCm).toBeUndefined()
    expect(result.rooms[0]?.measurementEvidence).toBeUndefined()
    expect(result.rooms[0]?.areaM2).toBe(15.39)
    expect(result.rooms[0]?.measurementWarnings?.join(' ')).toContain('не заменены расчётом')
  })
  it.each([
    { linework: undefined },
    { planText: undefined },
    { source: undefined },
    { source: { ...source, pdfPage: 0 } },
    { source: { ...source, state: 'proposed' as const } },
    { linework: { ...linework, truncated: true } },
    { linework: { ...linework, skippedCurveBoundsTruncated: true } },
    { linework: { ...linework, clippedPathBoundsTruncated: true } },
    { linework: { ...linework, skippedCurves: 1 } },
    { linework: { ...linework, clippedPaths: 1 } },
    { linework: { ...linework, unsupportedPaths: 1 } },
    { linework: { ...linework, unsupportedContexts: 1 } },
    { linework: { ...linework, paths: [...linework.paths, linework.paths[0] as PdfVectorPath] } },
    { linework: { ...linework, pageWidth: Number.NaN } },
  ])('does not accept missing/partial/foreign source context %j', (change) => {
    expect(
      verifyPlanReadingNativeChains(reading(), { ...context, ...change }).rooms[0]?.widthCm,
    ).toBeUndefined()
  })
  it('does not accept a reading from another page or unknown state', () => {
    const input = reading()
    input.sourcePage = source.pdfPage + 1
    expect(verifyPlanReadingNativeChains(input, context).rooms[0]?.widthCm).toBeUndefined()
    delete input.sourcePage
    input.planState = 'unknown'
    expect(verifyPlanReadingNativeChains(input, context).rooms[0]?.widthCm).toBeUndefined()
  })
  it('a model metric mesh is not validated by a native chain', () => {
    const input = reading()
    input.geometry = {
      version: 1,
      status: 'draft',
      widthCm: 400,
      heightCm: 300,
      walls: [],
      openings: [],
      obstacles: [],
      rooms: [],
      warnings: [],
    }
    expect(verifyPlanReadingNativeChains(input, context).geometry).toBeUndefined()
    expect(input.geometry).toBeDefined()
  })
  it('allows unrelated localized curves but not an omitted curve beside a selected rail', () => {
    const distant = {
      operationIndex: 999_999,
      subpathIndex: 0,
      bounds: { left: 900, top: 900, right: 910, bottom: 910 },
    }
    const farContext = {
      ...context,
      linework: { ...linework, skippedCurves: 1, skippedCurveBounds: [distant] },
    }
    expect(verifyPlanReadingNativeChains(reading(), farContext).rooms[0]?.widthCm).toBe(298.5)
    const label = items[expected.widthLabels[0] ?? -1]
    if (!label) throw new Error('Missing source label')
    const near = {
      ...distant,
      bounds: { left: label.x, top: label.y, right: label.x + 1, bottom: label.y + 1 },
    }
    expect(
      verifyPlanReadingNativeChains(reading(), {
        ...farContext,
        linework: { ...farContext.linework, skippedCurveBounds: [near] },
      }).rooms[0]?.widthCm,
    ).toBeUndefined()
    expect(
      verifyPlanReadingNativeChains(reading(), {
        ...farContext,
        linework: { ...farContext.linework, skippedCurveBoundsTruncated: true },
      }).rooms[0]?.widthCm,
    ).toBeUndefined()
  })
  it('bounds the number of source-chain checks without marking the remainder verified', () => {
    const input = reading()
    const room = input.rooms[0]
    if (!room) throw new Error('Missing control room')
    input.rooms = Array.from({ length: 41 }, (_, index) => ({
      ...structuredClone(room),
      name: `Спальня ${index}`,
    }))
    const result = verifyPlanReadingNativeChains(input, context)
    expect(result.rooms.filter((room) => room.widthCm !== undefined)).toHaveLength(40)
    expect(result.rooms[40]?.widthCm).toBeUndefined()
    expect(result.rooms[40]?.measurementWarnings?.join(' ')).toContain('не подтверждена')
  })
  it('reuses only request-local native span work and keeps the direct API result', () => {
    const labels = expected.widthLabels
      .map((index) => ({ ...items[index], index }))
      .filter(
        (label): label is { index: number; text: string; x: number; y: number; rotation: number } =>
          label.text !== undefined,
      )
    const snapshot = structuredClone(linework)
    const verify = createPdfNativePageDimensionChainVerifier(linework, source)
    expect(verify(labels, 2985, 'width')).toEqual(
      pdfNativePageDimensionChain(linework, source, labels, 2985, 'width'),
    )
    expect(verify(labels, 2985, 'width')).toEqual(verify(labels, 2985, 'width'))
    expect(linework).toEqual(snapshot)
  })
})
