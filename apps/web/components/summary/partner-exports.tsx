import { buttonClassName } from '@uyut/ui'
import type { ExportView } from '@/lib/exports/repository'
import { formatDate } from '@/lib/projects/format'

/** Второй участник не платит и не собирает PDF, но готовые файлы ему доступны */
export function PartnerExports({ exports }: { exports: ExportView[] }) {
  const ready = exports.filter((item) => item.status === 'ready' && item.pdfUrl)
  const latest = ready[0]
  return (
    <section className="border border-line bg-paper p-5 sm:p-6" aria-labelledby="export-title">
      <p
        id="export-title"
        className="text-[11px] font-medium uppercase tracking-[0.12em] text-ink-2"
      >
        Забрать проект
      </p>
      <h2 className="mt-2 font-serif text-[24px] leading-tight text-ink">PDF как журнал</h2>
      <p className="mt-2 text-[15px] leading-relaxed text-ink-2">
        Обложка, разворот каждой комнаты, список покупок, смета и техническое задание для бригады.
        Собирает документ и оплачивает проект владелец; готовые файлы появляются здесь.
      </p>
      {latest?.pdfUrl ? (
        <div className="mt-5 flex flex-col gap-2 border-t border-line pt-4">
          <a
            href={latest.pdfUrl}
            target="_blank"
            rel="noopener noreferrer"
            className={buttonClassName({ variant: 'secondary' })}
          >
            Скачать PDF
          </a>
          <p className="font-mono text-[12px] text-ink-2">
            {formatDate(latest.createdAt)}
            {latest.pages ? ` · ${latest.pages} стр.` : ''}
            {latest.kind === 'free' ? ' · с водяным знаком' : ' · без водяного знака'}
          </p>
        </div>
      ) : (
        <p className="mt-5 border-t border-line pt-4 text-[13px] text-ink-2">
          Готовых файлов пока нет.
        </p>
      )}
    </section>
  )
}
