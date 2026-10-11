import type { NativeTextAnchors } from './plan-document'
import { nativeStrokeFaceCandidates } from './plan-native-stroke-candidates'
import type { PdfLinework } from './plan-pdf-linework'
import { pdfBoundaryDistance, pdfPointInside } from './plan-pdf-room-binding'
import type { RegionLabelFrame } from './plan-raster-region-labels'

/** Layout/text hints, not proof that a face is a floor or permission to delete geometry. */
export function nativeFaceAnnotationCandidates(input: {
  native: NativeTextAnchors
  work: PdfLinework
  lineworkSource: RegionLabelFrame
}) {
  const geometry = nativeStrokeFaceCandidates(input)
  const { native, work } = input
  const scale = native.pageNormalizedScale
  const annotations = new Map<
    string,
    {
      faceId: string
      kind: 'table-header-cell' | 'table-column-cell' | 'sheet-metadata-cell'
      evidenceLabelIds: string[]
    }
  >()
  const finish = (refusalReason: string | null) => ({
    status: 'draft' as const,
    basis: 'native-face-annotation-layout-candidates' as const,
    geometry,
    annotations: refusalReason ? [] : [...annotations.values()],
    unknownFaceIds: geometry.candidates
      .filter((face) => refusalReason || !annotations.has(face.id))
      .map((face) => face.id),
    refusalReason,
    mayEraseSourceStrokes: false as const,
    roomRecognitionAccepted: false as const,
  })
  if (geometry.truncated) return finish(geometry.refusalReason)
  if (
    !native.complete ||
    !scale ||
    native.labels.length > 1000 ||
    new Set(native.labels.map((label) => label.id)).size !== native.labels.length
  )
    return finish('incomplete-native-text')
  if (
    native.labels.some(
      (label) =>
        !Number.isSafeInteger(label.nativeIndex) ||
        (label.nativeIndex ?? -1) < 0 ||
        label.id !== `native-text-${label.nativeIndex}` ||
        !label.name ||
        label.name !== label.name.trim() ||
        label.name.length > 200 ||
        !label.pagePoint ||
        !Number.isFinite(label.rotation) ||
        [label.pagePoint.x, label.pagePoint.y].some(
          (value) => !Number.isFinite(value) || value < 0 || value > 1000,
        ) ||
        ![label.point.x, label.point.y].every(Number.isFinite) ||
        Math.abs(label.point.x - label.pagePoint.x * scale.x) > 1e-6 ||
        Math.abs(label.point.y - label.pagePoint.y * scale.y) > 1e-6,
    )
  )
    return finish('invalid-native-text-provenance')
  const rectangles = geometry.candidates.flatMap((face) => {
    const bounds = {
      left: Math.min(...face.polygon.map((p) => p.x)),
      right: Math.max(...face.polygon.map((p) => p.x)),
      top: Math.min(...face.polygon.map((p) => p.y)),
      bottom: Math.max(...face.polygon.map((p) => p.y)),
    }
    const corners = new Set(face.polygon.map((p) => `${p.x}:${p.y}`))
    const allCorners = [
      { x: bounds.left, y: bounds.top },
      { x: bounds.right, y: bounds.top },
      { x: bounds.right, y: bounds.bottom },
      { x: bounds.left, y: bounds.bottom },
    ].every((p) => corners.has(`${p.x}:${p.y}`))
    const axisBoundary = face.polygon.every((p, index) => {
      const next = face.polygon[(index + 1) % face.polygon.length]
      return (
        next &&
        ((p.x === next.x && (p.x === bounds.left || p.x === bounds.right)) ||
          (p.y === next.y && (p.y === bounds.top || p.y === bounds.bottom)))
      )
    })
    return allCorners && axisBoundary ? [{ face, bounds }] : []
  })
  const horizontal = native.labels.filter((label) => Math.abs(label.rotation ?? Infinity) <= 1e-6)
  const owners = new Map(
    horizontal.map((label) => [
      label.id,
      rectangles.filter(
        ({ face }) =>
          label.pagePoint &&
          pdfPointInside(label.pagePoint, face.polygon) &&
          pdfBoundaryDistance(work, label.pagePoint, face.polygon) > 0.12,
      ),
    ]),
  )
  const normalized = (text: string) => text.toLocaleLowerCase('ru').replace(/\s+/gu, ' ')
  const headerPatterns = [/^(?:№|n[º°o])$/iu, /^наименование$/iu, /^площадь$/iu]
  const headers = headerPatterns.map((pattern) =>
    horizontal.filter((label) => pattern.test(label.name)),
  )
  if (headers.every((group) => group.length === 1)) {
    const labels = headers.flat(),
      cells = labels.map((label) => owners.get(label.id)?.[0])
    const allUnique =
      labels.every((label) => (owners.get(label.id)?.length ?? 0) === 1) &&
      new Set(cells.map((cell) => cell?.face.id)).size === 3
    if (
      allUnique &&
      labels.every(
        (label) =>
          label.pagePoint &&
          Math.abs(label.pagePoint.y - (labels[0]?.pagePoint?.y ?? Infinity)) <= 2,
      ) &&
      cells[0] &&
      cells[1] &&
      cells[2] &&
      cells[0].bounds.right === cells[1].bounds.left &&
      cells[1].bounds.right === cells[2].bounds.left &&
      cells.every(
        (cell) =>
          cell?.bounds.top === cells[0]?.bounds.top &&
          cell?.bounds.bottom === cells[0]?.bounds.bottom,
      )
    ) {
      const evidenceLabelIds = labels.map((label) => label.id)
      for (const cell of cells) {
        if (!cell) continue
        annotations.set(cell.face.id, {
          faceId: cell.face.id,
          kind: 'table-header-cell',
          evidenceLabelIds,
        })
      }
      let bottom = cells[0].bounds.bottom
      // A single continuing column is insufficient: require complete aligned rows.
      for (let row = 0; row < rectangles.length; row++) {
        const groups = cells.map((column) =>
          rectangles.filter(
            (entry) =>
              column &&
              entry.bounds.left === column.bounds.left &&
              entry.bounds.right === column.bounds.right &&
              entry.bounds.top === bottom,
          ),
        )
        if (groups.some((group) => group.length !== 1)) break
        const next = groups.flat()
        const nextBottom = next[0]?.bounds.bottom
        if (nextBottom === undefined || next.some((cell) => cell.bounds.bottom !== nextBottom))
          break
        for (const cell of next)
          annotations.set(cell.face.id, {
            faceId: cell.face.id,
            kind: 'table-column-cell',
            evidenceLabelIds,
          })
        bottom = nextBottom
      }
    }
  }
  const metadata =
    /^(?:стадия|лист|листов|масштаб:?|дата:?|согласовано:?|заказчик|наименование объекта:?|название чертежа:?|условные обозначения и примечания|дизайн[- ]проект (?:квартиры|апартаментов)(?: по адресу:?)?)$/iu
  for (const label of horizontal) {
    if (!metadata.test(normalized(label.name)) && !/^объект по адресу:/iu.test(label.name)) continue
    const cells = owners.get(label.id)
    if (cells?.length !== 1 || !cells[0]) continue
    const faceId = cells[0].face.id
    if (!annotations.has(faceId))
      annotations.set(faceId, { faceId, kind: 'sheet-metadata-cell', evidenceLabelIds: [label.id] })
  }
  return finish(null)
}
