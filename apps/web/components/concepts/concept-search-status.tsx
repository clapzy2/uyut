'use client'

import type { ObjectsStatus } from '@uyut/db'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { useEffect, useState, useTransition } from 'react'

export function ConceptSearchStatus({
  status,
  objectCount,
  roomHref,
}: {
  status: ObjectsStatus
  objectCount: number
  roomHref: string
}) {
  const router = useRouter()
  const [delayed, setDelayed] = useState(false)
  const [checking, startTransition] = useTransition()

  useEffect(() => {
    if (status !== 'pending') {
      return
    }
    let ticks = 0
    const timer = setInterval(() => {
      ticks += 1
      router.refresh()
      if (ticks >= 20) {
        clearInterval(timer)
        setDelayed(true)
      }
    }, 3000)
    return () => clearInterval(timer)
  }, [router, status])

  let text = 'Нажмите на номер на картинке или выберите предмет в списке — появятся похожие товары.'
  if (status === 'pending') {
    text = delayed
      ? 'Подбор занял больше времени. Концепт уже можно рассмотреть; проверьте статус или вернитесь к другим вариантам.'
      : 'Подбираем предметы и товары. Концепт уже готов к просмотру — подбор появится здесь автоматически.'
  } else if (status === 'failed') {
    text =
      objectCount > 0
        ? 'Подбор завершился не полностью. Найденные предметы доступны; можно проверить статус или посмотреть другие варианты.'
        : 'Подбор товаров не завершился. Концепт сохранён — можно проверить статус или посмотреть другие варианты интерьера.'
  } else if (status === 'skipped') {
    text =
      'Для этого варианта автоматический подбор товаров не выполнялся. Можно выбрать другой интерьер или продолжить сравнение стилей.'
  } else if (objectCount === 0) {
    text =
      'Подбор завершён: подходящих предметов для меток не нашлось. Можно посмотреть другие варианты интерьера.'
  }

  const canCheck = status === 'failed' || (status === 'pending' && delayed)
  const showAlternatives = status !== 'ready' || objectCount === 0

  return (
    <div className="text-[13px] leading-relaxed text-ink-2">
      <p role="status">{text}</p>
      {showAlternatives ? (
        <div className="mt-1 flex flex-wrap gap-x-5">
          {canCheck ? (
            <button
              type="button"
              disabled={checking}
              onClick={() => startTransition(() => router.refresh())}
              className="inline-flex min-h-11 items-center text-accent underline underline-offset-4 disabled:opacity-50"
            >
              {checking ? 'Проверяем статус…' : 'Проверить статус'}
            </button>
          ) : null}
          <Link
            href={roomHref}
            className="inline-flex min-h-11 items-center underline underline-offset-4"
          >
            К вариантам комнаты
          </Link>
        </div>
      ) : null}
      {canCheck ? <p className="mt-1">Проверка статуса не запускает новую генерацию.</p> : null}
    </div>
  )
}
