import { cn } from '@uyut/ui'

/**
 * Пометка рекламы рядом со ссылкой на товар.
 *
 * Строку целиком отдаёт партнёрская сеть — «Реклама. Рекламодатель ООО «...» ИНН ... erid ...»;
 * она же регистрирует объявление в ОРД, наше дело показать пометку рядом со ссылкой.
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
