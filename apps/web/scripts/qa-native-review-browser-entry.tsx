// Local QA harness only; real component, mocked private API, no account or project writes.

import { useState } from 'react'
import { createRoot } from 'react-dom/client'
import { PlanNativeReview } from '../components/plan-native-review'

let mode = 'normal'
const nativeFetch = window.fetch.bind(window)
window.fetch = (url, options) => {
  if (typeof url === 'string' && url.startsWith('/api/projects/qa-native-review/plan-page'))
    return nativeFetch(`${url}&qaMode=${mode}`, options)
  return nativeFetch(url, options)
}
function Harness() {
  const [revision, setRevision] = useState('c'.repeat(64)),
    [conflicts, setConflicts] = useState(0)
  return (
    <main className="mx-auto max-w-5xl px-6 py-8 text-ink">
      <p className="text-xs text-ink-2">
        Локальный QA. Проверенный исходник; доступ и HTTP ошибки имитируются. Данные аккаунта не
        используются.
      </p>
      <h1 className="mt-3 text-2xl">Проверка исходного листа</h1>
      <div className="mt-3 flex flex-wrap gap-3 text-sm">
        <button
          type="button"
          onClick={() => {
            mode = 'normal'
            setRevision('c'.repeat(64))
          }}
        >
          Обычный ответ
        </button>
        <button
          type="button"
          onClick={() => {
            mode = 'delay'
          }}
        >
          Медленный ответ
        </button>
        <button
          type="button"
          onClick={() => {
            mode = 'wrong-image'
          }}
        >
          Ошибка изображения
        </button>
        <button type="button" onClick={() => setRevision('d'.repeat(64))}>
          Сменить версию
        </button>
        <button
          type="button"
          onClick={() => {
            mode = 'unauthorized'
          }}
        >
          Сессия закончилась
        </button>
      </div>
      <p data-testid="conflicts" className="mt-3 text-sm">
        Конфликтов версии: {conflicts}
      </p>
      <PlanNativeReview
        key={revision}
        projectId="qa-native-review"
        pageNumber={3}
        sourceRevision={revision}
        onConflict={() => setConflicts((value) => value + 1)}
      />
    </main>
  )
}
const root = document.getElementById('root')
if (!root) throw new Error('Missing QA root')
createRoot(root).render(<Harness />)
