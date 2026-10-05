import { createHash } from 'node:crypto'
import { lstat, mkdir, mkdtemp, readFile, rm, symlink, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import {
  DeleteObjectCommand,
  GetObjectCommand,
  PutObjectCommand,
  S3Client,
} from '@aws-sdk/client-s3'
import { afterEach, beforeEach, describe, expect, it, type Mock, vi } from 'vitest'
import {
  downloadFileSnapshot,
  type FileBackupStorage,
  parseExternalFileBackupEnvelope,
  uploadFileSnapshot,
  validateFileBackupStorage,
} from '../../../../jobs/scripts/external-file-backup'
import { loadFileSnapshot } from '../../../../jobs/scripts/file-snapshot'

const source = { endpoint: 'https://source.example', bucket: 'synthetic-source' }
const backup: FileBackupStorage = {
  endpoint: 'http://127.0.0.1:58333',
  bucket: 'synthetic-backup',
  region: 'us-east-1',
  accessKey: 'test',
  secretKey: 'test',
}
const generationId = '01234567-89ab-4cde-8fab-0123456789ab'
const prefix = `domitsa-files/v1/${generationId}`
const hash = (value: string | Buffer) => createHash('sha256').update(value).digest('hex')
const fixtures = [
  { key: 'private/план с пробелом.png', body: Buffer.from('plan'), contentType: 'image/png' },
  { key: 'private/empty', body: Buffer.alloc(0), contentType: 'application/octet-stream' },
]
function snapshot() {
  return {
    version: 1,
    databaseBackupId: 'db-fixture',
    capturedAt: '2026-10-05T06:00:00.000Z',
    entries: fixtures.map((object) => ({
      key: object.key,
      bytes: object.body.length,
      etag: '"source-revision"',
      file: `${hash(object.key)}.bin`,
      sha256: hash(object.body),
      contentType: object.contentType,
    })),
  }
}
async function* stream(body: Buffer) {
  yield body
}

describe('внешняя полная файловая копия', () => {
  let directory: string
  let manifestPath: string
  let send: Mock<(command: unknown) => Promise<unknown>>
  let stored: Map<string, { body: Buffer; contentType: string }>

  beforeEach(async () => {
    directory = await mkdtemp(join(tmpdir(), 'domitsa-external-backup-test-'))
    const local = join(directory, 'source')
    await mkdir(local)
    manifestPath = join(local, 'manifest.json')
    await writeFile(manifestPath, JSON.stringify(snapshot()))
    for (const object of fixtures)
      await writeFile(join(local, `${hash(object.key)}.bin`), object.body)
    stored = new Map()
    send = vi.fn(async (command) => {
      if (command instanceof PutObjectCommand) {
        const { Key, Body, ContentType, Bucket, IfNoneMatch } = command.input
        if (!Key || !(Body instanceof Buffer) || !ContentType)
          throw new Error('Invalid fixture put')
        expect(Bucket).toBe(backup.bucket)
        expect(IfNoneMatch).toBe('*')
        expect(command.input.ACL).toBe('private')
        if (stored.has(Key)) throw new Error('PreconditionFailed')
        stored.set(Key, { body: Body, contentType: ContentType })
        return {}
      }
      if (command instanceof GetObjectCommand) {
        expect(command.input.Bucket).toBe(backup.bucket)
        const object = stored.get(command.input.Key ?? '')
        if (!object) throw new Error('NoSuchKey')
        return {
          Body: stream(object.body),
          ContentLength: object.body.length,
          ContentType: object.contentType,
        }
      }
      if (command instanceof DeleteObjectCommand) {
        expect(command.input.Bucket).toBe(backup.bucket)
        const key = command.input.Key ?? ''
        expect(key).toMatch(new RegExp(`^${prefix}/privacy-probe-[a-f0-9-]+\\.txt$`))
        expect(stored.has(key)).toBe(true)
        stored.delete(key)
        return {}
      }
      throw new Error('Forbidden S3 command')
    })
    vi.spyOn(S3Client.prototype, 'send').mockImplementation(send)
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => new Response(null, { status: 403 })),
    )
  })

  afterEach(async () => {
    vi.restoreAllMocks()
    vi.unstubAllGlobals()
    await rm(directory, { recursive: true, force: true })
  })

  const upload = () => uploadFileSnapshot(manifestPath, source, backup, generationId)
  const download = () =>
    downloadFileSnapshot(source, backup, generationId, join(directory, 'download'))

  it('публикует manifest последним и скачивает Unicode и пустой объект для обычного restore', async () => {
    expect(await upload()).toEqual({ generationId, files: 2, bytes: 4 })
    const puts = send.mock.calls
      .map(([command]) => command)
      .filter((c) => c instanceof PutObjectCommand)
    expect(puts[0]?.input.Key).toMatch(/\/privacy-probe-[a-f0-9-]+\.txt$/)
    expect(puts[0]?.input.Body).toEqual(Buffer.from('domitsa-files privacy probe v1\n'))
    expect(puts.slice(1).map((c) => c.input.Key)).toEqual([
      ...snapshot().entries.map((entry) => `${prefix}/objects/${entry.file}`),
      `${prefix}/manifest.json`,
    ])
    const commands = send.mock.calls.map(([command]) => command)
    const probeDelete = commands.findIndex((command) => command instanceof DeleteObjectCommand)
    const firstDataPut = commands.findIndex(
      (command) => command instanceof PutObjectCommand && command.input.Key?.includes('/objects/'),
    )
    expect(probeDelete).toBeGreaterThan(0)
    expect(probeDelete).toBeLessThan(firstDataPut)
    send.mockClear()
    const report = await download()
    expect(report).toMatchObject({ files: 2, bytes: 4 })
    expect((await loadFileSnapshot(report.manifestPath)).manifest).toEqual(snapshot())
    expect(send.mock.calls.every(([command]) => command instanceof GetObjectCommand)).toBe(true)
    expect(vi.mocked(fetch).mock.calls.every(([, options]) => options?.redirect === 'error')).toBe(
      true,
    )
  })

  it('не перезаписывает существующее поколение', async () => {
    await upload()
    const original = new Map(stored)
    await expect(upload()).rejects.toThrow('PreconditionFailed')
    expect(stored).toEqual(original)
  })

  it('не публикует manifest при частичной записи', async () => {
    const original = send.getMockImplementation()
    let puts = 0
    send.mockImplementation(async (command) => {
      if (command instanceof PutObjectCommand && ++puts === 3)
        throw new Error('Storage unavailable')
      return original?.(command)
    })
    await expect(upload()).rejects.toThrow('Storage unavailable')
    expect(stored.size).toBe(1)
    expect(stored.has(`${prefix}/manifest.json`)).toBe(false)
  })

  it('отсутствующий объект даёт 403, но public созданный probe останавливает пользовательские записи', async () => {
    vi.mocked(fetch).mockImplementation(async (url) => {
      const key = new URL(String(url)).pathname.slice(backup.bucket.length + 2)
      return new Response(null, { status: stored.has(key) ? 200 : 403 })
    })
    expect(
      (await fetch(`${backup.endpoint}/${backup.bucket}/${prefix}/manifest.json`)).status,
    ).toBe(403)
    await expect(upload()).rejects.toThrow(/Приватность/)
    const puts = send.mock.calls
      .map(([command]) => command)
      .filter((command) => command instanceof PutObjectCommand)
    expect(puts).toHaveLength(1)
    expect(puts[0]?.input.Key).toMatch(/\/privacy-probe-/)
    expect(puts[0]?.input.Body).toEqual(Buffer.from('domitsa-files privacy probe v1\n'))
    expect(stored.size).toBe(0)
  })

  it.each(['put', 'get', 'corrupt', 'short', 'type', 'public', 'delete'])(
    'ошибка probe запрещает пользовательские записи и удаление чужих объектов: %s',
    async (scenario) => {
      const previousKey = `${prefix}/objects/previous.bin`
      const previous = { body: Buffer.from('previous'), contentType: 'application/octet-stream' }
      stored.set(previousKey, previous)
      const original = send.getMockImplementation()
      send.mockImplementation(async (command) => {
        if (command instanceof PutObjectCommand && scenario === 'put')
          throw new Error('Probe PUT failed')
        if (command instanceof GetObjectCommand && command.input.Key?.includes('/privacy-probe-')) {
          if (scenario === 'get') throw new Error('Probe GET failed')
          if (['corrupt', 'short', 'type'].includes(scenario)) {
            const body = Buffer.from('domitsa-files privacy probe v1\n')
            let savedBody = body
            if (scenario === 'short') savedBody = body.subarray(0, body.length - 1)
            if (scenario === 'corrupt') savedBody = Buffer.alloc(body.length)
            return {
              ContentLength: body.length,
              ContentType: scenario === 'type' ? 'application/octet-stream' : 'text/plain',
              Body: stream(savedBody),
            }
          }
        }
        if (command instanceof DeleteObjectCommand && scenario === 'delete')
          throw new Error('Probe DELETE failed')
        return original?.(command)
      })
      if (scenario === 'public')
        vi.mocked(fetch).mockResolvedValue(new Response(null, { status: 200 }))
      await expect(upload()).rejects.toThrow()
      const commands = send.mock.calls.map(([command]) => command)
      const puts = commands.filter((command) => command instanceof PutObjectCommand)
      const deletes = commands.filter((command) => command instanceof DeleteObjectCommand)
      expect(puts).toHaveLength(1)
      expect(puts[0]?.input.Key).toMatch(/\/privacy-probe-/)
      expect(puts[0]?.input.Body).toEqual(Buffer.from('domitsa-files privacy probe v1\n'))
      expect(deletes).toHaveLength(scenario === 'put' ? 0 : 1)
      expect(deletes.every((command) => command.input.Key === puts[0]?.input.Key)).toBe(true)
      expect(stored.get(previousKey)).toBe(previous)
      expect(stored.has(`${prefix}/manifest.json`)).toBe(false)
      expect(stored.size).toBe(scenario === 'delete' ? 2 : 1)
    },
  )

  it.each(['corrupt', 'short', 'oversized', 'type', 'public'])(
    'отклоняет неправильный readback до публикации manifest: %s',
    async (scenario) => {
      const original = send.getMockImplementation()
      send.mockImplementation(async (command) => {
        if (command instanceof GetObjectCommand && command.input.Key?.includes('/objects/')) {
          let body = 'plan'
          if (scenario === 'short') body = 'pla'
          if (scenario === 'oversized') body = 'plans'
          if (scenario === 'corrupt') body = 'xxxx'
          return {
            ContentLength: 4,
            ContentType: scenario === 'type' ? 'text/plain' : 'image/png',
            Body: stream(Buffer.from(body)),
          }
        }
        return original?.(command)
      })
      if (scenario === 'public')
        vi.mocked(fetch).mockResolvedValue(new Response(null, { status: 200 }))
      await expect(upload()).rejects.toThrow()
      expect(stored.has(`${prefix}/manifest.json`)).toBe(false)
    },
  )

  it.each(['corrupt', 'short', 'type', 'public'])(
    'не создаёт локальный manifest при плохом скачивании: %s',
    async (scenario) => {
      await upload()
      if (scenario === 'public')
        vi.mocked(fetch).mockResolvedValue(new Response(null, { status: 200 }))
      const original = send.getMockImplementation()
      send.mockImplementation(async (command) => {
        if (command instanceof GetObjectCommand && command.input.Key?.includes('/objects/')) {
          return {
            ContentLength: 4,
            ContentType: scenario === 'type' ? 'text/plain' : 'image/png',
            Body: stream(
              Buffer.from(scenario === 'short' ? 'pla' : scenario === 'corrupt' ? 'xxxx' : 'plan'),
            ),
          }
        }
        return original?.(command)
      })
      await expect(download()).rejects.toThrow()
      await expect(lstat(join(directory, 'download', 'manifest.json'))).rejects.toMatchObject({
        code: 'ENOENT',
      })
    },
  )

  it.each(['kind', 'extra', 'entry', 'limit', 'source'])(
    'проверяет весь envelope до создания локальной папки: %s',
    async (scenario) => {
      await upload()
      const manifest = stored.get(`${prefix}/manifest.json`)
      if (!manifest) throw new Error('Missing envelope')
      const envelope = JSON.parse(manifest.body.toString())
      if (scenario === 'kind') envelope.kind = 'other'
      if (scenario === 'extra') envelope.unexpected = true
      if (scenario === 'entry') envelope.snapshot.entries[0].file = '../outside.bin'
      if (scenario === 'limit') envelope.snapshot.entries[0].bytes = 64 * 1024 * 1024 + 1
      if (scenario === 'source') envelope.sourceId = 'a'.repeat(64)
      manifest.body = Buffer.from(JSON.stringify(envelope))
      await expect(download()).rejects.toThrow()
      await expect(lstat(join(directory, 'download'))).rejects.toMatchObject({ code: 'ENOENT' })
    },
  )

  it('отклоняет повреждённый локальный снимок до обращений к резерву', async () => {
    await writeFile(join(directory, 'source', `${hash(fixtures[0]?.key ?? '')}.bin`), 'xxxx')
    await expect(upload()).rejects.toThrow(/контрольная сумма/)
    expect(send).not.toHaveBeenCalled()
    expect(fetch).not.toHaveBeenCalled()
  })

  it('не считает отдельные объекты без manifest завершённой копией', async () => {
    await upload()
    stored.delete(`${prefix}/manifest.json`)
    await expect(download()).rejects.toThrow('NoSuchKey')
    await expect(lstat(join(directory, 'download'))).rejects.toMatchObject({ code: 'ENOENT' })
  })

  it('сохраняет пустой снимок и защищает его поколение от повторной публикации', async () => {
    await writeFile(manifestPath, JSON.stringify({ ...snapshot(), entries: [] }))
    expect(await upload()).toEqual({ generationId, files: 0, bytes: 0 })
    expect(stored.size).toBe(1)
    expect(await download()).toMatchObject({ files: 0, bytes: 0 })
    await expect(upload()).rejects.toThrow('PreconditionFailed')
  })

  it('отклоняет другую конфигурацию исходного хранилища', async () => {
    await upload()
    await expect(
      downloadFileSnapshot(
        { ...source, endpoint: 'https://another.example' },
        backup,
        generationId,
        join(directory, 'download'),
      ),
    ).rejects.toThrow(/Исходное хранилище/)
    await expect(lstat(join(directory, 'download'))).rejects.toMatchObject({ code: 'ENOENT' })
  })

  it('отклоняет существующую папку и ссылку в пути', async () => {
    await upload()
    await mkdir(join(directory, 'download'))
    await expect(download()).rejects.toMatchObject({ code: 'EEXIST' })
    await symlink(directory, join(directory, 'link'), 'junction')
    await expect(
      downloadFileSnapshot(source, backup, generationId, join(directory, 'link', 'new')),
    ).rejects.toThrow(/Ссылки/)
  })

  it.each([
    'http://remote.example',
    'http://localhost:58333',
    'https://host/path',
    'https://u:p@host',
    'https://host/?x=1',
  ])('отклоняет endpoint: %s', async (endpoint) => {
    await expect(
      uploadFileSnapshot(manifestPath, source, { ...backup, endpoint }, generationId),
    ).rejects.toThrow()
    expect(send).not.toHaveBeenCalled()
  })

  it('отклоняет совпадающий бакет даже через иной endpoint и небезопасный generation', async () => {
    await expect(
      uploadFileSnapshot(manifestPath, source, { ...backup, bucket: source.bucket }, generationId),
    ).rejects.toThrow(/должны различаться/)
    await expect(uploadFileSnapshot(manifestPath, source, backup, '../outside')).rejects.toThrow()
    expect(send).not.toHaveBeenCalled()
  })

  it('нормализует source identity и требует привязку архивного SHA к метке БД', async () => {
    expect(
      validateFileBackupStorage({ ...source, endpoint: 'https://SOURCE.example:443/' }, backup)
        .sourceId,
    ).toBe(validateFileBackupStorage(source, backup).sourceId)
    const archive = {
      key: 'data/coolify/backups/databases/fixture/backup.dump',
      sha256: 'a'.repeat(64),
      bytes: 16,
      createdAt: '2026-10-05T05:00:00.000Z',
    }
    await expect(
      uploadFileSnapshot(manifestPath, source, backup, generationId, archive),
    ).rejects.toThrow(/архиву БД/)
    expect(send).not.toHaveBeenCalled()
    await writeFile(
      manifestPath,
      JSON.stringify({ ...snapshot(), databaseBackupId: `pg-${archive.sha256}` }),
    )
    await uploadFileSnapshot(manifestPath, source, backup, generationId, archive)
    const remote = stored.get(`${prefix}/manifest.json`)
    if (!remote) throw new Error('Missing envelope')
    const envelope = JSON.parse(remote.body.toString())
    const sourceId = validateFileBackupStorage(source, backup).sourceId
    expect(parseExternalFileBackupEnvelope(envelope, sourceId).databaseArchive).toEqual(archive)
    envelope.databaseArchive.key = 'data/coolify/backups/databases/../other'
    expect(() => parseExternalFileBackupEnvelope(envelope, sourceId)).toThrow()
    expect(JSON.parse(await readFile(manifestPath, 'utf8')).databaseBackupId).toBe(
      `pg-${archive.sha256}`,
    )
  })
})
