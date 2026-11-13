import { isUsableArchitectureAnchor, QUALITY_REVIEW_TIMEOUT_MS, reviewConceptImage } from '@uyut/ai'
import sharp from 'sharp'
import { afterEach, describe, expect, it, vi } from 'vitest'

const description = 'Гостиная с окном и диваном.'
// An asymmetric room outline with the same window, furniture and perspective.
// The result adds a single localized opening on the exposed wall.
function roomFrame(extraOpening: boolean) {
  return Buffer.from(`<svg xmlns="http://www.w3.org/2000/svg" width="160" height="120">
    <rect width="160" height="120" fill="#eee"/>
    <g stroke="#333" fill="#aaa" stroke-width="2">
      <path fill="none" d="M0 4L26 17H138L160 0 M26 17V92L0 116 M26 92H138V17 M138 92L160 108"/>
      <rect x="31" y="24" width="41" height="42"/><path d="M54 24V66 M31 43H72"/>
      <rect x="38" y="76" width="53" height="10"/><path d="M41 86V99 M87 86V98"/>
      ${extraOpening ? '<rect x="106" y="46" width="17" height="45"/>' : ''}
    </g></svg>`)
}
const source = { body: await sharp(roomFrame(false)).png().toBuffer(), contentType: 'image/png' }
const resultImage = {
  body: await sharp(roomFrame(true)).jpeg().toBuffer(),
  contentType: 'image/jpeg',
}
const sourceDataUrl = `data:image/png;base64,${source.body.toString('base64')}`
const resultDataUrl = `data:image/jpeg;base64,${resultImage.body.toString('base64')}`
const brief = {
  roomKind: 'living' as const,
  condition: 'finished' as const,
  notes: 'Личные пожелания клиента.',
  revision: 'Позднее уточнение клиента.',
  requestedVariant: 'Выбранная просьба клиента.',
}
const addedRadiator = {
  code: 'brief_conflict',
  detail: 'Добавлен радиатор под окном.',
  confidence: 0.95,
  basis: 'reference',
  sourceCheck: { object: 'радиатор', location: 'под окном', expected: 'empty' },
}
const removedRadiator = {
  ...addedRadiator,
  detail: 'Исчез радиатор под окном.',
  sourceCheck: { ...addedRadiator.sourceCheck, expected: 'present' },
}
const emptyUnderWindow = { id: 0, matchedLandmark: 'окно', state: 'empty' }
const wallSite = {
  location: 'между аркой и углом ниши',
  boundaries: ['косяк арки', 'угол ниши'],
}
const addedWindow = {
  ...addedRadiator,
  code: 'opening_conflict',
  detail: 'Добавлено окно между аркой и углом ниши.',
  sourceCheck: { object: 'окно', ...wallSite, expected: 'empty' },
}
const emptyWallSite = {
  state: 'empty',
  matchedLandmark: 'арка',
  boundaryTypes: ['opening_jamb', 'wall_corner'],
}
const explicitBan = {
  code: 'brief_conflict',
  detail: 'Виден остров вопреки просьбе без острова.',
  confidence: 0.95,
  basis: 'result',
  requirementQuote: 'Позднее уточнение клиента.',
}

function mockReviews(
  issues: unknown[],
  observationOutput: unknown,
  options: {
    baseIssues?: unknown[]
    baseElapsedMs?: number
    comparisonElapsedMs?: number
    comparisonOutput?: unknown
  } = {},
) {
  const fetchMock = vi.spyOn(globalThis, 'fetch')
  const outputs = [
    { description, issues: options.baseIssues ?? [] },
    options.comparisonOutput ?? { description: 'Описание парного сравнения.', issues },
    observationOutput,
  ]
  const elapsed = [options.baseElapsedMs ?? 0, options.comparisonElapsedMs ?? 0, 0]
  for (const [index, output] of outputs.entries()) {
    if (output instanceof Error) {
      fetchMock.mockRejectedValueOnce(output)
      continue
    }
    fetchMock
      .mockResolvedValueOnce(
        Response.json({
          status_url: `https://queue.fal.run/${index}/status`,
          response_url: `https://queue.fal.run/${index}/result`,
        }),
      )
      .mockResolvedValueOnce(Response.json({ status: 'COMPLETED' }))
      .mockImplementationOnce(async () => {
        if (elapsed[index]) vi.setSystemTime(Date.now() + (elapsed[index] ?? 0))
        return Response.json({
          output: typeof output === 'string' ? output : JSON.stringify(output),
        })
      })
  }
  return fetchMock
}

function submissions(fetchMock: ReturnType<typeof mockReviews>) {
  return fetchMock.mock.calls.filter((call) => call[1]?.method === 'POST')
}

afterEach(() => {
  vi.restoreAllMocks()
  vi.useRealTimers()
})

