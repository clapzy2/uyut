import { afterEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({ send: vi.fn() }))
vi.mock('@aws-sdk/client-s3', () => ({
  S3Client: class {
    send = mocks.send
  },
  PutObjectCommand: class {
    constructor(readonly input: unknown) {}
  },
  GetObjectCommand: class {},
}))
vi.mock('../../../../jobs/src/lib/env', () => ({ requireEnv: () => 'test-storage' }))

import { putObject } from '../../../../jobs/src/lib/s3'

afterEach(() => vi.resetAllMocks())

describe('Загрузка PDF в хранилище', () => {
  it('передаёт ограничение времени в SDK, сохраняя данные файла', async () => {
    const signal = new AbortController().signal
    const body = Buffer.from('%PDF-1.7')
    mocks.send.mockResolvedValue({})
    await putObject('qa/document.pdf', body, 'application/pdf', signal)
    expect(mocks.send).toHaveBeenCalledExactlyOnceWith(
      expect.objectContaining({
        input: {
          Bucket: 'test-storage',
          Key: 'qa/document.pdf',
          Body: body,
          ContentType: 'application/pdf',
        },
      }),
      { abortSignal: signal },
    )
  })

  it('сохраняет вызовы остальных загрузок без нового обязательного параметра', async () => {
    mocks.send.mockResolvedValue({})
    await putObject('qa/image.jpg', Buffer.from('image'), 'image/jpeg')
    expect(mocks.send).toHaveBeenCalledWith(expect.anything(), { abortSignal: undefined })
  })
})
