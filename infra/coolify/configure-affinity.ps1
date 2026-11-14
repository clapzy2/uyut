param(
  [ValidateSet('Plan', 'Apply', 'ResumeRolling')][string]$Mode = 'Plan',
  [string]$ApiRoot = 'http://127.0.0.1:18480/api/v1',
  [string]$BackupPath = 'tmp/uyut-affinity-before.json'
)
$ErrorActionPreference = 'Stop'
# Только Домица. Не менять маршруты, порты, сеть или другие приложения сервера.
$applicationId = 'wapsp4fashvfvcsqd1xbyrj7'
if (-not $env:COOLIFY_TOKEN) { throw 'COOLIFY_TOKEN is required' }
$headers = @{ Authorization = "Bearer $env:COOLIFY_TOKEN" }
$uri = "$ApiRoot/applications/$applicationId"
$application = Invoke-RestMethod $uri -Headers $headers -TimeoutSec 30
if ($application.uuid -ne $applicationId) { throw 'Unexpected application' }

if ($Mode -eq 'ResumeRolling') {
  # После первого успешного выпуска возвращаем обычное обновление без остановки.
  $patch = @{ is_consistent_container_name_enabled = $false }
} else {
  $labels = [Text.Encoding]::UTF8.GetString([Convert]::FromBase64String($application.custom_labels))
  $services = @(($labels -split "`n") | ForEach-Object {
    if ($_ -match "^traefik\.http\.services\.(https-\d+-$applicationId)\.loadbalancer\.server\.port=3000$") {
      $Matches[1]
    }
  })
  if ($services.Count -ne 5) { throw 'Expected five existing HTTPS services; review before changing labels' }
  $kept = @($labels -split "`n" | Where-Object {
    $_ -notmatch "^traefik\.http\.services\.https-\d+-$applicationId\.loadbalancer\.sticky\."
  })
  $added = foreach ($service in $services) {
    $prefix = "traefik.http.services.$service.loadbalancer.sticky.cookie"
    "$prefix=true"
    "$prefix.name=domitsa_release"
    "$prefix.secure=true"
    "$prefix.httponly=true"
    "$prefix.samesite=lax"
  }
  $patch = @{
    custom_labels = [Convert]::ToBase64String([Text.Encoding]::UTF8.GetBytes(($kept + $added) -join "`n"))
    # При первом переходе старые и новые labels различаются. Нельзя отдавать их
    # одновременно одному сервису Traefik: конфликт конфигураций уберёт маршрут.
    is_consistent_container_name_enabled = $true
  }
  if ($Mode -eq 'Plan') {
    [pscustomobject]@{ application = $applicationId; services = $services.Count; mode = 'Plan'; firstRelease = 'stop-start' }
    return
  }
  if (Test-Path -LiteralPath $BackupPath) { throw 'Backup already exists; do not overwrite it' }
  $application | Select-Object uuid, custom_labels, settings |
    ConvertTo-Json | Set-Content -LiteralPath $BackupPath
}
Invoke-RestMethod $uri -Method Patch -Headers $headers -ContentType 'application/json' -Body ($patch | ConvertTo-Json) -TimeoutSec 30 | Out-Null
$saved = Invoke-RestMethod $uri -Headers $headers -TimeoutSec 30
if ($Mode -ne 'ResumeRolling' -and $saved.custom_labels -ne $patch.custom_labels) { throw 'Labels verification failed' }
if ($saved.settings.is_consistent_container_name_enabled -ne $patch.is_consistent_container_name_enabled) { throw 'Rollout mode verification failed' }
[pscustomobject]@{ application = $applicationId; mode = $Mode; saved = $true }
