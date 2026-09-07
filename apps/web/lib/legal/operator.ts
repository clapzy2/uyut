/**
 * Реквизиты оператора. Это публичные данные, они печатаются на страницах документов,
 * поэтому лежат в коде, а не в окружении. Заполняются один раз перед запуском:
 * пока стоят заглушки, страницы честно пишут, что документ в подготовке.
 */
export type Operator = {
  /** ФИО самозанятого или наименование ИП */
  name: string
  /** ИНН */
  inn: string
  /** Адрес электронной почты для обращений */
  email: string
  /** Город, указывается в оферте как место заключения договора */
  city: string
  /** Дата последней редакции документов, ISO */
  updatedAt: string
}

const PLACEHOLDER = '[указывается до запуска]'

export const operator: Operator = {
  name: PLACEHOLDER,
  inn: PLACEHOLDER,
  email: 'hello@uyut.ru',
  city: PLACEHOLDER,
  updatedAt: '2026-09-08',
}

/** Реквизиты заполнены полностью: до этого документы показывают предупреждение */
export function operatorReady(person: Operator = operator): boolean {
  return [person.name, person.inn, person.city].every((value) => value !== PLACEHOLDER)
}

const dateFormat = new Intl.DateTimeFormat('ru-RU', {
  day: 'numeric',
  month: 'long',
  year: 'numeric',
})

export function updatedOn(person: Operator = operator): string {
  return dateFormat.format(new Date(person.updatedAt))
}
