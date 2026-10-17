import { createHash } from 'node:crypto'
import { existsSync } from 'node:fs'
import { readFile } from 'node:fs/promises'
import { describe, expect, it } from 'vitest'
import { nativeHeightGroupBounds, nativeResetNoteBounds } from './plan-native-height-group'
import { pdfStandardFontDataUrl } from './plan-pdf-standard-fonts'
import { nativeNumericTextInk, type PdfTextInkFont, pdfGlyphInkBounds } from './plan-pdf-text-ink'

const OPS = {
  save: 1,
  restore: 2,
  transform: 3,
  beginText: 4,
  endText: 5,
  setFont: 6,
  setTextMatrix: 7,
  moveText: 8,
  nextLine: 9,
  setLeading: 10,
  setCharSpacing: 11,
  setWordSpacing: 12,
  setHScale: 13,
  setTextRise: 14,
  setTextRenderingMode: 15,
  showText: 16,
  clip: 17,
  constructPath: 18,
  paintFormXObjectBegin: 19,
  paintFormXObjectEnd: 20,
  setGState: 21,
  showSpacedText: 22,
  setLeadingMoveText: 23,
  setFillTransparent: 24,
  beginMarkedContentProps: 25,
  endMarkedContent: 26,
  beginAnnotation: 27,
  endAnnotation: 28,
  beginGroup: 29,
  endGroup: 30,
  setFillColorN: 31,
  endPath: 32,
  setFillRGBColor: 33,
}
type Input = Parameters<typeof nativeNumericTextInk>[0]
type Operation = [keyof typeof OPS, unknown[]?]
type Matrix = [number, number, number, number, number, number]
const glyph = (unicode: string, width = 500) => ({
  unicode,
  fontChar: unicode,
  width,
  isSpace: unicode === ' ',
  isInFont: true,
  accent: null,
})
const digitPath = [0, 0.1, 0, 1, 0.6, 0, 1, 0.6, 0.7, 1, 0.1, 0.7, 4]
const font: PdfTextInkFont = {
  fontMatrix: [0.001, 0, 0, 0.001, 0, 0],
  isType3Font: false,
  vertical: false,
  missingFile: false,
  disableFontFace: true,
}

function fixture(operations?: Operation[], textItems?: unknown[]): Input {
  const ops: Operation[] = operations ?? [
    ['setFont', ['f1', 10]],
    ['beginText'],
    ['moveText', [10, 40]],
    ['showText', [['5', '2', '5'].map((c) => glyph(c))]],
    ['endText'],
  ]
  return {
    operatorList: {
      fnArray: ops.map(([name]) => OPS[name]),
      argsArray: ops.map(([, args]) => args ?? null),
    },
    operators: OPS,
    textItems: textItems ?? [
      { str: '525', fontName: 'f1', width: 15, transform: [10, 0, 0, 10, 10, 40] },
    ],
    viewport: { width: 1000, height: 1000, convertToViewportPoint: (x, y) => [x, 1000 - y] },
    getFont: () => font,
    getGlyphPath: () => digitPath,
  }
}

function withOperation(operation: Operation): Input {
  return fixture([
    ['setFont', ['f1', 10]],
    ['beginText'],
    ['moveText', [10, 40]],
    operation,
    ['showText', [['5', '2', '5'].map((c) => glyph(c))]],
    ['endText'],
  ])
}

describe('optional complete source text paint envelopes', () => {
  function paintFixture(operations?: Operation[]) {
    return {
      ...fixture(operations, []),
      selectedTextIndexes: [],
      collectPaintBounds: true,
    }
  }

  it('preserves the default result and inventories an unselected nonnumeric show', () => {
    const input = paintFixture([
      ['setFont', ['f1', 10]],
      ['beginText'],
      ['moveText', [10, 40]],
      ['showText', [[glyph('A'), glyph('B')]]],
      ['endText'],
    ])
    const legacy = nativeNumericTextInk({ ...input, collectPaintBounds: undefined })
    expect(legacy).not.toHaveProperty('paintBounds')
    const result = nativeNumericTextInk(input)
    expect(result.items).toEqual([])
    expect(result.paintBounds).toMatchObject({
      complete: true,
      entries: [{ operationIndex: 3, reason: null }],
    })
    const bounds = result.paintBounds?.entries[0]?.bounds
    expect(bounds?.left).toBeLessThan(11)
    expect(bounds?.right).toBeGreaterThan(21)
    expect(bounds?.top).toBeLessThan(953)
    expect(bounds?.bottom).toBeGreaterThan(960)
  })

  it('does not use a glyph advance or a small FontBBox to bound a wide outline', () => {
    const input = paintFixture()
    input.getFont = () => ({ ...font, bbox: [0, 0, 1, 1] }) as PdfTextInkFont
    input.getGlyphPath = () => [0, -3, 0, 1, 4, 0, 1, 4, 2, 1, -3, 2, 4]
    const bounds = nativeNumericTextInk(input).paintBounds?.entries[0]?.bounds
    expect(bounds?.left).toBeLessThan(-20)
    expect(bounds?.right).toBeGreaterThan(60)
    expect(bounds?.top).toBeLessThan(940)
  })

  it('mechanically accounts for TJ while keeping legacy numeric acceptance held', () => {
    const input = fixture(
      [
        ['setFont', ['f1', 10]],
        ['beginText'],
        ['moveText', [10, 40]],
        ['showText', [[glyph('5'), -1000, glyph('2'), glyph('5')]]],
        ['endText'],
      ],
      [{ str: '525', fontName: 'f1', width: 25, transform: [10, 0, 0, 10, 10, 40] }],
    )
    input.collectPaintBounds = true
    const result = nativeNumericTextInk(input)
    expect(result.items).toEqual([])
    expect(result.paintBounds?.entries[0]?.reason).toBeNull()
    expect(result.paintBounds?.entries[0]?.bounds?.right).toBeGreaterThan(36)
  })

  it('retains outside-page source ink without clipping or diagnostic rounding', () => {
    const input = paintFixture([
      ['setFont', ['f1', 10]],
      ['beginText'],
      ['moveText', [-100, 1200]],
      ['showText', [[glyph('A')]]],
      ['endText'],
    ])
    const entry = nativeNumericTextInk(input).paintBounds?.entries[0]
    expect(entry?.reason).toBeNull()
    expect(entry?.bounds?.left).toBeLessThan(-99)
    expect(entry?.bounds?.bottom).toBeLessThan(0)
  })

  it('proves an empty whitespace outline rather than assuming spaces have no ink', () => {
    const input = paintFixture([
      ['setFont', ['f1', 10]],
      ['beginText'],
      ['showText', [[glyph(' ')]]],
      ['endText'],
    ])
    input.getGlyphPath = () => []
    expect(nativeNumericTextInk(input).paintBounds?.entries).toEqual([
      { operationIndex: 2, bounds: null, reason: 'empty-source-text-paint' },
    ])
    input.getGlyphPath = () => digitPath
    expect(nativeNumericTextInk(input).paintBounds?.entries[0]?.reason).toBeNull()
    input.getGlyphPath = () => undefined
    expect(nativeNumericTextInk(input).paintBounds?.entries[0]).toMatchObject({
      bounds: null,
      reason: 'native-glyph-ink-unavailable',
    })
  })

  it.each([
    'unknown-font',
    'type3-font',
    'missing-glyph',
    'stroked-text',
    'alpha',
    'pattern',
    'hidden',
  ])('keeps a %s paint as an indexed unknown bound', (mutation) => {
    const operations: Operation[] = [['setFont', ['f1', 10]], ['beginText'], ['moveText', [10, 40]]]
    if (mutation === 'stroked-text') operations.push(['setTextRenderingMode', [1]])
    if (mutation === 'alpha') operations.push(['setGState', [[['ca', 0.5]]]])
    if (mutation === 'pattern') operations.push(['setFillColorN'])
    if (mutation === 'hidden') operations.push(['beginMarkedContentProps', ['OC', {}]])
    const paintIndex = operations.length
    operations.push(['showText', [[glyph('A')]]])
    if (mutation === 'hidden') operations.push(['endMarkedContent'])
    operations.push(['endText'])
    const input = paintFixture(operations)
    if (mutation === 'unknown-font') input.getFont = () => undefined
    if (mutation === 'type3-font') input.getFont = () => ({ ...font, isType3Font: true })
    if (mutation === 'missing-glyph') input.getGlyphPath = () => undefined
    if (mutation === 'hidden') input.isOptionalContentVisible = () => false
    const result = nativeNumericTextInk(input)
    expect(result.paintBounds?.complete).toBe(true)
    expect(result.paintBounds?.entries).toHaveLength(1)
    expect(result.paintBounds?.entries[0]).toMatchObject({
      operationIndex: paintIndex,
      bounds: null,
    })
    expect(result.paintBounds?.entries[0]?.reason).not.toBeNull()
  })

  it('records unsupported show variants and holds following placement until a source reset', () => {
    const input = paintFixture([
      ['setFont', ['f1', 10]],
      ['beginText'],
      ['showSpacedText', [[glyph('A')]]],
      ['showText', [[glyph('B')]]],
      ['endText'],
    ])
    const result = nativeNumericTextInk(input)
    expect(result.paintBounds?.complete).toBe(true)
    expect(
      result.paintBounds?.entries.map((entry) => [entry.operationIndex, entry.bounds]),
    ).toEqual([
      [2, null],
      [3, null],
    ])
  })

  it('drops the entire inventory after a malformed operation or budget failure', () => {
    const input = paintFixture()
    input.operatorList.fnArray = [...Array.from(input.operatorList.fnArray), 9999]
    input.operatorList.argsArray = [...Array.from(input.operatorList.argsArray), null]
    expect(nativeNumericTextInk(input).paintBounds).toEqual({ complete: false, entries: [] })
    const oversized = paintFixture()
    oversized.operatorList.fnArray = new Array(100001).fill(OPS.save)
    oversized.operatorList.argsArray = new Array(100001).fill(null)
    expect(nativeNumericTextInk(oversized).paintBounds).toEqual({ complete: false, entries: [] })
  })

  it('fails atomically on the 1001st text paint rather than omitting later paint', () => {
    const operations: Operation[] = [['setFont', ['f1', 10]], ['beginText']]
    for (let index = 0; index < 1001; index++) operations.push(['showText', [[]]])
    operations.push(['endText'])
    expect(nativeNumericTextInk(paintFixture(operations)).paintBounds).toEqual({
      complete: false,
      entries: [],
    })
  })
})

