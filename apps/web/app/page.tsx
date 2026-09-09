import { buttonClassName } from '@uyut/ui'
import type { Metadata } from 'next'
import Link from 'next/link'
import { redirect } from 'next/navigation'
import { PhotoFrame } from '@/components/landing/photo-frame'
import { formatPrice } from '@/lib/concepts/format'
import { getEnv } from '@/lib/env'
import { photo } from '@/lib/landing/photos'
import { getSession } from '@/lib/session'

export const metadata: Metadata = {
  title: 'Домица — проект квартиры за вечер',
  description:
    'Загрузите план или фотографию комнаты и получите варианты обстановки, список мебели из российских магазинов, смету и задание для мастеров.',
}

const label = 'font-mono text-[11px] uppercase tracking-[0.12em] text-ink-2'
const heading = 'font-serif font-normal leading-[1.06] tracking-tight text-ink'

const steps = [
  {
    title: 'Показываете квартиру',
    text: 'План, фотография комнаты или просто серия дома. Пять коротких вопросов о том, сколько вас, как вы живёте и на что рассчитываете.',
  },
  {
    title: 'Смотрите варианты',
    text: 'Сервис рисует комнату несколько раз по-разному. Свайпом отмечаете, что нравится: следующие варианты становятся ближе к вашему вкусу.',
  },
  {
    title: 'Забираете проект',
    text: 'К каждому варианту — мебель из российских магазинов с ценами, смета работ по площади и документ для бригады.',
  },
]

