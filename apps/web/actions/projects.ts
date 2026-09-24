'use server'

import { randomUUID } from 'node:crypto'
import {
  isManualPlanGeometryId,
  reconcilePlanGeometryRooms,
  validatePlanGeometryEdit,
} from '@uyut/ai'
import type { PlanReading, RoomMeasurements } from '@uyut/db'
import { revalidatePath } from 'next/cache'
import { headers } from 'next/headers'
import { recordAudit } from '@/lib/audit'
import { canCreateProject, PROJECT_LIMIT } from '@/lib/billing/repository'
import { preparePlan, UploadError } from '@/lib/files/uploads'
import { AccessError, assertOwner } from '@/lib/projects/access'
import { openingClearancesSchema } from '@/lib/projects/clearance-zones'
import { planDimensionSources } from '@/lib/projects/dimension-sources'
import { roomKindLabels } from '@/lib/projects/format'
import { kitchenItemsSchema } from '@/lib/projects/kitchen-items'
import { kitchenSafetySchema } from '@/lib/projects/kitchen-safety'
import { manualPlanGeometry, manualRoomNamesValid } from '@/lib/projects/manual-plan-geometry'
import { planObstaclesSchema } from '@/lib/projects/plan-obstacles'
import { PlanReadError, readPlanFromStorage } from '@/lib/projects/plan-reading'
import * as repository from '@/lib/projects/repository'
import { getSession } from '@/lib/session'
import { deleteObject, putObject } from '@/lib/storage'
import {
  createProjectSchema,
  planRoomsSchema,
  projectIdSchema,
  projectSettingsSchema,
} from '@/lib/validation/projects'

export type ActionResult<T = undefined> = { ok: true; data: T } | { ok: false; error: string }

const SESSION_EXPIRED = 'Сессия закончилась. Войдите снова.'
const GENERIC = 'Не получилось. Попробуйте ещё раз, а если повторится, напишите нам.'

async function currentUserId(): Promise<string | null> {
  const session = await getSession()
  return session?.user.id ?? null
}

function failure(error: unknown): { ok: false; error: string } {
  if (
    error instanceof AccessError ||
    error instanceof UploadError ||
    error instanceof PlanReadError
  ) {
    return { ok: false, error: error.message }
  }
  console.error(error)
  return { ok: false, error: GENERIC }
}

export async function createProject(input: unknown): Promise<ActionResult<{ id: string }>> {
  const userId = await currentUserId()
  if (!userId) {
    return { ok: false, error: SESSION_EXPIRED }
  }
  const parsed = createProjectSchema.safeParse(input)
  if (!parsed.success) {
    return { ok: false, error: parsed.error.issues[0]?.message ?? 'Проверьте поля формы' }
  }
  try {
    if (!(await canCreateProject(userId))) {
      return { ok: false, error: PROJECT_LIMIT }
    }
    const project = await repository.createProject(userId, parsed.data)
    await recordAudit({
      action: 'project.created',
      actorId: userId,
      targetType: 'project',
      targetId: project.id,
      headers: await headers(),
    })
    revalidatePath('/projects')
    return { ok: true, data: { id: project.id } }
  } catch (error) {
    return failure(error)
  }
}

export async function updateProject(projectId: string, input: unknown): Promise<ActionResult> {
  const userId = await currentUserId()
  if (!userId) {
    return { ok: false, error: SESSION_EXPIRED }
  }
  const id = projectIdSchema.safeParse(projectId)
  const parsed = projectSettingsSchema.safeParse(input)
  if (!id.success) {
    return { ok: false, error: 'Проект не найден' }
  }
  if (!parsed.success) {
    return { ok: false, error: parsed.error.issues[0]?.message ?? 'Проверьте поля формы' }
  }
  try {
    await repository.updateProject(userId, id.data, parsed.data)
    revalidatePath('/projects')
    revalidatePath(`/projects/${id.data}`)
    return { ok: true, data: undefined }
  } catch (error) {
    return failure(error)
  }
}

