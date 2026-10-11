import { describe, expect, it } from 'vitest'
import { nativeRoomNumberScheduleLinks } from './plan-native-room-number-links'
import type { PagePoint, PdfCurvePath } from './plan-pdf-linework'
import {
  addNativeRoomLabel,
  numberedNativeRoomFixture,
} from './test-fixtures/native-numbered-rooms'

type Input = Parameters<typeof nativeRoomNumberScheduleLinks>[0]
type Label = Input['native']['labels'][number]

function addCircle(input: Input, label: Label): PdfCurvePath {
  const center = label.pagePoint
  if (!center) throw new Error('Missing fixture page point')
  const radius = 8
  const k = (4 / 3) * Math.tan(Math.PI / 8)
  const points = [
    { x: center.x + radius, y: center.y },
    { x: center.x, y: center.y + radius },
    { x: center.x - radius, y: center.y },
    { x: center.x, y: center.y - radius },
    { x: center.x + radius, y: center.y },
  ]
  input.work.curvePaths ??= []
  const curve: PdfCurvePath = {
    operationIndex: 1000 + input.work.curvePaths.length,
    subpathIndex: 0,
    operationSubpathCount: 1,
    paint: 'stroke',
    closed: true,
    start: points[0] as PagePoint,
    segments: points.slice(1).map((end, index) => {
      const start = points[index] as PagePoint
      return {
        kind: 'cubic',
        control1: {
          x: start.x - k * (start.y - center.y),
          y: start.y + k * (start.x - center.x),
        },
        control2: {
          x: end.x + k * (end.y - center.y),
          y: end.y - k * (end.x - center.x),
        },
        end,
      }
    }),
  }
  input.work.curvePaths.push(curve)
  refreshCurveBounds(input)
  return curve
}

function refreshCurveBounds(input: Input) {
  input.work.skippedCurves = input.work.curvePaths?.length ?? 0
  input.work.skippedCurveBounds = (input.work.curvePaths ?? []).map((curve) => {
    const points = [
      curve.start,
      ...curve.segments.flatMap((segment) =>
        segment.kind === 'cubic'
          ? [segment.control1, segment.control2, segment.end]
          : segment.kind === 'quadratic'
            ? [segment.control, segment.end]
            : [segment.end],
      ),
    ]
    return {
      operationIndex: curve.operationIndex,
      bounds: {
        left: Math.min(...points.map((point) => point.x)),
        top: Math.min(...points.map((point) => point.y)),
        right: Math.max(...points.map((point) => point.x)),
        bottom: Math.max(...points.map((point) => point.y)),
      },
    }
  })
}

function fixture(): Input {
  const input = numberedNativeRoomFixture()
  // Documentary table/number correspondence needs no accepted room geometry.
  input.work.paths = []
  for (const label of input.native.labels.filter((label) => label.pagePoint?.y === 150))
    addCircle(input, label)
  return input
}

function rowLabel(input: Input, number: number, field: 'number' | 'name' | 'area') {
  const slot = field === 'number' ? 0 : field === 'name' ? 1 : 2
  const label = input.native.labels[3 + (number - 1) * 3 + slot]
  if (!label) throw new Error('Missing fixture table label')
  return label
}

function markerLabel(input: Input, number: number) {
  const label = input.native.labels.find(
    (label) => label.name === String(number) && label.pagePoint?.y === 150,
  )
  if (!label) throw new Error('Missing fixture marker label')
  return label
}