export default async function HomePage() {
  const session = await getSession()
  if (session) {
    redirect('/projects')
  }
  const env = getEnv()

  const plans = [
    {
      name: 'Бесплатно',
      price: '0 ₽',
      note: 'без карты',
      items: ['Одна квартира', 'Варианты комнат и подбор мебели', 'Документ с водяным знаком'],
    },
    {
      name: 'Одна квартира',
      price: formatPrice(env.PROJECT_PRICE_KOPECKS),
      note: 'разовая оплата',
      items: ['Документ без водяного знака', 'Выгрузка списка покупок', 'Остаётся у вас навсегда'],
    },
    {
      name: 'Pro',
      price: `${formatPrice(env.PRO_PRICE_KOPECKS)} в месяц`,
      note: 'продление можно отключить',
      items: [
        'Сколько угодно квартир',
        'Ни одного водяного знака',
        'Совместный выбор со вторым участником',
      ],
    },
  ]

  return (
    <>
      <section className="mx-auto max-w-6xl px-5 pb-14 pt-12 sm:px-8 sm:pb-20 sm:pt-16 lg:pt-20">
        <h1 className={`${heading} max-w-4xl text-[42px] sm:text-6xl lg:text-[76px]`}>
          Проект квартиры за вечер, а не за три месяца.
        </h1>
        <div className="mt-8 flex flex-wrap items-center gap-x-6 gap-y-4">
          <Link href="/register" className={buttonClassName()}>
            Начать бесплатно
          </Link>
          <p className={label}>Первая квартира бесплатно · карта не нужна</p>
        </div>
        <PhotoFrame
          slot={photo('hero')}
          priority
          className="mt-12 aspect-[16/10] w-full sm:mt-14 lg:aspect-[16/8]"
        />
      </section>

      <section className="border-t border-line">
        <div className="mx-auto grid max-w-6xl gap-10 px-5 py-14 sm:px-8 sm:py-20 lg:grid-cols-[4fr_7fr] lg:gap-16">
          <div>
            <p className={label}>Как это устроено</p>
            <h2 className={`${heading} mt-3 text-[30px] sm:text-4xl`}>Три шага, один вечер</h2>
          </div>
          <ol className="flex flex-col">
            {steps.map((step, index) => (
              <li
                key={step.title}
                className="border-t border-line py-6 first:border-t-0 first:pt-0"
              >
                <div className="flex gap-5">
                  <span className="mt-1 font-mono text-[13px] text-accent">
                    {String(index + 1).padStart(2, '0')}
                  </span>
                  <div>
                    <h3 className="font-serif text-[22px] leading-tight text-ink">{step.title}</h3>
                    <p className="mt-2 max-w-xl text-[16px] leading-relaxed text-ink-2">
                      {step.text}
                    </p>
                  </div>
                </div>
              </li>
            ))}
          </ol>
        </div>
      </section>

      <section className="border-t border-line">
        <div className="mx-auto max-w-6xl px-5 py-14 sm:px-8 sm:py-20">
          <p className={label}>Одна и та же комната</p>
          <h2 className={`${heading} mt-3 max-w-2xl text-[30px] sm:text-4xl`}>
            Сначала пустые стены, потом список покупок
          </h2>
          <div className="mt-10 grid gap-5 sm:grid-cols-2 sm:gap-6">
            <figure className="flex flex-col gap-3">
              <PhotoFrame slot={photo('before')} className="aspect-[4/3] w-full" />
              <figcaption className={label}>Как есть</figcaption>
            </figure>
            <figure className="flex flex-col gap-3">
              <PhotoFrame slot={photo('after')} className="aspect-[4/3] w-full" />
              <figcaption className={label}>Как может быть</figcaption>
            </figure>
          </div>
          <p className="mt-8 max-w-2xl text-[16px] leading-relaxed text-ink-2">
            Изображения рисует модель, а мебель на них сервис ищет в каталогах магазинов: диван с
            картинки можно открыть по ссылке и купить. Смета считается по площади комнат и служит
            ориентиром для разговора с бригадой.
          </p>
        </div>
      </section>

      <section className="border-t border-line">
        <div className="mx-auto grid max-w-6xl gap-10 px-5 py-14 sm:px-8 sm:py-20 lg:grid-cols-[6fr_5fr] lg:items-center lg:gap-16">
          <div>
            <p className={label}>Что остаётся у вас</p>
            <h2 className={`${heading} mt-3 text-[30px] sm:text-4xl`}>
              Документ, с которым идут к мастеру
            </h2>
            <p className="mt-5 max-w-xl text-[16px] leading-relaxed text-ink-2">
              Обложка, разворот на каждую комнату, список покупок с ценами, смета работ и
              техническое задание для бригады — одним файлом PDF. Его можно распечатать и отдать
              подрядчику вместо долгих объяснений.
            </p>
          </div>
          <PhotoFrame slot={photo('document')} className="aspect-[4/3] w-full" />
        </div>
      </section>

      <section className="border-t border-line">
        <div className="mx-auto grid max-w-6xl gap-10 px-5 py-14 sm:px-8 sm:py-20 lg:grid-cols-[5fr_6fr] lg:items-center lg:gap-16">
          <PhotoFrame slot={photo('together')} className="aspect-[3/4] w-full lg:aspect-[4/5]" />
          <div>
            <p className={label}>Вдвоём</p>
            <h2 className={`${heading} mt-3 text-[30px] sm:text-4xl`}>Когда вкусы не совпадают</h2>
            <p className="mt-5 max-w-xl text-[16px] leading-relaxed text-ink-2">
              Позовите того, с кем живёте. Каждый отмечает варианты сам, не видя чужих ответов, а
              сервис показывает, где вы сошлись. Если не сошлись нигде — предложит три варианта на
              границе двух вкусов.
            </p>
          </div>
        </div>
      </section>

      <section className="border-t border-line">
        <div className="mx-auto max-w-6xl px-5 py-14 sm:px-8 sm:py-20">
          <p className={label}>Сколько стоит</p>
          <h2 className={`${heading} mt-3 max-w-2xl text-[30px] sm:text-4xl`}>
            Посмотреть можно бесплатно
          </h2>
          <ul className="mt-10 flex flex-col">
            {plans.map((plan) => (
              <li key={plan.name} className="border-t border-line py-7 last:border-b">
                <div className="grid gap-4 sm:grid-cols-[1fr_auto] sm:items-start sm:gap-10">
                  <div>
                    <h3 className="font-serif text-[24px] leading-tight text-ink sm:text-[28px]">
                      {plan.name}
                    </h3>
                    <ul className="mt-3 flex flex-col gap-1.5">
                      {plan.items.map((item) => (
                        <li key={item} className="text-[15px] leading-relaxed text-ink-2">
                          {item}
                        </li>
                      ))}
                    </ul>
                  </div>
                  <div className="sm:text-right">
                    <p className="font-mono text-[20px] text-ink sm:text-[22px]">{plan.price}</p>
                    <p className={`${label} mt-1`}>{plan.note}</p>
                  </div>
                </div>
              </li>
            ))}
          </ul>
          <p className="mt-6 max-w-2xl text-[15px] leading-relaxed text-ink-2">
            Мебель вы покупаете в магазинах напрямую, её стоимость в цену сервиса не входит.
          </p>
        </div>
      </section>

      <section className="border-t border-line">
        <div className="mx-auto max-w-6xl px-5 py-16 sm:px-8 sm:py-24">
          <h2 className={`${heading} max-w-3xl text-[32px] sm:text-5xl`}>
            Начните с одной комнаты.
          </h2>
          <div className="mt-8 flex flex-wrap items-center gap-x-6 gap-y-4">
            <Link href="/register" className={buttonClassName()}>
              Создать аккаунт
            </Link>
            <Link
              href="/login"
              className="inline-block py-1.5 text-[15px] text-ink underline decoration-accent decoration-1 underline-offset-4"
            >
              Уже есть аккаунт
            </Link>
          </div>
        </div>
      </section>
    </>
  )
}