export async function deleteProject(projectId: string): Promise<ActionResult> {
  const userId = await currentUserId()
  if (!userId) {
    return { ok: false, error: SESSION_EXPIRED }
  }
  try {
    const { fileKeys } = await repository.deleteProject(userId, projectId)
    await Promise.all(fileKeys.map((key) => deleteObject(key).catch(() => undefined)))
    await recordAudit({
      action: 'project.deleted',
      actorId: userId,
      targetType: 'project',
      targetId: projectId,
      headers: await headers(),
    })
    revalidatePath('/projects')
    return { ok: true, data: undefined }
  } catch (error) {
    return failure(error)
  }
}

export async function uploadPlan(projectId: string, formData: FormData): Promise<ActionResult> {
  const userId = await currentUserId()
  if (!userId) {
    return { ok: false, error: SESSION_EXPIRED }
  }
  const file = formData.get('plan')
  if (!(file instanceof File)) {
    return { ok: false, error: 'Выберите файл с планом.' }
  }
  try {
    await assertOwner(userId, projectId)
    // Проверяем и пересобираем файл до записи в хранилище, чтобы туда не попало ничего сырого
    const prepared = await preparePlan(file)
    const key = `projects/${projectId}/plan/${randomUUID()}.${prepared.extension}`
    await putObject(key, prepared.body, prepared.contentType)
    const { previousKey } = await repository.setProjectPlan(userId, projectId, key)
    if (previousKey) {
      await deleteObject(previousKey).catch(() => undefined)
    }
    revalidatePath('/projects')
    revalidatePath(`/projects/${projectId}`)
    return { ok: true, data: undefined }
  } catch (error) {
    return failure(error)
  }
}

/**
 * Прочитать размеры с загруженного плана.
 *
 * Ничего не создаёт: прочитанное ложится в проект и ждёт правки. Модель читает чертёж хорошо,
 * но «хорошо» — не «всегда», а ошибка в размере тихо испортит и расстановку, и смету.
 * Поэтому между чтением и комнатами стоит человек.
 */
export async function readPlan(projectId: string): Promise<ActionResult<PlanReading>> {
  const userId = await currentUserId()
  if (!userId) {
    return { ok: false, error: SESSION_EXPIRED }
  }
  try {
    const project = await assertOwner(userId, projectId)
    if (!project.planUrl) {
      return { ok: false, error: 'Сначала загрузите план квартиры.' }
    }
    const parsed = await readPlanFromStorage(project.planUrl)
    const reading: PlanReading = { ...parsed, readAt: new Date().toISOString() }
    await repository.setPlanReading(userId, projectId, reading)
    await recordAudit({
      action: 'project.plan_read',
      actorId: userId,
      targetType: 'project',
      targetId: projectId,
      headers: await headers(),
      metadata: { rooms: reading.rooms.length },
    })
    revalidatePath(`/projects/${projectId}`)
    return { ok: true, data: reading }
  } catch (error) {
    return failure(error)
  }
}

/** Забыть прочитанное: человек посмотрел и решил вписать всё сам. */
export async function forgetPlanReading(projectId: string): Promise<ActionResult> {
  const userId = await currentUserId()
  if (!userId) {
    return { ok: false, error: SESSION_EXPIRED }
  }
  try {
    await repository.setPlanReading(userId, projectId, null)
    revalidatePath(`/projects/${projectId}`)
    return { ok: true, data: undefined }
  } catch (error) {
    return failure(error)
  }
}

/** Пустое полотно для ручного обмера: размеры задаёт человек, линии не выдумываем. */
export async function startManualPlanGeometry(
  projectId: string,
  input: unknown,
): Promise<ActionResult<NonNullable<PlanReading['geometry']>>> {
  const userId = await currentUserId()
  if (!userId) return { ok: false, error: SESSION_EXPIRED }

  const geometry = manualPlanGeometry(input)
  if (!geometry) {
    return { ok: false, error: 'Укажите размеры полотна от 100 до 5000 см.' }
  }

  try {
    const project = await assertOwner(userId, projectId)
    if (!project.planUrl || !project.planReading?.confirmedAt) {
      return { ok: false, error: 'Сначала загрузите план и подтвердите список комнат.' }
    }
    if (project.planReading.geometry) {
      return { ok: false, error: '2D-схема уже создана. Обновите страницу.' }
    }

    await repository.setPlanReading(userId, projectId, {
      ...project.planReading,
      geometry,
    })
    revalidatePath(`/projects/${projectId}`)
    return { ok: true, data: geometry }
  } catch (error) {
    return failure(error)
  }
}

