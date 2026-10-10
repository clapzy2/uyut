import { describe, expect, it } from 'vitest'
import { nativeHeightObservations } from './plan-native-height-observations'

type Input = Parameters<typeof nativeHeightObservations>[0]

function fixture(texts: string[] = ['натяжной-2684мм']): Input {
  const image = { sha256: 'a'.repeat(64), page: 6, width: 1000, height: 1000 }
  return {
    source: { sha256: 'b'.repeat(64), pdfPage: 6, state: 'existing' },
    native: {
      source: image,
      originalPdfSha256: 'b'.repeat(64),
      complete: true,
      pageNormalizedScale: { x: 1, y: 1 },
      labels: texts.map((name, index) => ({
        id: `native-text-${index}`,
        nativeIndex: index,
        name,
        rotation: 0,
        point: { x: 100, y: 100 + index / 10 },
        pagePoint: { x: 100, y: 100 + index / 10 },
      })),
    },
    lineworkSource: { ...image },
    work: {
      coordinateSystem: 'page-0-1000',
      pageWidth: 842,
      pageHeight: 1191,
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
}
function labelOf(input: Input) {
  const label = input.native.labels[0]
  if (!label) throw new Error('Missing source label')
  return label
}
function expectHeld(input: Input, reason: string) {
  const before = structuredClone(input)
  const result = nativeHeightObservations(input)
  expect(result.status).toBe('unresolved')
  expect(result.refusalReason).toBe(reason)
  expect(result.observations).toEqual([])
  expect(result.issues).toEqual([])
  expect(input).toEqual(before)
  expect(result.mayAcceptFor3D).toBe(false)
}

describe('literal source height observation inventory, never vertical model transfer', () => {
  it.each([
    'Потолки в квартире отсчитываются от уровня пола.',
    'Потолочные размеры в квартире от уровня пола кроме ванной.',
    'Пото\u200bлок в квартире от уровня пола.',
  ])(
    'keeps unsupported apartment ceiling reference text in the diagnostic parent inventory: %s',
    (text) => {
      const result = nativeHeightObservations(fixture([text]))
      expect(result.observations).toEqual([])
      expect(result.issues).toEqual([
        { labelId: 'native-text-0', originalText: text, code: 'no-literal-unit-qualified-height' },
      ])
    },
  )
  it.each([
    ['Отметка порога = +15 мм от чистого пола', 15, 'finished-floor'],
    ['Уровень порога = -2 см от существующего пола', -20, 'existing-floor'],
    ['Отметка верха порога = −0,015 м от готового пола', -15, 'finished-floor'],
    ['Уровень низа порога = 0 мм от уровня существующего пола', 0, 'existing-floor'],
    ['Отметка порога = -6000 мм от чистого пола', -6000, 'finished-floor'],
    ['Отметка порога = +6000 мм от чистого пола', 6000, 'finished-floor'],
  ] as const)(
    'keeps a literal signed threshold level separate from aperture bottom: %s',
    (text, valueMm, datum) => {
      const input = fixture([text])
      const before = structuredClone(input)
      const result = nativeHeightObservations(input)
      expect(result.observations).toMatchObject([
        {
          originalText: text,
          valueMm,
          datum,
          quantityKind: 'threshold-level',
          issueCodes: [],
          mayAcceptFor3D: false,
        },
      ])
      expect(result.issues).toEqual([])
      expect(result.observations[0]).not.toHaveProperty('bottomCm')
      expect(result.observations[0]).not.toHaveProperty('openingId')
      expect(result.assignsGeometryHeights).toBe(false)
      expect(input).toEqual(before)
    },
  )

  it.each(['–20', '—20', '--20', '++20', '+-20', '-+20', '+−20', '± 20', '- − 20'])(
    'holds ambiguous threshold sign %s instead of silently choosing a signed level',
    (quantity) => {
      const result = nativeHeightObservations(
        fixture([`Отметка порога = ${quantity} мм от чистого пола`]),
      )
      expect(result.observations).toEqual([])
      expect(result.issues).toMatchObject([{ code: 'ambiguous-height-sign' }])
    },
  )

  it.each(['-6001', '+6001'])(
    'retains threshold elevation outside supported range: %s',
    (value) => {
      const row = nativeHeightObservations(
        fixture([`Отметка порога = ${value} мм от чистого пола`]),
      ).observations[0]
      expect(row?.quantityKind).toBe('threshold-level')
      expect(row?.issueCodes).toContain('height-outside-model-range')
      expect(row?.mayAcceptFor3D).toBe(false)
    },
  )

  it('does not propagate a nearby floor datum to a signed threshold label', () => {
    const result = nativeHeightObservations(
      fixture(['От уровня существующего пола', 'Отметка порога = -15 мм']),
    )
    expect(result.observations[0]).toMatchObject({
      quantityKind: 'threshold-level',
      valueMm: -15,
      datum: 'unspecified',
      issueCodes: ['height-datum-unverified'],
    })
  })

  it.each([
    'Отметка порога = +15 мм не от чистого пола',
    'Планируемая отметка порога = +15 мм от чистого пола',
    'Отметка порога = +15 мм от чистого пола?',
    'Отметка порога и высота натяжного потолка = 2700 мм от чистого пола',
    'Отметка порога подвесного шкафа = 15 мм',
  ])('does not accept uncertain or competing threshold semantics: %s', (text) => {
    const row = nativeHeightObservations(fixture([text])).observations[0]
    expect(row?.quantityKind).toBe('unclassified-height')
    expect(row?.issueCodes).toContain('height-role-unclassified')
    expect(row?.mayAcceptFor3D).toBe(false)
  })

  it('does not treat a horizontal threshold width as a vertical level', () => {
    const result = nativeHeightObservations(fixture(['Ширина порога = 900 мм', 'Порог 900 мм']))
    expect(result.observations).toEqual([])
    expect(result.issues).toEqual([])
  })

  it.each([
    'Высота = 2800 мм без натяжного потолка',
    'H=2800 мм, не подвесной потолок',
    'Высота до балки = 2800 мм, балки нет',
    'Натяжной потолок = 2700 мм, не от чистого пола',
    'Натяжной потолок = 2700 мм от чистого пола не проверено',
    'Высота проёма = 2100 мм, не от существующего пола',
    'Натяжной потолок отсутствует, H=2800 мм',
  ])('сохраняет число, но не принимает отрицание роли или уровня за доказательство: %s', (text) => {
    const result = nativeHeightObservations(fixture([text]))
    expect(result.observations[0]).toMatchObject({
      originalText: text,
      quantityKind: 'unclassified-height',
      datum: 'unspecified',
      mayAcceptFor3D: false,
    })
    expect(result.observations[0]?.issueCodes).toEqual(
      expect.arrayContaining(['height-role-unclassified', 'height-datum-unverified']),
    )
  })
  it.each([
    'Высота подвесного шкафа = 800 мм',
    'Подвесной светильник высота = 300 мм',
    'Светильник на натяжном потолке высота = 300 мм',
  ])('не принимает подвесной предмет за подпись высоты потолка: %s', (text) => {
    const result = nativeHeightObservations(fixture([text]))
    expect(result.observations[0]?.quantityKind).toBe('unclassified-height')
    expect(result.observations[0]?.issueCodes).toContain('height-role-unclassified')
  })
  it('preserves exact source text, identity and coordinates without assigning owners', () => {
    const input = fixture()
    const before = structuredClone(input)
    const result = nativeHeightObservations(input)
    expect(result.status).toBe('draft')
    expect(result.observations).toEqual([
      {
        labelId: 'native-text-0',
        originalText: 'натяжной-2684мм',
        pagePoint: { x: 100, y: 100 },
        valueMm: 2684,
        quantityKind: 'finished-ceiling',
        datum: 'unspecified',
        issueCodes: ['height-datum-unverified'],
        mayAcceptFor3D: false,
      },
    ])
    expect(result.assignsGeometryHeights).toBe(false)
    expect(result.readOnly).toBe(true)
    expect(result.mayAcceptFor3D).toBe(false)
    expect(input).toEqual(before)
    const row = result.observations[0]
    if (!row) throw new Error('Missing source height')
    row.pagePoint.x = 999
    expect(input).toEqual(before)
    expect(() => JSON.stringify(result)).not.toThrow()
  })
  it.each([
    ['натяжной-2649мм', 2649],
    ['Высота подвесного потолка = 270 см', 2700],
    ['Высота чистового потолка = 2,70 м', 2700],
    ['Высота натяжного потолка = 2.70m', 2700],
    ['Н пр.-2079мм', 2079],
    ['Hпр.=207,9см', 2079],
    ['Высота оконного проёма = 1,65 м', 1650],
    ['Уровень низа балки = 2467 мм', 2467],
    ['Н1-700мм', 700],
    ['h2-1663мм', 1663],
    ['h-2053мм', 2053],
    ['h б.дв.-2281мм', 2281],
    ['Высота = 2 700 мм', 2700],
    ['Высота = 2\u00a0700 mm', 2700],
    ['Высота = 2\u202f700 мм', 2700],
  ] as const)('converts the literal quantity %s only', (text, value) => {
    expect(nativeHeightObservations(fixture([text])).observations[0]?.valueMm).toBe(value)
  })
  it.each([
    'натяжной-2649мм',
    'Высота подвесного потолка = 270 см',
    'Высота чистового потолка = 2,70 м',
  ])('does not convert finished ceiling %s into structural wall height', (text) => {
    const row = nativeHeightObservations(fixture([text])).observations[0]
    expect(row?.quantityKind).toBe('finished-ceiling')
    expect(row?.mayAcceptFor3D).toBe(false)
    expect(row).not.toHaveProperty('wallId')
  })
  it.each([
    'h1-700мм',
    'Н1-700мм',
    'H2-1663мм',
    'Высота стены = 2700 мм',
    'H потолок = 2700 мм',
    'Высота плиты перекрытия = 300 мм',
    'Балка h=2467мм',
    'h б.дв.-2281мм',
    'h-2053мм',
  ])(
    'retains unclassified reference %s without interpreting sill/slab/door-leaf semantics',
    (text) => {
      const row = nativeHeightObservations(fixture([text])).observations[0]
      expect(row?.quantityKind).toBe('unclassified-height')
      expect(row?.issueCodes).toContain('height-role-unclassified')
      expect(row).not.toHaveProperty('openingId')
      expect(row).not.toHaveProperty('bottomCm')
    },
  )
  it('does not join split caption labels by their position', () => {
    const result = nativeHeightObservations(
      fixture(['Балка', 'h-2467мм', 'h потолок', 'натяжной-2663мм']),
    )
    expect(result.observations.map((row) => row.quantityKind)).toEqual([
      'unclassified-height',
      'finished-ceiling',
    ])
    expect(
      result.issues
        .filter((issue) => issue.code === 'no-literal-unit-qualified-height')
        .map((issue) => issue.labelId),
    ).toEqual(['native-text-0', 'native-text-2'])
  })
  it.each(['низ балки = 2467мм', 'Отметка балки = 2467мм', 'Высота до балки = 2467мм'])(
    'keeps explicit beam level reference %s as a separate role',
    (text) => {
      expect(nativeHeightObservations(fixture([text])).observations[0]?.quantityKind).toBe(
        'beam-level',
      )
    },
  )
  it('holds conflicting finished/structural role qualifiers', () => {
    const row = nativeHeightObservations(fixture(['Натяжной потолок / плита перекрытия H=2700мм']))
      .observations[0]
    expect(row?.quantityKind).toBe('unclassified-height')
  })
  it('does not infer a common ceiling from different same-zone references', () => {
    const result = nativeHeightObservations(fixture(['натяжной-2649мм', 'натяжной-2684мм']))
    expect(result.observations.map((row) => row.valueMm)).toEqual([2649, 2684])
    expect(result).not.toHaveProperty('heightCm')
  })
  it('preserves equal values with distinct source identities', () => {
    const result = nativeHeightObservations(fixture(['h1-700мм', 'h1-700мм']))
    expect(result.observations.map((row) => row.labelId)).toEqual([
      'native-text-0',
      'native-text-1',
    ])
  })
  it.each(['от существующего пола', 'от уровня существующего пола'])(
    'accepts only literal existing-floor datum %s',
    (datum) => {
      expect(
        nativeHeightObservations(fixture([`Натяжной потолок = 2684 мм ${datum}`])).observations[0]
          ?.datum,
      ).toBe('existing-floor')
    },
  )
  it.each(['от чистого пола', 'от уровня чистового пола', 'от готового пола'])(
    'accepts only literal finished-floor datum %s',
    (datum) => {
      expect(
        nativeHeightObservations(fixture([`Натяжной потолок = 2684 мм ${datum}`])).observations[0]
          ?.datum,
      ).toBe('finished-floor')
    },
  )
  it('does not spread datum from a separate label or note', () => {
    const result = nativeHeightObservations(
      fixture(['От уровня существующего пола', 'натяжной-2684мм']),
    )
    expect(result.observations[0]?.datum).toBe('unspecified')
  })
  it('keeps contradictory datum text unresolved', () => {
    const row = nativeHeightObservations(
      fixture(['Натяжной потолок = 2684 мм от существующего пола и от чистого пола']),
    ).observations[0]
    expect(row?.datum).toBe('unspecified')
    expect(row?.issueCodes).toContain('ambiguous-height-datum')
  })
  it.each([
    'Потолок натяжной от 2649мм до 2684мм',
    'h1=700мм; h2=1663мм',
    'Высота потолка 2700мм / проёма 2100мм',
  ])('holds multiple quantities in %s without averaging or nearest selection', (text) => {
    const result = nativeHeightObservations(fixture([text]))
    expect(result.observations).toEqual([])
    expect(result.issues[0]?.code).toBe('multiple-height-quantities')
  })
  it.each(['H=2730', 'h потолок', 'Высота 2,70 м²', 'h=2.7e3мм', 'h=2,70,0м', 'h=1 90мм'])(
    'does not accept unitless, malformed or partial quantity %s',
    (text) => {
      const result = nativeHeightObservations(fixture([text]))
      expect(result.observations).toEqual([])
      expect(result.issues).toHaveLength(1)
    },
  )
  it('does not treat ordinary horizontal dimensions as heights', () => {
    const result = nativeHeightObservations(
      fixture(['2700мм', 'Ширина 2700мм', 'Проём 900мм', 'Гостиная']),
    )
    expect(result.observations).toEqual([])
    expect(result.issues).toEqual([])
  })
  it.each(['Н=0мм', 'Н=-20см', 'Высота = 6001мм'])(
    'preserves out-of-model quantity %s as unaccepted documentary evidence',
    (text) => {
      const row = nativeHeightObservations(fixture([text])).observations[0]
      expect(row?.issueCodes).toContain('height-outside-model-range')
      expect(row?.mayAcceptFor3D).toBe(false)
    },
  )
  it('distinguishes a separator dash from an explicitly negative value', () => {
    expect(nativeHeightObservations(fixture(['h-2053мм'])).observations[0]?.valueMm).toBe(2053)
    expect(nativeHeightObservations(fixture(['h=-20см'])).observations[0]?.valueMm).toBe(-200)
  })
  it.each(['h=-200мм', 'h=−200мм', 'h--200мм', 'высота -200мм'])(
    'does not reinterpret literal negative %s as a positive measurement',
    (text) => {
      const row = nativeHeightObservations(fixture([text])).observations[0]
      expect(row?.valueMm).toBe(-200)
      expect(row?.issueCodes).toContain('height-outside-model-range')
      expect(row?.mayAcceptFor3D).toBe(false)
    },
  )
  it('preserves source omissions instead of resetting them for parsed heights', () => {
    const input = fixture()
    input.work.skippedCurves = 1
    input.work.skippedCurveBounds = [
      { operationIndex: 10, bounds: { left: 200, top: 200, right: 220, bottom: 220 } },
    ]
    input.work.clippedPaths = 1
    input.work.clippedPathBounds = [
      { operationIndex: 11, bounds: { left: 900, top: 900, right: 1001, bottom: 1001 } },
    ]
    const before = structuredClone(input)
    expect(nativeHeightObservations(input).omissionCounts).toEqual({
      skippedCurves: 1,
      clippedPaths: 1,
    })
    expect(input).toEqual(before)
  })
  it('requires the existing source state', () => {
    const input = fixture()
    input.source.state = 'proposed'
    expectHeld(input, 'not-existing-state')
  })
  it.each(['sourceHash', 'originalHash', 'page', 'statePage'] as const)(
    'holds mismatched %s',
    (field) => {
      const input = fixture()
      if (field === 'sourceHash') input.source.sha256 = 'c'.repeat(64)
      if (field === 'originalHash') input.native.originalPdfSha256 = 'c'.repeat(64)
      if (field === 'page') input.source.pdfPage = 7
      if (field === 'statePage') input.source.pdfPage = Number.NaN
      expectHeld(input, 'different-height-source')
    },
  )
  it.each(['sha256', 'page', 'width', 'height'] as const)('holds changed raster %s', (key) => {
    const input = fixture()
    if (key === 'sha256') input.lineworkSource.sha256 = 'c'.repeat(64)
    else input.lineworkSource[key]++
    expectHeld(input, 'height-source-frame-unavailable')
  })
  it.each(['id', 'index', 'point', 'pagePoint', 'rotation', 'name'] as const)(
    'holds invalid native label %s provenance',
    (field) => {
      const input = fixture(),
        label = labelOf(input)
      if (field === 'id') label.id = 'invented'
      if (field === 'index') delete label.nativeIndex
      if (field === 'point') label.point.x++
      if (field === 'pagePoint') delete label.pagePoint
      if (field === 'rotation') label.rotation = Number.NaN
      if (field === 'name') label.name = ' h-2700мм '
      expectHeld(input, 'invalid-native-text-provenance')
    },
  )
  it('holds duplicate native label identity', () => {
    const input = fixture()
    input.native.labels.push(structuredClone(labelOf(input)))
    expectHeld(input, 'invalid-native-text-provenance')
  })
  it.each(['truncated', 'unsupportedPaths', 'unsupportedContexts'] as const)(
    'holds incomplete %s source geometry',
    (field) => {
      const input = fixture()
      if (field === 'truncated') input.work.truncated = true
      else input.work[field] = 1
      expectHeld(input, 'incomplete-native-layer')
    },
  )
  it('holds incomplete native text', () => {
    const input = fixture()
    input.native.complete = false
    expectHeld(input, 'incomplete-native-text')
  })
  it('holds oversized text input before parsing any heights', () =>
    expectHeld(fixture(Array.from({ length: 1001 }, () => 'Гостиная')), 'incomplete-native-text'))
  it('holds observation output exhaustion atomically', () => {
    const input = fixture(
      Array.from({ length: 101 }, (_, i) => `Натяжной потолок = ${i + 1}мм от существующего пола`),
    )
    expectHeld(input, 'height-observation-output-limit')
  })
  it('holds ambiguous-caption diagnostic output exhaustion atomically', () => {
    expectHeld(
      fixture(Array.from({ length: 101 }, () => 'H=2730')),
      'height-observation-output-limit',
    )
  })
  it('supports the bounded complete output of explicit finished-datum quantities', () => {
    const input = fixture(
      Array.from({ length: 100 }, (_, i) => `Натяжной потолок = ${i + 1}мм от существующего пола`),
    )
    const result = nativeHeightObservations(input)
    expect(result.observations).toHaveLength(100)
    expect(result.issues).toEqual([])
  })
})
