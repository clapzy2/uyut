import type { ButtonHTMLAttributes } from 'react'
import { cn } from './cn'

type Variant = 'primary' | 'secondary' | 'ghost'
type Size = 'md' | 'sm'

const variants: Record<Variant, string> = {
  primary:
    'bg-accent text-on-accent border border-accent hover:bg-accent-hover hover:border-accent-hover',
  secondary: 'bg-transparent text-ink border border-control hover:border-ink',
  ghost: 'bg-transparent text-ink border border-transparent hover:text-accent',
}

const sizes: Record<Size, string> = {
  md: 'h-11 px-5 text-[15px]',
  sm: 'h-9 px-3.5 text-sm',
}

// Те же стили нужны ссылкам, которые выглядят кнопкой, поэтому классы вынесены отдельно
export function buttonClassName(
  options: { variant?: Variant; size?: Size; className?: string } = {},
): string {
  return cn(
    'inline-flex items-center justify-center gap-2 rounded-sm font-medium tracking-[0.01em]',
    // Цвет и нажатие идут вместе: палец видит отклик там же, где его ждёт глаз.
    // Два процента — это пара пикселей: заметно на ощупь и незаметно на глаз,
    // а при выключенной анимации в системе браузер сам сводит длительность к нулю.
    'transition-[color,background-color,border-color,transform] duration-200 ease-ui active:scale-[0.98]',
    'disabled:cursor-not-allowed disabled:opacity-60 disabled:active:scale-100',
    variants[options.variant ?? 'primary'],
    sizes[options.size ?? 'md'],
    options.className,
  )
}

export type ButtonProps = ButtonHTMLAttributes<HTMLButtonElement> & {
  variant?: Variant
  size?: Size
  pending?: boolean
}

export function Button({
  variant = 'primary',
  size = 'md',
  pending = false,
  className,
  disabled,
  children,
  type = 'button',
  ...props
}: ButtonProps) {
  return (
    <button
      type={type}
      disabled={disabled || pending}
      aria-busy={pending || undefined}
      className={buttonClassName({ variant, size, className })}
      {...props}
    >
      {children}
    </button>
  )
}
