import { describe, expect, it } from 'vitest'
import type { NativeTextAnchors } from './plan-document'
import { nativeFillCandidates } from './plan-native-fill-candidates'
import {
  calibratedFillAreaM2,
  nativeNumberedFillHints,
  printedDimensionScale,
} from './plan-native-numbered-fill-hints'
import type { nativeRoomScheduleEvidence } from './plan-native-room-schedule'
import type { PagePoint, PdfLinework } from './plan-pdf-linework'

const source = { sha256: 'a'.repeat(64), page: 1, width: 1000, height: 1000 }
const originalPdfSha256 = 'b'.repeat(64)
const rectangle = (left: number, top: number, width: number, height: number): PagePoint[] => [
  { x: left, y: top },
  { x: left + width, y: top },
  { x: left + width, y: top + height },
  { x: left, y: top + height },
]
const label = (nativeIndex: number, name: string, x: number, y: number) => ({
  id: `native-text-${nativeIndex}`,
  nativeIndex,
  name,
  point: { x, y },
  pagePoint: { x, y },
  rotation: 0,
})
const native: NativeTextAnchors = {
  source,
  originalPdfSha256,
  complete: true,
  pageNormalizedScale: { x: 1, y: 1 },
  labels: [
    label(1, '2', 500, 500),
    label(2, 'Кухня', 540, 500),
    label(3, '4,64', 590, 500),
    label(4, '2', 80, 80),
    label(5, 'м', 205, 300),
    label(6, '2', 214, 300),
  ],
}
const schedule = {
  status: 'draft' as const,
  reason: null,
  rows: [
    {
      sourceNumber: 2,
      name: 'Кухня',
      documentaryAreaM2: 4.64,
      numberLabelId: 'native-text-1',
      nameLabelId: 'native-text-2',
      areaLabelId: 'native-text-3',
    },
  ],
  headerLabelIds: [],
  tableBounds: { left: 480, top: 480, right: 620, bottom: 520 },
  tableEdges: [],
  layoutBasis: 'exact-native-grid' as const,
  basis: 'native-room-schedule-evidence' as const,
  source,
  originalPdfSha256,
  roomOwnershipConfirmed: false as const,
  closesFloorBoundary: false as const,
} satisfies ReturnType<typeof nativeRoomScheduleEvidence>
const work: PdfLinework = {
  coordinateSystem: 'page-0-1000',
  pageWidth: 1000,
  pageHeight: 1000,
  paths: [
    {
      operationIndex: 10,
      subpathIndex: 0,
      paint: 'fill',
      closed: true,
      points: rectangle(20, 20, 100, 100),
    },
  ],
  skippedCurves: 0,
  clippedPaths: 0,
  unsupportedPaths: 0,
  unsupportedContexts: 0,
  truncated: false,
}
const inventory = (linework = work) =>
  nativeFillCandidates({ native, work: linework, lineworkSource: source })

describe('read-only numbered PDF fill hints', () => {
  it('calibrates X and Y independently and rejects conflicting printed dimensions', () => {
    const dimensions = [
      {
        valueMm: 842,
        spanEnds: [
          { x: 20, y: 20 },
          { x: 120, y: 20 },
        ] as const,
      },
      {
        valueMm: 1684,
        spanEnds: [
          { x: 20, y: 30 },
          { x: 220, y: 30 },
        ] as const,
      },
      {
        valueMm: 1191,
        spanEnds: [
          { x: 20, y: 20 },
          { x: 20, y: 120 },
        ] as const,
      },
      {
        valueMm: 2382,
        spanEnds: [
          { x: 30, y: 20 },
          { x: 30, y: 220 },
        ] as const,
      },
    ]
    const scale = printedDimensionScale(dimensions, 842, 1191)
    expect(scale).toEqual({ xMmPerUnit: 8.42, yMmPerUnit: 11.91 })
    if (!scale) throw new Error('Missing test calibration')
    expect(calibratedFillAreaM2(rectangle(20, 20, 100, 100), scale)).toBeCloseTo(1.002822, 6)
    expect(
      printedDimensionScale(
        dimensions.map((dimension, index) =>
          index === 3 ? { ...dimension, valueMm: 2500 } : dimension,
        ),
        842,
        1191,
      ),
    ).toBeNull()
    expect(
      printedDimensionScale(
        dimensions.map((dimension, index) =>
          index >= 2 ? { ...dimension, valueMm: dimension.valueMm * 1.02 } : dimension,
        ),
        842,
        1191,
      ),
    ).toBeNull()
    expect(printedDimensionScale(dimensions.slice(0, 2), 842, 1191)).toBeNull()
  })

  it('links a drawing number, but not the table number or square superscript', () => {
    const result = nativeNumberedFillHints({ native, inventory: inventory(), schedule })
    expect(result).toMatchObject({
      status: 'diagnostic',
      rows: [
        {
          sourceNumber: 2,
          name: 'Кухня',
          markerLabelIds: ['native-text-4'],
          fillIds: ['native-fill-10:0'],
          otherSameNumberLabels: 0,
        },
      ],
    })
    expect(result).not.toHaveProperty('readyFor2D')
    expect(result).not.toHaveProperty('roomOwnershipConfirmed')
  })

  it('keeps overlapping fills ambiguous instead of choosing the smallest', () => {
    const overlapping = inventory({
      ...work,
      paths: [
        ...work.paths,
        {
          operationIndex: 11,
          subpathIndex: 0,
          paint: 'fill',
          closed: true,
          points: rectangle(40, 40, 80, 80),
        },
      ],
    })
    const result = nativeNumberedFillHints({ native, inventory: overlapping, schedule })
    expect(result.rows[0]?.fillIds).toEqual(['native-fill-10:0', 'native-fill-11:0'])
  })

  it('does not offer a large fill spanning different numbered rooms as one room', () => {
    const twoRooms = {
      ...native,
      labels: [...native.labels, label(7, '3', 180, 180)],
    }
    const twoRows = {
      ...schedule,
      rows: [
        ...schedule.rows,
        {
          sourceNumber: 3,
          name: 'Детская',
          documentaryAreaM2: 9.22,
          numberLabelId: 'native-text-8',
          nameLabelId: 'native-text-9',
          areaLabelId: 'native-text-10',
        },
      ],
    }
    const twoFills = inventory({
      ...work,
      paths: [
        ...work.paths,
        {
          operationIndex: 11,
          subpathIndex: 0,
          paint: 'fill',
          closed: true,
          points: rectangle(10, 10, 250, 250),
        },
      ],
    })
    const result = nativeNumberedFillHints({
      native: twoRooms,
      inventory: twoFills,
      schedule: twoRows,
    })
    expect(result.rows[0]?.fillIds).toEqual(['native-fill-10:0'])
    expect(result.rows[1]?.fillIds).toEqual([])
  })

  it('does not assign paint when only a table number is present or the source is held', () => {
    const withoutDrawing = {
      ...native,
      labels: native.labels.filter((item) => item.id !== 'native-text-4'),
    }
    expect(
      nativeNumberedFillHints({ native: withoutDrawing, inventory: inventory(), schedule }).rows[0]
        ?.fillIds,
    ).toEqual([])
    expect(
      nativeNumberedFillHints({
        native,
        inventory: inventory(),
        schedule: { ...schedule, reason: 'invalid' },
      }),
    ).toEqual({ status: 'held', rows: [] })
    expect(
      nativeNumberedFillHints({
        native,
        inventory: { ...inventory(), source: { ...source, page: 2 } },
        schedule,
      }),
    ).toEqual({ status: 'held', rows: [] })
  })
})
