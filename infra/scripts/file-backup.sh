#!/usr/bin/env bash
# Runs only this application's compiled backup tool. No source deletes or stored plaintext credentials.
set -euo pipefail
: "${DOMITSA_APPLICATION_UUID:?application UUID required}"
: "${DOMITSA_DB_BACKUP_UUID:?database backup UUID required}"
[[ "$DOMITSA_APPLICATION_UUID" =~ ^[a-z0-9]{20,32}$ ]] || exit 2
[[ "$DOMITSA_DB_BACKUP_UUID" =~ ^[a-z0-9]{20,32}$ ]] || exit 2

exec 9>/run/lock/domitsa-file-backup.lock
flock -n 9 || { echo 'Another Domitsa file backup is active.' >&2; exit 1; }
runner=/data/domitsa-file-backup
[[ -f "$runner/runner.mjs" && -f "$runner/settings.php" ]] || exit 2
image=$(docker ps --filter "name=^/${DOMITSA_APPLICATION_UUID}-" --format '{{.Image}}' | head -n 1)
[[ "$image" =~ ^${DOMITSA_APPLICATION_UUID}:[a-f0-9]{40}$ ]] || exit 2

docker exec -i -e DOMITSA_APPLICATION_UUID -e DOMITSA_DB_BACKUP_UUID coolify php < "$runner/settings.php" |
  docker run -i --rm --pull=never --name domitsa-file-backup-runner \
    --label domitsa.file-backup=scheduled --read-only --network host \
    --memory 512m --cpus 0.5 --pids-limit 128 \
    --tmpfs /tmp:rw,nosuid,nodev,size=384m \
    --mount "type=bind,source=$runner/runner.mjs,target=/runner.mjs,readonly" \
    --entrypoint node "$image" /runner.mjs
