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
  onToggle,
  onCopy,
}: {
  reference?: SourceFloorReference
  selectedKey?: string
  shown: boolean
  loading: boolean
  locked: boolean
  draftExists: boolean
  conversion: SourceFloorDraftResult
  error?: string
  onToggle: () => void
  onCopy: () => void
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
                {floor.boundarySupports.length} граней. Покрытие и сторона краски вычислены по
                точным ключам. Это ещё не проверка строительных стен, косяков или проходов;
                пропущенные штрихи и физическое назначение требуют отдельной сверки.
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
                      <th className="py-2 font-medium" scope="col">
                        Краска
                      </th>
                    </tr>
                  </thead>
                  <tbody>
                    {floor.boundarySupports.map((edge) => {
                      const sides = new Set(edge.contacts.map((contact) => contact.paintSide))
                      return (
                        <tr
                          key={`${edge.ringIndex}:${edge.edgeIndex}`}
                          className="border-b border-line align-top"
                        >
                          <th className="py-2 pr-3 font-normal" scope="row">
                            {edge.ringIndex === 0 ? 'Контур' : `Вырез ${edge.ringIndex}`} ·{' '}
                            {edge.edgeIndex + 1}
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
                          </td>
                          <td className="py-2 text-ink-2">
                            {sides.size > 1
                              ? 'С обеих сторон'
                              : sides.has('opposite-region')
                                ? 'С другой стороны'
                                : sides.has('selected-region')
                                  ? 'Со стороны области'
                                  : 'Не определена'}
                          </td>
                        </tr>
                      )
                    })}
                  </tbody>
                </table>
              </div>
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
