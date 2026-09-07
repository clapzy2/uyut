import { Skeleton, SkeletonScreen } from '@uyut/ui'

const rows = [0, 1, 2]

export default function ProjectsLoading() {
  return (
    <SkeletonScreen
      label="Загружаем проекты"
      className="mx-auto max-w-6xl px-5 py-12 sm:px-8 sm:py-16 lg:py-20"
    >
      <div className="flex flex-wrap items-end justify-between gap-4">
        <Skeleton className="h-[46px] w-52 sm:h-[56px]" />
        <Skeleton className="h-11 w-40" />
      </div>
      <ul className="mt-10 border-t border-line">
        {rows.map((row) => (
          <li key={row} className="border-b border-line">
            <div className="grid grid-cols-[64px_1fr] items-center gap-4 py-5 sm:grid-cols-[96px_1fr] sm:gap-6 sm:py-6">
              <Skeleton className="aspect-[4/3]" />
              <div className="flex flex-col gap-2.5">
                <Skeleton className="h-6 w-2/3 sm:h-7" />
                <Skeleton className="h-4 w-1/2" />
              </div>
            </div>
          </li>
        ))}
      </ul>
    </SkeletonScreen>
  )
}