describe('original empty whitespace glyphs in height captions', () => {
  function blankFixture() {
    const text = 'h пр.-2079мм'
    const glyphs = Array.from(text, (character) =>
      character === ' '
        ? { ...glyph(character, 400), fontChar: 'Ú', isSpace: false, isInFont: false }
        : glyph(character),
    )
    const input = fixture(
      [
        ['setFont', ['f1', 10]],
        ['beginText'],
        ['moveText', [10, 40]],
        ['showText', [glyphs]],
        ['endText'],
      ],
      [
        {
          str: text,
          fontName: 'f1',
          transform: [10, 0, 0, 10, 10, 40],
          width: glyphs.reduce((sum, row) => sum + row.width / 100, 0),
        },
      ],
    )
    input.selectedTextIndexes = [0]
    input.getGlyphPath = (_font, character) => (character === 'Ú' ? new Float32Array() : digitPath)
    return { input, glyphs }
  }

  it('uses a native empty outline as zero ink while preserving the source advance', () => {
    const { input } = blankFixture()
    const result = nativeNumericTextInk(input)
    expect(result.complete).toBe(true)
    expect(result.unresolved).toEqual([])
    expect(result.items[0]?.text).toBe('h пр.-2079мм')
    expect(result.items[0]?.baselineEnd.x).toBeCloseTo(69)
  })

  it.each([
    'missing-outline',
    'nonempty-outline',
    'non-whitespace',
    'space-flag',
    'unknown-font-membership',
    'wrong-advance',
  ])('does not treat %s as proof of an original blank', (mutation) => {
    const { input, glyphs } = blankFixture()
    const blank = glyphs[1]
    if (!blank) throw new Error('Missing blank glyph')
    if (mutation === 'missing-outline')
      input.getGlyphPath = () => {
        throw new Error('No outline')
      }
    if (mutation === 'nonempty-outline') input.getGlyphPath = () => digitPath
    if (mutation === 'non-whitespace') blank.unicode = 'X'
    if (mutation === 'space-flag') blank.isSpace = true
    if (mutation === 'unknown-font-membership') Object.assign(blank, { isInFont: undefined })
    if (mutation === 'wrong-advance') blank.width = 401
    expect(nativeNumericTextInk(input).items).toEqual([])
  })

  const realSource =
    'C:/Users/Lenovo/Documents/Codex/2026-09-26/1-pdf-1-2-pdf-3/outputs/apartment_74_77m2_full_project.pdf'
  it.skipIf(!existsSync(realSource))(
    'recovers both literal real-source caption outlines without accepting heights',
    async () => {
      const body = await readFile(realSource)
      expect(createHash('sha256').update(body).digest('hex')).toBe(
        'd79a89eba7d262f2615a9c9f99c03be4553d85c5f737423c51f98e8c9f5da1ab',
      )
      const { preparePlanPage } = await import('./plan-document')
      const page = await preparePlanPage(body, true, 6, true, true)
      const ink = page.nativeTextAnchors?.heightCaptionInk
      expect(ink?.complete).toBe(true)
      expect(ink?.unresolved).toEqual([])
      expect(
        ink?.items
          .filter((row) => [226, 230].includes(row.index))
          .map((row) => ({ index: row.index, text: row.text, operationIndex: row.operationIndex })),
      ).toEqual([
        { index: 226, text: 'h б.дв.-2281мм', operationIndex: 4029 },
        { index: 230, text: 'h пр.-2079мм', operationIndex: 4059 },
      ])
      if (!page.nativeTextAnchors || !page.linework || !page.lineworkRasterSource)
        throw new Error('Missing real source layers')
      const { nativeHeightObservations } = await import('./plan-native-height-observations')
      const observations = nativeHeightObservations({
        source: {
          sha256: createHash('sha256').update(body).digest('hex'),
          pdfPage: 6,
          state: 'existing',
        },
        native: page.nativeTextAnchors,
        work: page.linework,
        lineworkSource: page.lineworkRasterSource,
      })
      expect(observations.mayAcceptFor3D).toBe(false)
      expect(observations.assignsGeometryHeights).toBe(false)
      expect(
        observations.observations.find((row) => row.labelId === 'native-text-226')?.quantityKind,
      ).toBe('unclassified-height')
      expect(
        observations.observations.every(
          (row) => row.mayAcceptFor3D === false && row.datum === 'unspecified',
        ),
      ).toBe(true)
    },
  )
})

describe('unclipped source text envelopes under masks', () => {
  it.each(['rectangle', 'unsupported-mask'])(
    'keeps the whole unclipped glyph envelope under a %s without changing caption rejection',
    (mask) => {
      const input = fixture([
        ['setFont', ['f1', 10]],
        ['beginText'],
        ['moveText', [10, 40]],
        ['clip'],
        [
          'constructPath',
          [28, [[mask === 'rectangle' ? 0 : 99, 0, 0, 1, 100, 0, 1, 100, 30, 1, 0, 30, 4]]],
        ],
        ['showText', [['5', '2', '5'].map((character) => glyph(character))]],
        ['endText'],
      ])
      input.collectPaintBounds = true
      const result = nativeNumericTextInk(input)
      expect(result.items).toEqual([])
      expect(result.paintBounds?.entries[0]?.reason).toBeNull()
      expect(result.paintBounds?.entries[0]?.bounds?.top).toBeLessThan(953)
      expect(result.paintBounds?.entries[0]?.bounds?.bottom).toBeGreaterThan(960)
    },
  )

  it.each(['alpha', 'pattern', 'unknown-font', 'text-clip-mode'])(
    'cannot discard %s uncertainty when an unsupported mask overwrites the caption reason',
    (mutation) => {
      const operations: Operation[] = [['setFont', ['f1', 10]], ['beginText']]
      if (mutation === 'alpha') operations.push(['setGState', [[['ca', 0.5]]]])
      if (mutation === 'pattern') operations.push(['setFillColorN'])
      if (mutation === 'text-clip-mode') operations.push(['setTextRenderingMode', [4]])
      operations.push(
        ['clip'],
        ['constructPath', [28, [[99]]]],
        ['showText', [[glyph('A')]]],
        ['endText'],
      )
      const input = {
        ...fixture(operations, []),
        selectedTextIndexes: [],
        collectPaintBounds: true,
      }
      if (mutation === 'unknown-font') input.getFont = () => undefined
      const entry = nativeNumericTextInk(input).paintBounds?.entries[0]
      expect(entry?.bounds).toBeNull()
      expect(entry?.reason).not.toBe('empty-source-text-paint')
      expect(entry?.reason).not.toBeNull()
    },
  )
})

function selectedHeightFixture(): Input {
  const text = 'натяжной-2663мм'
  return {
    ...fixture(
      [
        ['setFont', ['f1', 10]],
        ['beginText'],
        ['moveText', [10, 40]],
        ['showText', [Array.from(text, (character) => glyph(character))]],
        ['endText'],
      ],
      [{ str: text, fontName: 'f1', width: text.length * 5, transform: [10, 0, 0, 10, 10, 40] }],
    ),
    selectedTextIndexes: [0],
  }
}

describe('source-contiguous grouped height shows', () => {
  function groupedFixture(extra: Operation[] = []) {
    const sourceMatrix: Matrix = [1, 0, 0, 1, 251.6095, 292.8608]
    const operations: Operation[] = [
      ['setFont', ['f1', 10]],
      ['beginText'],
      ['setTextMatrix', [new Float32Array(sourceMatrix)]],
      ['moveText', [-3.981, -11.292]],
      ['setCharSpacing', [0.1]],
      ['showText', [[glyph('H')]]],
      ...extra,
      ['setCharSpacing', [0.2]],
      ['showText', [[glyph('=')]]],
      ['setCharSpacing', [0.3]],
      ['showText', [Array.from('3790', (character) => glyph(character))]],
      ['endText'],
    ]
    const input = fixture(operations, [
      {
        str: 'H=3790',
        fontName: 'f1',
        width: 31.2,
        transform: [10, 0, 0, 10, sourceMatrix[4] - 3.981, sourceMatrix[5] - 11.292],
      },
    ])
    input.selectedTextIndexes = [0]
    return input
  }

  it('recovers one literal source line with spacing and an explicit packed-origin proof', () => {
    const input = groupedFixture()
    const result = nativeNumericTextInk(input)
    expect(result.complete).toBe(true)
    expect(result.items).toHaveLength(1)
    const item = result.items[0]
    expect(item?.sourceGroup?.operationIndexes).toEqual([5, 7, 9])
    expect(item?.sourceGroup?.shows.map((show) => show.charSpacing)).toEqual([0.1, 0.2, 0.3])
    expect(item?.sourceGroup?.shows.map((show) => show.glyphWidths)).toEqual([
      [500],
      [500],
      [500, 500, 500, 500],
    ])
    expect(item?.sourceGroup?.cursorOffset).toEqual([-3.981, -11.292])
    expect(item?.sourceGroup?.packedTextMatrixOperationIndex).toBe(2)
    expect(item?.sourceGroup?.textContentTransform).toEqual(
      (input.textItems[0] as { transform: Matrix }).transform,
    )
    // Source render origin is retained, not replaced with the unquantized item.
    expect(item?.baselineStart.x).toBe(Math.fround(251.6095) - 3.981)
    expect(item?.baselineStart.x).not.toBe(
      (input.textItems[0] as { transform: Matrix }).transform[4],
    )
  })

  it('keeps both render and source translation inside the conservative height envelope', () => {
    const input = groupedFixture()
    const item = nativeNumericTextInk(input).items[0]
    if (!item) throw new Error('Missing grouped ink')
    const raw = (input.textItems[0] as { transform: Matrix }).transform
    const label = { name: item.text, rotation: 0, pagePoint: { x: raw[4], y: 1000 - raw[5] } }
    const bounds = nativeHeightGroupBounds(item, label, { pageWidth: 1000, pageHeight: 1000 })
    expect(bounds).not.toBeNull()
    const shifted = item.quad.map((point) => ({
      x: point.x + label.pagePoint.x - item.baselineStart.x,
      y: point.y + label.pagePoint.y - item.baselineStart.y,
    }))
    for (const point of [...item.quad, ...shifted]) {
      expect(point.x).toBeGreaterThanOrEqual(Math.min(...(bounds ?? []).map((point) => point.x)))
      expect(point.x).toBeLessThanOrEqual(Math.max(...(bounds ?? []).map((point) => point.x)))
      expect(point.y).toBeGreaterThanOrEqual(Math.min(...(bounds ?? []).map((point) => point.y)))
      expect(point.y).toBeLessThanOrEqual(Math.max(...(bounds ?? []).map((point) => point.y)))
    }
  })
  it('withholds a 51-show group without discarding another complete literal caption', () => {
    const operations: Operation[] = [
      ['setFont', ['f1', 10]],
      ['beginText'],
      ['moveText', [10, 40]],
      ...Array.from({ length: 51 }, (): Operation => ['showText', [[glyph('H')]]]),
      ['endText'],
      ['beginText'],
      ['moveText', [400, 40]],
      ['showText', [Array.from('H=3790', (character) => glyph(character))]],
      ['endText'],
    ]
    const input = fixture(operations, [
      { str: 'H'.repeat(51), fontName: 'f1', width: 255, transform: [10, 0, 0, 10, 10, 40] },
      { str: 'H=3790', fontName: 'f1', width: 30, transform: [10, 0, 0, 10, 400, 40] },
    ])
    input.selectedTextIndexes = [0, 1]
    const result = nativeNumericTextInk(input)
    expect(result.refusalReason).toBeNull()
    expect(result.complete).toBe(false)
    expect(result.items.map((item) => item.index)).toEqual([1])
    expect(result.unresolved).toEqual([
      { index: 0, reason: 'native-text-show-identity-unresolved' },
    ])
  })
  it.each([
    'offset',
    'glyph-width',
    'spacing',
    'matrix',
    'operation',
    'font-size',
    'baseline',
    'source-point',
    'word-spacing',
    'rotated',
    'missing-baseline',
  ])('rejects incomplete or conflicting source-group lineage: %s', (mutation) => {
    const input = groupedFixture()
    const item = nativeNumericTextInk(input).items[0]
    const group = item?.sourceGroup
    const show = group?.shows[0]
    if (!item || !group?.cursorOffset || !group.packedTextMatrix || !show)
      throw new Error('Missing group fixture')
    const raw = (input.textItems[0] as { transform: Matrix }).transform
    const label = { name: item.text, rotation: 0, pagePoint: { x: raw[4], y: 1000 - raw[5] } }
    if (mutation === 'offset') group.cursorOffset[0] += 0.01
    if (mutation === 'glyph-width') show.glyphWidths[0] = 501
    if (mutation === 'spacing') show.charSpacing += 0.01
    if (mutation === 'matrix') group.packedTextMatrix[4] += 0.01
    if (mutation === 'operation') show.operationIndex++
    if (mutation === 'font-size') group.fontSize = 11
    if (mutation === 'baseline') item.baselineStart.x += 0.01
    if (mutation === 'source-point') label.pagePoint.x += 0.01
    if (mutation === 'word-spacing') show.wordSpacing = 1
    if (mutation === 'rotated') label.rotation = 1
    if (mutation === 'missing-baseline') Object.assign(item, { baselineStart: undefined })
    expect(nativeHeightGroupBounds(item, label, { pageWidth: 1000, pageHeight: 1000 })).toBeNull()
  })
  it.each(
    [
      ['endText'],
      ['moveText', [0, 0]],
      ['setFont', ['f1', 10]],
      ['setTextRise', [0]],
      ['setTextMatrix', [new Float32Array([1, 0, 0, 1, 252.7285, 281.5688])]],
    ].map((operation) => ({ operation: operation as Operation })),
  )('does not cross independent source state $operation', ({ operation }) => {
    expect(nativeNumericTextInk(groupedFixture([operation])).items).toEqual([])
  })

  it.each([
    'origin-cell',
    'linear-cell',
    'width',
    'unknown-glyph',
    'nonempty-missing-space',
    'duplicate-item',
  ])('holds an unproved group identity: %s', (mutation) => {
    const input = groupedFixture()
    const item = input.textItems[0] as { transform: Matrix; width: number }
    if (mutation === 'origin-cell') item.transform[4] += 0.001
    if (mutation === 'linear-cell') item.transform[0] += 0.001
    if (mutation === 'width') item.width += 0.001
    if (mutation === 'unknown-glyph') {
      const glyphs = (input.operatorList.argsArray[7] as unknown[][])[0] as ReturnType<
        typeof glyph
      >[]
      Object.assign(glyphs[0] as object, { isInFont: false })
    }
    if (mutation === 'nonempty-missing-space') {
      const glyphs = (input.operatorList.argsArray[7] as unknown[][])[0] as ReturnType<
        typeof glyph
      >[]
      Object.assign(glyphs[0] as object, { unicode: ' ', isInFont: false, isSpace: false })
    }
    if (mutation === 'duplicate-item') {
      input.textItems = [...input.textItems, structuredClone(item)]
      Object.assign(input.textItems[1] as object, { str: 'H=3790', fontName: 'f1' })
      input.selectedTextIndexes = [0, 1]
    }
    expect(nativeNumericTextInk(input).items).toEqual([])
  })

  const source = new URL(
    '../../../../output/pdf/source-search-20261003/rebrina-original.pdf',
    import.meta.url,
  )
  it.skipIf(!existsSync(source))(
    'recovers real H groups and the reset-based units and floor-reference notes',
    async () => {
      const body = await readFile(source)
      expect(createHash('sha256').update(body).digest('hex')).toBe(
        '2e141c135812c81719e1f4783173cb5202e20041ac494d3cc799eb37ad62ad4e',
      )
      const { preparePlanPage } = await import('./plan-document')
      const page = await preparePlanPage(body, true, 3, true, true)
      const numeric = page.nativeTextAnchors?.compactCaptionGeometry
      expect(numeric?.complete).toBe(true)
      expect(numeric?.items).toHaveLength(91)
      expect(
        numeric?.items.every((item) => item.inkPolygon?.length === 4 && !item.inkRefusal),
      ).toBe(true)
      expect(numeric?.items.find((item) => item.text === '1 506')?.inkSourceOperation).toBe(6526)
      const ink = page.nativeTextAnchors?.heightCaptionInk
      expect(ink?.complete).toBe(true)
      expect(ink?.items).toHaveLength(10)
      expect(ink?.unresolved).toEqual([])
      expect(ink?.items.every((item) => item.sourceGroup?.shows.length === 3)).toBe(true)
      expect(ink?.items.find((item) => item.index === 151)?.sourceGroup?.operationIndexes).toEqual([
        9183, 9185, 9187,
      ])
      const unitInk = page.nativeTextAnchors?.heightUnitInk
      expect(unitInk?.complete).toBe(true)
      expect(unitInk?.unresolved).toEqual([])
      expect(
        unitInk?.items[0]?.sourceResetCaption?.shows.map((show) => show.operationIndex),
      ).toEqual([14076, 14079, 14082])
      expect(unitInk?.items[0]?.sourceResetCaption?.generatedSpacesBefore).toEqual([2])
      const unitLabel = page.nativeTextAnchors?.labels.find((label) => label.nativeIndex === 237)
      if (!unitInk?.items[0] || !unitLabel || !page.linework)
        throw new Error('Missing real unit note')
      expect(nativeResetNoteBounds(unitInk.items[0], unitLabel, page.linework)).not.toBeNull()
      const floorInk = page.nativeTextAnchors?.heightFloorReferenceInk
      expect(floorInk?.complete).toBe(true)
      expect(floorInk?.unresolved).toEqual([])
      expect(floorInk?.items[0]?.text).toBe('1. Все отметки высот на замере даны от чистового пола')
      expect(floorInk?.items[0]?.sourceResetCaption?.generatedSpacesBefore).toEqual([2])
      const floorLabel = page.nativeTextAnchors?.labels.find((label) => label.nativeIndex === 230)
      if (!floorInk?.items[0] || !floorLabel) throw new Error('Missing real reference note')
      expect(nativeResetNoteBounds(floorInk.items[0], floorLabel, page.linework)).not.toBeNull()
      if (!page.nativeTextAnchors || !page.linework || !page.lineworkRasterSource)
        throw new Error('Missing real source layers')
      const { nativeHeightSourceLocations } = await import('./plan-native-height-locations')
      const locations = nativeHeightSourceLocations({
        source: {
          sha256: createHash('sha256').update(body).digest('hex'),
          pdfPage: 3,
          state: 'existing',
        },
        native: page.nativeTextAnchors,
        work: page.linework,
        lineworkSource: page.lineworkRasterSource,
      })
      expect(locations.refusalReason).toBeNull()
      expect(locations.observations).toHaveLength(10)
      expect(locations.observations.every((row) => row.inkSourceOperation !== null)).toBe(true)
      expect(locations.roomOwnershipConfirmed).toBe(false)
      expect(locations.mayTransfer3D).toBe(false)
    },
  )
})

