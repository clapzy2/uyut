'use client'

import { Button } from '@uyut/ui'
import { useEffect, useRef, useState } from 'react'
import {
  loadNativeReview,
  NativeReviewRequestError,
} from '@/lib/projects/plan-native-review-client'
import type { NativeReviewPacket } from '@/lib/projects/plan-native-review-packet'

const coverageMessages: Record<string, string> = {
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
}: {
  savedReview: NativeReviewPacket['savedReview']
}) {
  return (
    <section className="border-t border-line pt-3" aria-label="Проверка сохранённой разметки">
      <h4 className="text-[14px] font-medium">Проверка сохранённой разметки</h4>
      {savedReview.status === 'not-saved' ? (
        <p className="mt-2 text-[13px] leading-relaxed text-ink-2">
          Ручная разметка этого листа ещё не сохранена. Найденные выше области не заменяют её.
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

export function NativeReviewResult({
  packet,
  imageUrl,
}: {
  packet: NativeReviewPacket
  imageUrl: string
}) {
  const [showFills, setShowFills] = useState(false)
  const [showOpeningCandidates, setShowOpeningCandidates] = useState(true)
  const [showGlazingCandidates, setShowGlazingCandidates] = useState(true)
  const [fullSize, setFullSize] = useState(false)
  const visible = packet.faces.filter((face) => face.layer === 'stroke' || showFills)
  const hasOpeningCandidates =
    (packet.doorSymbols?.candidates.length ?? 0) + (packet.openingFrames?.candidates.length ?? 0) >
    0
  return (
    <div className="mt-4 space-y-4">
      <p className="border-l-2 border-accent pl-3 text-[14px] leading-relaxed text-ink-2">
        Это проверка исходного листа, не готовая схема квартиры. Сохранённые комнаты, мерки и 2D/3D
        не меняются.
      </p>
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
          <dt className="text-ink-2">Связи с номерами</dt>
          <dd>{packet.counts.numberedAssociations}</dd>
        </div>
        <div>
          <dt className="text-ink-2">Размерные подписи</dt>
          <dd>{packet.counts.printedDimensions}</dd>
        </div>
      </dl>
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
      <label className="flex min-h-11 items-center gap-2 text-[13px]">
        <input
          type="checkbox"
          checked={showFills}
          onChange={(event) => setShowFills(event.target.checked)}
        />
        Показать также области из заливок — их назначение не подтверждено
      </label>
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
        className="overflow-auto border border-line bg-white"
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
        </svg>
      </section>
      <p className="text-[13px] leading-relaxed text-ink-2">
        Бирюзовые контуры — неизвестные области. Розовые — предполагаемые таблицы и служебные поля.
        Ни один цвет не означает подтверждённую комнату.
        {packet.openingFrames?.candidates.length
          ? ' Оранжевый пунктир обводит только нарисованные в исходнике рамки, не добавляет порог или границу пола.'
          : null}
        {packet.glazingSymbols?.candidates.length
          ? ' Синие линии показывают только исходные профили остекления, не определяют окна или балконные двери.'
          : null}
      </p>
      <SavedReviewCoverage savedReview={packet.savedReview} />
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
}: {
  projectId: string
  pageNumber: number
  sourceRevision: string
  disabled?: boolean
  onConflict: () => void
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
    <details className="mt-5 border-t border-line pt-4">
      <summary className="min-h-11 cursor-pointer py-2 text-[14px] font-medium">
        Проверка исходного листа без AI
      </summary>
      <p className="mt-2 text-[14px] leading-relaxed text-ink-2">
        Посмотрим нативные линии, подписи и неизвестные области PDF. Запуск — только по кнопке, без
        платной генерации и без сохранения правок.
      </p>
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
        <NativeReviewResult packet={current.packet} imageUrl={current.imageUrl} />
      ) : null}
    </details>
  )
}
