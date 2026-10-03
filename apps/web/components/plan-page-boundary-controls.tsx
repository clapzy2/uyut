'use client'

import type { PlanPageContours } from '@uyut/db'
import { Button, inputClassName } from '@uyut/ui'

export type PageBoundaryKind = 'exterior' | 'floor'

export function PlanPageBoundaryControls({
  exterior,
  floor,
  editing,
  disabled,
  onEdit,
  onRemove,
  onRole,
}: {
  exterior: PlanPageContours['exterior']
  floor: PlanPageContours['floor']
  editing: PageBoundaryKind | undefined
  disabled: boolean
  onEdit: (kind: PageBoundaryKind) => void
  onRemove: (kind: PageBoundaryKind) => void
  onRole: (role: 'floor' | 'outer-wall-envelope' | '') => void
}) {
  return (
    <div className="space-y-4">
      <div className="space-y-2 border-l-2 border-teal-600 pl-3 text-sm">
        <p className="font-medium text-ink">Внешняя граница квартиры</p>
        <p className="max-w-2xl text-xs leading-relaxed text-ink-2">
          Обведите явно видимую линию исходного листа и укажите её назначение. Наружная сторона стен
          и внутренняя граница пола сохраняются отдельно.
        </p>
        <div className="flex flex-wrap gap-2">
          <Button
            size="sm"
            variant={editing === 'exterior' ? 'secondary' : 'ghost'}
            disabled={disabled}
            aria-pressed={editing === 'exterior'}
            onClick={() => onEdit('exterior')}
          >
            {editing === 'exterior'
              ? 'Вернуться к комнате'
              : exterior
                ? 'Изменить границу'
                : 'Добавить границу'}
          </Button>
          <Button
            size="sm"
            variant="ghost"
            disabled={disabled || !exterior}
            onClick={() => onRemove('exterior')}
          >
            Удалить границу
          </Button>
        </div>
        {editing === 'exterior' ? (
          <label className="block max-w-sm space-y-1 text-xs">
            <span className="block">Что обозначает линия на исходном листе</span>
            <select
              className={inputClassName}
              value={exterior?.boundaryRole ?? ''}
              disabled={disabled}
              onChange={(event) =>
                onRole(event.currentTarget.value as 'floor' | 'outer-wall-envelope' | '')
              }
            >
              <option value="">Выберите после сверки листа</option>
              <option value="floor">Внутренняя граница пола</option>
              <option value="outer-wall-envelope">Наружная сторона стен</option>
            </select>
          </label>
        ) : exterior?.boundaryRole ? (
          <p className="text-xs text-ink-2">
            Выбранный тип:{' '}
            {exterior.boundaryRole === 'floor' ? 'граница пола' : 'наружная сторона стен'}.
          </p>
        ) : null}
      </div>
      {exterior?.boundaryRole === 'outer-wall-envelope' || floor ? (
        <div className="space-y-2 border-l-2 border-sky-700 pl-3 text-sm">
          <p className="font-medium text-ink">Внутренняя граница пола</p>
          <p className="max-w-2xl text-xs leading-relaxed text-ink-2">
            Отметьте отдельный контур доступного пола по узлам исходного PDF. Толщина стен не
            вычитается автоматически. Если линия неясна, оставьте её для сверки по обмеру; наружная
            граница и комнаты сохранятся.
          </p>
          <div className="flex flex-wrap gap-2">
            <Button
              size="sm"
              variant={editing === 'floor' ? 'secondary' : 'ghost'}
              disabled={disabled}
              aria-pressed={editing === 'floor'}
              onClick={() => onEdit('floor')}
            >
              {editing === 'floor'
                ? 'Вернуться к комнате'
                : floor
                  ? 'Изменить границу пола'
                  : 'Добавить границу пола'}
            </Button>
            <Button
              size="sm"
              variant="ghost"
              disabled={disabled || !floor}
              onClick={() => onRemove('floor')}
            >
              Удалить границу пола
            </Button>
          </div>
          {floor ? (
            <p className="text-xs text-ink-2">
              Контур пола: {floor.polygon.length} вершин. Комнаты должны оставаться внутри него.
            </p>
          ) : null}
          {exterior?.boundaryRole !== 'outer-wall-envelope' ? (
            <p role="status" className="text-xs text-danger">
              Отдельная граница пола относится к наружной стороне стен. Восстановите этот тип
              внешней границы или удалите отдельный контур пола.
            </p>
          ) : null}
        </div>
      ) : null}
    </div>
  )
}
