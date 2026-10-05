import { describe, expect, it } from 'vitest'
import {
  allowsPilotAnalytics,
  getPilotStage,
  PILOT_STAGE_EVENT,
  sanitizePilotEvent,
} from './analytics'

const id = 'f9a9e590-1163-4e5a-ab59-81bbe6da23b7'
const publicKey = 'phc_public_test_key'

describe('этапы минимальной воронки', () => {
  it.each([
    ['/', 'landing'],
    ['/register', 'registration'],
    ['/login', 'login'],
    ['/projects', 'projects'],
    ['/onboarding/step-1', 'onboarding_1'],
    ['/onboarding/step-2', 'onboarding_2'],
    ['/onboarding/step-3', 'onboarding_3'],
    ['/onboarding/step-4', 'onboarding_4'],
    ['/onboarding/step-5', 'onboarding_5'],
    [`/projects/${id}`, 'project'],
    [`/projects/${id}/rooms/${id}`, 'room'],
    [`/projects/${id}/rooms/${id}/concepts/${id}`, 'concept'],
    [`/projects/${id}/summary`, 'summary'],
  ])('определяет %s без идентификаторов', (pathname, stage) => {
    expect(getPilotStage(pathname)).toBe(stage)
  })

  it.each([
    '/reset-password',
    '/verify-email',
    `/invites/${id}`,
    '/api/auth/get-session',
    '/legal/privacy',
    '/profile',
    '/onboarding/step-6',
    '/projects/название-квартиры',
    `/projects/${id}/rooms/private-name`,
    `/projects/${id}/summary/secret`,
    `/projects/${id}?token=secret`,
    '/constructor',
  ])('не отслеживает чувствительные и неизвестные маршруты: %s', (pathname) => {
    expect(getPilotStage(pathname)).toBeNull()
  })
})

describe('предпочтения приватности браузера', () => {
  it.each([
    { doNotTrack: '1' },
    { doNotTrack: 'yes' },
    { windowDoNotTrack: '1' },
    { globalPrivacyControl: true },
  ])('не разрешает отправку при %j', (privacy) => {
    expect(allowsPilotAnalytics(privacy)).toBe(false)
  })

  it('не отключает счётчик при явном DNT=0 или отсутствии запрета', () => {
    expect(allowsPilotAnalytics({})).toBe(true)
    expect(allowsPilotAnalytics({ doNotTrack: '0', globalPrivacyControl: false })).toBe(true)
  })
})

function event() {
  return {
    event: PILOT_STAGE_EVENT,
    timestamp: new Date('2026-10-05T12:00:00Z'),
    uuid: id,
    properties: {
      stage: 'concept',
      funnel_version: 1,
      token: publicKey,
      distinct_id: id,
      $session_id: id,
      $window_id: id,
    } as Record<string, unknown>,
  }
}

describe('фильтр отправки аналитики', () => {
  it('оставляет только фиксированный этап и анонимные идентификаторы SDK', () => {
    const input = {
      ...event(),
      $set: { email: 'private@example.test' },
      $set_once: { address: 'private' },
      properties: {
        ...event().properties,
        $current_url: `https://domitsa.ru/projects/${id}?token=secret`,
        $pathname: `/projects/${id}`,
        $referrer: 'https://mail.example.test/private',
        $initial_referrer: 'private',
        project_name: 'Моя личная квартира',
        note: 'Частные заметки',
        image: 'https://storage.example.test/private.png',
        email: 'private@example.test',
        $device_id: id,
        $geoip_disable: false,
        $geoip_latitude: 55.7,
        $set: { phone: 'private' },
      },
    }
    expect(sanitizePilotEvent(input, publicKey, true)).toEqual({
      ...event(),
      properties: {
        ...event().properties,
        $process_person_profile: false,
        $geoip_disable: true,
      },
    })
  })

  it.each(['$pageview', '$pageleave', '$autocapture', '$snapshot', '$identify', 'pdf_completed'])(
    'не пропускает незапланированное событие %s',
    (name) => {
      expect(sanitizePilotEvent({ ...event(), event: name }, publicKey, true)).toBeNull()
    },
  )

  it.each([
    ['stage', 'private-note'],
    ['funnel_version', 2],
    ['token', 'private-token'],
    ['distinct_id', 'private@example.test'],
    ['distinct_id', undefined],
  ])('отбрасывает неправильное обязательное поле %s', (name, value) => {
    const input = event()
    input.properties[name as string] = value
    expect(sanitizePilotEvent(input, publicKey, true)).toBeNull()
  })

  it('повторно проверяет запрет прямо перед отправкой', () => {
    expect(sanitizePilotEvent(event(), publicKey, false)).toBeNull()
  })

  it('не переносит посторонние значения вместо служебных идентификаторов', () => {
    const input = event()
    input.properties.$session_id = 'private-session-token'
    input.properties.$window_id = 'private-name'
    const output = sanitizePilotEvent(input, publicKey, true)
    expect(output?.properties).not.toHaveProperty('$session_id')
    expect(output?.properties).not.toHaveProperty('$window_id')
  })

  it('отбрасывает повреждённый конверт события', () => {
    expect(sanitizePilotEvent({ ...event(), uuid: 'private-note' }, publicKey, true)).toBeNull()
    expect(sanitizePilotEvent(null, publicKey, true)).toBeNull()
  })
})
