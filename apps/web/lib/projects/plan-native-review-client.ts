import type { NativeReviewPacket } from './plan-native-review-packet'

export class NativeReviewRequestError extends Error {
  constructor(
    message: string,
    readonly status: number,
  ) {
    super(message)
  }
}

function isPacket(value: unknown, page: number, revision: string): value is NativeReviewPacket {
  if (!value || typeof value !== 'object') return false
  const packet = value as NativeReviewPacket
  if (
    packet.version !== 1 ||
    packet.coordinateSystem !== 'rendered-image-pixels' ||
    !['draft', 'unresolved'].includes(packet.status) ||
    packet.sourceRevision !== revision ||
    packet.source?.state !== 'existing' ||
    packet.source.pdfPage !== page ||
    !/^[a-f0-9]{64}$/.test(packet.source.sha256) ||
    packet.image?.page !== page ||
    !/^[a-f0-9]{64}$/.test(packet.image.sha256) ||
    ![packet.image.width, packet.image.height].every(
      (size) => Number.isSafeInteger(size) && size > 0 && size <= 10000,
    ) ||
    packet.readiness?.readOnly !== true ||
    packet.readiness.readyFor2D !== false ||
    packet.readiness.readyFor3D !== false ||
    !Array.isArray(packet.faces) ||
    packet.faces.length > 100 ||
    !Array.isArray(packet.issues) ||
    packet.issues.length > 20 ||
    !packet.counts ||
    [
      packet.counts.fillCandidates,
      packet.counts.strokeFaces,
      packet.counts.annotationHints,
      packet.counts.numberedAssociations,
      packet.counts.printedDimensions,
    ].some((count) => !Number.isSafeInteger(count) || count < 0 || count > 1000)
  )
    return false
  return (
    packet.faces.every(
      (face) =>
        face &&
        typeof face === 'object' &&
        typeof face.id === 'string' &&
        face.id.length <= 128 &&
        ['fill', 'stroke'].includes(face.layer) &&
        typeof face.annotationHint === 'boolean' &&
        (face.roomName === undefined ||
          (typeof face.roomName === 'string' && face.roomName.length <= 200)) &&
        Array.isArray(face.polygon) &&
        face.polygon.length >= 3 &&
        face.polygon.length <= 100 &&
        face.polygon.every(
          (point) =>
            point &&
            typeof point === 'object' &&
            Number.isFinite(point.x) &&
            Number.isFinite(point.y) &&
            point.x >= 0 &&
            point.y >= 0 &&
            point.x <= packet.image.width &&
            point.y <= packet.image.height,
        ),
    ) &&
    packet.issues.every(
      (issue) =>
        issue &&
        typeof issue === 'object' &&
        typeof issue.code === 'string' &&
        typeof issue.message === 'string' &&
        issue.message.length <= 1000,
    )
  )
}

/** Fetch an atomic private image/inspection pair; never calls a save or paid-reader action. */
export async function loadNativeReview(
  input: { projectId: string; page: number; revision: string; signal: AbortSignal },
  fetcher: typeof fetch = fetch,
) {
  const base = `/api/projects/${encodeURIComponent(input.projectId)}/plan-page`
  const query = new URLSearchParams({ page: String(input.page), revision: input.revision })
  const options = { signal: input.signal, cache: 'no-store' as const }
  const [jsonResponse, imageResponse] = await Promise.all([
    fetcher(`${base}?${query}&format=native-review`, options),
    fetcher(`${base}?${query}&format=native-review-image`, options),
  ])
  for (const response of [jsonResponse, imageResponse])
    if (!response.ok)
      throw new NativeReviewRequestError(
        (await response.text()).slice(0, 400) || 'Не удалось проверить исходный лист.',
        response.status,
      )
  const [value, blob] = await Promise.all([
    jsonResponse.json() as Promise<unknown>,
    imageResponse.blob(),
  ])
  if (!isPacket(value, input.page, input.revision))
    throw new NativeReviewRequestError('Ответ проверки не соответствует выбранному листу.', 422)
  if (
    !imageResponse.headers.get('content-type')?.startsWith('image/jpeg') ||
    imageResponse.headers.get('x-plan-sha256') !== value.source.sha256 ||
    imageResponse.headers.get('x-plan-image-sha256') !== value.image.sha256 ||
    imageResponse.headers.get('x-plan-page') !== String(input.page) ||
    imageResponse.headers.get('x-plan-image-width') !== String(value.image.width) ||
    imageResponse.headers.get('x-plan-image-height') !== String(value.image.height)
  )
    throw new NativeReviewRequestError(
      'Изображение и контуры относятся к разным версиям исходника.',
      409,
    )
  const digest = await crypto.subtle.digest('SHA-256', await blob.arrayBuffer())
  const hash = Array.from(new Uint8Array(digest), (byte) =>
    byte.toString(16).padStart(2, '0'),
  ).join('')
  if (hash !== value.image.sha256)
    throw new NativeReviewRequestError(
      'Изображение исходника изменилось. Откройте проверку заново.',
      409,
    )
  if (input.signal.aborted) throw new DOMException('Aborted', 'AbortError')
  return { packet: value, image: blob }
}
