import { cn } from '@uyut/ui'

// Сдвиг фазы вшит в утилиту целиком, иначе Tailwind не найдёт класс при сборке
const DOTS = [
  'animate-[typing-dot_1200ms_var(--ease-ui)_0ms_infinite]',
  'animate-[typing-dot_1200ms_var(--ease-ui)_180ms_infinite]',
  'animate-[typing-dot_1200ms_var(--ease-ui)_360ms_infinite]',
]

/**
 * Три бегущие точки: показывают, что идёт работа, когда сказать больше нечего.
 *
 * Нужны в двух местах — в пузыре помощника, пока не пришёл первый символ, и на текущем шаге
 * генерации, где числа подолгу не меняются и экран выглядит замершим.
 */
export function TypingDots({ label, className }: { label: string; className?: string }) {
  return (
    <span
      role="status"
      aria-label={label}
      className={cn('inline-flex items-center gap-1 align-middle', className)}
    >
      {DOTS.map((animation) => (
        <span
          key={animation}
          aria-hidden="true"
          className={cn('size-1.5 rounded-full bg-ink-2', animation, 'motion-reduce:animate-none')}
        />
      ))}
    </span>
  )
}
