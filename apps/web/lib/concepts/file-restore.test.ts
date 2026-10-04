import { createHash } from 'node:crypto'
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import {
  loadFileBackup,
  parseFileManifest,
  validateRestoreTarget,
} from '../../../../jobs/scripts/check-file-restore'

function manifest() {
  return {
    version: 1,
    entries: ['plan', 'render', 'mask', 'pdf'].map((kind) => ({
      kind,
      file: `${kind}.bin`,
      bytes: 20,
      sha256: 'a'.repeat(64),
      contentType: kind === 'pdf' ? 'application/pdf' : 'image/png',
    })),
  }
}

describe('закрытое восстановление файлов', () => {
  it('принимает отдельный loopback-бакет и четыре вида файлов', () => {
    expect(
      validateRestoreTarget('http://127.0.0.1:58333', 'domitsa-restore-0123456789abcdef').endpoint,
    ).toBe('http://127.0.0.1:58333')
    expect(parseFileManifest(manifest()).entries).toHaveLength(4)
  })
  it.each([
    'https://s3.twcstorage.ru',
    'http://localhost:8333',
    'http://127.0.0.1',
    'http://127.0.0.1:8333/other',
    'http://user:pass@127.0.0.1:8333',
    'http://127.0.0.1:8333/?key=secret',
    'http://127.0.0.1:8333/#other',
  ])('отклоняет цель %s', (endpoint) => {
    expect(() => validateRestoreTarget(endpoint, 'domitsa-restore-0123456789abcdef')).toThrow()
  })
  it.each(['uyut-prod', 'uyut-backups', 'domitsa-restore-../other', 'domitsa-restore-short'])(
    'отклоняет бакет %s',
    (bucket) => {
      expect(() => validateRestoreTarget('http://127.0.0.1:8333', bucket)).toThrow()
    },
  )
  it('отклоняет обход пути и несоответствие вида имени', () => {
    const value = manifest()
    const plan = value.entries.at(0)
    if (!plan) throw new Error('В фикстуре должен быть план')
    plan.file = '../render.bin'
    expect(() => parseFileManifest(value)).toThrow()
    plan.file = 'render.bin'
    expect(() => parseFileManifest(value)).toThrow()
  })
  it('отклоняет дубликаты, неполный набор и посторонние поля', () => {
    const value = manifest()
    const render = value.entries.at(1)
    if (!render) throw new Error('В фикстуре должен быть рендер')
    value.entries[0] = render
    expect(() => parseFileManifest(value)).toThrow()
    expect(() =>
      parseFileManifest({ ...manifest(), entries: manifest().entries.slice(1) }),
    ).toThrow()
    expect(() => parseFileManifest({ ...manifest(), sourceKey: 'private' })).toThrow()
  })
  it('отклоняет неверные checksum, размер и тип PDF', () => {
    const value = manifest()
    const plan = value.entries.at(0)
    const pdf = value.entries.at(3)
    if (!plan || !pdf) throw new Error('В фикстуре должны быть план и PDF')
    plan.sha256 = 'fake'
    expect(() => parseFileManifest(value)).toThrow()
    plan.sha256 = 'a'.repeat(64)
    plan.bytes = 0
    expect(() => parseFileManifest(value)).toThrow()
    plan.bytes = 20
    pdf.contentType = 'image/png'
    expect(() => parseFileManifest(value)).toThrow()
  })
  it('ограничивает суммарную память копии', () => {
    const value = manifest()
    for (const entry of value.entries) entry.bytes = 64 * 1024 * 1024
    expect(() => parseFileManifest(value)).toThrow(/128 МиБ/)
  })
  it.each(['corrupt', 'truncated', 'directory', 'valid'])(
    'проверяет локальные файлы до S3: %s',
    async (scenario) => {
      const directory = await mkdtemp(join(tmpdir(), 'domitsa-file-restore-test-'))
      const body = Buffer.alloc(20, 1)
      const value = manifest()
      for (const entry of value.entries)
        entry.sha256 = createHash('sha256').update(body).digest('hex')
      try {
        for (const entry of value.entries) await writeFile(join(directory, entry.file), body)
        const manifestPath = join(directory, 'manifest.json')
        await writeFile(manifestPath, JSON.stringify(value))
        if (scenario === 'corrupt')
          await writeFile(join(directory, 'plan.bin'), Buffer.alloc(20, 2))
        if (scenario === 'truncated') await writeFile(join(directory, 'plan.bin'), body.subarray(1))
        if (scenario === 'directory') {
          await rm(join(directory, 'plan.bin'))
          await mkdir(join(directory, 'plan.bin'))
        }
        if (scenario === 'valid')
          expect((await loadFileBackup(manifestPath)).sources).toHaveLength(4)
        else
          await expect(loadFileBackup(manifestPath)).rejects.toThrow(/файл копии|контрольная сумма/)
      } finally {
        await rm(directory, { recursive: true, force: true })
      }
    },
  )
})
