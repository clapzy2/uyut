import Link from 'next/link'

export default function NotFound() {
  return (
    <section className="mx-auto max-w-6xl px-5 py-12 sm:px-8 sm:py-16 lg:py-24">
      <div className="max-w-xl">
        <h1 className="font-serif text-[40px] font-normal leading-[1.05] tracking-tight text-ink sm:text-5xl lg:text-[56px]">
          Такой страницы нет.
        </h1>
        <p className="mt-5 text-lg leading-relaxed text-ink-2">
          Возможно, ссылка устарела или в адресе опечатка.
        </p>
        <Link
          href="/projects"
          className="mt-8 inline-block text-[15px] text-ink underline decoration-accent decoration-1 underline-offset-4"
        >
          К проектам
        </Link>
      </div>
    </section>
  )
}
