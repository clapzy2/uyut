// Общие для клиента и сервера ограничения на планы и фото комнат
export const PLAN_MAX_BYTES = 15 * 1024 * 1024
export const PLAN_ACCEPT = 'application/pdf,image/jpeg,image/png,image/webp'
export const PLAN_LIMIT_TEXT = 'PDF, JPG или PNG до 15 МБ'

export const PHOTO_MAX_BYTES = 10 * 1024 * 1024
export const PHOTO_ACCEPT = 'image/jpeg,image/png,image/webp'
export const PHOTO_LIMIT_TEXT = 'JPG, PNG или WebP до 10 МБ'

export function describeSize(bytes: number): string {
  const megabytes = bytes / (1024 * 1024)
  const rounded = megabytes >= 10 ? Math.round(megabytes) : Math.round(megabytes * 10) / 10
  return `${rounded.toLocaleString('ru-RU')} МБ`
}

export function tooLargeMessage(bytes: number, limitBytes: number): string {
  return `Файл весит ${describeSize(bytes)}, а можно до ${describeSize(limitBytes)}. Сожмите его или загрузите другой.`
}
