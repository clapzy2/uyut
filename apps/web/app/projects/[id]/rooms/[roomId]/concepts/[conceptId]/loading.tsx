import { Skeleton, SkeletonScreen } from '@uyut/ui'

const matches = [0, 1, 2]

export default function ConceptLoading() {
  return (
    <SkeletonScreen
      label="Загружаем концепт"
      className="mx-auto max-w-6xl px-5 py-10 sm:px-8 sm:py-14 lg:py-16"
    >
      <Skeleton className="h-4 w-52" />
      <Skeleton className="mt-5 h-[38px] w-52 sm:h-[48px]" />
      <div className="mt-8 grid gap-8 lg:grid-cols-[7fr_5fr] lg:gap-12">
        <div className="flex flex-col gap-4">
          <Skeleton className="aspect-[16/10] w-full" />
          <Skeleton className="h-4 w-3/4" />
          <Skeleton className="h-24 w-full" />
        </div>
        <div className="flex flex-col gap-4">
          <Skeleton className="h-7 w-48" />
          <ul className="flex flex-col gap-3">
            {matches.map((match) => (
              <li key={match} className="flex items-center gap-3">
                <Skeleton className="h-16 w-16 shrink-0" />
                <div className="flex min-w-0 flex-1 flex-col gap-2">
                  <Skeleton className="h-5 w-2/3" />
                  <Skeleton className="h-4 w-1/3" />
                </div>
              </li>
            ))}
          </ul>
        </div>
      </div>
    </SkeletonScreen>
  )
}
