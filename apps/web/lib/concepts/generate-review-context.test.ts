import type { ConceptBrief } from '@uyut/ai'
import sharp from 'sharp'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { generateConcept } from '../../../../jobs/src/generate-concept'

const mocks = vi.hoisted(() => ({
  db: vi.fn(),
  render: vi.fn(),
  review: vi.fn(),
  correction: vi.fn(),
  read: vi.fn(),
  crop: vi.fn(),
  rows: [] as Array<Record<string, unknown>>,
  saved: [] as Array<Record<string, unknown>>,
}))

vi.mock('@trigger.dev/sdk', () => ({
  task: (definition: unknown) => definition,
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() },
  metadata: { set: vi.fn() },
}))
vi.mock('../../../../jobs/src/lib/db', () => ({ db: mocks.db }))
vi.mock('../../../../jobs/src/lib/env', () => ({ requireEnv: () => 'test' }))
vi.mock('../../../../jobs/src/lib/s3', () => ({ readObject: mocks.read, putObject: vi.fn() }))
vi.mock('../../../../jobs/src/segment-and-match', () => ({
  cropObject: mocks.crop,
  segmentAndMatch: { trigger: vi.fn() },
}))
vi.mock('@uyut/ai', async (original) => ({
  ...(await original<typeof import('@uyut/ai')>()),
  createFalRenderer: () => ({ render: mocks.render }),
  createPromptBuilder: () => ({
    build: async () => ({
      shared: 'room',
      variations: ['Add a radiator as a style suggestion.', 'Add air conditioning.'],
      mandate: 'style',
      source: 'test',
    }),
  }),
  reviewConceptImage: mocks.review,
  layoutCorrectionPrompt: mocks.correction,
  isLayoutCorrectionImprovement: () => true,
}))

const checked = { status: 'checked', issues: [], description: 'Гостиная.' }
const payload = {
  roomId: '10000000-0000-4000-8000-000000000001',
  batchId: '10000000-0000-4000-8000-000000000002',
  revision: 'Keep the television.',
}
const variations = [
  { title: 'Первый', idea: 'Тепло', revision: 'Add a radiator below the window.' },
  { title: 'Второй', idea: 'Прохлада', revision: 'Add an air conditioner on the right.' },
]
// SDK task registration is replaced with its definition; the actual job body still runs.
const run = (generateConcept as unknown as { run: (input: unknown) => Promise<{ done: number }> })
  .run

function setupDatabase(hasPhoto: boolean) {
  const row = {
    room: {
      id: payload.roomId,
      kind: 'living',
      name: 'QA',
      areaM2: '20',
      condition: 'finished',
      notes: 'Сохранить всё остальное.',
      photoUrl: hasPhoto ? 'source.webp' : null,
      measurements: { layoutNotes: 'Одно окно на дальней стене.' },
    },
    project: { id: 'qa', styleReferenceEmbedding: null },
  }
  const query = {
    from: () => query,
    innerJoin: () => query,
    where: () => query,
    limit: async () => [row],
  }
  mocks.db.mockReturnValue({
    select: () => query,
    insert: () => ({
      values: (rows: Array<Record<string, unknown>>) => ({
        returning: async () => {
          mocks.rows = rows.map((entry, index) => ({ ...entry, id: `concept-${index}` }))
          return mocks.rows
        },
      }),
    }),
    update: () => ({
      set: (values: Record<string, unknown>) => {
        mocks.saved.push(values)
        return { where: async () => undefined }
      },
    }),
  })
  return row
}

beforeEach(async () => {
  vi.clearAllMocks()
  mocks.saved = []
  const body = await sharp({ create: { width: 4, height: 4, channels: 3, background: 'white' } })
    .png()
    .toBuffer()
  mocks.render.mockResolvedValue({ body, contentType: 'image/png', seed: 1 })
  mocks.read.mockResolvedValue({ body, contentType: 'image/png' })
  mocks.crop.mockResolvedValue(body)
  mocks.review.mockResolvedValue(checked)
  mocks.correction.mockReturnValue(null)
})

