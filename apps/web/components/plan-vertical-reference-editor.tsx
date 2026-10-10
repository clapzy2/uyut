'use client'

import type { PlanGeometry, PlanRoomShape, PlanVerticalReference } from '@uyut/db'
import { Button, Input } from '@uyut/ui'
import {
  currentPlanVerticalReference,
  inspectPlanVerticalReference,
} from '@/lib/projects/plan-vertical-reference'
import {
  buildVerticalReferenceRequest,
  type VerticalReferenceDraft,
  verticalReferenceDraftSnapshot,
} from '@/lib/projects/plan-vertical-reference-edit'

type Props = {
  geometry: PlanGeometry
  draft?: VerticalReferenceDraft
  acknowledged: boolean
  removal: boolean
  pending: boolean
  startError?: string
  onStart: () => void
  onChange: (draft: VerticalReferenceDraft) => void
  onAcknowledge: (checked: boolean) => void
  onRemove: () => void
  onCancel: () => void
}

const selectClass = 'h-11 w-full rounded-sm border border-control bg-paper px-3 text-sm text-ink'

function floorTitle(room: PlanRoomShape): string {
  const numbers = room.sourceNumbers ?? (room.sourceNumber === undefined ? [] : [room.sourceNumber])
  return numbers.length ? `${room.name} · № ${numbers.join(' + ')}` : room.name
}

function surfaceTitle(kind: PlanVerticalReference['kind']): string {
  return kind === 'existing-floor' ? 'Существующий пол' : 'Чистовой пол'
}

function level(value: number): string {
  return `${value > 0 ? '+' : ''}${value.toLocaleString('ru-RU')} см`
}

function wallTitle(geometry: PlanGeometry, wallId: string): string {
  const index = geometry.walls.findIndex((wall) => wall.id === wallId)
  return index === -1 ? 'Стена не найдена' : `Стена ${index + 1}`
}

function openingTitle(geometry: PlanGeometry, openingId: string): string {
  const index = geometry.openings.findIndex((opening) => opening.id === openingId)
  const opening = geometry.openings[index]
  if (!opening) return 'Проём не найден'
  const type =
    opening.type === 'balcony' ? 'Балконный блок' : opening.type === 'window' ? 'Окно' : 'Дверь'
  return `${type} ${index + 1} (${wallTitle(geometry, opening.wallId).toLowerCase()})`
}

