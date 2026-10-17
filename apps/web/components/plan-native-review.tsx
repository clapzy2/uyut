'use client'

import { Button } from '@uyut/ui'
import { useEffect, useRef, useState } from 'react'
import type { ReviewedNativePaintedFloors } from '@/lib/projects/plan-native-painted-floor-review'
import {
  loadNativeReview,
  NativeReviewRequestError,
} from '@/lib/projects/plan-native-review-client'
import type { NativeReviewPacket } from '@/lib/projects/plan-native-review-packet'
import { NativeSourceObjectSummary } from './plan-native-source-objects'

const coverageMessages: Record<string, string> = {
  'source-areas-held':
    'Неподтверждённые исходные области исключены из проверки физических стен и проёмов. Общий пол и внешний контур также не переносятся в 2D/3D.',
  'no-physical-room-contours':
    'На листе ещё нет подтверждённых физических контуров комнат; показывать пары стен и проёмов пока нечего.',
  'native-extraction-incomplete':
    'Не все линии исходника извлечены. Локальные находки не доказывают полноту листа.',
  'room-inventory-partial': 'Не для всех номеров помещений сохранены контуры.',
  'floor-boundary-missing':
    'В разметке нет границы пола квартиры. Внешняя огибающая стен её не заменяет.',
  'wall-pairing-source-unavailable': 'Исходные линии не позволяют перепроверить пары граней стен.',
  'wall-pairing-edge-limit': 'Для поиска пар стен достигнут лимит сложности разметки.',
  'wall-span-coverage-partial':
    'Часть границ требует сверки: локальные пары не покрывают всю квартиру.',
  'conditional-boundary-review-required':
    'Есть условные разделители зон. Они не считаются физическими стенами.',
  'review-spans-display-limited':
    'Внутренний перечень проверки ограничен 200 участками; счётчики включают остальные.',
  'door-face-pairing-partial':
    'Не все объявленные дверные грани связаны с парой по исходным линиям.',
  'non-door-declarations-unverified':
    'Окна и балконные блоки объявлены в разметке, но этим отчётом не проверены.',
  'floor-area-partition-unverified':
    'Не проверено, как комнаты, стены и технические зоны покрывают площадь пола.',
  'complete-opening-inventory-unverified': 'Не доказано, что учтены все проёмы исходника.',
  'physical-passages-unverified': 'Физические проходы, створки и свободные зоны не подтверждены.',
  'metric-scale-unverified': 'Масштаб и перевод в сантиметры здесь не проверяются.',
  'vertical-data-unverified': 'Высоты и вертикальные данные для 3D здесь не проверяются.',
}

export function SavedReviewCoverage({
  savedReview,
  hasSourceFloors = false,
}: {
  savedReview: NativeReviewPacket['savedReview']
  hasSourceFloors?: boolean
}) {
  return (
    <section className="border-t border-line pt-3" aria-label="Проверка сохранённой разметки">
      <h4 className="text-[14px] font-medium">Проверка сохранённой разметки</h4>
      {savedReview.status === 'not-saved' ? (
        <p className="mt-2 text-[13px] leading-relaxed text-ink-2">
          {hasSourceFloors
            ? 'Выбранные области пола сохранены отдельно. Контуры комнат и проёмов для 2D ещё не приняты.'
            : 'Ручная разметка этого листа ещё не сохранена. Найденные выше области не заменяют её.'}
        </p>
      ) : savedReview.status === 'unavailable' ? (
        <p className="mt-2 text-[13px] leading-relaxed text-ink-2">
          Разметка сохранена, но отчёт недоступен:{' '}
          {savedReview.reason === 'native-layer-unavailable'
            ? 'не удалось получить нативные линии PDF.'
            : 'версия разметки не поддерживается этой проверкой.'}
        </p>
      ) : savedReview.coverage.status === 'refused' ? (
        <div className="mt-2 text-[13px] leading-relaxed text-ink-2">
          <p>
            Сохранённая разметка не прошла перепроверку по текущему исходнику. Сверьте выбранный
            лист и контуры. Прежняя схема не изменена.
          </p>
          <details className="mt-2">
            <summary className="min-h-11 cursor-pointer py-3">Причина отказа проверки</summary>
            <p className="break-all">{savedReview.coverage.refusalReason}</p>
          </details>
        </div>
      ) : (
        <div className="mt-2 space-y-3 text-[13px] leading-relaxed">
          <p className="text-ink-2">
            Результат частичный. Пары граней — локальные кандидаты, не подтверждение всей квартиры
            или проходов. Сохранённая 2D/3D не меняется.
          </p>
          <dl className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            <div>
              <dt className="text-ink-2">Граница пола в разметке</dt>
              <dd>
                {savedReview.coverage.floorBoundary === 'reviewed-floor'
                  ? 'Есть контур пола'
                  : savedReview.coverage.floorBoundary === 'legacy-exterior-floor'
                    ? 'Унаследована из внешнего контура'
                    : savedReview.coverage.floorBoundary === 'envelope-only'
                      ? 'Только внешняя огибающая стен'
                      : 'Не задана'}
              </dd>
            </div>
            <div>
              <dt className="text-ink-2">Локальные пары граней стен</dt>
              <dd>{savedReview.coverage.wallPairs}</dd>
            </div>
            <div>
              <dt className="text-ink-2">Кандидаты пар дверных граней</dt>
              <dd>{savedReview.coverage.openings.doorPairCandidates}</dd>
            </div>
            <div>
              <dt className="text-ink-2">Объявленные дверные грани</dt>
              <dd>{savedReview.coverage.openings.declaredDoors} — не число физических дверей</dd>
            </div>
          </dl>
          {savedReview.coverage.missingSourceNumbers.length ? (
            <p className="text-ink-2">
              Нет контуров для номеров помещений:{' '}
              {savedReview.coverage.missingSourceNumbers.join(', ')}.
            </p>
          ) : null}
          <ul className="list-disc space-y-2 pl-5 text-ink-2">
            {savedReview.coverage.issues.map((issue) => (
              <li key={issue}>
                {coverageMessages[issue] ??
                  'Есть дополнительные ограничения исходника; нужна отдельная сверка.'}
              </li>
            ))}
          </ul>
        </div>
      )}
    </section>
  )
}

function FilledPanelSymbols({
  report,
  visible,
  onVisibilityChange,
}: {
  report: NonNullable<NativeReviewPacket['filledPanelSymbols']>
  visible: boolean
  onVisibilityChange: (visible: boolean) => void
}) {
  return (
    <section
      className="space-y-2 text-[13px] leading-relaxed"
      aria-label="Залитые профили исходника"
    >
      <h4 className="text-[14px] font-medium">Залитые профили исходника</h4>
      <p>
        Профили из залитых четырёхугольников:{' '}
        {report.status === 'unresolved' ? 'поиск не завершён' : report.candidates.length}.
      </p>
      <p className="text-ink-2">
        Корпус и два противоположных торца найдены по перекрытию исходных заливок, в том числе
        наклонных. Это сходство рисунка, не число окон или дверей. Полный контур косяков, видимость
        после поздних штрихов, высоты, физический проход и граница пола не подтверждены.
      </p>
      {report.status === 'unresolved' ? (
        <p className="break-all text-ink-2">Ограничение поиска: {report.refusalReason}.</p>
      ) : report.candidates.length ? (
        <>
          <details>
            <summary className="min-h-11 cursor-pointer py-3">Исходные корпуса и торцы</summary>
            <ul className="list-disc space-y-2 pl-5 text-ink-2">
              {report.candidates.map((candidate) => (
                <li key={candidate.id}>
                  <span className="break-all">{candidate.id}</span>: операции{' '}
                  {candidate.sourceRefs
                    .map((ref) => `${ref.operationIndex}:${ref.subpathIndex}`)
                    .join(', ')}
                  . Поздних операций рисования — {candidate.laterPaintCount}; возможных пропусков —{' '}
                  {candidate.omittedInkCount}. Назначение проёма не принято.
                </li>
              ))}
            </ul>
          </details>
          <label className="flex min-h-11 items-center gap-2">
            <input
              type="checkbox"
              checked={visible}
              onChange={(event) => onVisibilityChange(event.target.checked)}
            />
            Показать залитые профили — красный пунктир, не проверенные проёмы
          </label>
        </>
      ) : null}
    </section>
  )
}

function SourceSymbolLinks({ links }: { links: NonNullable<NativeReviewPacket['sourceLinks']> }) {
  return (
    <section
      className="space-y-2 text-[13px] leading-relaxed"
      aria-label="Контакты исходных символов"
    >
      <h4 className="text-[14px] font-medium">Контакты исходных символов</h4>
      <p className="text-ink-2">
        Проверяются только наблюдаемые контакты линий исходника. Принадлежность стене или комнате,
        полный контур косяков, граница свободного пола и полный перечень окон не подтверждены.
      </p>
      {links.status === 'unresolved' ? (
        <p className="text-ink-2">
          Поиск контактов не завершён; частичный набор не показан. Ограничение:{' '}
          <span className="break-all">{links.refusalReason}</span>.
        </p>
      ) : (
        <>
          <dl className="grid grid-cols-1 gap-3 sm:grid-cols-3">
            <div>
              <dt className="text-ink-2">Связанные дверные символы</dt>
              <dd>{links.doors.filter((door) => door.status === 'linked').length}</dd>
            </div>
            <div>
              <dt className="text-ink-2">Профили с контактами на двух торцах</dt>
              <dd>{links.glazing.filter((glazing) => glazing.status === 'two-sided').length}</dd>
            </div>
            <div>
              <dt className="text-ink-2">Группы исходных символов</dt>
              <dd>{links.groups.length}</dd>
            </div>
          </dl>
          <p className="text-ink-2">
            Это не число дверей, окон или балконных блоков. Новые соединительные линии, пороги и
            контуры пола не добавляются.
          </p>
          <details>
            <summary className="min-h-11 cursor-pointer py-3">Состав найденных контактов</summary>
            {links.doors.length || links.glazing.length ? (
              <ul className="list-disc space-y-2 pl-5">
                {links.doors.map((door) => (
                  <li key={`door:${door.symbolId}`}>
                    <span className="break-all">{door.symbolId}</span>:{' '}
                    {door.status === 'linked' ? (
                      <>
                        {door.relation === 'jamb-to-frame'
                          ? 'контакт створки и исходной линии косяка с рамкой'
                          : 'общая торцевая линия створки и профиля остекления'}{' '}
                        — <span className="break-all">{door.targetId}</span>.
                      </>
                    ) : door.status === 'ambiguous' ? (
                      'несколько возможных контактов, связь не выбрана.'
                    ) : (
                      'однозначный контакт не найден.'
                    )}
                  </li>
                ))}
                {links.glazing.map((glazing) => (
                  <li key={`glazing:${glazing.symbolId}`}>
                    <span className="break-all">{glazing.symbolId}</span>:{' '}
                    {glazing.status === 'two-sided'
                      ? 'найдены исходные контакты на двух торцах профиля.'
                      : glazing.status === 'ambiguous'
                        ? 'контакты неоднозначны, связь не выбрана.'
                        : 'контакты на двух торцах не найдены.'}
                  </li>
                ))}
                {links.groups.map((group, index) => (
                  <li key={`group:${group.id}`}>
                    Группа {index + 1}: профилей {group.glazingIds.length}, дверных символов{' '}
                    {group.doorIds.length}.{' '}
                    <span className="break-all">
                      {[...group.glazingIds, ...group.doorIds].join(', ')}
                    </span>
                  </li>
                ))}
              </ul>
            ) : (
              <p className="text-ink-2">Нет исходных символов для проверки контактов.</p>
            )}
          </details>
        </>
      )}
    </section>
  )
}

const frameRoomStatusMessages = {
  'two-reviewed-sides': 'Две стороны сохранённой разметки',
  'one-reviewed-side': 'Одна сторона сохранённой разметки',
  'coincident-sides': 'Совпадающие стороны — связь не подтверждена',
  ambiguous: 'Неоднозначное сопоставление',
  unresolved: 'Стороны не сопоставлены',
}

const scheduleMarkerMessages = {
  linked: 'Номер совпал',
  ambiguous: 'Неоднозначно',
  unobserved: 'Не наблюдалась',
  unavailable: 'Поиск недоступен',
}

