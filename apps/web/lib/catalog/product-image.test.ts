import { expect, it } from 'vitest'
import { orderedImages } from './product-image'

it('prefers the shop photo while keeping the partner copy as a fallback', () => {
  expect(
    orderedImages([
      { url: 'https://imgng.gdeslon.ru/copy.jpg' },
      { url: 'https://shop.example/photo.jpg' },
    ]),
  ).toEqual(['https://shop.example/photo.jpg', 'https://imgng.gdeslon.ru/copy.jpg'])
})