export function PlanVerticalReferenceEditor({
  geometry,
  draft,
  acknowledged,
  removal,
  pending,
  startError,
  onStart,
  onChange,
  onAcknowledge,
  onRemove,
  onCancel,
}: Props) {
  const hasStored = geometry.verticalReference !== undefined
  const stored = currentPlanVerticalReference(geometry)
  const staleDraft =
    draft !== undefined && draft.geometrySnapshot !== verticalReferenceDraftSnapshot(geometry)
  const preview = draft && !staleDraft ? buildVerticalReferenceRequest(geometry, draft) : undefined
  const zeroFloor = stored?.floors.find((floor) => floor.id === stored.zeroFloorId)

  return (
    <details className="space-y-4 border-t border-line pt-4">
      <summary className="cursor-pointer text-sm font-medium text-ink">
        Общий высотный отсчёт и отметки
      </summary>
      <p className="text-xs leading-relaxed text-ink-2">
        Единый ноль выбирается по конкретному полу. Вид поверхности сам по себе не задаёт ноль и не
        означает, что полы всех помещений находятся на одной высоте.
      </p>
      {hasStored || draft || removal ? (
        <p className="text-xs leading-relaxed text-danger" role="status">
          Известные уровни используются с подтверждённой схемой и актуальными привязками. 3D не
          достраивает неизвестный пол и толщину порога; маршруты проверяют только непрерывный ровный
          уровень, без преодоления ступеней.
        </p>
      ) : null}
      {hasStored && !stored ? (
        <section
          className="space-y-2 text-xs leading-relaxed text-ink-2"
          aria-label="Недействительный отсчёт"
        >
          <p role="status">
            Сохранённый отсчёт недействителен: изменились данные или привязки. Нужна новая сверка.
          </p>
          <p>{inspectPlanVerticalReference(geometry)[0]?.message}</p>
          <p>Прежние отметки не используются и не копируются в новую сверку.</p>
        </section>
      ) : null}
      {stored ? (
        <section
          className="space-y-2 text-xs leading-relaxed text-ink-2"
          aria-label="Сохранённый отсчёт"
        >
          <p role="status">Сохранённая сверка пользователя относится к текущим контурам.</p>
          <p>
            Вид отсчёта: {surfaceTitle(stored.kind)}. Нулевой пол:{' '}
            {zeroFloor ? floorTitle(zeroFloor.room) : 'владелец не найден'}.
          </p>
          <p className="break-words">
            Источник пользователя:{' '}
            {stored.source.kind === 'site-measurement' ? 'обмер' : 'размерный чертёж'} —{' '}
            {stored.source.reference}.
          </p>
          <ul className="space-y-2">
            {stored.floors.map((floor) => {
              const ceiling = stored.ceilings?.find((value) => value.floorId === floor.id)
              return (
                <li key={floor.id}>
                  {floorTitle(floor.room)}: {surfaceTitle(floor.surface).toLowerCase()}{' '}
                  {level(floor.elevationCm)}. Потолок в общем отсчёте:{' '}
                  {ceiling ? level(ceiling.elevationCm) : 'не указан'}.
                </li>
              )
            })}
          </ul>
          {stored.thresholds.map((threshold) => (
            <p key={threshold.id}>
              Верх порога{' '}
              {threshold.bindings
                .map((side) => openingTitle(geometry, side.opening.id))
                .join(' ↔ ')}
              : {level(threshold.elevationCm)}.
            </p>
          ))}
        </section>
      ) : null}
      {removal ? (
        <fieldset disabled={pending} className="space-y-3">
          <p className="text-xs text-ink-2">
            Снятие отсчёта подготовлено. Оно произойдёт только после сохранения схемы.
          </p>
          <label className="flex items-start gap-3 text-xs leading-relaxed text-ink-2">
            <input
              type="checkbox"
              className="mt-0.5 h-4 w-4 shrink-0 accent-accent"
              checked={acknowledged}
              onChange={(event) => onAcknowledge(event.currentTarget.checked)}
            />
            Я понимаю, что сниму общий отсчёт и все связанные отметки полов, потолков и порогов при
            сохранении схемы.
          </label>
          <Button variant="ghost" size="sm" onClick={onCancel}>
            Отменить снятие отсчёта
          </Button>
        </fieldset>
      ) : draft ? (
        <div className="space-y-4">
          {staleDraft ? (
            <div className="space-y-3">
              <p className="text-xs leading-relaxed text-danger" role="status">
                Контуры, владельцы или источник изменились. Поля заблокированы; начните сверку
                заново. Прежние числа не будут перенесены в изменённую геометрию.
              </p>
              <Button
                variant="secondary"
                size="sm"
                disabled={pending || Boolean(startError)}
                onClick={onStart}
              >
                Начать сверку заново
              </Button>
            </div>
          ) : null}
          <fieldset disabled={pending || staleDraft} className="min-w-0 space-y-4">
            <div className="grid gap-3 sm:grid-cols-2">
              <label className="space-y-2 text-[13px] text-ink-2" htmlFor="vertical-reference-kind">
                <span className="block">Вид общего отсчёта</span>
                <select
                  id="vertical-reference-kind"
                  className={selectClass}
                  value={draft.kind}
                  onChange={(event) =>
                    onChange({
                      ...draft,
                      kind: event.currentTarget.value as VerticalReferenceDraft['kind'],
                    })
                  }
                >
                  <option value="">Выберите поверхность отсчёта</option>
                  <option value="existing-floor">Существующий пол</option>
                  <option value="finished-floor">Чистовой пол</option>
                </select>
              </label>
              <label className="space-y-2 text-[13px] text-ink-2" htmlFor="vertical-reference-zero">
                <span className="block">Пол, задающий ноль</span>
                <select
                  id="vertical-reference-zero"
                  className={selectClass}
                  value={draft.zeroFloorId}
                  onChange={(event) =>
                    onChange({ ...draft, zeroFloorId: event.currentTarget.value })
                  }
                >
                  <option value="">Выберите нулевой пол</option>
                  {draft.floors.map((floor) => (
                    <option key={floor.id} value={floor.id}>
                      {floorTitle(floor.room)}
                    </option>
                  ))}
                </select>
              </label>
            </div>
            <p className="text-xs leading-relaxed text-ink-2">
              Введите 0 для выбранного нулевого пола самостоятельно. Остальные отметки —
              относительно него: ниже нуля со знаком минус, выше — со знаком плюс. Пустое поле не
              означает 0. Общие подписи помещений описывают один физический контур, а не несколько
              полов.
            </p>
            <label
              className="block space-y-2 text-[13px] text-ink-2"
              htmlFor="vertical-reference-source"
            >
              <span className="block">Источник отметок</span>
              <select
                id="vertical-reference-source"
                className={selectClass}
                value={draft.sourceKind}
                onChange={(event) =>
                  onChange({
                    ...draft,
                    sourceKind: event.currentTarget.value as VerticalReferenceDraft['sourceKind'],
                  })
                }
              >
                <option value="">Выберите источник</option>
                <option value="site-measurement">Обмер квартиры</option>
                <option value="dimensioned-drawing">Размерный чертёж</option>
              </select>
            </label>
            <Input
              id="vertical-reference-description"
              label="Откуда взяты отметки и общий ноль"
              maxLength={300}
              value={draft.sourceReference}
              hint="Документ и лист либо обмер и дата. Не измерение картинки и не предположение по распознанной подписи."
              onChange={(event) =>
                onChange({ ...draft, sourceReference: event.currentTarget.value })
              }
            />
            <section className="space-y-4" aria-label="Отметки физических полов">
              <h3 className="text-sm font-medium text-ink">Полы и потолки</h3>
              {draft.floors.map((floor) => {
                const update = (patch: Partial<typeof floor>) =>
                  onChange({
                    ...draft,
                    floors: draft.floors.map((value) =>
                      value.id === floor.id ? { ...value, ...patch } : value,
                    ),
                  })
                return (
                  <div key={floor.id} className="space-y-3 border-t border-line pt-3">
                    <p className="text-sm text-ink">{floorTitle(floor.room)}</p>
                    <label
                      className="block space-y-2 text-[13px] text-ink-2"
                      htmlFor={`vertical-surface-${floor.id}`}
                    >
                      <span className="block">Поверхность этого пола</span>
                      <select
                        id={`vertical-surface-${floor.id}`}
                        className={selectClass}
                        value={floor.surface}
                        onChange={(event) =>
                          update({ surface: event.currentTarget.value as typeof floor.surface })
                        }
                      >
                        <option value="">Выберите поверхность</option>
                        <option value="existing-floor">Существующий пол</option>
                        <option value="finished-floor">Чистовой пол</option>
                      </select>
                    </label>
                    <div className="grid gap-3 sm:grid-cols-2">
                      <Input
                        id={`vertical-floor-${floor.id}`}
                        label="Отметка пола от общего нуля, см"
                        inputMode="decimal"
                        value={floor.elevation}
                        onChange={(event) => update({ elevation: event.currentTarget.value })}
                      />
                      <Input
                        id={`vertical-ceiling-${floor.id}`}
                        label="Отметка чистового потолка от общего нуля, см"
                        inputMode="decimal"
                        value={floor.ceiling}
                        hint="Не высота стены. Пустое поле — потолок неизвестен."
                        onChange={(event) => update({ ceiling: event.currentTarget.value })}
                      />
                    </div>
                  </div>
                )
              })}
              {!draft.floors.length ? (
                <p className="text-xs text-ink-2">
                  Сначала нужны контуры помещений — владельцы физических полов.
                </p>
              ) : null}
            </section>
            <section
              className="space-y-3 border-t border-line pt-3"
              aria-label="Владельцы оснований стен"
            >
              <h3 className="text-sm font-medium text-ink">Основания стен</h3>
              <p className="text-xs leading-relaxed text-ink-2">
                Выберите физический пол для основания каждой стены. Название помещения не заменяет
                проверку координат стены и её стороны.
              </p>
              {draft.wallBases.map((base) => (
                <label
                  key={base.wall.id}
                  className="block space-y-2 text-[13px] text-ink-2"
                  htmlFor={`vertical-wall-${base.wall.id}`}
                >
                  <span className="block break-words">
                    {wallTitle(geometry, base.wall.id)}: А ({base.wall.start.xCm};{' '}
                    {base.wall.start.yCm}) → Б ({base.wall.end.xCm}; {base.wall.end.yCm}), см
                  </span>
                  <select
                    id={`vertical-wall-${base.wall.id}`}
                    className={selectClass}
                    value={base.floorId}
                    onChange={(event) =>
                      onChange({
                        ...draft,
                        wallBases: draft.wallBases.map((value) =>
                          value.wall.id === base.wall.id
                            ? { ...value, floorId: event.currentTarget.value }
                            : value,
                        ),
                      })
                    }
                  >
                    <option value="">Выберите пол основания</option>
                    {draft.floors.map((floor) => (
                      <option key={floor.id} value={floor.id}>
                        {floorTitle(floor.room)}
                      </option>
                    ))}
                  </select>
                </label>
              ))}
            </section>
            <section
              className="space-y-3 border-t border-line pt-3"
              aria-label="Отметки верха порогов"
            >
              <h3 className="text-sm font-medium text-ink">Верх порога — отдельная отметка</h3>
              <p className="text-xs leading-relaxed text-ink-2">
                Пары ниже получены из актуальных связей граней проёмов. Это не нижняя грань проёма и
                не подоконник. Пустое поле — порог неизвестен, не 0.
              </p>
              {draft.thresholds.map((threshold) => (
                <div key={threshold.id} className="space-y-2">
                  <p className="break-words text-xs text-ink-2">
                    {threshold.bindings
                      .map((opening) => {
                        const owner = draft.wallBases.find(
                          (base) => base.wall.id === opening.wallId,
                        )?.floorId
                        const floor = draft.floors.find((value) => value.id === owner)
                        return `${openingTitle(geometry, opening.id)}; ${floor ? floorTitle(floor.room) : 'пол стороны не выбран'}`
                      })
                      .join(' ↔ ')}
                  </p>
                  <Input
                    id={`vertical-threshold-${threshold.id}`}
                    label="Отметка верха порога от общего нуля, см"
                    inputMode="decimal"
                    value={threshold.elevation}
                    onChange={(event) =>
                      onChange({
                        ...draft,
                        thresholds: draft.thresholds.map((value) =>
                          value.id === threshold.id
                            ? { ...value, elevation: event.currentTarget.value }
                            : value,
                        ),
                      })
                    }
                  />
                </div>
              ))}
              {!draft.thresholds.length ? (
                <p className="text-xs text-ink-2">
                  Актуальных однозначных пар проёмов для привязки порога нет. Не создаём их по
                  предположению.
                </p>
              ) : null}
            </section>
            {preview && !preview.ok ? (
              <p className="text-xs leading-relaxed text-ink-2" role="status">
                {preview.error}
              </p>
            ) : null}
            <label className="flex items-start gap-3 text-xs leading-relaxed text-ink-2">
              <input
                type="checkbox"
                className="mt-0.5 h-4 w-4 shrink-0 accent-accent"
                disabled={!preview?.ok}
                checked={acknowledged && Boolean(preview?.ok)}
                onChange={(event) => onAcknowledge(event.currentTarget.checked)}
              />
              Я сверил общий ноль, поверхности, отметки и владельцев по указанному источнику для
              этих контуров. Это подтверждение пользователя, не автоматический обмер сервиса.
            </label>
          </fieldset>
          <p className="text-xs leading-relaxed text-ink-2">
            Отметки будут отправлены на серверную проверку при сохранении черновика или схемы.
            Изменение данных снимает эту сверку.
          </p>
          <Button variant="ghost" size="sm" disabled={pending} onClick={onCancel}>
            Отменить редактирование отсчёта
          </Button>
        </div>
      ) : (
        <div className="flex flex-wrap gap-2">
          {startError ? (
            <p className="w-full text-xs text-ink-2" role="status">
              {startError}
            </p>
          ) : null}
          <Button
            variant="secondary"
            size="sm"
            disabled={pending || Boolean(startError)}
            onClick={onStart}
          >
            {stored
              ? 'Изменить отсчёт и отметки'
              : hasStored
                ? 'Сверить отсчёт заново'
                : 'Ввести общий отсчёт и отметки'}
          </Button>
          {hasStored ? (
            <Button variant="ghost" size="sm" disabled={pending} onClick={onRemove}>
              Подготовить снятие отсчёта
            </Button>
          ) : null}
        </div>
      )}
    </details>
  )
}
