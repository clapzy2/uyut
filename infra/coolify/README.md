# Деплой через Coolify

Coolify — self-hosted платформа: git-push деплой, автоматический HTTPS, управление переменными, логи, откат. Ниже порядок действий с нуля.

## 1. Сервер и домен

- VPS с Ubuntu 24.04, минимум 2 vCPU и 4 GB памяти (Selectel, Timeweb Cloud или аналог с оплатой в рублях).
- Домен с A-записью на IP сервера. До покупки домена Coolify выдаёт временный адрес вида `*.sslip.io`.
- Вход на сервер по SSH-ключу, пароль отключить.

## 2. Установка Coolify

На сервере под root:

```bash
curl -fsSL https://cdn.coollabs.io/coolify/install.sh | bash
```

После установки открыть `http://<ip>:8000`, создать первого администратора, в настройках указать домен панели и включить HTTPS.

## 3. GitHub

В Coolify: Sources → Add → GitHub App. Coolify сам создаст GitHub App и попросит дать ему доступ к репозиторию `uyut`. После этого деплой запускается автоматически на каждый push в `main`.

## 4. Проект и ресурсы

Создать проект `uyut`, окружение `production`, добавить ресурсы:

**PostgreSQL.** Тип Database → PostgreSQL. В настройках образа указать `pgvector/pgvector:pg17`, иначе расширения vector не будет. Внутренний URL подключения скопировать в переменную `DATABASE_URL` приложения.

**Redis с REST-прокси.** Тип Docker Compose, вставить содержимое `infra/coolify/redis-srh.compose.yml`. Задать переменные `REDIS_PASSWORD` и `SRH_TOKEN` (длинные случайные строки). Включить «Connect to predefined network», чтобы приложение видело сервис по имени `redis-http`.

**Приложение.** Тип Application → Private repository (GitHub App), репозиторий `uyut`, ветка `main`.
- Build pack: Dockerfile.
- Base directory: `/`.
- Dockerfile location: `/apps/web/Dockerfile`.
- Port: `3000`.
- Health check: путь `/api/health`.
- Домен: `https://<ваш домен>`.

Переменные окружения приложения:

| Переменная | Значение |
|---|---|
| `APP_URL` | `https://<ваш домен>` |
| `DATABASE_URL` | внутренний URL PostgreSQL из Coolify |
| `UPSTASH_REDIS_REST_URL` | `http://redis-http:80` |
| `UPSTASH_REDIS_REST_TOKEN` | значение `SRH_TOKEN` |
| `S3_ENDPOINT` | `https://s3.ru-1.storage.selcloud.ru` (уточнить в панели Selectel) |
| `S3_REGION` | `ru-1` |
| `S3_BUCKET` | имя приватного bucket |
| `S3_ACCESS_KEY`, `S3_SECRET_KEY` | сервисный пользователь Selectel |
| `BETTER_AUTH_SECRET` | случайная строка от 32 символов, `openssl rand -base64 32` |
| `SMTP_URL` | адрес SMTP-сервера для писем, например `smtps://user:pass@smtp.resend.com:465` |
| `EMAIL_FROM` | отправитель писем, например `Uyut <hello@ваш-домен>` |
| `SENTRY_DSN` | DSN production-проекта Sentry |
| `NEXT_PUBLIC_SENTRY_DSN` | тот же DSN, отметить «Available at build time»: значение вшивается в клиентский бандл |

Миграции применяются автоматически при старте контейнера, отдельного шага не нужно.

## 5. Фоновые задачи

Задачи работают в Trigger.dev Cloud, на сервере ничего разворачивать не нужно. Деплой задач делает GitHub Actions: в секреты репозитория добавить `TRIGGER_ACCESS_TOKEN` (личный токен из Trigger.dev) и `TRIGGER_PROJECT_REF`, после чего workflow деплоя запускает `trigger.dev deploy` на каждый push в `main`.

## 6. Бэкапы

Проще всего встроенными средствами Coolify: в настройках базы PostgreSQL включить Scheduled Backups с загрузкой в S3 (Selectel, отдельный bucket `uyut-backups`), расписание ежедневно, хранение 30 копий. Скрипт `infra/scripts/backup.sh` делает то же самое вручную или из cron с ретеншеном «30 ежедневных плюс ежемесячные за год». Раз в квартал проверять восстановление из копии на чистой базе.

## 7. Проверка после деплоя

```bash
curl -s https://<ваш домен>/api/health
```

Ответ `{"status":"ok","database":"ok"}` означает, что контейнер поднялся, миграции применились и база доступна.
