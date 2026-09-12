# syntax=docker/dockerfile:1
# Контекст сборки: корень репозитория. docker build -f apps/web/Dockerfile .

FROM node:24-slim AS build
COPY --from=oven/bun:1.4 /usr/local/bin/bun /usr/local/bin/bun
WORKDIR /app
ENV NEXT_TELEMETRY_DISABLED=1 DOCKER_BUILD=1
# Значения NEXT_PUBLIC_* попадают в клиентский код на этапе сборки, поэтому их мало
# передать контейнеру: без ARG они до next build не доходят, и аналитика молча молчит.
ARG NEXT_PUBLIC_SENTRY_DSN
ARG NEXT_PUBLIC_POSTHOG_KEY
ARG NEXT_PUBLIC_POSTHOG_HOST
COPY . .
# bun раскладывает бинарники по node_modules каждого workspace, поэтому ставим зависимости
# уже поверх исходников; кэш загрузок живёт в BuildKit и переживает пересборки
RUN --mount=type=cache,target=/root/.bun/install/cache bun install --frozen-lockfile
RUN bun run --filter @uyut/web build
RUN bun build packages/db/src/migrate.ts --target=node --outfile=/app/out/migrate.mjs
# Разовые работы по каталогу кладём рядом с миграциями: у контейнера уже есть доступ к базе,
# и запустить их можно одной командой, не вынимая ключи наружу
RUN bun build jobs/scripts/repair-dimensions.ts --target=node --outfile=/app/out/repair-dimensions.mjs

FROM node:24-slim AS runtime
WORKDIR /app
ENV NODE_ENV=production PORT=3000 HOSTNAME=0.0.0.0 NEXT_TELEMETRY_DISABLED=1 MIGRATIONS_DIR=/app/drizzle
# curl нужен не нам, а платформе: Coolify подменяет HEALTHCHECK своей командой и зовёт
# curl или wget. В node:24-slim нет ни того, ни другого, и контейнер навсегда остаётся
# нездоровым — трафик на него не пойдёт, хотя приложение отвечает.
RUN apt-get update && apt-get install -y --no-install-recommends curl && rm -rf /var/lib/apt/lists/*
RUN groupadd --system app && useradd --system --gid app --create-home app
COPY --from=build --chown=app:app /app/apps/web/.next/standalone ./
COPY --from=build --chown=app:app /app/apps/web/.next/static ./apps/web/.next/static
# Сборка standalone кладёт в вывод только код: public и static нужно копировать руками,
# иначе фотографии лендинга и картинки библиотеки стилей отдают 404.
COPY --from=build --chown=app:app /app/apps/web/public ./apps/web/public
COPY --from=build --chown=app:app /app/out/migrate.mjs ./migrate.mjs
COPY --from=build --chown=app:app /app/out/repair-dimensions.mjs ./repair-dimensions.mjs
COPY --from=build --chown=app:app /app/packages/db/drizzle ./drizzle
USER app
EXPOSE 3000
HEALTHCHECK --interval=30s --timeout=5s --start-period=30s --retries=3 \
  CMD node -e "fetch('http://127.0.0.1:3000/api/health').then((r) => process.exit(r.ok ? 0 : 1)).catch(() => process.exit(1))"
CMD ["sh", "-c", "node migrate.mjs && node apps/web/server.js"]