describe('independent observation of a registered opening', async () => {
  const box = [0.55, 0.2, 0.3, 0.5]
  const opening = {
    ...addedWindow,
    sourceCheck: { object: 'окно', location: 'стена ниши', expected: 'empty', box },
  }
  const windowPatch = Buffer.from(`<svg xmlns="http://www.w3.org/2000/svg" width="48" height="60">
    <rect width="48" height="60" fill="#334"/>
    <path fill="#98b4bb" d="M4 4h18v24H4z M26 4h18v24H26z M4 32h18v24H4z M26 32h18v24H26z"/>
    <path stroke="#445b65" stroke-width="2" d="M4 22L20 6 M27 22L43 6 M5 52L19 36 M27 52L42 37"/>
  </svg>`)
  const changed = {
    body: await sharp(source.body)
      .composite([{ input: windowPatch, left: 88, top: 24 }])
      .png()
      .toBuffer(),
    contentType: 'image/png',
  }

  it.each(['addition', 'removal'])(
    'confirms %s only from a wall at the registered site',
    async (direction) => {
      const addition = direction === 'addition'
      const issue = {
        ...opening,
        detail: addition ? 'В стене ниши добавлено окно.' : 'В стене ниши исчезло окно.',
        sourceCheck: { ...opening.sourceCheck, expected: addition ? 'empty' : 'present' },
      }
      const fetchMock = mockReviews([issue], {
        roomView: 'restricted',
        observations: [
          { id: 0, state: 'empty', surface: 'continuous_wall', matchedLandmark: null },
        ],
      })
      const review = await reviewConceptImage(
        'test',
        addition ? changed : source,
        brief,
        addition ? source : changed,
      )
      expect(review).toMatchObject({
        status: 'review',
        sourceComparison: 'verified',
        additionalReviewRequests: 2,
      })
      expect(review.issues[0]?.detail).toBe(
        addition
          ? 'В правой части кадра на месте сплошной стены появился оконный проём.'
          : 'В правой части кадра на месте, где был оконный проём, видна сплошная стена.',
      )
      const requests = submissions(fetchMock)
      expect(requests).toHaveLength(3)
      const observer = JSON.parse(String(requests[2]?.[1]?.body))
      const crop = await sharp(source.body)
        .extract({ left: 88, top: 24, width: 48, height: 60 })
        .png()
        .toBuffer()
      expect(observer.image_urls).toEqual([
        sourceDataUrl,
        `data:image/png;base64,${crop.toString('base64')}`,
      ])
      expect(JSON.parse(observer.prompt)).toEqual([{ id: 0, box, imageIndex: 2 }])
      expect(observer.system_prompt).toContain('"surface":"continuous_wall|other"')
      for (const privateValue of [
        issue.detail,
        issue.sourceCheck.location,
        brief.notes,
        brief.revision,
        brief.requestedVariant,
        changed.body.toString('base64'),
      ]) {
        expect(JSON.stringify(observer)).not.toContain(privateValue)
      }
    },
  )

  it.each([
    ['door remains in frame', 'present', 'other'],
    ['window remains at site', 'present', 'continuous_wall'],
    ['furniture covers site', 'not_visible', 'continuous_wall'],
    ['exposed niche instead of wall', 'empty', 'other'],
    ['surface unclassified', 'empty', undefined],
  ])('rejects a registered site with %s', async (_label, state, surface) => {
    mockReviews([opening], {
      roomView: 'broad',
      observations: [{ id: 0, ...emptyWallSite, state, surface }],
    })
    const review = await reviewConceptImage('test', changed, brief, source)
    expect(review).toMatchObject({
      status: 'checked',
      sourceComparison: 'limited',
      issues: [],
      additionalReviewRequests: 2,
    })
  })

  it.each([
    ['missing', undefined],
    ['non-numeric', ['0.55', 0.2, 0.3, 0.5]],
    ['extends outside frame', [0.9, 0.2, 0.3, 0.5]],
    ['wrong location', [0.05, 0.2, 0.3, 0.5]],
  ])('does not observe an opening with a %s box', async (_label, proposedBox) => {
    const issue = { ...opening, sourceCheck: { ...opening.sourceCheck, box: proposedBox } }
    const fetchMock = mockReviews([issue], new Error('Unexpected observer'))
    const review = await reviewConceptImage('test', changed, brief, source)
    expect(review).toMatchObject({ sourceComparison: 'limited', issues: [] })
    expect(submissions(fetchMock)).toHaveLength(2)
  })

  it('does not treat an identical original and result as a registered change', async () => {
    const fetchMock = mockReviews([opening], new Error('Unexpected observer'))
    const review = await reviewConceptImage('test', changed, brief, changed)
    expect(review).toMatchObject({ sourceComparison: 'limited', issues: [] })
    expect(submissions(fetchMock)).toHaveLength(2)
  })

  it('requires a valid room scope even with a registered wall observation', async () => {
    mockReviews([opening], {
      roomView: false,
      observations: [{ id: 0, state: 'empty', surface: 'continuous_wall' }],
    })
    const review = await reviewConceptImage('test', changed, brief, source)
    expect(review).toMatchObject({ sourceComparison: 'unavailable', issues: [] })
  })

  it('keeps a supplied equipment box out of a mixed observer request', async () => {
    const equipment = { ...addedRadiator, sourceCheck: { ...addedRadiator.sourceCheck, box } }
    const fetchMock = mockReviews([opening, equipment], {
      roomView: 'restricted',
      observations: [0, 1].map((id) => ({
        id,
        state: 'empty',
        surface: 'continuous_wall',
        matchedLandmark: 'окно',
      })),
    })
    const review = await reviewConceptImage('test', changed, brief, source)
    expect(review.sourceComparison).toBe('limited')
    expect(review.issues.map(({ detail }) => detail)).toEqual([
      'В правой части кадра на месте сплошной стены появился оконный проём.',
    ])
    const observer = JSON.parse(String(submissions(fetchMock)[2]?.[1]?.body))
    expect(JSON.parse(observer.prompt)[0]).toEqual({ id: 0, box, imageIndex: 2 })
    expect(JSON.parse(observer.prompt)[1]).toEqual({
      id: 1,
      object: 'радиатор',
      location: 'под окном',
    })
  })

  it('keeps equipment instructions when a registered removal is outside the observed group', async () => {
    const removal = {
      ...opening,
      sourceCheck: { ...opening.sourceCheck, expected: 'present' },
    }
    const fetchMock = mockReviews([opening, removal, addedRadiator], {
      roomView: 'broad',
      observations: [
        { id: 0, state: 'empty', surface: 'continuous_wall', matchedLandmark: null },
        { ...emptyUnderWindow, id: 2 },
      ],
    })

    const review = await reviewConceptImage('test', changed, brief, source)
    expect(review).toMatchObject({ sourceComparison: 'limited', additionalReviewRequests: 2 })
    expect(review.issues.map(({ code }) => code)).toEqual(['opening_conflict', 'brief_conflict'])
    const requests = submissions(fetchMock)
    expect(requests).toHaveLength(3)
    const observer = JSON.parse(String(requests[2]?.[1]?.body))
    expect(observer.system_prompt).toContain('Для каждой пары предмет/место')
    expect(observer.image_urls).toHaveLength(2)
    expect(observer.image_urls[0]).toBe(sourceDataUrl)
    expect(JSON.parse(observer.prompt)).toEqual([
      { id: 0, box, imageIndex: 2 },
      { id: 2, object: 'радиатор', location: 'под окном' },
    ])
  })
})

