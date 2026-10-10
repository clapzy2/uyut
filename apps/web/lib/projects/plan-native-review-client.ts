import type { NativeReviewPacket } from './plan-native-review-packet'

export class NativeReviewRequestError extends Error {
  constructor(
    message: string,
    readonly status: number,
  ) {
    super(message)
  }
}

function isCandidateLayer(value: unknown): boolean {
  if (!value || typeof value !== 'object') return false
  const layer = value as { status: unknown; refusalReason: unknown; candidates: unknown[] }
  return (
    (layer.status === 'draft' || layer.status === 'unresolved') &&
    Array.isArray(layer.candidates) &&
    layer.candidates.length <= 100 &&
    (layer.status === 'draft'
      ? layer.refusalReason === null
      : typeof layer.refusalReason === 'string' &&
        !!layer.refusalReason.trim() &&
        layer.refusalReason.length <= 128 &&
        layer.candidates.length === 0)
  )
}

function isInImage(value: unknown, image: NativeReviewPacket['image']): boolean {
  if (!value || typeof value !== 'object') return false
  const point = value as { x: number; y: number }
  return (
    Number.isFinite(point.x) &&
    Number.isFinite(point.y) &&
    point.x >= 0 &&
    point.y >= 0 &&
    point.x <= image.width &&
    point.y <= image.height
  )
}

function isDoorSymbols(value: unknown, image: NativeReviewPacket['image']): boolean {
  if (value === undefined) return true
  if (!isCandidateLayer(value)) return false
  const symbols = value as NonNullable<NativeReviewPacket['doorSymbols']>
  const inImage = (point: unknown) => isInImage(point, image)
  const ids = new Set<string>()
  return symbols.candidates.every((candidate) => {
    if (
      !candidate ||
      typeof candidate !== 'object' ||
      typeof candidate.id !== 'string' ||
      !candidate.id.trim() ||
      candidate.id.length > 128 ||
      ids.has(candidate.id) ||
      !candidate.arc ||
      !inImage(candidate.arc.start) ||
      !Array.isArray(candidate.arc.segments) ||
      candidate.arc.segments.length < 1 ||
      candidate.arc.segments.length > 4 ||
      !candidate.leaf ||
      !inImage(candidate.leaf.start) ||
      !inImage(candidate.leaf.end) ||
      !Number.isFinite(candidate.endpointResidualPixels) ||
      candidate.endpointResidualPixels < 0 ||
      candidate.endpointResidualPixels > 0.1
    )
      return false
    ids.add(candidate.id)
    return candidate.arc.segments.every(
      (segment) =>
        segment &&
        typeof segment === 'object' &&
        inImage(segment.control1) &&
        inImage(segment.control2) &&
        inImage(segment.end),
    )
  })
}

function isOpeningFrames(value: unknown, image: NativeReviewPacket['image']): boolean {
  if (value === undefined) return true
  if (!isCandidateLayer(value)) return false
  const frames = value as NonNullable<NativeReviewPacket['openingFrames']>
  const ids = new Set<string>()
  return frames.candidates.every((frame) => {
    if (
      !frame ||
      typeof frame !== 'object' ||
      typeof frame.id !== 'string' ||
      !frame.id.trim() ||
      frame.id.length > 128 ||
      ids.has(frame.id) ||
      !Array.isArray(frame.polygon) ||
      ![4, 5].includes(frame.polygon.length) ||
      !frame.polygon.every((point) => isInImage(point, image))
    )
      return false
    const first = frame.polygon[0]
    const last = frame.polygon.at(-1)
    if (!first || !last) return false
    if (frame.polygon.length === 5 && (first.x !== last.x || first.y !== last.y)) return false
    if (new Set(frame.polygon.slice(0, 4).map((point) => `${point.x}:${point.y}`)).size !== 4)
      return false
    ids.add(frame.id)
    return true
  })
}

function isSavedReview(value: unknown, source: NativeReviewPacket['source']): boolean {
  if (!value || typeof value !== 'object') return false
  const saved = value as NativeReviewPacket['savedReview']
  if (saved.status === 'not-saved') return true
  if (saved.status === 'unavailable')
    return ['native-layer-unavailable', 'unsupported-review-version'].includes(saved.reason)
  if (saved.status !== 'checked' || !saved.coverage || typeof saved.coverage !== 'object')
    return false
  const report = saved.coverage
  const boundedCount = (count: unknown, max = 100_000) =>
    Number.isSafeInteger(count) && typeof count === 'number' && count >= 0 && count <= max
  const statuses = [
    'paired',
    'opening',
    'unmatched',
    'unpaired-exterior',
    'ambiguous',
    'unsupported-angle',
    'conditional',
  ] as const
  if (
    !['refused', 'partial'].includes(report.status) ||
    report.source?.sha256 !== source.sha256 ||
    report.source.pdfPage !== source.pdfPage ||
    report.source.state !== source.state ||
    typeof report.extractionComplete !== 'boolean' ||
    !['missing', 'envelope-only', 'reviewed-floor', 'legacy-exterior-floor'].includes(
      report.floorBoundary,
    ) ||
    !Array.isArray(report.missingSourceNumbers) ||
    report.missingSourceNumbers.length > 100 ||
    report.missingSourceNumbers.some((number) => !boundedCount(number, 10_000) || number === 0) ||
    !boundedCount(report.wallPairs) ||
    !report.wallSource ||
    typeof report.wallSource.strictValid !== 'boolean' ||
    typeof report.wallSource.localAuditValid !== 'boolean' ||
    !report.wallSpans ||
    statuses.some((status) => !boundedCount(report.wallSpans[status])) ||
    'reviewSpans' in report ||
    typeof report.reviewSpansTruncated !== 'boolean' ||
    !report.openings ||
    Object.keys(report.openings).length !== 7 ||
    [
      report.openings.declaredDoors,
      report.openings.doorPairCandidates,
      report.openings.pairedDoorFaces,
      report.openings.unresolvedDoorChecks,
      report.openings.ambiguousDoorChecks,
      report.openings.uncheckedDoorFaces,
      report.openings.nonDoorDeclarations,
    ].some((count) => !boundedCount(count, 200)) ||
    report.openings.pairedDoorFaces !== report.openings.doorPairCandidates * 2 ||
    report.openings.pairedDoorFaces +
      report.openings.unresolvedDoorChecks +
      report.openings.ambiguousDoorChecks +
      report.openings.uncheckedDoorFaces >
      report.openings.declaredDoors ||
    !Array.isArray(report.issues) ||
    report.issues.length > 30 ||
    report.issues.some((issue) => typeof issue !== 'string' || !issue || issue.length > 128) ||
    report.readiness?.readOnly !== true ||
    report.readiness.readyFor2D !== false ||
    report.readiness.readyFor3D !== false ||
    (report.status === 'refused' &&
      (typeof report.refusalReason !== 'string' ||
        !report.refusalReason ||
        report.refusalReason.length > 128))
  )
    return false
  return true
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
    !isSavedReview(packet.savedReview, packet.source) ||
    !isDoorSymbols(packet.doorSymbols, packet.image) ||
    !isOpeningFrames(packet.openingFrames, packet.image) ||
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
