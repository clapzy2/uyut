import type { NativeReviewPacket } from '@/lib/projects/plan-native-review-packet'

const statuses: Record<string, string> = {
  paired: 'две исходные стороны связаны',
  matched: 'полное исходное совпадение',
  partial: 'частичное исходное покрытие',
  ambiguous: 'несколько конкурирующих свидетельств',
  unobserved: 'точное совпадение не найдено',
  unresolved: 'проверка удержана',
}
const coverageLabels = { complete: 'полное', partial: 'частичное', unproved: 'не доказано' }

export function NativeSourceObjectSummary({
  packet,
  showFloors,
  onShowFloors,
}: {
  packet: NativeReviewPacket
  showFloors: boolean
  onShowFloors: (show: boolean) => void
}) {
  const floors = packet.savedPaintedFloors
  const datum = packet.heightFloorReferences
  const ends = packet.filledPanelEnds
  const heights = packet.savedFloorHeights
  return (
    <div className="space-y-4 text-[13px] leading-relaxed">
      {datum && (datum.references.length || datum.refusalReason) ? (
        <section aria-label="Исходный отсчёт высот" className="space-y-2">
          <h4 className="text-[14px] font-medium">Исходный отсчёт высот</h4>
          <p className="text-ink-2">
            Примечание «от чистового пола» определяет местный отсчёт высот, а не один мировой ноль
            для всей квартиры. Подъёмы и разные уровни пола требуют отдельной связи с объектами.
            Полы не выравниваются, высоты в 3D не назначаются.
          </p>
          {datum.refusalReason ? (
            <p className="break-all">Проверка удержана: {datum.refusalReason}.</p>
          ) : (
            <ul className="list-disc space-y-2 pl-5 text-ink-2">
              {datum.references.map((ref) => (
                <li key={ref.labelId}>
                  {ref.originalText}:{' '}
                  {ref.status === 'verified'
                    ? 'исходные фрагменты подписи проверены'
                    : 'исходная подпись удержана'}
                  . Общий уровень пола не подтверждён.
                </li>
              ))}
            </ul>
          )}
        </section>
      ) : null}
      {ends && (ends.panels.length || ends.refusalReason) ? (
        <section aria-label="Торцы профилей и исходные грани" className="space-y-2">
          <h4 className="text-[14px] font-medium">Торцы профилей и исходные грани</h4>
          <p className="text-ink-2">
            Проверяем независимые линии, совпадающие с торцами по исходным координатам. Близкая
            линия не подвигается. Стойка или торец профиля не назначаются физическим косяком стены;
            перекрывающиеся свидетельства остаются неоднозначными.
          </p>
          {ends.refusalReason ? (
            <p className="break-all">Проверка удержана: {ends.refusalReason}.</p>
          ) : (
            <details>
              <summary className="min-h-11 cursor-pointer py-3">
                Исходные грани и удержанные косяки
              </summary>
              <ul className="list-disc space-y-2 pl-5 text-ink-2">
                {ends.panels.map((panel) => (
                  <li key={panel.panelId}>
                    <span className="break-all">{panel.panelId}</span>: {statuses[panel.status]}.
                    {panel.ends.map((end) => (
                      <p key={`${panel.panelId}:edge-${end.edgeIndex}`}>
                        Грань {end.edgeIndex + 1}: {statuses[end.status]}; покрытие —{' '}
                        {coverageLabels[end.coverage]}. Ссылки:{' '}
                        {end.sourceEdges.length
                          ? end.sourceEdges
                              .map(
                                (ref) =>
                                  `${ref.operationIndex}:${ref.subpathIndex}:${ref.segmentIndex}`,
                              )
                              .join(', ')
                          : 'нет точного совпадения'}
                        .
                      </p>
                    ))}
                  </li>
                ))}
              </ul>
            </details>
          )}
        </section>
      ) : null}
      {floors && floors.status !== 'not-saved' ? (
        <section aria-label="Сохранённые области пола" className="space-y-2">
          <h4 className="text-[14px] font-medium">Сохранённые области пола</h4>
          {floors.status === 'refused' ? (
            <p className="break-all text-ink-2">
              Выбор не прошёл перепроверку по текущему исходнику: {floors.reason}. Прежняя 2D/3D не
              заменена.
            </p>
          ) : (
            <>
              <p className="text-ink-2">
                Выбранных областей — {floors.floors.length}. Источник, геометрия и буквальные
                подписи перепроверены; владельцы и роли граней назначены в разметке. Это не
                подтверждение физических стен, порогов, обмеров или общего нуля.
              </p>
              <ul className="list-disc space-y-2 pl-5 text-ink-2">
                {floors.floors.map((floor) => (
                  <li key={floor.id}>
                    {floor.sourceRoomKey} — {floor.name}: неизвестных ролей граней —{' '}
                    {floor.unresolvedEdges}, возможных пропущенных штрихов —{' '}
                    {floor.omittedStrokeCount}. Физическая граница не принята.
                  </li>
                ))}
              </ul>
              <label className="flex min-h-11 items-center gap-2">
                <input
                  type="checkbox"
                  checked={showFloors}
                  onChange={(event) => onShowFloors(event.target.checked)}
                />
                Показать выбранные области пола — зелёный контур черновика
              </label>
            </>
          )}
        </section>
      ) : null}
      {heights && heights.status !== 'not-saved' ? (
        <section aria-label="Сохранённые привязки высот" className="space-y-2">
          <h4 className="text-[14px] font-medium">Сохранённые привязки высот</h4>
          {heights.status === 'refused' ? (
            <p className="break-all text-ink-2">
              Привязки не прошли свежую сверку: {heights.reason}. Прежняя 2D/3D не меняется.
            </p>
          ) : (
            <>
              <p className="text-ink-2">
                Подписи и выбранные области перепроверены; назначение высоты помещению задано
                вручную. Это не подтверждение чистового потолка, общего нуля или натурного обмера.
              </p>
              {heights.bindings.length ? (
                <ul className="list-disc space-y-2 pl-5 text-ink-2">
                  {heights.bindings.map((row) => (
                    <li key={row.floorId}>
                      {row.sourceRoomKey} — {row.name}: {row.originalText}, {row.valueMm} мм.
                      Подпись {row.labelId}; местный отсчёт от чистового пола.
                    </li>
                  ))}
                </ul>
              ) : (
                <p className="text-ink-2">
                  Высоты не выбраны. Высоты соседних помещений не копируются.
                </p>
              )}
            </>
          )}
        </section>
      ) : null}
    </div>
  )
}
