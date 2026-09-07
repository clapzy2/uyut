import type { InputHTMLAttributes, ReactNode } from 'react'
import { cn } from './cn'
import { FieldError, FieldHint, Label } from './field'

export type InputProps = InputHTMLAttributes<HTMLInputElement> & {
  id: string
  label: ReactNode
  error?: ReactNode
  hint?: ReactNode
  trailing?: ReactNode
}

export const inputClassName =
  'h-11 w-full rounded-sm border border-control bg-paper px-3.5 text-[15px] text-ink placeholder:text-ink-2/70 transition-colors duration-200 ease-ui hover:border-ink focus:border-accent focus:outline-none aria-[invalid=true]:border-danger'

export function Input({ id, label, error, hint, trailing, className, ...props }: InputProps) {
  const errorId = `${id}-error`
  const hintId = `${id}-hint`
  const describedBy = [error ? errorId : null, hint ? hintId : null].filter(Boolean).join(' ')

  return (
    <div className={className}>
      <Label htmlFor={id} className="mb-2">
        {label}
      </Label>
      <div className="relative">
        <input
          id={id}
          aria-invalid={error ? true : undefined}
          aria-describedby={describedBy || undefined}
          className={cn(inputClassName, trailing ? 'pr-11' : null)}
          {...props}
        />
        {trailing ? (
          <div className="absolute inset-y-0 right-1 flex items-center">{trailing}</div>
        ) : null}
      </div>
      <FieldError id={errorId}>{error}</FieldError>
      {hint && !error ? <FieldHint id={hintId}>{hint}</FieldHint> : null}
    </div>
  )
}
