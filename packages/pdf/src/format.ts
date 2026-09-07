const rubles = new Intl.NumberFormat('ru-RU')
const area = new Intl.NumberFormat('ru-RU', { maximumFractionDigits: 1 })
const percent = new Intl.NumberFormat('ru-RU', { maximumFractionDigits: 0 })
const longDate = new Intl.DateTimeFormat('ru-RU', {
  day: 'numeric',
  month: 'long',
  year: 'numeric',
})
const monthYear = new Intl.DateTimeFormat('ru-RU', { month: 'long', year: 'numeric' })

/** Неразрывные пробелы внутри чисел, чтобы «18,4 м²» и «694 250 ₽» не рвались на переносе */
const NBSP = ' '

export function formatPrice(kopecks: number): string {
  return `${rubles.format(Math.round(kopecks / 100)).replace(/\s/g, NBSP)}${NBSP}₽`
}

export function formatRubles(rub: number): string {
  return `${rubles.format(rub).replace(/\s/g, NBSP)}${NBSP}₽`
}

export function formatArea(m2: number | null | undefined): string | null {
  if (m2 === null || m2 === undefined) {
    return null
  }
  return `${area.format(m2)}${NBSP}м²`
}

export function formatShare(share: number): string {
  return `${percent.format(Math.round(share * 100))}${NBSP}%`
}

export function formatLongDate(date: Date): string {
  return longDate.format(date)
}

export function formatMonthYear(date: Date): string {
  return monthYear.format(date)
}

export function escapeHtml(text: string): string {
  return text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
}

export function pluralItems(count: number): string {
  const mod10 = count % 10
  const mod100 = count % 100
  if (mod10 === 1 && mod100 !== 11) {
    return `${count} предмет`
  }
  if (mod10 >= 2 && mod10 <= 4 && (mod100 < 10 || mod100 >= 20)) {
    return `${count} предмета`
  }
  return `${count} предметов`
}

export function pluralPositions(count: number): string {
  const mod10 = count % 10
  const mod100 = count % 100
  if (mod10 === 1 && mod100 !== 11) {
    return `${count} позиция`
  }
  if (mod10 >= 2 && mod10 <= 4 && (mod100 < 10 || mod100 >= 20)) {
    return `${count} позиции`
  }
  return `${count} позиций`
}
