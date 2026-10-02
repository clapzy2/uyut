import { createHash } from 'node:crypto'
import { mkdir, writeFile } from 'node:fs/promises'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { projectExports, projects } from '@uyut/db'
import { fontFaceCss, renderProjectHtml } from '@uyut/pdf'
import { eq } from 'drizzle-orm'
import { db } from '../src/lib/db'
import { buildPdfData, loadSnapshot } from '../src/lib/pdf-data'
import { printPdf } from '../src/lib/print-pdf'
import { putObject, readObject } from '../src/lib/s3'

const connection = process.env.DATABASE_URL
const storage = process.env.S3_ENDPOINT
const appUrl = process.env.APP_URL
if (
  !connection ||
  !storage ||
  !appUrl ||
  !['localhost', '127.0.0.1', '[::1]'].includes(new URL(connection).hostname) ||
  !['localhost', '127.0.0.1', '[::1]'].includes(new URL(storage).hostname) ||
  !['localhost', '127.0.0.1', '[::1]'].includes(new URL(appUrl).hostname) ||
  process.env.FAL_KEY ||
  process.env.TRIGGER_SECRET_KEY
) {
  throw new Error('Этот PDF-тест разрешён только с локальными адресами, без AI и очереди')
}

const projectId = process.argv[2]
const uuidPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
if (!projectId || !uuidPattern.test(projectId)) {
  throw new Error('Передайте ID локального тестового проекта')
}

const database = db()
const [project] = await database
  .select({ title: projects.title })
  .from(projects)
  .where(eq(projects.id, projectId))
  .limit(1)
if (!project?.title.startsWith('Локальный тест 2D —')) {
  throw new Error('Экспортировать можно только созданный для QA локальный проект')
}

const snapshot = await loadSnapshot(projectId)
if (!snapshot) throw new Error('Не удалось загрузить тестовую квартиру')

const [exportRow] = await database
  .insert(projectExports)
  .values({ projectId, kind: 'free', options: {} })
  .returning({ id: projectExports.id })
if (!exportRow) throw new Error('Не создана запись экспорта')

try {
  const data = await buildPdfData({
    snapshot,
    kind: 'free',
    options: {},
    rates: { roughRubPerM2: 15_000, finishRubPerM2: 5_000 },
    brief: null,
    summary: null,
  })
  const html = renderProjectHtml(data, { fontCss: fontFaceCss() })
  const pdf = await printPdf(html, snapshot.project.title)
  const key = `projects/${projectId}/exports/${exportRow.id}.pdf`
  await putObject(key, pdf, 'application/pdf')
  const stored = await readObject(key)
  const digest = (bytes: Buffer) => createHash('sha256').update(bytes).digest('hex')
  if (
    !stored.body.subarray(0, 5).equals(Buffer.from('%PDF-')) ||
    digest(stored.body) !== digest(pdf)
  ) {
    throw new Error('PDF в хранилище отличается от напечатанного файла')
  }

  const pages = pdf.toString('latin1').match(/\/Type\s*\/Page(?!s)/g)?.length ?? 0
  if (pages === 0) throw new Error('В PDF нет страниц')
  const directory = resolve(dirname(fileURLToPath(import.meta.url)), '../../output/pdf')
  await mkdir(directory, { recursive: true })
  const path = resolve(directory, `qa-local-export-${exportRow.id}.pdf`)
  await writeFile(path, pdf, { flag: 'wx' })
  await database
    .update(projectExports)
    .set({ status: 'ready', pdfKey: key, pages, finishedAt: new Date() })
    .where(eq(projectExports.id, exportRow.id))
  console.log(
    JSON.stringify({ exportId: exportRow.id, pages, bytes: pdf.length, sha256: digest(pdf), path }),
  )
} catch (error) {
  await database
    .update(projectExports)
    .set({ status: 'failed', error: String(error).slice(0, 500), finishedAt: new Date() })
    .where(eq(projectExports.id, exportRow.id))
  throw error
}

process.exit(0)
