import { Skeleton, SkeletonScreen } from '@uyut/ui'

const thumbs = [0, 1, 2, 3]

export default function RoomLoading() {
  return (
    <SkeletonScreen
      label="Загружаем комнату"
      className="mx-auto max-w-6xl px-5 py-10 sm:px-8 sm:py-14 lg:py-20"
    >
      <Skeleton className="h-4 w-36" />
      <div className="mt-5 flex flex-wrap items-end justify-between gap-4">
        <div className="flex flex-col gap-3">
          <Skeleton className="h-[46px] w-56 sm:h-[56px]" />
          <Skeleton className="h-4 w-40" />
        </div>
        <Skeleton className="h-11 w-28" />
      </div>
      <div className="mt-10 grid gap-10 lg:grid-cols-[7fr_5fr] lg:gap-14">
        <div>
          <Skeleton className="h-3 w-12" />
          <Skeleton className="mt-3 aspect-[3/2] w-full" />
        </div>
        <div className="flex flex-col gap-10">
          <div className="flex flex-col gap-3">
            <Skeleton className="h-3 w-20" />
            <Skeleton className="h-28 w-full" />
          </div>
          <div>
            <Skeleton className="h-3 w-24" />
            <Skeleton className="mt-3 aspect-[4/3] w-full" />
            <div className="mt-4 grid grid-cols-2 gap-3">
              {thumbs.map((thumb) => (
                <Skeleton key={thumb} className="aspect-[4/3]" />
              ))}
            </div>
          </div>
        </div>
      </div>
    </SkeletonScreen>
  )
}