describe('independent source observation', () => {
  it.each([false, true])(
    'retains incomplete image assessment when source comparison fails=%s',
    async (failed) => {
      const fetchMock = mockReviews([], new Error('Unexpected observer'), {
        baseIssues: [{ ...explicitBan, confidence: 0.79 }],
        comparisonOutput: failed ? new Error('offline') : { description, issues: [] },
      })
      const review = await reviewConceptImage('test', resultImage, brief, source)
      expect(review).toMatchObject({
        status: 'checked',
        imageReview: 'limited',
        sourceComparison: failed ? 'unavailable' : 'verified',
        issues: [],
      })
      expect(isUsableArchitectureAnchor(review, { layoutNotes: 'Окно слева.' })).toBe(false)
      expect(submissions(fetchMock)).toHaveLength(2)
    },
  )

  const banQuote = 'В интерьере не должно быть телевизора.'
  const tvIssue = {
    ...explicitBan,
    detail: 'В комнате видны два телевизора.',
    requirementQuote: banQuote,
    exclusionQuote: banQuote,
  }

  it('reports presence for an exact blanket ban and keeps an independent change with the same code', async () => {
    mockReviews(
      [addedRadiator],
      {
        roomView: 'broad',
        observations: [emptyUnderWindow],
      },
      { baseIssues: [tvIssue] },
    )
    const review = await reviewConceptImage(
      'test',
      resultImage,
      { roomKind: 'living', notes: banQuote, condition: 'finished' },
      source,
    )
    expect(review.issues[0]?.detail).toBe(
      'На изображении виден предмет, который просили исключить: «В интерьере не должно быть телевизора». Добавлен радиатор под окном.',
    )
  })

  it.each([
    { request: banQuote, finding: { ...tvIssue, exclusionQuote: undefined } },
    { request: banQuote, finding: { ...tvIssue, exclusionQuote: 'Без телевизора.' } },
    { request: banQuote, finding: { ...tvIssue, detail: 'Кресло мешает открыть шкаф.' } },
    {
      request: 'Не должно быть второго телевизора.',
      finding: { ...tvIssue, exclusionQuote: 'Не должно быть второго телевизора.' },
    },
    {
      request: 'На тумбе не должно быть телевизора.',
      finding: { ...tvIssue, exclusionQuote: 'На тумбе не должно быть телевизора.' },
    },
    {
      request: 'Без телевизора. Добавить кресло.',
      finding: { ...tvIssue, exclusionQuote: 'Без телевизора.' },
    },
    { request: banQuote, layoutContract: 'Два места у стола', finding: tvIssue },
    { request: banQuote, revision: 'Можно добавить экран.', finding: tvIssue },
  ])(
    'preserves the detailed finding when a blanket exclusion cannot be grounded: %j',
    async (sample) => {
      mockReviews([], {}, { baseIssues: [sample.finding] })
      const review = await reviewConceptImage('test', resultImage, {
        roomKind: 'living',
        notes: sample.request,
        layoutContract: 'layoutContract' in sample ? sample.layoutContract : undefined,
        revision: 'revision' in sample ? sample.revision : undefined,
      })
      expect(review.issues[0]?.detail).toBe(sample.finding.detail)
    },
  )

  it('confirms an addition using only source pixels and a neutral object/location question', async () => {
    const fetchMock = mockReviews(
      [addedRadiator],
      { roomView: 'broad', observations: [emptyUnderWindow] },
      { baseIssues: [explicitBan] },
    )
    const review = await reviewConceptImage('test', resultImage, brief, source)
    expect(review).toMatchObject({
      status: 'review',
      sourceComparison: 'verified',
      additionalReviewRequests: 2,
      description,
      issues: [{ code: 'brief_conflict', detail: `${explicitBan.detail} ${addedRadiator.detail}` }],
    })
    const requests = submissions(fetchMock)
    expect(requests).toHaveLength(3)
    const observer = JSON.parse(String(requests[2]?.[1]?.body))
    expect(observer.image_urls).toEqual([sourceDataUrl])
    expect(JSON.parse(observer.prompt)).toEqual([
      { id: 0, object: 'радиатор', location: 'под окном' },
    ])
    const body = JSON.stringify(observer)
    for (const privateInput of [
      'expected',
      addedRadiator.detail,
      explicitBan.detail,
      brief.notes,
      brief.revision,
      brief.requestedVariant,
      resultDataUrl,
    ]) {
      expect(body).not.toContain(privateInput)
    }
  })

  it.each(['present', 'not_visible'])(
    'drops an alleged addition when source state is %s and marks comparison limited',
    async (state) => {
      mockReviews([addedRadiator], {
        roomView: 'broad',
        observations: [{ ...emptyUnderWindow, state }],
      })
      const review = await reviewConceptImage('test', resultImage, brief, source)
      expect(review).toMatchObject({
        status: 'checked',
        issues: [],
        description,
        sourceComparison: 'limited',
        additionalReviewRequests: 2,
      })
      expect(isUsableArchitectureAnchor(review, { layoutNotes: 'Одно окно.' })).toBe(false)
    },
  )

  it('preserves an independent explicit prohibition after rejecting an earlier claim with the same code', async () => {
    mockReviews(
      [addedRadiator],
      { roomView: 'broad', observations: [{ id: 0, state: 'not_visible' }] },
      { baseIssues: [explicitBan] },
    )
    const review = await reviewConceptImage('test', resultImage, brief, source)
    expect(review).toMatchObject({ status: 'review', sourceComparison: 'limited' })
    expect(review.issues).toEqual([
      { code: explicitBan.code, detail: explicitBan.detail, confidence: explicitBan.confidence },
    ])
  })

  it('requires a matched landmark for an otherwise empty equipment site', async () => {
    mockReviews([addedRadiator], {
      roomView: 'broad',
      observations: [{ ...emptyUnderWindow, matchedLandmark: null }],
    })
    const review = await reviewConceptImage('test', resultImage, brief, source)
    expect(review).toMatchObject({ status: 'checked', issues: [], sourceComparison: 'limited' })
  })

  it('confirms a disappearance against the exposed site in the result alone', async () => {
    const fetchMock = mockReviews([removedRadiator], {
      roomView: 'broad',
      observations: [emptyUnderWindow],
    })
    const review = await reviewConceptImage('test', resultImage, brief, source)
    expect(review).toMatchObject({ status: 'review', sourceComparison: 'verified' })
    expect(review.issues[0]?.detail).toBe(removedRadiator.detail)
    const observer = JSON.parse(String(submissions(fetchMock)[2]?.[1]?.body))
    expect(observer.image_urls).toEqual([resultDataUrl])
    expect(JSON.parse(observer.prompt)).toEqual([
      { id: 0, object: 'радиатор', location: 'под окном' },
    ])
  })

  it.each(['present', 'not_visible'])(
    'rejects disappearance when result site is %s',
    async (state) => {
      mockReviews([removedRadiator], {
        roomView: 'broad',
        observations: [{ ...emptyUnderWindow, state }],
      })
      const review = await reviewConceptImage('test', resultImage, brief, source)
      expect(review).toMatchObject({ status: 'checked', issues: [], sourceComparison: 'limited' })
    },
  )

  it.each([
    { boundaries: undefined },
    { boundaries: ['угол'] },
    { boundaries: ['угол  ниши', ' УГОЛ НИШИ '] },
    { boundaries: ['косяк', 'а'.repeat(121)] },
  ])('skips openings without two distinct bounded cues: %j', async ({ boundaries }) => {
    const claim = {
      ...addedWindow,
      sourceCheck: { ...addedWindow.sourceCheck, boundaries },
    }
    const fetchMock = mockReviews([claim], new Error('Unexpected observation'))
    const review = await reviewConceptImage('test', resultImage, brief, source)
    expect(review).toMatchObject({ status: 'checked', issues: [], sourceComparison: 'limited' })
    expect(submissions(fetchMock)).toHaveLength(2)
  })

  it.each([
    ['changed room arrangement', () => sharp(resultImage.body).flop().png().toBuffer()],
    [
      'same-aspect close crop',
      () =>
        sharp(resultImage.body)
          .extract({ left: 40, top: 25, width: 100, height: 75 })
          .png()
          .toBuffer(),
    ],
    [
      'changed proportions',
      () => sharp(resultImage.body).resize(80, 120, { fit: 'fill' }).png().toBuffer(),
    ],
    ['undecodable photo', async () => Buffer.from('unreadable')],
  ] as const)('vetoes the opening without another request for %s', async (_label, makeImage) => {
    const fetchMock = mockReviews([addedWindow], new Error('Unexpected observation'))
    const changed = { body: await makeImage(), contentType: 'image/png' }
    const review = await reviewConceptImage('test', changed, brief, source)
    expect(review).toMatchObject({
      status: 'checked',
      issues: [],
      sourceComparison: 'limited',
      additionalReviewRequests: 1,
    })
    expect(submissions(fetchMock)).toHaveLength(2)
  })

  it('requires distributed structure even in identical frames', async () => {
    const body = await sharp({
      create: { width: 160, height: 120, channels: 3, background: '#ccc' },
    })
      .png()
      .toBuffer()
    const blank = { body, contentType: 'image/png' }
    mockReviews([addedWindow], new Error('Unexpected observation'))
    const review = await reviewConceptImage('test', blank, brief, blank)
    expect(review).toMatchObject({
      issues: [],
      sourceComparison: 'limited',
      additionalReviewRequests: 1,
    })
  })

  it('still verifies equipment independently when the opening fails the frame check', async () => {
    const changed = {
      body: await sharp(resultImage.body).flop().png().toBuffer(),
      contentType: 'image/png',
    }
    const fetchMock = mockReviews([addedWindow, addedRadiator], {
      roomView: 'broad',
      observations: [{ ...emptyUnderWindow, id: 1 }],
    })
    const review = await reviewConceptImage('test', changed, brief, source)
    expect(review.sourceComparison).toBe('limited')
    expect(review.issues.map(({ detail }) => detail)).toEqual([addedRadiator.detail])
    expect(submissions(fetchMock)).toHaveLength(3)
  })

  it.each([
    { boundaryTypes: ['wall_corner', null] },
    { boundaryTypes: ['wall_corner', 'furniture'] },
    { boundaryTypes: ['wall_corner'] },
    { boundaryTypes: undefined },
  ])(
    'rejects the opening when a wall boundary cannot be identified: %j',
    async ({ boundaryTypes }) => {
      const claim = {
        ...addedWindow,
        sourceCheck: {
          ...addedWindow.sourceCheck,
          location: 'между углом и диваном',
          boundaries: ['угол ниши', 'диван'],
        },
      }
      mockReviews([claim, addedRadiator], {
        roomView: 'broad',
        observations: [
          { id: 0, ...emptyWallSite, boundaryTypes },
          { ...emptyUnderWindow, id: 1 },
        ],
      })
      const review = await reviewConceptImage('test', resultImage, brief, source)
      expect(review.sourceComparison).toBe('limited')
      expect(review.issues.map(({ detail }) => detail)).toEqual([addedRadiator.detail])
    },
  )

  it.each(['empty', 'present'] as const)(
    'does not confirm an empty site in a restricted view for source expectation %s',
    async (state) => {
      const claim = {
        ...addedRadiator,
        sourceCheck: { ...addedRadiator.sourceCheck, expected: state },
      }
      const fetchMock = mockReviews([claim], {
        roomView: 'restricted',
        observations: [emptyUnderWindow],
      })
      const review = await reviewConceptImage('test', resultImage, brief, source)
      expect(review).toMatchObject({
        status: 'checked',
        issues: [],
        sourceComparison: 'limited',
        additionalReviewRequests: 2,
      })
      expect(submissions(fetchMock)).toHaveLength(3)
    },
  )

  it.each([
    'not JSON',
    { description, issues: [explicitBan] },
    { description, issues: [{ ...addedRadiator, sourceCheck: undefined }] },
    { description, issues: [{ ...addedRadiator, code: 'blocked_access' }] },
    new Error('offline'),
  ])('preserves base issues when comparison is invalid: %s', async (comparisonOutput) => {
    const fetchMock = mockReviews([], {}, { baseIssues: [explicitBan], comparisonOutput })
    const review = await reviewConceptImage('test', resultImage, brief, source)
    expect(review).toMatchObject({
      status: 'review',
      sourceComparison: 'unavailable',
      additionalReviewRequests: 1,
      description,
      issues: [
        { code: explicitBan.code, detail: explicitBan.detail, confidence: explicitBan.confidence },
      ],
    })
    expect(submissions(fetchMock)).toHaveLength(2)
  })

  it.each([
    ['malformed JSON', 'not JSON'],
    [
      'missing room scope',
      {
        observations: [
          { id: 0, state: 'empty' },
          { id: 1, state: 'empty' },
        ],
      },
    ],
    ['missing observations', { roomView: 'broad' }],
    ['missing id', { roomView: 'broad', observations: [{ id: 0, state: 'empty' }] }],
    [
      'duplicate id',
      {
        roomView: 'broad',
        observations: [
          { id: 0, state: 'empty' },
          { id: 0, state: 'empty' },
        ],
      },
    ],
    [
      'unknown id',
      {
        roomView: 'broad',
        observations: [
          { id: 0, state: 'empty' },
          { id: 9, state: 'empty' },
        ],
      },
    ],
    [
      'invalid state',
      {
        roomView: 'broad',
        observations: [
          { id: 0, state: 'empty' },
          { id: 1, state: 'probably_empty' },
        ],
      },
    ],
    ['provider failure', new Error('offline')],
  ])('returns unavailable without retry for %s', async (_label, output) => {
    const secondClaim = {
      ...addedRadiator,
      sourceCheck: { object: 'кондиционер', location: 'над телевизором', expected: 'empty' },
    }
    const fetchMock = mockReviews([addedRadiator, secondClaim], output)
    const review = await reviewConceptImage('test', resultImage, brief, source)
    expect(review).toMatchObject({
      status: 'unavailable',
      sourceComparison: 'unavailable',
      additionalReviewRequests: 2,
      issues: [],
    })
    expect(submissions(fetchMock)).toHaveLength(3)
  })

  it('uses one submission without a source', async () => {
    const fetchMock = mockReviews([], {}, { baseIssues: [explicitBan] })
    const review = await reviewConceptImage('test', resultImage, brief)
    expect(review.status).toBe('review')
    expect(submissions(fetchMock)).toHaveLength(1)
  })

  it.each(['other', null, 'unknown'])(
    'does not confirm an opening with a contradictory surface: %s',
    async (surface) => {
      mockReviews(
        [addedWindow, addedRadiator],
        {
          roomView: 'broad',
          observations: [
            { id: 0, ...emptyWallSite, surface },
            { ...emptyUnderWindow, id: 1, surface: 'other' },
          ],
        },
        { baseIssues: [explicitBan] },
      )
      const review = await reviewConceptImage('test', resultImage, brief, source)
      expect(review).toMatchObject({ status: 'review', sourceComparison: 'limited' })
      expect(review.issues).toEqual([
        {
          code: 'brief_conflict',
          detail: `${explicitBan.detail} ${addedRadiator.detail}`,
          confidence: 0.95,
        },
      ])
    },
  )

  it('accepts a consistent wall classification for an opening without a registered box', async () => {
    mockReviews([addedWindow], {
      roomView: 'broad',
      observations: [{ id: 0, ...emptyWallSite, surface: 'continuous_wall' }],
    })
    const review = await reviewConceptImage('test', resultImage, brief, source)
    expect(review).toMatchObject({ status: 'review', sourceComparison: 'verified' })
    expect(review.issues[0]?.code).toBe('opening_conflict')
  })

  it.each([addedWindow, removedRadiator])(
    'keeps a low-confidence $code comparison incomplete without an observer request',
    async (claim) => {
      const fetchMock = mockReviews(
        [{ ...claim, confidence: 0.79 }],
        new Error('Unexpected observer'),
      )
      const review = await reviewConceptImage('test', resultImage, brief, source)
      expect(review).toMatchObject({
        status: 'checked',
        sourceComparison: 'limited',
        additionalReviewRequests: 1,
        issues: [],
      })
      expect(isUsableArchitectureAnchor(review, { layoutNotes: 'Окно на дальней стене.' })).toBe(
        false,
      )
      expect(submissions(fetchMock)).toHaveLength(2)
    },
  )

  it('retains a confirmed change while a second low-confidence change stays incomplete', async () => {
    const fetchMock = mockReviews([addedRadiator, { ...addedWindow, confidence: 0.79 }], {
      roomView: 'broad',
      observations: [emptyUnderWindow],
    })
    const review = await reviewConceptImage('test', resultImage, brief, source)
    expect(review).toMatchObject({ sourceComparison: 'limited', status: 'review' })
    expect(review.issues.map(({ detail }) => detail)).toEqual([addedRadiator.detail])
    const observer = JSON.parse(String(submissions(fetchMock)[2]?.[1]?.body))
    expect(JSON.parse(observer.prompt).map(({ id }: { id: number }) => id)).toEqual([0])
    expect(submissions(fetchMock)).toHaveLength(3)
  })

  it('keeps the confirmed comparison after a full-length result finding of the same code', async () => {
    const longBan = { ...explicitBan, detail: 'Исходное замечание. '.repeat(20).slice(0, 240) }
    mockReviews(
      [addedRadiator],
      { roomView: 'broad', observations: [emptyUnderWindow] },
      { baseIssues: [longBan] },
    )
    const review = await reviewConceptImage('test', resultImage, brief, source)
    expect(review).toMatchObject({ status: 'review', sourceComparison: 'verified' })
    expect(review.issues).toHaveLength(1)
    expect(review.issues[0]?.detail).toBe(`${longBan.detail.trim()} ${addedRadiator.detail}`)
  })

  it.each(['reference', 'result', undefined, 'invented'])(
    'разделяет основание одиночного замечания %s',
    async (basis) => {
      mockReviews([], undefined, {
        baseIssues: [
          {
            code: 'requirement_unconfirmed',
            detail: 'Число чаш требует проверки.',
            confidence: 0.95,
            basis,
            requirementQuote: 'Позднее уточнение клиента.',
          },
        ],
      })
      const review = await reviewConceptImage('test', resultImage, brief, source)
      expect(review.issues.length).toBe(basis === 'result' ? 1 : 0)
      expect(review.imageReview).toBe(basis === 'result' ? 'complete' : 'limited')
    },
  )
  it('делегированное сохранение не скрывает недоступность парного сравнения', async () => {
    mockReviews([], undefined, {
      baseIssues: [
        {
          code: 'requirement_unconfirmed',
          detail: 'Сохранение мойки.',
          confidence: 0.95,
          basis: 'reference',
        },
      ],
      comparisonOutput: 'invalid',
    })
    const review = await reviewConceptImage('test', resultImage, brief, source)
    expect(review.issues).toEqual([])
    expect(review.sourceComparison).toBe('unavailable')
  })

  it.each([
    ['Не оставляй остров.', 'Не оставляй остров.', 'complete', 1],
    ['Оставь только одну чашу.', 'Оставь только одну чашу.', 'complete', 1],
    ['Перекрась дверцы, рамку сохрани.', 'Перекрась дверцы, рамку сохрани.', 'limited', 0],
    [undefined, 'Сохранить мойку с двумя чашами.', 'limited', 0],
    ['Сохранить мойку с двумя чашами.', 'Сохранить мойку с двумя чашами.', 'complete', 0],
    ['мойку с двумя чашами', 'Сохранить мойку с двумя чашами.', 'limited', 0],
    ['Установи мойку с двумя чашами.', 'Установи мойку с двумя чашами.', 'complete', 1],
  ])(
    'связывает уверенное замечание с полным требованием %s',
    async (requirementQuote, revision, completeness, count) => {
      mockReviews([], undefined, {
        baseIssues: [
          {
            code: 'requirement_unconfirmed',
            detail: 'У мойки исчезла чаша.',
            confidence: 0.85,
            basis: 'result',
            requirementQuote,
          },
        ],
      })
      const review = await reviewConceptImage('test', resultImage, { ...brief, revision }, source)
      expect(review.issues).toHaveLength(count)
      expect(review.imageReview).toBe(completeness)
      if (completeness === 'limited') {
        expect(JSON.stringify(review.imageReviewLimitations)).not.toContain('исчезла чаша')
      }
    },
  )

  it('keeps a confirmed opening when five different result findings are already present', async () => {
    const baseIssues = [
      'not_interior',
      'wrong_room',
      'broken_geometry',
      'blocked_access',
      'requirement_unconfirmed',
    ].map((code) => ({
      code,
      detail: `Замечание ${code}`,
      confidence: 0.9,
      basis: 'result',
      requirementQuote: 'Позднее уточнение клиента.',
    }))
    mockReviews(
      [addedWindow],
      { roomView: 'broad', observations: [{ id: 0, ...emptyWallSite }] },
      { baseIssues },
    )
    const review = await reviewConceptImage('test', resultImage, brief, source)
    expect(review).toMatchObject({ status: 'review', sourceComparison: 'verified' })
    expect(review.issues).toHaveLength(6)
    expect(review.issues.map(({ code }) => code)).toEqual([
      ...baseIssues.map(({ code }) => code),
      'opening_conflict',
    ])
    expect(review.issues[5]?.detail).toBe(addedWindow.detail)
  })

  it.each(['bare', undefined] as const)(
    'keeps allowed equipment additions exempt even with low confidence in mode %s',
    async (condition) => {
      const fetchMock = mockReviews(
        [{ ...addedRadiator, confidence: 0.79 }],
        new Error('Unexpected observer'),
      )
      const review = await reviewConceptImage('test', resultImage, { ...brief, condition }, source)
      expect(review).toMatchObject({ sourceComparison: 'verified', issues: [] })
      expect(submissions(fetchMock)).toHaveLength(2)
    },
  )

  it.each(['bare', undefined] as const)(
    'allows added equipment in mode %s without a source observer request',
    async (condition) => {
      const fetchMock = mockReviews([addedRadiator], new Error('Unexpected observation'))
      const review = await reviewConceptImage('test', resultImage, { ...brief, condition }, source)
      expect(review).toMatchObject({
        status: 'checked',
        issues: [],
        sourceComparison: 'verified',
        additionalReviewRequests: 1,
      })
      expect(submissions(fetchMock)).toHaveLength(2)
    },
  )

  it.each(['bare', undefined] as const)(
    'preserves an independent explicit prohibition in mode %s',
    async (condition) => {
      const radiatorBan = {
        ...explicitBan,
        detail: 'Виден радиатор вопреки просьбе без радиатора.',
      }
      const fetchMock = mockReviews([addedRadiator], new Error('Unexpected observation'), {
        baseIssues: [radiatorBan],
      })
      const review = await reviewConceptImage('test', resultImage, { ...brief, condition }, source)
      expect(review).toMatchObject({ status: 'review', additionalReviewRequests: 1 })
      expect(review.issues).toEqual([
        { code: radiatorBan.code, detail: radiatorBan.detail, confidence: radiatorBan.confidence },
      ])
      expect(submissions(fetchMock)).toHaveLength(2)
    },
  )

  it.each(['bare', undefined] as const)(
    'verifies the opening addition and marks the tied disappearance group limited in mode %s',
    async (condition) => {
      const fetchMock = mockReviews([addedRadiator, addedWindow, removedRadiator], {
        roomView: 'broad',
        observations: [{ id: 1, ...emptyWallSite }],
      })
      const review = await reviewConceptImage('test', resultImage, { ...brief, condition }, source)
      expect(review).toMatchObject({
        status: 'review',
        sourceComparison: 'limited',
        additionalReviewRequests: 2,
      })
      expect(review.issues.map((issue) => issue.detail)).toEqual([addedWindow.detail])
      const requests = submissions(fetchMock)
      expect(requests).toHaveLength(3)
      const observer = JSON.parse(String(requests[2]?.[1]?.body))
      expect(JSON.parse(observer.prompt)).toEqual([{ id: 1, object: 'окно', ...wallSite }])
    },
  )

  it('verifies the larger removal group in the result within three requests', async () => {
    const removedDoor = {
      ...removedRadiator,
      code: 'opening_conflict',
      detail: 'Исчезла дверь рядом с аркой.',
      sourceCheck: { object: 'дверь', ...wallSite, expected: 'present' },
    }
    const fetchMock = mockReviews([addedRadiator, removedRadiator, removedDoor], {
      roomView: 'broad',
      observations: [
        { ...emptyUnderWindow, id: 1 },
        { id: 2, ...emptyWallSite },
      ],
    })
    const review = await reviewConceptImage('test', resultImage, brief, source)
    expect(review.sourceComparison).toBe('limited')
    expect(review.issues.map((issue) => issue.detail)).toEqual([
      removedRadiator.detail,
      removedDoor.detail,
    ])
    const requests = submissions(fetchMock)
    expect(requests).toHaveLength(3)
    expect(JSON.parse(String(requests[2]?.[1]?.body)).image_urls).toEqual([resultDataUrl])
  })

  it('validates an addition claim before excluding it under bare mode policy', async () => {
    const fetchMock = mockReviews(
      [{ ...addedRadiator, sourceCheck: { ...addedRadiator.sourceCheck, object: '' } }],
      new Error('Unexpected observation'),
    )
    const review = await reviewConceptImage(
      'test',
      resultImage,
      { ...brief, condition: 'bare' },
      source,
    )
    expect(review).toMatchObject({
      status: 'unavailable',
      sourceComparison: 'unavailable',
      additionalReviewRequests: 1,
    })
    expect(submissions(fetchMock)).toHaveLength(2)
  })

  it.each([{ baseIssues: [] }, { baseIssues: [explicitBan] }])(
    'uses two submissions without comparison findings',
    async ({ baseIssues }) => {
      const fetchMock = mockReviews([], new Error('Unexpected source observation'), {
        baseIssues,
      })
      const review = await reviewConceptImage('test', resultImage, brief, source)
      expect(review.status).toBe(baseIssues.length ? 'review' : 'checked')
      expect(review.additionalReviewRequests).toBe(1)
      expect(submissions(fetchMock)).toHaveLength(2)
    },
  )

  it('limits the source request to the time remaining from the shared deadline', async () => {
    vi.useFakeTimers()
    const timeout = vi.spyOn(AbortSignal, 'timeout')
    const fetchMock = mockReviews(
      [addedRadiator],
      { roomView: 'broad', observations: [emptyUnderWindow] },
      { baseElapsedMs: 30_000, comparisonElapsedMs: 15_000 },
    )
    const review = await reviewConceptImage('test', resultImage, brief, source)
    expect(review.status).toBe('review')
    expect(timeout.mock.calls.map(([ms]) => ms)).toEqual([
      QUALITY_REVIEW_TIMEOUT_MS,
      QUALITY_REVIEW_TIMEOUT_MS - 30_000,
      QUALITY_REVIEW_TIMEOUT_MS - 45_000,
    ])
    expect(submissions(fetchMock)).toHaveLength(3)
  })

  it.each([0, 1])('stops after completed stage %s exhausts the shared deadline', async (stage) => {
    vi.useFakeTimers()
    const fetchMock = mockReviews(
      [addedRadiator],
      {},
      {
        baseElapsedMs: stage === 0 ? QUALITY_REVIEW_TIMEOUT_MS : 30_000,
        comparisonElapsedMs: stage === 1 ? QUALITY_REVIEW_TIMEOUT_MS - 30_000 : 0,
      },
    )
    const review = await reviewConceptImage('test', resultImage, brief, source)
    expect(review).toMatchObject({
      status: 'unavailable',
      sourceComparison: 'unavailable',
      additionalReviewRequests: stage,
    })
    expect(submissions(fetchMock)).toHaveLength(stage + 1)
  })

  it.each([1, 2])(
    'stops hung additional submission %s at the shared deadline without retry',
    async (stage) => {
      vi.useFakeTimers()
      const deadline = Date.now() + QUALITY_REVIEW_TIMEOUT_MS
      let markSubmitted!: (signal: AbortSignal) => void
      const submitted = new Promise<AbortSignal>((resolve) => {
        markSubmitted = resolve
      })
      vi.spyOn(AbortSignal, 'timeout').mockImplementation((ms) => {
        const controller = new AbortController()
        setTimeout(() => controller.abort(), ms)
        return controller.signal
      })
      let call = 0
      const fetchMock = vi.spyOn(globalThis, 'fetch').mockImplementation(async (_url, options) => {
        call += 1
        if (call === stage * 3 + 1) {
          const signal = options?.signal
          if (!signal) throw new Error('Missing timeout signal')
          return new Promise((_resolve, reject) => {
            signal.addEventListener('abort', () => reject(new Error('timeout')), {
              once: true,
            })
            markSubmitted(signal)
          })
        }
        if (call === 1 || call === 4) {
          return Response.json({
            status_url: 'https://queue.fal.run/status',
            response_url: 'https://queue.fal.run/result',
          })
        }
        if (call === 2 || call === 5) return Response.json({ status: 'COMPLETED' })
        vi.setSystemTime(Date.now() + (call === 3 ? 30_000 : 15_000))
        return Response.json({
          output: JSON.stringify({ description, issues: call === 3 ? [] : [addedRadiator] }),
        })
      })
      const pending = reviewConceptImage('test', resultImage, brief, source)
      const signal = await submitted
      const remainingMs = deadline - Date.now()
      expect(remainingMs).toBe(QUALITY_REVIEW_TIMEOUT_MS - (stage === 1 ? 30_000 : 45_000))
      await vi.advanceTimersByTimeAsync(remainingMs - 1)
      expect(signal.aborted).toBe(false)
      await vi.advanceTimersByTimeAsync(1)
      expect(signal.aborted).toBe(true)
      expect(Date.now()).toBe(deadline)
      expect(await pending).toMatchObject({
        status: 'unavailable',
        sourceComparison: 'unavailable',
        additionalReviewRequests: stage,
      })
      expect(submissions(fetchMock)).toHaveLength(stage + 1)
    },
  )
})

