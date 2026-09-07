// Склонения для списка покупок; файл без серверных импортов, его читают клиентские компоненты
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

const percent = new Intl.NumberFormat('ru-RU', { maximumFractionDigits: 0 })

export function formatShare(share: number): string {
  return `${percent.format(Math.round(share * 100))} %`
}
