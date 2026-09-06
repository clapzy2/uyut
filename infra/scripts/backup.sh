#!/usr/bin/env bash
# Ежедневный дамп PostgreSQL в S3 с ретеншеном: 30 ежедневных копий, копии за первое число месяца хранятся год.
# Запускается cron-задачей Coolify. Требует pg_dump и aws cli.
set -euo pipefail

: "${DATABASE_URL:?DATABASE_URL is required}"
: "${BACKUP_BUCKET:?BACKUP_BUCKET is required, e.g. s3://uyut-backups}"
: "${S3_ENDPOINT:?S3_ENDPOINT is required}"

prefix="${BACKUP_BUCKET}/pg"
today="$(date -u +%F)"

pg_dump --no-owner --no-privileges "$DATABASE_URL" | gzip -9 | aws --endpoint-url "$S3_ENDPOINT" s3 cp - "${prefix}/${today}.sql.gz"
echo "uploaded ${prefix}/${today}.sql.gz"

daily_cutoff="$(date -u -d '30 days ago' +%F)"
monthly_cutoff="$(date -u -d '365 days ago' +%F)"

aws --endpoint-url "$S3_ENDPOINT" s3 ls "${prefix}/" | awk '{print $4}' | while read -r name; do
  day="${name%.sql.gz}"
  [[ "$day" =~ ^[0-9]{4}-[0-9]{2}-[0-9]{2}$ ]] || continue

  keep_as_monthly=false
  [[ "${day: -2}" == "01" && "$day" > "$monthly_cutoff" ]] && keep_as_monthly=true

  if [[ "$day" < "$daily_cutoff" && "$keep_as_monthly" == false ]]; then
    aws --endpoint-url "$S3_ENDPOINT" s3 rm "${prefix}/${name}"
    echo "removed ${name}"
  fi
done
