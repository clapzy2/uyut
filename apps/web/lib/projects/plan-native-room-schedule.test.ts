import { describe, expect, it } from 'vitest'
import { nativeRoomScheduleEvidence } from './plan-native-room-schedule'
import { planPageRoomInventory } from './plan-page-room-inventory'
import type { Bounds, PagePoint, PdfVectorPath } from './plan-pdf-linework'

type Input = Parameters<typeof nativeRoomScheduleEvidence>[0]
type Label = Input['native']['labels'][number]

it('uses verified native table inventory when flattened text has no readable rows', () => {
  const input = fixture()
  const page = {
    nativeTextAnchors: input.native,
    linework: input.work,
    lineworkRasterSource: input.lineworkSource,
  }
  expect(planPageRoomInventory(undefined, page)).toEqual([
    { sourceNumber: 1, name: 'Прихожая' },
    { sourceNumber: 2, name: 'Кухня' },
    { sourceNumber: 3, name: 'Спальня' },
  ])
  page.nativeTextAnchors.complete = false
  const legacyText = JSON.stringify([
    { text: 'Экспликация помещений', x: 630, y: 100, rotation: 0 },
    { text: '1 - Прихожая - 4,21 м', x: 630, y: 120, rotation: 0 },
    { text: '2 - Кухня - 12,35 м', x: 630, y: 140, rotation: 0 },
    { text: '3 - Спальня - 15,39 м', x: 630, y: 160, rotation: 0 },
  ])
  expect(planPageRoomInventory(legacyText)).toHaveLength(3)
  expect(planPageRoomInventory(legacyText, page)).toBeUndefined()
})

