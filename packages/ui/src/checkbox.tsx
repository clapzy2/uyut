import type { InputHTMLAttributes, ReactNode } from 'react'
import { cn } from './cn'
import { FieldError } from './field'
import { Icon } from './icons'

export type CheckboxProps = Omit<InputHTMLAttributes<HTMLInputElement>, 'type'> & {
  id: string
  label: ReactNode
  error?: ReactNode
}

export function Checkbox({ id, label, error, className, ...props }: CheckboxProps) {
  const errorId = `${id}-error`
  return (
    <div className={className}>
      <label
        htmlFor={id}
        className="group flex cursor-pointer items-start gap-3 text-[15px] leading-snug"
      >
        <span className="relative mt-0.5 grid size-[18px] flex-none place-items-center">
          <input
            id={id}
            type="checkbox"
            aria-invalid={error ? true : undefined}
            aria-describedby={error ? errorId : undefined}
            className="peer absolute inset-0 size-full cursor-pointer appearance-none rounded-xs border border-line-strong bg-paper transition-colors duration-200 ease-ui checked:border-accent checked:bg-accent group-hover:border-ink checked:group-hover:border-accent-hover"
            {...props}
          />
          <Icon
            name="check"
            className={cn(
              'pointer-events-none relative size-3 text-on-accent opacity-0 transition-opacity duration-200 ease-ui peer-checked:opacity-100',
            )}
          />
        </span>
        <span>{label}</span>
      </label>
      <FieldError id={errorId}>{error}</FieldError>
    </div>
  )
}