describe('closed documentary notes with source resets and spacing', () => {
  function noteFixture(phrase = 'Размеры указаны в миллиметрах', extra: Operation[] = []) {
    const characters = Array.from(phrase, (character) => ({
      ...glyph(character, character === ' ' ? 400 : 500),
      isSpace: false,
    }))
    const glyphs: (ReturnType<typeof glyph> | number)[] = [
      ...characters.slice(0, 8),
      2.5,
      ...characters.slice(8),
    ]
    const width = 13 + characters.reduce((sum, character) => sum + character.width / 100, 0) - 0.025
    const operations: Operation[] = [
      ['setFont', ['f1', 10]],
      ['beginText'],
      ['setTextMatrix', [new Float32Array([1, 0, 0, 1, 100, 100])]],
      ['showText', [[glyph('5')]]],
      ['setTextMatrix', [new Float32Array([1, 0, 0, 1, 105, 100])]],
      ['showText', [[glyph('.')]]],
      ...extra,
      ['setTextMatrix', [new Float32Array([1, 0, 0, 1, 113, 100])]],
      ['showText', [glyphs]],
      ['endText'],
    ]
    const input = fixture(operations, [
      { str: `5. ${phrase}`, fontName: 'f1', width, transform: [10, 0, 0, 10, 100, 100] },
    ])
    input.selectedTextIndexes = [0]
    input.getGlyphPath = (_font, character) =>
      character === ' ' ? new Float32Array([4]) : digitPath
    return input
  }
  it.each(['Размеры указаны в миллиметрах', 'Все отметки высот на замере даны от чистового пола'])(
    'recovers only the closed source note %s with explicit generated-space and TJ evidence',
    (phrase) => {
      const input = noteFixture(phrase)
      const result = nativeNumericTextInk(input)
      expect(result.complete).toBe(true)
      expect(result.items).toHaveLength(1)
      expect(result.items[0]?.sourceGroup).toBeUndefined()
      expect(result.items[0]?.sourceResetCaption?.generatedSpacesBefore).toEqual([2])
      expect(result.items[0]?.sourceResetCaption?.shows[2]?.adjustments).toEqual([
        { glyphIndex: 8, value: 2.5 },
      ])
      const item = result.items[0]
      if (!item) throw new Error('Missing source note')
      expect(
        nativeResetNoteBounds(
          item,
          { name: `5. ${phrase}`, pagePoint: { x: 100, y: 900 }, rotation: 0 },
          { pageWidth: 1000, pageHeight: 1000 },
        ),
      ).not.toBeNull()
    },
  )
  it.each([
    'width',
    'origin',
    'empty-space-path-missing',
    'space-has-ink',
    'font-reset',
    'BT-reset',
    'large-gap',
    'line-shift',
    'unrelated-note',
  ])('withholds unproved note composition: %s', (mutation) => {
    const extra: Operation[] =
      mutation === 'font-reset'
        ? [['setFont', ['f1', 10]]]
        : mutation === 'BT-reset'
          ? [['endText'], ['beginText']]
          : []
    const input = noteFixture(
      mutation === 'unrelated-note' ? 'Любая произвольная подпись' : undefined,
      extra,
    )
    const item = input.textItems[0] as { width: number; transform: Matrix }
    if (mutation === 'width') item.width += 0.01
    if (mutation === 'origin') item.transform[4] += 0.01
    if (mutation === 'empty-space-path-missing')
      input.getGlyphPath = (_font, character) => (character === ' ' ? undefined : digitPath)
    if (mutation === 'space-has-ink') input.getGlyphPath = () => digitPath
    if (mutation === 'large-gap' || mutation === 'line-shift') {
      const packed = (input.operatorList.argsArray[6] as Float32Array[])[0]
      if (!packed) throw new Error('Missing packed reset')
      const position = mutation === 'large-gap' ? 4 : 5
      packed[position] = (packed[position] as number) + 10
    }
    // A whitespace glyph with actual ink is retained, not silently erased.
    if (mutation === 'space-has-ink') {
      expect(nativeNumericTextInk(input).items).toHaveLength(1)
    } else expect(nativeNumericTextInk(input).items).toEqual([])
  })
  it.each([
    'space-proof',
    'TJ-proof',
    'fragment-origin',
    'render-box',
    'width',
    'raw-label-origin',
    'operation',
    'missing-show',
    'oversized-show-list',
  ])('rejects conflicting serialized note proof: %s', (mutation) => {
    const item = nativeNumericTextInk(noteFixture()).items[0]
    const proof = item?.sourceResetCaption,
      fragment = proof?.shows[2]
    if (!item || !proof || !fragment?.packedOrigin || !fragment.adjustments || !fragment.quad)
      throw new Error('Missing note proof')
    const label = { name: item.text, pagePoint: { x: 100, y: 900 }, rotation: 0 }
    if (mutation === 'space-proof') proof.generatedSpacesBefore = []
    if (mutation === 'TJ-proof') fragment.adjustments = []
    if (mutation === 'fragment-origin') fragment.packedOrigin.matrix[4] += 0.01
    if (mutation === 'render-box') fragment.quad[0].x += 0.01
    if (mutation === 'width') proof.textContentWidth += 0.01
    if (mutation === 'raw-label-origin') label.pagePoint.x += 0.01
    if (mutation === 'operation') fragment.operationIndex--
    if (mutation === 'missing-show') proof.shows.splice(1, 1)
    if (mutation === 'oversized-show-list')
      proof.shows = Array.from({ length: 51 }, () => proof.shows[0] as typeof fragment)
    expect(nativeResetNoteBounds(item, label, { pageWidth: 1000, pageHeight: 1000 })).toBeNull()
  })
})