function addLabel(input: Input, name: string, x: number, y: number): Label {
  const index = Math.max(-1, ...input.native.labels.map((label) => label.nativeIndex ?? -1)) + 1
  const scale = input.native.pageNormalizedScale
  if (!scale) throw new Error('Missing fixture mapping')
  const label = {
    id: `native-text-${index}`,
    nativeIndex: index,
    name,
    rotation: 0,
    pagePoint: { x, y },
    point: { x: x * scale.x, y: y * scale.y },
  }
  input.native.labels.push(label)
  return label
}
function addLine(input: Input, start: PagePoint, end: PagePoint): PdfVectorPath {
  const path: PdfVectorPath = {
    operationIndex: input.work.paths.length + 10,
    subpathIndex: 0,
    paint: 'stroke',
    closed: false,
    points: [{ ...start }, { ...end }],
  }
  input.work.paths.push(path)
  return path
}
function fixture(
  options: { grid?: boolean; legacy?: boolean; count?: number; total?: boolean } = {},
): Input {
  const source = { sha256: 'a'.repeat(64), page: 6, width: 1000, height: 1000 }
  const input: Input = {
    native: {
      source,
      originalPdfSha256: 'b'.repeat(64),
      complete: true,
      pageNormalizedScale: { x: 1, y: 1 },
      labels: [],
    },
    lineworkSource: { ...source },
    work: {
      coordinateSystem: 'page-0-1000',
      pageWidth: 1000,
      pageHeight: 1000,
      paths: [],
      skippedCurves: 0,
      skippedCurveBounds: [],
      clippedPaths: 0,
      clippedPathBounds: [],
      unsupportedContexts: 0,
      unsupportedPaths: 0,
      truncated: false,
    },
  }
  const count = options.count ?? 3
  const total = options.total ?? true
  const bottom = 120 + (count + (total ? 1 : 0)) * 10
  addLabel(input, '№', 110, 105)
  if (!options.legacy) addLabel(input, 'п/п', 110, 117)
  addLabel(input, 'Наименование', 160, options.legacy ? 105 : 109)
  addLabel(input, options.legacy ? 'Площадь' : 'Площадь,', 305, 105)
  if (!options.legacy) addLabel(input, 'м²', 315, 117)
  for (let index = 0; index < count; index++) {
    addLabel(input, `${index + 1}`, 110, 125 + index * 10)
    addLabel(
      input,
      index === 0 ? 'Прихожая' : index === 1 ? 'Кухня' : 'Спальня',
      150,
      125 + index * 10,
    )
    addLabel(input, index === 0 ? '4,21' : index === 1 ? '12,35' : '15,39', 305, 125 + index * 10)
  }
  if (total) {
    addLabel(input, 'Общая площадь', 150, bottom - 5)
    addLabel(input, '74,77', 305, bottom - 5)
  }
  if (options.grid !== false) {
    for (const x of [100, 140, 300, 350]) addLine(input, { x, y: 100 }, { x, y: bottom })
    for (const y of [
      100,
      120,
      ...Array.from({ length: count + (total ? 1 : 0) }, (_, i) => 130 + i * 10),
    ])
      addLine(input, { x: 100, y }, { x: 350, y })
  }
  return input
}
function segmentedGridFixture(): Input {
  const input = fixture({ grid: false, legacy: true })
  const replacements = new Map([
    ['1', '01'],
    ['2', '02'],
    ['3', '03'],
    ['Прихожая', 'Помещение'],
    ['Кухня', 'Балкон 01'],
    ['Спальня', 'Балкон 02'],
    ['4,21', '40,13'],
    ['12,35', '4,75'],
    ['15,39', '3,34'],
    ['74,77', '48,22 м²'],
  ])
  input.native.labels = input.native.labels.filter((label) => label.name !== 'Общая площадь')
  for (const label of input.native.labels) label.name = replacements.get(label.name) ?? label.name
  const columns = [100, 140, 300, 350]
  const rows = [100, 120, 130, 140, 150, 160]
  for (let row = 0; row < rows.length - 1; row++) {
    for (const x of columns)
      addLine(input, { x, y: rows[row] as number }, { x, y: rows[row + 1] as number })
  }
  for (const y of rows) {
    for (let column = 0; column < columns.length - 1; column++)
      addLine(input, { x: columns[column] as number, y }, { x: columns[column + 1] as number, y })
  }
  return input
}
function titledScheduleFixture(): Input {
  const input = segmentedGridFixture()
  addLine(input, { x: 100, y: 90 }, { x: 100, y: 100 })
  addLine(input, { x: 350, y: 90 }, { x: 350, y: 100 })
  addLine(input, { x: 100, y: 90 }, { x: 350, y: 90 })
  addLabel(input, 'Наименование', 700, 700)
  return input
}
function labelOf(input: Input, name: string, occurrence = 0) {
  const label = input.native.labels.filter((label) => label.name === name)[occurrence]
  if (!label) throw new Error(`Missing fixture label: ${name}`)
  return label
}
function moveLabel(input: Input, label: Label, point: PagePoint) {
  const scale = input.native.pageNormalizedScale
  if (!scale) throw new Error('Missing fixture mapping')
  label.pagePoint = { ...point }
  label.point = { x: point.x * scale.x, y: point.y * scale.y }
}
function pathOf(input: Input, index: number) {
  const path = input.work.paths[index]
  if (!path) throw new Error('Missing fixture path')
  return path
}
function expectHeld(input: Input, reason?: string) {
  const before = structuredClone(input)
  const result = nativeRoomScheduleEvidence(input)
  expect(result.status).toBe('unresolved')
  expect(result.rows).toEqual([])
  expect(result.headerLabelIds).toEqual([])
  expect(result.tableBounds).toBeNull()
  expect(result.tableEdges).toEqual([])
  expect(result.layoutBasis).toBeNull()
  expect(result.roomOwnershipConfirmed).toBe(false)
  expect(result.closesFloorBoundary).toBe(false)
  if (reason) expect(result.reason).toBe(reason)
  expect(input).toEqual(before)
}

