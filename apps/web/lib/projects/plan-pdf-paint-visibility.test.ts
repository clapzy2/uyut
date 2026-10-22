import { describe, expect, it } from 'vitest'
import {
  pdfNativeCaptionPaintVisibilityIssue,
  pdfNativePaintVisibilityIssue,
} from './plan-pdf-paint-visibility'

const names = [
  'save',
  'restore',
  'constructPath',
  'endPath',
  'stroke',
  'closeStroke',
  'fill',
  'eoFill',
  'fillStroke',
  'eoFillStroke',
  'closeFillStroke',
  'closeEOFillStroke',
  'shadingFill',
  'setGState',
  'setFillTransparent',
  'setStrokeTransparent',
  'setFillRGBColor',
  'setStrokeRGBColor',
  'beginMarkedContent',
  'beginMarkedContentProps',
  'setFillColorN',
  'setStrokeColorN',
  'endMarkedContent',
  'paintFormXObjectBegin',
  'paintFormXObjectEnd',
  'beginGroup',
  'endGroup',
  'beginAnnotation',
  'endAnnotation',
  'showText',
  'paintImageXObject',
  'setTextRenderingMode',
  'endText',
  'showSpacedText',
  'nextLineShowText',
  'nextLineSetSpacingShowText',
  'clip',
  'eoClip',
] as const
const operators = Object.fromEntries(names.map((name, index) => [name, index + 1]))
type Operation = [name: (typeof names)[number], ...args: unknown[]]
const paint = (name = 'stroke'): Operation => ['constructPath', operators[name], [[]], []]
function inspect(operations: Operation[], visible?: (props: unknown) => boolean | undefined) {
  return pdfNativePaintVisibilityIssue({
    operatorList: {
      fnArray: operations.map(([name]) => operators[name] as number),
      argsArray: operations.map(([, ...args]) => args),
    },
    operators,
    isOptionalContentVisible: visible,
  })
}

function inspectCaption(
  bounds: { left: number; top: number; right: number; bottom: number } | null,
) {
  const operations: Operation[] = [['setGState', [['ca', 0.5]]], paint('fill')]
  const operatorList = {
    fnArray: operations.map(([name]) => operators[name] as number),
    argsArray: operations.map(([, ...args]) => args),
  }
  return pdfNativeCaptionPaintVisibilityIssue({
    operatorList,
    operators,
    paintBounds: {
      complete: true,
      refusalReason: null,
      events: [{ operationIndex: 1, kind: 'vector', bounds, reason: bounds ? null : 'unknown' }],
    },
    captionPolygons: [
      [
        { x: 100, y: 100 },
        { x: 120, y: 100 },
        { x: 120, y: 120 },
        { x: 100, y: 120 },
      ],
    ],
  })
}

