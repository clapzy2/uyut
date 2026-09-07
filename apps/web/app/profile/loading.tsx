import { Skeleton, SkeletonScreen } from '@uyut/ui'

const fields = [0, 1]

export default function ProfileLoading() {
  return (
    <SkeletonScreen
      label="Загружаем профиль"
      className="mx-auto max-w-6xl px-5 py-12 sm:px-8 sm:py-16 lg:py-24"
    >
      <div className="grid gap-10 lg:grid-cols-[1.1fr_1fr] lg:gap-16">
        <div>
          <Skeleton className="h-[46px] w-52 sm:h-[56px]" />
          <div className="mt-8 flex items-center gap-4">
            <Skeleton className="h-20 w-20 rounded-full" />
            <Skeleton className="h-5 w-40" />
          </div>
        </div>
        <div className="flex w-full max-w-md flex-col gap-8 lg:justify-self-end">
          {fields.map((field) => (
            <div key={field} className="flex flex-col gap-2">
              <Skeleton className="h-4 w-24" />
              <Skeleton className="h-11 w-full" />
            </div>
          ))}
          <Skeleton className="h-11 w-40" />
        </div>
      </div>
    </SkeletonScreen>
  )
}
