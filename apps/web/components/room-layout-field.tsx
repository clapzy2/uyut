'use client'

import { Textarea } from '@uyut/ui'

export function RoomLayoutField({
  id,
  value,
  onChange,
}: {
  id: string
  value: string
  onChange: (value: string) => void
}) {
  return (
    <Textarea
      id={id}
      label="Окна, двери и форма"
      value={value}
      onChange={(event) => onChange(event.currentTarget.value)}
      rows={4}
      maxLength={800}
      placeholder="Например: окно на нижней стене, вход слева у нижнего угла."
      hint="Стороны — как на плане: верх, низ, слева, справа. Проверьте проёмы и выступы. Описание учитывается в новых концептах, но не заменяет точный чертёж. Если не знаете, оставьте пустым."
    />
  )
}