describe('пожелания конкретного варианта в автосверке', () => {
  it('передаёт вырезку исходного фото в шаг установки без концепта-основы', async () => {
    const row = setupDatabase(true)
    Object.assign(row.room, { condition: 'keep', photoRevision: 3 })
    const editRequest = 'Убрать комод справа и поставить этот же комод под окном.'
    mocks.review.mockResolvedValue({ ...checked, sourceComparison: 'verified' })
    expect(
      await run({
        ...payload,
        count: 1,
        editRequest,
        sourceObject: { photoRevision: 3, box: { x: 0.5, y: 0.5, w: 0.5, h: 0.5 } },
        editSteps: [
          { titleRu: 'Убрать', prompt: 'Remove cabinet', needsObject: false },
          { titleRu: 'Поставить', prompt: 'Place cabinet below window', needsObject: true },
        ],
      }),
    ).toMatchObject({ done: 1, renderRequests: 2 })
    expect(mocks.crop).toHaveBeenCalledTimes(1)
    expect(mocks.rows[0]?.editRequest).toBe(editRequest)
    expect(mocks.saved.find((value) => value.status === 'ready')?.qualityReview).toMatchObject({
      sourceComparison: 'verified',
      furnitureIdentity: 'manual',
    })
    expect(mocks.render.mock.calls.filter(([request]) => request.referenceUrls).length).toBe(1)
    expect(
      mocks.render.mock.calls
        .filter(([request]) => request.prompt.includes('Remove cabinet'))
        .every(([request]) => !request.referenceUrls),
    ).toBe(true)
  })
  it('прикладывает отдельное фото предмета, сохраняя фото комнаты основой', async () => {
    const row = setupDatabase(true)
    Object.assign(row.room, { condition: 'keep', photoRevision: 3 })
    const key = `projects/${row.project.id}/rooms/${row.room.id}/furniture-references/reference.webp`
    Object.assign(row.room, { furnitureReference: { key, photoRevision: 3 } })
    const furniture = await sharp({
      create: { width: 4, height: 4, channels: 3, background: 'red' },
    })
      .png()
      .toBuffer()
    const roomImage = (await mocks.read()).body
    mocks.read.mockImplementation(async (path: string) => ({
      body: path === key ? furniture : roomImage,
      contentType: 'image/png',
    }))
    expect(
      await run({
        ...payload,
        count: 1,
        referencePhoto: { key, photoRevision: 3 },
        editSteps: [
          { titleRu: 'Убрать', prompt: 'Remove cabinet', needsObject: false },
          { titleRu: 'Поставить', prompt: 'Place cabinet under window', needsObject: true },
        ],
      }),
    ).toMatchObject({ done: 1, renderRequests: 2 })
    expect(mocks.crop).not.toHaveBeenCalled()
    // Проверка комнаты не доказывает совпадение с отдельным предметным снимком.
    expect(mocks.review).toHaveBeenCalledTimes(1)
    expect(mocks.saved.find((value) => value.status === 'ready')?.qualityReview).toMatchObject({
      furnitureIdentity: 'manual',
    })
    expect(mocks.render.mock.calls[0]?.[0].imageUrl).toBe(
      `data:image/png;base64,${roomImage.toString('base64')}`,
    )
    expect(mocks.render.mock.calls[1]?.[0].referenceUrls).toEqual([
      `data:image/png;base64,${furniture.toString('base64')}`,
    ])
  })
  it.each(['old-revision', 'foreign-room', 'lost-file', 'detached', 'replaced'])(
    'не рисует при непригодном втором фото: %s',
    async (reason) => {
      const row = setupDatabase(true)
      Object.assign(row.room, { condition: 'keep', photoRevision: 4 })
      const key =
        reason === 'foreign-room'
          ? 'projects/other/rooms/other/furniture-references/reference.webp'
          : `projects/${row.project.id}/rooms/${row.room.id}/furniture-references/reference.webp`
      Object.assign(row.room, {
        furnitureReference:
          reason === 'detached'
            ? null
            : {
                key: reason === 'replaced' ? key.replace('reference.webp', 'new.webp') : key,
                photoRevision: 4,
              },
      })
      if (reason === 'lost-file') mocks.read.mockRejectedValue(new Error('missing file'))
      await expect(
        run({
          ...payload,
          referencePhoto: { key, photoRevision: reason === 'old-revision' ? 3 : 4 },
          editSteps: [{ titleRu: 'Поставить', prompt: 'Place cabinet', needsObject: true }],
        }),
      ).rejects.toThrow()
      expect(mocks.render).not.toHaveBeenCalled()
    },
  )
  it('не рендерит перенос по выделению со старого фото', async () => {
    const row = setupDatabase(true)
    Object.assign(row.room, { condition: 'keep', photoRevision: 4 })
    await expect(
      run({
        ...payload,
        sourceObject: { photoRevision: 3, box: { x: 0.5, y: 0.5, w: 0.5, h: 0.5 } },
      }),
    ).rejects.toThrow('Фото изменилось')
    expect(mocks.crop).not.toHaveBeenCalled()
    expect(mocks.render).not.toHaveBeenCalled()
  })
  it.each([
    [true, 0],
    [true, 1],
    [true, 2],
    [false, 0],
    [false, 1],
    [false, 2],
  ] as const)(
    'учитывает дополнительные проверки, исходное фото: %s, запросов: %s',
    async (hasPhoto, additionalReviewRequests) => {
      setupDatabase(hasPhoto)
      mocks.review.mockResolvedValue({ ...checked, additionalReviewRequests })
      expect(await run({ ...payload, count: 2 })).toMatchObject({
        done: 2,
        reviewRequests: 2 * (1 + additionalReviewRequests),
      })
      expect(mocks.review).toHaveBeenCalledTimes(2)
    },
  )

  it.each([true, false])('не смешивает duo-пожелания, исходное фото: %s', async (hasPhoto) => {
    setupDatabase(hasPhoto)
    const images = await Promise.all(
      ['red', 'blue'].map((background) =>
        sharp({ create: { width: 4, height: 4, channels: 3, background } })
          .png()
          .toBuffer(),
      ),
    )
    const reviewImages = await Promise.all(
      images.map((body) => sharp(body).jpeg({ quality: 85 }).toBuffer()),
    )
    mocks.render.mockImplementation(async ({ seed }: { seed: number }) => ({
      body: images[seed - 1000],
      contentType: 'image/png',
      seed,
    }))
    expect(await run({ ...payload, duo: { variations } })).toMatchObject({ done: 2 })
    const briefs = mocks.review.mock.calls.map((call) => call[2])
    expect(briefs).toHaveLength(2)
    // Параллельная подготовка изображений может закончиться в любом порядке.
    // Проверяем пожелание по самой картинке, а не по очередности вызовов.
    for (const [index, image] of reviewImages.entries()) {
      const calls = mocks.review.mock.calls.filter((call) => call[1].body.equals(image))
      expect(calls).toHaveLength(1)
      expect(calls[0]?.[2].requestedVariant).toBe(variations[index]?.revision)
    }
    expect(briefs.every((brief) => brief.revision === payload.revision)).toBe(true)
    expect(briefs.every((brief) => brief.notes === 'Сохранить всё остальное.')).toBe(true)
    expect(mocks.review.mock.calls.every((call) => Boolean(call[3]) === hasPhoto)).toBe(true)
    expect(mocks.render).toHaveBeenCalledTimes(2)
  })

  it('не принимает автоматическое стилевое предложение за разрешение человека', async () => {
    setupDatabase(true)
    expect(await run({ ...payload, count: 2 })).toMatchObject({ done: 2 })
    expect(mocks.rows[0]?.prompt).toContain('Add a radiator as a style suggestion.')
    expect(mocks.review.mock.calls.every((call) => call[2].requestedVariant === undefined)).toBe(
      true,
    )
  })

  it('сохраняет контекст конкретного варианта при повторной сверке исправления', async () => {
    setupDatabase(true)
    mocks.review.mockImplementation(
      async (_key, _image, brief: ConceptBrief & { requestedVariant?: string }) =>
        brief.requestedVariant === variations[0]?.revision
          ? {
              ...checked,
              status: 'review',
              issues: [{ code: 'requirement_unconfirmed' }],
              additionalReviewRequests: 2,
            }
          : checked,
    )
    mocks.correction.mockImplementation((review) =>
      review.status === 'review' ? 'Fix layout.' : null,
    )
    expect(await run({ ...payload, duo: { variations } })).toMatchObject({
      done: 2,
      reviewRequests: 7,
    })
    expect(mocks.review).toHaveBeenCalledTimes(3)
    const briefs = mocks.review.mock.calls.map((call) => call[2])
    expect(
      briefs.filter((brief) => brief.requestedVariant === variations[0]?.revision),
    ).toHaveLength(2)
    expect(
      briefs.filter((brief) => brief.requestedVariant === variations[1]?.revision),
    ).toHaveLength(1)
    expect(briefs.every((brief) => brief.revision === payload.revision)).toBe(true)
  })
})
