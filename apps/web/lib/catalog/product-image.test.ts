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

it('supplies a matching Bagetti photo even when no dimensions are available', () => {
  const product = {
    source: 'gdeslon',
    externalId: '95754-1614665-15185461308487930000',
    title: 'Торшер EVOLUCE Bagetti SL1142.505.01 цвет арматуры Белый, Коричневый',
  }
  expect(orderedImages([], product)).toEqual([
    'https://lightsnab.ru/cache/image/5/1024x1024/20240408140435366173.webp',
  ])
  expect(orderedImages([], { ...product, title: product.title.replace('.01', '.02') })).toEqual([])
})
