/** Второй участник видит, что проект чужой и что именно ему доступно */
export function PartnerBanner({ ownerName }: { ownerName: string }) {
  return (
    <p className="mt-5 border-l-2 border-accent bg-paper px-4 py-3 text-[15px] leading-relaxed text-ink-2">
      Вы в проекте {ownerName}: смотрите комнаты, отмечайте концепты, которые нравятся, и открывайте
      подбор товаров. Оплата, файлы и настройки у владельца.
    </p>
  )
}
