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
          'min-h-32 w-full resize-y rounded-sm border border-line bg-paper px-3.5 py-3 text-[15px] leading-relaxed text-ink placeholder:text-ink-2/70 transition-colors duration-200 ease-ui hover:border-line-strong focus:border-accent focus:outline-none aria-[invalid=true]:border-danger',
        )}
        {...props}
      />
      <FieldError id={errorId}>{error}</FieldError>
      {hint && !error ? <FieldHint id={hintId}>{hint}</FieldHint> : null}
    </div>
  )
}
