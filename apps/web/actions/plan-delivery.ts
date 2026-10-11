'use server'

import {
  canonicalPlanDeliveryJson,
  inspectStoredPlanDelivery,
  samePlanDeliveryGeometry,
} from '@uyut/catalog/plan-delivery-record'
import type { PlanGeometry, PlanReading } from '@uyut/db'
import { revalidatePath } from 'next/cache'
import { headers } from 'next/headers'
import type { ActionResult } from '@/actions/projects'
import { recordAudit } from '@/lib/audit'
import { AccessError, assertOwner, assertOwnerOrCollaborator } from '@/lib/projects/access'
import { PlanEditConflictError, planEditRevision } from '@/lib/projects/plan-edit-revision'
import {
  furnitureDeliveryDraftSchema,
  MAX_FURNITURE_DELIVERY_DRAFT_BYTES,
  parseFurnitureDeliveryDraft,
} from '@/lib/projects/plan-furniture-delivery-archive'
import { createFurnitureDeliveryRequest } from '@/lib/projects/plan-furniture-delivery-input'
import { serializeFurnitureDeliveryReport } from '@/lib/projects/plan-furniture-delivery-report'
import { setPlanReading } from '@/lib/projects/repository'
import { getSession } from '@/lib/session'

type Record = NonNullable<PlanReading['deliveryMeasurements']>

// The browser restores measurements and recomputes its own view. The large,
// server-checked report stays in the database for the PDF snapshot reader.
function clientRecord(record: Record): Record {
  return { version: record.version, savedAt: record.savedAt, draftJson: record.draftJson }
}

export async function savePlanDeliveryMeasurements(
  projectId: string,
  draftJson: string,
  expectedRevision: string,
  checked = false,
): Promise<ActionResult<{ revision: string; record: Record }>> {
  const session = await getSession()
  if (!session) return { ok: false, error: 'Сессия закончилась. Войдите снова.' }
  if (
    typeof checked !== 'boolean' ||
    typeof draftJson !== 'string' ||
    draftJson.length > MAX_FURNITURE_DELIVERY_DRAFT_BYTES ||
    new TextEncoder().encode(draftJson).byteLength > MAX_FURNITURE_DELIVERY_DRAFT_BYTES
  ) {
    return { ok: false, error: 'Неверный формат или размер обмеров заноса (до 2 МиБ).' }
  }
  try {
    const project = await assertOwner(session.user.id, projectId)
    if (expectedRevision !== planEditRevision(project.planUrl, project.planReading))
      throw new PlanEditConflictError()
    const before = project.planReading
    if (!before?.geometry) return { ok: false, error: 'Сначала сохраните актуальную 2D-схему.' }
    const parsed = furnitureDeliveryDraftSchema.safeParse(JSON.parse(draftJson))
    if (!parsed.success) return { ok: false, error: 'Неверный формат обмеров заноса.' }
    const draft = parsed.data
    const snapshot = JSON.parse(draft.geometryKey) as PlanGeometry
    if (!samePlanDeliveryGeometry(snapshot, before.geometry)) throw new PlanEditConflictError()
    // Solver snapshot keys preserve the original JSON order. Equality above proves freshness against JSONB.
    const imported = parseFurnitureDeliveryDraft(draftJson, snapshot, draft.profileFields)
    if (!imported.fields)
      return { ok: false, error: imported.error ?? 'Обмеры заноса не распознаны.' }
    const record: Record = { version: 1, savedAt: new Date().toISOString(), draftJson }
    if (checked) {
      const request = createFurnitureDeliveryRequest(
        snapshot,
        draft.profileFields,
        imported.fields,
        true,
      )
      const report = serializeFurnitureDeliveryReport(snapshot, request)
      if (!report.text)
        return { ok: false, error: report.error ?? 'Маршрут заноса не подтверждён.' }
      // Whole form linkage is written atomically with the freshly computed report; clients cannot submit a report.
      record.reportJson = JSON.stringify({
        ...JSON.parse(report.text),
        savedDraftKey: canonicalPlanDeliveryJson(draft),
      })
      if (new TextEncoder().encode(record.reportJson).byteLength > 8 * 1024 * 1024)
        return { ok: false, error: 'Отчёт заноса превышает 8 МиБ.' }
    }
    if (checked) {
      const presentation = inspectStoredPlanDelivery(before.geometry, record)
      if (presentation?.status !== 'checked') {
        return {
          ok: false,
          error:
            presentation?.status === 'held'
              ? presentation.warnings.join(' ')
              : 'Отчёт заноса не прошёл проверку сохранения.',
        }
      }
    }
    const reading: PlanReading = { ...before, deliveryMeasurements: record }
    await setPlanReading(session.user.id, projectId, reading, project)
    await recordAudit({
      action: 'project.delivery_measurements_saved',
      actorId: session.user.id,
      targetType: 'project',
      targetId: projectId,
      headers: await headers(),
      metadata: { checked },
    })
    revalidatePath(`/projects/${projectId}`)
    revalidatePath(`/projects/${projectId}/summary`)
    return {
      ok: true,
      data: { revision: planEditRevision(project.planUrl, reading), record: clientRecord(record) },
    }
  } catch (error) {
    if (error instanceof PlanEditConflictError)
      return { ok: false, error: error.message, code: 'plan-conflict' }
    if (error instanceof AccessError) return { ok: false, error: error.message }
    if (error instanceof SyntaxError)
      return { ok: false, error: 'Не удалось прочитать JSON обмеров заноса.' }
    console.error('save delivery measurements failed', error)
    return { ok: false, error: 'Не получилось сохранить обмеры заноса. Повторите проверку.' }
  }
}

export async function loadPlanDeliveryMeasurements(
  projectId: string,
): Promise<ActionResult<{ revision: string; record?: Record }>> {
  const session = await getSession()
  if (!session) return { ok: false, error: 'Сессия закончилась. Войдите снова.' }
  try {
    const project = await assertOwnerOrCollaborator(session.user.id, projectId)
    return {
      ok: true,
      data: {
        revision: planEditRevision(project.planUrl, project.planReading),
        ...(project.planReading?.deliveryMeasurements
          ? { record: clientRecord(project.planReading.deliveryMeasurements) }
          : {}),
      },
    }
  } catch (error) {
    if (error instanceof AccessError) return { ok: false, error: error.message }
    console.error('load delivery measurements failed', error)
    return { ok: false, error: 'Не получилось загрузить обмеры заноса.' }
  }
}
