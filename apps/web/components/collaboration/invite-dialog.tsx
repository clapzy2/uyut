'use client'

import { zodResolver } from '@hookform/resolvers/zod'
import { Button, Dialog, DialogContent, DialogTrigger, Input, toast } from '@uyut/ui'
import { useRouter } from 'next/navigation'
import { useState } from 'react'
import { useForm } from 'react-hook-form'
import { inviteCollaborator } from '@/actions/collaboration'
import { FormError } from '@/components/form-error'
import { type InviteFormInput, inviteFormSchema } from '@/lib/validation/collaboration'

export function InviteDialog({
  projectId,
  initialEmail = '',
  label = 'Выбирать вдвоём',
  variant = 'primary',
}: {
  projectId: string
  initialEmail?: string
  label?: string
  variant?: 'primary' | 'secondary' | 'ghost'
}) {
  const router = useRouter()
  const [open, setOpen] = useState(false)
  const form = useForm<InviteFormInput>({
    resolver: zodResolver(inviteFormSchema),
    defaultValues: { email: initialEmail },
  })
  const { errors, isSubmitting } = form.formState

  async function onSubmit(values: InviteFormInput) {
    const result = await inviteCollaborator({ projectId, email: values.email })
    if (!result.ok) {
      form.setError('root', { message: result.error })
      return
    }
    toast({
      title: 'Приглашение отправлено',
      description: `Письмо со ссылкой ушло на ${values.email.trim().toLowerCase()}.`,
      tone: 'success',
    })
    setOpen(false)
    router.refresh()
  }

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button variant={variant}>{label}</Button>
      </DialogTrigger>
      <DialogContent
        title="Выбирать вдвоём"
        description="Пригласите того, с кем выбираете интерьер. Он увидит план, комнаты и концепты, будет отмечать, что нравится, и открывать подбор товаров. Удалить проект, оплатить его или пригласить кого-то ещё сможете только вы."
      >
        <form onSubmit={form.handleSubmit(onSubmit)} noValidate className="flex flex-col gap-5">
          <Input
            id="invite-email"
            label="Почта"
            type="email"
            autoComplete="email"
            inputMode="email"
            placeholder="masha@example.ru"
            hint="Ссылка в письме работает неделю. Один человек на проект, доступ можно отозвать."
            error={errors.email?.message}
            {...form.register('email')}
          />
          <FormError message={errors.root?.message} />
          <Button type="submit" pending={isSubmitting} className="self-start">
            {isSubmitting ? 'Отправляем…' : 'Отправить приглашение'}
          </Button>
        </form>
      </DialogContent>
    </Dialog>
  )
}
