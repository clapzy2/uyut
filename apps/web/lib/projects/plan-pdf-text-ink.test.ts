import { describe, expect, it } from 'vitest'
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
    ['setCharSpacing', [1]],
    ['setWordSpacing', [1]],
    ['setTextRenderingMode', [1]],
    ['setTextRenderingMode', [3]],
  ] as Operation[])('holds unsupported typography state %s', (name, args) => {
    const input = withOperation([name, args])
    if (name === 'setCharSpacing') (input.textItems[0] as { width: number }).width = 17
    const result = nativeNumericTextInk(input)
    expect(result.items).toHaveLength(0)
    expect(result.unresolved).toHaveLength(1)
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
