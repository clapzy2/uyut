import { createHash } from 'node:crypto'
import { lstat, mkdtemp, readFile, rm, symlink, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import {
  CreateBucketCommand,
  GetObjectCommand,
  HeadBucketCommand,
  ListObjectsV2Command,
  PutObjectCommand,
  S3Client,
} from '@aws-sdk/client-s3'
import { afterEach, beforeEach, describe, expect, it, type Mock, vi } from 'vitest'
import {
  captureFileSnapshot,
  inventoryFileSnapshot,
  loadFileSnapshot,
  parseFileSnapshotManifest,
  restoreFileSnapshot,
} from '../../../../jobs/scripts/file-snapshot'

const endpoint = 'http://127.0.0.1:58333'
const bucket = 'domitsa-restore-0123456789abcdef'
const objects = [
  { key: 'private/план.png', body: Buffer.from('plan'), contentType: 'image/png' },
  { key: 'projects/a/render.jpg', body: Buffer.from('render'), contentType: 'image/jpeg' },
  { key: 'projects/a/empty', body: Buffer.alloc(0), contentType: 'application/octet-stream' },
  { key: 'pdfs/a b.pdf', body: Buffer.from('pdf'), contentType: 'application/pdf' },
  { key: 'masks/x.png', body: Buffer.from('mask'), contentType: 'image/png' },
]
const listing = () => ({
  IsTruncated: false,
  Contents: objects.map((object, index) => ({
    Key: object.key,
    Size: object.body.length,
    ETag: `"revision-${index}"`,
  })),
})
async function* stream(body: Uint8Array) {
  yield body
}

describe('полный файловый snapshot', () => {
  let directory: string
  let client: S3Client
  let send: Mock<(command: unknown) => Promise<unknown>>

  beforeEach(async () => {
    directory = await mkdtemp(join(tmpdir(), 'domitsa-snapshot-test-'))
    client = new S3Client({
      region: 'us-east-1',
      credentials: { accessKeyId: 'test', secretAccessKey: 'test' },
    })
    send = vi.fn()
    vi.spyOn(S3Client.prototype, 'send').mockImplementation(send)
    send.mockImplementation(async (command) => {
      if (command instanceof ListObjectsV2Command) return listing()
      if (command instanceof GetObjectCommand) {
        const index = objects.findIndex((object) => object.key === command.input.Key)
        const object = objects[index]
        if (!object) throw new Error('Unknown fixture key')
        return {
          ETag: `"revision-${index}"`,
          ContentLength: object.body.length,
          ContentType: object.contentType,
          Body: stream(object.body),
        }
      }
      if (command instanceof HeadBucketCommand) throw { $metadata: { httpStatusCode: 404 } }
      if (command instanceof CreateBucketCommand || command instanceof PutObjectCommand) return {}
      throw new Error('Unexpected S3 command')
    })
    vi.stubEnv('RESTORE_S3_ACCESS_KEY', 'local-test')
    vi.stubEnv('RESTORE_S3_SECRET_KEY', 'local-test')
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => new Response(null, { status: 403 })),
    )
  })

  afterEach(async () => {
    client.destroy()
    vi.restoreAllMocks()
    vi.unstubAllEnvs()
    vi.unstubAllGlobals()
    await rm(directory, { recursive: true, force: true })
  })

  const capture = (client: S3Client, directory: string) =>
    captureFileSnapshot(
      client,
      'synthetic-source',
      join(directory, 'snapshot'),
      'db-fixture-20261005',
    )

  it('полностью проходит пагинацию', async () => {
    send.mockResolvedValueOnce({
      IsTruncated: true,
      NextContinuationToken: 'next',
      Contents: listing().Contents.slice(0, 2),
    })
    send.mockResolvedValueOnce({ IsTruncated: false, Contents: listing().Contents.slice(2) })
    expect(await inventoryFileSnapshot(client, 'synthetic-source')).toHaveLength(5)
    const secondCommand = send.mock.calls[1]?.[0]
    if (!(secondCommand instanceof ListObjectsV2Command)) throw new Error('Missing second page')
    expect(secondCommand.input.ContinuationToken).toBe('next')
  })

  it.each(['../private/plan.png', 'a/./file', '.', '..', 'a/../file'])(
    'отклоняет точечные сегменты до создания снимка: %s',
    async (key) => {
      send.mockResolvedValueOnce({
        IsTruncated: false,
        Contents: [{ Key: key, Size: 0, ETag: 'revision' }],
      })
      await expect(capture(client, directory)).rejects.toThrow(/Точечные/)
      await expect(lstat(join(directory, 'snapshot'))).rejects.toMatchObject({ code: 'ENOENT' })
    },
  )

  it.each(['missing-token', 'repeated-token', 'duplicate-key', 'missing-truncated'])(
    'отклоняет неполную инвентаризацию: %s',
    async (scenario) => {
      const page = {
        IsTruncated: true,
        NextContinuationToken: 'next',
        Contents: listing().Contents.slice(0, 1),
      }
      if (scenario === 'missing-token')
        send.mockResolvedValueOnce({ ...page, NextContinuationToken: undefined })
      if (scenario === 'repeated-token') {
        send.mockResolvedValueOnce(page)
        send.mockResolvedValueOnce({ ...page, Contents: [] })
      }
      if (scenario === 'duplicate-key')
        send.mockResolvedValueOnce({
          IsTruncated: false,
          Contents: [page.Contents[0], page.Contents[0]],
        })
      if (scenario === 'missing-truncated') send.mockResolvedValueOnce({ Contents: [] })
      await expect(inventoryFileSnapshot(client, 'synthetic-source')).rejects.toThrow()
    },
  )

  it.each(['object-size', 'total-size', 'file-count'])(
    'отклоняет превышение лимита до создания каталога: %s',
    async (scenario) => {
      const count = scenario === 'total-size' ? 17 : scenario === 'file-count' ? 10001 : 1
      send.mockResolvedValueOnce({
        IsTruncated: false,
        Contents: Array.from({ length: count }, (_, index) => ({
          Key: `key-${index}`,
          Size:
            scenario === 'file-count' ? 0 : 64 * 1024 * 1024 + (scenario === 'object-size' ? 1 : 0),
          ETag: 'revision',
        })),
      })
      await expect(capture(client, directory)).rejects.toThrow()
      await expect(lstat(join(directory, 'snapshot'))).rejects.toMatchObject({ code: 'ENOENT' })
    },
  )

  it('сохраняет пять исходных ключей, безопасные имена и нулевой объект', async () => {
    const manifest = await capture(client, directory)
    expect(manifest.entries).toHaveLength(5)
    expect(manifest.databaseBackupId).toBe('db-fixture-20261005')
    for (const entry of manifest.entries) {
      expect(entry.file).toBe(`${createHash('sha256').update(entry.key).digest('hex')}.bin`)
      expect(entry.sha256).toBe(
        createHash('sha256')
          .update(await readFile(join(directory, 'snapshot', entry.file)))
          .digest('hex'),
      )
    }
    expect(manifest.entries.find((entry) => entry.key.endsWith('/empty'))?.bytes).toBe(0)
    const gets = send.mock.calls
      .map(([command]) => command)
      .filter((command) => command instanceof GetObjectCommand)
    expect(gets.every((command) => command.input.IfMatch?.startsWith('"revision-'))).toBe(true)
    expect((await loadFileSnapshot(join(directory, 'snapshot', 'manifest.json'))).manifest).toEqual(
      manifest,
    )
    await expect(capture(client, directory)).rejects.toMatchObject({ code: 'EEXIST' })
  })

  it.each(['changed', 'deleted', 'added', 'changed-get', 'truncated', 'oversized'])(
    'не публикует manifest при нестабильном источнике: %s',
    async (scenario) => {
      const original = send.getMockImplementation()
      if (!original) throw new Error('Missing fixture implementation')
      let lists = 0
      send.mockImplementation(async (command) => {
        if (command instanceof ListObjectsV2Command && ++lists === 2) {
          const page = listing()
          const first = page.Contents[0]
          if (scenario === 'changed' && first) first.ETag = 'new-revision'
          if (scenario === 'deleted') page.Contents.pop()
          if (scenario === 'added') page.Contents.push({ Key: 'new', Size: 0, ETag: 'new' })
          return page
        }
        if (
          command instanceof GetObjectCommand &&
          ['changed-get', 'truncated', 'oversized'].includes(scenario)
        ) {
          return {
            ETag: scenario === 'changed-get' ? 'new-revision' : '"revision-0"',
            ContentLength: 4,
            ContentType: 'image/png',
            Body: stream(Buffer.alloc(scenario === 'oversized' ? 5 : 3)),
          }
        }
        return original(command)
      })
      await expect(capture(client, directory)).rejects.toThrow()
      await expect(lstat(join(directory, 'snapshot', 'manifest.json'))).rejects.toMatchObject({
        code: 'ENOENT',
      })
    },
  )

  it('отклоняет символьную ссылку в пути назначения', async () => {
    const link = join(directory, 'link')
    await symlink(directory, link, 'junction')
    await expect(
      captureFileSnapshot(client, 'source', join(link, 'snapshot'), 'db-fixture'),
    ).rejects.toThrow(/Ссылки/)
  })

  it('отклоняет обход пути и неправильное соответствие имени ключу', async () => {
    const manifest = await capture(client, directory)
    const entry = manifest.entries[0]
    if (!entry) throw new Error('Missing fixture entry')
    entry.file = '../file.bin'
    expect(() => parseFileSnapshotManifest(manifest)).toThrow()
    entry.file = `${'a'.repeat(64)}.bin`
    expect(() => parseFileSnapshotManifest(manifest)).toThrow(/не соответствует/)
  })

  it('проверяет последнюю повреждённую копию до любого обращения к S3', async () => {
    const manifest = await capture(client, directory)
    const entry = manifest.entries.at(-1)
    if (!entry) throw new Error('Missing fixture entry')
    await writeFile(join(directory, 'snapshot', entry.file), Buffer.alloc(entry.bytes, 0))
    send.mockClear()
    await expect(
      restoreFileSnapshot(join(directory, 'snapshot', 'manifest.json'), endpoint, bucket),
    ).rejects.toThrow(/контрольная сумма/)
    expect(send).not.toHaveBeenCalled()
  })

  it('восстанавливает исходные ключи, типы и байты с запретом перезаписи', async () => {
    const manifest = await capture(client, directory)
    send.mockClear()
    const report = await restoreFileSnapshot(
      join(directory, 'snapshot', 'manifest.json'),
      endpoint,
      bucket,
    )
    expect(report).toMatchObject({ status: 'passed', files: 5 })
    const puts = send.mock.calls
      .map(([command]) => command)
      .filter((command) => command instanceof PutObjectCommand)
    expect(puts.map((command) => command.input.Key)).toEqual(
      manifest.entries.map((entry) => entry.key),
    )
    for (const command of puts) {
      const object = objects.find((object) => object.key === command.input.Key)
      if (!object) throw new Error('Missing fixture object')
      expect(command.input).toMatchObject({
        Bucket: bucket,
        Body: object.body,
        ContentType: object.contentType,
        IfNoneMatch: '*',
      })
    }
    expect(fetch).toHaveBeenCalledTimes(5)
    const anonymousUrls = vi.mocked(fetch).mock.calls.map(([url]) => url)
    expect(anonymousUrls).toContain(
      `${endpoint}/${bucket}/private/${encodeURIComponent('план.png')}`,
    )
    expect(anonymousUrls).toContain(`${endpoint}/${bucket}/pdfs/a%20b.pdf`)
  })

  it.each(['existing', 'forbidden', 'public', 'corrupt-restored'])(
    'отклоняет неуспешное восстановление: %s',
    async (scenario) => {
      await capture(client, directory)
      const original = send.getMockImplementation()
      if (!original) throw new Error('Missing fixture implementation')
      send.mockClear()
      send.mockImplementation(async (command) => {
        if (command instanceof HeadBucketCommand && scenario === 'existing') return {}
        if (command instanceof HeadBucketCommand && scenario === 'forbidden')
          throw { $metadata: { httpStatusCode: 403 } }
        if (command instanceof GetObjectCommand && scenario === 'corrupt-restored') {
          const object = objects.find((object) => object.key === command.input.Key)
          if (!object) throw new Error('Missing fixture object')
          return {
            ContentType: object.contentType,
            Body: stream(Buffer.alloc(object.body.length, 0)),
          }
        }
        return original(command)
      })
      if (scenario === 'public')
        vi.mocked(fetch).mockResolvedValue(new Response(null, { status: 200 }))
      await expect(
        restoreFileSnapshot(join(directory, 'snapshot', 'manifest.json'), endpoint, bucket),
      ).rejects.toThrow()
      if (['existing', 'forbidden'].includes(scenario)) {
        expect(
          send.mock.calls.some(
            ([command]) =>
              command instanceof CreateBucketCommand || command instanceof PutObjectCommand,
          ),
        ).toBe(false)
      }
    },
  )
})