describe('явно сохраняемый цвет предмета', () => {
  const request = 'Покрывало сделать терракотовым. Подушки оставить без изменений.'
  const changedPillows = {
    code: 'brief_conflict',
    detail: 'Подушки перекрашены.',
    confidence: 0.95,
    basis: 'reference',
    sourceCheck: {
      object: 'подушки',
      location: 'на кровати под окном',
      expected: 'changed',
      property: 'color',
      before: 'тёмно-синие',
      after: 'терракотовые',
      preservationQuote: 'Подушки оставить без изменений.',
    },
  }
  it('показывает возможное нарушение без запроса проверки пустого места', async () => {
    const fetchMock = mockReviews([changedPillows], undefined)
    const review = await reviewConceptImage(
      'test',
      resultImage,
      { ...brief, revision: request },
      source,
    )
    expect(review.status).toBe('review')
    expect(review.sourceComparison).toBe('limited')
    expect(review.issues).toEqual([
      expect.objectContaining({
        code: 'requirement_unconfirmed',
        detail: expect.stringContaining('подушки'),
      }),
    ])
    expect(submissions(fetchMock)).toHaveLength(2)
  })
  it('не подтверждает старый запрет после разрешённой перекраски', async () => {
    const fetchMock = mockReviews([changedPillows], undefined)
    const review = await reviewConceptImage(
      'test',
      resultImage,
      { ...brief, notes: request, revision: 'Подушки тоже перекрасить.' },
      source,
    )
    expect(review.issues).toEqual([])
    expect(review.sourceComparison).toBe('limited')
    expect(submissions(fetchMock)).toHaveLength(2)
  })
  it.each(['', 'несуществующая цитата'])(
    'оставляет сравнение неполным без проверяемой цитаты %s',
    async (preservationQuote) => {
      const fetchMock = mockReviews(
        [{ ...changedPillows, sourceCheck: { ...changedPillows.sourceCheck, preservationQuote } }],
        undefined,
      )
      const review = await reviewConceptImage(
        'test',
        resultImage,
        { ...brief, revision: request },
        source,
      )
      expect(review.issues).toEqual([])
      expect(review.sourceComparison).toBe('limited')
      expect(submissions(fetchMock)).toHaveLength(2)
    },
  )
  it.each([0.5, 2, Number.NaN])(
    'не подтверждает неподходящую уверенность %s',
    async (confidence) => {
      const fetchMock = mockReviews([{ ...changedPillows, confidence }], undefined)
      const review = await reviewConceptImage(
        'test',
        resultImage,
        { ...brief, revision: request },
        source,
      )
      expect(review.issues).toEqual([])
      expect(review.sourceComparison).not.toBe('verified')
      expect(submissions(fetchMock)).toHaveLength(2)
    },
  )
  it('ограничивает длину описания свойства обычным парсером', async () => {
    mockReviews(
      [
        {
          ...changedPillows,
          sourceCheck: {
            ...changedPillows.sourceCheck,
            before: 'Синий '.repeat(60),
            after: 'Красный '.repeat(60),
          },
        },
      ],
      undefined,
    )
    const review = await reviewConceptImage(
      'test',
      resultImage,
      { ...brief, revision: request },
      source,
    )
    expect(review.issues[0]?.detail.length).toBeLessThanOrEqual(240)
    expect(review.issues[0]?.detail).toContain('Было:')
    expect(review.issues[0]?.detail).toContain('Стало:')
    expect(review.issues[0]?.detail).toMatch(/Сверьте с исходником\.$/)
  })
  it('отделяет сохранение числа частей от нового требования и требует точную цитату списка', async () => {
    const fetchMock = mockReviews([], undefined)
    const request =
      'Перекрась фасады. Плиту, мойку с двумя чашами и столешницу оставить без изменений.'
    await reviewConceptImage('test', resultImage, { ...brief, revision: request }, source)
    const calls = submissions(fetchMock)
    const resultOnly = JSON.parse(String(calls[0]?.[1]?.body))
    const paired = JSON.parse(String(calls[1]?.[1]?.body))
    expect(resultOnly.prompt).toContain(
      'тоже относится к сравнению с исходником, а не к новому требованию количества',
    )
    expect(resultOnly.prompt).toContain('установи мойку с двумя чашами')
    expect(paired.system_prompt).toContain('непрерывной дословной подстрокой')
    expect(paired.system_prompt).toContain('не вставляй многоточие')
    expect(paired.system_prompt).toContain('процитируй всё предложение целиком')
    expect(paired.prompt).toContain(request)
  })
  it('не предлагает считать скрытый покраской рисунок древесины изменением формы', async () => {
    const fetchMock = mockReviews([], undefined)
    const review = await reviewConceptImage(
      'test',
      resultImage,
      {
        ...brief,
        revision: 'Шкаф перекрась зелёным, форму и ручки сохрани.',
      },
      source,
    )
    const body = JSON.parse(String(submissions(fetchMock)[1]?.[1]?.body))
    expect(body.system_prompt).toContain(
      'Не маскируй разрешённую смену цвета или материала как appearance',
    )
    expect(body.system_prompt).toContain('древесный рисунок больше не виден')
    expect(body.system_prompt).toContain('число и форму дверей, ящиков, полок')
    expect(review.issues).toEqual([])
  })
  it('предупреждение о подушках не подтверждает проём без исходных границ', async () => {
    const fetchMock = mockReviews(
      [
        changedPillows,
        {
          ...addedWindow,
          sourceCheck: { object: 'окно', location: 'на стене', expected: 'empty' },
        },
      ],
      undefined,
    )
    const review = await reviewConceptImage(
      'test',
      resultImage,
      { ...brief, revision: request },
      source,
    )
    expect(review.issues.map((issue) => issue.code)).toEqual(['requirement_unconfirmed'])
    expect(review.sourceComparison).toBe('limited')
    expect(submissions(fetchMock)).toHaveLength(2)
  })
  it.each([{ before: 'терракотовые' }, { property: 'position' }, { property: 'size' }])(
    'отклоняет неполное сравнение %j',
    async (patch) => {
      const fetchMock = mockReviews(
        [{ ...changedPillows, sourceCheck: { ...changedPillows.sourceCheck, ...patch } }],
        undefined,
      )
      const review = await reviewConceptImage(
        'test',
        resultImage,
        { ...brief, revision: request },
        source,
      )
      expect(review.sourceComparison).toBe('unavailable')
      expect(review.issues).toEqual([])
      expect(submissions(fetchMock)).toHaveLength(2)
    },
  )
  it.each([
    [2, 1, 'changed', true],
    [1, 2, 'changed', false],
    [undefined, undefined, 'changed', false],
    [2.5, 1, 'changed', false],
    [2, 2, 'unchanged', false],
  ])(
    'сверяет направление подсчёта частей %s -> %s (%s)',
    async (beforeCount, afterCount, state, warning) => {
      const claim = {
        ...changedPillows,
        sourceCheck: {
          object: 'мойка',
          location: 'под окном',
          expected: 'changed',
          property: 'appearance',
          appearanceKind: 'part_count',
          before: 'две чаши',
          after: 'одна чаша',
          beforeCount: 2,
          afterCount: 1,
          preservationQuote: 'Мойку сохранить.',
        },
      }
      const fetchMock = mockReviews([claim], {
        observations: [
          {
            id: 0,
            appearanceKind: 'part_count',
            state,
            before: 'исходная конструкция',
            after: 'конструкция результата',
            confidence: 0.95,
            beforeCount,
            afterCount,
          },
        ],
      })
      const review = await reviewConceptImage(
        'test',
        resultImage,
        { ...brief, revision: 'Мойку сохранить.' },
        source,
      )
      expect(review.issues.length).toBe(warning ? 1 : 0)
      expect(review.sourceComparison).toBe(state === 'unchanged' ? 'verified' : 'limited')
      const observer = JSON.parse(String(submissions(fetchMock)[2]?.[1]?.body))
      expect(observer.prompt).not.toContain('beforeCount')
      expect(observer.prompt).not.toContain('две чаши')
    },
  )

  it.each([
    [undefined, undefined],
    ['structure', undefined],
    [undefined, 'structure'],
    ['part_count', 'structure'],
    ['part_count', 'part_count'],
  ])(
    'не подтверждает конструкцию без согласованного типа и чисел (%s/%s)',
    async (claimKind, observerKind) => {
      const fetchMock = mockReviews(
        [
          {
            ...changedPillows,
            sourceCheck: {
              object: 'мойка',
              location: 'под окном',
              expected: 'changed',
              property: 'appearance',
              appearanceKind: claimKind,
              before: 'две чаши',
              after: 'одна чаша',
              preservationQuote: 'Мойку сохранить.',
            },
          },
        ],
        {
          observations: [
            {
              id: 0,
              state: 'changed',
              appearanceKind: observerKind,
              before: 'две чаши',
              after: 'одна чаша',
              confidence: 0.95,
            },
          ],
        },
      )
      const review = await reviewConceptImage(
        'test',
        resultImage,
        { ...brief, revision: 'Мойку сохранить.' },
        source,
      )
      expect(review.issues).toEqual([])
      expect(review.sourceComparison).toBe('limited')
      expect(submissions(fetchMock)).toHaveLength(3)
    },
  )

  it('замечает замену сохраняемой тумбы табуретом на том же месте без проверки пустоты', async () => {
    const replacement = {
      ...changedPillows,
      sourceCheck: {
        object: 'тумба',
        location: 'между кроватью и окном',
        expected: 'changed',
        property: 'appearance',
        appearanceKind: 'structure',
        before: 'корпус с двумя ящиками',
        after: 'табурет без ящиков',
        preservationQuote: 'Тумбу не менять.',
      },
    }
    const fetchMock = mockReviews([replacement], {
      observations: [
        {
          id: 0,
          appearanceKind: 'structure',
          state: 'changed',
          before: 'два ящика',
          after: 'табурет',
          confidence: 0.95,
        },
      ],
    })
    const review = await reviewConceptImage(
      'test',
      resultImage,
      { ...brief, revision: 'Кровать заменить. Тумбу не менять.' },
      source,
    )
    expect(review).toMatchObject({ status: 'review', sourceComparison: 'limited' })
    expect(review.issues).toEqual([
      expect.objectContaining({
        code: 'requirement_unconfirmed',
        detail: expect.stringContaining('внешнего вида «тумба»'),
      }),
    ])
    expect(submissions(fetchMock)).toHaveLength(3)
  })

  it('разрешённая поздняя замена тумбы отменяет старую цитату сохранения', async () => {
    const fetchMock = mockReviews(
      [
        {
          ...changedPillows,
          sourceCheck: {
            ...changedPillows.sourceCheck,
            property: 'appearance',
            appearanceKind: 'structure',
            object: 'тумба',
            before: 'ящики',
            after: 'табурет',
            preservationQuote: 'Тумбу не менять.',
          },
        },
      ],
      undefined,
    )
    const review = await reviewConceptImage(
      'test',
      resultImage,
      { ...brief, notes: 'Тумбу не менять.', revision: 'Замени тумбу табуретом.' },
      source,
    )
    expect(review.issues).toEqual([])
    expect(review.sourceComparison).toBe('limited')
    expect(submissions(fetchMock)).toHaveLength(2)
  })

  it.each(['unchanged', 'not_visible', 'changed'])(
    'независимый осмотр конструкции %s не получает обвинение первого проверяющего',
    async (state) => {
      const fetchMock = mockReviews(
        [
          {
            ...changedPillows,
            sourceCheck: {
              ...changedPillows.sourceCheck,
              property: 'appearance',
              appearanceKind: 'structure',
              object: 'шкаф',
              before: 'вертикальные ручки',
              after: 'горизонтальные ручки',
              preservationQuote: 'Шкаф не менять.',
            },
          },
        ],
        {
          observations: [
            {
              id: 0,
              state,
              appearanceKind: 'structure',
              before: 'две двери',
              after: state === 'changed' ? 'открытые полки' : 'две двери',
              confidence: 0.95,
            },
          ],
        },
      )
      const review = await reviewConceptImage(
        'test',
        resultImage,
        { ...brief, revision: 'Шкаф не менять.' },
        source,
      )
      expect(review.sourceComparison).toBe(state === 'unchanged' ? 'verified' : 'limited')
      expect(review.issues).toHaveLength(state === 'changed' ? 1 : 0)
      if (state === 'changed') {
        expect(review.issues[0]?.detail).toContain('открытые полки')
        expect(review.issues[0]?.detail).not.toContain('горизонтальные ручки')
      }
      const posted = submissions(fetchMock)
      expect(posted).toHaveLength(3)
      const body = JSON.parse(String(posted[2]?.[1]?.body))
      expect(body.prompt).not.toContain('ручки')
      expect(body.prompt).not.toContain('Шкаф не менять')
      expect(body.image_urls).toEqual([sourceDataUrl, resultDataUrl])
      expect(body.system_prompt).toContain(
        'независимо на каждом кадре проследи внутренние разделители',
      )
      expect(body.system_prompt).toContain(
        'Если число частей на любом кадре неразличимо, верни not_visible',
      )
      expect(body.system_prompt).toContain('before всегда описывает изображение 1')
    },
  )

  it('изменение формы мебели не подтверждает недоказанный проём', async () => {
    const fetchMock = mockReviews(
      [
        {
          ...changedPillows,
          sourceCheck: {
            ...changedPillows.sourceCheck,
            property: 'appearance',
            appearanceKind: 'structure',
            object: 'тумба',
            before: 'два ящика',
            after: 'открытая полка',
            preservationQuote: 'Тумбу не менять.',
          },
        },
        {
          ...addedWindow,
          sourceCheck: { object: 'окно', location: 'на стене', expected: 'empty' },
        },
      ],
      {
        observations: [
          {
            id: 0,
            appearanceKind: 'structure',
            state: 'changed',
            before: 'два ящика',
            after: 'полка',
            confidence: 0.95,
          },
        ],
      },
    )
    const review = await reviewConceptImage(
      'test',
      resultImage,
      { ...brief, revision: 'Тумбу не менять.' },
      source,
    )
    expect(review.issues.map((issue) => issue.code)).toEqual(['requirement_unconfirmed'])
    expect(review.sourceComparison).toBe('limited')
    expect(submissions(fetchMock)).toHaveLength(3)
  })
})
