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
      hint="Опишите расположение проёмов и выступов: верх, низ, слева, справа — как на плане. Это добавим в задание для новых концептов. Для размерной проверки используйте 2D-план и мерки; неизвестные детали можно оставить пустыми."
    />
  )
}