/** Сохранить ручную правку 2D-схемы и отметить её подтверждённой владельцем. */
export async function savePlanGeometry(
  projectId: string,
  input: unknown,
  mode: 'draft' | 'confirm' = 'confirm',
): Promise<ActionResult<NonNullable<PlanReading['geometry']>>> {
  const userId = await currentUserId()
  if (!userId) return { ok: false, error: SESSION_EXPIRED }
  if (mode !== 'draft' && mode !== 'confirm') {
    return { ok: false, error: 'Неизвестный режим сохранения схемы.' }
  }
  try {
    const project = await assertOwner(userId, projectId)
    const before = project.planReading?.geometry
    if (!project.planReading || !before) {
      return { ok: false, error: 'Сначала прочитайте план и постройте 2D-схему.' }
    }
    if (mode === 'draft' && before.status === 'confirmed') {
      return { ok: false, error: 'Подтверждённую схему нельзя вернуть в черновик.' }
    }
    const submitted = input && typeof input === 'object' ? (input as Record<string, unknown>) : {}
    const openingClearances = openingClearancesSchema.safeParse(submitted.openings ?? [])
    if (!openingClearances.success)
      return {
        ok: false,
        error: 'Проверьте свободные зоны дверей: глубина должна быть больше 0 и не больше 600 см.',
      }
    const kitchenSafety = kitchenSafetySchema.safeParse({
      routeWidthCm: submitted.routeWidthCm,
      routeStartOpeningId: submitted.routeStartOpeningId,
      utilityPoints: submitted.utilityPoints ?? before.utilityPoints ?? [],
    })
    if (
      !kitchenSafety.success ||
      kitchenSafety.data.utilityPoints.some(
        (point) => point.xCm > before.widthCm || point.yCm > before.heightCm,
      )
    )
      return {
        ok: false,
        error: 'Проверьте инженерные точки и ширину маршрута: они должны помещаться на схеме.',
      }
    const kitchenItems = kitchenItemsSchema.safeParse(
      submitted.kitchenItems ?? before.kitchenItems ?? [],
    )
    if (!kitchenItems.success)
      return {
        ok: false,
        error: 'Проверьте размеры кухонных элементов: от 10 до 600 см, координаты неотрицательные.',
      }
    const obstacles = planObstaclesSchema.safeParse(submitted.obstacles ?? before.obstacles ?? [])
    if (
      !obstacles.success ||
      obstacles.data.some(
        (item) =>
          item.xCm + item.widthCm > before.widthCm || item.yCm + item.depthCm > before.heightCm,
      )
    )
      return {
        ok: false,
        error: 'Проверьте препятствия: они должны иметь точные размеры и помещаться на схеме.',
      }
    // Габарит квартиры не редактируется: все ручные координаты обязаны остаться внутри
    // исходного полотна, построенного по загруженному плану.
    const geometry = validatePlanGeometryEdit({
      ...submitted,
      widthCm: before.widthCm,
      heightCm: before.heightCm,
    })
    if (!geometry) {
      return { ok: false, error: 'Схема не сохранилась: проверьте координаты стен.' }
    }
    if (
      kitchenSafety.data.routeStartOpeningId &&
      !geometry.openings.some(
        (opening) =>
          opening.id === kitchenSafety.data.routeStartOpeningId && opening.type !== 'window',
      )
    )
      return { ok: false, error: 'Выбранная стартовая дверь не найдена в схеме.' }
    const submittedWalls = Array.isArray(submitted.walls) ? submitted.walls.slice(0, 200).length : 0
    const submittedOpenings = Array.isArray(submitted.openings)
      ? submitted.openings.slice(0, 200).length
      : 0
    const submittedRooms = Array.isArray(submitted.rooms) ? submitted.rooms.slice(0, 50).length : 0
    if (
      geometry.walls.length !== submittedWalls ||
      geometry.openings.length !== submittedOpenings ||
      geometry.rooms.length !== submittedRooms
    ) {
      return {
        ok: false,
        error: 'Один из элементов имеет неверный размер или выходит за границы схемы.',
      }
    }
    // Новые элементы принимаем только с отдельным форматом ручного ID. Это не позволяет
    // подменить распознанный элемент и оставляет происхождение геометрии различимым.
    const wallIds = new Set(before.walls.map((wall) => wall.id))
    const openingIds = new Set(before.openings.map((opening) => opening.id))
    const obstacleIds = new Set((before.obstacles ?? []).map((obstacle) => obstacle.id))
    const manual = before.source === 'manual'
    if (
      geometry.walls.some((wall) => !wallIds.has(wall.id) && !isManualPlanGeometryId(wall.id)) ||
      geometry.openings.some(
        (opening) => !openingIds.has(opening.id) && !isManualPlanGeometryId(opening.id),
      ) ||
      obstacles.data.some(
        (obstacle) => !obstacleIds.has(obstacle.id) && !isManualPlanGeometryId(obstacle.id),
      ) ||
      (!manual &&
        (geometry.rooms.length !== before.rooms.length ||
          geometry.rooms.some((room, index) => room.name !== before.rooms[index]?.name)))
    ) {
      return { ok: false, error: 'В схеме появились неизвестные элементы. Обновите страницу.' }
    }
    if (manual) {
      if (
        !manualRoomNamesValid(
          geometry.rooms.map((room) => room.name),
          project.planReading.rooms.map((room) => room.name),
        )
      ) {
        return { ok: false, error: 'Контуры должны соответствовать комнатам из списка проекта.' }
      }
      if (mode === 'confirm' && geometry.rooms.length === 0) {
        return { ok: false, error: 'Добавьте и сверьте с планом хотя бы один контур комнаты.' }
      }
    }
    const checked = reconcilePlanGeometryRooms(geometry, project.planReading.rooms)
    if (!checked) return { ok: false, error: 'В схеме должно остаться не меньше трёх стен.' }
    if (checked.rooms.length !== geometry.rooms.length) {
      return {
        ok: false,
        error: 'Контур комнаты слишком сильно расходится с площадью, указанной на плане.',
      }
    }
    const saved: NonNullable<PlanReading['geometry']> = {
      ...checked,
      ...(manual ? { source: 'manual' as const } : {}),
      openings: checked.openings.map((opening) => {
        const submittedOpening = openingClearances.data.find((o) => o.id === opening.id)
        const clearance = submittedOpening?.clearance
        const sillHeightCm = submittedOpening?.sillHeightCm
        return {
          ...opening,
          ...(clearance && opening.type !== 'window' ? { clearance } : {}),
          ...(sillHeightCm !== undefined && opening.type === 'window' ? { sillHeightCm } : {}),
        }
      }),
      kitchenItems: kitchenItems.data,
      utilityPoints: kitchenSafety.data.utilityPoints,
      obstacles: obstacles.data,
      ...(kitchenSafety.data.routeWidthCm === undefined
        ? {}
        : { routeWidthCm: kitchenSafety.data.routeWidthCm }),
      ...(kitchenSafety.data.routeStartOpeningId
        ? { routeStartOpeningId: kitchenSafety.data.routeStartOpeningId }
        : {}),
      status: mode === 'draft' ? 'draft' : 'confirmed',
      ...(mode === 'confirm' ? { confirmedAt: new Date().toISOString() } : {}),
    }
    await repository.setPlanReading(userId, projectId, {
      ...project.planReading,
      geometry: saved,
    })
    await recordAudit({
      action:
        mode === 'draft' ? 'project.plan_geometry_drafted' : 'project.plan_geometry_confirmed',
      actorId: userId,
      targetType: 'project',
      targetId: projectId,
      headers: await headers(),
      metadata: {
        walls: saved.walls.length,
        openings: saved.openings.length,
        roomContours: saved.rooms.length,
        utilityPoints: saved.utilityPoints?.length ?? 0,
        obstacles: saved.obstacles?.length ?? 0,
      },
    })
    revalidatePath(`/projects/${projectId}`)
    return { ok: true, data: saved }
  } catch (error) {
    return failure(error)
  }
}

