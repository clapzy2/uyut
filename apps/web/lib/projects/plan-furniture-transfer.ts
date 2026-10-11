import { signedElevationSum, signedPlanFloors } from '@uyut/catalog/plan-vertical-floor-geometry'
import type { PlanGeometry } from '@uyut/db'
import { z } from 'zod'
import { inspectPdfClearanceRoutes } from './plan-pdf-clearance-route'

const requestSchema = z
  .object({
    widthCm: z.number().finite().positive().max(1000),
    depthCm: z.number().finite().positive().max(1000),
    heightCm: z.number().finite().positive().max(600),
    clearanceCm: z.number().finite().min(0).max(100),
    orientation: z.union([z.literal(0), z.literal(90)]),
    allowTurns: z.boolean().optional(),
    acknowledged: z.literal(true),
  })
  .strict()

/** Upright rigid envelope translation only. This does not certify a physical delivery or lifting. */
export function inspectFurnitureTransfer(
  geometry: PlanGeometry,
  input: unknown,
): {
  error?: string
  notes: string[]
  profile?: z.infer<typeof requestSchema>
  inspection?: ReturnType<typeof inspectPdfClearanceRoutes>
} {
  const notes = [
    'Проверяется только неподвижная ориентация жёсткого габарита на одном чистовом уровне. Повороты, наклон, подъём, упаковка сверх введённых размеров, вес и места для людей не учтены.',
    'Старт находится внутри комнаты. Мерки начального проёма учитываются, но сам проход снаружи и зоны открывания дверей требуют отдельной проверки. Отсутствие построенного пути не доказывает невозможность доставки.',
    'Учитываются стены, шахты, записанные неподвижные препятствия и кухонные модули. Другая подвижная мебель и люди не включены в этот расчёт.',
  ]
  const parsed = requestSchema.safeParse(input)
  if (!parsed.success)
    return {
      error:
        'Введите все мерки переносимого габарита, явный запас и подтвердите сверку. Ширина и глубина до 1000 см, высота до 600 см, запас от 0 до 100 см.',
      notes,
    }
  const signed = signedPlanFloors(geometry)
  if (!signed?.ok)
    return {
      error:
        signed && !signed.ok
          ? signed.error
          : 'Нужен подтверждённый общий отсчёт и чистовые уровни пола; неизвестные отметки не заменяются нулём.',
      notes,
    }
  if (!geometry.pdfCalibration)
    return {
      error:
        'Для межкомнатного переноса нужны сверенные исходные грани проёмов и порогов. Осевые стены без двухсторонней привязки здесь не подменяют эти данные.',
      notes,
    }
  const profile = parsed.data
  if (profile.allowTurns)
    notes[0] =
      'Разрешены повороты на 90° на месте: вся область поворота проверяется консервативным квадратом, покрывающим вращение габарита с запасом. Наклон, подъём, вес и места для людей не учтены; отказ такой проверки не доказывает невозможность манёвра.'
  const margin = signedElevationSum(profile.clearanceCm, profile.clearanceCm)
  const width = profile.orientation === 0 ? profile.widthCm : profile.depthCm
  const depth = profile.orientation === 0 ? profile.depthCm : profile.widthCm
  const inspection = inspectPdfClearanceRoutes(geometry, {
    widthCm: signedElevationSum(width, margin),
    depthCm: signedElevationSum(depth, margin),
    heightCm: signedElevationSum(profile.heightCm, profile.clearanceCm),
    ...(profile.allowTurns ? { allowQuarterTurns: true } : {}),
  })
  return { profile, inspection, notes }
}
