'use client'

import Link from 'next/link'
import { useEffect } from 'react'

export function RoomSectionLinks({
  isOwner,
  hasConcepts,
}: {
  isOwner: boolean
  hasConcepts: boolean
}) {
  useEffect(() => {
    // The room arrives after a streamed loading screen: native hash scrolling may miss it.
    const hash = window.location.hash
    if (hash !== '#room-concepts' && !(isOwner && hash === '#room-measurements')) {
      return
    }
    const frame = requestAnimationFrame(() => {
      const section = document.getElementById(hash.slice(1))
      section?.scrollIntoView({ block: 'start', behavior: 'instant' })
      section?.focus({ preventScroll: true })
    })
    return () => cancelAnimationFrame(frame)
  }, [isOwner])

  return (
    <nav aria-label="Разделы комнаты" className="mt-3 flex flex-wrap gap-x-6 text-sm text-accent">
      {isOwner ? (
        <Link
          href="#room-measurements"
          className="inline-flex min-h-11 items-center underline underline-offset-4"
        >
          Размеры и пожелания
        </Link>
      ) : null}
      <Link
        href="#room-concepts"
        className="inline-flex min-h-11 items-center underline underline-offset-4"
      >
        {hasConcepts ? 'Варианты интерьера' : 'Подготовить интерьер'}
      </Link>
    </nav>
  )
}