/**
 * Подтвердить прочитанное: отмеченные строки становятся комнатами с размерами.
 *
 * Правку человека сохраняем вместе с комнатами: по разнице между прочитанным и подтверждённым
 * видно, где чтение промахивается, а спросить об этом больше некого.
 */
export async function confirmPlanRooms(
  projectId: string,
  input: unknown,
): Promise<ActionResult<{ created: number; updated: number }>> {
  const userId = await currentUserId()
  if (!userId) {
    return { ok: false, error: SESSION_EXPIRED }
  }
  const parsed = planRoomsSchema.safeParse(input)
  if (!parsed.success) {
    return { ok: false, error: parsed.error.issues[0]?.message ?? 'Проверьте размеры' }
  }
  const { ceilingCm, condition, rooms } = parsed.data
  const chosen = rooms.filter((room) => room.include)
  if (chosen.length === 0) {
    return { ok: false, error: 'Отметьте хотя бы одну комнату.' }
  }
  try {
    const project = await assertOwner(userId, projectId)
    const reading: PlanReading = {
      ...(ceilingCm === null ? {} : { ceilingCm }),
      // Общую площадь человек не правит, но она остаётся частью записи о том, что было прочитано
      ...(project.planReading?.totalAreaM2 === undefined
        ? {}
        : { totalAreaM2: project.planReading.totalAreaM2 }),
      ...(project.planReading?.geometry === undefined
        ? {}
        : { geometry: project.planReading.geometry }),
      rooms: rooms.map((room) => ({
        dimensionSources: planDimensionSources(
          room,
          project.planReading?.rooms ?? [],
          Boolean(project.planReading?.confirmedAt),
        ),
        name: room.name || roomKindLabels[room.kind],
        kind: room.kind,
        ...(room.widthCm === null ? {} : { widthCm: room.widthCm }),
        ...(room.depthCm === null ? {} : { depthCm: room.depthCm }),
        ...(room.areaM2 === null ? {} : { areaM2: room.areaM2 }),
        ...(room.layoutNotes === undefined ? {} : { layoutNotes: room.layoutNotes }),
      })),
      readAt: project.planReading?.readAt ?? new Date().toISOString(),
      confirmedAt: new Date().toISOString(),
    }
    const saved = await repository.createRoomsFromPlan(userId, projectId, {
      reading,
      rooms: chosen.map((room) => {
        const measurements: RoomMeasurements = {
          dimensionSources: planDimensionSources(
            room,
            project.planReading?.rooms ?? [],
            Boolean(project.planReading?.confirmedAt),
          ),
          ...(room.layoutNotes === undefined ? {} : { layoutNotes: room.layoutNotes }),
          ...(ceilingCm === null ? {} : { ceilingCm }),
          ...(room.widthCm === null ? {} : { widthCm: room.widthCm }),
          ...(room.depthCm === null ? {} : { depthCm: room.depthCm }),
        }
        return {
          ...(room.roomId ? { roomId: room.roomId } : {}),
          condition,
          kind: room.kind,
          name: room.name || roomKindLabels[room.kind],
          areaM2: room.areaM2,
          measurements: Object.keys(measurements).length > 0 ? measurements : null,
          notes: room.wish || null,
        }
      }),
    })
    await recordAudit({
      action: 'project.plan_rooms',
      actorId: userId,
      targetType: 'project',
      targetId: projectId,
      headers: await headers(),
      metadata: saved,
    })
    revalidatePath('/projects')
    revalidatePath(`/projects/${projectId}`)
    return { ok: true, data: saved }
  } catch (error) {
    return failure(error)
  }
}