describe('explicit selected source text ink', () => {
  it('keeps the numeric default byte-identical and does not add height captions implicitly', () => {
    const numeric = fixture()
    expect(
      JSON.stringify(nativeNumericTextInk({ ...numeric, selectedTextIndexes: undefined })),
    ).toBe(JSON.stringify(nativeNumericTextInk(numeric)))
    const height = selectedHeightFixture()
    delete height.selectedTextIndexes
    expect(nativeNumericTextInk(height)).toEqual({
      complete: true,
      refusalReason: null,
      items: [],
      unresolved: [],
    })
  })

  it('retains literal height source identity, show operation and actual embedded ink', () => {
    const input = selectedHeightFixture()
    const before = JSON.stringify({ operators: input.operatorList, text: input.textItems })
    const result = nativeNumericTextInk(input)
    expect(result).toMatchObject({ complete: true, refusalReason: null, unresolved: [] })
    expect(result.items).toHaveLength(1)
    expect(result.items[0]).toMatchObject({
      index: 0,
      text: 'натяжной-2663мм',
      operationIndex: 3,
      baselineStart: { x: 10, y: 960 },
    })
    expect(result.items[0]?.quad[0]).toEqual({ x: 11, y: 960 })
    expect(JSON.stringify({ operators: input.operatorList, text: input.textItems })).toBe(before)
  })

  it('treats an explicit empty selection as an override, not the numeric default', () => {
    expect(nativeNumericTextInk({ ...fixture(), selectedTextIndexes: [] })).toEqual({
      complete: true,
      refusalReason: null,
      items: [],
      unresolved: [],
    })
  })

  it.each([
    null,
    [0, 0],
    [-1],
    [0.5],
    [1],
    [Number.NaN],
    [Number.MAX_SAFE_INTEGER + 1],
    ['0'],
    new Uint8Array([0]),
    Array(1001).fill(0),
  ])('holds invalid selection %# atomically', (selection) => {
    const input = selectedHeightFixture()
    Object.assign(input, { selectedTextIndexes: selection })
    expect(nativeNumericTextInk(input)).toEqual({
      complete: false,
      refusalReason: 'invalid-selected-text-ink-indexes',
      items: [],
      unresolved: [],
    })
  })

  it.each([{}, { str: '' }, { str: '   ' }, { str: 'a'.repeat(201) }, { str: 20 }])(
    'holds a selected item without bounded literal text %#',
    (item) => {
      const input = selectedHeightFixture()
      input.textItems = [item]
      expect(nativeNumericTextInk(input).refusalReason).toBe('invalid-selected-text-ink-indexes')
    },
  )

  it('cannot hide an unselected matching source occurrence', () => {
    const input = selectedHeightFixture()
    const shows = input.operatorList.argsArray as unknown[]
    input.operatorList.fnArray = [
      ...Array.from(input.operatorList.fnArray).slice(0, -1),
      OPS.showText,
      OPS.endText,
    ]
    input.operatorList.argsArray = [...shows.slice(0, -1), structuredClone(shows[3]), null]
    expect(nativeNumericTextInk(input)).toEqual({
      complete: false,
      refusalReason: 'unmatched-native-numeric-text-show',
      items: [],
      unresolved: [],
    })
  })

  it('does not treat a longer source show with a trailing space as the selected literal', () => {
    const input = fixture(
      [
        ['setFont', ['f1', 10]],
        ['beginText'],
        ['moveText', [10, 40]],
        ['showText', [[glyph('Н')]]],
        ['moveText', [20, 0]],
        ['showText', [[glyph('Н'), glyph(' ')]]],
        ['endText'],
      ],
      [{ str: 'Н', fontName: 'f1', width: 5, transform: [10, 0, 0, 10, 10, 40] }],
    )
    input.selectedTextIndexes = [0]
    const result = nativeNumericTextInk(input)
    expect(result.refusalReason).toBeNull()
    expect(result.items).toMatchObject([{ index: 0, text: 'Н', operationIndex: 3 }])
  })

  it('proves a selected threshold suffix across source text objects without inventing the blank', () => {
    const operations: Operation[] = [
      ['transform', [1, 0, 0, -1, 0, 1000]],
      ['setFont', ['f1', 10]],
      ['beginText'],
      ['setTextMatrix', [[1, 0, 0, -1, 10, 40]]],
      ['showText', [[glyph('=')]]],
      ['endText'],
      ['beginText'],
      ['setTextMatrix', [[1, 0, 0, -1, 15, 40]]],
      ['showText', [[glyph('4'), glyph('5')]]],
      ['endText'],
      ['beginText'],
      ['setTextMatrix', [[1, 0, 0, -1, 25, 40]]],
      ['showText', [[{ ...glyph(' '), isSpace: false }]]],
      ['moveText', [5, 0]],
      ['showText', [[glyph('м'), glyph('м')]]],
      ['endText'],
    ]
    const selected = [
      { str: '=45 мм', fontName: 'f1', width: 30, transform: [10, 0, 0, 10, 10, 960] },
    ]
    const input = fixture(operations, selected)
    input.selectedTextIndexes = [0]
    input.getGlyphPath = (_font, character) => (character === ' ' ? [4] : digitPath)
    const result = nativeNumericTextInk(input)
    expect(result.refusalReason).toBeNull()
    expect(result.unresolved).toEqual([])
    expect(result.items[0]?.sourceGroup?.operationIndexes).toEqual([4, 8, 12, 14])

    const changedPosition = structuredClone(operations)
    changedPosition[13] = ['moveText', [12, 0]]
    expect(
      nativeNumericTextInk({ ...input, operatorList: fixture(changedPosition).operatorList }).items,
    ).toEqual([])
    const interposedPaint: Operation[] = [
      ...operations.slice(0, 6),
      ['setFillColorN', [0]],
      ...operations.slice(6),
    ]
    expect(
      nativeNumericTextInk({ ...input, operatorList: fixture(interposedPaint).operatorList }).items,
    ).toEqual([])
    const changedWidth = [{ ...(selected[0] as (typeof selected)[number]), width: 31 }]
    expect(nativeNumericTextInk({ ...input, textItems: changedWidth }).items).toEqual([])
    expect(nativeNumericTextInk({ ...input, getGlyphPath: () => undefined }).items).toEqual([])
  })

  it('keeps duplicate selected text identities ambiguous rather than choosing one', () => {
    const input = selectedHeightFixture()
    input.textItems = [...input.textItems, structuredClone(input.textItems[0])]
    input.selectedTextIndexes = [0, 1]
    expect(nativeNumericTextInk(input)).toMatchObject({
      complete: false,
      refusalReason: null,
      items: [],
      unresolved: [
        { index: 0, reason: 'ambiguous-native-text-show-identity' },
        { index: 1, reason: 'ambiguous-native-text-show-identity' },
      ],
    })
  })

  it('allows repeated selected literals only when both source runs have exact distinct identities', () => {
    const input = selectedHeightFixture()
    const first = input.textItems[0] as { str: string; width: number; transform: Matrix }
    const shows = Array.from(input.operatorList.argsArray)
    input.operatorList.fnArray = [
      ...Array.from(input.operatorList.fnArray).slice(0, -1),
      OPS.showText,
      OPS.endText,
    ]
    input.operatorList.argsArray = [...shows.slice(0, -1), structuredClone(shows[3]), null]
    input.textItems = [
      first,
      { ...structuredClone(first), transform: [10, 0, 0, 10, 10 + first.width, 40] },
    ]
    input.selectedTextIndexes = [0, 1]
    const result = nativeNumericTextInk(input)
    expect(result.complete).toBe(true)
    expect(result.items.map(({ index, operationIndex }) => ({ index, operationIndex }))).toEqual([
      { index: 0, operationIndex: 3 },
      { index: 1, operationIndex: 4 },
    ])
    // A caller may not hide the second same-literal occurrence merely by
    // selecting one known item, even when both TextContent items are available.
    input.selectedTextIndexes = [0]
    expect(nativeNumericTextInk(input).refusalReason).toBe('unmatched-native-numeric-text-show')
  })

  it('does not include ordinary numeric captions when selection overrides the default', () => {
    const height = selectedHeightFixture()
    const selectedItem = structuredClone(height.textItems[0]) as {
      str: string
      fontName: string
      width: number
      transform: Matrix
    }
    selectedItem.transform[4] = 25
    const heightShow = Array.from(height.operatorList.argsArray)[3]
    const input = fixture(
      [
        ['setFont', ['f1', 10]],
        ['beginText'],
        ['moveText', [10, 40]],
        ['showText', [['5', '2', '5'].map((character) => glyph(character))]],
        ['showText', heightShow as unknown[]],
        ['endText'],
      ],
      [...fixture().textItems, selectedItem],
    )
    input.selectedTextIndexes = [1]
    const result = nativeNumericTextInk(input)
    expect(result.complete).toBe(true)
    expect(result.items.map(({ index, text }) => ({ index, text }))).toEqual([
      { index: 1, text: 'натяжной-2663мм' },
    ])
  })

  it('does not substitute approximate bounds for missing selected glyphs', () => {
    const input = selectedHeightFixture()
    input.getGlyphPath = () => undefined
    expect(nativeNumericTextInk(input)).toMatchObject({
      complete: false,
      items: [],
      unresolved: [{ index: 0, reason: 'native-glyph-ink-unavailable' }],
    })
  })

  it.each([
    ['setGState', [[['ca', 0]]]],
    ['setTextRenderingMode', [3]],
    ['setFillColorN', ['transparent-pattern']],
  ] as Operation[])('retains visibility guards for selected text: %s', (name, args) => {
    const input = selectedHeightFixture()
    input.operatorList.fnArray = [
      ...Array.from(input.operatorList.fnArray).slice(0, 3),
      OPS[name],
      ...Array.from(input.operatorList.fnArray).slice(3),
    ]
    input.operatorList.argsArray = [
      ...Array.from(input.operatorList.argsArray).slice(0, 3),
      args,
      ...Array.from(input.operatorList.argsArray).slice(3),
    ]
    const result = nativeNumericTextInk(input)
    expect(result.complete).toBe(false)
    expect(result.items).toEqual([])
    expect(result.unresolved).toHaveLength(1)
  })

  it('retains operation and glyph work budgets with explicit selection', () => {
    const input = selectedHeightFixture()
    input.operatorList.fnArray = new Array(100_001).fill(OPS.beginText)
    input.operatorList.argsArray = new Array(100_001).fill(null)
    expect(nativeNumericTextInk(input).refusalReason).toBe('text-ink-budget-exceeded')
    const glyphInput = selectedHeightFixture()
    const show = (glyphInput.operatorList.argsArray as unknown[])[3] as unknown[]
    show[0] = new Array(1001).fill(glyph('н'))
    expect(nativeNumericTextInk(glyphInput).refusalReason).toBe('text-ink-budget-exceeded')
  })
})

