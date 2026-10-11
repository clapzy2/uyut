import { signedElevationSum, signedPlanFloors } from '@uyut/catalog/plan-vertical-floor-geometry'
import type { PlanGeometry } from '@uyut/db'
import { z } from 'zod'
import { type FurnitureManeuverResult, furnitureManeuverEnvelope } from './plan-furniture-maneuver'
import { inspectPdfClearanceRoutes } from './plan-pdf-clearance-route'
import { enclosingDecimalSum } from './plan-transfer-enclosure'

const requestSchema = z
  .object({
    widthCm: z.number().finite().positive().max(1000),
    depthCm: z.number().finite().positive().max(1000),
    heightCm: z.number().finite().positive().max(600),
    clearanceCm: z.number().finite().min(0).max(100),
    orientation: z.union([z.literal(0), z.literal(90)]),
    allowTurns: z.boolean().optional(),
    maneuver: z
      .object({
        carryElevationCm: z.number().finite().min(-600).max(1200),
        tilt: z.enum(['none', 'width', 'depth']),
        angleDeg: z.number().finite().min(0).max(90).optional(),
      })
      .strict()
      .refine(
        (value) => value.tilt !== 'none' || value.angleDeg === undefined || value.angleDeg === 0,
      )
      .optional(),
    acknowledged: z.literal(true),
  })
  .strict()

/** Conservative box maneuver geometry, never a certificate of physical delivery or human lifting. */
export function inspectFurnitureTransfer(
  geometry: PlanGeometry,
  input: unknown,
): {
  error?: string
  notes: string[]
  profile?: z.infer<typeof requestSchema>
  inspection?: ReturnType<typeof inspectPdfClearanceRoutes>
  maneuver?: FurnitureManeuverResult
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
        'Введите все мерки переносимого габарита, явный запас и подтвердите сверку. Ширина и глубина до 1000 см, высота до 600 см, запас от 0 до 100 см. Для подъёма задайте общую отметку от −600 до 1200 см и положение переноса.',
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
  if (profile.maneuver) {
    const envelope = furnitureManeuverEnvelope(
      geometry,
      {
        widthCm: enclosingDecimalSum([profile.widthCm, profile.clearanceCm, profile.clearanceCm]),
        depthCm: enclosingDecimalSum([profile.depthCm, profile.clearanceCm, profile.clearanceCm]),
        heightCm: enclosingDecimalSum(
          profile.maneuver.tilt === 'none' || profile.maneuver.angleDeg === 0
            ? [profile.heightCm, profile.clearanceCm]
            : [profile.heightCm, profile.clearanceCm, profile.clearanceCm],
        ),
      },
      profile.maneuver,
      profile.orientation,
      profile.allowTurns === true,
    )
    if (!envelope)
      return { profile, error: 'Не удалось подтвердить область полного подъёма и наклона.', notes }
    notes[0] =
      'Проверяется предписанный перенос на одной абсолютной отметке над подтверждёнными полами и верхом порога. Подъём и опускание выполняются целиком внутри одной комнаты; наклон в одном выбранном сечении от 0° до заданного угла (не более 90°), с неизменным центром по X/Y и постоянной нижней границей, с вертикальным перемещением центра. Вся область наклона консервативно ограждена полным диагональным квадратом, а конечная поза рассчитана для введённого угла. Отказ не доказывает невозможность другого манёвра. Лестничные марши здесь, составные наклоны, вес, люди и физическая возможность подъёма не проверяются.'
    const inspection = inspectPdfClearanceRoutes(geometry, {
      ...envelope.carried,
      carryElevationCm: profile.maneuver.carryElevationCm,
      endpointCheck: envelope.endpointCheck,
      ...(profile.allowTurns ? { allowQuarterTurns: true } : {}),
    })
    if (inspection.result?.reason === 'entry-footprint')
      notes.push(
        'В стартовой зоне не подтверждён весь габарит подъёма или наклона. Нужна другая измеренная стартовая зона; меньшая конечная поза не заменяет эту проверку.',
      )
    return {
      profile,
      inspection,
      notes,
      maneuver: {
        ...profile.maneuver,
        carriedHeightCm: envelope.carried.heightCm,
        sweepHeightCm: envelope.sweepHeightCm,
        stages: envelope.stages(inspection.result?.routes ?? []),
      },
    }
  }
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
