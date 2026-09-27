import { createHash } from 'node:crypto'
import type { PlanReading } from '@uyut/db'

export class PlanEditConflictError extends Error {
  constructor() {
    super(
      'План или схема изменились. Правки не сохранены. Загрузите актуальную схему и сверяйте её заново.',
    )
    this.name = 'PlanEditConflictError'
  }
}

/** Версия исходника, списка комнат и схемы; порядок ключей JSONB не меняет версию. */
export function planEditRevision(planUrl: string | null, reading: PlanReading | null): string {
  const source = JSON.stringify([planUrl, reading], (_key, value) => {
    if (!value || typeof value !== 'object' || Array.isArray(value)) return value
    return Object.fromEntries(
      Object.entries(value).sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0)),
    )
  })
  return createHash('sha256').update(source).digest('hex')
}
