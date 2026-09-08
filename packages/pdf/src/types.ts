import type { Estimate, WorksRates } from '@uyut/catalog'
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
  render: PdfImage | null
  before: PdfImage | null
  alternates: Array<PdfImage & { caption: string }>
  note: string | null
  objects: PdfObject[]
}

export type PdfShoppingItem = {
  title: string
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
    /** Строка под названием: комнаты, площадь, бюджет */
    subtitle: string
    facts: Array<{ label: string; value: string }>
    contact: PdfContact | null
    projectUrl: string
  }
  /** Два-три предложения о доме от помощника; без них страница «О проекте» обходится фактами */
  summary: string | null
  cover: PdfImage | null
  band: PdfImage | null
  rooms: PdfRoom[]
  /** Комнаты без утверждённого концепта: в документе только упоминание */
  roomsWithoutConcept: string[]
  shopping: PdfShoppingGroup[]
  estimate: Estimate
  rates: WorksRates
  brief: ContractorBrief | null
}
