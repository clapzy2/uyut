import type { Estimate, RoomLayout, WorksRates } from '@uyut/catalog'
import type { ContractorBrief, ExportKind } from '@uyut/db'

/** Картинка для документа: data URI, чтобы Chromium не ходил в сеть при печати */
export type PdfImage = { src: string; alt?: string }

export type PdfObject = {
  index: number
  category: string
  product: string | null
  priceKopecks: number | null
}

export type PdfRoom = {
  id: string
  name: string
  areaM2: number | null
  conditionLabel: string
  /** false: печатаем только существующую 2D-схему, без пустой страницы рендера. */
  hasConcept?: boolean
  render: PdfImage | null
  before: PdfImage | null
  alternates: Array<PdfImage & { caption: string }>
  note: string | null
  objects: PdfObject[]
  /**
   * Расстановка сверху по настоящим размерам комнаты. Прораб читает документ рулеткой,
   * а у рендера сантиметров нет, поэтому план отвечает на то, на что рендер ответить не может.
   */
  plan: RoomLayout | null
  /** Сохранённые мерки неподвижных модулей и потолка; неизвестные высоты не подставляются. */
  measurementNotes?: string[]
}

export type PdfShoppingItem = {
  title: string
  /** Ссылка выбранной ткани или базового товара, если вариант не выбран. */
  affiliateUrl?: string
  meta: string
  image: PdfImage | null
  quantity: number
  priceKopecks: number
  totalKopecks: number
  /**
   * Пометка рекламы от партнёрской сети целиком, вместе с erid. Необязательное: у товаров
   * из источников без партнёрской программы её нет.
   */
  adDisclosure?: string
}

export type PdfShoppingGroup = { roomName: string; items: PdfShoppingItem[] }

export type PdfContact = { clientName?: string; address?: string; phone?: string }

export type PdfData = {
  kind: ExportKind
  generatedAt: Date
  project: {
    title: string
    /** Общая площадь квартиры, если известна; может быть больше площади посчитанных комнат. */
    totalAreaM2?: number | null
    /** Строка под названием: комнаты, площадь, бюджет */
    subtitle: string
    facts: Array<{ label: string; value: string }>
    contact: PdfContact | null
    /** Отсутствует у автономных проверочных документов без проекта на сайте. */
    projectUrl: string | null
  }
  /** Два-три предложения о доме от помощника; без них страница «О проекте» обходится фактами */
  summary: string | null
  cover: PdfImage | null
  band: PdfImage | null
  rooms: PdfRoom[]
  /** Комнаты без выбранного концепта; их 2D-схемы могут быть в документе отдельно. */
  roomsWithoutConcept: string[]
  shopping: PdfShoppingGroup[]
  estimate: Estimate
  rates: WorksRates
  /** For geometry-only reports with no price inputs; never display zero as a quote. */
  estimateStatus?: 'not-calculated'
  brief: ContractorBrief | null
}
