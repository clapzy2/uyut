import type { ReactNode, TextareaHTMLAttributes } from 'react'
import { cn } from './cn'
import { FieldError, FieldHint, Label } from './field'

export type TextareaProps = TextareaHTMLAttributes<HTMLTextAreaElement> & {
  id: string
  label: ReactNode
  error?: ReactNode
  hint?: ReactNode
}

export function Textarea({ id, label, error, hint, className, ...props }: TextareaProps) {
  const errorId = `${id}-error`
  const hintId = `${id}-hint`
  const describedBy = [error ? errorId : null, hint ? hintId : null].filter(Boolean).join(' ')

  return (
    <div className={className}>
      <Label htmlFor={id} className="mb-2">
        {label}
      </Label>
      <textarea
        id={id}
        aria-invalid={error ? true : undefined}
        aria-describedby={describedBy || undefined}
        className={cn(
          'min-h-32 w-full resize-y rounded-sm border border-control bg-paper px-3.5 py-3 text-[15px] leading-relaxed text-ink placeholder:text-ink-2/70 transition-[border-color,background-color,box-shadow] duration-200 ease-ui hover:border-ink focus-visible:border-accent focus-visible:shadow-[0_0_0_4px_color-mix(in_srgb,var(--accent)_12%,transparent)] aria-[invalid=true]:border-danger aria-[invalid=true]:shadow-[0_0_0_3px_color-mix(in_srgb,var(--danger)_9%,transparent)]',
        )}
        {...props}
      />
      <FieldError id={errorId}>{error}</FieldError>
      {hint && !error ? <FieldHint id={hintId}>{hint}</FieldHint> : null}
    </div>
  )
}
