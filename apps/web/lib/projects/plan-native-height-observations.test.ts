import { createHash } from 'node:crypto'
import { existsSync } from 'node:fs'
import { readFile } from 'node:fs/promises'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import {
  nativeDocumentaryHeightCaption,
  nativeHeightMillimetreDeclarationIndex,
} from './plan-native-height-caption'
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
  const realSource = fileURLToPath(
    new URL('../../../../output/pdf/source-search-20261003/rebrina-original.pdf', import.meta.url),
  )
  it.skipIf(!existsSync(realSource))(
    'retains the real Rebrina H captions but never treats them as accepted ceilings',
    async () => {
      const body = await readFile(realSource)
      const sha256 = createHash('sha256').update(body).digest('hex')
      expect(sha256).toBe('2e141c135812c81719e1f4783173cb5202e20041ac494d3cc799eb37ad62ad4e')
      const { preparePlanPage } = await import('./plan-document')
      const page = await preparePlanPage(body, true, 3, true, true)
      if (!page.nativeTextAnchors || !page.linework || !page.lineworkRasterSource)
        throw new Error('Missing real native source layers')
      const input: Input = {
        source: { sha256, pdfPage: 3, state: 'existing' },
        native: page.nativeTextAnchors,
        work: page.linework,
        lineworkSource: page.lineworkRasterSource,
      }
      const result = nativeHeightObservations(input)
      expect(result.observations.map((row) => row.valueMm)).toEqual([
        3277, 3773, 3790, 3780, 360, 360, 3790, 2835, 3495, 3790,
      ])
      for (const row of result.observations) {
        expect(row.originalText).toBe(`Н=${row.valueMm}`)
        expect(row.quantityKind).toBe('unclassified-height')
        expect(row.datum).toBe('unspecified')
        expect(row.unitEvidence?.labelId).toBe('native-text-237')
        expect(row.unitEvidence?.originalText).toBe('5. Размеры указаны в миллиметрах')
        expect(row.unitEvidence?.source).toEqual(input.source)
        expect(row.unitEvidence?.inkSourceOperation).toBe(14076)
        expect(row.issueCodes).not.toContain('height-unit-ink-unverified')
        expect(row.mayAcceptFor3D).toBe(false)
      }
      const { nativeHeightSourceLocations } = await import('./plan-native-height-locations')
      const locations = nativeHeightSourceLocations(input)
      expect(locations.observations.every((row) => row.status === 'unresolved')).toBe(true)
      expect(locations.mayTransfer3D).toBe(false)
      const { nativeHeightObjectEvidence } = await import('./plan-native-height-objects')
      const objects = nativeHeightObjectEvidence(input)
      expect(objects.bindings.every((row) => row.objectStatus === 'unresolved')).toBe(true)
      expect(objects.mayTransfer2D3D).toBe(false)
    },
  )
  function documentaryFixture() {
    const input = fixture(['Н=3790', '5. Размеры указаны в миллиметрах'])
    const label = input.native.labels[1]
    if (!label?.pagePoint) throw new Error('Missing documentary note fixture')
    input.native.heightUnitInk = {
      source: {
        sha256: input.source.sha256,
        pdfPage: input.source.pdfPage,
        pageWidth: input.work.pageWidth,
        pageHeight: input.work.pageHeight,
      },
      complete: true,
      refusalReason: null,
      items: [
        {
          index: 1,
          text: label.name,
          fontName: 'synthetic-test-font',
          operationIndex: 19,
          baselineStart: { ...label.pagePoint },
          baselineEnd: { x: 120, y: label.pagePoint.y },
          quad: [
            { x: 100, y: 98 },
            { x: 120, y: 98 },
            { x: 120, y: 101 },
            { x: 100, y: 101 },
          ],
        },
      ],
      unresolved: [],
    }
    input.work.paintBounds = {
      complete: true,
      refusalReason: null,
      events: [
        {
          operationIndex: 19,
          kind: 'text',
          bounds: null,
          reason: 'text-paint-envelope-unavailable',
        },
      ],
    }
    return input
  }
  it('retains raw unitless height under exact same-page units ink without inventing role or datum', () => {
    const input = documentaryFixture()
    const before = structuredClone(input)
    const result = nativeHeightObservations(input)
    expect(result.observations).toMatchObject([
      {
        originalText: 'Н=3790',
        labelId: 'native-text-0',
        valueMm: 3790,
        quantityKind: 'unclassified-height',
        datum: 'unspecified',
        mayAcceptFor3D: false,
        unitEvidence: {
          labelId: 'native-text-1',
          originalText: '5. Размеры указаны в миллиметрах',
          nativeIndex: 1,
          inkSourceOperation: 19,
          source: input.source,
        },
      },
    ])
    expect(result.assignsGeometryHeights).toBe(false)
    expect(input).toEqual(before)
  })
  it.each(['missing', 'incomplete'])(
    'does not certify a documentary millimetre note with %s paint inventory',
    (fault) => {
      const input = documentaryFixture()
      if (fault === 'missing') delete input.work.paintBounds
      else if (input.work.paintBounds) input.work.paintBounds.complete = false
      const result = nativeHeightObservations(input)
      expect(result.observations).toEqual([])
      expect(result.mayAcceptFor3D).toBe(false)
    },
  )
  it.each([
    'Размеры не указаны в миллиметрах',
    'Размеры указаны в сантиметрах',
    'Размеры указаны в миллиметрах кроме высот',
    'Размеры указаны в миллиметрах и сантиметрах',
    'Размеры указаны в миллиметрах?',
    'Раз\u200bмеры указаны в миллиметрах',
  ])('holds conflicting or qualified unit declaration %s', (text) => {
    expect(nativeHeightMillimetreDeclarationIndex(['Н=3790', text])).toBeNull()
  })
  it('holds duplicate and contradictory same-page declarations', () => {
    const note = 'Размеры указаны в миллиметрах'
    expect(nativeHeightMillimetreDeclarationIndex([note, note])).toBeNull()
    expect(
      nativeHeightMillimetreDeclarationIndex([note, 'Высоты указаны в сантиметрах']),
    ).toBeNull()
    expect(nativeHeightMillimetreDeclarationIndex([note, 'Высоты в см'])).toBeNull()
    expect(nativeHeightMillimetreDeclarationIndex([note, 'Высоты указаны в метрах'])).toBeNull()
    expect(nativeHeightMillimetreDeclarationIndex([note, 'Высоты в м'])).toBeNull()
    expect(nativeHeightMillimetreDeclarationIndex([note, 'Высоты в m'])).toBeNull()
    expect(
      nativeHeightMillimetreDeclarationIndex([note, 'Раз\u200bмеры не указаны в миллиметрах']),
    ).toBeNull()
  })
  it.each(['Высоты указаны в метрах', 'Высоты в м', 'Высоты в m'])(
    'does not inventory a metre height as millimetres: %s',
    (exception) => {
      const input = documentaryFixture()
      input.native.labels.push({
        id: 'native-text-2',
        nativeIndex: 2,
        name: exception,
        rotation: 0,
        point: { x: 100, y: 102 },
        pagePoint: { x: 100, y: 102 },
      })
      expect(nativeHeightObservations(input).observations).toEqual([])
    },
  )
  it('keeps documentary-only units visible without claiming unresolved note glyphs as verified', () => {
    const input = documentaryFixture()
    const ink = input.native.heightUnitInk
    if (!ink) throw new Error('Missing units ink fixture')
    ink.complete = false
    ink.items = []
    ink.unresolved = [{ index: 1, reason: 'native-text-show-identity-unresolved' }]
    const row = nativeHeightObservations(input).observations[0]
    expect(row?.originalText).toBe('Н=3790')
    expect(row?.unitEvidence?.inkSourceOperation).toBeNull()
    expect(row?.issueCodes).toContain('height-unit-ink-unverified')
    expect(row?.quantityKind).toBe('unclassified-height')
    expect(row?.datum).toBe('unspecified')
    expect(row?.mayAcceptFor3D).toBe(false)
    for (const mutation of ['index', 'reason', 'source', 'page']) {
      const bad = structuredClone(input)
      const badInk = bad.native.heightUnitInk
      const unresolved = badInk?.unresolved[0]
      if (!badInk || !unresolved) throw new Error('Missing unresolved units fixture')
      if (mutation === 'index') unresolved.index++
      if (mutation === 'reason') unresolved.reason = 'native-text-show-visibility-unresolved'
      if (mutation === 'source') badInk.source.sha256 = 'c'.repeat(64)
      if (mutation === 'page') badInk.source.pdfPage++
      expect(nativeHeightObservations(bad).observations).toEqual([])
    }
  })
  it.each(['Н=0', 'Н=-360', 'Н=6001', 'H1=3790', 'Н=3790 мм', 'Н=3790 360', 'Н=37,90', 'Н≈3790'])(
    'does not parse unsupported unitless caption %s',
    (text) => {
      expect(nativeDocumentaryHeightCaption(text)).toBeNull()
    },
  )
  it.each([
    'missing',
    'different-source',
    'different-page',
    'different-index',
    'different-text',
    'shifted-baseline',
    'reversed-baseline',
    'invalid-quad',
    'incomplete',
    'hidden',
  ])('withholds documentary height when unit provenance is %s', (mutation) => {
    const input = documentaryFixture()
    const ink = input.native.heightUnitInk
    const item = ink?.items[0]
    const corner = item?.quad[2]
    if (!ink || !item || !corner) throw new Error('Missing units glyph fixture')
    if (mutation === 'missing') delete input.native.heightUnitInk
    if (mutation === 'different-source') ink.source.sha256 = 'c'.repeat(64)
    if (mutation === 'different-page') ink.source.pdfPage++
    if (mutation === 'different-index') item.index++
    if (mutation === 'different-text') item.text += '.'
    if (mutation === 'shifted-baseline') item.baselineStart.x++
    if (mutation === 'reversed-baseline') item.baselineEnd.x = 90
    if (mutation === 'invalid-quad') corner.x++
    if (mutation === 'incomplete') ink.complete = false
    if (mutation === 'hidden') input.native.vectorInkRefusal = 'hidden-optional-content'
    expect(nativeHeightObservations(input).observations).toEqual([])
  })
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
    ['Н двери = 2300 мм', 'opening-height'],
    ['Н окна = 1700 мм', 'opening-height'],
    ['Н порога = 130 мм', 'threshold-height'],
    ['Нпорога=45 мм', 'threshold-height'],
    ['Высота порога = 45 мм', 'threshold-height'],
  ] as const)(
    'keeps the literal height role without assigning a source object: %s',
    (text, kind) => {
      const result = nativeHeightObservations(fixture([text]))
      expect(result.observations).toMatchObject([
        {
          originalText: text,
          quantityKind: kind,
          datum: 'unspecified',
          issueCodes: ['height-datum-unverified'],
          mayAcceptFor3D: false,
        },
      ])
      expect(result.assignsGeometryHeights).toBe(false)
    },
  )

  it.each(['Н порога = 130', 'Н двери = 2300', 'Н окна = 1700'])(
    'does not invent millimetres for the unitless CHI caption %s',
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
  it('offers a nearby three-part threshold caption only as an unverified review hint', () => {
    const input = fixture(['Н', 'порога', '=45 мм'])
    const points = [
      { x: 100, y: 100 },
      { x: 111, y: 101.1 },
      { x: 144, y: 100 },
    ]
    input.native.labels.forEach((label, index) => {
      label.pagePoint = { ...(points[index] as (typeof points)[number]) }
      label.point = { ...(points[index] as (typeof points)[number]) }
    })
    const result = nativeHeightObservations(input)
    expect(result.observations).toEqual([])
    expect(result.splitHints).toEqual([
      {
        parts: [
          { labelId: 'native-text-0', originalText: 'Н', pagePoint: points[0] },
          { labelId: 'native-text-1', originalText: 'порога', pagePoint: points[1] },
          { labelId: 'native-text-2', originalText: '=45 мм', pagePoint: points[2] },
        ],
        valueMm: 45,
        quantityKind: 'threshold-height',
        status: 'unverified-source-ink',
      },
    ])
    expect(result.mayAcceptFor3D).toBe(false)
  })
  it('does not suggest a split threshold across a distant label, different line or missing source item', () => {
    for (const change of ['distant', 'different-line', 'skipped-index'] as const) {
      const input = fixture(['Н', 'порога', '=45 мм'])
      const [first, middle, last] = input.native.labels
      if (!first || !middle || !last) throw new Error('Missing split threshold labels')
      middle.pagePoint = { x: 111, y: 101.1 }
      middle.point = { ...middle.pagePoint }
      last.pagePoint = { x: 144, y: 100 }
      last.point = { ...last.pagePoint }
      if (change === 'distant') {
        last.pagePoint.x = 300
        last.point.x = 300
      }
      if (change === 'different-line') {
        middle.pagePoint.y = 120
        middle.point.y = 120
      }
      if (change === 'skipped-index') {
        last.nativeIndex = 4
        last.id = 'native-text-4'
      }
      expect(nativeHeightObservations(input).splitHints).toEqual([])
    }
  })
  const decoSource = fileURLToPath(
    new URL('../../../../tmp/pdfs/deco-art-dvushka-source.pdf', import.meta.url),
  )
  it.skipIf(!existsSync(decoSource))(
    'keeps the real DECO ART 45 mm threshold as a review hint',
    async () => {
      const body = await readFile(decoSource)
      const sha256 = createHash('sha256').update(body).digest('hex')
      expect(sha256).toBe('fee92486f301e8a40886914c74b9a83ce77747c6ee14dd4ee0a666dec4a647fd')
      const { preparePlanPage } = await import('./plan-document')
      const page = await preparePlanPage(body, true, 3, true, true)
      if (!page.nativeTextAnchors || !page.linework || !page.lineworkRasterSource)
        throw new Error('Missing real source layers')
      const result = nativeHeightObservations({
        source: { sha256, pdfPage: 3, state: 'existing' },
        native: page.nativeTextAnchors,
        work: page.linework,
        lineworkSource: page.lineworkRasterSource,
      })
      expect(result.status).toBe('draft')
      expect(result.splitHints).toContainEqual({
        parts: [
          {
            labelId: 'native-text-74',
            originalText: 'Н',
            pagePoint: { x: 187.4927400274128, y: 372.02802718239457 },
          },
          {
            labelId: 'native-text-75',
            originalText: 'порога',
            pagePoint: { x: 192.34764949909058, y: 373.4082579812488 },
          },
          {
            labelId: 'native-text-76',
            originalText: '=45 мм',
            pagePoint: { x: 206.32105330027255, y: 372.02802718239457 },
          },
        ],
        valueMm: 45,
        quantityKind: 'threshold-height',
        status: 'unverified-source-ink',
      })
      expect(result.observations.some((row) => row.valueMm === 45)).toBe(false)
    },
  )
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
