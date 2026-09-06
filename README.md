# Uyut

Сервис, который помогает обставить квартиру. По плану или фото комнаты и нескольким вопросам о том, как вы живёте и сколько готовы потратить, он собирает концепты интерьера с рендерами, подбирает реальную мебель из российских магазинов и оформляет результат в смету и PDF для мастеров.

Проект на ранней стадии: пока в репозитории инфраструктурный каркас без пользовательских функций.

## Стек

- Bun для пакетов, скриптов и тестов; Node 24 LTS для production-сервера
- Next.js 16, React 19, TypeScript
- Tailwind CSS 4
- PostgreSQL 17 с pgvector, Drizzle ORM
- Trigger.dev v4 для фоновых задач
- Redis с REST-прокси serverless-redis-http
- S3-совместимое хранилище: MinIO локально, Selectel Object Storage в production
- Sentry, Biome, Turborepo, Vitest, Playwright

Почему именно так: [docs/adr/001-stack.md](docs/adr/001-stack.md). Правила разработки: [CONTRIBUTING.md](CONTRIBUTING.md).

## Структура

```
apps/web          Next.js: интерфейс, Server Actions, API
packages/db       схемы Drizzle и миграции
packages/ui       UI-компоненты и токены дизайн-системы
packages/ai       клиенты AI-провайдеров и промпты
packages/catalog  фиды магазинов и матчинг каталога
jobs              задачи Trigger.dev
infra             деплой: Coolify, Docker, скрипты
docs/adr          архитектурные решения
```

## Запуск локально

Понадобятся Bun 1.2+, Node 24 и Docker.

```bash
bun install
cp .env.example .env
bun run infra:up        # PostgreSQL, Redis, MinIO
bun run db:migrate
bun run dev             # http://localhost:4300
```

Порт dev-сервера задаётся переменной `PORT` в `.env`. В `.env` нужно задать `BETTER_AUTH_SECRET`, любую случайную строку от 32 символов. Консоль MinIO: http://localhost:9001, логин и пароль `minioadmin`. Все письма, включая подтверждение почты и сброс пароля, ловит Mailpit: http://localhost:8025.

Как устроена аутентификация: [docs/adr/002-auth.md](docs/adr/002-auth.md).

Фоновые задачи запускаются отдельно: один раз войдите через `bunx trigger.dev login` и выполните `bun run jobs:dev`.

## Команды

| Команда | Что делает |
|---|---|
| `bun run dev` | dev-сервер приложения |
| `bun run build` | production-сборка |
| `bun run lint` | Biome: линтер и форматирование |
| `bun run typecheck` | проверка типов во всех пакетах |
| `bun run test` | unit-тесты |
| `bun run test:integration` | тесты изоляции данных на локальной базе |
| `bun run e2e` | e2e-тесты поверх production-сборки |
| `bun run db:generate` | сгенерировать миграцию из схемы |
| `bun run db:migrate` | применить миграции |
| `bun run db:studio` | Drizzle Studio |

## Деплой

Приложение собирается из `apps/web/Dockerfile` с контекстом в корне репозитория и разворачивается через Coolify. Пошаговая инструкция: [infra/coolify/README.md](infra/coolify/README.md).