describe('complete numeric show identity and excluded fragment ownership', () => {
  function documentaryOwnerFixture(literal = 'S: 9,22 м') {
    const parts = literal.startsWith('S:')
      ? ['S:', ' ', '9,22', ' ', 'м']
      : ['Н ', '=', ' ', '700 ', 'мм/от ур. стяжки']
    const operations: Operation[] = []
    let x = 10
    for (const part of parts) {
      operations.push(
        ['save'],
        ['transform', [1, 0, 0, 1, 0, 0]],
        ['clip'],
        ['constructPath', [OPS.endPath, [[0, 0, 0, 1, 500, 0, 1, 500, 100, 1, 0, 100, 4]], []]],
        ['setFillRGBColor', ['#000000']],
        ['setFont', ['f1', 10]],
        ['beginText'],
        ['setTextMatrix', [new Float32Array([1, 0, 0, 1, x, 40])]],
        ['showText', [Array.from(part, (character) => glyph(character))]],
        ['endText'],
        ['restore'],
      )
      x += part.length * 5
    }
    const textItems = [
      {
        str: literal,
        fontName: 'f1',
        width: literal.length * 5,
        transform: [10, 0, 0, 10, 10, 40],
      },
    ]
    if (literal.startsWith('S:')) {
      // The same area also occurs as a separate schedule cell. That source
      // occurrence must not claim the room caption's embedded numeric show.
      operations.push(
        ['setFont', ['f1', 10]],
        ['beginText'],
        ['moveText', [100, 40]],
        ['showText', [Array.from('9,22', (character) => glyph(character))]],
        ['endText'],
      )
      textItems.push({ str: '9,22', fontName: 'f1', width: 20, transform: [10, 0, 0, 10, 100, 40] })
    }
    const input = fixture(operations, textItems)
    input.getGlyphPath = (_font, character) => (character === ' ' ? [4] : digitPath)
    return input
  }

  it.each(['S: 9,22 м', 'Н = 700 мм/от ур. стяжки'])(
    'owns excluded numeric fragments across repeated CAD graphics setup: %s',
    (literal) => {
      const result = nativeNumericTextInk(documentaryOwnerFixture(literal))
      expect(result.refusalReason).toBeNull()
      expect(result.complete).toBe(true)
      expect(result.items).toEqual([])
    },
  )

  function selectedDocumentaryHeightFixture() {
    const input = documentaryOwnerFixture('Н = 700 мм/от ур. стяжки')
    input.selectedTextIndexes = [0]
    // A small source Tm reset (not a tolerance change) distinguishes this
    // fixture from a contiguous show group; its exact advance includes it.
    for (const index of [18, 29, 40, 51]) {
      const matrix = (input.operatorList.argsArray[index] as unknown[])[0] as Float32Array
      matrix[4] = (matrix[4] as number) + 0.125
    }
    const item = input.textItems[0] as { width: number }
    item.width += 0.125
    return input
  }

  it('returns a selected documentary height with all exact CAD show references', () => {
    const input = selectedDocumentaryHeightFixture()
    const before = structuredClone(input.textItems)
    const result = nativeNumericTextInk(input)
    expect(result.refusalReason).toBeNull()
    expect(result.complete).toBe(true)
    expect(result.items).toHaveLength(1)
    const item = result.items[0]
    if (!item) throw new Error('Missing selected documentary height')
    expect(item.text).toBe('Н = 700 мм/от ур. стяжки')
    expect(item.sourceResetCaption?.shows.map((show) => show.operationIndex)).toEqual([
      8, 19, 30, 41, 52,
    ])
    expect(item.sourceResetCaption?.shows.map((show) => show.text).join('')).toBe(item.text)
    expect(item.sourceGroup).toBeUndefined()
    expect(
      nativeResetNoteBounds(
        item,
        {
          name: item.text,
          pagePoint: item.baselineStart,
          rotation: 0,
        },
        { pageWidth: input.viewport.width, pageHeight: input.viewport.height },
      ),
    ).not.toBeNull()
    expect(input.textItems).toEqual(before)
  })

  it.each(['width', 'origin', 'duplicate', 'font', 'paint', 'hidden', 'gap', 'clip'])(
    'withholds a selected CAD height after an invalid %s',
    (mutation) => {
      const input = selectedDocumentaryHeightFixture()
      const item = input.textItems[0] as { width: number; transform: Matrix }
      if (mutation === 'width') item.width += 0.01
      if (mutation === 'origin') item.transform[4] += 0.01
      if (mutation === 'duplicate') {
        input.textItems = [...input.textItems, structuredClone(item)]
        input.selectedTextIndexes = [0, 1]
      }
      if (mutation === 'font') (input.operatorList.argsArray[27] as unknown[])[0] = 'f2'
      if (mutation === 'gap') {
        const matrix = (input.operatorList.argsArray[40] as unknown[])[0] as Float32Array
        matrix[4] = (matrix[4] as number) + 20
      }
      if (mutation === 'clip')
        input.operatorList.argsArray = Array.from(input.operatorList.argsArray, (args, index) =>
          index === 36 ? [OPS.endPath, [[0, 0, 0, 1, 1, 0, 1, 1, 1, 1, 0, 1, 4]], []] : args,
        )
      if (mutation === 'paint' || mutation === 'hidden') {
        input.operatorList.fnArray = [
          ...Array.from(input.operatorList.fnArray).slice(0, 11),
          mutation === 'paint' ? OPS.constructPath : OPS.setTextRenderingMode,
          ...Array.from(input.operatorList.fnArray).slice(11),
        ]
        input.operatorList.argsArray = [
          ...Array.from(input.operatorList.argsArray).slice(0, 11),
          mutation === 'paint' ? [99, [[0, 1, 1, 1, 2, 2]], []] : [3],
          ...Array.from(input.operatorList.argsArray).slice(11),
        ]
      }
      const result = nativeNumericTextInk(input)
      expect(result.complete).toBe(false)
      expect(result.items).toEqual([])
    },
  )

  it.each(['width', 'origin', 'duplicate', 'missing', 'paint', 'hidden', 'font', 'clip'])(
    'keeps documentary numeric fragments unresolved under an invalid %s',
    (mutation) => {
      const input = documentaryOwnerFixture()
      const item = input.textItems[0] as { width: number; transform: Matrix }
      if (mutation === 'width') item.width += 0.01
      if (mutation === 'origin') item.transform[4] += 0.01
      if (mutation === 'duplicate') input.textItems = [...input.textItems, structuredClone(item)]
      if (mutation === 'missing') input.textItems = input.textItems.slice(1)
      if (mutation === 'paint') {
        input.operatorList.fnArray = [
          ...Array.from(input.operatorList.fnArray).slice(0, 11),
          OPS.constructPath,
          ...Array.from(input.operatorList.fnArray).slice(11),
        ]
        input.operatorList.argsArray = [
          ...Array.from(input.operatorList.argsArray).slice(0, 11),
          [99, [[0, 1, 1, 1, 2, 2]], []],
          ...Array.from(input.operatorList.argsArray).slice(11),
        ]
      }
      if (mutation === 'hidden') {
        input.operatorList.fnArray = [
          OPS.setTextRenderingMode,
          ...Array.from(input.operatorList.fnArray),
        ]
        input.operatorList.argsArray = [[3], ...Array.from(input.operatorList.argsArray)]
      }
      if (mutation === 'font') (input.operatorList.argsArray[27] as unknown[])[0] = 'f2'
      if (mutation === 'clip')
        input.operatorList.argsArray = Array.from(input.operatorList.argsArray, (args, index) =>
          index === 25 ? [OPS.endPath, [[0, 0, 0, 1, 1, 0, 1, 1, 1, 1, 0, 1, 4]], []] : args,
        )
      expect(nativeNumericTextInk(input).complete).toBe(false)
      expect(nativeNumericTextInk(input).items).toEqual([])
    },
  )

  const muhanovaSource = new URL(
    '../../../../output/pdf/source-search-20261016/muhanova-original.pdf',
    import.meta.url,
  )
  it.skipIf(!existsSync(muhanovaSource))(
    'keeps real split and rotated dimensions source-backed without confirming floor geometry',
    async () => {
      const body = await readFile(muhanovaSource)
      expect(createHash('sha256').update(body).digest('hex')).toBe(
        '510480920eab5103181e959c1d847c4a7f29ff88653bfd8930ead5d149141d12',
      )
      const { preparePlanPage } = await import('./plan-document')
      const page = await preparePlanPage(body, true, 4, true, true)
      const anchors = page.nativeTextAnchors
      expect(
        anchors?.compactCaptionGeometry?.items.find((item) => item.text === '2 515')
          ?.inkSourceOperations,
      ).toEqual([7554, 7556])
      expect(anchors?.compactCaptionGeometry?.items.every((item) => !item.inkRefusal)).toBe(true)
      if (!anchors || !page.linework || !page.lineworkRasterSource)
        throw new Error('Missing real PDF source layers')
      const { nativeCaptionBindings } = await import('./plan-native-caption-bindings')
      const { nativeFloorCavityCandidates } = await import('./plan-native-floor-cavities')
      const source = {
        sha256: createHash('sha256').update(body).digest('hex'),
        pdfPage: 4,
        state: 'existing' as const,
      }
      const input = {
        source,
        native: anchors,
        work: page.linework,
        lineworkSource: page.lineworkRasterSource,
      }
      const bindings = nativeCaptionBindings(input)
      expect(bindings.refusalReason).toBeNull()
      expect(bindings.candidates).toHaveLength(16)
      expect(nativeFloorCavityCandidates(input).cavities).toHaveLength(0)
    },
  )

  it.each([
    ['horizontal', [1, 0, 0, -1, 100, 100] as Matrix, [10, 0, 0, 10, 100, 900] as Matrix],
    ['rotated', [0, -1, -1, 0, 100, 100] as Matrix, [0, 10, -10, 0, 100, 900] as Matrix],
  ])('rejoins only a source-backed %s dimension split by moveText', (_name, matrix, transform) => {
    const input = fixture(
      [
        ['transform', [1, 0, 0, -1, 0, 1000]],
        ['setFont', ['f1', 10]],
        ['beginText'],
        ['setTextMatrix', [new Float32Array(matrix)]],
        ['showText', [[glyph('2'), glyph(' ')]]],
        ['moveText', [10.002, 0]],
        ['showText', [[glyph('6'), glyph('3'), glyph('0')]]],
        ['endText'],
      ],
      [{ str: '2 630', fontName: 'f1', width: 25.002, transform }],
    )
    const result = nativeNumericTextInk(input)
    expect(result.complete).toBe(true)
    expect(result.items[0]?.sourceGroup?.operationIndexes).toEqual([4, 6])

    ;(input.textItems[0] as { width: number }).width += 0.01
    expect(nativeNumericTextInk(input).complete).toBe(false)
  })

  function packedNumeric(rawText = '1\u00a0506') {
    const origin = [1, 0, 0, 1, 100.12345, 40.65432] as Matrix
    const characters = Array.from(rawText, (character) => ({ ...glyph(character), isSpace: false }))
    const input = fixture(
      [
        ['setFont', ['f1', 10]],
        ['beginText'],
        ['setCharSpacing', [0.0135]],
        ['setTextMatrix', [new Float32Array(origin)]],
        ['showText', [characters]],
        ['endText'],
      ],
      [
        {
          str: rawText.replace(/\u00a0/g, ' '),
          fontName: 'f1',
          width: characters.length * 5 + (characters.length - 1) * 0.0135,
          transform: [10, 0, 0, 10, origin[4], origin[5]],
        },
      ],
    )
    input.getGlyphPath = (_font, character) =>
      character === '\u00a0' ? new Float32Array([4]) : digitPath
    return input
  }

  it('proves original Float32 operand cells and retains explicit single-show spacing', () => {
    const input = packedNumeric('585')
    const result = nativeNumericTextInk(input)
    expect(result.complete).toBe(true)
    expect(result.items[0]?.sourceGroup?.shows[0]?.charSpacing).toBe(0.0135)
    expect(result.items[0]?.sourceGroup?.operationIndexes).toEqual([4])
    const item = input.textItems[0] as { transform: Matrix; width: number }
    item.transform[4] += 0.0001
    expect(nativeNumericTextInk(input).items).toEqual([])
  })

  it.each(['width', 'spacing', 'matrix', 'cursor'])(
    'holds altered numeric %s rather than moving its source',
    (field) => {
      const input = packedNumeric('585')
      const item = input.textItems[0] as { transform: Matrix; width: number }
      if (field === 'width') item.width += 0.001
      if (field === 'spacing') (input.operatorList.argsArray as unknown[][])[2] = [0.0145]
      if (field === 'matrix') item.transform[0] += 0.001
      if (field === 'cursor') item.transform[5] += 0.001
      expect(nativeNumericTextInk(input).complete).toBe(false)
    },
  )

  it('normalizes only a mapped empty source NBSP and keeps its advance', () => {
    const result = nativeNumericTextInk(packedNumeric())
    expect(result.complete).toBe(true)
    expect(result.items[0]?.text).toBe('1 506')
    expect(result.items[0]?.sourceGroup?.shows[0]?.rawText).toBe('1\u00a0506')
    expect(result.items[0]?.sourceGroup?.shows[0]?.glyphWidths).toEqual([500, 500, 500, 500, 500])
  })

  it.each(['outline', 'missing', 'unicode'])('refuses an unproved NBSP %s', (field) => {
    const input = packedNumeric()
    if (field === 'outline') input.getGlyphPath = () => digitPath
    if (field === 'missing') {
      const glyphs = (input.operatorList.argsArray[4] as unknown[][])[0] as ReturnType<
        typeof glyph
      >[]
      const blank = glyphs[1]
      if (!blank) throw new Error('Missing blank')
      blank.isInFont = false
    }
    if (field === 'unicode') {
      const glyphs = (input.operatorList.argsArray[4] as unknown[][])[0] as ReturnType<
        typeof glyph
      >[]
      const blank = glyphs[1]
      if (!blank) throw new Error('Missing blank')
      blank.unicode = '\u202f'
    }
    expect(nativeNumericTextInk(input).complete).toBe(false)
  })

  function ownerFixture() {
    return fixture(
      [
        ['setFont', ['f1', 10]],
        ['beginText'],
        ['moveText', [10, 40]],
        ['showText', [[glyph('H'), glyph('=')]]],
        ['showText', [[glyph('3'), glyph('6'), glyph('0')]]],
        ['endText'],
        ['beginText'],
        ['moveText', [100, 40]],
        ['showText', [[glyph('5'), glyph('8'), glyph('5')]]],
        ['endText'],
      ],
      [
        { str: 'H=360', fontName: 'f1', width: 25, transform: [10, 0, 0, 10, 10, 40] },
        { str: '585', fontName: 'f1', width: 15, transform: [10, 0, 0, 10, 100, 40] },
      ],
    )
  }

  it('excludes only uniquely complete source-owned numeric fragments', () => {
    const result = nativeNumericTextInk(ownerFixture())
    expect(result.complete).toBe(true)
    expect(result.items.map((item) => item.text)).toEqual(['585'])
  })

  it.each(['width', 'origin', 'duplicate', 'missing', 'invisible', 'separate-text-object'])(
    'does not hide an orphan under an invalid source owner: %s',
    (field) => {
      const input = ownerFixture()
      const owner = input.textItems[0] as { width: number; transform: Matrix }
      if (field === 'width') owner.width += 0.1
      if (field === 'origin') owner.transform[4] += 1
      if (field === 'duplicate') input.textItems = [...input.textItems, structuredClone(owner)]
      if (field === 'missing') input.textItems = input.textItems.slice(1)
      if (field === 'invisible') {
        input.operatorList.fnArray = [
          ...Array.from(input.operatorList.fnArray).slice(0, 3),
          OPS.setTextRenderingMode,
          ...Array.from(input.operatorList.fnArray).slice(3),
        ]
        input.operatorList.argsArray = [
          ...Array.from(input.operatorList.argsArray).slice(0, 3),
          [3],
          ...Array.from(input.operatorList.argsArray).slice(3),
        ]
      }
      if (field === 'separate-text-object') {
        input.operatorList.fnArray = [
          ...Array.from(input.operatorList.fnArray).slice(0, 4),
          OPS.endText,
          OPS.beginText,
          ...Array.from(input.operatorList.fnArray).slice(4),
        ]
        input.operatorList.argsArray = [
          ...Array.from(input.operatorList.argsArray).slice(0, 4),
          null,
          null,
          ...Array.from(input.operatorList.argsArray).slice(4),
        ]
      }
      expect(nativeNumericTextInk(input).complete).toBe(false)
      expect(nativeNumericTextInk(input).items).toEqual([])
    },
  )

  it('rejects a TextContent dimension claim on an already-owned height fragment', () => {
    const input = ownerFixture()
    input.textItems = [
      ...input.textItems,
      { str: '360', fontName: 'f1', width: 15, transform: [10, 0, 0, 10, 20, 40] },
    ]
    expect(nativeNumericTextInk(input).refusalReason).toBe('competing-native-text-show-ownership')
  })

  it('keeps an explicitly selected single H caption on the existing single-show contract', () => {
    const input = fixture(
      [
        ['setFont', ['f1', 10]],
        ['beginText'],
        ['setTextMatrix', [new Float32Array([1, 0, 0, 1, 100, 40])]],
        ['showText', [[glyph('H'), glyph('='), glyph('3'), glyph('6'), glyph('0')]]],
        ['endText'],
      ],
      [{ str: 'H=360', fontName: 'f1', width: 25, transform: [10, 0, 0, 10, 100, 40] }],
    )
    input.selectedTextIndexes = [0]
    const result = nativeNumericTextInk(input)
    expect(result.complete).toBe(true)
    expect(result.items[0]?.sourceGroup).toBeUndefined()
  })
})

