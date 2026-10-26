import { describe, expect, it } from 'vitest'
import { preparePhoto, UploadError } from './uploads'

describe('preparePhoto', () => {
  it('explains how to upload a HEIC phone photo instead', async () => {
    const heic = new File(
      [Uint8Array.from([0, 0, 0, 16, 0x66, 0x74, 0x79, 0x70, 0x68, 0x65, 0x69, 0x63])],
      'room.heic',
      { type: 'image/heic' },
    )

    await expect(preparePhoto(heic)).rejects.toThrow(
      'Фото в формате HEIC пока не поддерживается. Сохраните его как JPG или PNG и загрузите снова.',
    )
  })

  it('still rejects a different unknown file without suggesting HEIC conversion', async () => {
    const unknown = new File(['unrecognized'], 'room.bin', { type: 'application/octet-stream' })

    await expect(preparePhoto(unknown)).rejects.toThrow(
      new UploadError('Это не похоже на JPG, PNG или WebP. Попробуйте другой файл.'),
    )
  })
})
