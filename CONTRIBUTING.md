# Домица — правила проекта

## Что это
AI-платформа для дизайна интерьера с интеграцией российских магазинов мебели.

## Стек
- Runtime: Bun 1.2+ для пакетов, скриптов и тестов; production-сервер Next.js работает под Node 24 LTS
- Framework: Next.js 16 (App Router) + React 19 + TypeScript 5.7+
- Стили: Tailwind CSS 4 (CSS-first config)
- ORM: Drizzle ORM
- База: PostgreSQL 17 + pgvector
- Auth: Better Auth
- Background jobs: Trigger.dev v4
- Storage: S3-совместимое (Selectel Object Storage / MinIO в dev)
- AI: Fal.ai (image/segmentation), Anthropic Claude (chat/reasoning), Voyage AI (embeddings)
- Deploy: Coolify (self-hosted PaaS на VPS)

## Структура

```
/apps
  /web            # Next.js (frontend + серверные экшены + API routes)
/packages
  /db             # Drizzle-схемы, миграции, seeders
  /ui             # Собственные UI-компоненты (никаких shadcn/radix-обёрток целиком)
  /ai             # Клиенты Fal.ai, Anthropic, Voyage; промпты
  /catalog        # Логика парсинга фидов и матчинга
/jobs             # Trigger.dev-задачи (генерация, индексация каталога)
/infra
  /coolify        # docker-compose, инструкции по деплою
  /scripts        # backup, migrate, seed
/docs
  /adr            # Architecture Decision Records
```

## Правила кода

### Общее
- Никакого `any` в TypeScript. Zod-схемы на всех границах.
- Никаких «утилит на все случаи жизни» — конкретные хелперы под конкретную задачу.
- Комментарии — только про WHY, никогда про WHAT. Хорошее имя лучше комментария.
- Файлы — kebab-case (`concept-swipe.tsx`). Компоненты внутри — PascalCase.
- Функции чистые где возможно; побочные эффекты — в отдельных сервисах.

### Frontend
- Server Components по умолчанию. Client Components — только при реальной интерактивности.
- Стили — Tailwind 4. Никаких CSS-in-JS библиотек.
- Никаких UI-китов целиком (shadcn, Radix Themes, Ant, Material, Chakra).
  Radix Primitives можно как основу для Dialog/Popover/Combobox, но обёртка всегда своя, с нашими токенами.
- Формы — react-hook-form + Zod.
- Клиентское состояние — Zustand. Серверное — React Query.
- Анимации — Framer Motion, только там где физика нужна (свайп, drag).
- Иконки — свои SVG (никаких Lucide/Heroicons: пусть будет ручной стиль).

### Backend / серверная логика
- Server Actions для мутаций из UI. Route Handlers — для внешних вебхуков и API.
- Валидация — Zod-схемы, шаренные между клиентом и сервером через `/packages/db`.
- Все внешние вызовы (Fal.ai, Anthropic, магазины) — через порт-абстракции с интерфейсом.
- Транзакции БД — явные, `db.transaction(async (tx) => { ... })`.
- Никаких «сырых» SQL в бизнес-коде — только через Drizzle.

### Security
- Никаких секретов в коде. Только через env, валидируемые Zod на старте.
- Better Auth: HttpOnly Secure SameSite=Lax cookies, ротация refresh.
- CSRF — встроен в Better Auth + double-submit для критичных Server Actions.
- Rate limit — Upstash Redis rate-limit; на login/register/generation.
- Загруженные файлы — проверка магических байтов, лимит размера, S3 private bucket, доступ через presigned URLs.
- Все repository-функции принимают `userId` первым аргументом; никаких «глобальных» query без owner-check.

## Что НЕ делать
- Не подключать shadcn/ui целиком. Только точечно Radix Primitives как основу.
- Не подключать иконочные библиотеки. Свои SVG.
- Не использовать generic AI-эстетику: фиолетовые градиенты, glassmorphism, светящиеся blob'ы, эмодзи в UI, лого в стиле «geometric OpenAI».
- Не хранить генерации на диске приложения — только в S3.
- Не подключать GraphQL, микросервисы, Kubernetes. Одна Next.js-апа + Trigger.dev + одна БД.
- Не парсить магазины скрапингом. Только партнёрские фиды.
- Не добавлять фичи вне утверждённого скоупа без обсуждения.

## Git

- Ветка `main` защищена, только через PR.
- Commit message: `<type>(<scope>): <subject>` — feat, fix, chore, docs, refactor, test.
- Каждый PR — описание + test plan.
- CI обязательно зелёный: lint (biome) + typecheck + unit + e2e-smoke + build.

## Тесты

- Unit: vitest. Обязательные — на бизнес-логику (auth, matching, pricing).
- Integration: vitest + testcontainers для PG.
- E2E: Playwright. Обязательные флоу — register → onboarding → generate → checkout → PDF.
