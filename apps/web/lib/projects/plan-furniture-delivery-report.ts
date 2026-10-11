import type { PlanGeometry } from '@uyut/db'
import { inspectFurnitureDeliveryViaStairs } from './plan-furniture-delivery'

type DeliveryArguments = Parameters<typeof inspectFurnitureDeliveryViaStairs>
export type FurnitureDeliveryReportRequest = {
  survey: DeliveryArguments[1]
  profile: DeliveryArguments[2]
  targetRoomId: DeliveryArguments[3]
  accessInput?: DeliveryArguments[4]
}

/** A downloadable snapshot, never an imported certificate or an instruction to bypass checking. */
export function serializeFurnitureDeliveryReport(
  geometry: PlanGeometry,
  request: FurnitureDeliveryReportRequest,
): { text?: string; error?: string } {
  try {
    const response = inspectFurnitureDeliveryViaStairs(
      geometry,
      request.survey,
      request.profile,
      request.targetRoomId,
      request.accessInput,
    )
    if (response.error || !response.result) {
      return { error: response.error ?? 'Полный маршрут не подтверждён; отчёт не выгружен.' }
    }
    const text = JSON.stringify(
      {
        kind: 'domitsa-furniture-delivery-report',
        version: 1,
        units: 'cm',
        coordinateSystem: 'X вправо, Y вниз, Z от сверенного общего нуля',
        limitations: [
          'Это снимок повторной геометрической проверки по указанным обмерам, не гарантия доставки.',
          'Не загружайте отчёт как подтверждение. При изменении схемы, обмеров или мебели нужен новый расчёт.',
          'Подход до обмеренной наружной площадки, люди, масса, усилия и удержание дверей не проверены.',
          'Точки пути не заменяют проверенные объёмы движений. Наклоны и повороты описаны этапами лестницы.',
        ],
        scope: {
          completeRoute: true,
          exteriorChecked: response.result.exteriorChecked === true,
          leavesChecked: response.result.leavesChecked === true,
        },
        geometry,
        request,
        result: response.result,
        notes: response.notes,
      },
      null,
      2,
    )
    if (new TextEncoder().encode(text).byteLength > 8 * 1024 * 1024) {
      return { error: 'Отчёт больше 8 МБ; выгрузка остановлена. Сохраните обмеры отдельно.' }
    }
    return { text }
  } catch {
    return { error: 'Не удалось повторно проверить или выгрузить полный маршрут.' }
  }
}
