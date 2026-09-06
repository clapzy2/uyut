import type { ButtonHTMLAttributes } from 'react'
import { cn } from './cn'

type Variant = 'primary' | 'secondary' | 'ghost'
type Size = 'md' | 'sm'

const variants: Record<Variant, string> = {
  primary:
    'bg-accent text-on-accent border border-accent hover:bg-accent-hover hover:border-accent-hover',
  secondary: 'bg-transparent text-ink border border-line-strong hover:border-ink',
  ghost: 'bg-transparent text-ink border border-transparent hover:text-accent',
}

const sizes: Record<Size, string> = {
  md: 'h-11 px-5 text-[15px]',
  sm: 'h-9 px-3.5 text-sm',
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
      className={cn(
        'inline-flex items-center justify-center gap-2 rounded-sm font-medium tracking-[0.01em] transition-colors duration-200 ease-ui',
        'disabled:cursor-not-allowed disabled:opacity-60',
        variants[variant],
        sizes[size],
        className,
      )}
      {...props}
    >
      {children}
    </button>
  )
}
