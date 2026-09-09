import Link from 'next/link'
import { BrandMark } from '@/components/brand-mark'
import { legalDocuments } from '@/lib/legal/documents'
import { operator } from '@/lib/legal/operator'

const linkClassName =
  'inline-block py-1.5 text-ink-2 underline decoration-line-strong decoration-1 underline-offset-4 transition-colors duration-200 ease-ui hover:text-ink'

export function SiteFooter() {
  return (
    <footer className="border-t border-line">
      <div className="mx-auto flex max-w-6xl flex-col gap-5 px-5 py-8 text-sm text-ink-2 sm:px-8 sm:py-7 md:flex-row md:items-start md:justify-between md:gap-10">
        <div className="flex flex-col gap-1">
          <span className="inline-flex items-center gap-2 font-serif text-base text-ink">
            <BrandMark className="h-5 w-5 shrink-0" />
            Домица
          </span>
          <span>Концепты интерьера, список покупок и смета</span>
        </div>
        <nav aria-label="Документы" className="flex flex-col gap-1 md:items-end">
          {legalDocuments.map((document) => (
            <Link key={document.slug} href={`/legal/${document.slug}`} className={linkClassName}>
              {document.short}
            </Link>
          ))}
          <a href={`mailto:${operator.email}`} className={linkClassName}>
            {operator.email}
          </a>
        </nav>
      </div>
    </footer>
  )
}
