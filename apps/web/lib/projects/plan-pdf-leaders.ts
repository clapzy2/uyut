import {
  type PagePoint,
  type PdfLinework,
  type PdfVectorPath,
  pdfVectorRectangle,
} from './plan-pdf-linework'

type PathId = { operationIndex: number; subpathIndex: number }
export type PdfVectorArrow = { path: PathId; tip: PagePoint; base: PagePoint }
type Arrow = PdfVectorArrow
type Segment = { path: PathId; start: PagePoint; end: PagePoint }
export type PdfCalloutLeader =
  | { status: 'candidate'; box: PathId; arrow: Arrow; stem: PathId[]; roomSourceNumber: null }
  | { status: 'ambiguous' | 'unresolved'; reason: string; roomSourceNumber: null }

/** Narrow filled triangles only; label glyphs and broad decorative triangles are excluded. */
export function pdfVectorArrow(work: PdfLinework, path: PdfVectorPath): PdfVectorArrow | undefined {
  if (!path.closed || path.paint === 'stroke' || path.points.length > 4) return undefined
  const physical = (p: PagePoint) => ({
    x: (p.x * work.pageWidth) / 1000,
    y: (p.y * work.pageHeight) / 1000,
  })
  const distance = (a: PagePoint, b: PagePoint) => {
    const p = physical(a)
    const q = physical(b)
    return Math.hypot(p.x - q.x, p.y - q.y)
  }
  const points = path.points.filter(
    (p, i) => !path.points.slice(0, i).some((q) => distance(p, q) <= 0.12),
  )
  if (points.length !== 3) return undefined
  for (const [index, tip] of points.entries()) {
    const [a, b] = points.filter((_, i) => i !== index)
    if (!a || !b) continue
    const base = { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 }
    const width = distance(a, b)
    const length = distance(tip, base)
    const ta = physical(tip)
    const ba = physical(base)
    const pa = physical(a)
    const pb = physical(b)
    const skew =
      Math.abs((ta.x - ba.x) * (pa.x - pb.x) + (ta.y - ba.y) * (pa.y - pb.y)) / (length * width)
    if (
      width >= 0.2 &&
      width <= 4 &&
      length >= 1 &&
      length <= 10 &&
      length / width >= 2.5 &&
      length / width <= 12 &&
      skew <= 0.15
    ) {
      return {
        path: { operationIndex: path.operationIndex, subpathIndex: path.subpathIndex },
        tip,
        base,
      }
    }
  }
  return undefined
}

