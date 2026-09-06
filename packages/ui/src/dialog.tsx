'use client'

import * as RadixDialog from '@radix-ui/react-dialog'
import type { ReactNode } from 'react'
import { cn } from './cn'
import { Icon } from './icons'

// Radix даёт фокус-ловушку, Escape и aria; внешний вид целиком наш
export const Dialog = RadixDialog.Root
export const DialogTrigger = RadixDialog.Trigger
export const DialogClose = RadixDialog.Close

export function DialogContent({
  title,
  description,
  children,
  className,
}: {
  title: ReactNode
  description?: ReactNode
  children: ReactNode
  className?: string
}) {
  return (
    <RadixDialog.Portal>
      <RadixDialog.Overlay className="fixed inset-0 z-40 bg-ink/40 data-[state=open]:animate-[dialog-fade_200ms_var(--ease-ui)]" />
      <RadixDialog.Content
        className={cn(
          'fixed left-1/2 top-1/2 z-50 w-[calc(100%-2rem)] max-w-md -translate-x-1/2 -translate-y-1/2 rounded-md border border-line bg-paper p-6 shadow-soft outline-none sm:p-8',
          'data-[state=open]:animate-[dialog-appear_350ms_var(--ease-appear)]',
          className,
        )}
      >
        <div className="flex items-start justify-between gap-4">
          <RadixDialog.Title className="font-serif text-2xl leading-tight text-ink">
            {title}
          </RadixDialog.Title>
          <RadixDialog.Close
            className="-mr-2 -mt-2 grid size-9 place-items-center rounded-full text-ink-2 transition-colors duration-200 ease-ui hover:text-ink"
            aria-label="Закрыть"
          >
            <Icon name="close" className="size-4" />
          </RadixDialog.Close>
        </div>
        {description ? (
          <RadixDialog.Description className="mt-2 text-[15px] text-ink-2">
            {description}
          </RadixDialog.Description>
        ) : null}
        <div className="mt-6">{children}</div>
      </RadixDialog.Content>
    </RadixDialog.Portal>
  )
}
