import type { PlanRoomShape } from '@uyut/db'
import { missingManualSourceRooms } from '@/lib/projects/manual-plan-geometry'

export function PlanSourceRoomCoverage({
  rooms,
  roomReadings,
  sourceRooms,
}: {
  rooms: readonly PlanRoomShape[]
  roomReadings: readonly { name: string; sourceNumber?: number }[]
  sourceRooms: readonly { name: string; sourceNumber: number }[]
}) {
  const missing = missingManualSourceRooms(rooms, roomReadings, sourceRooms)
  if (!missing.length) return null
  return (
    <div className="mt-4 border-l-2 border-accent pl-4 text-[13px] leading-relaxed text-ink-2">
      <p className="font-medium text-ink">
        По исходному листу: {sourceRooms.length - missing.length} из {sourceRooms.length} помещений
        с контурами.
      </p>
      <ul className="mt-2 space-y-1 text-ink">
        {missing.map((room) => (
          <li key={room.sourceNumber}>
            №{String(room.sourceNumber).padStart(2, '0')} · {room.name} —{' '}
            {room.missingFromReading
              ? 'добавьте в блок «Данные с чертежа», затем разметьте контур по обмеру'
              : 'разметьте контур по исходному обмеру'}
            .
          </li>
        ))}
      </ul>
      <p className="mt-2">
        Черновик можно сохранить. Всю квартиру подтвердим после сверки этих помещений.
      </p>
    </div>
  )
}
