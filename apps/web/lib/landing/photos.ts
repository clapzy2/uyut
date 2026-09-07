/**
 * Слоты под фотографии лендинга. Пока путь пустой, на месте кадра стоит рамка с подписью:
 * так видно композицию и понятно, что именно снимать. Файлы кладутся в apps/web/public/landing.
 */
export type PhotoSlot = {
  id: string
  /** Что должно быть на кадре: подсказка при подборе и подпись в пустой рамке */
  brief: string
  /** Текст для тех, кто не видит картинку */
  alt: string
  /** Путь от корня сайта, например /landing/hero.jpg; пустая строка — кадра ещё нет */
  src: string
}

export const landingPhotos: Record<string, PhotoSlot> = {
  hero: {
    id: 'hero',
    brief: 'Горизонтальный кадр гостиной с окном и мягким дневным светом',
    alt: 'Светлая гостиная с большим окном',
    src: '',
  },
  before: {
    id: 'before',
    brief: 'Пустая комната после черновой отделки, снято от двери',
    alt: 'Пустая комната до обстановки',
    src: '',
  },
  after: {
    id: 'after',
    brief: 'Та же комната обставленной — можно взять готовый рендер сервиса',
    alt: 'Та же комната с мебелью',
    src: '',
  },
  document: {
    id: 'document',
    brief: 'Разворот распечатанного PDF на столе, сверху',
    alt: 'Распечатанный проект на столе',
    src: '',
  },
  og: {
    id: 'og',
    brief: 'Кадр 1200×630 для карточки ссылки в мессенджерах: интерьер и надпись Uyut',
    alt: 'Uyut',
    src: '',
  },
  together: {
    id: 'together',
    brief: 'Двое смотрят в телефон, вертикальный кадр, лица не обязательны',
    alt: 'Двое выбирают интерьер вместе',
    src: '',
  },
}

export function photo(id: keyof typeof landingPhotos): PhotoSlot {
  const slot = landingPhotos[id]
  if (!slot) {
    throw new Error(`нет слота фотографии ${String(id)}`)
  }
  return slot
}
