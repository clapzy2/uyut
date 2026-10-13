import type { PagePoint, PdfPaintBounds } from './plan-pdf-linework'
import { pdfPaintInventoryIsComplete } from './plan-pdf-paint-exclusion'

/**
 * Known later paint that may cover a whole caption envelope. A null result or
 * an empty list is not proof that the caption remains visible: text paint can
 * have no spatial envelope in the PDF operator inventory.
 */
export function nativeCaptionKnownPaintBlockers(
  paint: PdfPaintBounds | undefined,
  sourceOperations: readonly number[],
  polygon: readonly PagePoint[],
): number[] | null {
  if (
    !pdfPaintInventoryIsComplete(paint) ||
    sourceOperations.length === 0 ||
    sourceOperations.some((operation) => !Number.isSafeInteger(operation) || operation < 0) ||
    polygon.length < 3 ||
    polygon.some(
      (point) =>
        !point ||
        !Number.isFinite(point.x) ||
        !Number.isFinite(point.y) ||
        point.x < 0 ||
        point.x > 1000 ||
        point.y < 0 ||
        point.y > 1000,
    )
  )
    return null

  const source = new Set(sourceOperations)
  const firstOperation = Math.min(...sourceOperations)
  const left = Math.min(...polygon.map((point) => point.x))
  const right = Math.max(...polygon.map((point) => point.x))
  const top = Math.min(...polygon.map((point) => point.y))
  const bottom = Math.max(...polygon.map((point) => point.y))
  const padding = 0.0005 + 1024 * Number.EPSILON * Math.max(1, right, bottom)

  return (paint as PdfPaintBounds).events
    .filter((event) => {
      const bounds = event.bounds
      if (event.operationIndex <= firstOperation || source.has(event.operationIndex)) return false
      // Text shows have no spatial envelope in this inventory. They cannot
      // establish visibility, but would suppress every grouped caption here.
      // An unbounded non-text operation can cover the whole caption.
      if (bounds === null) return event.kind !== 'text'
      return (
        bounds.left <= right + padding &&
        bounds.right >= left - padding &&
        bounds.top <= bottom + padding &&
        bounds.bottom >= top - padding
      )
    })
    .map((event) => event.operationIndex)
}
