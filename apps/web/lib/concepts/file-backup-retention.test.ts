import { createHash } from 'node:crypto'
import {
  DeleteObjectCommand,
  GetObjectCommand,
  ListObjectsV2Command,
  S3Client,
} from '@aws-sdk/client-s3'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { validateFileBackupStorage } from '../../../../jobs/scripts/external-file-backup'
import {
  expiredFileBackups,
  pruneFileBackups,
} from '../../../../jobs/scripts/file-backup-retention'

const current = '11111111-1111-4111-8111-111111111111'
const old = '22222222-2222-4222-8222-222222222222'
const source = { endpoint: 'http://127.0.0.1:9000', bucket: 'source' }
const backup = {
  endpoint: source.endpoint,
  bucket: 'backup',
  region: 'test',
  accessKey: 'test',
  secretKey: 'test',
}
const now = new Date('2026-10-05T04:00:00Z')
afterEach(() => vi.restoreAllMocks())

describe('хранение полных файловых копий', () => {
  it.each([false, true])(
    'удаляет только своё просроченное поколение; отказ удаления manifest=%s',
    async (failMarker) => {
      const monthly = '33333333-3333-4333-8333-333333333333'
      const foreign = '44444444-4444-4444-8444-444444444444'
      const sourceId = validateFileBackupStorage(source, backup).sourceId
      const key = 'images/source.png'
      const file = `${createHash('sha256').update(key).digest('hex')}.bin`
      const makeEnvelope = (uploadedAt: string, id = sourceId) =>
        Buffer.from(
          JSON.stringify({
            version: 1,
            kind: 'domitsa-files',
            sourceId: id,
            uploadedAt,
            snapshot: {
              version: 1,
              capturedAt: uploadedAt,
              databaseBackupId: 'test',
              entries: [
                {
                  key,
                  file,
                  bytes: 4,
                  etag: 'revision',
                  sha256: createHash('sha256').update('data').digest('hex'),
                  contentType: 'image/png',
                },
              ],
            },
          }),
        )
      const manifests = new Map([
        [current, makeEnvelope(now.toISOString())],
        [old, makeEnvelope('2026-08-02T04:00:00Z')],
        [monthly, makeEnvelope('2026-08-01T04:00:00Z')],
        [foreign, makeEnvelope('2020-01-02T04:00:00Z', 'a'.repeat(64))],
      ])
      const send = vi
        .fn<(command: unknown) => Promise<unknown>>()
        .mockImplementation(async (command) => {
          if (command instanceof ListObjectsV2Command)
            return {
              IsTruncated: false,
              Contents: [
                ...[...manifests].map(([id, body]) => ({
                  Key: `domitsa-files/v1/${id}/manifest.json`,
                  Size: body.length,
                  ETag: `revision-${id}`,
                })),
                { Key: 'data/coolify/backups/databases/old.dump', Size: 1 },
                { Key: 'domitsa-files/v1/incomplete/objects/file.bin', Size: 1 },
              ],
            }
          if (command instanceof GetObjectCommand) {
            const id = command.input.Key?.split('/')[2]
            const body = id && manifests.get(id)
            if (!body) throw new Error('Unknown fixture')
            return {
              ContentLength: body.length,
              ETag: `revision-${id}`,
              Body: { transformToByteArray: async () => body },
            }
          }
          if (command instanceof DeleteObjectCommand) {
            if (failMarker && command.input.Key?.endsWith('/manifest.json'))
              throw new Error('refused')
            return {}
          }
          throw new Error('Unexpected request')
        })
      vi.spyOn(S3Client.prototype, 'send').mockImplementation(send)
      if (failMarker)
        await expect(pruneFileBackups(source, backup, current, now)).rejects.toThrow('refused')
      else
        expect(await pruneFileBackups(source, backup, current, now)).toEqual({
          checked: 3,
          removed: 1,
        })
      const deletes = send.mock.calls
        .map(([command]) => command)
        .filter((command) => command instanceof DeleteObjectCommand)
      expect(deletes.map((command) => command.input.Key)).toEqual([
        `domitsa-files/v1/${old}/manifest.json`,
        ...(failMarker ? [] : [`domitsa-files/v1/${old}/objects/${file}`]),
      ])
      expect(deletes[0]?.input.IfMatch).toBe(`revision-${old}`)
      expect(deletes.every((command) => command.input.Bucket === backup.bucket)).toBe(true)
    },
  )
  it.each([
    ['2026-10-04T04:00:00Z', false],
    ['2026-09-05T04:00:00Z', false],
    ['2026-09-04T04:00:00Z', true],
    ['2026-09-01T04:00:00Z', false],
    ['2025-10-01T04:00:00Z', true],
    ['2025-11-01T04:00:00Z', false],
    ['2026-08-31T22:00:00Z', false], // В Москве уже первое сентября.
    ['2026-10-06T04:00:00Z', false], // Не удалять будущую отметку по ошибке часов.
  ])('проверяет срок %s', (uploadedAt, remove) => {
    expect(
      expiredFileBackups(
        [
          { generationId: current, uploadedAt: now.toISOString() },
          { generationId: old, uploadedAt },
        ],
        current,
        now,
      ),
    ).toEqual(remove ? [old] : [])
  })
  it('не удаляет последнюю новую копию даже с давней датой', () => {
    expect(
      expiredFileBackups(
        [{ generationId: current, uploadedAt: '2020-01-02T00:00:00Z' }],
        current,
        now,
      ),
    ).toEqual([])
  })
  it('запрещает очистку без новой копии, при дубликатах и неверных датах', () => {
    expect(() => expiredFileBackups([], current, now)).toThrow()
    expect(() =>
      expiredFileBackups([{ generationId: current, uploadedAt: 'wrong' }], current, now),
    ).toThrow()
    expect(() =>
      expiredFileBackups(
        Array(2).fill({ generationId: current, uploadedAt: now.toISOString() }),
        current,
        now,
      ),
    ).toThrow()
  })
  it('не трогает исходный бакет и не очищает ничего без завершённого нового снимка', async () => {
    const send = vi.fn<(command: unknown) => Promise<unknown>>().mockResolvedValue({
      IsTruncated: false,
      Contents: [
        { Key: 'data/coolify/backups/databases/old.dump', Size: 1 },
        { Key: `domitsa-files/v1/${old}/objects/incomplete.bin`, Size: 1 },
      ],
    })
    vi.spyOn(S3Client.prototype, 'send').mockImplementation(send)
    await expect(pruneFileBackups(source, backup, current, now)).rejects.toThrow(/Новый/)
    expect(send.mock.calls.every(([command]) => command instanceof ListObjectsV2Command)).toBe(true)
    await expect(
      pruneFileBackups(source, { ...backup, bucket: source.bucket }, current, now),
    ).rejects.toThrow()
  })
  it('не удаляет ни одной копии при невалидном завершённом manifest', async () => {
    const send = vi
      .fn<(command: unknown) => Promise<unknown>>()
      .mockResolvedValueOnce({
        IsTruncated: false,
        Contents: [{ Key: `domitsa-files/v1/${old}/manifest.json`, Size: 2, ETag: 'revision' }],
      })
      .mockResolvedValueOnce({
        ContentLength: 2,
        ETag: 'revision',
        Body: { transformToByteArray: async () => Buffer.from('{}') },
      })
    vi.spyOn(S3Client.prototype, 'send').mockImplementation(send)
    await expect(pruneFileBackups(source, backup, current, now)).rejects.toThrow()
    expect(
      send.mock.calls.every(
        ([command]) =>
          command instanceof ListObjectsV2Command || command instanceof GetObjectCommand,
      ),
    ).toBe(true)
  })
})
