'use client'

import { Button } from '@uyut/ui'
import type { SourceFloorReference } from '@/lib/projects/plan-page-source-floors'
import type { SourceFloorDraftResult } from './plan-page-source-floor-model'

const refusalMessages = {
  'missing-selection':
    'Для выбранного номера нет проверенной области исходника. Общие зоны не объединяются автоматически.',
  holes:
    'В области есть внутренние вырезы. Она остаётся ориентиром: вырезы не превращаются автоматически в технические пустоты.',
  'rational-precision':
    'Часть пересечений нельзя перенести в текущий черновик без потери точности. Координаты не округляются.',
  'unproved-vertex':
    'Не все вершины связаны с проверенными узлами или пересечениями линий PDF. Область не копируется частично.',
} satisfies Record<Extract<SourceFloorDraftResult, { kind: 'held' }>['reason'], string>

export function PlanPageSourceFloorControls({
  reference,
  selectedKey,
  shown,
  loading,
  locked,
  draftExists,
  conversion,
  error,
  highlightedEdge,
  onToggle,
  onCopy,
  onHighlightEdge,
}: {
  reference?: SourceFloorReference
  selectedKey?: string
  shown: boolean
  loading: boolean
  locked: boolean
  draftExists: boolean
  conversion: SourceFloorDraftResult
  error?: string
  highlightedEdge?: { ringIndex: number; edgeIndex: number }
  onToggle: () => void
  onCopy: () => void
  onHighlightEdge?: (edge?: { ringIndex: number; edgeIndex: number }) => void
}) {
  const current = shown && !loading && !error ? reference : undefined
  const floor =
    current?.status === 'checked'
      ? current.floors.find((floor) => floor.sourceRoomKey === selectedKey)
      : undefined
  const canCopy = Boolean(
    floor &&
      conversion.kind === 'candidate' &&
      String(conversion.draft.roomSourceNumber) === selectedKey &&
      !draftExists &&
      !locked,
  )
  const boundaryLabels = {
    linked: 'Полное покрытие источником',
    partial: 'Частичное покрытие',
    ambiguous: 'Конкурирующие источники',
    unobserved: 'Связь не найдена',
  }
  const opening = current?.openingInspection
  const openingContacts =
    opening?.targets.filter((target) =>
      target.contacts.some((contact) => contact.floorId === floor?.id),
    ) ?? []
  const openingByEdge = new Map<string, typeof openingContacts>()
  for (const target of openingContacts) {
    for (const contact of target.contacts) {
      if (contact.floorId !== floor?.id) continue
      const key = `${contact.ringIndex}:${contact.edgeIndex}`
      const matches = openingByEdge.get(key) ?? []
      matches.push(target)
      openingByEdge.set(key, matches)
    }
  }
  const openingLabels = {
    matched: 'Полное совпадение исходных отрезков',
    partial: 'Частичное совпадение',
    ambiguous: 'Неоднозначная связь',
    unobserved: 'Совпадение не найдено',
    unresolved: 'Связь требует проверки',
  }
  const targetLabels = {
    'frame-side': 'Сторона рамки',
    'frame-jamb': 'Торец рамки',
    'panel-end': 'Конец профиля',
  }
  const roleLabels = {
    'wall-face': 'Заявлена грань стены',
    'opening-boundary': 'Заявлена граница проёма',
    'level-separator': 'Заявлен перепад уровня',
    unresolved: 'Назначение не задано',
  }

  return (
    <div className="space-y-2 border-l-2 border-line pl-3 text-sm">
      <p className="font-medium text-ink">Выбранная область исходника</p>
      <p className="max-w-2xl text-xs leading-relaxed text-ink-2">
        Область PDF — ориентир для сверки, не подтверждённая физическая граница пола. Размеры,
        высоты и уровень отсчёта не подтверждаются этим действием.
      </p>
      <Button
        type="button"
        size="sm"
        variant="secondary"
        disabled={locked || loading}
        aria-pressed={shown}
        onClick={() => {
          if (!locked && !loading) onToggle()
        }}
      >
        {shown ? 'Скрыть выбранную область исходника' : 'Показать выбранную область исходника'}
      </Button>
      {loading ? (
        <p role="status" className="text-xs text-ink-2">
          Сверяем сохранённый выбор с исходным PDF…
        </p>
      ) : error ? (
        <p role="alert" className="text-xs text-danger">
          {error}
        </p>
      ) : current?.status === 'not-saved' ? (
        <p role="status" className="text-xs text-ink-2">
          Области исходника ещё не выбраны и не сохранены. Разметка комнат остаётся доступной.
        </p>
      ) : current?.status === 'held' ? (
        <p role="status" className="text-xs text-ink-2">
          Сохранённый выбор не прошёл повторную сверку исходника. Прежняя область не показывается;
          проверьте выбранный лист и сохранённую разметку областей.
        </p>
      ) : current?.status === 'checked' ? (
        <>
          {floor ? (
            <p className="text-xs leading-relaxed text-ink-2">
              № {floor.sourceRoomKey} · {floor.name}. Вершин: {floor.polygon.length}; внутренних
              вырезов: {floor.holes.length}; пересечений без точного десятичного представления:{' '}
              {floor.nonDecimalVertices}; возможных пропущенных штрихов: {floor.omittedStrokeCount}.
            </p>
          ) : null}
          {floor && current.boundaryInspection?.status === 'held' ? (
            <p role="status" className="text-xs leading-relaxed text-ink-2">
              Проверка граней исходника удержана: {current.boundaryInspection.reason}. Сам исходный
              снимок остаётся доступен; физические границы этим не подтверждаются.
            </p>
          ) : floor?.boundarySupports ? (
            <details className="max-w-2xl border-t border-line pt-2">
              <summary className="min-h-11 cursor-pointer py-2 font-medium">
                Проверка граней исходного контура
              </summary>
              <p className="mb-3 text-xs leading-relaxed text-ink-2">
                Связано с командами PDF:{' '}
                {floor.boundarySupports.filter((edge) => edge.status === 'linked').length} из{' '}
                {floor.boundarySupports.length} граней. Выберите номер грани, чтобы увидеть её
                поверх исходного листа. Покрытие и сторона краски вычислены по точным ключам;
                заявленная роль и совпадение с рамкой не подтверждают строительную стену, косяк или
                проход. Перенос в 2D/3D удержан.
              </p>
              <div className="max-w-full overflow-x-auto">
                <table className="w-full text-left text-xs leading-relaxed">
                  <caption className="sr-only">
                    Грани выбранной исходной области и их источники
                  </caption>
                  <thead className="text-ink-2">
                    <tr className="border-b border-line">
                      <th className="py-2 pr-3 font-medium" scope="col">
                        Грань
                      </th>
                      <th className="py-2 pr-3 font-medium" scope="col">
                        Связь с PDF
                      </th>
                      <th className="py-2 pr-3 font-medium" scope="col">
                        Краска и роль
                      </th>
                      <th className="py-2 font-medium" scope="col">
                        Контакт с проёмом
                      </th>
                    </tr>
                  </thead>
                  <tbody>
                    {floor.boundarySupports.map((edge) => {
                      const sides = new Set(edge.contacts.map((contact) => contact.paintSide))
                      const edgeOpenings =
                        openingByEdge.get(`${edge.ringIndex}:${edge.edgeIndex}`) ?? []
                      const selected =
                        highlightedEdge?.ringIndex === edge.ringIndex &&
                        highlightedEdge.edgeIndex === edge.edgeIndex
                      return (
                        <tr
                          key={`${edge.ringIndex}:${edge.edgeIndex}`}
                          className="border-b border-line align-top"
                        >
                          <th className="py-2 pr-3 font-normal" scope="row">
                            <button
                              type="button"
                              className="min-h-11 text-left underline decoration-line underline-offset-4 disabled:no-underline"
                              aria-pressed={selected}
                              disabled={!onHighlightEdge}
                              onClick={() =>
                                onHighlightEdge?.(
                                  selected
                                    ? undefined
                                    : { ringIndex: edge.ringIndex, edgeIndex: edge.edgeIndex },
                                )
                              }
                            >
                              {edge.ringIndex === 0 ? 'Контур' : `Вырез ${edge.ringIndex}`} ·{' '}
                              {edge.edgeIndex + 1}
                            </button>
                          </th>
                          <td className="py-2 pr-3">
                            {boundaryLabels[edge.status]}
                            {edge.contacts.length ? (
                              <p className="break-words font-mono text-[10px] text-ink-2">
                                {edge.contacts
                                  .map(
                                    (contact) =>
                                      `${contact.operationIndex}/${contact.subpathIndex}/${contact.segmentIndex}`,
                                  )
                                  .join(', ')}
                              </p>
                            ) : null}
                            {edge.omittedInkCount ? (
                              <p className="text-ink-2">
                                Возможных пропусков: {edge.omittedInkCount}
                              </p>
                            ) : null}
                            {edge.contacts.some((contact) => contact.visibility) ? (
                              <p className="text-ink-2">
                                {edge.contacts.every(
                                  (contact) => contact.visibility?.status === 'unoccluded',
                                )
                                  ? 'Поздняя краска исключена на этих отрезках'
                                  : 'Видимость исходных отрезков удержана'}
                                {edge.contacts.some(
                                  (contact) => contact.visibility?.blockerOperations.length,
                                )
                                  ? ` · возможных наложений: ${new Set(edge.contacts.flatMap((contact) => contact.visibility?.blockerOperations ?? [])).size}`
                                  : null}
                              </p>
                            ) : null}
                          </td>
                          <td className="py-2 pr-3 text-ink-2">
                            {sides.size > 1
                              ? 'С обеих сторон'
                              : sides.has('opposite-region')
                                ? 'С другой стороны'
                                : sides.has('selected-region')
                                  ? 'Со стороны области'
                                  : 'Не определена'}
                            <p>
                              {roleLabels[edge.declaredRole]} — только отметка, не доказательство
                            </p>
                          </td>
                          <td className="py-2 text-ink-2">
                            {opening?.status !== 'checked'
                              ? 'Сопоставление с проёмами удержано'
                              : edgeOpenings.length
                                ? `${edgeOpenings.length} совпадений с рамками или профилями`
                                : 'Не найден; инвентарь проёмов неполный'}
                            {edgeOpenings.some((target) => target.status !== 'matched') ? (
                              <p>Есть неоднозначные или частичные совпадения</p>
                            ) : null}
                            <p>Физическая граница и косяк не подтверждены</p>
                          </td>
                        </tr>
                      )
                    })}
                  </tbody>
                </table>
              </div>
            </details>
          ) : null}
          {floor && opening ? (
            <details className="max-w-2xl border-t border-line pt-2">
              <summary className="min-h-11 cursor-pointer py-2 font-medium">
                Связи исходного контура с проёмами и косяками
              </summary>
              <p className="mb-3 text-xs leading-relaxed text-ink-2">
                Проверяем точные отрезки внешнего контура и вырезов, не продолжения линий. Рамки и
                профили ещё не классифицированы как двери или окна. Совпадение не подтверждает
                физический косяк, свободный проход или видимость после наложений.
              </p>
              {opening.status === 'held' ? (
                <p role="status" className="text-xs text-ink-2">
                  Сопоставление удержано: {opening.reason}. Исходный контур не изменён.
                </p>
              ) : (
                <>
                  <p className="mb-3 text-xs text-ink-2">
                    Проверено сторон и концов: {opening.targets.length}; с выбранной областью
                    совпадают: {openingContacts.length}. Неоднозначных концов профилей на листе:{' '}
                    {
                      opening.targets.filter((target) => target.sourceEndStatus === 'ambiguous')
                        .length
                    }
                    . Это неполный инвентарь проёмов.
                  </p>
                  {openingContacts.length ? (
                    <div className="max-w-full overflow-x-auto">
                      <table className="w-full text-left text-xs leading-relaxed">
                        <caption className="sr-only">
                          Контакты исходной области с рамками и профилями
                        </caption>
                        <thead className="text-ink-2">
                          <tr className="border-b border-line">
                            <th scope="col" className="py-2 pr-3 font-medium">
                              Объект PDF
                            </th>
                            <th scope="col" className="py-2 pr-3 font-medium">
                              Грани области
                            </th>
                            <th scope="col" className="py-2 font-medium">
                              Результат
                            </th>
                          </tr>
                        </thead>
                        <tbody>
                          {openingContacts.map((target) => (
                            <tr key={target.id} className="border-b border-line align-top">
                              <th scope="row" className="py-2 pr-3 font-normal">
                                {targetLabels[target.kind]}
                                <p className="font-mono text-[10px] text-ink-2">
                                  {target.sourceRef.operationIndex}/{target.sourceRef.subpathIndex}/
                                  {target.sourceRef.segmentIndex}
                                </p>
                              </th>
                              <td className="py-2 pr-3">
                                {target.contacts
                                  .filter((contact) => contact.floorId === floor.id)
                                  .map((contact) => (
                                    <p key={`${contact.ringIndex}:${contact.edgeIndex}`}>
                                      {contact.ringIndex === 0
                                        ? 'Контур'
                                        : `Вырез ${contact.ringIndex}`}{' '}
                                      · {contact.edgeIndex + 1}
                                      {target.kind === 'frame-side'
                                        ? contact.regionSide === target.frameInteriorSide
                                          ? ' · со стороны рамки'
                                          : ' · с другой стороны рамки'
                                        : null}
                                    </p>
                                  ))}
                              </td>
                              <td className="py-2 text-ink-2">
                                {openingLabels[target.status]}
                                {target.sourceEndStatus ? (
                                  <p>Конец по источнику: {openingLabels[target.sourceEndStatus]}</p>
                                ) : null}
                                {target.omittedInkCount ? (
                                  <p>Возможных пропусков: {target.omittedInkCount}</p>
                                ) : null}
                                {target.laterPaintCount ? (
                                  <p>Поздних наложений: {target.laterPaintCount}</p>
                                ) : null}
                                {target.visibility ? (
                                  <p>
                                    {target.visibility.status === 'unoccluded'
                                      ? 'Поздняя краска исключена на исходном отрезке'
                                      : 'Видимость исходного отрезка удержана'}
                                    {target.visibility.blockerOperations.length
                                      ? ` · возможных наложений: ${target.visibility.blockerOperations.length}`
                                      : null}
                                  </p>
                                ) : null}
                                {target.independentVisibility?.some(
                                  (item) => item.visibility.status === 'held',
                                ) ? (
                                  <p>Видимость независимых косяковых источников удержана</p>
                                ) : null}
                              </td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  ) : (
                    <p className="text-xs text-ink-2">
                      Точных совпадений с выбранной областью не найдено. Это не означает, что в
                      комнате нет проёмов: другие обозначения требуют отдельной проверки.
                    </p>
                  )}
                </>
              )}
            </details>
          ) : null}
          {draftExists ? (
            <p className="text-xs leading-relaxed text-ink-2">
              Черновик этой комнаты уже есть. Его контур, проёмы и другие объекты не заменяются
              областью исходника.
            </p>
          ) : conversion.kind === 'held' ? (
            <p role="status" className="text-xs leading-relaxed text-ink-2">
              {refusalMessages[conversion.reason]}
            </p>
          ) : floor && String(conversion.draft.roomSourceNumber) === selectedKey ? (
            <>
              <Button
                type="button"
                size="sm"
                variant="ghost"
                disabled={!canCopy}
                onClick={() => {
                  if (canCopy) onCopy()
                }}
              >
                Взять как черновик комнаты
              </Button>
              <p className="text-xs leading-relaxed text-ink-2">
                {conversion.draft.sourceTopology
                  ? 'Целый исходный контур с точными ключами и вырезами сохраняется отдельно от физической разметки. Редактирование вершин и метрический перенос пока недоступны.'
                  : 'Только целый контур без вырезов и округления. Проверьте его на листе перед сохранением; физические границы, размеры и высоты остаются неподтверждёнными.'}
              </p>
            </>
          ) : null}
        </>
      ) : null}
    </div>
  )
}
