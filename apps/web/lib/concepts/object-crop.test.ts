import sharp from 'sharp'
import { describe, expect, it, vi } from 'vitest'
import { cropObject, prepareObjectCrop } from '../../../../jobs/src/segment-and-match'

vi.mock('@trigger.dev/sdk', () => ({
  logger: { warn: vi.fn() },
  metadata: { set: vi.fn() },
  task: vi.fn((definition) => definition),
}))

async function render(width = 20, height = 20): Promise<Buffer> {
  return sharp({ create: { width, height, channels: 3, background: '#bc6540' } })
    .png()
    .toBuffer()
}

async function mask(width: number, height: number, whitePixel?: [number, number]): Promise<Buffer> {
  const pixels = Buffer.alloc(width * height)
  if (whitePixel) {
    pixels[whitePixel[1] * width + whitePixel[0]] = 255
  }
  return sharp(pixels, { raw: { width, height, channels: 1 } })
    .png()
    .toBuffer()
}

const object = { label: 'Диван', bbox: { x: 0.2, y: 0.2, w: 0.5, h: 0.5 } }

describe('вырезка предмета и допустимость маски', () => {
  it('возвращает проверенную маску только после успешной вырезки', async () => {
    const image = await render()
    const maskBody = await mask(20, 20, [10, 10])
    const prepared = await prepareObjectCrop(image, 20, 20, object, maskBody)

    expect(prepared.maskBody).toBe(maskBody)
    expect(await sharp(prepared.body).metadata()).toMatchObject({
      format: 'jpeg',
      width: 512,
      height: 512,
    })
  })

  it.each(['пустая', 'битая'])('не возвращает %s маску после перехода на рамку', async (kind) => {
    const image = await render()
    const maskBody = kind === 'пустая' ? await mask(20, 20) : Buffer.from('not an image')
    const prepared = await prepareObjectCrop(image, 20, 20, object, maskBody)

    expect(prepared.maskBody).toBeNull()
    expect(prepared.body).toEqual(await cropObject(image, 20, 20, object, null))
  })

  it('читает цветную маску с альфа-каналом как один канал яркости', async () => {
    const image = await render()
    const maskBody = await sharp(await mask(20, 20, [10, 10]))
      .ensureAlpha()
      .png()
      .toBuffer()
    const prepared = await prepareObjectCrop(image, 20, 20, object, maskBody)

    expect(prepared.maskBody).toBe(maskBody)
    expect((await sharp(prepared.body).metadata()).width).toBe(512)
  })

  it('не выходит за изображение с единственным пикселем маски в углу', async () => {
    const image = await render(4, 3)
    const maskBody = await mask(4, 3, [3, 2])
    const edgeObject = { label: 'Лампа', bbox: { x: 0.9, y: 0.9, w: 0.1, h: 0.1 } }
    const prepared = await prepareObjectCrop(image, 4, 3, edgeObject, maskBody)

    expect(prepared.maskBody).toBe(maskBody)
    expect((await sharp(prepared.body).metadata()).height).toBe(512)
  })

  it.each([1, 0.96])('отклоняет маску, занимающую %s всего кадра', async (coverage) => {
    const image = await render()
    const pixels = Buffer.alloc(400)
    pixels.fill(255, 0, Math.round(pixels.length * coverage))
    const maskBody = await sharp(pixels, { raw: { width: 20, height: 20, channels: 1 } })
      .png()
      .toBuffer()
    const prepared = await prepareObjectCrop(image, 20, 20, object, maskBody)

    expect(prepared.maskBody).toBeNull()
    expect(prepared.body).toEqual(await cropObject(image, 20, 20, object, null))
  })

  it('отклоняет непустую маску другого предмета вне рамки', async () => {
    const image = await render()
    const maskBody = await mask(20, 20, [19, 19])
    const prepared = await prepareObjectCrop(image, 20, 20, object, maskBody)

    expect(prepared.maskBody).toBeNull()
    expect(prepared.body).toEqual(await cropObject(image, 20, 20, object, null))
  })

  it('допускает небольшой выход маски за рамку в пределах поля', async () => {
    const image = await render()
    const maskBody = await mask(20, 20, [3, 10])
    const prepared = await prepareObjectCrop(image, 20, 20, object, maskBody)

    expect(prepared.maskBody).toBe(maskBody)
  })

  it.each([
    { inside: 4, accepted: true },
    { inside: 3, accepted: false },
  ])(
    'требует не менее 80% площади маски внутри расширенной рамки: %j',
    async ({ inside, accepted }) => {
      const image = await render()
      const pixels = Buffer.alloc(400)
      for (let index = 0; index < 5; index += 1) {
        const x = index < inside ? 5 : 19
        pixels[(5 + index) * 20 + x] = 255
      }
      const maskBody = await sharp(pixels, { raw: { width: 20, height: 20, channels: 1 } })
        .png()
        .toBuffer()
      const prepared = await prepareObjectCrop(image, 20, 20, object, maskBody)

      expect(prepared.maskBody).toBe(accepted ? maskBody : null)
    },
  )

  it('вырезает крошечную рамку у нижнего правого края без искусственного минимума 8 пикселей', async () => {
    const image = await render(4, 3)
    const edgeObject = { label: 'Лампа', bbox: { x: 0.99, y: 0.99, w: 0.001, h: 0.001 } }
    const prepared = await prepareObjectCrop(image, 4, 3, edgeObject, null)

    expect(prepared.maskBody).toBeNull()
    expect(await sharp(prepared.body).metadata()).toMatchObject({ width: 1, height: 1 })
  })

  it('обрезает частично внешнюю рамку по границам изображения', async () => {
    const image = await render()
    const edgeObject = { label: 'Стол', bbox: { x: -0.1, y: 0.8, w: 0.5, h: 0.5 } }
    const prepared = await prepareObjectCrop(image, 20, 20, edgeObject, null)

    expect(await sharp(prepared.body).metadata()).toMatchObject({ width: 9, height: 5 })
  })

  it.each([
    { x: 1.1, y: 0.2, w: 0.1, h: 0.2 },
    { x: -0.3, y: 0.2, w: 0.1, h: 0.2 },
    { x: 0.2, y: 1.1, w: 0.2, h: 0.1 },
    { x: 0.2, y: -0.3, w: 0.2, h: 0.1 },
  ])('не выдаёт чужой край изображения за предмет с полностью внешней рамкой %j', async (bbox) => {
    await expect(
      prepareObjectCrop(await render(), 20, 20, { label: 'Стол', bbox }, null),
    ).rejects.toThrow('рамка предмета вне изображения')
  })

  it.each([
    { x: Number.NaN, y: 0.2, w: 0.2, h: 0.2 },
    { x: 0.2, y: 0.2, w: Number.POSITIVE_INFINITY, h: 0.2 },
    { x: 0.2, y: 0.2, w: 0, h: 0.2 },
    { x: 0.2, y: 0.2, w: 0.2, h: -0.2 },
  ])('отклоняет некорректную рамку %j до sharp.extract', async (bbox) => {
    await expect(
      prepareObjectCrop(await render(), 20, 20, { label: 'Стол', bbox }, null),
    ).rejects.toThrow('некорректная рамка предмета')
  })
})
