'use client'

import { Icon, Input, type InputProps } from '@uyut/ui'
import { useState } from 'react'

export function PasswordField(props: Omit<InputProps, 'type' | 'trailing'>) {
  const [visible, setVisible] = useState(false)
  return (
    <Input
      type={visible ? 'text' : 'password'}
      trailing={
        <button
          type="button"
          onClick={() => setVisible((value) => !value)}
          className="grid size-9 place-items-center rounded-full text-ink-2 transition-colors duration-200 ease-ui hover:text-ink"
          aria-label={visible ? 'Скрыть пароль' : 'Показать пароль'}
          aria-pressed={visible}
        >
          <Icon name={visible ? 'eyeOff' : 'eye'} className="size-[18px]" />
        </button>
      }
      {...props}
    />
  )
}
