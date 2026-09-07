import type { Metadata } from 'next'
import Link from 'next/link'
import { notFound } from 'next/navigation'
import { findLegalDocument, legalDocuments } from '@/lib/legal/documents'
import { operatorReady, updatedOn } from '@/lib/legal/operator'

type Params = Promise<{ slug: string }>

export function generateStaticParams() {
  return legalDocuments.map((document) => ({ slug: document.slug }))
}

export async function generateMetadata({ params }: { params: Params }): Promise<Metadata> {
  const { slug } = await params
  const document = findLegalDocument(slug)
  return document ? { title: document.title, description: document.lede } : { title: 'Документ' }
}

export default async function LegalPage({ params }: { params: Params }) {
  const { slug } = await params
  const document = findLegalDocument(slug)
  if (!document) {
    notFound()
  }
  const others = legalDocuments.filter((item) => item.slug !== document.slug)

  return (
    <article className="mx-auto max-w-3xl px-5 py-12 sm:px-8 sm:py-16 lg:py-20">
      <Link
        href="/"
        className="inline-block py-1.5 text-sm text-ink-2 underline decoration-line-strong decoration-1 underline-offset-4 hover:text-ink"
      >
        На главную
      </Link>
      <h1 className="mt-5 hyphens-auto font-serif text-[32px] font-normal leading-[1.05] tracking-tight text-ink sm:text-[40px] lg:text-5xl">
        {document.title}
      </h1>
      <p className="mt-5 text-lg leading-relaxed text-ink-2">{document.lede}</p>
      <p className="mt-4 font-mono text-[13px] text-ink-2">Редакция от {updatedOn()}</p>

      {operatorReady() ? null : (
        <p className="mt-8 border-l-2 border-accent bg-paper px-4 py-3 text-[15px] leading-relaxed text-ink-2">
          Документ в подготовке: реквизиты будут указаны до запуска сервиса. Текст ниже — рабочая
          редакция.
        </p>
      )}

      <div className="mt-10 flex flex-col gap-9">
        {document.blocks.map((block) => (
          <section key={block.heading}>
            <h2 className="hyphens-auto font-serif text-[22px] leading-tight text-ink sm:text-2xl">
              {block.heading}
            </h2>
            <div className="mt-3 flex flex-col gap-3">
              {block.paragraphs.map((paragraph) => (
                <p key={paragraph} className="text-[16px] leading-relaxed text-ink-2">
                  {paragraph}
                </p>
              ))}
            </div>
          </section>
        ))}
      </div>

      <nav className="mt-14 border-t border-line pt-6">
        <p className="text-[11px] font-medium uppercase tracking-[0.12em] text-ink-2">
          Остальные документы
        </p>
        <ul className="mt-3 flex flex-col gap-2">
          {others.map((item) => (
            <li key={item.slug}>
              <Link
                href={`/legal/${item.slug}`}
                className="inline-block py-1.5 text-[15px] text-ink underline decoration-accent decoration-1 underline-offset-4"
              >
                {item.short}
              </Link>
            </li>
          ))}
        </ul>
      </nav>
    </article>
  )
}
