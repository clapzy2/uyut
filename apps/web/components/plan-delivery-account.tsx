'use client'

import type { PlanGeometry } from '@uyut/db'
import { Button } from '@uyut/ui'
import { useRef, useState } from 'react'
import { loadPlanDeliveryMeasurements, savePlanDeliveryMeasurements } from '@/actions/plan-delivery'
import {
  type FurnitureDeliveryDraftFields,
  type FurnitureDeliveryProfileFields,
  furnitureDeliveryDraftSchema,
  MAX_FURNITURE_DELIVERY_DRAFT_BYTES,
  parseFurnitureDeliveryDraft,
  serializeFurnitureDeliveryDraft,
} from '@/lib/projects/plan-furniture-delivery-archive'

export type PlanDeliveryAccountContext = {
  projectId: string
  revision: string
  onRevisionChange: (revision: string) => void
}

export function PlanDeliveryAccount({
  account,
  geometry,
  profileFields,
  fields,
  canSaveChecked,
  onLoaded,
}: {
  account: PlanDeliveryAccountContext
  geometry: PlanGeometry
  profileFields: FurnitureDeliveryProfileFields
  fields: FurnitureDeliveryDraftFields
  canSaveChecked: boolean
  onLoaded: (profile: FurnitureDeliveryProfileFields, fields: FurnitureDeliveryDraftFields) => void
}) {
  const [busy, setBusy] = useState(false)
  const [notice, setNotice] = useState<string>()
  const [pending, setPending] = useState<{ text: string; revision: string; projectId: string }>()
  const latest = useRef({ account, geometry, profileFields, fields, onLoaded })
  latest.current = { account, geometry, profileFields, fields, onLoaded }
  const inFlight = useRef(false)

  async function save(checked: boolean) {
    if (inFlight.current || (checked && !canSaveChecked)) return
    inFlight.current = true
    setBusy(true)
    setNotice(undefined)
    const before = latest.current
    try {
      const text = serializeFurnitureDeliveryDraft(
        before.geometry,
        before.profileFields,
        before.fields,
      )
      const response = await savePlanDeliveryMeasurements(
        before.account.projectId,
        text,
        before.account.revision,
        checked,
      )
      if (latest.current.account.projectId !== before.account.projectId) return
      if (!response.ok) {
        setNotice(response.error)
        return
      }
      // Do not advance an editor that has received a different base while this request was in flight.
      if (latest.current.account.revision !== before.account.revision) {
        setNotice(
          'Снимок сохранён, но версия редактора изменилась. Обновите страницу перед следующей записью.',
        )
        return
      }
      latest.current.account.onRevisionChange(response.data.revision)
      setPending(undefined)
      const after = latest.current
      const changed =
        JSON.stringify([before.geometry, before.profileFields, before.fields]) !==
        JSON.stringify([after.geometry, after.profileFields, after.fields])
      setNotice(
        changed
          ? 'Сохранён прежний снимок обмеров. Текущие поля изменились: проверьте и сохраните их заново.'
          : checked
            ? 'Маршрут пересчитан на сервере и сохранён для следующего PDF. Уже скачанные PDF не обновляются.'
            : 'Черновик обмеров сохранён в аккаунте. Прежний проверенный маршрут заменён черновиком.',
      )
    } catch {
      if (latest.current.account.projectId === before.account.projectId)
        setNotice('Не получилось сохранить обмеры. Текущие поля не изменены.')
    } finally {
      inFlight.current = false
      setBusy(false)
    }
  }

  async function load() {
    if (inFlight.current) return
    inFlight.current = true
    setBusy(true)
    setNotice(undefined)
    setPending(undefined)
    const before = latest.current.account
    try {
      const response = await loadPlanDeliveryMeasurements(before.projectId)
      const context = latest.current
      if (context.account.projectId !== before.projectId) return
      if (!response.ok) {
        setNotice(response.error)
        return
      }
      if (response.data.revision !== context.account.revision) {
        setNotice(
          'Версия проекта изменилась. Обновите страницу: загрузка обмеров не заменяет свежую схему.',
        )
        return
      }
      if (!response.data.record) {
        setNotice('В аккаунте пока нет сохранённых обмеров заноса.')
        return
      }
      const text = response.data.record.draftJson
      if (new TextEncoder().encode(text).byteLength > MAX_FURNITURE_DELIVERY_DRAFT_BYTES)
        throw new Error('Too large')
      const draft = furnitureDeliveryDraftSchema.parse(JSON.parse(text))
      const imported = parseFurnitureDeliveryDraft(text, context.geometry, draft.profileFields)
      if (!imported.fields) {
        setNotice(imported.error)
        return
      }
      setPending({ text, revision: response.data.revision, projectId: before.projectId })
      setNotice(
        'Обмеры найдены. Применение заменит габарит мебели и поля обмеров, снимет подтверждение и прежний путь.',
      )
    } catch {
      if (latest.current.account.projectId === before.projectId)
        setNotice('Не получилось загрузить обмеры. Текущие поля не изменены.')
    } finally {
      inFlight.current = false
      setBusy(false)
    }
  }

  function apply() {
    if (!pending) return
    const context = latest.current
    if (
      pending.projectId !== context.account.projectId ||
      pending.revision !== context.account.revision
    ) {
      setNotice('Версия проекта изменилась. Загрузите обмеры заново после обновления схемы.')
      return
    }
    const draft = furnitureDeliveryDraftSchema.parse(JSON.parse(pending.text))
    const imported = parseFurnitureDeliveryDraft(
      pending.text,
      context.geometry,
      draft.profileFields,
    )
    if (!imported.fields) {
      setNotice(imported.error)
      return
    }
    context.onLoaded(draft.profileFields, imported.fields)
    setPending(undefined)
    setNotice('Обмеры и габарит загружены без подтверждения. Сверьте их и пересчитайте маршрут.')
  }

  return (
    <section className="mt-3 border-t border-line pt-3" aria-label="Обмеры заноса в аккаунте">
      <div className="flex flex-wrap gap-3">
        <Button type="button" variant="secondary" disabled={busy} onClick={() => void save(false)}>
          Сохранить черновик в аккаунте
        </Button>
        <Button
          type="button"
          variant="secondary"
          disabled={busy || !canSaveChecked}
          onClick={() => void save(true)}
        >
          Пересчитать и сохранить маршрут для PDF
        </Button>
        <Button type="button" variant="secondary" disabled={busy} onClick={() => void load()}>
          Загрузить обмеры из аккаунта
        </Button>
      </div>
      <p className="mt-2 text-xs leading-relaxed text-ink-2">
        Сначала сохраните изменения самой схемы. Черновик не подтверждает занос и заменяет прежний
        сохранённый маршрут. Для PDF нужен отдельный серверный пересчёт; устаревший маршрут не будет
        показан как проверенный. Смена полей на экране сама по себе не меняет запись в аккаунте.
      </p>
      {pending?.projectId === account.projectId ? (
        <Button type="button" variant="secondary" disabled={busy} className="mt-2" onClick={apply}>
          Заменить габарит и обмеры из аккаунта
        </Button>
      ) : null}
      {notice ? (
        <p className="mt-2 text-xs text-ink-2" role="status">
          {notice}
        </p>
      ) : null}
    </section>
  )
}
