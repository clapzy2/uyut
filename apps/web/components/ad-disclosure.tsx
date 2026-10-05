import { cn } from '@uyut/ui'

/**
 * Пометка рекламы рядом со ссылкой на товар.
 *
 * Для большинства источников строку отдаёт партнёрская сеть. У Bestmebelshop она
 * составлена из реквизитов карточки программы Admitad, а erid находится в кликовой
 * ссылке. Перед включением нового фида реквизиты сверяются повторно.
 * Поэтому здесь нет truncate и нет обрезки по длине: закон требует, чтобы пометку было видно
 * целиком, а длинные ИНН и erid переносятся по словам.
 *
 * Ставится соседом ссылки, а не внутрь неё: иначе экранный диктор прочитает весь этот текст
 * как название ссылки.
 */
export function AdDisclosure({ text, className }: { text: string | null; className?: string }) {
  if (!text) {
    return null
  }
  return (
    <span className={cn('mt-1 block break-words text-[11px] leading-snug text-ink-2', className)}>
      {text}
    </span>
  )
}