describe('embedded glyph ink bounds', () => {
  it('uses the quadratic extrema instead of its control-point box', () => {
    expect(pdfGlyphInkBounds([0, 0, 0, 3, 1, 2, 2, 0, 1, 2, -1, 1, 0, -1, 4])).toEqual({
      left: 0,
      right: 2,
      bottom: -1,
      top: 1,
    })
  })

  it('uses cubic extrema and accepts typed draw buffers', () => {
    expect(
      pdfGlyphInkBounds(new Float32Array([0, 0, 0, 2, 0, 4, 2, 4, 2, 0, 1, 2, -1, 1, 0, -1, 4])),
    ).toEqual({ left: 0, right: 2, bottom: -1, top: 3 })
  })

  it('includes all glyph contours', () => {
    expect(pdfGlyphInkBounds([...digitPath, 0, 2, 2, 1, 3, 2, 1, 3, 3, 1, 2, 3, 4])).toEqual({
      left: 0.1,
      right: 3,
      bottom: 0,
      top: 3,
    })
  })

  it('does not count a move-only tail as painted ink', () => {
    expect(pdfGlyphInkBounds([...digitPath, 0, 40, 40])).toEqual(pdfGlyphInkBounds(digitPath))
  })

  it('accepts a contour closed by an exact line-to-start before another move', () => {
    const first = [0, 0, 0, 1, 1, 0, 1, 1, 1, 1, 0, 1, 1, 0, 0]
    expect(pdfGlyphInkBounds([...first, 0, 2, 2, 1, 3, 2, 1, 3, 3, 1, 2, 3, 4])).toEqual({
      left: 0,
      right: 3,
      bottom: 0,
      top: 3,
    })
  })

  it.each(
    [
      [0, 0, 0, 1, 1, 1],
      [0, 0, 0, 1, 1, 1, 4],
      [0, 0, 0, 1, 1, 1, 1, 0, 1, 1, 1, 0, 4],
      [0, 0, 0, 1, 1, 0, 1, 1, 1, 1, 0, 1, 4, 0, 0, 0, 1, 0, 1, 1, 1, 1, 1, 1, 0, 4],
    ].map((path) => ({ path })),
  )('holds unclosed, degenerate or self-cancelling fill geometry %#', ({ path }) => {
    expect(pdfGlyphInkBounds(path)).toBeUndefined()
  })

  it('holds overflowed cubic extrema instead of silently using only the endpoints', () => {
    expect(pdfGlyphInkBounds([0, 0, 0, 2, 1e200, 1, -1e200, 2, 1, 1, 1, 0, 1, 4])).toBeUndefined()
  })

  it.each(
    [
      undefined,
      [],
      [4],
      [1, 0, 0],
      [0, 1],
      [0, 0, 0, 9],
      [0, 0, 0, 1, Number.NaN, 1],
      [0, 0, 0, 4, 1, 1, 1],
      [0, 0, 0, 1, 1, 0],
      new Array(20_001).fill(0),
    ].map((raw) => ({ raw })),
  )('holds malformed, degenerate or over-budget glyph paths %#', ({ raw }) => {
    expect(pdfGlyphInkBounds(raw)).toBeUndefined()
  })
})

it('holds patterned text rather than assuming its embedded outlines paint visible ink', () => {
  const input = withOperation(['setFillColorN', ['transparent-pattern']])
  const before = structuredClone(input.operatorList)
  expect(nativeNumericTextInk(input)).toMatchObject({
    complete: false,
    items: [],
    unresolved: [{ index: 0, reason: 'unsupported-native-text-ink-pattern' }],
  })
  expect(input.operatorList).toEqual(before)
})

