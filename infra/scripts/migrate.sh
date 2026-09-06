#!/usr/bin/env bash
# Применяет миграции Drizzle к базе из DATABASE_URL. Для CI и ручного запуска.
# В production-контейнере миграции запускает сам образ перед стартом сервера.
set -euo pipefail

cd "$(dirname "$0")/../.."
: "${DATABASE_URL:?DATABASE_URL is required}"

bun run --filter @uyut/db migrate
