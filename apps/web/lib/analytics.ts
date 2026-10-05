import type { CaptureResult } from 'posthog-js'

export const PILOT_STAGE_EVENT = 'pilot_stage_viewed'

const stages = [
  'landing',
  'registration',
  'login',
  'projects',
  'onboarding_1',
  'onboarding_2',
  'onboarding_3',
  'onboarding_4',
  'onboarding_5',
  'project',
  'room',
  'concept',
  'summary',
] as const

export type PilotStage = (typeof stages)[number]

const uuid = '[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}'
const projectRoute = new RegExp(`^/projects/${uuid}(/.*)?$`, 'i')
const roomRoute = new RegExp(`^/rooms/${uuid}$`, 'i')
const conceptRoute = new RegExp(`^/rooms/${uuid}/concepts/${uuid}$`, 'i')
const anonymousId = new RegExp(`^${uuid}$`, 'i')

/** Только тип экрана: идентификаторы квартиры и параметры ссылки не отправляются. */
export function getPilotStage(pathname: string): PilotStage | null {
  const publicStages: Record<string, PilotStage> = {
    '/': 'landing',
    '/register': 'registration',
    '/login': 'login',
    '/projects': 'projects',
  }
  if (Object.hasOwn(publicStages, pathname)) {
    return publicStages[pathname] ?? null
  }

  const onboarding = /^\/onboarding\/step-([1-5])$/.exec(pathname)
  if (onboarding) {
    return `onboarding_${onboarding[1]}` as PilotStage
  }

  const project = projectRoute.exec(pathname)
  if (!project) {
    return null
  }
  const suffix = project[1] ?? ''
  if (!suffix) {
    return 'project'
  }
  if (suffix === '/summary') {
    return 'summary'
  }
  if (roomRoute.test(suffix)) {
    return 'room'
  }
  return conceptRoute.test(suffix) ? 'concept' : null
}

export function allowsPilotAnalytics(privacy: {
  doNotTrack?: string | null
  windowDoNotTrack?: string | null
  globalPrivacyControl?: boolean
}): boolean {
  return (
    !privacy.globalPrivacyControl &&
    ![privacy.doNotTrack, privacy.windowDoNotTrack].some(
      (value) => value === '1' || value === 'yes',
    )
  )
}

/** Последний фильтр перед отправкой: не доверяем автоматически добавленным полям SDK. */
export function sanitizePilotEvent(
  event: CaptureResult | null,
  publicKey: string,
  allowed: boolean,
): CaptureResult | null {
  if (!event || typeof event.uuid !== 'string' || !anonymousId.test(event.uuid)) {
    return null
  }
  const properties = event.properties
  if (
    !allowed ||
    event.event !== PILOT_STAGE_EVENT ||
    !stages.includes(properties.stage as PilotStage) ||
    properties.funnel_version !== 1 ||
    properties.token !== publicKey ||
    typeof properties.distinct_id !== 'string' ||
    !anonymousId.test(properties.distinct_id)
  ) {
    return null
  }

  const safeProperties: Record<string, unknown> = {
    stage: properties.stage,
    funnel_version: 1,
    token: publicKey,
    distinct_id: properties.distinct_id,
    $process_person_profile: false,
    $geoip_disable: true,
  }
  for (const name of ['$session_id', '$window_id']) {
    const value = properties[name]
    if (typeof value === 'string' && anonymousId.test(value)) {
      safeProperties[name] = value
    }
  }

  // Не переносим $set/$set_once или произвольные верхнеуровневые поля.
  return {
    event: PILOT_STAGE_EVENT,
    properties: safeProperties,
    timestamp: event.timestamp instanceof Date ? event.timestamp : undefined,
    uuid: event.uuid,
  }
}
