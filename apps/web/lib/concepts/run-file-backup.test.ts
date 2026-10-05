import { createHash } from 'node:crypto'
import { GetObjectCommand, HeadObjectCommand, S3Client } from '@aws-sdk/client-s3'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({ capture: vi.fn(), upload: vi.fn(), prune: vi.fn() }))
vi.mock('../../../../jobs/scripts/file-snapshot', () => ({ captureFileSnapshot: mocks.capture }))
vi.mock('../../../../jobs/scripts/external-file-backup', async (original) => ({
  ...(await original<typeof import('../../../../jobs/scripts/external-file-backup')>()),
  uploadFileSnapshot: mocks.upload,
}))
vi.mock('../../../../jobs/scripts/file-backup-retention', () => ({ pruneFileBackups: mocks.prune }))

import { runScheduledFileBackup } from '../../../../jobs/scripts/run-file-backup'

const now = new Date('2026-10-05T04:00:00Z')
const archive = Buffer.from('PGDMPdata')
const config = {
  source: {
    endpoint: 'http://127.0.0.1:9000',
    bucket: 'working',
    region: 'test',
    accessKey: 'key',
    secretKey: 'secret',
  },
  backup: {
    endpoint: 'http://127.0.0.1:9000',
    bucket: 'backup',
    region: 'test',
    accessKey: 'key',
    secretKey: 'secret',
  },
  databaseArchive: {
    key: 'data/coolify/backups/databases/test.dump',
    bytes: archive.length,
    createdAt: '2026-10-05T03:00:00Z',
  },
}
async function* chunks(body: Uint8Array) {
  yield body.subarray(0, 2)
  yield body.subarray(2)
}
beforeEach(() => {
  mocks.capture.mockReset().mockResolvedValue({ capturedAt: now.toISOString() })
  mocks.upload.mockReset().mockResolvedValue({
    generationId: '11111111-1111-4111-8111-111111111111',
    files: 3,
    bytes: 20,
  })
  mocks.prune.mockReset().mockResolvedValue({ removed: 0 })
})
afterEach(() => vi.restoreAllMocks())

describe('серверный запуск полной файловой копии', () => {
  it.each(['ok', 'wrong-size', 'truncated', 'wrong-format', 'changed-version'])(
    'проверяет реальный архив БД до capture: %s',
    async (scenario) => {
      let heads = 0
      const send = vi
        .fn<(command: unknown) => Promise<unknown>>()
        .mockImplementation(async (command) => {
          if (command instanceof HeadObjectCommand) {
            heads++
            return {
              ContentLength: scenario === 'wrong-size' ? 1 : archive.length,
              ETag: scenario === 'changed-version' && heads > 1 ? 'changed' : 'revision',
            }
          }
          if (command instanceof GetObjectCommand)
            return {
              ContentLength: archive.length,
              ETag: 'revision',
              Body: chunks(
                scenario === 'truncated'
                  ? archive.subarray(1)
                  : scenario === 'wrong-format'
                    ? Buffer.from('OTHERdata')
                    : archive,
              ),
            }
          throw new Error('Unexpected S3 command')
        })
      vi.spyOn(S3Client.prototype, 'send').mockImplementation(send)
      if (scenario === 'ok') {
        const report = await runScheduledFileBackup(config, now)
        const hash = createHash('sha256').update(archive).digest('hex')
        expect(report).toMatchObject({
          status: 'passed',
          files: 3,
          bytes: 20,
          databaseSha256: hash,
          atomicDatabaseSnapshot: false,
        })
        expect(mocks.capture.mock.calls[0]?.[3]).toBe(`pg-${hash}`)
        expect(mocks.upload.mock.calls[0]?.[4]).toEqual({
          ...config.databaseArchive,
          createdAt: new Date(config.databaseArchive.createdAt).toISOString(),
          sha256: hash,
        })
        expect(mocks.prune).toHaveBeenCalledOnce()
      } else {
        await expect(runScheduledFileBackup(config, now)).rejects.toThrow()
        expect(mocks.capture).not.toHaveBeenCalled()
        expect(mocks.upload).not.toHaveBeenCalled()
        expect(mocks.prune).not.toHaveBeenCalled()
      }
      expect(
        send.mock.calls.every(
          ([command]) =>
            command instanceof HeadObjectCommand || command instanceof GetObjectCommand,
        ),
      ).toBe(true)
    },
  )
  it.each(['2026-10-03T03:00:00Z', '2026-10-06T03:00:00Z'])(
    'не принимает старую или будущую дату БД: %s',
    async (createdAt) => {
      const send = vi.spyOn(S3Client.prototype, 'send')
      await expect(
        runScheduledFileBackup(
          { ...config, databaseArchive: { ...config.databaseArchive, createdAt } },
          now,
        ),
      ).rejects.toMatchObject({ stage: 'database-archive' })
      expect(send).not.toHaveBeenCalled()
      expect(mocks.capture).not.toHaveBeenCalled()
    },
  )
  it('не очищает внешние поколения после неудачной загрузки', async () => {
    const send = vi
      .fn<(command: unknown) => Promise<unknown>>()
      .mockImplementation(async (command) => {
        if (command instanceof HeadObjectCommand)
          return { ContentLength: archive.length, ETag: 'revision' }
        if (command instanceof GetObjectCommand)
          return { ContentLength: archive.length, ETag: 'revision', Body: chunks(archive) }
        throw new Error('Unexpected request')
      })
    vi.spyOn(S3Client.prototype, 'send').mockImplementation(send)
    mocks.upload.mockRejectedValueOnce(new Error('refused'))
    await expect(runScheduledFileBackup(config, now)).rejects.toMatchObject({
      stage: 'external-upload',
    })
    expect(mocks.prune).not.toHaveBeenCalled()
  })
})
