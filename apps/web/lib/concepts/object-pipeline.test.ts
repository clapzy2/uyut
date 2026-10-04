import type { DetectedObject } from '@uyut/ai'
import sharp from 'sharp'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import '../../../../jobs/src/segment-and-match'

type TaskInput = { conceptId: string }

const mocks = vi.hoisted(() => ({
  run: null as ((input: TaskInput) => Promise<unknown>) | null,
  concept: {} as Record<string, unknown>,
  objects: [] as Array<{ label: string; maskUrl?: string }>,
  detect: vi.fn(),
  review: vi.fn(),
  mask: vi.fn(),
  embed: vi.fn(),
  readObject: vi.fn(),
  putObject: vi.fn(),
  countItems: vi.fn(),
  findSimilar: vi.fn(),
  outsideUpdate: vi.fn(),
  outsideDelete: vi.fn(),
  transaction: vi.fn(),
  transactionDelete: vi.fn(),
  transactionInsert: vi.fn(),
  transactionUpdate: vi.fn(),
}))

vi.mock('@trigger.dev/sdk', () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() },
  metadata: { set: vi.fn() },
  task: (definition: { run: (input: TaskInput) => Promise<unknown> }) => {
    mocks.run = definition.run
    return definition
  },
}))

vi.mock('@uyut/ai', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@uyut/ai')>()),
  createFalDetector: () => ({ detect: mocks.detect }),
  createFalSegmenter: () => ({ maskForBox: mocks.mask }),
  reviewDetectedObjects: mocks.review,
}))

vi.mock('@uyut/catalog', () => ({
  countItems: mocks.countItems,
  findSimilar: mocks.findSimilar,
  subcategoryForLabel: () => 'sofa',
}))

vi.mock('../../../../jobs/src/lib/env', () => ({ requireEnv: () => 'local-test-only' }))
vi.mock('../../../../jobs/src/lib/embed-catalog', () => ({
  voyageOrNull: () => ({ embed: mocks.embed, dimensions: 2 }),
}))
vi.mock('../../../../jobs/src/lib/s3', () => ({
  readObject: mocks.readObject,
  putObject: mocks.putObject,
}))
vi.mock('../../../../jobs/src/lib/db', () => ({
  db: () => {
    const selection = {
      from: vi.fn().mockReturnThis(),
      innerJoin: vi.fn().mockReturnThis(),
      where: vi.fn().mockReturnThis(),
      limit: async () => [
        {
          concept: mocks.concept,
          room: { id: 'room-test', kind: 'living' },
          project: { id: 'project-test', budgetKopecks: null },
        },
      ],
    }
    return {
      select: () => selection,
      update: () => ({ set: mocks.outsideUpdate }),
      delete: mocks.outsideDelete,
      transaction: mocks.transaction,
    }
  },
}))

const conceptId = 'd81c7c73-01f0-4e41-8288-9470ae7c8c77'
const renderUrl = 'local-test/render.png'
const sofa: DetectedObject = {
  label: 'Диван',
  category: 'sofa',
  bbox: { x: 0.2, y: 0.2, w: 0.5, h: 0.5 },
  area: 0.25,
}

function runTask(): Promise<unknown> {
  if (!mocks.run) throw new Error('task.run не зарегистрирован')
  return mocks.run({ conceptId })
}

function expectRenderUnchanged(): void {
  expect(mocks.concept.status).toBe('ready')
  expect(mocks.concept.renderUrl).toBe(renderUrl)
}

