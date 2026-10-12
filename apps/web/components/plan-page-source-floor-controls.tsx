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
                Только целый контур без вырезов и округления. Проверьте его на листе перед
                сохранением; физические границы, размеры и высоты остаются неподтверждёнными.
              </p>
            </>
          ) : null}
        </>
      ) : null}
    </div>
  )
}
