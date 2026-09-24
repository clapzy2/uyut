'use client'

import { Button, Input, toast } from '@uyut/ui'
import { useRouter } from 'next/navigation'
import { useState, useTransition } from 'react'
import { startManualPlanGeometry } from '@/actions/projects'
import { FormError } from '@/components/form-error'

export function ManualPlanGeometryStart({ projectId }: { projectId: string }) {
  const router = useRouter()
  const [width, setWidth] = useState('')
  const [height, setHeight] = useState('')
  const [error, setError] = useState<string>()
  const [saving, startSaving] = useTransition()

  function start() {
    setError(undefined)
    startSaving(async () => {
      const result = await startManualPlanGeometry(projectId, {
        widthCm: Number(width),
        heightCm: Number(height),
      })
      if (!result.ok) {
        setError(result.error)
        return
      }
      toast({ title: 'Пустой черновик 2D-схемы создан', tone: 'success' })
      router.refresh()
    })
  }

  return (
    <section className="mt-12 border-t border-line pt-8">
      <p className="text-[11px] font-medium uppercase tracking-[0.12em] text-ink-2">
        2D-схема · без генерации
      </p>
      <h2 className="mt-2 font-serif text-3xl text-ink">Начать ручной чертёж</h2>
      <p className="mt-3 max-w-2xl text-[14px] leading-relaxed text-ink-2">
        Введите габариты полотна по своему плану. Мы создадим только пустую координатную сетку —
        стены, двери и контуры комнат нужно будет отметить вручную. За это не списываются деньги на
        AI. Не используйте общую площадь как ширину или длину квартиры.
      </p>
      <div className="mt-5 flex flex-wrap items-end gap-3">
        <div className="w-44">
          <Input
            id="manual-plan-width"
            label="Ширина плана, см"
            type="number"
            min="100"
            max="5000"
            step="1"
            value={width}
            onChange={(event) => setWidth(event.currentTarget.value)}
          />
        </div>
        <div className="w-44">
          <Input
            id="manual-plan-height"
            label="Высота плана, см"
            type="number"
            min="100"
            max="5000"
            step="1"
            value={height}
            onChange={(event) => setHeight(event.currentTarget.value)}
          />
        </div>
        <Button type="button" onClick={start} pending={saving} disabled={!width || !height}>
          Создать пустой черновик
        </Button>
      </div>
      <FormError message={error} />
    </section>
  )
}