describe('native room schedule documentary evidence', () => {
  it.each([true, false])('preserves explicit subroom 3.1 in the source table, grid=%s', (grid) => {
    const input = fixture({ count: 5, grid, legacy: true })
    labelOf(input, '4').name = '3.1'
    labelOf(input, '5').name = '4'
    labelOf(input, 'Спальня', 1).name = 'Гардероб'
    const before = structuredClone(input)
    const result = nativeRoomScheduleEvidence(input)
    expect(result.status).toBe('draft')
    expect(result.rows.map((row) => row.sourceNumber)).toEqual([1, 2, 3, 3.1, 4])
    expect(result.rows[3]?.name).toBe('Гардероб')
    expect(result.rows[3]?.documentaryAreaM2).toBe(15.39)
    expect(result.roomOwnershipConfirmed).toBe(false)
    expect(result.closesFloorBoundary).toBe(false)
    expect(input).toEqual(before)
  })
  it.each(['2.1', '3.10', '03.1', '3,1', '3.0001', '3.1e0'])(
    'holds noncanonical or misplaced child %s',
    (number) => {
      const input = fixture({ count: 5 })
      labelOf(input, '4').name = number
      labelOf(input, '5').name = '4'
      expectHeld(input)
    },
  )
  it('holds duplicate children and a missing next integer instead of renumbering', () => {
    const input = fixture({ count: 5 })
    labelOf(input, '4').name = '3.1'
    labelOf(input, '5').name = '3.1'
    expectHeld(input)
    labelOf(input, '3.1').name = '5'
    expectHeld(input)
  })
  it('does not broaden the new wardrobe legend guard to arbitrary furniture text', () => {
    const input = fixture()
    labelOf(input, 'Спальня').name = 'Гардероб с зеркалом'
    expectHeld(input)
  })
  it('reads split offset headers through the exact three-column source grid', () => {
    const input = fixture()
    const before = structuredClone(input)
    const result = nativeRoomScheduleEvidence(input)
    expect(result.status).toBe('draft')
    expect(result.reason).toBeNull()
    expect(result.layoutBasis).toBe('exact-native-grid')
    expect(result.tableBounds).toEqual({ left: 100, right: 350, top: 100, bottom: 160 })
    expect(result.rows.map((row) => [row.sourceNumber, row.name, row.documentaryAreaM2])).toEqual([
      [1, 'Прихожая', 4.21],
      [2, 'Кухня', 12.35],
      [3, 'Спальня', 15.39],
    ])
    expect(result.headerLabelIds).toEqual(input.native.labels.slice(0, 5).map((label) => label.id))
    expect(result.rows[0]).toMatchObject({
      numberLabelId: 'native-text-5',
      nameLabelId: 'native-text-6',
      areaLabelId: 'native-text-7',
    })
    expect(result.tableEdges).toHaveLength(input.work.paths.length)
    expect(result.roomOwnershipConfirmed).toBe(false)
    expect(result.closesFloorBoundary).toBe(false)
    expect(input).toEqual(before)
    const edge = result.tableEdges[0]
    if (!edge) throw new Error('Missing source proof')
    edge.start.x = 999
    expect(input).toEqual(before)
  })
  it('joins exactly touching cell strokes and reads zero-padded balcony rows', () => {
    const input = segmentedGridFixture()
    const before = structuredClone(input)
    const result = nativeRoomScheduleEvidence(input)
    expect(result.status).toBe('draft')
    expect(result.layoutBasis).toBe('exact-native-grid')
    expect(result.rows.map((row) => [row.sourceNumber, row.name, row.documentaryAreaM2])).toEqual([
      [1, 'Помещение', 40.13],
      [2, 'Балкон 01', 4.75],
      [3, 'Балкон 02', 3.34],
    ])
    expect(result.tableEdges).toHaveLength(input.work.paths.length)
    expect(result.roomOwnershipConfirmed).toBe(false)
    expect(result.closesFloorBoundary).toBe(false)
    expect(input).toEqual(before)
  })
  it('reads a room grid when outer rails continue through a title band', () => {
    const input = titledScheduleFixture()
    const before = structuredClone(input)
    const result = nativeRoomScheduleEvidence(input)
    expect(result.status).toBe('draft')
    expect(result.layoutBasis).toBe('exact-native-grid')
    expect(result.tableBounds).toEqual({ left: 100, right: 350, top: 100, bottom: 160 })
    expect(result.rows.map((row) => [row.sourceNumber, row.name])).toEqual([
      [1, 'Помещение'],
      [2, 'Балкон 01'],
      [3, 'Балкон 02'],
    ])
    expect(result.roomOwnershipConfirmed).toBe(false)
    expect(result.closesFloorBoundary).toBe(false)
    expect(input).toEqual(before)
  })
  it('does not let an extended title rail conceal a broken room-grid divider', () => {
    const input = titledScheduleFixture()
    input.work.paths = input.work.paths.filter(
      (path) =>
        !(
          path.points[0]?.x === 140 &&
          path.points[0]?.y === 130 &&
          path.points[1]?.x === 140 &&
          path.points[1]?.y === 140
        ),
    )
    expectHeld(input, 'unsupported-or-ambiguous-room-table')
  })
  it('holds a missing cell boundary rather than falling back to text baselines', () => {
    const input = segmentedGridFixture()
    input.work.paths.splice(3, 1)
    expectHeld(input)
  })
  it('requires a physical grid for the generic Помещение caption', () => {
    const input = segmentedGridFixture()
    input.work.paths = []
    expectHeld(input)
  })
  it('holds an unnamed total that does not equal the printed row areas', () => {
    const input = segmentedGridFixture()
    labelOf(input, '48,22 м²').name = '48,23 м²'
    expectHeld(input)
  })
  it('preserves original strict baseline support without requiring a painted grid', () => {
    const input = fixture({ legacy: true, grid: false })
    const result = nativeRoomScheduleEvidence(input)
    expect(result.status).toBe('draft')
    expect(result.layoutBasis).toBe('strict-native-baselines')
    expect(result.rows).toHaveLength(3)
    expect(result.tableBounds).not.toBeNull()
    expect(result.tableEdges).toEqual([])
  })
  it('does not relax baseline parsing when offset headers have no grid', () =>
    expectHeld(fixture({ grid: false })))
  it('does not include a separately bounded total as a room or require its sum to match', () => {
    const input = fixture()
    labelOf(input, '74,77').name = '99,99'
    expect(nativeRoomScheduleEvidence(input).rows).toHaveLength(3)
  })
  it('can read a complete table without a total row', () => {
    const result = nativeRoomScheduleEvidence(fixture({ total: false }))
    expect(result.status).toBe('draft')
    expect(result.rows).toHaveLength(3)
  })
  it.each([3, 50])('supports %i complete room rows', (count) => {
    expect(nativeRoomScheduleEvidence(fixture({ count })).rows).toHaveLength(count)
  })
  it.each([2, 51])('holds %i room rows', (count) => expectHeld(fixture({ count })))
  it.each(['Площадь,', '№'])('holds competing %s headers anywhere on the source page', (name) => {
    const input = fixture()
    addLabel(input, name, 700, 700)
    expectHeld(input, 'unsupported-or-ambiguous-room-table')
  })
  it('scopes a repeated legend name heading through the complete source grid', () => {
    const input = fixture()
    const expected = nativeRoomScheduleEvidence(input)
    // This is the same duplicate heading found in the real Rebrina wall legend.
    addLabel(input, 'Наименование', 700, 700)
    const before = structuredClone(input)
    const result = nativeRoomScheduleEvidence(input)
    expect(result).toEqual(expected)
    expect(input).toEqual(before)
  })
  it('does not choose the first repeated name heading in extraction order', () => {
    const input = fixture()
    addLabel(input, 'Наименование', 700, 700)
    input.native.labels.reverse()
    const result = nativeRoomScheduleEvidence(input)
    expect(result.status).toBe('draft')
    expect(result.layoutBasis).toBe('exact-native-grid')
    expect(result.rows).toHaveLength(3)
  })
  it('holds repeated name headings without a complete grid', () => {
    const input = fixture({ legacy: true, grid: false })
    addLabel(input, 'Наименование', 700, 700)
    expectHeld(input, 'unsupported-or-ambiguous-room-table')
  })
  it('holds two name headings inside the actual source header cell', () => {
    const input = fixture()
    addLabel(input, 'Наименование', 180, 110)
    expectHeld(input, 'unsupported-or-ambiguous-room-table')
  })
  it('holds two complete valid schedules rather than picking one grid', () => {
    const input = fixture()
    const second = fixture()
    for (const label of second.native.labels) {
      const point = label.pagePoint as PagePoint
      addLabel(input, label.name, point.x + 400, point.y + 400)
    }
    for (const path of second.work.paths) {
      const start = path.points[0] as PagePoint
      const end = path.points[1] as PagePoint
      addLine(input, { x: start.x + 400, y: start.y + 400 }, { x: end.x + 400, y: end.y + 400 })
    }
    expectHeld(input, 'unsupported-or-ambiguous-room-table')
  })
  it('does not ignore a damaged grid when a separate legend heading exists', () => {
    const input = fixture()
    input.work.paths.splice(1, 1)
    addLabel(input, 'Наименование', 700, 700)
    expectHeld(input, 'unsupported-or-ambiguous-room-table')
  })
  it('keeps decimal source identifiers held instead of coercing them to integer rooms', () => {
    const input = fixture()
    labelOf(input, '2').name = '3.1'
    addLabel(input, 'Наименование', 700, 700)
    expectHeld(input, 'unsupported-or-ambiguous-room-table')
  })
  it.each(['Прихожая', 'Кухня', 'Спальня'])(
    'requires supported documentary name in %s row',
    (name) => {
      const input = fixture()
      labelOf(input, name).name = 'Неизвестный объект'
      expectHeld(input)
    },
  )
  it.each(['Балкон', 'Лоджия', 'Кухня-гостиная', 'Спальня 2'])(
    'accepts documentary room name %s without inferring floor',
    (name) => {
      const input = fixture()
      labelOf(input, 'Кухня').name = name
      expect(nativeRoomScheduleEvidence(input).rows[1]?.name).toBe(name)
    },
  )
  it.each(['0,00', '1', '1234,00', '-1,50', '1,234', 'NaN'])('holds area string %s', (area) => {
    const input = fixture()
    labelOf(input, '12,35').name = area
    expectHeld(input)
  })
  it.each(['12.35', '12,35 м²'])('keeps documentary area value %s', (area) => {
    const input = fixture()
    labelOf(input, '12,35').name = area
    expect(nativeRoomScheduleEvidence(input).rows[1]?.documentaryAreaM2).toBe(12.35)
  })
  it.each(['1', '4', '0', '04'])('holds skipped or duplicate middle number %s', (number) => {
    const input = fixture()
    labelOf(input, '2').name = number
    expectHeld(input)
  })
  it('preserves native label slots and IDs even when extraction order is shuffled', () => {
    const input = fixture()
    input.native.labels.reverse()
    const result = nativeRoomScheduleEvidence(input)
    expect(result.rows.map((row) => row.sourceNumber)).toEqual([1, 2, 3])
    expect(result.rows[0]?.numberLabelId).toBe('native-text-5')
  })
  it('uses actual cell containment instead of relaxing text baseline offsets', () => {
    const input = fixture()
    moveLabel(input, labelOf(input, 'Кухня'), { x: 150, y: 132 })
    expect(nativeRoomScheduleEvidence(input).rows).toHaveLength(3)
  })
  it.each(['1', 'Прихожая', '4,21'])('holds duplicate row caption %s', (name) => {
    const input = fixture()
    const label = labelOf(input, name)
    addLabel(input, name, label.pagePoint?.x ?? 0, label.pagePoint?.y ?? 0)
    expectHeld(input)
  })
  it.each(['1', 'Прихожая', '4,21'])('holds blank row cell %s', (name) => {
    const input = fixture()
    input.native.labels = input.native.labels.filter((label) => label.name !== name)
    expectHeld(input)
  })
  it('holds an extra unrelated label in a data cell', () => {
    const input = fixture()
    addLabel(input, 'Граница', 180, 135)
    expectHeld(input)
  })
  it('holds an extra blank physical row instead of silently skipping it', () => {
    const input = fixture()
    addLine(input, { x: 100, y: 155 }, { x: 350, y: 155 })
    expectHeld(input)
  })
  it('holds a total before a numbered row', () => {
    const input = fixture()
    labelOf(input, 'Кухня').name = 'Общая площадь'
    input.native.labels = input.native.labels.filter((label) => label.name !== '2')
    expectHeld(input)
  })
  it('holds an unknown non-numbered final row', () => {
    const input = fixture()
    labelOf(input, 'Общая площадь').name = 'Примечание'
    expectHeld(input)
  })
  it('holds a total that has a source number', () => {
    const input = fixture()
    addLabel(input, '4', 110, 155)
    expectHeld(input)
  })
  it('does not repair missing grid rail', () => {
    const input = fixture()
    input.work.paths.splice(1, 1)
    expectHeld(input)
  })
  it('does not repair missing horizontal separator', () => {
    const input = fixture()
    input.work.paths.splice(6, 1)
    expectHeld(input)
  })
  it.each([4, 9])('does not extend missing source closure %i', (index) => {
    const input = fixture()
    input.work.paths.splice(index, 1)
    expectHeld(input)
  })
  it('does not bridge an infinitesimal source grid gap', () => {
    const input = fixture()
    pathOf(input, 5).points[0] = { x: 100.000001, y: 120 }
    expectHeld(input)
  })
  it('does not select three columns from a competing four-column table', () => {
    const input = fixture()
    addLine(input, { x: 180, y: 100 }, { x: 180, y: 160 })
    expectHeld(input)
  })
  it('holds an undeclared cell division', () => {
    const input = fixture()
    addLine(input, { x: 200, y: 122 }, { x: 200, y: 128 })
    expectHeld(input, 'ambiguous-native-table-grid')
  })
  it('holds a diagonal stroke crossing cells', () => {
    const input = fixture()
    addLine(input, { x: 102, y: 122 }, { x: 298, y: 148 })
    expectHeld(input, 'ambiguous-native-table-grid')
  })
  it('holds a source label on the native cell separator', () => {
    const input = fixture()
    moveLabel(input, labelOf(input, 'Кухня'), { x: 140, y: 135 })
    expectHeld(input, 'ambiguous-native-table-cell')
  })
  it.each([
    { x: 100, y: 135 },
    { x: 150, y: 100 },
    { x: 150, y: 160 },
    { x: 350, y: 135 },
  ])('holds an extra caption on the outer table boundary', (point) => {
    const input = fixture()
    addLabel(input, 'Кухня', point.x, point.y)
    expectHeld(input, 'ambiguous-native-table-cell')
  })
  it('does not use compound source operations to close a grid', () => {
    const input = fixture()
    const source = pathOf(input, 0)
    input.work.paths.push({ ...structuredClone(source), subpathIndex: 1 })
    expectHeld(input)
  })
  it('does not use fill edges as native table strokes', () => {
    const input = fixture()
    pathOf(input, 0).paint = 'fill'
    expectHeld(input)
  })
  it('accepts repeated independent source paint on an existing grid rail', () => {
    const input = fixture()
    addLine(input, { x: 100, y: 100 }, { x: 100, y: 160 })
    expect(nativeRoomScheduleEvidence(input).rows).toHaveLength(3)
  })
  it('does not bypass actual grid ambiguity when strict baseline parsing succeeds', () => {
    const input = fixture({ legacy: true })
    addLabel(input, 'Примечание', 175, 135)
    expectHeld(input)
  })
  it('does not bypass a damaged grid with strict baseline parsing', () => {
    const input = fixture({ legacy: true })
    input.work.paths.splice(4, 1)
    expectHeld(input)
  })
  it('does not fall back to strict baselines when a full extra rail splits the name column', () => {
    const input = fixture({ legacy: true })
    addLine(input, { x: 180, y: 100 }, { x: 180, y: 160 })
    expectHeld(input, 'unsupported-or-ambiguous-room-table')
  })
  it('does not fall back to strict baselines when an internal full rail is missing', () => {
    const input = fixture({ legacy: true })
    input.work.paths.splice(1, 1)
    expectHeld(input, 'unsupported-or-ambiguous-room-table')
  })
  it.each([0, 3])(
    'does not fall back to strict baselines when outer rail %i is missing',
    (rail) => {
      const input = fixture({ legacy: true })
      input.work.paths.splice(rail, 1)
      expectHeld(input, 'unsupported-or-ambiguous-room-table')
    },
  )
  it('does not confuse a page border with a documentary schedule grid', () => {
    const input = fixture({ legacy: true, grid: false })
    addLine(input, { x: 50, y: 50 }, { x: 50, y: 950 })
    addLine(input, { x: 950, y: 50 }, { x: 950, y: 950 })
    addLine(input, { x: 50, y: 50 }, { x: 950, y: 50 })
    addLine(input, { x: 50, y: 950 }, { x: 950, y: 950 })
    expect(nativeRoomScheduleEvidence(input).layoutBasis).toBe('strict-native-baselines')
  })
  it.each(['м', '2', '²', 'м³'])('holds an incomplete area unit %s', (unit) => {
    const input = fixture()
    labelOf(input, 'м²').name = unit
    expectHeld(input)
  })
  it('supports a separately painted square-metre unit in the proven header cell', () => {
    const input = fixture()
    labelOf(input, 'м²').name = 'м'
    addLabel(input, '²', 325, 115)
    expect(nativeRoomScheduleEvidence(input).rows).toHaveLength(3)
  })
  it.each(['№', 'Наименование', 'м²', 'Кухня'])('holds rotated caption %s', (name) => {
    const input = fixture()
    labelOf(input, name).rotation = 90
    expectHeld(input)
  })
  it.each(['sha256', 'page', 'width'] as const)('holds changed raster %s', (key) => {
    const input = fixture()
    if (key === 'sha256') input.lineworkSource.sha256 = 'c'.repeat(64)
    else input.lineworkSource[key]++
    expectHeld(input, 'source-frame-unavailable')
  })
  it('requires the original PDF fingerprint', () => {
    const input = fixture()
    delete input.native.originalPdfSha256
    expectHeld(input, 'source-frame-unavailable')
  })
  it.each(['id', 'nativeIndex', 'pagePoint', 'point', 'rotation', 'name'] as const)(
    'holds invalid native caption %s provenance',
    (key) => {
      const input = fixture()
      const label = labelOf(input, 'Кухня')
      if (key === 'id') label.id = 'invented'
      if (key === 'nativeIndex') delete label.nativeIndex
      if (key === 'pagePoint') delete label.pagePoint
      if (key === 'point') label.point.x += 1
      if (key === 'rotation') label.rotation = Number.NaN
      if (key === 'name') label.name = ' Кухня '
      expectHeld(input, 'invalid-native-text-provenance')
    },
  )
  it('holds duplicate native text identities', () => {
    const input = fixture()
    input.native.labels.push(structuredClone(labelOf(input, 'Кухня')))
    expectHeld(input, 'invalid-native-text-provenance')
  })
  it('holds duplicate native path identities', () => {
    const input = fixture()
    input.work.paths.push(structuredClone(pathOf(input, 0)))
    expectHeld(input, 'invalid-native-provenance')
  })
  it.each(['truncated', 'unsupportedContexts', 'unsupportedPaths'] as const)(
    'holds incomplete %s geometry',
    (key) => {
      const input = fixture()
      if (key === 'truncated') input.work[key] = true
      else input.work[key] = 1
      expectHeld(input, 'incomplete-native-layer')
    },
  )
  it('holds incomplete native text', () => {
    const input = fixture()
    input.native.complete = false
    expectHeld(input, 'incomplete-native-text')
  })
  it.each(['curve', 'clip'] as const)('holds locally omitted %s geometry', (kind) => {
    const input = fixture()
    const bounds: Bounds = { left: 150, top: 125, right: 200, bottom: 126 }
    if (kind === 'curve') {
      input.work.skippedCurves = 1
      input.work.skippedCurveBounds = [{ operationIndex: 900, bounds }]
    } else {
      input.work.clippedPaths = 1
      input.work.clippedPathBounds = [{ operationIndex: 900, bounds }]
    }
    expectHeld(input, 'table-native-geometry-incomplete')
  })
  it('does not erase unrelated omitted curve metadata', () => {
    const input = fixture()
    input.work.skippedCurves = 1
    input.work.skippedCurveBounds = [
      { operationIndex: 900, bounds: { left: 700, top: 700, right: 720, bottom: 720 } },
    ]
    const before = structuredClone(input)
    expect(nativeRoomScheduleEvidence(input).rows).toHaveLength(3)
    expect(input).toEqual(before)
  })
  it('holds oversized text before reading any rows', () => {
    const input = fixture()
    for (let index = input.native.labels.length; index < 1001; index++)
      addLabel(input, 'Примечание', 800, 800)
    expectHeld(input, 'incomplete-native-text')
  })
  it('holds oversized exact-grid searches atomically', () => {
    const input = fixture()
    for (let index = 0; index < 260; index++) {
      for (const x of [100, 140, 300, 350])
        addLine(input, { x, y: 50 + index / 1000 }, { x, y: 170 + index / 1000 })
    }
    expectHeld(input, 'native-table-work-limit')
  })
})