/** Trace only endpoint connections. Crossed lines and the nearest room are not connections. */
export function pdfCalloutLeader(work: PdfLinework, label: PagePoint): PdfCalloutLeader {
  const unresolved = (reason: string): PdfCalloutLeader => ({
    status: 'unresolved',
    reason,
    roomSourceNumber: null,
  })
  if (work.truncated || work.unsupportedContexts > 0 || work.unsupportedPaths > 0)
    return unresolved('incomplete-vector-layer')
  if (
    ![label.x, label.y, work.pageWidth, work.pageHeight].every(Number.isFinite) ||
    work.pageWidth <= 0 ||
    work.pageHeight <= 0
  )
    return unresolved('invalid-page-coordinates')
  if (label.x < 0 || label.x > 1000 || label.y < 0 || label.y > 1000)
    return unresolved('invalid-page-coordinates')
  const physical = (p: PagePoint): PagePoint => ({
    x: (p.x * work.pageWidth) / 1000,
    y: (p.y * work.pageHeight) / 1000,
  })
  const distance = (a: PagePoint, b: PagePoint): number => {
    const p = physical(a)
    const q = physical(b)
    return Math.hypot(p.x - q.x, p.y - q.y)
  }
  const matches = (a: PagePoint, b: PagePoint): boolean => distance(a, b) <= 0.12
  const boxes = work.paths.flatMap((path) => {
    const box = path.paint === 'stroke' ? pdfVectorRectangle(path) : undefined
    if (
      !box ||
      label.x <= box.left ||
      label.x >= box.right ||
      label.y <= box.top ||
      label.y >= box.bottom
    )
      return []
    const width = ((box.right - box.left) * work.pageWidth) / 1000
    const height = ((box.bottom - box.top) * work.pageHeight) / 1000
    return width >= 20 && width <= 200 && height >= 5 && height <= 45 ? [{ path, box }] : []
  })
  if (boxes.length !== 1)
    return boxes.length > 1
      ? { status: 'ambiguous', reason: 'multiple-label-boxes', roomSourceNumber: null }
      : unresolved('no-unique-label-box')
  const chosen = boxes[0]
  if (!chosen) return unresolved('no-unique-label-box')
  const { box } = chosen
  const onBox = (p: PagePoint): boolean => {
    const clamped = {
      x: Math.max(box.left, Math.min(box.right, p.x)),
      y: Math.max(box.top, Math.min(box.bottom, p.y)),
    }
    if (distance(p, clamped) > 0.12) return false
    return (
      Math.min(
        distance(p, { x: box.left, y: p.y }),
        distance(p, { x: box.right, y: p.y }),
        distance(p, { x: p.x, y: box.top }),
        distance(p, { x: p.x, y: box.bottom }),
      ) <= 0.12
    )
  }
  const arrows: Arrow[] = []
  const segments: Segment[] = []
  const id = (path: PdfVectorPath): PathId => ({
    operationIndex: path.operationIndex,
    subpathIndex: path.subpathIndex,
  })
  for (const path of work.paths) {
    if (path.closed && path.paint !== 'stroke') {
      const arrow = pdfVectorArrow(work, path)
      if (arrow) arrows.push(arrow)
    } else if (!path.closed && path.paint === 'stroke') {
      for (let index = 1; index < path.points.length; index++) {
        const start = path.points[index - 1]
        const end = path.points[index]
        if (start && end && distance(start, end) > 0.12)
          segments.push({ path: id(path), start, end })
      }
    }
  }
  const candidates: Array<{ arrow: Arrow; stem: PathId[] }> = []
  const starts = segments.flatMap((segment, index) =>
    onBox(segment.start) && !onBox(segment.end)
      ? [{ index, point: segment.end }]
      : onBox(segment.end) && !onBox(segment.start)
        ? [{ index, point: segment.start }]
        : [],
  )
  if (starts.length > 1)
    return { status: 'ambiguous', reason: 'multiple-connected-leaders', roomSourceNumber: null }
  let branching = false
  for (const start of starts) {
    const visited = new Set([start.index])
    const initial = segments[start.index]
    if (!initial) continue
    const stem = [initial.path]
    let current = start.point
    for (let hop = 0; hop < 8; hop++) {
      const ends = arrows.filter((arrow) => matches(current, arrow.base))
      const next = segments.flatMap((segment, index) => {
        if (visited.has(index)) return []
        if (matches(current, segment.start)) return [{ index, point: segment.end }]
        if (matches(current, segment.end)) return [{ index, point: segment.start }]
        return []
      })
      if (next.length > 1 || (ends.length > 0 && next.length > 0)) {
        branching = true
        break
      }
      if (ends.length > 0) {
        for (const arrow of ends) candidates.push({ arrow, stem: [...stem] })
        break
      }
      const step = next[0]
      const segment = step ? segments[step.index] : undefined
      if (!step || !segment) break
      visited.add(step.index)
      stem.push(segment.path)
      current = step.point
    }
  }
  if (branching || candidates.length > 1)
    return { status: 'ambiguous', reason: 'multiple-connected-leaders', roomSourceNumber: null }
  const candidate = candidates[0]
  if (!candidate) return unresolved('no-connected-arrow-base')
  return { status: 'candidate', box: id(chosen.path), ...candidate, roomSourceNumber: null }
}