describe('проверка предметов до платного подбора и замены сохранённых данных', () => {
  beforeEach(async () => {
    vi.clearAllMocks()
    mocks.concept = {
      id: conceptId,
      status: 'ready',
      renderUrl,
      objectsStatus: 'ready',
      objectsError: null,
    }
    mocks.objects = [{ label: 'Прежний проверенный диван' }]
    const image = await sharp({
      create: { width: 20, height: 20, channels: 3, background: '#bc6540' },
    })
      .png()
      .toBuffer()
    mocks.readObject.mockReset().mockResolvedValue({ body: image, contentType: 'image/png' })
    mocks.detect.mockReset().mockResolvedValue([sofa])
    mocks.review.mockReset().mockResolvedValue([sofa])
    mocks.mask.mockReset().mockRejectedValue(new Error('SAM unavailable'))
    mocks.embed.mockReset().mockResolvedValue([[0.5, 0.2]])
    mocks.putObject.mockReset().mockResolvedValue(undefined)
    mocks.countItems.mockReset().mockResolvedValue({ embedded: 0 })
    mocks.findSimilar.mockReset().mockResolvedValue([])
    mocks.outsideUpdate.mockImplementation((values: Record<string, unknown>) => ({
      where: async () => {
        Object.assign(mocks.concept, values)
      },
    }))
    mocks.transactionDelete.mockImplementation(() => ({
      where: async () => {
        mocks.objects = []
      },
    }))
    mocks.transactionInsert.mockImplementation(() => ({
      values: async (objects: Array<{ label: string }>) => {
        mocks.objects = objects
      },
    }))
    mocks.transactionUpdate.mockImplementation((values: Record<string, unknown>) => ({
      where: async () => {
        Object.assign(mocks.concept, values)
      },
    }))
    mocks.transaction.mockImplementation(async (work: (transaction: unknown) => Promise<void>) => {
      await work({
        delete: mocks.transactionDelete,
        insert: mocks.transactionInsert,
        update: () => ({ set: mocks.transactionUpdate }),
      })
    })
  })

  it('сбой проверки останавливает SAM и подбор, не трогая рендер и прежние предметы', async () => {
    mocks.review.mockRejectedValueOnce(new Error('vision unavailable'))

    await expect(runTask()).rejects.toThrow('vision unavailable')

    expect(mocks.mask).not.toHaveBeenCalled()
    expect(mocks.embed).not.toHaveBeenCalled()
    expect(mocks.findSimilar).not.toHaveBeenCalled()
    expect(mocks.putObject).not.toHaveBeenCalled()
    expect(mocks.outsideDelete).not.toHaveBeenCalled()
    expect(mocks.transaction).not.toHaveBeenCalled()
    expect(mocks.objects).toEqual([{ label: 'Прежний проверенный диван' }])
    expect(mocks.outsideUpdate).toHaveBeenCalledExactlyOnceWith({
      objectsStatus: 'failed',
      objectsError: 'Error: vision unavailable',
    })
    expectRenderUnchanged()
  })

  it('отклонение всех предметов сохраняет готовый пустой результат в одной транзакции', async () => {
    mocks.review.mockResolvedValueOnce([])

    await expect(runTask()).resolves.toMatchObject({
      conceptId,
      objects: 0,
      matched: 0,
      skipped: false,
    })

    expect(mocks.mask).not.toHaveBeenCalled()
    expect(mocks.embed).not.toHaveBeenCalled()
    expect(mocks.findSimilar).not.toHaveBeenCalled()
    expect(mocks.putObject).not.toHaveBeenCalled()
    expect(mocks.transaction).toHaveBeenCalledTimes(1)
    expect(mocks.transactionDelete).toHaveBeenCalledTimes(1)
    expect(mocks.transactionInsert).not.toHaveBeenCalled()
    expect(mocks.transactionUpdate).toHaveBeenCalledExactlyOnceWith({
      objectsStatus: 'ready',
      objectsError: null,
    })
    expect(mocks.outsideUpdate).not.toHaveBeenCalled()
    expect(mocks.outsideDelete).not.toHaveBeenCalled()
    expect(mocks.objects).toEqual([])
    expect(mocks.concept.objectsStatus).toBe('ready')
    expectRenderUnchanged()
  })

  it('сбой векторов не удаляет прежние предметы и не начинает транзакцию замены', async () => {
    mocks.embed.mockRejectedValueOnce(new Error('embedding unavailable'))

    await expect(runTask()).rejects.toThrow('embedding unavailable')

    expect(mocks.review).toHaveBeenCalledTimes(1)
    expect(mocks.mask).toHaveBeenCalledTimes(1)
    expect(mocks.embed).toHaveBeenCalledTimes(1)
    expect(mocks.findSimilar).not.toHaveBeenCalled()
    expect(mocks.outsideDelete).not.toHaveBeenCalled()
    expect(mocks.transaction).not.toHaveBeenCalled()
    expect(mocks.transactionDelete).not.toHaveBeenCalled()
    expect(mocks.objects).toEqual([{ label: 'Прежний проверенный диван' }])
    expect(mocks.concept.objectsStatus).toBe('failed')
    expectRenderUnchanged()
  })

  it('сбой поиска товара происходит до замены прежнего подбора', async () => {
    mocks.countItems.mockResolvedValueOnce({ embedded: 1 })
    mocks.findSimilar.mockRejectedValueOnce(new Error('catalog unavailable'))

    await expect(runTask()).rejects.toThrow('catalog unavailable')

    expect(mocks.embed).toHaveBeenCalledTimes(1)
    expect(mocks.findSimilar).toHaveBeenCalledTimes(1)
    expect(mocks.outsideDelete).not.toHaveBeenCalled()
    expect(mocks.transaction).not.toHaveBeenCalled()
    expect(mocks.objects).toEqual([{ label: 'Прежний проверенный диван' }])
    expect(mocks.concept.objectsStatus).toBe('failed')
    expectRenderUnchanged()
  })

  it.each([
    { reason: 'нет векторов', vectors: [] },
    { reason: 'неполная размерность', vectors: [[0.5]] },
    { reason: 'пустой вектор', vectors: [[]] },
    { reason: 'нечисловое значение', vectors: [[Number.NaN, 0.2]] },
    { reason: 'бесконечное значение', vectors: [[Number.POSITIVE_INFINITY, 0.2]] },
    {
      reason: 'лишний вектор',
      vectors: [
        [0.5, 0.2],
        [0.3, 0.4],
      ],
    },
  ])(
    'не заменяет прежние предметы при повреждённом ответе embedding: $reason',
    async ({ vectors }) => {
      mocks.embed.mockResolvedValueOnce(vectors)

      await expect(runTask()).rejects.toThrow('Не удалось подготовить все векторы предметов')

      expect(mocks.findSimilar).not.toHaveBeenCalled()
      expect(mocks.outsideDelete).not.toHaveBeenCalled()
      expect(mocks.transaction).not.toHaveBeenCalled()
      expect(mocks.objects).toEqual([{ label: 'Прежний проверенный диван' }])
      expect(mocks.concept.objectsStatus).toBe('failed')
      expectRenderUnchanged()
    },
  )

  it('повторные попытки не перезаписывают маску прежнего сохранённого подбора', async () => {
    const oldMaskKey = `projects/project-test/rooms/room-test/concepts/${conceptId}/objects/old-review/0-mask.png`
    const oldObjects = [{ label: 'Прежний проверенный диван', maskUrl: oldMaskKey }]
    mocks.objects = oldObjects
    const pixels = Buffer.alloc(400)
    pixels[10 * 20 + 10] = 255
    const maskBody = await sharp(pixels, { raw: { width: 20, height: 20, channels: 1 } })
      .png()
      .toBuffer()
    mocks.mask.mockResolvedValue({ body: maskBody })
    mocks.embed.mockRejectedValue(new Error('embedding unavailable'))

    await expect(runTask()).rejects.toThrow('embedding unavailable')
    await expect(runTask()).rejects.toThrow('embedding unavailable')

    expect(mocks.putObject).toHaveBeenCalledTimes(2)
    const keys = mocks.putObject.mock.calls.map(([key]) => key as string)
    const prefix = `projects/project-test/rooms/room-test/concepts/${conceptId}/objects/`
    for (const key of keys) {
      expect(key.startsWith(prefix)).toBe(true)
      expect(key.slice(prefix.length)).toMatch(/^[0-9a-f-]{36}\/0-mask\.png$/)
      expect(key).not.toBe(oldMaskKey)
    }
    expect(keys[0]).not.toBe(keys[1])
    expect(mocks.transaction).not.toHaveBeenCalled()
    expect(mocks.objects).toEqual(oldObjects)
    expectRenderUnchanged()
  })

  it('сохраняет принятый предмет с рамкой без maskUrl при недоступности SAM', async () => {
    await expect(runTask()).resolves.toMatchObject({
      conceptId,
      objects: 1,
      matched: 0,
      skipped: false,
    })

    expect(mocks.review).toHaveBeenCalledTimes(1)
    expect(mocks.embed).toHaveBeenCalledTimes(1)
    expect(mocks.putObject).not.toHaveBeenCalled()
    expect(mocks.transaction).toHaveBeenCalledTimes(1)
    expect(mocks.objects).toEqual([
      expect.objectContaining({ label: 'Диван', maskUrl: null, embedding: [0.5, 0.2] }),
    ])
    expect(mocks.concept.objectsStatus).toBe('ready')
    expectRenderUnchanged()
  })
})
