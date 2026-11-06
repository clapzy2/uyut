import { isUsableArchitectureAnchor, QUALITY_REVIEW_TIMEOUT_MS, reviewConceptImage } from '@uyut/ai'
import { afterEach, describe, expect, it, vi } from 'vitest'

const description = 'Гостиная с окном и диваном.'
const source = { body: Buffer.from('source'), contentType: 'image/png' }
const resultImage = { body: Buffer.from('result'), contentType: 'image/jpeg' }
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
const explicitBan = {
  code: 'brief_conflict',
  detail: 'Виден остров вопреки просьбе без острова.',
  confidence: 0.95,
  basis: 'result',
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

describe('independent source observation', () => {
  it('confirms an addition using only source pixels and a neutral object/location question', async () => {
    const fetchMock = mockReviews(
      [addedRadiator],
      { roomView: 'broad', observations: [{ id: 0, state: 'empty' }] },
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
    expect(observer.image_urls).toEqual(['data:image/png;base64,c291cmNl'])
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
      'data:image/jpeg;base64,cmVzdWx0',
    ]) {
      expect(body).not.toContain(privateInput)
    }
  })

  it.each(['present', 'not_visible'])(
    'drops an alleged addition when source state is %s and marks comparison limited',
    async (state) => {
      mockReviews([addedRadiator], { roomView: 'broad', observations: [{ id: 0, state }] })
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

  it('confirms a disappearance only when its expected source object is present', async () => {
    const removedRadiator = {
      ...addedRadiator,
      detail: 'Исчез радиатор под окном.',
      sourceCheck: { ...addedRadiator.sourceCheck, expected: 'present' },
    }
    mockReviews([removedRadiator], {
      roomView: 'broad',
      observations: [{ id: 0, state: 'present' }],
    })
    const review = await reviewConceptImage('test', resultImage, brief, source)
    expect(review).toMatchObject({ status: 'review', sourceComparison: 'verified' })
    expect(review.issues[0]?.detail).toBe(removedRadiator.detail)
  })

  it.each(['empty', 'present'] as const)(
    'does not confirm a change from a restricted source even when its state matches %s',
    async (state) => {
      const claim = {
        ...addedRadiator,
        sourceCheck: { ...addedRadiator.sourceCheck, expected: state },
      }
      const fetchMock = mockReviews([claim], {
        roomView: 'restricted',
        observations: [{ id: 0, state }],
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
    'still verifies opening additions and equipment disappearance in mode %s',
    async (condition) => {
      const addedWindow = {
        ...addedRadiator,
        code: 'opening_conflict',
        detail: 'Добавлено окно на дальней стене.',
        sourceCheck: { object: 'окно', location: 'дальняя стена', expected: 'empty' },
      }
      const removedRadiator = {
        ...addedRadiator,
        detail: 'Исчез сохраняемый радиатор под окном.',
        sourceCheck: { ...addedRadiator.sourceCheck, expected: 'present' },
      }
      const fetchMock = mockReviews([addedRadiator, addedWindow, removedRadiator], {
        roomView: 'broad',
        observations: [
          { id: 1, state: 'empty' },
          { id: 2, state: 'present' },
        ],
      })
      const review = await reviewConceptImage('test', resultImage, { ...brief, condition }, source)
      expect(review).toMatchObject({
        status: 'review',
        sourceComparison: 'verified',
        additionalReviewRequests: 2,
      })
      expect(review.issues.map((issue) => issue.detail)).toEqual([
        addedWindow.detail,
        removedRadiator.detail,
      ])
      const requests = submissions(fetchMock)
      expect(requests).toHaveLength(3)
      const observer = JSON.parse(String(requests[2]?.[1]?.body))
      expect(JSON.parse(observer.prompt)).toEqual([
        { id: 1, object: 'окно', location: 'дальняя стена' },
        { id: 2, object: 'радиатор', location: 'под окном' },
      ])
    },
  )

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
      { roomView: 'broad', observations: [{ id: 0, state: 'empty' }] },
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
      vi.spyOn(AbortSignal, 'timeout').mockImplementation((ms) => {
        const controller = new AbortController()
        setTimeout(() => controller.abort(), ms)
        return controller.signal
      })
      let call = 0
      const fetchMock = vi.spyOn(globalThis, 'fetch').mockImplementation(async (_url, options) => {
        call += 1
        if (call === stage * 3 + 1) {
          return new Promise((_resolve, reject) => {
            options?.signal?.addEventListener('abort', () => reject(new Error('timeout')), {
              once: true,
            })
          })
        }
        if (call === 1 || call === 4) {
          return Response.json({
            status_url: 'https://queue.fal.run/status',
            response_url: 'https://queue.fal.run/result',
          })
        }
        if (call === 2 || call === 5) return Response.json({ status: 'COMPLETED' })
        await new Promise((resolve) => setTimeout(resolve, call === 3 ? 30_000 : 15_000))
        return Response.json({
          output: JSON.stringify({ description, issues: call === 3 ? [] : [addedRadiator] }),
        })
      })
      const pending = reviewConceptImage('test', resultImage, brief, source)
      await vi.advanceTimersByTimeAsync(QUALITY_REVIEW_TIMEOUT_MS)
      expect(await pending).toMatchObject({
        status: 'unavailable',
        sourceComparison: 'unavailable',
        additionalReviewRequests: stage,
      })
      expect(submissions(fetchMock)).toHaveLength(stage + 1)
    },
  )
})
