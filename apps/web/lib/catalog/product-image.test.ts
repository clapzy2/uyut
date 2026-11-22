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

it('uses the verified photo only for the matching Gianna finish and offer', () => {
  const product = {
    source: 'gdeslon',
    externalId: '95754-1573868-1303370921062868000',
    title: 'Торшер Globo Gianna 24099SB цвет плафона/подвески Черный, цвет арматуры Черный',
  }
  const copy = 'https://imgng.gdeslon.ru/copy.jpg'
  const [photo, fallback] = orderedImages([{ url: copy }], product)
  expect(photo).toMatch(/\/globo-24099sb\.jpg$/)
  expect(fallback).toBe(copy)
  expect(orderedImages([], { ...product, title: product.title.replace('SB', 'SC') })).toEqual([])
  expect(orderedImages([], { ...product, source: 'dump' })).toEqual([])
})
