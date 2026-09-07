import { Skeleton, SkeletonScreen } from '@uyut/ui'

const rooms = [0, 1, 2]

export default function ProjectLoading() {
  return (
    <SkeletonScreen
      label="Загружаем проект"
      className="mx-auto max-w-6xl px-5 py-10 sm:px-8 sm:py-14 lg:py-20"
    >
      <Skeleton className="h-4 w-24" />
      <div className="mt-5 flex flex-wrap items-end justify-between gap-4">
        <div className="flex flex-col gap-3">
          <Skeleton className="h-[46px] w-64 sm:h-[56px]" />
          <Skeleton className="h-4 w-44" />
        </div>
        <Skeleton className="h-11 w-28" />
      </div>
      <div className="mt-10 grid gap-10 lg:grid-cols-[5fr_7fr] lg:gap-14">
        <div>
          <Skeleton className="h-3 w-16" />
          <Skeleton className="mt-3 aspect-[4/3] w-full" />
        </div>
        <div>
          <Skeleton className="h-3 w-20" />
          <ul className="mt-3 border-t border-line">
            {rooms.map((room) => (
              <li
                key={room}
                className="flex items-baseline justify-between gap-4 border-b border-line py-4"
              >
                <Skeleton className="h-6 w-40" />
                <Skeleton className="h-4 w-24" />
              </li>
            ))}
          </ul>
        </div>
      </div>
    </SkeletonScreen>
  )
}
