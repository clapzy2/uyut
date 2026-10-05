import type { RoomLayout } from '@uyut/catalog'
import type { Concept, Room } from '@uyut/db'
import Link from 'next/link'
import { pluralItems, pluralPositions } from '@/lib/shopping/format'
import type { ShoppingItemView } from '@/lib/shopping/repository'

type ExportConcept = Pick<
  Concept,
  'id' | 'roomId' | 'status' | 'likedByOwner' | 'createdAt' | 'renderUrl' | 'editedRenderUrl'
>
type ExportRoom = Pick<Room, 'id' | 'name' | 'areaM2'> & { conceptCount: number }
type ExportItem = Pick<
  ShoppingItemView,
  'roomId' | 'quantity' | 'variant' | 'catalogNotice' | 'dimensionsCm'
>

/** Matches jobs/pdf-data: only ready owner likes become PDF interiors. */
export function exportRoomComposition(
  room: ExportRoom,
  concepts: readonly ExportConcept[],
  objectConcepts: readonly { id: string; conceptId: string }[],
  items: readonly ExportItem[],
  layout: RoomLayout | null,
) {
  const votes = new Map<string, number>()
  for (const object of new Map(objectConcepts.map((object) => [object.id, object])).values()) {
    votes.set(object.conceptId, (votes.get(object.conceptId) ?? 0) + 1)
  }
  const candidates = concepts
    .filter(
      (concept) =>
        concept.roomId === room.id && concept.status === 'ready' && concept.likedByOwner === true,
    )
    .sort((left, right) => right.createdAt.getTime() - left.createdAt.getTime())
  const selected = [...candidates].sort(
    (left, right) => (votes.get(right.id) ?? 0) - (votes.get(left.id) ?? 0),
  )
  const main = selected.find((concept) => votes.has(concept.id)) ?? candidates[0]
  const alternates = candidates
    .filter((concept) => concept.id !== main?.id && concept.likedByOwner === true)
    .slice(0, 3)
  const positions = items.filter((item) => item.roomId === room.id).length

  return {
    ...room,
    mainId: main?.id ?? null,
    mainFromShopping: main ? votes.has(main.id) : false,
    hasRenderSource: Boolean(main?.editedRenderUrl ?? main?.renderUrl),
    alternateCount: alternates.length,
    hasLayout: Boolean(layout),
    positions,
    hasRoomSection: Boolean(main || layout),
  }
}

export function ExportComposition({
  projectId,
  rooms,
  items,
}: {
  projectId: string
  rooms: ReturnType<typeof exportRoomComposition>[]
  items: readonly ExportItem[]
}) {
  const variants = items.filter((item) => item.variant).length
  const notices = items.filter((item) => item.catalogNotice).length
  const missingSizes = items.filter(
    (item) => !item.dimensionsCm?.width || !item.dimensionsCm.depth,
  ).length
  const withoutRoom = items.filter((item) => item.roomId === null).length

  return (
    <section className="mt-5 border-y border-line py-4" aria-labelledby="export-composition-title">
      <h3 id="export-composition-title" className="text-[15px] font-medium text-ink">
        Состав следующего PDF
      </h3>
      <p className="mt-1 text-[13px] leading-relaxed text-ink-2">
        По текущим данным проекта. Это состав для сборки, а не уже готовый файл; число страниц и
        загруженные изображения можно проверить после сборки.
      </p>
      <p className="mt-3 text-[14px] leading-relaxed text-ink">
        Обложка и сведения о квартире, список покупок и ориентировочная смета.
      </p>
      <p className="mt-1 text-[13px] leading-relaxed text-ink-2">
        {items.length > 0
          ? `${pluralPositions(items.length)} · ${pluralItems(items.reduce((sum, item) => sum + item.quantity, 0))}. Позиций с выбранным вариантом: ${variants}.`
          : 'Товары не выбраны — список покупок в PDF будет пустым.'}{' '}
        Варианты, количество, цены из каталога, габариты и ссылки берутся из списка покупок выше.
        Цену и наличие нужно сверить в магазине.
      </p>
      {withoutRoom > 0 ? (
        <p className="mt-1 text-[13px] text-ink-2">
          Без привязки к комнате: {pluralPositions(withoutRoom)} — попадут в покупки, не в
          расстановку комнаты.
        </p>
      ) : null}
      {notices > 0 || missingSizes > 0 ? (
        <p className="mt-1 text-[13px] leading-relaxed text-ink-2">
          {notices > 0 ? `Позиций с замечанием к данным каталога: ${notices}. ` : ''}
          {missingSizes > 0
            ? `Без ширины или глубины: ${missingSizes}; точную расстановку этих товаров нужно уточнить. `
            : ''}
          Замечания сохраняются в документе.
        </p>
      ) : null}
      {rooms.length > 0 ? (
        <ul className="mt-3 divide-y divide-line">
          {rooms.map((room) => (
            <li key={room.id} className="py-2">
              <Link
                href={`/projects/${projectId}/rooms/${room.id}`}
                className="inline-flex min-h-11 items-center text-[14px] text-ink underline decoration-line-strong underline-offset-4 hover:text-accent"
              >
                {room.name}
              </Link>
              <p className="text-[13px] leading-relaxed text-ink-2">
                {room.mainId ? (
                  <>
                    <Link
                      href={`/projects/${projectId}/rooms/${room.id}/concepts/${room.mainId}`}
                      className="inline-flex min-h-11 items-center text-accent underline decoration-line-strong underline-offset-4"
                    >
                      Основной интерьер
                    </Link>{' '}
                    —{' '}
                    {room.mainFromShopping
                      ? 'из варианта, откуда выбрано больше всего предметов'
                      : 'последний понравившийся владельцу вариант'}
                    .{' '}
                    {room.alternateCount > 0
                      ? `Дополнительных понравившихся вариантов: ${room.alternateCount}. `
                      : ''}
                    {!room.hasRenderSource ? 'Изображение основного интерьера отсутствует. ' : ''}
                  </>
                ) : (
                  <>
                    Без выбранного интерьера.{' '}
                    {room.conceptCount > 0
                      ? 'Готовые варианты есть: отметьте понравившийся, чтобы добавить его в PDF. Покупки сами по себе не выбирают интерьер. '
                      : 'Готовых вариантов пока нет. '}
                  </>
                )}
                {room.hasLayout
                  ? '2D-схема по сохранённым меркам, со статусами и предупреждениями. '
                  : '2D-схемы нет: нужны размеры комнаты или связанный контур. '}
                {room.positions > 0
                  ? `В покупках: ${pluralPositions(room.positions)}. `
                  : 'Товары для комнаты не выбраны. '}
                {room.areaM2 === null ? 'Площадь не указана — работы не включены в смету. ' : ''}
                {!room.hasRoomSection
                  ? 'Отдельного раздела комнаты пока не будет; её название останется в сведениях о квартире.'
                  : ''}
              </p>
            </li>
          ))}
        </ul>
      ) : (
        <p className="mt-3 text-[13px] text-ink-2">Комнаты пока не добавлены.</p>
      )}
      <p className="mt-3 text-[13px] leading-relaxed text-ink-2">
        Задание для мастеров готовится при сборке. Бесплатный PDF может выйти без него, если
        подготовка не удалась. Изображение, которое не удалось загрузить, будет пропущено.
      </p>
      <p className="mt-1 text-[13px] leading-relaxed text-ink-2">
        3D-просмотр, инженерные чертежи и стоимость отделочных материалов в документ не входят.
        Неполные комнаты можно дополнить позже и собрать PDF заново.
      </p>
    </section>
  )
}
