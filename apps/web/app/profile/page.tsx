import type { Metadata } from 'next'
import { redirect } from 'next/navigation'
import { AvatarUploader } from '@/components/avatar-uploader'
import { ChangePasswordDialog } from '@/components/change-password-dialog'
import { ProfileForm } from '@/components/profile-form'
import { SignOutButton } from '@/components/sign-out-button'
import { getSession } from '@/lib/session'
import { presignedObjectUrl } from '@/lib/storage'

export const metadata: Metadata = { title: 'Профиль' }

export default async function ProfilePage({
  searchParams,
}: {
  searchParams: Promise<{ verified?: string }>
}) {
  const session = await getSession()
  if (!session) {
    redirect('/login?next=/profile')
  }
  const { verified } = await searchParams
  const { user } = session
  const avatarUrl = user.image ? await presignedObjectUrl(user.image) : null

  return (
    <section className="mx-auto max-w-6xl px-5 py-12 sm:px-8 sm:py-16 lg:py-24">
      {verified && user.emailVerified ? (
        <p className="mb-8 max-w-xl rounded-sm border border-line bg-paper px-4 py-3 text-[15px] text-ink">
          Почта подтверждена. Спасибо, теперь всё готово.
        </p>
      ) : null}
      <div className="grid gap-10 lg:grid-cols-[1.1fr_1fr] lg:gap-16">
        <div>
          <h1 className="font-serif text-[40px] font-normal leading-[1.05] tracking-tight text-ink sm:text-5xl lg:text-[56px]">
            Профиль
          </h1>
          <div className="mt-8">
            <AvatarUploader currentUrl={avatarUrl} name={user.name} />
          </div>
        </div>
        <div className="flex w-full max-w-md flex-col gap-8 lg:justify-self-end">
          <ProfileForm name={user.name} email={user.email} emailVerified={user.emailVerified} />
          <div className="flex flex-wrap items-center gap-3 border-t border-line pt-6">
            <ChangePasswordDialog />
            <SignOutButton />
          </div>
        </div>
      </div>
    </section>
  )
}