describe('documentary native room schedule and circle-number links', () => {
  it('links a three-row table while preserving original number, name and area label IDs', () => {
    const input = fixture()
    const result = nativeRoomNumberScheduleLinks(input)
    expect(result.report).toEqual({
      status: 'draft',
      refusalReason: null,
      rows: [1, 2, 3].map((sourceNumber) => ({
        sourceNumber,
        name: sourceNumber === 3 ? 'Балкон' : 'Спальня',
        documentaryAreaM2: sourceNumber === 3 ? 5.5 : 12.5,
        numberLabelId: rowLabel(input, sourceNumber, 'number').id,
        nameLabelId: rowLabel(input, sourceNumber, 'name').id,
        areaLabelId: rowLabel(input, sourceNumber, 'area').id,
        markerStatus: 'linked',
        markerLabelIds: [markerLabel(input, sourceNumber).id],
      })),
      unlistedMarkerLabelIds: [],
    })
    expect(input.work.paths).toEqual([])
    expect(result.circles.cues).toHaveLength(3)
    expect(result.schedule.rows).toHaveLength(3)
  })

  it('keeps duplicate source numbers ambiguous instead of selecting the closest marker', () => {
    const input = fixture()
    const duplicate = addNativeRoomLabel(input.native.labels, '1', 850, 450)
    addCircle(input, duplicate)
    const report = nativeRoomNumberScheduleLinks(input).report
    expect(report.rows[0]).toMatchObject({
      sourceNumber: 1,
      markerStatus: 'ambiguous',
      markerLabelIds: [markerLabel(input, 1).id, duplicate.id],
    })
    expect(report.rows.slice(1).every((row) => row.markerStatus === 'linked')).toBe(true)
  })

  it('does not treat a bare label or a rectangular number box as a circle observation', () => {
    const input = numberedNativeRoomFixture()
    const report = nativeRoomNumberScheduleLinks(input).report
    expect(report.status).toBe('draft')
    expect(report.rows.map((row) => row.markerStatus)).toEqual([
      'unobserved',
      'unobserved',
      'unobserved',
    ])
    expect(report.rows.every((row) => row.markerLabelIds.length === 0)).toBe(true)
  })

  it('retains an unobserved table row when only its native circle is missing', () => {
    const input = fixture()
    input.work.curvePaths = input.work.curvePaths?.slice(0, 2)
    refreshCurveBounds(input)
    const report = nativeRoomNumberScheduleLinks(input).report
    expect(report.rows.map((row) => row.markerStatus)).toEqual(['linked', 'linked', 'unobserved'])
    expect(report.rows[2]).toMatchObject({ name: 'Балкон', documentaryAreaM2: 5.5 })
  })

  it('lists extra circled number 99 without inventing a table row or room owner', () => {
    const input = fixture()
    const extra = addNativeRoomLabel(input.native.labels, '99', 850, 450)
    addCircle(input, extra)
    const report = nativeRoomNumberScheduleLinks(input).report
    expect(report.rows.map((row) => row.sourceNumber)).toEqual([1, 2, 3])
    expect(report.unlistedMarkerLabelIds).toEqual([extra.id])
  })

  it.each(['partial-commands', 'missing-commands', 'truncated-commands'] as const)(
    'retains documentary rows without claiming marker links when %s are unavailable',
    (caseName) => {
      const input = fixture()
      if (caseName === 'partial-commands') input.work.curvePaths?.pop()
      if (caseName === 'missing-commands') delete input.work.curvePaths
      if (caseName === 'truncated-commands') input.work.curvePathsTruncated = true
      const result = nativeRoomNumberScheduleLinks(input)
      expect(result.circles.status).toBe('unresolved')
      expect(result.report.status).toBe('draft')
      expect(result.report.rows).toHaveLength(3)
      expect(result.report.rows.every((row) => row.markerStatus === 'unavailable')).toBe(true)
      expect(result.report.rows.every((row) => row.markerLabelIds.length === 0)).toBe(true)
      expect(result.report.unlistedMarkerLabelIds).toEqual([])
      expect(result.report.rows[2]).toMatchObject({ name: 'Балкон', documentaryAreaM2: 5.5 })
    },
  )

  it.each(['raster-hash', 'raster-page', 'missing-scale', 'invalid-original-pdf'] as const)(
    'holds documentary and marker evidence after %s provenance failure',
    (caseName) => {
      const input = fixture()
      if (caseName === 'raster-hash')
        input.lineworkSource = { ...input.lineworkSource, sha256: 'c'.repeat(64) }
      if (caseName === 'raster-page') input.lineworkSource = { ...input.lineworkSource, page: 2 }
      if (caseName === 'missing-scale') delete input.native.pageNormalizedScale
      if (caseName === 'invalid-original-pdf') input.native.originalPdfSha256 = 'not-a-pdf-hash'
      const result = nativeRoomNumberScheduleLinks(input)
      expect(result.report.status).toBe('unresolved')
      expect(result.report.rows).toEqual([])
      expect(result.report.unlistedMarkerLabelIds).toEqual([])
      expect(result.circles.status).toBe('unresolved')
    },
  )

  it('withholds rows and links when native text provenance is stale', () => {
    const input = fixture()
    rowLabel(input, 1, 'name').nativeIndex = 999
    const result = nativeRoomNumberScheduleLinks(input)
    expect(result.report.status).toBe('unresolved')
    expect(result.report.rows).toEqual([])
    expect(result.circles.status).toBe('unresolved')
  })

  it('does not use an unknown or incomplete table to name even valid circled numbers', () => {
    const input = fixture()
    const header = input.native.labels[1]
    if (!header) throw new Error('Missing fixture header')
    header.name = 'Стоимость'
    const result = nativeRoomNumberScheduleLinks(input)
    expect(result.circles.status).toBe('draft')
    expect(result.circles.cues).toHaveLength(3)
    expect(result.report.status).toBe('unresolved')
    expect(result.report.rows).toEqual([])
    expect(result.report.unlistedMarkerLabelIds).toEqual([])
  })

  it('does not replace source IDs with item-array slots after native label reordering', () => {
    const input = fixture()
    const expected = nativeRoomNumberScheduleLinks(input).report.rows
    input.native.labels.reverse()
    expect(nativeRoomNumberScheduleLinks(input).report.rows).toEqual(expected)
  })

  it('preserves decimal documentary area rather than inferring widths or a floor polygon', () => {
    const input = fixture()
    rowLabel(input, 3, 'area').name = '4,75'
    const result = nativeRoomNumberScheduleLinks(input)
    expect(result.report.rows[2]).toMatchObject({
      documentaryAreaM2: 4.75,
      areaLabelId: rowLabel(input, 3, 'area').id,
      markerStatus: 'linked',
    })
    expect(result).toMatchObject({
      readOnly: true,
      roomOwnershipConfirmed: false,
      closesFloorBoundary: false,
    })
    for (const field of ['reading', 'pageReview', 'footprint', 'geometry', 'floor', 'widthCm']) {
      expect(result).not.toHaveProperty(field)
      expect(result.report).not.toHaveProperty(field)
      expect(result.report.rows[2]).not.toHaveProperty(field)
    }
  })

  it('ignores injected manual identities and caller-supplied accepted rows', () => {
    const input = fixture()
    const before = nativeRoomNumberScheduleLinks(input).report
    Object.assign(input, {
      reading: { rooms: [{ sourceNumber: 99, name: 'Поддельная комната' }] },
      sourceRoles: { rooms: [99] },
      schedule: { status: 'draft', rows: [{ sourceNumber: 99, name: 'Поддельная комната' }] },
    })
    const result = nativeRoomNumberScheduleLinks(input)
    expect(result.report).toEqual(before)
    expect(result.roomOwnershipConfirmed).toBe(false)
  })

  it('returns detached documentary rows and circle evidence without mutating native source', () => {
    const input = fixture()
    const before = structuredClone(input)
    const result = nativeRoomNumberScheduleLinks(input)
    expect(input).toEqual(before)
    const row = result.report.rows[0]
    const cue = result.circles.cues[0]
    if (!row || !cue) throw new Error('Missing fixture result')
    row.name = 'Изменённое имя'
    row.markerLabelIds.push('outside-id')
    cue.pagePoint.x = 999
    const segment = cue.curve.segments[0]
    if (segment) segment.end.y = 999
    expect(input).toEqual(before)
  })

  it('links the supported 50-row boundary using fresh native captions and separate circles', () => {
    const input = numberedNativeRoomFixture()
    input.native.labels = []
    input.work.paths = []
    addNativeRoomLabel(input.native.labels, '№', 50, 20)
    addNativeRoomLabel(input.native.labels, 'Наименование', 130, 20)
    addNativeRoomLabel(input.native.labels, 'Площадь', 260, 20)
    for (let index = 0; index < 50; index++) {
      const y = 40 + index * 14
      addNativeRoomLabel(input.native.labels, String(index + 1), 50, y)
      addNativeRoomLabel(input.native.labels, index === 49 ? 'Лоджия' : 'Спальня', 130, y)
      addNativeRoomLabel(input.native.labels, index === 49 ? '3,34' : '12,5', 260, y)
    }
    for (let index = 0; index < 50; index++) {
      const label = addNativeRoomLabel(
        input.native.labels,
        String(index + 1),
        400 + (index % 5) * 100,
        50 + Math.floor(index / 5) * 60,
      )
      addCircle(input, label)
    }
    const result = nativeRoomNumberScheduleLinks(input)
    expect(result.report.status).toBe('draft')
    expect(result.report.rows).toHaveLength(50)
    expect(result.report.rows.map((row) => row.sourceNumber)).toEqual(
      Array.from({ length: 50 }, (_, index) => index + 1),
    )
    expect(result.report.rows.every((row) => row.markerStatus === 'linked')).toBe(true)
    expect(result.report.rows[49]).toMatchObject({ name: 'Лоджия', documentaryAreaM2: 3.34 })
    expect(result.roomOwnershipConfirmed).toBe(false)
    expect(result.closesFloorBoundary).toBe(false)
  })
})
