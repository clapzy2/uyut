import { Skeleton, SkeletonScreen } from '@uyut/ui'

const items = [0, 1, 2]
const lines = [0, 1, 2, 3]

export default function SummaryLoading() {
  return (
    <SkeletonScreen
      label="Загружаем итоги проекта"
      className="mx-auto max-w-6xl px-5 py-10 sm:px-8 sm:py-14 lg:py-16"
    >
      <Skeleton className="h-4 w-36" />
      <div className="mt-5 flex flex-wrap items-end justify-between gap-4">
        <Skeleton className="h-[46px] w-64 sm:h-[56px]" />
        <Skeleton className="h-4 w-52" />
      </div>
      <div className="mt-10 grid gap-10 lg:grid-cols-[minmax(0,7fr)_minmax(0,5fr)] lg:gap-14">
        <div>
          <Skeleton className="h-3 w-56" />
          <ul className="mt-3 border-y border-line">
            {items.map((item) => (
              <li
                key={item}
                className="flex items-center gap-3 border-b border-line py-3 last:border-b-0 sm:gap-4"
              >
                <Skeleton className="h-16 w-16 shrink-0" />
                <div className="flex min-w-0 flex-1 flex-col gap-2">
                  <Skeleton className="h-5 w-2/3" />
                  <Skeleton className="h-4 w-1/3" />
                </div>
                <Skeleton className="h-8 w-24 shrink-0" />
              </li>
            ))}
          </ul>
        </div>
        <aside className="flex flex-col gap-8">
          <div className="border border-line bg-paper p-5 sm:p-6">
            <Skeleton className="h-3 w-32" />
            <Skeleton className="mt-3 h-8 w-48" />
            <Skeleton className="mt-4 h-16 w-full" />
            <Skeleton className="mt-5 h-11 w-full" />
          </div>
          <div className="border border-line bg-paper p-5 sm:p-6">
            <Skeleton className="h-3 w-20" />
            <div className="mt-4 flex flex-col gap-3">
              {lines.map((line) => (
                <div key={line} className="flex items-baseline justify-between gap-4">
                  <Skeleton className="h-5 w-32" />
                  <Skeleton className="h-5 w-24" />
                </div>
              ))}
            </div>
          </div>
        </aside>
      </div>
    </SkeletonScreen>
  )
}