describe('strict native vector paint visibility', () => {
  it('keeps the page-wide refusal while allowing distant alpha only for a caption', () => {
    expect(inspect([['setGState', [['ca', 0.5]]], paint('fill')])).toBe(
      'unverified-native-vector-paint-alpha',
    )
    expect(inspectCaption({ left: 300, top: 300, right: 400, bottom: 400 })).toBeUndefined()
  })

  it('refuses alpha touching a caption or lacking a bounded paint event', () => {
    expect(inspectCaption({ left: 120, top: 110, right: 150, bottom: 140 })).toBe(
      'unverified-native-vector-paint-alpha',
    )
    expect(inspectCaption(null)).toBe('unverified-native-vector-paint-alpha')
  })

  it('refuses an incomplete alpha-paint inventory even when the known event is distant', () => {
    const operations: Operation[] = [['setGState', [['ca', 0.5]]], paint('fill')]
    expect(
      pdfNativeCaptionPaintVisibilityIssue({
        operatorList: {
          fnArray: operations.map(([name]) => operators[name] as number),
          argsArray: operations.map(([, ...args]) => args),
        },
        operators,
        paintBounds: {
          complete: false,
          refusalReason: 'incomplete-paint-envelope-operators',
          events: [
            {
              operationIndex: 1,
              kind: 'vector',
              bounds: { left: 300, top: 300, right: 400, bottom: 400 },
              reason: null,
            },
          ],
        },
        captionPolygons: [
          [
            { x: 100, y: 100 },
            { x: 120, y: 100 },
            { x: 120, y: 120 },
          ],
        ],
      }),
    ).toBe('unverified-native-vector-paint-alpha')
  })

  it('does not hide a later visibility error behind distant alpha', () => {
    const operations: Operation[] = [
      ['setGState', [['ca', 0.5]]],
      paint('fill'),
      ['setStrokeTransparent'],
      paint('stroke'),
    ]
    expect(
      pdfNativeCaptionPaintVisibilityIssue({
        operatorList: {
          fnArray: operations.map(([name]) => operators[name] as number),
          argsArray: operations.map(([, ...args]) => args),
        },
        operators,
        paintBounds: {
          complete: true,
          refusalReason: null,
          events: [
            {
              operationIndex: 1,
              kind: 'vector',
              bounds: { left: 300, top: 300, right: 400, bottom: 400 },
              reason: null,
            },
            {
              operationIndex: 3,
              kind: 'vector',
              bounds: { left: 300, top: 300, right: 400, bottom: 400 },
              reason: null,
            },
          ],
        },
        captionPolygons: [
          [
            { x: 100, y: 100 },
            { x: 120, y: 100 },
            { x: 120, y: 120 },
          ],
        ],
      }),
    ).toBe('transparent-native-vector-paint')
  })
  it.each([
    'stroke',
    'closeStroke',
    'fill',
    'eoFill',
    'fillStroke',
    'eoFillStroke',
    'closeFillStroke',
    'closeEOFillStroke',
  ])('accepts opaque packed %s', (name) => {
    expect(inspect([paint(name)])).toBeUndefined()
  })
  it('supports older deferred path paint and does not treat endPath as paint', () => {
    expect(inspect([['constructPath', [1, 2], [0, 1]], ['stroke']])).toBeUndefined()
    expect(inspect([['setStrokeTransparent'], paint('endPath')])).toBeUndefined()
  })
  it.each([
    ['setStrokeTransparent', 'stroke'],
    ['setFillTransparent', 'fill'],
    ['setStrokeTransparent', 'fillStroke'],
    ['setFillTransparent', 'fillStroke'],
  ] as const)('holds %s for relevant %s', (state, name) => {
    expect(inspect([[state], paint(name)])).toBe('transparent-native-vector-paint')
  })
  it('keeps independent fill/stroke state and restores it', () => {
    expect(inspect([['setFillTransparent'], paint('stroke')])).toBeUndefined()
    expect(inspect([['setStrokeTransparent'], paint('fill')])).toBeUndefined()
    expect(inspect([['save'], ['setStrokeTransparent'], ['restore'], paint()])).toBeUndefined()
    expect(
      inspect([['setStrokeTransparent'], ['setStrokeRGBColor', 0, 0, 0], paint()]),
    ).toBeUndefined()
  })
  it.each([
    ['CA', 'stroke'],
    ['ca', 'fill'],
  ] as const)('holds nonopaque %s', (key, name) => {
    for (const value of [0, 0.4, 0.999])
      expect(inspect([['setGState', [[key, value]]], paint(name)])).toBe(
        'unverified-native-vector-paint-alpha',
      )
    expect(inspect([['setGState', [[key, 1]]], paint(name)])).toBeUndefined()
  })
  it('allows explicit restored opacity and ordinary stroke properties', () => {
    expect(
      inspect([
        ['setGState', [['CA', 0.5]]],
        [
          'setGState',
          [
            ['CA', 1],
            ['LW', 2],
            ['D', [[], 0]],
          ],
        ],
        paint(),
      ]),
    ).toBeUndefined()
  })
  it.each([
    ['BM', 'multiply'],
    ['SMask', true],
    ['TR', [1, 2]],
  ] as const)('holds unsupported composite %s', (key, value) => {
    expect(inspect([['setGState', [[key, value]]], paint()])).toBe(
      'unsupported-native-vector-paint-composite',
    )
  })
  it('allows explicitly disabled composites', () => {
    expect(
      inspect([
        [
          'setGState',
          [
            ['BM', 'source-over'],
            ['SMask', false],
            ['TR', null],
          ],
        ],
        paint(),
      ]),
    ).toBeUndefined()
  })
  it('holds pattern paint separately for fill and stroke until a flat color reset', () => {
    expect(inspect([['setFillColorN', 'pattern'], paint('fill')])).toBe(
      'unverified-native-vector-pattern-paint',
    )
    expect(inspect([['setStrokeColorN', 'pattern'], paint()])).toBe(
      'unverified-native-vector-pattern-paint',
    )
    expect(inspect([['setFillColorN', 'pattern'], paint()])).toBeUndefined()
    expect(inspect([['setStrokeColorN', 'pattern'], paint('fill')])).toBeUndefined()
    expect(
      inspect([['setStrokeColorN', 'pattern'], ['setStrokeRGBColor', 0, 0, 0], paint()]),
    ).toBeUndefined()
    expect(
      inspect([['save'], ['setStrokeColorN', 'pattern'], ['restore'], paint()]),
    ).toBeUndefined()
    expect(inspect([['shadingFill', 'pattern']])).toBe('unverified-native-vector-pattern-paint')
  })
  it.each([NaN, Infinity, -1, 2, '1'])('holds invalid alpha %s', (value) => {
    expect(inspect([['setGState', [['CA', value]]], paint()])).toBe(
      'invalid-native-vector-graphics-state',
    )
  })
  it('holds malformed or unknown graphics state only when vectors are painted', () => {
    expect(inspect([['setGState', [['Unknown', 1]]], paint()])).toBe(
      'unsupported-native-vector-graphics-state',
    )
    expect(
      inspect([
        ['setGState', []],
        ['paintImageXObject', 'image'],
      ]),
    ).toBeUndefined()
    expect(inspect([['setGState', [['CA']]], paint()])).toBe('invalid-native-vector-graphics-state')
  })
  it('uses exactly the display visibility answer for OCG and OCMD', () => {
    for (const props of [
      { type: 'OCG', id: 'hidden' },
      { type: 'OCMD', ids: ['hidden'] },
    ]) {
      const operations: Operation[] = [
        ['beginMarkedContentProps', 'OC', props],
        paint(),
        ['endMarkedContent'],
      ]
      expect(inspect(operations, () => false)).toBe('hidden-native-vector-optional-content')
      expect(inspect(operations, () => true)).toBeUndefined()
      expect(inspect(operations)).toBe('unverified-native-vector-optional-content')
      expect(
        inspect(operations, () => {
          throw new Error('Unavailable')
        }),
      ).toBe('unverified-native-vector-optional-content')
    }
  })
  it('does not allow an inner visible layer to reveal a hidden outer layer', () => {
    expect(
      inspect(
        [
          ['beginMarkedContentProps', 'OC', false],
          ['beginMarkedContentProps', 'OC', true],
          paint(),
          ['endMarkedContent'],
          ['endMarkedContent'],
        ],
        (props) => props === true,
      ),
    ).toBe('hidden-native-vector-optional-content')
  })
  it('ignores unpainted, image-only or text-only hidden blocks, restoring visibility', () => {
    expect(
      inspect(
        [
          ['beginMarkedContentProps', 'OC', false],
          ['showText', 'text'],
          ['paintImageXObject', 'image'],
          paint('endPath'),
          ['endMarkedContent'],
          paint(),
        ],
        () => false,
      ),
    ).toBeUndefined()
  })
  it.each([
    ['paintFormXObjectBegin', 'paintFormXObjectEnd'],
    ['beginGroup', 'endGroup'],
    ['beginAnnotation', 'endAnnotation'],
  ] as const)('holds vectors within unsupported %s scope only', (begin, end) => {
    expect(inspect([[begin], paint(), [end]])).toBe('unsupported-native-vector-paint-context')
    expect(inspect([[begin], ['showText'], [end], paint()])).toBeUndefined()
  })
  it.each(
    (
      [
        [['restore'], paint()],
        [['save'], paint()],
        [['endMarkedContent'], paint()],
        [['beginMarkedContent', 'Span'], paint()],
        [['save'], ['endGroup'], paint()],
      ] satisfies Operation[][]
    ).map((operations) => ({ operations })),
  )('holds malformed vector state stacks', ({ operations }) => {
    expect(inspect(operations)).toBe('invalid-native-vector-state-stack')
  })
  it.each([
    'showText',
    'showSpacedText',
    'nextLineShowText',
    'nextLineSetSpacingShowText',
  ] as const)('holds vector coverage clipped by %s, even after a mode reset', (show) => {
    for (const mode of [4, 5, 6, 7]) {
      expect(
        inspect([
          ['setTextRenderingMode', mode],
          [show, 'nonnumeric'],
          ['endText'],
          ['setTextRenderingMode', 0],
          paint(),
        ]),
      ).toBe('unsupported-native-vector-text-clip')
      expect(
        inspect([
          ['save'],
          ['setTextRenderingMode', mode],
          [show],
          ['endText'],
          ['restore'],
          paint(),
        ]),
      ).toBeUndefined()
    }
  })
  it('does not infer text clipping just from a mode with no text paint', () => {
    expect(
      inspect([['setTextRenderingMode', 7], ['setTextRenderingMode', 0], paint()]),
    ).toBeUndefined()
    expect(
      inspect([['setTextRenderingMode', 3], ['showText', 'hidden text'], paint()]),
    ).toBeUndefined()
    expect(inspect([['setTextRenderingMode', 8], paint()])).toBe('invalid-native-vector-text-clip')
  })
  it.each(['clip', 'eoClip'] as const)(
    'leaves explicit %s to the existing source-linework clip guard',
    (clip) => {
      expect(inspect([[clip], paint()])).toBeUndefined()
      expect(inspect([['save'], [clip], ['restore'], paint()])).toBeUndefined()
    },
  )
  it('rejects unknown packed paint and operator identities', () => {
    expect(inspect([['constructPath', 999, [[]], []]])).toBe('unknown-native-vector-paint')
    expect(
      pdfNativePaintVisibilityIssue({
        operatorList: { fnArray: [999], argsArray: [[]] },
        operators,
      }),
    ).toBe('unknown-native-vector-operator')
    expect(
      pdfNativePaintVisibilityIssue({
        operatorList: { fnArray: [], argsArray: [] },
        operators: { a: 1, b: 1 },
      }),
    ).toBe('invalid-native-vector-operators')
  })
  it('bounds operations, state depth and graphics-state pairs', () => {
    expect(inspect(Array.from({ length: 100_001 }, () => ['showText']))).toBe(
      'native-vector-visibility-budget-exceeded',
    )
    expect(inspect(Array.from({ length: 1001 }, () => ['save']))).toBe(
      'native-vector-visibility-budget-exceeded',
    )
    expect(inspect(Array.from({ length: 1001 }, () => ['beginMarkedContent', 'Span']))).toBe(
      'native-vector-visibility-budget-exceeded',
    )
    expect(inspect([['setGState', Array.from({ length: 101 }, () => ['LW', 1])]])).toBe(
      'native-vector-visibility-budget-exceeded',
    )
  })
  it('never modifies source operator arguments', () => {
    const operations: Operation[] = [['save'], ['setGState', [['CA', 1]]], ['restore'], paint()]
    const before = structuredClone(operations)
    inspect(operations)
    expect(operations).toEqual(before)
  })
})
