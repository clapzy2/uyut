import type { ReactNode } from 'react'
import { cn } from './cn'

export function Label({
  htmlFor,
  children,
  className,
}: {
  htmlFor: string
  children: ReactNode
  className?: string
}) {
  return (
    <label
      htmlFor={htmlFor}
      className={cn('block text-xs font-medium uppercase tracking-[0.1em] text-ink-2', className)}
    >
      {children}
    </label>
  )
}

export function FieldError({ id, children }: { id: string; children?: ReactNode }) {
  if (!children) {
    return null
  }
  return (
    <p id={id} role="alert" className="mt-1.5 text-sm leading-snug text-danger">
      {children}
    </p>
  )
}

export function FieldHint({ id, children }: { id: string; children: ReactNode }) {
  return (
    <p id={id} className="mt-1.5 text-sm leading-snug text-ink-2">
      {children}
    </p>
  )
}