function RoomSchedule({ report }: { report: NonNullable<NativeReviewPacket['roomSchedule']> }) {
  return (
    <section
      className="space-y-2 border-t border-line pt-3 text-[13px] leading-relaxed"
      aria-label="Экспликация и цифровые метки"
    >
      <h4 className="text-[14px] font-medium">Экспликация и цифровые метки</h4>
      {report.status === 'unresolved' ? (
        <div className="text-ink-2">
          <p>Таблица не распознана однозначно; частичный перечень не показан.</p>
          <details>
            <summary className="min-h-11 cursor-pointer py-3">
              Ограничение поиска экспликации
            </summary>
            <p className="break-all">{report.refusalReason}</p>
          </details>
        </div>
      ) : (
        <>
          <p className="text-ink-2">
            Совпадение номера в таблице и окружности — документальная связь, не принадлежность метки
            комнате или подтверждение границы свободного пола. Площади — подписи на листе, не
            обмеры; мерки и масштаб этим не принимаются.
          </p>
          <table className="w-full table-fixed text-left text-[12px] sm:text-[13px]">
            <caption className="sr-only">Нативная экспликация и наблюдения цифровых меток</caption>
            <thead className="border-b border-line text-ink-2">
              <tr>
                <th scope="col" className="w-[8%] py-2 pr-1 font-normal">
                  №
                </th>
                <th scope="col" className="w-[36%] py-2 pr-2 font-normal">
                  Наименование
                </th>
                <th scope="col" className="w-[22%] py-2 pr-2 font-normal">
                  На листе, м²
                </th>
                <th scope="col" className="w-[34%] py-2 font-normal">
                  Метка
                </th>
              </tr>
            </thead>
            <tbody>
              {report.rows.map((row) => (
                <tr key={row.sourceNumber} className="border-b border-line align-top">
                  <th scope="row" className="py-2 pr-1 font-normal">
                    {row.sourceNumber}
                  </th>
                  <td className="break-words py-2 pr-2">{row.name}</td>
                  <td className="break-all py-2 pr-2 tabular-nums">
                    {String(row.documentaryAreaM2).replace('.', ',')}
                  </td>
                  <td className="break-words py-2 text-ink-2">
                    {scheduleMarkerMessages[row.markerStatus]}
                    {row.markerStatus === 'ambiguous' ? ` (${row.markerLabelIds.length})` : null}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          {report.unlistedMarkerLabelIds.length ? (
            <p className="text-ink-2">
              Метки без строки в экспликации: {report.unlistedMarkerLabelIds.length}. Это не
              дополнительные комнаты.
            </p>
          ) : null}
          <details className="text-ink-2">
            <summary className="min-h-11 cursor-pointer py-3">
              Подписи исходника и связи номеров
            </summary>
            <ol className="list-decimal space-y-2 pl-5">
              {report.rows.map((row) => (
                <li key={row.sourceNumber}>
                  <p className="break-all">
                    Строка {row.sourceNumber}: {row.numberLabelId}, {row.nameLabelId},{' '}
                    {row.areaLabelId}.
                  </p>
                  <p className="break-all">
                    Метки:{' '}
                    {row.markerLabelIds.length
                      ? row.markerLabelIds.join(', ')
                      : 'нет наблюдаемых связей'}
                    .
                  </p>
                </li>
              ))}
            </ol>
            {report.unlistedMarkerLabelIds.length ? (
              <p className="mt-2 break-all">
                Без строки: {report.unlistedMarkerLabelIds.join(', ')}.
              </p>
            ) : null}
          </details>
        </>
      )}
    </section>
  )
}

const floorCavityReasons: Record<string, string> = {
  'unsupported-cavity-polygon':
    'Контур не прошёл проверку; в том числе могут быть малые обломки границы.',
  'nested-painted-island': 'Внутри есть отдельный островок исходной заливки.',
  'unresolved-paint-topology': 'Топология исходной заливки неоднозначна.',
  'boundary-source-gap': 'Не для всей границы найдено исходное линейное основание.',
}

function FloorCavityReview({
  report,
  circles,
  showLayer,
  onToggle,
}: {
  report: NonNullable<NativeReviewPacket['floorCavities']>
  circles: NativeReviewPacket['numberCircles']
  showLayer: boolean
  onToggle: (value: boolean) => void
}) {
  const numbers = new Map(circles?.cues.map(({ labelId, sourceNumber }) => [labelId, sourceNumber]))
  const markerNumbers = (ids: string[]) =>
    [...new Set(ids.map((id) => numbers.get(id)).filter((number) => number !== undefined))].join(
      ' + ',
    )
  const heldGroups = new Map<string, { reason: string; vertexCount: number; count: number }>()
  for (const item of report.unprovedCavities) {
    const key = `${item.reason}:${item.vertexCount}`
    const group = heldGroups.get(key)
    if (group) group.count++
    else heldGroups.set(key, { ...item, count: 1 })
  }
  return (
    <section
      className="space-y-2 border-t border-line pt-3 text-[13px] leading-relaxed"
      aria-label="Кандидаты границ пола и порогов"
    >
      <h4 className="text-[14px] font-medium">Кандидаты границ пола и порогов</h4>
      {report.status === 'unresolved' ? (
        <p className="break-all text-ink-2">
          Поиск не завершён; частичные границы не показаны. Ограничение: {report.refusalReason}.
        </p>
      ) : (
        <>
          <p className="text-ink-2">
            Это математические области по исходным линиям и заливкам. Полосы рамок и профильные
            замыкания — логические разделители, не физические стены или проверенные пороги.
            Совпадение цифровой метки с таблицей не подтверждает точный пол, владельца комнаты,
            свободный проход или готовность 2D/3D.
          </p>
          <dl className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            <div>
              <dt className="text-ink-2">Кандидаты с цифровыми метками</dt>
              <dd>{report.candidates.filter((cell) => cell.markerLabelIds.length > 0).length}</dd>
            </div>
            <div>
              <dt className="text-ink-2">Неразмеченные области</dt>
              <dd>{report.candidates.filter((cell) => cell.markerStatus === 'unmarked').length}</dd>
            </div>
            <div>
              <dt className="text-ink-2">Логические полосы по рамкам</dt>
              <dd>{report.thresholds.length}</dd>
            </div>
            <div>
              <dt className="text-ink-2">Профильные замыкания</dt>
              <dd>{report.closures.length}</dd>
            </div>
            <div>
              <dt className="text-ink-2">Неподтверждённые области в отчёте</dt>
              <dd>{report.unprovedCavities.length}</dd>
            </div>
            <div>
              <dt className="text-ink-2">Неизвестные линии внутри, по кандидатам</dt>
              <dd>
                {report.candidates.reduce((sum, cell) => sum + cell.unknownInteriorStrokeCount, 0)}
              </dd>
            </div>
            <div>
              <dt className="text-ink-2">Пропуски на границах, по кандидатам</dt>
              <dd>
                {report.candidates.reduce((sum, cell) => sum + cell.omittedBoundaryInkCount, 0)}
              </dd>
            </div>
          </dl>
          {report.markerLeaders !== undefined ? (
            <p className="text-ink-2">
              Связи меток по исходным выноскам: {report.markerLeaders.length}. Выноска — не граница
              пола и не проход.
            </p>
          ) : null}
          {!report.markersAvailable ? (
            <p className="text-ink-2">
              Цифровые метки недоступны для сверки; это не отсутствие помещений.
            </p>
          ) : null}
          {report.unresolvedMarkerLabelIds.length ? (
            <p className="text-ink-2">
              Метки без найденного кандидата: {markerNumbers(report.unresolvedMarkerLabelIds)}.
              Ближайшая область не назначается.
            </p>
          ) : null}
          {report.candidates.some((cell) => cell.markerStatus === 'ambiguous') ? (
            <p className="text-ink-2">
              Есть конкурирующие метки или области; принадлежность не выбрана.
            </p>
          ) : null}
          {report.thresholds.length ||
          report.candidates.some((cell) => cell.markerLabelIds.length) ? (
            <label className="flex min-h-11 items-center gap-2">
              <input
                type="checkbox"
                checked={showLayer}
                onChange={(event) => onToggle(event.target.checked)}
              />
              Показать кандидаты с метками — зелёные контуры; логические полосы — фиолетовый пунктир
            </label>
          ) : null}
          <details className="text-ink-2">
            <summary className="min-h-11 cursor-pointer py-3">
              Области, замыкания и удержанные ограничения
            </summary>
            <p>
              Неразмеченные области, малые обломки, островки и спорная топология не удалены и не
              названы шахтами. Это не полный перечень пола.
            </p>
            <ul className="mt-2 list-disc space-y-2 pl-5">
              {report.candidates.map((cell) => {
                const leaders =
                  report.markerLeaders?.filter((leader) => leader.cavityId === cell.id) ?? []
                const ledIds = new Set(leaders.map(({ labelId }) => labelId))
                const containedIds = cell.markerLabelIds.filter((id) => !ledIds.has(id))
                return (
                  <li key={cell.id}>
                    <span className="break-all">{cell.id}</span>:{' '}
                    {containedIds.length
                      ? `метки ${markerNumbers(containedIds)}${report.markerLeaders === undefined ? '' : ' внутри математической области'}`
                      : leaders.length
                        ? 'внутренних цифровых меток не наблюдалось'
                        : cell.markerStatus === 'unavailable'
                          ? 'проверка меток недоступна'
                          : 'без цифровой метки'}
                    ; неизвестных линий {cell.unknownInteriorStrokeCount}, пропусков на границе{' '}
                    {cell.omittedBoundaryInkCount}.
                    {leaders.map((leader) => (
                      <p key={leader.labelId} className="mt-1 break-all">
                        Метка {numbers.get(leader.labelId)} по исходной выноске ({leader.labelId}).
                        Исходный отрезок: операция {leader.segment.operationIndex}, подпуть{' '}
                        {leader.segment.subpathIndex}, сегмент {leader.segment.segmentIndex}.
                        Координаты изображения: ({leader.segment.start.x}, {leader.segment.start.y})
                        → ({leader.segment.end.x}, {leader.segment.end.y}); окружность у{' '}
                        {leader.circleEndpoint === 'start' ? 'начала' : 'конца'} отрезка.
                      </p>
                    ))}
                  </li>
                )
              })}
              {report.closures.map((closure) => (
                <li key={closure.id}>
                  <span className="break-all">{closure.id}</span>:{' '}
                  {closure.sourceKind === 'closed-path'
                    ? 'исходный замкнутый путь'
                    : 'буквально замкнувшийся участок исходного пути'}
                  ; вне участка осталось отрезков {closure.remainingSegmentCount}.
                  {closure.paintAmbiguous
                    ? ' Заливка неоднозначна; замыкание не используется для этих областей.'
                    : null}
                </li>
              ))}
              {report.thresholds
                .filter((threshold) => threshold.paintAmbiguous)
                .map((threshold) => (
                  <li key={threshold.frameId}>
                    <span className="break-all">{threshold.frameId}</span>: неоднозначная заливка
                    логической полосы; в границах областей не используется.
                  </li>
                ))}
              {[...heldGroups.entries()].map(([key, item]) => (
                <li key={key}>
                  {floorCavityReasons[item.reason] ?? 'Область требует отдельной сверки исходника.'}{' '}
                  Вершин: {item.vertexCount}; областей: {item.count}.{' '}
                  <span className="break-all">{item.reason}</span>.
                </li>
              ))}
            </ul>
          </details>
        </>
      )}
    </section>
  )
}

const frameNumberCueMessages = {
  inside: 'Цифровая метка строго внутри сохранённого контура.',
  'not-inside': 'Цифровая метка не находится строго внутри сохранённого контура.',
  ambiguous: 'Сопоставление цифровой метки неоднозначно.',
  unavailable: 'Цифровая метка для этой сверки недоступна.',
}

const heightQuantityMessages = {
  'finished-ceiling': 'чистый потолок',
  'opening-height': 'высота проёма',
  'beam-level': 'уровень балки',
  'threshold-height': 'высота порога (не отметка пола)',
  'threshold-level': 'уровень порога',
  'unclassified-height': 'вид высоты не определён',
}
const heightDatumMessages = {
  unspecified: 'уровень отсчёта не проверен',
  'existing-floor': 'буквально указан существующий пол',
  'finished-floor': 'буквально указан чистый пол',
}

function SourceCaptionReview({
  report,
}: {
  report: NonNullable<NativeReviewPacket['sourceCaptionBindings']>
}) {
  return (
    <section
      className="space-y-2 border-t border-line pt-3 text-[13px] leading-relaxed"
      aria-label="Связь исходной подписи с размерной линией"
    >
      <h4 className="text-[14px] font-medium">Связь исходной подписи с размерной линией</h4>
      <p className="text-ink-2">
        Размерные роли из прежнего поиска и буквальная связь текстового фрагмента PDF с исходной
        линией проверяются отдельно. При недоступной или отказавшей связи прежний кандидат не
        используется как её доказательство.
      </p>
      {report.status === 'unresolved' ? (
        <p className="break-all text-ink-2">
          Сверка исходных текстовых фрагментов не завершена; частичный набор не показан.
          Ограничение: {report.refusalReason}.
        </p>
      ) : (
        <>
          <p>
            Кандидаты буквальной связи: {report.candidates.length}; удержанные подписи:{' '}
            {report.unresolved.length}.
          </p>
          {report.candidates.length === 0 ? (
            <p className="text-ink-2">
              Эта строгая проверка пока не подтвердила ни одной связи подписи с размерной линией.
            </p>
          ) : null}
          {report.candidates.length || report.unresolved.length ? (
            <details className="text-ink-2">
              <summary className="min-h-11 cursor-pointer py-3">
                Исходные подписи, позиции и ссылки на линии
              </summary>
              <ul className="list-disc space-y-2 pl-5">
                {report.candidates.map((item) => (
                  <li key={item.labelId} className="break-all">
                    {item.labelId}: {item.valueMm} мм,{' '}
                    {item.axis === 'aligned'
                      ? 'наклонное направление'
                      : `ось ${item.axis === 'width' ? 'X' : 'Y'}`}
                    {'; '}компактная позиция {item.compactIndex}; исходная линия{' '}
                    {item.rail.operationIndex}:{item.rail.subpathIndex}.
                    {item.angleDegrees !== undefined ? ` Исходный угол ${item.angleDegrees}°.` : ''}
                    {item.textPlacement === 'glyph-ink'
                      ? ` Положение по настоящим глифам PDF; операция текста ${item.inkSourceOperation}.`
                      : item.textPlacement === 'baseline'
                        ? ' Положение по исходной базовой линии текста, без свидетельства глифов.'
                        : ''}{' '}
                    Связь остаётся кандидатом.
                  </li>
                ))}
                {report.unresolved.map((item) => (
                  <li key={item.labelId} className="break-all">
                    {item.labelId}: связь удержана — {item.reason}.
                  </li>
                ))}
              </ul>
            </details>
          ) : null}
        </>
      )}
      <p className="text-ink-2">
        Даже найденная связь не подтверждает целую стену или косяк, независимый масштаб по X и Y
        либо готовность 2D/3D. Размеры не переносятся в геометрию.
      </p>
    </section>
  )
}

const dimensionTargetMessages = {
  continuous: 'непрерывное исходное свидетельство',
  detached: 'разрыв исходной выносной линии',
  ambiguous: 'неоднозначно',
  unresolved: 'не подтверждено',
  conflict: 'конфликт размеров одной грани пола',
}

function DimensionStrokeContactsReview({
  report,
}: {
  report: NonNullable<NativeReviewPacket['dimensionStrokeContacts']>
}) {
  const overlaps = report.observations
    .flatMap((row) => row.tips)
    .filter((tip) => tip.status === 'ink-overlap')
  return (
    <section
      className="space-y-2 border-t border-line pt-3 text-[13px] leading-relaxed"
      aria-label="Толщина исходных штрихов"
    >
      <h4 className="text-[14px] font-medium">Толщина исходных штрихов</h4>
      <p className="text-ink-2">
        Проверяем попадание конца размерной линии внутрь штриха с учётом толщины, преобразования и
        отсечения PDF. Это модель краски по данным PDF.js, а не точный контакт осевых линий. Такие
        совпадения не выбирают границу пола или косяк и не переносятся в 2D/3D.
      </p>
      <p className="text-ink-2">
        {report.visibility === 'checked'
          ? 'Проверяем позднюю краску у каждого контакта: штрихи, заливки, текст и изображения. Возможное перекрытие или неизвестная область удерживают связь. Отсутствие перекрытия в точке не доказывает видимость всей линии или физический объект.'
          : 'Видимость после наложения текста, изображений и других объектов ещё не проверена.'}
      </p>
      {report.status === 'unresolved' ? (
        <p className="break-all text-ink-2">
          Проверка толщины не завершена: {report.refusalReason}.
        </p>
      ) : (
        <>
          <p>
            Концы внутри штрихов: {overlaps.length}; удержанные концы:{' '}
            {report.observations.length * 2 - overlaps.length}. Наложения не подтверждают физические
            объекты.
          </p>
          {report.visibility === 'checked' ? (
            <p>
              Контакты без позднего перекрытия в точке:{' '}
              {overlaps.filter((tip) => tip.visibility?.status === 'unoccluded').length}; видимость
              удержана: {overlaps.filter((tip) => tip.visibility?.status !== 'unoccluded').length}.
            </p>
          ) : null}
          {report.observations.length ? (
            <details className="text-ink-2">
              <summary className="min-h-11 cursor-pointer py-3">
                Штрихи у концов размерных линий
              </summary>
              <ul className="list-disc space-y-2 pl-5">
                {report.observations.map((row) => (
                  <li key={row.labelId} className="break-all">
                    {row.labelId}: {row.valueMm} мм; линия {row.rail.operationIndex}:
                    {row.rail.subpathIndex}.
                    {row.tips.map((tip) => (
                      <p key={tip.endpoint}>
                        Конец {tip.endpoint + 1}:{' '}
                        {tip.status === 'ink-overlap'
                          ? 'внутри модели штриха; видимость не подтверждена'
                          : `удержан — ${tip.reason}`}
                        .
                        {tip.sourceRefs.length
                          ? ` Исходные ссылки: ${tip.sourceRefs
                              .map(
                                (ref) =>
                                  `${ref.operationIndex}:${ref.subpathIndex}:${ref.segmentIndex}`,
                              )
                              .join(', ')}.`
                          : ''}
                        {tip.visibility ? (
                          <span>
                            {' '}
                            Проверка видимости:{' '}
                            {tip.visibility.status === 'unoccluded'
                              ? 'нет позднего перекрытия в точке'
                              : `удержана — ${tip.visibility.reason}`}
                            .
                            {tip.visibility.blockerOperations.length
                              ? ` Возможные перекрытия: ${tip.visibility.blockerOperations.length} операций PDF.`
                              : ''}
                          </span>
                        ) : null}
                      </p>
                    ))}
                  </li>
                ))}
              </ul>
            </details>
          ) : null}
        </>
      )}
    </section>
  )
}

function SelectedDimensionBoundariesReview({
  report,
}: {
  report: NonNullable<NativeReviewPacket['selectedDimensionBoundaries']>
}) {
  return (
    <section
      className="space-y-2 border-t border-line pt-3 text-[13px] leading-relaxed"
      aria-label="Размеры и выбранные грани пола"
    >
      <h4 className="text-[14px] font-medium">Размеры и выбранные грани пола</h4>
      <p className="text-ink-2">
        Сравниваем целый вектор размерной линии с исходными гранями сохранённых областей пола.
        Равный вектор — предложение для сверки, не подтверждённая привязка к стене, полу или проёму.
        Роль грани задана в разметке; физический материал, свободная сторона и косяки ещё требуют
        доказательств. Часть длинной грани не объявляется целой. Размеры не переносятся в 2D/3D.
      </p>
      {report.status === 'unresolved' ? (
        <p className="break-all text-ink-2">
          Сверка выбранных граней не завершена: {report.refusalReason}.
        </p>
      ) : (
        <>
          <p>
            Предложения: {report.observations.filter((row) => row.status === 'candidate').length}
            {'; '}
            неоднозначные: {report.observations.filter((row) => row.status === 'ambiguous').length}
            {'; '}
            без соответствия:{' '}
            {report.observations.filter((row) => row.status === 'unresolved').length}. Физические
            границы не приняты.
          </p>
          <details className="text-ink-2">
            <summary className="min-h-11 cursor-pointer py-3">
              Исходные грани и ограничения привязки
            </summary>
            <ul className="list-disc space-y-2 pl-5">
              {report.observations.map((row) => (
                <li key={row.labelId} className="break-all">
                  {row.labelId}: {row.valueMm} мм. Ограничение: {row.reason}.
                  {row.candidates.map((candidate) => (
                    <p
                      key={`${candidate.floorId}:${candidate.ringIndex ?? 0}:${candidate.edgeIndex}`}
                    >
                      Помещение {candidate.sourceRoomKey}; {candidate.floorId};{' '}
                      {candidate.ringIndex ? `вырез ${candidate.ringIndex}, ` : ''}грань{' '}
                      {candidate.edgeIndex}. Вектор целой исходной грани совпадает после
                      параллельного сдвига на листе. Роль в разметке: {candidate.declaredRole},{' '}
                      штрихи границы {candidate.boundaryInkComplete ? 'полны' : 'неполны'}. Исходные
                      ссылки:{' '}
                      {candidate.sourceRefs
                        .map(
                          (ref) => `${ref.operationIndex}:${ref.subpathIndex}:${ref.segmentIndex}`,
                        )
                        .join(', ') || 'нет'}
                      .
                      {candidate.endpointBinding ? (
                        <span className="mt-1 block">
                          Привязка выносных линий к исходным углам:{' '}
                          {candidate.endpointBinding.status === 'continuous'
                            ? 'непрерывная по ограниченным исходным штрихам'
                            : candidate.endpointBinding.status === 'detached'
                              ? 'есть разрыв; линия не достраивается'
                              : candidate.endpointBinding.status === 'ambiguous'
                                ? 'неоднозначные исходные штрихи'
                                : 'не доказана'}
                          . Это не подтверждение физических границ, масштаба или высот.
                        </span>
                      ) : (
                        <span> Контакт выносных линий не доказан.</span>
                      )}
                      {candidate.boundaryVisibility ? (
                        <span className="mt-1 block">
                          Весь буквальный отрезок исходной грани:{' '}
                          {candidate.boundaryVisibility.status === 'unoccluded'
                            ? 'поздняя краска исключена по всей длине'
                            : `проверка удержана — ${candidate.boundaryVisibility.reason}`}
                          . Возможные перекрытия:{' '}
                          {candidate.boundaryVisibility.blockerOperations.length} операций PDF. Это
                          не подтверждение видимости всей полосы краски или физической стены/косяка.
                        </span>
                      ) : null}
                    </p>
                  ))}
                </li>
              ))}
            </ul>
          </details>
        </>
      )}
    </section>
  )
}

function DimensionTargetsReview({
  report,
}: {
  report: NonNullable<NativeReviewPacket['dimensionTargets']>
}) {
  const refsText = (
    refs: { operationIndex: number; subpathIndex: number; segmentIndex: number }[],
  ) => refs.map((ref) => `${ref.operationIndex}:${ref.subpathIndex}:${ref.segmentIndex}`).join(', ')
  const gapText = (value: number) => {
    const displayed = Number(value.toPrecision(6))
    return `разрыв ${displayed === value ? '' : '≈'}${displayed} pt PDF`
  }
  const directionText = { width: 'X', depth: 'Y', aligned: 'наклонное направление' }
  return (
    <section
      className="space-y-2 border-t border-line pt-3 text-[13px] leading-relaxed"
      aria-label="Размеры, грани и косяки"
    >
      <h4 className="text-[14px] font-medium">Размеры, грани и косяки</h4>
      <p className="text-ink-2">
        Проверяем исходные связи размерной линии с целой гранью пола или рамкой проёма. Это не
        подтверждение стены, помещения или физического прохода и не готовность переноса в 2D/3D.
        Разрыв выносной линии не достраивается автоматически.
      </p>
      <p className="text-ink-2">
        Для наклонных линий учитываем ширину и высоту PDF-листа. Совпадение штрихов на экране ещё не
        доказывает точный контакт исходных линий или принадлежность размера целой грани.
      </p>
      {report.status === 'unresolved' ? (
        <p className="break-all text-ink-2">
          Проверка граней и косяков не завершена; частичный набор не показан. Ограничение:{' '}
          {report.refusalReason}.
        </p>
      ) : (
        <>
          <p>
            Непрерывные связи:{' '}
            {report.observations.filter((item) => item.status === 'continuous').length}; однозначные
            связи с разрывом:{' '}
            {report.observations.filter((item) => item.status === 'detached').length};{' '}
            неоднозначные:{' '}
            {report.observations.filter((item) => item.status === 'ambiguous').length};{' '}
            неподтверждённые:{' '}
            {report.observations.filter((item) => item.status === 'unresolved').length}. Удержанные
            подписи: {report.unresolved.length}. Конфликты размеров:{' '}
            {report.observations.filter((item) => item.status === 'conflict').length}.
          </p>
          {report.observations.length || report.unresolved.length ? (
            <details className="text-ink-2">
              <summary className="min-h-11 cursor-pointer py-3">
                Грани, альтернативы и исходные свидетельства
              </summary>
              <ul className="list-disc space-y-3 pl-5">
                {report.observations.map((item) => (
                  <li key={item.labelId} className="break-all">
                    {item.labelId}: {item.valueMm} мм; {dimensionTargetMessages[item.status]}.
                    {item.reason ? ` Ограничение: ${item.reason}.` : ''}
                    <p className="mt-1">Направление: {directionText[item.axis]}.</p>
                    {item.targets.map((target) => (
                      <div key={`${target.kind}:${target.id}`} className="mt-1 pl-2">
                        {target.kind === 'floor-boundary'
                          ? 'Исходная граница области (пол не подтверждён)'
                          : 'Исходная рамка (проём не подтверждён)'}{' '}
                        {target.id}.
                        {target.faces.map((face) => (
                          <div key={face.edgeIndex} className="mt-1 pl-2">
                            Грань {face.edgeIndex}: {dimensionTargetMessages[face.status]}.
                            {face.reason ? ` ${face.reason}.` : ''} Опоры:{' '}
                            {refsText(face.supportRefs)}.
                            {[
                              { endpoint: 'Конец 1', witness: face.endpointWitnesses[0] },
                              { endpoint: 'Конец 2', witness: face.endpointWitnesses[1] },
                            ].map(({ endpoint, witness }) => (
                              <div key={endpoint} className="pl-2">
                                {endpoint}: {dimensionTargetMessages[witness.status]};{' '}
                                {witness.gapPoints === null
                                  ? 'разрыв не определён'
                                  : gapText(witness.gapPoints)}
                                . Исходные ссылки: {refsText(witness.sourceRefs) || 'нет'}.
                              </div>
                            ))}
                          </div>
                        ))}
                      </div>
                    ))}
                  </li>
                ))}
                {report.unresolved.map((item) => (
                  <li key={item.labelId} className="break-all">
                    {item.labelId}: подпись удержана — {item.reason}.
                  </li>
                ))}
              </ul>
            </details>
          ) : null}
          {report.jambSpans?.length ? (
            <details className="text-ink-2">
              <summary className="min-h-11 cursor-pointer py-3">
                Парные косяки: {new Set(report.jambSpans.map((item) => item.frameId)).size} рамок;{' '}
                {report.jambSpans.length} подписей
              </summary>
              <p>
                Повторные подписи одной рамки не являются независимыми опорами. Парный интервал не
                выбирает одну из альтернативных граней и не подтверждает физический проход.
              </p>
              <ul className="list-disc space-y-2 pl-5">
                {report.jambSpans.map((item) => (
                  <li key={item.labelId} className="break-all">
                    {item.labelId}: рамка {item.frameId}, {item.valueMm} мм, ось{' '}
                    {item.axis === 'width' ? 'X' : 'Y'};{' '}
                    {item.status === 'conflict'
                      ? 'конфликт подписей'
                      : dimensionTargetMessages[item.status]}
                    . Грани: {item.faceEdgeIndexes.join(', ')}. Косяк 1:{' '}
                    {refsText(item.jambRefs[0])}; косяк 2: {refsText(item.jambRefs[1])}.
                  </li>
                ))}
              </ul>
            </details>
          ) : null}
        </>
      )}
      <p className="text-ink-2">
        Разрывы указаны в пунктах PDF (pt), не в сантиметрах квартиры и не как монтажный допуск.
        Знак ≈ означает сокращённое отображение числа; исходные координаты не округляются.
        Неоднозначные варианты сохранены отдельно; ни один не выбран по близости. Размеры в
        геометрию не переносятся.
      </p>
    </section>
  )
}

function ScaleEvidenceReview({
  report,
}: {
  report: NonNullable<NativeReviewPacket['scaleEvidence']>
}) {
  const messages = {
    consistent: 'согласован',
    insufficient: 'недостаточно независимых опор',
    conflict: 'конфликт',
  }
  const compactNumber = (value: number) => {
    const displayed = Number(value.toPrecision(6))
    return `${displayed === value ? '' : '≈'}${displayed}`
  }
  return (
    <section
      className="space-y-2 border-t border-line pt-3 text-[13px] leading-relaxed"
      aria-label="Проверка масштаба X/Y"
    >
      <h4 className="text-[14px] font-medium">Проверка масштаба X/Y</h4>
      <p className="text-ink-2">
        Проверяем согласованность напечатанных размеров с длинами линий PDF. Допуск{' '}
        {report.dimensionToleranceMm} мм относится только к размерным подписям чертежа, не к
        точности обмера квартиры. Отдельные коэффициенты X/Y не используются для преобразования
        геометрии.
      </p>
      {report.status === 'unresolved' ? (
        <p className="break-all text-ink-2">
          Проверка масштаба удержана: {report.refusalReason}. Частичные опоры не показаны.
        </p>
      ) : (
        <>
          <p>
            Общий масштаб: {messages[report.commonScale.status]}. Удержанные подписи:{' '}
            {report.unresolved.length}.
          </p>
          <details className="text-ink-2">
            <summary className="min-h-11 cursor-pointer py-3">
              Опоры X/Y и расхождения исходных размеров
            </summary>
            {report.axes.map((axis) => (
              <div key={axis.axis} className="space-y-1 py-2">
                <p>
                  Ось {axis.axis === 'width' ? 'X' : 'Y'}: {messages[axis.status]}; независимые
                  подписи: {axis.independentLabelIds.join(', ') || 'нет'}.
                </p>
                <ul className="list-disc space-y-1 pl-5">
                  {axis.observations.map((item) => (
                    <li key={item.labelId} className="break-all">
                      {item.labelId}: {item.valueMm} мм / {compactNumber(item.lengthPoints)} pt PDF;
                      отношение {compactNumber(item.mmPerPoint)} мм/pt; расхождение{' '}
                      {compactNumber(item.residualMm)} мм относительно опоры этой оси.
                    </li>
                  ))}
                </ul>
              </div>
            ))}
            {report.commonScale.mmPerPoint !== null ? (
              <p>
                Общая опора {report.commonScale.referenceLabelId}:{' '}
                {compactNumber(report.commonScale.mmPerPoint)} мм/pt.
              </p>
            ) : null}
            <ul className="list-disc space-y-1 pl-5">
              {report.unresolved.map((item) => (
                <li key={item.labelId} className="break-all">
                  {item.labelId}: {item.reason}.
                </li>
              ))}
            </ul>
          </details>
        </>
      )}
      <p className="text-ink-2">
        Это проверка исходного чертежа, не подтверждение физического размера или готовности переноса
        в 2D/3D. Знак ≈ сокращает только отображение; исходные числа не округляются.
      </p>
    </section>
  )
}

function NativeDimensionsReview({ packet }: { packet: NativeReviewPacket }) {
  const dimensions = packet.dimensionDiscovery
  const heights = packet.heightObservations
  if (!dimensions && !heights) return null
  return (
    <section
      className="space-y-2 border-t border-line pt-3 text-[13px] leading-relaxed"
      aria-label="Размеры и высоты перед переносом"
    >
      <h4 className="text-[14px] font-medium">Размеры и высоты перед переносом</h4>
      <p className="text-ink-2">
        Размерная роль ещё не доказывает метрический размер. Для масштаба нужны независимые
        размерные опоры по X и Y и исходные свидетельства целой стены или косяка. Значения не
        переносятся автоматически в комнаты или 3D.
      </p>
      {dimensions ? (
        dimensions.status === 'unresolved' ? (
          <p className="break-all text-ink-2">
            Поиск размерных подписей не завершён; частичный набор не показан. Ограничение:{' '}
            {dimensions.refusalReason}.
          </p>
        ) : (
          <p>
            Размерные кандидаты: {dimensions.candidates.length}; X:{' '}
            {dimensions.candidates.filter((item) => item.axis === 'width').length}, Y:{' '}
            {dimensions.candidates.filter((item) => item.axis === 'depth').length}. Удержанные
            подписи: {dimensions.unresolved.length}.
          </p>
        )
      ) : null}
      {heights ? (
        heights.status === 'unresolved' ? (
          <p className="break-all text-ink-2">
            Поиск подписей высот не завершён; частичный набор не показан. Ограничение:{' '}
            {heights.refusalReason}.
          </p>
        ) : (
          <>
            <p>
              Подписи высот: {heights.observations.length}; чистый потолок:{' '}
              {
                heights.observations.filter((item) => item.quantityKind === 'finished-ceiling')
                  .length
              }
              , проёмы:{' '}
              {heights.observations.filter((item) => item.quantityKind === 'opening-height').length}
              , балки:{' '}
              {heights.observations.filter((item) => item.quantityKind === 'beam-level').length},
              высоты порогов:{' '}
              {
                heights.observations.filter((item) => item.quantityKind === 'threshold-height')
                  .length
              }
              , уровни порогов:{' '}
              {
                heights.observations.filter((item) => item.quantityKind === 'threshold-level')
                  .length
              }
              , вид не определён:{' '}
              {
                heights.observations.filter((item) => item.quantityKind === 'unclassified-height')
                  .length
              }
              .
            </p>
            <p className="text-ink-2">
              h1/h2 остаются неизвестными обозначениями. Чистый потолок — не конструктивная высота
              стены или плиты; буквальный уровень отсчёта не определяет комнату. Разные подписи
              потолка не усредняются. Эти наблюдения нельзя принять как высоты 3D. Уровень порога
              может быть нулевым или отрицательным; высота порога не равна перепаду полов. Даже
              буквальная отметка не подтверждает владельца порога и проверенный уровень отсчёта; она
              не задаёт автоматически нижнюю отметку проёма в 2D/3D.
            </p>
            {heights.splitHints?.length ? (
              <details className="text-ink-2">
                <summary className="min-h-11 cursor-pointer py-3">
                  Возможные составные подписи порога: {heights.splitHints.length}
                </summary>
                <p>
                  Фрагменты стоят рядом на исходном листе, но видимость всех PDF-глифов и связь с
                  физическим порогом не доказаны. Число ниже — подсказка для сверки с оригиналом, не
                  подтверждённый обмер и не уровень пола; в 2D, 3D и PDF оно не переносится.
                </p>
                <ul className="mt-3 list-disc space-y-2 pl-5">
                  {heights.splitHints.map((hint) => (
                    <li key={hint.parts[0]?.labelId} className="break-all">
                      {hint.parts
                        .map((part) => `${part.labelId} «${part.originalText}»`)
                        .join(' + ')}
                      : возможно {hint.valueMm} мм, требует проверки по исходнику.
                    </li>
                  ))}
                </ul>
              </details>
            ) : null}
          </>
        )
      ) : null}
      {heights ? (
        <p className="text-ink-2">
          Пропуски исходного слоя: кривых {heights.omissionCounts.skippedCurves}, отсечённых путей{' '}
          {heights.omissionCounts.clippedPaths}. Подписи не доказывают полноту геометрии.
        </p>
      ) : null}
      {heights?.locations ? (
        heights.locations.status === 'unresolved' ? (
          <p className="break-all text-ink-2">
            Положение подписей высот не проверено: {heights.locations.refusalReason}.
          </p>
        ) : (
          <p className="text-ink-2">
            Положение исходных подписей: внутри одной полости —{' '}
            {
              heights.locations.observations.filter(
                (item) => item.status === 'inside-single-cavity',
              ).length
            }
            , удержано —{' '}
            {
              heights.locations.observations.filter(
                (item) => item.status !== 'inside-single-cavity',
              ).length
            }
            . Это положение всей подписи, не владелец высоты или уровня порога. Полость не назначает
            комнату; выноски и уровень отсчёта требуют отдельной проверки.
          </p>
        )
      ) : null}
      {heights?.locations?.status === 'draft' &&
      heights.locations.observations.some((item) => item.leader !== undefined) ? (
        <p className="text-ink-2">
          По исходной выноске: связано с одной полостью —{' '}
          {heights.locations.observations.filter((item) => item.leader?.status === 'linked').length}
          , удержано —{' '}
          {
            heights.locations.observations.filter(
              (item) => item.leader && item.leader.status !== 'linked',
            ).length
          }
          . Проверяется вся стрелка исходной цепочки «рамка — линия — стрелка», не только её
          вершина. Это не подтверждение владельца высоты или общего уровня отсчёта для 3D.
        </p>
      ) : null}
      {packet.heightObjects ? (
        packet.heightObjects.status === 'unresolved' ? (
          <p className="break-all text-ink-2">
            Связи высот с объектами удержаны: {packet.heightObjects.refusalReason}.
          </p>
        ) : (
          <details className="text-ink-2">
            <summary className="min-h-11 cursor-pointer py-3">
              Предложения объектов высот:{' '}
              {
                packet.heightObjects.bindings.filter((item) => item.objectStatus === 'proposed')
                  .length
              }
              ; документарный вид отсчёта:{' '}
              {
                packet.heightObjects.bindings.filter(
                  (item) => item.datumEvidence.status === 'documentary',
                ).length
              }
            </summary>
            <p>
              Вид отсчёта — не единый ноль пола. Предложения чистого потолка, уровни пола и порогов
              не приняты в геометрию 2D/3D; существующий и чистый пол не приравниваются.
            </p>
            <ul className="mt-3 space-y-2">
              {packet.heightObjects.unsupportedDeclarations.map((item) => (
                <li key={`height-unsupported:${item.labelId}`} className="break-all">
                  {item.labelId}: «{item.originalText}» — объявление отсчёта удержано: {item.reason}
                  . Уровень пола из этой подписи не переносится.
                </li>
              ))}
              {packet.heightObjects.declarations.map((item) => (
                <li key={`height-declaration:${item.labelId}`} className="break-all">
                  {item.labelId}: «{item.originalText}» — {item.minimumMm}–{item.maximumMm} мм,{' '}
                  {heightDatumMessages[item.datum]};{' '}
                  {item.status === 'verified'
                    ? 'исходная подпись проверена'
                    : `удержано — ${item.reason}`}
                  .
                </li>
              ))}
              {packet.heightObjects.bindings.map((item) => (
                <li key={`height-object:${item.labelId}`} className="break-all">
                  {item.labelId}:{' '}
                  {item.objectStatus === 'proposed'
                    ? 'предложение чистого потолка'
                    : `объект удержан — ${item.objectReason}`}
                  .
                  {item.targets.map((target) => (
                    <span key={`${target.cavityId}:${target.markerLabelId}`}>
                      {' '}
                      Полость {target.cavityId}, комната {target.sourceRoomNumber} «
                      {target.roomName}», метка {target.markerLabelId}.
                    </span>
                  ))}{' '}
                  Отсчёт:{' '}
                  {item.datumEvidence.status === 'documentary' && item.datumEvidence.kind
                    ? `${heightDatumMessages[item.datumEvidence.kind]}; исходные подписи: ${item.datumEvidence.sourceLabelIds.join(', ')}`
                    : `удержан — ${item.datumEvidence.reason}`}
                  .
                </li>
              ))}
            </ul>
          </details>
        )
      ) : null}
      {packet.heightCallouts ? (
        <details className="text-ink-2">
          <summary className="min-h-11 cursor-pointer py-3">
            Исходные выноски высот: {packet.heightCallouts.candidates.length}
          </summary>
          {packet.heightCallouts.status === 'unresolved' ? (
            <p>Проверка выносок удержана: {packet.heightCallouts.refusalReason}.</p>
          ) : (
            <>
              <p>
                Показаны штрихи и точки выносок из PDF. Подписи рядом с ними остаются подсказками:
                связь с конкретным проёмом и общий уровень отсчёта не установлены. Числа не
                переносятся в 2D/3D.
              </p>
              <ul className="mt-3 space-y-2">
                {packet.heightCallouts.candidates.map((candidate) => (
                  <li key={candidate.id} className="break-words">
                    {candidate.id}: линия {candidate.stem.source.operationIndex}/
                    {candidate.stem.source.subpathIndex}/{candidate.stem.source.segmentIndex} +{' '}
                    {candidate.horizontal.source.operationIndex}/
                    {candidate.horizontal.source.subpathIndex}/
                    {candidate.horizontal.source.segmentIndex}; точка{' '}
                    {candidate.dot.source.operationIndex}/{candidate.dot.source.subpathIndex},
                    обводка {candidate.outline.operationIndex}/{candidate.outline.subpathIndex}.
                    Проверенных буквальных подписей поблизости: {candidate.heightCaptions.length}.
                    принадлежность строк выноске не установлена.
                  </li>
                ))}
              </ul>
            </>
          )}
        </details>
      ) : null}
      {dimensions?.status === 'draft' || heights?.status === 'draft' ? (
        <details className="text-ink-2">
          <summary className="min-h-11 cursor-pointer py-3">
            Исходные подписи, миллиметры и ограничения
          </summary>
          <ul className="list-disc space-y-2 pl-5">
            {dimensions?.status === 'draft'
              ? dimensions.candidates.map((item) => (
                  <li key={`dimension:${item.labelId}`} className="break-all">
                    {item.labelId}: {item.valueMm} мм, ось {item.axis === 'width' ? 'X' : 'Y'}.
                    Размерная роль не подтверждает цель измерения.
                  </li>
                ))
              : null}
            {dimensions?.status === 'draft'
              ? dimensions.unresolved.map((item) => (
                  <li key={`held:${item.labelId}`} className="break-all">
                    {item.labelId}: подпись удержана — {item.reason}.
                  </li>
                ))
              : null}
            {heights?.status === 'draft'
              ? heights.observations.map((item) => (
                  <li key={`height:${item.labelId}`} className="break-all">
                    {item.labelId}: «{item.originalText}» — {item.valueMm} мм;{' '}
                    {heightQuantityMessages[item.quantityKind]}, {heightDatumMessages[item.datum]}.
                    Не принято для 3D.
                    {item.unitEvidence ? (
                      <span>
                        {' '}
                        Единицы взяты из примечания этого же листа: {item.unitEvidence.labelId} «
                        {item.unitEvidence.originalText}».
                        {item.unitEvidence.inkSourceOperation === null
                          ? ' Точное соответствие примечания отображённым PDF-глифам не подтверждено.'
                          : ' Исходные глифы примечания проверены.'}{' '}
                        Это не подтверждает вид высоты, её владельца или общий ноль пола.
                      </span>
                    ) : null}
                    {item.issueCodes.length ? ` Ограничения: ${item.issueCodes.join(', ')}.` : null}
                  </li>
                ))
              : null}
            {heights?.status === 'draft'
              ? heights.issues.map((item) => (
                  <li key={`height-issue:${item.labelId}:${item.code}`} className="break-all">
                    {item.labelId}: «{item.originalText}» — {item.code}.
                  </li>
                ))
              : null}
            {heights?.locations?.status === 'draft'
              ? heights.locations.observations.map((item) => (
                  <li key={`height-location:${item.labelId}`} className="break-all">
                    {item.labelId}:{' '}
                    {item.status === 'inside-single-cavity'
                      ? `вся подпись внутри полости ${item.cavityIds[0]}`
                      : `положение удержано — ${item.reason}`}
                    .
                    {item.status !== 'inside-single-cavity' && item.cavityIds.length
                      ? ` Исходные альтернативы: ${item.cavityIds.join(', ')}.`
                      : null}{' '}
                    Это не подтверждение владельца высоты для 3D.
                    {item.leader ? (
                      <div className="mt-1">
                        По исходной выноске:{' '}
                        {item.leader.status === 'linked'
                          ? `вся стрелка внутри полости ${item.leader.cavityIds[0]}`
                          : `связь удержана — ${item.leader.reason}`}
                        .
                        {item.leader.status !== 'linked' && item.leader.cavityIds.length
                          ? ` Исходные альтернативы: ${item.leader.cavityIds.join(', ')}.`
                          : null}
                        {item.leader.source ? (
                          <span>
                            {' '}
                            Рамка:{' '}
                            {item.leader.source.boxRefs
                              .map((ref) => `${ref.operationIndex}:${ref.subpathIndex}`)
                              .join(', ')}
                            ; линия (исходный порядок):{' '}
                            {item.leader.source.stemRefs
                              .map(
                                (ref) =>
                                  `${ref.operationIndex}:${ref.subpathIndex}:${ref.segmentIndex}`,
                              )
                              .join(', ')}
                            ; стрелка: {item.leader.source.arrowRef.operationIndex}:
                            {item.leader.source.arrowRef.subpathIndex}.
                          </span>
                        ) : null}
                      </div>
                    ) : null}
                  </li>
                ))
              : null}
          </ul>
        </details>
      ) : null}
    </section>
  )
}

const floorOpeningStatusMessages = {
  'two-sided': 'Две разные соседние области',
  'one-sided': 'Одна наблюдаемая соседняя область',
  'same-cavity': 'Одна и та же область у обеих сторон — не новая связь',
  ambiguous: 'Соседние контакты неоднозначны',
  unresolved: 'Соседние контакты не доказаны',
}
const floorOpeningSideMessages = {
  matched: 'Полный контакт с математической областью',
  partial: 'Частичный контакт',
  ambiguous: 'Несколько конкурирующих контактов',
  unobserved: 'Область не наблюдалась; сторона неизвестна',
  unresolved: 'Исходное основание контакта не доказано',
}
const floorOpeningReasonMessages: Record<string, string> = {
  'logical-strip-unavailable': 'Логическая полоса по рамке не сопоставлена.',
  'competing-strip-paint': 'У полосы несколько заливок; соответствие не выбрано.',
  'strip-overlaps-cavity': 'Логическая полоса пересекает математическую область.',
  'unproved-neighbor-region': 'Соседняя область удержана как неподтверждённая.',
  'competing-cavity-contacts': 'На одной стороне есть несколько кандидатов.',
  'unobserved-opposite-cavity': 'На противоположной стороне область не наблюдалась.',
  'incomplete-cavity-contacts': 'Часть соседних контактов не доказана.',
}

function FloorOpeningSides({ packet }: { packet: NativeReviewPacket }) {
  const report = packet.floorOpeningSides
  if (!report) return null
  const cells = new Map(packet.floorCavities?.candidates.map((cell) => [cell.id, cell]))
  const numbers = new Map(
    packet.numberCircles?.cues.map(({ labelId, sourceNumber }) => [labelId, sourceNumber]),
  )
  const cellDescription = (id: string) => {
    const cell = cells.get(id)
    if (!cell) return 'Математическая область недоступна для сверки'
    const cues = [
      ...new Set(
        cell.markerLabelIds
          .map((labelId) => numbers.get(labelId))
          .filter((number) => number !== undefined),
      ),
    ]
    if (!cues.length)
      return cell.markerStatus === 'unavailable'
        ? 'Математическая область без доступной сверки меток; назначение неизвестно'
        : 'Неразмеченная математическая область; назначение неизвестно'
    const hasLeader = packet.floorCavities?.markerLeaders?.some(
      (leader) => leader.cavityId === id && cell.markerLabelIds.includes(leader.labelId),
    )
    return `Метки ${cues.join(' + ')}${hasLeader ? ' (есть исходная выноска)' : ''}`
  }
  return (
    <section
      className="space-y-2 border-t border-line pt-3 text-[13px] leading-relaxed"
      aria-label="Соседние области у рамок"
    >
      <h4 className="text-[14px] font-medium">Соседние области у рамок</h4>
      {report.status === 'unresolved' ? (
        <p className="break-all text-ink-2">
          Сверка сторон не завершена; частичный набор не показан. Ограничение:{' '}
          {report.refusalReason}.
        </p>
      ) : (
        <>
          <p className="text-ink-2">
            Это логические соседства исходных математических областей. Сохранённая ручная разметка
            не меняется; физический порог, ширина, высоты, свободный проход и готовность 2D/3D не
            подтверждены. Дверные символы — отдельные наблюдения, не определение вида всех рамок.
          </p>
          <dl className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            <div>
              <dt className="text-ink-2">Рамки между двумя разными областями</dt>
              <dd>{report.frames.filter((frame) => frame.status === 'two-sided').length}</dd>
            </div>
            <div>
              <dt className="text-ink-2">Рамки с одной наблюдаемой областью</dt>
              <dd>{report.frames.filter((frame) => frame.status === 'one-sided').length}</dd>
            </div>
          </dl>
          <p className="text-ink-2">
            Ненаблюдаемая сторона неизвестна; она не считается внешней стороной квартиры или входом.
          </p>
          {report.frames.some((frame) => !['two-sided', 'one-sided'].includes(frame.status)) ? (
            <p className="text-ink-2">
              Невыбранные соседства:{' '}
              {
                report.frames.filter((frame) => !['two-sided', 'one-sided'].includes(frame.status))
                  .length
              }
              . Причины сохранены в деталях; неизвестная область не назначается ближайшей комнате.
            </p>
          ) : null}
          {report.frames.length ? (
            <details className="text-ink-2">
              <summary className="min-h-11 cursor-pointer py-3">
                Стороны рамок и ограничения соседств
              </summary>
              <ul className="list-disc space-y-3 pl-5">
                {report.frames.map((frame) => (
                  <li key={frame.frameId}>
                    <p>
                      <span className="break-all">{frame.frameId}</span>:{' '}
                      {floorOpeningStatusMessages[frame.status]}.
                    </p>
                    {frame.reason ? (
                      <p>
                        {floorOpeningReasonMessages[frame.reason] ??
                          'Нужна отдельная сверка исходного контакта.'}{' '}
                        <span className="break-all">{frame.reason}</span>.
                      </p>
                    ) : null}
                    {frame.sides.map((side) => (
                      <div key={side.frameEdgeIndex} className="mt-1">
                        <p>
                          Грань рамки {side.frameEdgeIndex + 1}:{' '}
                          {floorOpeningSideMessages[side.status]}.
                        </p>
                        {side.contacts.map((contact) => (
                          <p key={contact.cavityId} className="break-all">
                            {cellDescription(contact.cavityId)} — {contact.cavityId};{' '}
                            {contact.coverage === 'complete'
                              ? 'полный наблюдаемый контакт'
                              : contact.coverage === 'partial'
                                ? 'не весь участок сопоставлен'
                                : 'линейная связь не доказана'}
                            . Индексы границ: {contact.boundaryEdgeIndices.join(', ')}.
                          </p>
                        ))}
                      </div>
                    ))}
                    {frame.doorSymbolIds.length ? (
                      <p className="mt-1 break-all">
                        Совместно наблюдаемые дверные символы: {frame.doorSymbolIds.join(', ')}. Это
                        отдельное совпадение символов, не доказательство физической двери или
                        прохода.
                      </p>
                    ) : null}
                    {frame.omittedInkCount ? (
                      <p className="mt-1">
                        Ограничения извлечения у рамки: {frame.omittedInkCount}.
                      </p>
                    ) : null}
                  </li>
                ))}
              </ul>
            </details>
          ) : (
            <p className="text-ink-2">
              Нет исходных рамок для сверки сторон; полнота проёмов этим не доказана.
            </p>
          )}
        </>
      )}
    </section>
  )
}

function SavedFrameRooms({
  review,
}: {
  review: NonNullable<NativeReviewPacket['savedFrameRooms']>
}) {
  return (
    <section
      className="border-t border-line pt-3 text-[13px] leading-relaxed"
      aria-label="Сверка рамок с сохранённой разметкой"
    >
      <h4 className="text-[14px] font-medium">Сверка рамок с сохранённой разметкой</h4>
      {review.status === 'not-saved' ? (
        <p className="mt-2 text-ink-2">
          Ручная разметка этого листа не сохранена; принадлежность рамок помещениям не проверена.
        </p>
      ) : review.status === 'unavailable' || review.status === 'refused' ? (
        <div className="mt-2 text-ink-2">
          <p>
            {review.status === 'refused'
              ? 'Сопоставление не прошло перепроверку по исходнику; частичные соответствия не показаны.'
              : 'Сопоставление недоступно; найденные рамки сами по себе не определяют помещения.'}
          </p>
          <details>
            <summary className="min-h-11 cursor-pointer py-3">Ограничение сверки рамок</summary>
            <p className="break-all">{review.reason}</p>
          </details>
        </div>
      ) : review.status === 'checked' ? (
        <div className="mt-2 space-y-3">
          <p className="text-ink-2">
            Номера помещений и виды проёмов взяты из уже сохранённой ручной разметки, не определены
            автоматически. Совпадение исходных линий не подтверждает физический проход,
            принадлежность проёма комнате или границу свободного пола. Сохранённая 2D/3D не
            меняется.
          </p>
          <dl className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            {Object.entries(frameRoomStatusMessages).map(([status, message]) => (
              <div key={status}>
                <dt className="text-ink-2">{message}</dt>
                <dd>{review.frames.filter((frame) => frame.status === status).length}</dd>
              </div>
            ))}
          </dl>
          <details>
            <summary className="min-h-11 cursor-pointer py-3">
              Соответствия рамок и ручных зон
            </summary>
            {review.frames.length ? (
              <ol className="list-decimal space-y-3 pl-5">
                {review.frames.map((frame) => (
                  <li key={frame.frameId}>
                    <p>{frameRoomStatusMessages[frame.status]}.</p>
                    <p className="break-all text-ink-2">Исходная рамка: {frame.frameId}.</p>
                    {frame.sides.length ? (
                      <ul className="mt-1 list-disc space-y-2 pl-4">
                        {frame.sides.map((side) => (
                          <li
                            key={`${side.roomSourceNumbers.join('+')}:${side.frameEdgeIndex}:${side.openingId}`}
                          >
                            <p>
                              Номера из ручной разметки: {side.roomSourceNumbers.join(' + ')}
                              {side.roomSourceNumbers.length > 1 ? ' — одна сохранённая зона' : ''}.
                              Объявлено:{' '}
                              {side.kind === 'door'
                                ? 'дверь / проход'
                                : side.kind === 'window'
                                  ? 'окно'
                                  : 'балконный блок'}
                              ; грань рамки {side.frameEdgeIndex + 1}.
                            </p>
                            <p className="text-ink-2">{frameNumberCueMessages[side.numberCue]}</p>
                            <p className="break-all text-ink-2">
                              Проём в разметке: {side.openingId}.
                            </p>
                          </li>
                        ))}
                      </ul>
                    ) : (
                      <p className="text-ink-2">Соответствий сохранённым сторонам не найдено.</p>
                    )}
                  </li>
                ))}
              </ol>
            ) : (
              <p className="text-ink-2">Нет исходных рамок для сопоставления.</p>
            )}
          </details>
        </div>
      ) : null}
    </section>
  )
}

function PaintedRegionContext({
  report,
}: {
  report: NonNullable<NativeReviewPacket['paintedRegionContext']>
}) {
  return (
    <section
      className="space-y-2 border-t border-line pt-3 text-[13px] leading-relaxed"
      aria-label="Границы залитых областей исходника"
    >
      <h4 className="text-[14px] font-medium">Границы залитых областей исходника</h4>
      <p className="text-ink-2">
        Помещения могут быть нарисованы отдельными заливками, а не полостями между стенами. Эти
        исходные контуры доступны через «Показать также области из заливок» ниже. Белая заливка сама
        по себе не означает свободный пол: она может закрывать колонну, окно или другую часть
        рисунка. Порядок рисования и пропуски требуют сверки; контуры не приняты для 2D/3D.
      </p>
      {report.status === 'unresolved' ? (
        <p className="break-all text-ink-2">
          Контекст заливок не проверен: {report.refusalReason}.
        </p>
      ) : (
        <details className="text-ink-2">
          <summary className="min-h-11 cursor-pointer py-3">
            Исходные операции и возможные перекрытия ({report.regions.length})
          </summary>
          <ul className="space-y-2">
            {report.regions.map((region) => (
              <li key={region.candidateId} className="break-words">
                {region.candidateId}: более ранние заливки — {region.earlierPaintCount}, более
                поздние — {region.laterPaintCount}, неоднозначные пересечения —{' '}
                {region.unresolvedPaintCount}, возможные пропуски в пределах области —{' '}
                {region.possibleOmissionCount}.
              </li>
            ))}
          </ul>
          <p className="mt-2">
            Пересечение габаритов пропуска — только предупреждение, не доказательство его формы.
          </p>
        </details>
      )}
    </section>
  )
}

function OrderedPaintReview({
  report,
  showLayer,
  onToggle,
}: {
  report: NonNullable<NativeReviewPacket['orderedPaint']>
  showLayer: boolean
  onToggle: (value: boolean) => void
}) {
  return (
    <section
      className="space-y-2 border-t border-line pt-3 text-[13px] leading-relaxed"
      aria-label="Фрагменты заливок после перекрытий"
    >
      <h4 className="text-[14px] font-medium">Фрагменты заливок после перекрытий</h4>
      <p className="text-ink-2">
        Где расчёт однозначен, из исходной заливки вычтены более поздние заливки, включая маленькие
        и того же цвета. Это части конкретной операции PDF, не готовый свободный пол. Пропущенные
        штрихи остаются неизвестными; цвет, вырез или рамка не назначают комнату, колонну, проём или
        высоту. Данные не переносятся в 2D/3D.
      </p>
      {report.status === 'unresolved' ? (
        <p className="break-all text-ink-2">
          Расчёт удержан: {report.refusalReason}. Частичный слой не показан.
        </p>
      ) : (
        <>
          <details className="text-ink-2">
            <summary className="min-h-11 cursor-pointer py-3">
              Состав фрагментов и удержанные ограничения
            </summary>
            <ul className="space-y-2">
              {report.regions.map((region) => (
                <li key={region.candidateId} className="break-words">
                  {region.candidateId}:{' '}
                  {region.status === 'held'
                    ? `удержано (${region.refusalReason})`
                    : `фрагментов — ${region.pieces.length}, вырезов — ${region.pieces.reduce((sum, piece) => sum + piece.holes.length, 0)}`}
                  . Поздних заливок — {region.maskCount}; возможных пропущенных штрихов у границ —{' '}
                  {region.omittedStrokeCount}.
                  {!region.boundaryInkComplete ? ' Полнота линий границы не подтверждена.' : ''}
                </li>
              ))}
            </ul>
            <p className="mt-2">
              Проверяются внешние границы фрагментов и края вырезов. Внутренний штрих исключается
              только по полной оболочке краски; без данных о толщине пера он остаётся возможным
              препятствием. Это не подтверждение физической стены или окончательной видимости.
            </p>
          </details>
          {report.regions.some((region) => region.pieces.length > 0) ? (
            <label className="flex min-h-11 items-center gap-2">
              <input
                type="checkbox"
                checked={showLayer}
                onChange={(event) => onToggle(event.target.checked)}
              />
              Показать вычисленные фрагменты — фиолетовый слой, не принятый пол
            </label>
          ) : null}
        </>
      )}
    </section>
  )
}

function orderedPaintPath(
  piece: NonNullable<NativeReviewPacket['orderedPaint']>['regions'][number]['pieces'][number],
): string {
  return [piece.polygon, ...piece.holes]
    .map((ring) => `M ${ring.map((point) => `${point.x} ${point.y}`).join(' L ')} Z`)
    .join(' ')
}

export function NativeReviewResult({
  packet,
  imageUrl,
  proposedFloors,
  expectedRevision,
}: {
  packet: NativeReviewPacket
  imageUrl: string
  proposedFloors?: ReviewedNativePaintedFloors | null
  expectedRevision?: string
}) {
  const [showFills, setShowFills] = useState(false)
  const [showOpeningCandidates, setShowOpeningCandidates] = useState(true)
  const [showGlazingCandidates, setShowGlazingCandidates] = useState(true)
  const [showFilledPanels, setShowFilledPanels] = useState(false)
  const [showCompositeRectangles, setShowCompositeRectangles] = useState(true)
  const [showOneSidedWalls, setShowOneSidedWalls] = useState(true)
  const [showSavedFloors, setShowSavedFloors] = useState(false)
  const [showFloorCavities, setShowFloorCavities] = useState(false)
  const [showSplitHeightHints, setShowSplitHeightHints] = useState(true)
  const [showHeightCallouts, setShowHeightCallouts] = useState(true)
  const [showOrderedPaint, setShowOrderedPaint] = useState(false)
  const [fullSize, setFullSize] = useState(false)
  const visible = packet.faces.filter(
    (face) => face.layer === 'stroke' || (showFills && !showOrderedPaint),
  )
  const hasOpeningCandidates =
    (packet.doorSymbols?.candidates.length ?? 0) + (packet.openingFrames?.candidates.length ?? 0) >
    0
  const proposalMatchesSource =
    proposedFloors?.source.sha256 === packet.source.sha256 &&
    proposedFloors.source.pdfPage === packet.source.pdfPage &&
    proposedFloors.source.state === packet.source.state &&
    proposedFloors.rasterSource.sha256 === packet.image.sha256 &&
    proposedFloors.rasterSource.page === packet.image.page &&
    proposedFloors.rasterSource.width === packet.image.width &&
    proposedFloors.rasterSource.height === packet.image.height &&
    Boolean(expectedRevision) &&
    packet.sourceRevision === expectedRevision
  const proposedPieces =
    proposalMatchesSource && packet.orderedPaint?.status === 'diagnostic'
      ? proposedFloors.floors.map((floor) => {
          const region = packet.orderedPaint?.regions.find(
            (candidate) => candidate.candidateId === floor.candidateId,
          )
          return region?.status === 'diagnostic'
            ? { floor, piece: region.pieces[floor.pieceIndex] }
            : { floor, piece: undefined }
        })
      : null
  const canShowProposal = Boolean(
    proposedPieces?.length && proposedPieces.every((selection) => selection.piece),
  )
  return (
    <div className="mt-4 min-w-0 max-w-full space-y-4">
      <p className="border-l-2 border-accent pl-3 text-[14px] leading-relaxed text-ink-2">
        Это проверка исходного листа, не готовая схема квартиры. Сохранённые комнаты, мерки и 2D/3D
        не меняются.
      </p>
      {proposedFloors ? (
        <p role="status" className="text-[13px] leading-relaxed text-ink-2">
          {canShowProposal
            ? `Пунктиром показаны ${proposedPieces?.length} предложенных фрагментов поверх исходного листа. Это несохранённый черновик, не физические границы пола и не готовая 2D/3D.`
            : 'Предпросмотр предложенных фрагментов недоступен: источник, версия или диагностический слой не совпали. Ничего не наложено и не сохранено.'}
        </p>
      ) : null}
      <dl className="grid grid-cols-2 gap-x-5 gap-y-2 text-[13px] sm:grid-cols-4">
        <div>
          <dt className="text-ink-2">Области из заливок</dt>
          <dd>{packet.counts.fillCandidates}</dd>
        </div>
        <div>
          <dt className="text-ink-2">Замкнутые линии</dt>
          <dd>{packet.counts.strokeFaces}</dd>
        </div>
        <div>
          <dt className="text-ink-2">Контуры с номерами</dt>
          <dd>{packet.counts.numberedAssociations}</dd>
        </div>
        <div>
          <dt className="text-ink-2">Размерные подписи</dt>
          <dd>{packet.counts.printedDimensions}</dd>
        </div>
      </dl>
      {packet.numberCircles ? (
        <div className="space-y-2 text-[13px] leading-relaxed text-ink-2">
          <p>
            Цифровые метки в окружностях:{' '}
            {packet.numberCircles.status === 'unresolved'
              ? 'поиск не завершён'
              : packet.numberCircles.cues.length}
            . Это нативные подписи PDF, не OCR и не число распознанных комнат.{' '}
            {packet.roomSchedule?.status === 'draft'
              ? 'Сверка с экспликацией показана ниже; принадлежность меток помещениям не подтверждена.'
              : 'Назначение меток и их связь с экспликацией не подтверждены.'}
          </p>
          {packet.numberCircles.status === 'unresolved' ? (
            <p className="break-all">
              Частичный набор меток не показан. Ограничение: {packet.numberCircles.refusalReason}.
            </p>
          ) : null}
        </div>
      ) : null}
      {packet.roomSchedule ? <RoomSchedule report={packet.roomSchedule} /> : null}
      {packet.paintedRegionContext ? (
        <PaintedRegionContext report={packet.paintedRegionContext} />
      ) : null}
      {packet.orderedPaint ? (
        <OrderedPaintReview
          report={packet.orderedPaint}
          showLayer={showOrderedPaint}
          onToggle={setShowOrderedPaint}
        />
      ) : null}
      {packet.floorCavities ? (
        <FloorCavityReview
          report={packet.floorCavities}
          circles={packet.numberCircles}
          showLayer={showFloorCavities}
          onToggle={setShowFloorCavities}
        />
      ) : null}
      {packet.floorOpeningSides ? <FloorOpeningSides packet={packet} /> : null}
      {packet.dimensionDiscovery || packet.heightObservations ? (
        <NativeDimensionsReview packet={packet} />
      ) : null}
      {packet.sourceCaptionBindings ? (
        <SourceCaptionReview report={packet.sourceCaptionBindings} />
      ) : null}
      {packet.dimensionTargets ? <DimensionTargetsReview report={packet.dimensionTargets} /> : null}
      {packet.dimensionStrokeContacts ? (
        <DimensionStrokeContactsReview report={packet.dimensionStrokeContacts} />
      ) : null}
      {packet.selectedDimensionBoundaries ? (
        <SelectedDimensionBoundariesReview report={packet.selectedDimensionBoundaries} />
      ) : null}
      {packet.scaleEvidence ? <ScaleEvidenceReview report={packet.scaleEvidence} /> : null}
      {packet.doorSymbols || packet.openingFrames ? (
        <div className="space-y-2 text-[13px] leading-relaxed">
          {packet.doorSymbols ? (
            <p>
              Кандидаты дверных символов:{' '}
              {packet.doorSymbols.status === 'unresolved'
                ? 'поиск не завершён'
                : packet.doorSymbols.candidates.length}
              . Это не число физических проёмов.
            </p>
          ) : null}
          {packet.openingFrames ? (
            <p>
              Кандидаты рамок проёмов:{' '}
              {packet.openingFrames.status === 'unresolved'
                ? 'поиск не завершён'
                : packet.openingFrames.candidates.length}
              . Вид проёма не определён.
            </p>
          ) : null}
          <p className="text-ink-2">
            Дуги и створки — сходство формы рисунка; рамки — контуры с примыкающими линиями. Точный
            проём, граница пола и свободный проход этим не подтверждаются.
          </p>
          {packet.doorSymbols?.status === 'unresolved' ||
          packet.openingFrames?.status === 'unresolved' ? (
            <p className="text-ink-2">
              Неполный набор соответствующего поиска не показан; нужна отдельная сверка исходника.
            </p>
          ) : null}
          {hasOpeningCandidates ? (
            <label className="flex min-h-11 items-center gap-2">
              <input
                type="checkbox"
                checked={showOpeningCandidates}
                onChange={(event) => setShowOpeningCandidates(event.target.checked)}
              />
              Показать исходные дуги, створки и рамки — оранжевые линии
            </label>
          ) : null}
        </div>
      ) : null}
      {packet.compositeSourceRectangles ? (
        <div className="space-y-2 text-[13px] leading-relaxed">
          <p>
            Прямоугольники из отдельных исходных штрихов:{' '}
            {packet.compositeSourceRectangles.status === 'draft'
              ? packet.compositeSourceRectangles.candidates.length
              : 'поиск не завершён'}
            . Назначение не определено: сверьте фиолетовые контуры с исходником.
          </p>
          <p className="text-ink-2">
            Четыре соединённых штриха сохраняются со ссылками на источник. Они сами по себе не
            подтверждают проём, косяки или границу пола и не переносятся в 2D/3D. Контакт с границей
            заливки показывает совпадение исходных линий; принадлежность стене проверяется отдельно.
            Заливка внутри рамки также не доказывает проход.
          </p>
          {packet.compositeSourceRectangles.candidates.length > 0 ? (
            <label className="flex min-h-11 items-center gap-2">
              <input
                type="checkbox"
                checked={showCompositeRectangles}
                onChange={(event) => setShowCompositeRectangles(event.target.checked)}
              />
              Показать составные исходные прямоугольники
            </label>
          ) : null}
        </div>
      ) : null}
      {packet.oneSidedWallSupports ? (
        <div className="space-y-2 text-[13px] leading-relaxed">
          <p>
            Участки возможной грани стены:{' '}
            {packet.oneSidedWallSupports.status === 'draft'
              ? packet.oneSidedWallSupports.candidates.length
              : 'проверка не завершена'}
            .
          </p>
          <p className="text-ink-2">
            Заливка и отдельный штрих совпадают только на показанном участке. Для стены и переноса в
            2D/3D нужна проверка второй грани, проёмов и полного контура.
          </p>
          {packet.oneSidedWallSupports.candidates.length > 0 ? (
            <label className="flex min-h-11 items-center gap-2">
              <input
                type="checkbox"
                checked={showOneSidedWalls}
                onChange={(event) => setShowOneSidedWalls(event.target.checked)}
              />
              Показать возможные участки стены
            </label>
          ) : null}
        </div>
      ) : null}
      {packet.glazingSymbols ? (
        <div className="space-y-2 text-[13px] leading-relaxed">
          <p>
            Кандидаты профилей остекления:{' '}
            {packet.glazingSymbols.status === 'unresolved'
              ? 'поиск не завершён'
              : packet.glazingSymbols.candidates.length}
            . Это не число окон.
          </p>
          <p className="text-ink-2">
            Профиль найден по корпусу, двум торцам и отдельной средней линии в исходнике. Такой
            рисунок может относиться к окну или остеклённой балконной двери; вид проёма, граница
            пола и проход не подтверждены.
          </p>
          {packet.glazingSymbols.status === 'unresolved' ? (
            <p className="text-ink-2">
              Неполный набор профилей не показан; нужна отдельная сверка исходника.
            </p>
          ) : packet.glazingSymbols.candidates.length ? (
            <label className="flex min-h-11 items-center gap-2">
              <input
                type="checkbox"
                checked={showGlazingCandidates}
                onChange={(event) => setShowGlazingCandidates(event.target.checked)}
              />
              Показать исходные профили остекления — синие линии
            </label>
          ) : null}
        </div>
      ) : null}
      {packet.filledPanelSymbols ? (
        <FilledPanelSymbols
          report={packet.filledPanelSymbols}
          visible={showFilledPanels}
          onVisibilityChange={setShowFilledPanels}
        />
      ) : null}
      {packet.sourceLinks ? <SourceSymbolLinks links={packet.sourceLinks} /> : null}
      <NativeSourceObjectSummary
        packet={packet}
        showFloors={showSavedFloors}
        onShowFloors={setShowSavedFloors}
      />
      <label className="flex min-h-11 items-center gap-2 text-[13px]">
        <input
          type="checkbox"
          checked={showFills}
          onChange={(event) => setShowFills(event.target.checked)}
        />
        Показать также области из заливок — их назначение не подтверждено
      </label>
      {packet.heightObservations?.status === 'draft' &&
      packet.heightObservations.splitHints?.length ? (
        <label className="flex min-h-11 items-center gap-2 text-[13px]">
          <input
            type="checkbox"
            checked={showSplitHeightHints}
            onChange={(event) => setShowSplitHeightHints(event.target.checked)}
          />
          Показать три фрагмента возможной подписи порога на исходнике — не обмер
        </label>
      ) : null}
      {packet.heightCallouts?.status === 'draft' && packet.heightCallouts.candidates.length ? (
        <label className="flex min-h-11 items-center gap-2 text-[13px]">
          <input
            type="checkbox"
            checked={showHeightCallouts}
            onChange={(event) => setShowHeightCallouts(event.target.checked)}
          />
          Показать исходные линии выносок высот — без назначения проёма
        </label>
      ) : null}
      <Button
        type="button"
        variant="secondary"
        size="sm"
        onClick={() => setFullSize((value) => !value)}
      >
        {fullSize ? 'Уместить лист по ширине' : 'Показать лист в полном масштабе'}
      </Button>
      {fullSize ? (
        <p className="text-[13px] text-ink-2">
          Прокручивайте лист внутри области просмотра. Масштаб изображения не меняет мерки.
        </p>
      ) : null}
      <section
        className="min-w-0 w-full max-w-full overflow-auto border border-line bg-white"
        style={fullSize ? { maxHeight: '70vh' } : undefined}
        tabIndex={fullSize ? 0 : undefined}
        aria-label="Область просмотра исходного листа"
      >
        <svg
          className="block w-full"
          style={{
            aspectRatio: `${packet.image.width}/${packet.image.height}`,
            ...(fullSize
              ? {
                  width: packet.image.width,
                  minWidth: packet.image.width,
                  height: packet.image.height,
                }
              : {}),
          }}
          viewBox={`0 0 ${packet.image.width} ${packet.image.height}`}
          role="img"
          aria-label="Исходный лист с неподтверждёнными областями и символами"
        >
          <image href={imageUrl} width={packet.image.width} height={packet.image.height} />
          {visible.map((face) => (
            <polygon
              key={`${face.layer}:${face.id}`}
              points={face.polygon.map((point) => `${point.x},${point.y}`).join(' ')}
              fill={face.annotationHint ? '#cc0044' : '#008888'}
              fillOpacity="0.08"
              stroke={face.annotationHint ? '#cc0044' : '#008888'}
              strokeWidth="1.5"
              vectorEffect="non-scaling-stroke"
            >
              <title>
                {face.roomName
                  ? `Подпись: ${face.roomName}. Граница пола не подтверждена.`
                  : face.annotationHint
                    ? 'Предполагаемый элемент оформления листа'
                    : 'Назначение области неизвестно'}
              </title>
            </polygon>
          ))}
          {showOrderedPaint && packet.orderedPaint?.status === 'diagnostic'
            ? packet.orderedPaint.regions.flatMap((region) =>
                region.pieces.map((piece) => (
                  <path
                    key={`${region.candidateId}:${orderedPaintPath(piece)}`}
                    d={orderedPaintPath(piece)}
                    fill="#7c3aed"
                    fillOpacity="0.12"
                    fillRule="evenodd"
                    stroke="#7c3aed"
                    strokeWidth="2"
                    vectorEffect="non-scaling-stroke"
                  >
                    <title>{`${region.candidateId}: вычисленный фрагмент исходной заливки. Видимый свободный пол и готовность 2D/3D не подтверждены.`}</title>
                  </path>
                )),
              )
            : null}
          {showOpeningCandidates && packet.doorSymbols?.status === 'draft'
            ? packet.doorSymbols.candidates.map((symbol) => {
                const parts =
                  symbol.leafProfile === 'capped-panel' ? (symbol.leafParts ?? []) : [symbol.leaf]
                const profileDescription =
                  symbol.leafProfile === 'capped-panel'
                    ? 'Профиль створки с двумя торцами: три исходных отрезка.'
                    : 'Один исходный отрезок створки.'
                const angleDescription =
                  symbol.swingAngleDegrees === undefined
                    ? ''
                    : ` Поворот рисунка: ${symbol.swingAngleDegrees.toFixed(2)}°.`
                return (
                  <g key={symbol.id} fill="none" stroke="#b45309" strokeWidth="2">
                    <path
                      d={[
                        `M ${symbol.arc.start.x} ${symbol.arc.start.y}`,
                        ...symbol.arc.segments.map(
                          (segment) =>
                            `C ${segment.control1.x} ${segment.control1.y} ${segment.control2.x} ${segment.control2.y} ${segment.end.x} ${segment.end.y}`,
                        ),
                      ].join(' ')}
                      vectorEffect="non-scaling-stroke"
                    >
                      <title>
                        {`Исходная дуга дверного символа. Сходство рисунка, не точный проём и не граница пола. ${profileDescription}${angleDescription}`}
                      </title>
                    </path>
                    {parts.map((part) => (
                      <line
                        key={`${part.start.x}:${part.start.y}:${part.end.x}:${part.end.y}`}
                        x1={part.start.x}
                        y1={part.start.y}
                        x2={part.end.x}
                        y2={part.end.y}
                        vectorEffect="non-scaling-stroke"
                      >
                        <title>
                          {`Исходная линия створки. ${profileDescription}${angleDescription} Физический проход не подтверждён; граница пола не замыкается.`}
                        </title>
                      </line>
                    ))}
                  </g>
                )
              })
            : null}
          {showOpeningCandidates && packet.openingFrames?.status === 'draft'
            ? packet.openingFrames.candidates.map((frame) => (
                <polygon
                  key={frame.id}
                  points={frame.polygon.map((point) => `${point.x},${point.y}`).join(' ')}
                  fill="none"
                  stroke="#b45309"
                  strokeWidth="2"
                  strokeDasharray="4 3"
                  vectorEffect="non-scaling-stroke"
                >
                  <title>
                    Исходная рамка с примыкающими линиями. Вид проёма неизвестен; граница пола и
                    проход не подтверждены.
                  </title>
                </polygon>
              ))
            : null}
          {showCompositeRectangles && packet.compositeSourceRectangles?.status === 'draft'
            ? packet.compositeSourceRectangles.candidates.map((rectangle) => (
                <polygon
                  key={rectangle.id}
                  points={rectangle.polygon.map((point) => `${point.x},${point.y}`).join(' ')}
                  fill="none"
                  stroke="#7c3aed"
                  strokeWidth="2"
                  strokeDasharray="6 4"
                  vectorEffect="non-scaling-stroke"
                >
                  <title>
                    {`Исходный прямоугольник; назначение неизвестно. Штрихи: ${rectangle.sourceRefs.map((ref) => `${ref.operationIndex}:${ref.subpathIndex}:${ref.segmentIndex}`).join(', ')}. Полных линейных контактов: ${rectangle.completeContactCount}; контактов с границей заливки: ${rectangle.filledBoundaryContactCount ?? 'не проверено'}. ${rectangle.jambContacts?.map((contact) => `Торец ${contact.edge.operationIndex}:${contact.edge.subpathIndex}:${contact.edge.segmentIndex}; грани заливки: ${contact.filledBoundarySources.map((ref) => `${ref.operationIndex}:${ref.subpathIndex}:${ref.segmentIndex}`).join(', ') || 'не найдены'}`).join('. ') ?? ''}. Проход не подтверждён.`}
                  </title>
                </polygon>
              ))
            : null}
          {showOneSidedWalls && packet.oneSidedWallSupports?.status === 'draft'
            ? packet.oneSidedWallSupports.candidates.map((support) => (
                <g key={support.id}>
                  <line
                    x1={support.start.x}
                    y1={support.start.y}
                    x2={support.end.x}
                    y2={support.end.y}
                    stroke="#059669"
                    strokeWidth="3"
                    strokeDasharray="4 3"
                    vectorEffect="non-scaling-stroke"
                  >
                    <title>
                      {`Исходная грань рядом с контуром ${support.contourKey}, участок ${support.wallEdgeIndex}. Заливка ${support.fillEdge.operationIndex}:${support.fillEdge.subpathIndex}:${support.fillEdge.segmentIndex}; независимый штрих ${support.strokeEdge.operationIndex}:${support.strokeEdge.subpathIndex}:${support.strokeEdge.segmentIndex}. Стена не подтверждена.`}
                    </title>
                  </line>
                  {support.oppositeFace ? (
                    <line
                      x1={support.oppositeFace.start.x}
                      y1={support.oppositeFace.start.y}
                      x2={support.oppositeFace.end.x}
                      y2={support.oppositeFace.end.y}
                      stroke="#0d9488"
                      strokeWidth="2"
                      strokeDasharray="2 4"
                      vectorEffect="non-scaling-stroke"
                    >
                      <title>
                        {`Противоположная грань той же исходной заливки, но без проверенного соседнего контура пола. Заливка ${support.oppositeFace.fillEdge.operationIndex}:${support.oppositeFace.fillEdge.subpathIndex}:${support.oppositeFace.fillEdge.segmentIndex}; независимый штрих ${support.oppositeFace.strokeEdge.operationIndex}:${support.oppositeFace.strokeEdge.subpathIndex}:${support.oppositeFace.strokeEdge.segmentIndex}. В 2D/3D не переносится.`}
                      </title>
                    </line>
                  ) : null}
                </g>
              ))
            : null}
          {showGlazingCandidates && packet.glazingSymbols?.status === 'draft'
            ? packet.glazingSymbols.candidates.map((symbol) => (
                <g key={symbol.id} fill="none" stroke="#1d4ed8" strokeWidth="2">
                  {symbol.polygons.map((polygon) => (
                    <polygon
                      key={polygon.map((point) => `${point.x}:${point.y}`).join(';')}
                      points={polygon.map((point) => `${point.x},${point.y}`).join(' ')}
                      vectorEffect="non-scaling-stroke"
                    >
                      <title>
                        Исходный корпус или торец профиля остекления. Вид проёма и граница пола не
                        подтверждены.
                      </title>
                    </polygon>
                  ))}
                  <line
                    x1={symbol.centerline.start.x}
                    y1={symbol.centerline.start.y}
                    x2={symbol.centerline.end.x}
                    y2={symbol.centerline.end.y}
                    vectorEffect="non-scaling-stroke"
                  >
                    <title>
                      Отдельная средняя линия из исходника. Это не добавленный порог и не граница
                      пола.
                    </title>
                  </line>
                </g>
              ))
            : null}
          {showFilledPanels && packet.filledPanelSymbols?.status === 'draft'
            ? packet.filledPanelSymbols.candidates.map((candidate) => (
                <g
                  key={candidate.id}
                  fill="none"
                  stroke="#dc2626"
                  strokeWidth="2"
                  strokeDasharray="4 3"
                >
                  {candidate.polygons.map((polygon) => (
                    <polygon
                      key={polygon.map((point) => `${point.x}:${point.y}`).join(';')}
                      points={polygon.map((point) => `${point.x},${point.y}`).join(' ')}
                      vectorEffect="non-scaling-stroke"
                    >
                      <title>
                        Исходный залитый корпус или торец с перекрытием. Косяки, вид проёма, высоты
                        и граница пола не подтверждены.
                      </title>
                    </polygon>
                  ))}
                </g>
              ))
            : null}
          {showSavedFloors && packet.savedPaintedFloors?.status === 'checked' ? (
            <g fill="none" stroke="#15803d" strokeWidth="2">
              {packet.savedPaintedFloors.floors.map((floor) => (
                <path
                  key={floor.id}
                  d={orderedPaintPath(floor)}
                  fillRule="evenodd"
                  vectorEffect="non-scaling-stroke"
                >
                  <title>
                    {floor.sourceRoomKey} — {floor.name}. Выбранная область исходника, не
                    подтверждённая физическая граница.
                  </title>
                </path>
              ))}
            </g>
          ) : null}
          {canShowProposal
            ? proposedPieces?.map(({ floor, piece }) =>
                piece ? (
                  <path
                    key={`${floor.candidateId}:${floor.pieceIndex}`}
                    d={orderedPaintPath(piece)}
                    fill="#d97706"
                    fillOpacity="0.08"
                    fillRule="evenodd"
                    stroke="#d97706"
                    strokeWidth="2.5"
                    strokeDasharray="7 5"
                    vectorEffect="non-scaling-stroke"
                  >
                    <title>{`${floor.owner.sourceRoomKey}: предложенный фрагмент ${floor.candidateId}, часть ${floor.pieceIndex}. Не сохранён и не подтверждён для 2D/3D.`}</title>
                  </path>
                ) : null,
              )
            : null}
          {showFloorCavities && packet.floorCavities?.status === 'draft' ? (
            <g fill="none" strokeWidth="2">
              {packet.floorCavities.candidates
                .filter((cell) => cell.markerLabelIds.length)
                .map((cell) => (
                  <polygon
                    key={cell.id}
                    points={cell.polygon.map((point) => `${point.x},${point.y}`).join(' ')}
                    stroke="#15803d"
                    fill="none"
                    strokeDasharray={cell.markerStatus === 'ambiguous' ? '5 4' : undefined}
                    vectorEffect="non-scaling-stroke"
                  >
                    <title>
                      Математический кандидат границы с цифровыми метками. Не точный пол, не
                      подтверждённая комната и не свободный проход.
                    </title>
                  </polygon>
                ))}
              {packet.floorCavities.thresholds.map((threshold) => {
                const frame = packet.openingFrames?.candidates.find(
                  ({ id }) => id === threshold.frameId,
                )
                return frame ? (
                  <polygon
                    key={`threshold:${frame.id}`}
                    points={frame.polygon.map((point) => `${point.x},${point.y}`).join(' ')}
                    stroke="#7e22ce"
                    fill="none"
                    strokeDasharray="5 4"
                    vectorEffect="non-scaling-stroke"
                  >
                    <title>
                      Логическая полоса по исходной рамке. Это не физический порог, не материальная
                      стена и не проверенный проход.
                      {threshold.paintAmbiguous ? ' Заливка неоднозначна.' : null}
                    </title>
                  </polygon>
                ) : null
              })}
            </g>
          ) : null}
          {showSplitHeightHints && packet.heightObservations?.status === 'draft'
            ? packet.heightObservations.splitHints?.flatMap((hint) =>
                hint.parts.map((part) => (
                  <circle
                    key={`split-height:${part.labelId}`}
                    cx={(part.pagePoint.x * packet.image.width) / 1000}
                    cy={(part.pagePoint.y * packet.image.height) / 1000}
                    r="7"
                    fill="#fff"
                    fillOpacity="0.2"
                    stroke="#be185d"
                    strokeWidth="2"
                    strokeDasharray="3 2"
                    vectorEffect="non-scaling-stroke"
                  >
                    <title>{`${part.labelId}: «${part.originalText}». Возможный фрагмент подписи порога; видимость исходных глифов и высота не подтверждены.`}</title>
                  </circle>
                )),
              )
            : null}
          {showHeightCallouts && packet.heightCallouts?.status === 'draft' ? (
            <g fill="none" stroke="#0369a1" strokeWidth="2" vectorEffect="non-scaling-stroke">
              {packet.heightCallouts.candidates.map((candidate) => (
                <g key={candidate.id}>
                  <polyline
                    points={[candidate.stem.end, candidate.stem.start, candidate.horizontal.end]
                      .map(
                        (point) =>
                          `${(point.x * packet.image.width) / 1000},${(point.y * packet.image.height) / 1000}`,
                      )
                      .join(' ')}
                    strokeDasharray="6 3"
                  >
                    <title>{`${candidate.id}: исходная выноска. Связь с проёмом не подтверждена.`}</title>
                  </polyline>
                  <circle
                    cx={(candidate.stem.end.x * packet.image.width) / 1000}
                    cy={(candidate.stem.end.y * packet.image.height) / 1000}
                    r="5"
                    fill="#0369a1"
                    fillOpacity="0.2"
                  />
                </g>
              ))}
            </g>
          ) : null}
        </svg>
      </section>
      <p className="text-[13px] leading-relaxed text-ink-2">
        Бирюзовые контуры — неизвестные области. Розовые — предполагаемые таблицы и служебные поля.
        Ни один цвет не означает подтверждённую комнату.
        {showOrderedPaint
          ? ' Фиолетовые фрагменты — результат расчёта заливок, не проверенный свободный пол.'
          : ''}
        {packet.openingFrames?.candidates.length
          ? ' Оранжевый пунктир обводит только нарисованные в исходнике рамки, не добавляет порог или границу пола.'
          : null}
        {packet.glazingSymbols?.candidates.length
          ? ' Синие линии показывают только исходные профили остекления, не определяют окна или балконные двери.'
          : null}
        {showFilledPanels
          ? ' Красный пунктир показывает исходные залитые профили, не подтверждённые физические проёмы.'
          : null}
        {showSavedFloors
          ? ' Зелёные контуры — сохранённый выбор областей исходника, не подтверждённые обмеры или физические стены.'
          : null}
      </p>
      <SavedReviewCoverage
        savedReview={packet.savedReview}
        hasSourceFloors={packet.savedPaintedFloors?.status === 'checked'}
      />
      {packet.savedFrameRooms &&
      (packet.savedFrameRooms.status !== 'not-saved' ||
        (packet.openingFrames?.candidates.length ?? 0) > 0) ? (
        <SavedFrameRooms review={packet.savedFrameRooms} />
      ) : null}
      <div className="border-t border-line pt-3">
        <h4 className="text-[14px] font-medium">
          Что ещё нужно проверить для переноса этого разбора в 2D/3D
        </h4>
        <ul className="mt-2 list-disc space-y-2 pl-5 text-[13px] leading-relaxed text-ink-2">
          {packet.issues
            .filter((issue) => !issue.code.includes(':'))
            .map((issue) => (
              <li key={issue.code}>{issue.message}</li>
            ))}
        </ul>
      </div>
      <details className="text-[12px] text-ink-2">
        <summary className="min-h-11 cursor-pointer py-3">Лист и версия исходника</summary>
        <p>Страница {packet.source.pdfPage}. Это результат только выбранного листа.</p>
        <p className="break-all">PDF: {packet.source.sha256}</p>
        <p className="break-all">Изображение: {packet.image.sha256}</p>
        {packet.doorSymbols?.refusalReason ? (
          <p className="mt-2 break-all">
            Ограничение поиска дверных символов: {packet.doorSymbols.refusalReason}.
          </p>
        ) : null}
        {packet.openingFrames?.refusalReason ? (
          <p className="mt-2 break-all">
            Ограничение поиска рамок проёмов: {packet.openingFrames.refusalReason}.
          </p>
        ) : null}
        {packet.glazingSymbols?.refusalReason ? (
          <p className="mt-2 break-all">
            Ограничение поиска профилей остекления: {packet.glazingSymbols.refusalReason}.
          </p>
        ) : null}
        {packet.issues
          .filter((issue) => issue.code.includes(':'))
          .map((issue) => (
            <p key={issue.code} className="mt-2 break-all">
              {issue.message}
            </p>
          ))}
      </details>
    </div>
  )
}

export function PlanNativeReview({
  projectId,
  pageNumber,
  sourceRevision,
  disabled,
  onConflict,
  onDocumentarySchedule,
  proposedFloors,
}: {
  projectId: string
  pageNumber: number
  sourceRevision: string
  disabled?: boolean
  onConflict: () => void
  onDocumentarySchedule?: (packet: NativeReviewPacket) => void
  proposedFloors?: ReviewedNativePaintedFloors | null
}) {
  const key = `${projectId}:${pageNumber}:${sourceRevision}`
  const [state, setState] = useState<{
    key: string
    pending: boolean
    error?: string
    packet?: NativeReviewPacket
    imageUrl?: string
  }>({ key, pending: false })
  const controller = useRef<{ key: string; request: AbortController } | null>(null),
    objectUrl = useRef<{ key: string; url: string } | null>(null)
  useEffect(
    () => () => {
      if (controller.current?.key === key) {
        controller.current.request.abort()
        controller.current = null
      }
      if (objectUrl.current?.key === key) {
        URL.revokeObjectURL(objectUrl.current.url)
        objectUrl.current = null
      }
    },
    [key],
  )
  const current = state.key === key ? state : null
  async function inspect() {
    if (controller.current?.key === key || disabled) return
    controller.current?.request.abort()
    const request = new AbortController()
    controller.current = { key, request }
    setState({ key, pending: true })
    if (objectUrl.current) {
      URL.revokeObjectURL(objectUrl.current.url)
      objectUrl.current = null
    }
    try {
      const { packet, image } = await loadNativeReview({
        projectId,
        page: pageNumber,
        revision: sourceRevision,
        signal: request.signal,
      })
      if (request.signal.aborted) return
      const imageUrl = URL.createObjectURL(image)
      objectUrl.current = { key, url: imageUrl }
      setState({ key, pending: false, packet, imageUrl })
      onDocumentarySchedule?.(packet)
    } catch (error) {
      if (request.signal.aborted) return
      if (error instanceof NativeReviewRequestError && error.status === 409) onConflict()
      setState({
        key,
        pending: false,
        error: error instanceof Error ? error.message : 'Не удалось проверить исходник.',
      })
    } finally {
      if (controller.current?.request === request) controller.current = null
    }
  }
  return (
    <details className="mt-5 min-w-0 max-w-full border-t border-line pt-4">
      <summary className="min-h-11 cursor-pointer py-2 text-[14px] font-medium">
        Проверка исходного листа без AI
      </summary>
      <p className="mt-2 text-[14px] leading-relaxed text-ink-2">
        Посмотрим нативные линии, подписи и неизвестные области PDF. Запуск — только по кнопке, без
        платной генерации и без сохранения правок.
      </p>
      {onDocumentarySchedule ? (
        <p className="mt-2 text-[13px] leading-relaxed text-ink-2">
          Если экспликация будет проверена, недостающие балконы и лоджии появятся ниже в черновике
          формы. Площадь берётся только из подписи таблицы; размеры и контуры не достраиваются,
          строки не переносятся в проект автоматически.
        </p>
      ) : null}
      <Button
        type="button"
        variant="secondary"
        className="mt-3"
        onClick={inspect}
        pending={current?.pending}
        disabled={disabled || current?.pending}
      >
        {current?.packet ? 'Повторить проверку исходника' : 'Проверить исходный лист'}
      </Button>
      {current?.pending ? (
        <p role="status" className="mt-3 text-[13px] text-ink-2">
          Проверяем выбранный лист. Большой чертёж может занять некоторое время…
        </p>
      ) : null}
      {current?.error ? (
        <p role="alert" className="mt-3 text-[14px] text-ink-2">
          {current.error}
        </p>
      ) : null}
      {current?.packet && current.imageUrl ? (
        <NativeReviewResult
          packet={current.packet}
          imageUrl={current.imageUrl}
          proposedFloors={proposedFloors}
          expectedRevision={sourceRevision}
        />
      ) : null}
    </details>
  )
}