describe('native numeric source text ink', () => {
  it('retains original item index, source show operation and real ink without moving the baseline', () => {
    const input = fixture()
    input.textItems = [{ type: 'markedContent' }, ...input.textItems]
    const before = JSON.stringify({
      operators: input.operatorList,
      text: input.textItems,
      font,
      digitPath,
    })
    const result = nativeNumericTextInk(input)
    expect(result).toMatchObject({ complete: true, refusalReason: null, unresolved: [] })
    expect(result.items).toEqual([
      {
        index: 1,
        text: '525',
        fontName: 'f1',
        operationIndex: 3,
        quad: [
          { x: 11, y: 960 },
          { x: 26, y: 960 },
          { x: 26, y: 953 },
          { x: 11, y: 953 },
        ],
        baselineStart: { x: 10, y: 960 },
        baselineEnd: { x: 25, y: 960 },
      },
    ])
    expect(
      JSON.stringify({ operators: input.operatorList, text: input.textItems, font, digitPath }),
    ).toBe(before)
    const first = result.items[0]
    if (!first) throw new Error('Missing source ink result')
    first.quad[0].x = 0
    expect(nativeNumericTextInk(input).items[0]?.quad[0].x).toBe(11)
  })

  it.each([
    [0, [1, 0, 0, 1, 100, 100]],
    [90, [0, 1, -1, 0, 100, 100]],
    [180, [-1, 0, 0, -1, 100, 100]],
    [270, [0, -1, 1, 0, 100, 100]],
    [45, [Math.SQRT1_2, Math.SQRT1_2, -Math.SQRT1_2, Math.SQRT1_2, 100, 100]],
  ])('preserves source rotation %s° through the full matrix', (_angle, m) => {
    const transform = [...m.slice(0, 4).map((v) => v * 10), 100, 100]
    const input = fixture(
      [
        ['setFont', ['f1', 10]],
        ['beginText'],
        ['setTextMatrix', m],
        ['showText', [['5', '2', '5'].map((c) => glyph(c))]],
        ['endText'],
      ],
      [{ str: '525', fontName: 'f1', width: 15, transform }],
    )
    const result = nativeNumericTextInk(input)
    expect(result.complete).toBe(true)
    const [a = Number.NaN, b = Number.NaN, c = Number.NaN, d = Number.NaN] = m
    expect(result.items[0]?.quad[0]).toEqual({ x: 100 + a, y: 900 - b })
    expect(result.items[0]?.quad[2]?.x).toBeCloseTo(100 + a * 16 + c * 7)
    expect(result.items[0]?.quad[2]?.y).toBeCloseTo(900 - b * 16 - d * 7)
  })

  it('uses the full second matrix column for shear, not only the baseline angle', () => {
    const input = fixture(
      [
        ['setFont', ['f1', 10]],
        ['beginText'],
        ['setTextMatrix', [1, 0, 0.3, 1, 100, 100]],
        ['showText', [['5', '2', '5'].map((c) => glyph(c))]],
        ['endText'],
      ],
      [{ str: '525', fontName: 'f1', width: 15, transform: [10, 0, 3, 10, 100, 100] }],
    )
    expect(nativeNumericTextInk(input).items[0]?.quad[2]).toEqual({ x: 118.1, y: 893 })
  })

  it('does not invent ink extrema from empty local-box corners under shear', () => {
    const input = fixture(
      [
        ['setFont', ['f1', 10]],
        ['beginText'],
        ['setTextMatrix', [1, 0, 0.5, 1, 100, 100]],
        ['showText', [[glyph('5', 1000)]]],
        ['endText'],
      ],
      [{ str: '5', fontName: 'f1', width: 10, transform: [10, 0, 5, 10, 100, 100] }],
    )
    input.getGlyphPath = () => [0, 0, 0, 1, 1, 0, 1, 0, 1, 4]
    expect(nativeNumericTextInk(input).items[0]?.quad).toEqual([
      { x: 100, y: 900 },
      { x: 110, y: 900 },
      { x: 110, y: 890 },
      { x: 100, y: 890 },
    ])
  })

  it.each([
    [[0, 0, 0, 3, 1, 2, 2, 0, 1, 2, -1, 1, 0, -1, 4], 20],
    [[0, 0, 0, 2, 0, 4, 2, 4, 2, 0, 1, 2, -1, 1, 0, -1, 4], 20 * Math.SQRT2],
  ])('recomputes curve extrema after the real shear transform %#', (path, maximum) => {
    const input = fixture(
      [
        ['setFont', ['f1', 10]],
        ['beginText'],
        ['setTextMatrix', [1, 0, 0.5, 1, 100, 100]],
        ['showText', [[glyph('5', 2000)]]],
        ['endText'],
      ],
      [{ str: '5', fontName: 'f1', width: 20, transform: [10, 0, 5, 10, 100, 100] }],
    )
    input.getGlyphPath = () => path
    expect(nativeNumericTextInk(input).items[0]?.quad[1].x).toBeCloseTo(100 + maximum)
  })

  it('proves anisotropic CTM source identity while bounding actual rotated ink, not TextContent width', () => {
    const c = Math.SQRT1_2
    const transform: Matrix = [20 * c, 30 * c, -20 * c, 30 * c, 200, 300]
    const input = fixture(
      [
        ['transform', [2, 0, 0, 3, 0, 0]],
        ['setFont', ['f1', 10]],
        ['beginText'],
        ['setTextMatrix', [c, c, -c, c, 100, 100]],
        ['showText', [[glyph('5', 1000)]]],
        ['endText'],
      ],
      [{ str: '5', fontName: 'f1', width: 20, transform }],
    )
    input.getGlyphPath = () => [0, 0, 0, 1, 1, 0, 1, 0, 1, 4]
    const ink = nativeNumericTextInk(input).items[0]
    expect(ink).toBeDefined()
    if (!ink) throw new Error('Missing rotated source ink')
    const scale = Math.hypot(transform[0], transform[1])
    const ux = transform[0] / scale
    const uy = transform[1] / scale
    const along = ink.quad.map((p) => (p.x - 200) * ux + (1000 - p.y - 300) * uy)
    expect(Math.max(...along)).toBeCloseTo(scale)
    expect(Math.min(...along)).toBeCloseTo(0)
    expect(ink.baselineEnd.x).toBeCloseTo(200 + transform[0])
    expect(ink.baselineEnd.y).toBeCloseTo(700 - transform[1])
  })

  it('validates packed Float32 linear source operands without widening page-position tolerance', () => {
    const m: Matrix = [0.71987, -0.69411, 0.69411, 0.71987, 100, 100]
    const transform: Matrix = [m[0] * 10, m[1] * 10, m[2] * 10, m[3] * 10, 100, 100]
    const item = {
      str: '525',
      fontName: 'f1',
      width: 1.5 * Math.hypot(transform[0], transform[1]),
      transform,
    }
    const input = fixture(
      [
        ['setFont', ['f1', 10]],
        ['beginText'],
        ['setTextMatrix', [new Float32Array(m)]],
        ['showText', [['5', '2', '5'].map((c) => glyph(c))]],
        ['endText'],
      ],
      [item],
    )
    expect(nativeNumericTextInk(input).items).toHaveLength(1)
    item.transform[4] = 100.00001
    expect(nativeNumericTextInk(input).items).toHaveLength(0)
    item.transform[4] = 100
    item.transform[0] += 0.001
    expect(nativeNumericTextInk(input).items).toHaveLength(0)
  })

  it('tracks source CTM, HScale and rise', () => {
    const input = fixture(
      [
        ['transform', [2, 0, 0, 2, 5, 7]],
        ['setFont', ['f1', 10]],
        ['setHScale', [50]],
        ['setTextRise', [3]],
        ['beginText'],
        ['moveText', [10, 40]],
        ['showText', [['5', '2', '5'].map((c) => glyph(c))]],
        ['endText'],
      ],
      [{ str: '525', fontName: 'f1', width: 15, transform: [10, 0, 0, 20, 25, 93] }],
    )
    expect(nativeNumericTextInk(input).items[0]?.quad[2]).toEqual({ x: 41, y: 893 })
  })

  it('tracks advance between distinct source shows', () => {
    const input = fixture(
      [
        ['setFont', ['f1', 10]],
        ['beginText'],
        ['moveText', [10, 40]],
        ['showText', [[glyph('5')]]],
        ['showText', [[glyph('2')]]],
        ['endText'],
      ],
      [
        { str: '5', fontName: 'f1', width: 5, transform: [10, 0, 0, 10, 10, 40] },
        { str: '2', fontName: 'f1', width: 5, transform: [10, 0, 0, 10, 15, 40] },
      ],
    )
    expect(nativeNumericTextInk(input).items.map((i) => i.baselineStart.x)).toEqual([10, 15])
  })

  it('holds split or aggregated TextItems rather than joining runs by equal text', () => {
    const input = fixture(
      [
        ['setFont', ['f1', 10]],
        ['beginText'],
        ['moveText', [10, 40]],
        ['showText', [[glyph('5')]]],
        ['showText', [[glyph('2')]]],
        ['endText'],
      ],
      [{ str: '52', fontName: 'f1', width: 10, transform: [10, 0, 0, 10, 10, 40] }],
    )
    expect(nativeNumericTextInk(input)).toEqual({
      complete: false,
      refusalReason: 'unmatched-native-numeric-text-show',
      items: [],
      unresolved: [],
    })
  })

  it('rejects duplicate original items claiming one source show', () => {
    const input = fixture()
    input.textItems = [...input.textItems, structuredClone(input.textItems[0])]
    expect(nativeNumericTextInk(input)).toMatchObject({
      items: [],
      unresolved: [
        { index: 0, reason: 'ambiguous-native-text-show-identity' },
        { index: 1, reason: 'ambiguous-native-text-show-identity' },
      ],
    })
  })

  it('rejects duplicate shows with the same complete source identity', () => {
    const input = fixture([
      ['setFont', ['f1', 10]],
      ['beginText'],
      ['moveText', [10, 40]],
      ['showText', [['5', '2', '5'].map((c) => glyph(c))]],
      ['moveText', [0, 0]],
      ['showText', [['5', '2', '5'].map((c) => glyph(c))]],
      ['endText'],
    ])
    expect(nativeNumericTextInk(input).unresolved[0]?.reason).toBe(
      'ambiguous-native-text-show-identity',
    )
  })

  it('retains identical printed values at distinct source placements', () => {
    const input = fixture(
      [
        ['setFont', ['f1', 10]],
        ['beginText'],
        ['moveText', [10, 40]],
        ['showText', [['5', '2', '5'].map((c) => glyph(c))]],
        ['moveText', [100, 0]],
        ['showText', [['5', '2', '5'].map((c) => glyph(c))]],
        ['endText'],
      ],
      [
        { str: '525', fontName: 'f1', width: 15, transform: [10, 0, 0, 10, 10, 40] },
        { str: '525', fontName: 'f1', width: 15, transform: [10, 0, 0, 10, 110, 40] },
      ],
    )
    expect(nativeNumericTextInk(input).items).toHaveLength(2)
    input.textItems = [...input.textItems].reverse()
    expect(nativeNumericTextInk(input).items.map((i) => i.operationIndex)).toEqual([5, 3])
  })

  it('supports literal grouped spaces with known advances and no invented space ink', () => {
    const text = '1 000'
    const input = fixture(
      [
        ['setFont', ['f1', 10]],
        ['beginText'],
        ['moveText', [10, 40]],
        ['showText', [[...text].map((c) => glyph(c))]],
        ['endText'],
      ],
      [{ str: text, fontName: 'f1', width: 25, transform: [10, 0, 0, 10, 10, 40] }],
    )
    input.getGlyphPath = (_font, char) => {
      if (char === ' ') throw new Error('spaces have no ink')
      return digitPath
    }
    expect(nativeNumericTextInk(input).items[0]?.quad[1].x).toBe(36)
  })

  it.each([
    ['setWordSpacing', [1]],
    ['setTextRenderingMode', [1]],
    ['setTextRenderingMode', [3]],
  ] as Operation[])('holds unsupported typography state %s', (name, args) => {
    const input = withOperation([name, args])
    const result = nativeNumericTextInk(input)
    expect(result.items).toHaveLength(0)
    expect(result.unresolved).toHaveLength(1)
  })

  it('keeps source proof for a selected unspaced word with exact character spacing', () => {
    const text = 'порога'
    const input = fixture(
      [
        ['setFont', ['f1', 10]],
        ['beginText'],
        ['moveText', [10, 40]],
        ['setCharSpacing', [0.1]],
        ['showText', [[...text].map((character) => glyph(character))]],
        ['endText'],
      ],
      [{ str: text, fontName: 'f1', width: 30.5, transform: [10, 0, 0, 10, 10, 40] }],
    )
    input.selectedTextIndexes = [0]
    const result = nativeNumericTextInk(input)
    expect(result.complete).toBe(true)
    expect(result.items[0]?.sourceGroup?.operationIndexes).toEqual([4])
    expect(result.items[0]?.sourceGroup?.shows[0]?.charSpacing).toBe(0.1)

    const item = input.textItems[0] as { width: number }
    item.width += 0.01
    expect(nativeNumericTextInk(input).items).toEqual([])
    item.width -= 0.01
    const args = input.operatorList.argsArray as unknown[][]
    args[3] = [0.2]
    expect(nativeNumericTextInk(input).items).toEqual([])
  })

  it('does not extend the spacing exception to word spacing or embedded blanks', () => {
    const text = 'порога'
    const input = fixture(
      [
        ['setFont', ['f1', 10]],
        ['beginText'],
        ['moveText', [10, 40]],
        ['setCharSpacing', [0.1]],
        ['setWordSpacing', [1]],
        ['showText', [[...text].map((character) => glyph(character))]],
        ['endText'],
      ],
      [{ str: text, fontName: 'f1', width: 30.5, transform: [10, 0, 0, 10, 10, 40] }],
    )
    input.selectedTextIndexes = [0]
    expect(nativeNumericTextInk(input).unresolved[0]?.reason).toBe(
      'unsupported-native-text-ink-spacing',
    )

    const spaced = 'по рога'
    const withBlank = fixture(
      [
        ['setFont', ['f1', 10]],
        ['beginText'],
        ['moveText', [10, 40]],
        ['setCharSpacing', [0.1]],
        ['showText', [[...spaced].map((character) => glyph(character))]],
        ['endText'],
      ],
      [{ str: spaced, fontName: 'f1', width: 35.6, transform: [10, 0, 0, 10, 10, 40] }],
    )
    withBlank.selectedTextIndexes = [0]
    expect(nativeNumericTextInk(withBlank).unresolved[0]?.reason).toBe(
      'unsupported-native-text-ink-spacing',
    )
  })

  it('holds native TJ adjustment instead of treating its absence as straight advance', () => {
    const input = fixture(
      [
        ['setFont', ['f1', 10]],
        ['beginText'],
        ['moveText', [10, 40]],
        ['showText', [[glyph('5'), -100, glyph('2'), glyph('5')]]],
        ['endText'],
      ],
      [{ str: '525', fontName: 'f1', width: 16, transform: [10, 0, 0, 10, 10, 40] }],
    )
    expect(nativeNumericTextInk(input).unresolved[0]?.reason).toBe(
      'unsupported-native-text-ink-adjustment',
    )
  })

  it.each([
    { vertical: true },
    { isType3Font: true },
    { missingFile: true },
    { disableFontFace: false },
    { fontMatrix: [0.002, 0, 0, 0.002, 0, 0] },
  ])('does not fall back to font metrics or system fonts %#', (change) => {
    const input = fixture()
    input.getFont = () => ({ ...font, ...change })
    expect(nativeNumericTextInk(input).unresolved[0]?.reason).toBe(
      'unsupported-native-text-ink-font',
    )
  })

  it.each([
    () => undefined,
    () => {
      throw new Error('missing glyph')
    },
    () => [],
  ])('holds unavailable embedded glyph outlines %#', (callback) => {
    const input = fixture()
    input.getGlyphPath = callback
    expect(nativeNumericTextInk(input).unresolved[0]?.reason).toBe('native-glyph-ink-unavailable')
  })

  it('tracks save/restore font and text placement', () => {
    const input = fixture([
      ['setFont', ['f1', 10]],
      ['beginText'],
      ['moveText', [10, 40]],
      ['save'],
      ['setTextMatrix', [1, 0, 0, 1, 400, 400]],
      ['restore'],
      ['showText', [['5', '2', '5'].map((c) => glyph(c))]],
      ['endText'],
    ])
    expect(nativeNumericTextInk(input).items[0]?.baselineStart).toEqual({ x: 10, y: 960 })
  })

  it('tracks leading and explicit next line', () => {
    const input = fixture([
      ['setFont', ['f1', 10]],
      ['setLeading', [12]],
      ['beginText'],
      ['moveText', [10, 52]],
      ['nextLine'],
      ['showText', [['5', '2', '5'].map((c) => glyph(c))]],
      ['endText'],
    ])
    expect(nativeNumericTextInk(input).items[0]?.baselineStart).toEqual({ x: 10, y: 960 })
  })

  it('accepts a containing rectangular source clip and holds a clipped ink corner', () => {
    const path = [0, 0, 0, 1, 100, 0, 1, 100, 100, 1, 0, 100, 4]
    const input = fixture([
      ['clip'],
      ['constructPath', [28, [path], []]],
      ['setFont', ['f1', 10]],
      ['beginText'],
      ['moveText', [10, 40]],
      ['showText', [['5', '2', '5'].map((c) => glyph(c))]],
      ['endText'],
    ])
    expect(nativeNumericTextInk(input).items).toHaveLength(1)
    path[4] = 20
    path[7] = 20
    expect(nativeNumericTextInk(input).unresolved[0]?.reason).toBe('clipped-native-text-ink')
  })

  it('proves ink inside a simple orthogonal clip but not across its recess', () => {
    const path = [0, 0, 0, 1, 100, 0, 1, 100, 20, 1, 30, 20, 1, 30, 100, 1, 0, 100, 4]
    const input = fixture([
      ['clip'],
      ['constructPath', [28, [path], []]],
      ['setFont', ['f1', 10]],
      ['beginText'],
      ['moveText', [10, 40]],
      ['showText', [['5', '2', '5'].map((c) => glyph(c))]],
      ['endText'],
    ])
    expect(nativeNumericTextInk(input).items).toHaveLength(1)
    const text = input.textItems[0] as { transform: Matrix }
    text.transform[4] = 40
    const move = input.operatorList.argsArray[4] as number[]
    move[0] = 40
    expect(nativeNumericTextInk(input).unresolved[0]?.reason).toBe('clipped-native-text-ink')
  })

  it('holds a glyph quad whose corners are inside but whose edge crosses a concave recess', () => {
    const path = [
      0, 0, 0, 1, 100, 0, 1, 100, 100, 1, 18, 100, 1, 18, 30, 1, 15, 30, 1, 15, 100, 1, 0, 100, 4,
    ]
    const input = fixture([
      ['clip'],
      ['constructPath', [28, [path], []]],
      ['setFont', ['f1', 10]],
      ['beginText'],
      ['moveText', [10, 40]],
      ['showText', [['5', '2', '5'].map((c) => glyph(c))]],
      ['endText'],
    ])
    expect(nativeNumericTextInk(input).unresolved[0]?.reason).toBe('clipped-native-text-ink')
  })

  it('holds boundary-touching ink and respects a translated source clip', () => {
    const path = [0, 0, 0, 1, 100, 0, 1, 100, 100, 1, 0, 100, 4]
    const input = fixture(
      [
        ['transform', [1, 0, 0, 1, 20, 30]],
        ['clip'],
        ['constructPath', [28, [path], []]],
        ['setFont', ['f1', 10]],
        ['beginText'],
        ['moveText', [10, 40]],
        ['showText', [['5', '2', '5'].map((c) => glyph(c))]],
        ['endText'],
      ],
      [{ str: '525', fontName: 'f1', width: 15, transform: [10, 0, 0, 10, 30, 70] }],
    )
    expect(nativeNumericTextInk(input).items).toHaveLength(1)
    path[1] = 11
    path[10] = 11
    expect(nativeNumericTextInk(input).unresolved[0]?.reason).toBe('clipped-native-text-ink')
  })

  it('holds compound clip paths because their fill rule and holes are not proved', () => {
    const outer = [0, 0, 0, 1, 100, 0, 1, 100, 100, 1, 0, 100, 4]
    const hole = [0, 12, 39, 1, 22, 39, 1, 22, 48, 1, 12, 48, 4]
    const input = fixture([
      ['clip'],
      ['constructPath', [28, [outer, hole], []]],
      ['setFont', ['f1', 10]],
      ['beginText'],
      ['moveText', [10, 40]],
      ['showText', [['5', '2', '5'].map((c) => glyph(c))]],
      ['endText'],
    ])
    expect(nativeNumericTextInk(input).unresolved[0]?.reason).toBe('unsupported-text-ink-clipping')
  })

  it('holds a self-intersecting orthogonal clip', () => {
    const path = [0, 0, 0, 1, 100, 0, 1, 100, 100, 1, 50, 100, 1, 50, -10, 1, 0, -10, 4]
    const input = fixture([
      ['clip'],
      ['constructPath', [28, [path], []]],
      ['setFont', ['f1', 10]],
      ['beginText'],
      ['moveText', [10, 40]],
      ['showText', [['5', '2', '5'].map((c) => glyph(c))]],
      ['endText'],
    ])
    expect(nativeNumericTextInk(input).unresolved[0]?.reason).toBe('unsupported-text-ink-clipping')
  })

  const decoSource = new URL('../../../../tmp/pdfs/deco-art-dvushka-source.pdf', import.meta.url)
  it.skipIf(!existsSync(decoSource))(
    'checks the real DECO clip without accepting its unproved split threshold',
    async () => {
      const body = await readFile(decoSource)
      expect(createHash('sha256').update(body).digest('hex')).toBe(
        'fee92486f301e8a40886914c74b9a83ce77747c6ee14dd4ee0a666dec4a647fd',
      )
      const pdfjs = await import('pdfjs-dist/legacy/build/pdf.mjs')
      await import('pdfjs-dist/legacy/build/pdf.worker.mjs')
      const loading = pdfjs.getDocument({
        data: new Uint8Array(body),
        disableFontFace: true,
        useWorkerFetch: false,
        standardFontDataUrl: pdfStandardFontDataUrl(import.meta.url),
      })
      try {
        const document = await loading.promise
        const page = await document.getPage(3)
        const text = await page.getTextContent()
        const operatorList = await page.getOperatorList()
        const optionalContent = await document.getOptionalContentConfig({ intent: 'display' })
        const numericInventory = nativeNumericTextInk({
          operatorList,
          operators: pdfjs.OPS,
          textItems: text.items,
          viewport: page.getViewport({ scale: 1 }),
          getFont: (name) => page.commonObjs.get(name),
          getGlyphPath: (name, character) => page.commonObjs.get(`${name}_path_${character}`).path,
          isOptionalContentVisible: (properties) => optionalContent.isVisible(properties),
        })
        expect(numericInventory.refusalReason).toBeNull()
        expect(numericInventory.complete).toBe(true)
        expect(numericInventory.items).toHaveLength(69)
        expect(numericInventory.items.some((item) => item.operationIndex === 15761)).toBe(false)
        expect(numericInventory.items.some((item) => item.operationIndex === 22647)).toBe(false)
        expect(numericInventory.items.some((item) => item.operationIndex === 16157)).toBe(false)
        expect(numericInventory.items.some((item) => item.operationIndex === 16263)).toBe(false)
        const result = nativeNumericTextInk({
          operatorList,
          operators: pdfjs.OPS,
          textItems: text.items,
          selectedTextIndexes: [75],
          viewport: page.getViewport({ scale: 1 }),
          getFont: (name) => page.commonObjs.get(name),
          getGlyphPath: (name, character) => page.commonObjs.get(`${name}_path_${character}`).path,
          isOptionalContentVisible: (properties) => optionalContent.isVisible(properties),
        })
        expect(result.refusalReason).toBeNull()
        expect(result.unresolved).toEqual([])
        expect(result.items).toHaveLength(1)
        expect(result.items[0]?.text).toBe('порога')
        expect(result.items[0]?.sourceGroup?.operationIndexes).toEqual([
          result.items[0]?.operationIndex,
        ])
        expect(result.items[0]?.sourceGroup?.shows[0]?.wordSpacing).toBe(0)
        for (const index of [74, 76] as const) {
          const fragment = nativeNumericTextInk({
            operatorList,
            operators: pdfjs.OPS,
            textItems: text.items,
            selectedTextIndexes: [index],
            viewport: page.getViewport({ scale: 1 }),
            getFont: (name) => page.commonObjs.get(name),
            getGlyphPath: (name, character) =>
              page.commonObjs.get(`${name}_path_${character}`).path,
            isOptionalContentVisible: (properties) => optionalContent.isVisible(properties),
          })
          if (index === 74) {
            expect(fragment.items).toEqual([])
            expect(fragment.refusalReason).toBe('unmatched-native-numeric-text-show')
          } else {
            expect(fragment.refusalReason).toBeNull()
            expect(fragment.unresolved).toEqual([])
            expect(fragment.items[0]?.text).toBe('=45 мм')
            expect(fragment.items[0]?.sourceGroup?.operationIndexes).toEqual([
              15756, 15761, 15766, 15768,
            ])
          }
        }
      } finally {
        await loading.destroy()
      }
    },
  )

  it('holds complex clips, form contexts, alpha and text clipping without unbounded fallback', () => {
    const controls: Operation[][] = [
      [['clip'], ['constructPath', [28, [[0, 0, 0, 1, 100, 0, 1, 50, 100, 4]], []]]],
      [['setGState', [[['ca', 0.5]]]]],
      [
        ['setTextRenderingMode', [7]],
        ['setTextRenderingMode', [0]],
      ],
    ]
    for (const setup of controls) {
      const input = fixture([
        ...setup,
        ['setFont', ['f1', 10]],
        ['beginText'],
        ['moveText', [10, 40]],
        ['showText', [['5', '2', '5'].map((c) => glyph(c))]],
        ['endText'],
      ])
      expect(nativeNumericTextInk(input).items).toHaveLength(0)
    }
    const input = fixture([
      ['paintFormXObjectBegin', [null, null]],
      ['setFont', ['f1', 10]],
      ['beginText'],
      ['moveText', [10, 40]],
      ['showText', [['5', '2', '5'].map((c) => glyph(c))]],
      ['endText'],
      ['paintFormXObjectEnd'],
    ])
    expect(nativeNumericTextInk(input).unresolved[0]?.reason).toBe('unsupported-text-ink-context')
  })

  it('holds transparent text instead of reporting its font outlines as visible ink', () => {
    expect(nativeNumericTextInk(withOperation(['setFillTransparent'])).unresolved[0]?.reason).toBe(
      'transparent-native-text-ink',
    )
  })

  it.each([undefined, false, true, 'true'])(
    'uses explicit rendering configuration visibility for optional content %s',
    (visible) => {
      const input = fixture([
        ['beginMarkedContentProps', ['OC', { type: 'OCG', id: 'layer1' }]],
        ['setFont', ['f1', 10]],
        ['beginText'],
        ['moveText', [10, 40]],
        ['showText', [['5', '2', '5'].map((c) => glyph(c))]],
        ['endText'],
        ['endMarkedContent'],
      ])
      input.isOptionalContentVisible = () => visible as boolean | undefined
      const result = nativeNumericTextInk(input)
      expect(result.items).toHaveLength(visible === true ? 1 : 0)
      if (visible !== true)
        expect(result.unresolved[0]?.reason).toBe(
          visible === false
            ? 'hidden-native-text-ink-optional-content'
            : 'unverified-native-text-ink-optional-content',
        )
    },
  )

  it('keeps a hidden outer optional-content scope hidden through a visible nested scope', () => {
    const input = fixture([
      ['beginMarkedContentProps', ['OC', { id: 'outer' }]],
      ['beginMarkedContentProps', ['OC', { id: 'inner' }]],
      ['setFont', ['f1', 10]],
      ['beginText'],
      ['moveText', [10, 40]],
      ['showText', [['5', '2', '5'].map((c) => glyph(c))]],
      ['endText'],
      ['endMarkedContent'],
      ['endMarkedContent'],
    ])
    input.isOptionalContentVisible = (properties) => (properties as { id: string }).id === 'inner'
    expect(nativeNumericTextInk(input).unresolved[0]?.reason).toBe(
      'hidden-native-text-ink-optional-content',
    )
  })

  it('holds annotation contexts rather than silently ignoring their clip and graphics reset', () => {
    const input = fixture([
      ['beginAnnotation', ['ann', [0, 0, 20, 100], [1, 0, 0, 1, 0, 0], [1, 0, 0, 1, 0, 0], false]],
      ['setFont', ['f1', 10]],
      ['beginText'],
      ['moveText', [10, 40]],
      ['showText', [['5', '2', '5'].map((c) => glyph(c))]],
      ['endText'],
      ['endAnnotation'],
    ])
    expect(nativeNumericTextInk(input)).toEqual({
      complete: false,
      refusalReason: 'unsupported-text-ink-context',
      items: [],
      unresolved: [],
    })
  })

  it('caps all save-like contexts and graphics-state inventories atomically', () => {
    for (const name of ['save', 'paintFormXObjectBegin', 'beginGroup'] as const) {
      const input = fixture(new Array(1001).fill([name]))
      expect(nativeNumericTextInk(input).refusalReason).toBe('text-ink-budget-exceeded')
    }
    expect(
      nativeNumericTextInk(fixture([['setGState', [new Array(101).fill(['LW', 1])]]]))
        .refusalReason,
    ).toBe('text-ink-budget-exceeded')
    expect(
      nativeNumericTextInk(fixture(new Array(1001).fill(['beginMarkedContentProps', ['OC', {}]])))
        .refusalReason,
    ).toBe('text-ink-budget-exceeded')
  })

  it('refuses incomplete operator/state inventories atomically', () => {
    const input = fixture()
    input.operatorList.argsArray = [...Array.from(input.operatorList.argsArray)].slice(1)
    expect(nativeNumericTextInk(input)).toMatchObject({
      complete: false,
      items: [],
      unresolved: [],
    })
    expect(nativeNumericTextInk(fixture([['restore']])).refusalReason).toBe(
      'invalid-text-ink-state-stack',
    )
    expect(nativeNumericTextInk(fixture([['save']])).refusalReason).toBe(
      'invalid-text-ink-state-stack',
    )
    expect(nativeNumericTextInk(fixture([['beginText']])).refusalReason).toBe(
      'invalid-text-ink-state-stack',
    )
  })

  it('does not accept oversized source inventories partially', () => {
    const input = fixture()
    input.textItems = new Array(1001).fill(input.textItems[0])
    expect(nativeNumericTextInk(input)).toEqual({
      complete: false,
      refusalReason: 'text-ink-budget-exceeded',
      items: [],
      unresolved: [],
    })
  })
})
