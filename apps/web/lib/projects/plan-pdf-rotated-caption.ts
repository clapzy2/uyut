import {
  type NativeDimensionCaptionContext,
  nativeCaptionInkIssue,
  nativeDimensionCaptionMillimetres,
} from './plan-pdf-caption-binding'
import {
  type PdfNativePageDimensionChain,
  preparePdfNativeWidthCaptionVerifier,
} from './plan-pdf-dimension-chain'
import {
  pdfNativeDimensionChainIsUnobscured,
  pdfNativeDimensionSourceIssue,
} from './plan-pdf-dimension-source'
import type { PagePoint, PdfLinework } from './plan-pdf-linework'
import type { PdfPlanSource } from './plan-pdf-room-binding'

type Caption = NativeDimensionCaptionContext['items'][number]
type Label = PagePoint & { index: number; text: string; rotation: number }
type Frame = { rotation: number }

const ANGLE_ARITHMETIC_EPSILON = 1e-6
// Survey captions can carry more than 32 distinct original baseline angles.
// Capacity does not enlarge the independently enforced total search budget.
const MAX_FRAMES = 64
const MAX_WORK = 4_000_000
const normalAngle = (angle: number) => ((angle % 360) + 360) % 360
const angleDistance = (first: number, second: number) => {
  const difference = Math.abs(normalAngle(first) - normalAngle(second))
  return Math.min(difference, 360 - difference)
}
const pointValid = (point: PagePoint) =>
  !!point &&
  [point.x, point.y].every((value) => Number.isFinite(value) && value >= 0 && value <= 1000)

/** Classification only; the source run's rotation is never rewritten. */
export function nativeCaptionDimensionAxis(rotation: number): 'width' | 'depth' | 'aligned' {
  if ([0, 180].some((angle) => angleDistance(rotation, angle) <= ANGLE_ARITHMETIC_EPSILON))
    return 'width'
  if ([90, 270].some((angle) => angleDistance(rotation, angle) <= ANGLE_ARITHMETIC_EPSILON))
    return 'depth'
  return 'aligned'
}

/**
 * A private physical-point projection reuses the strict caption matcher. Its
 * endpoints are looked up in the unchanged source, never inverse-calculated.
 * This is not metric calibration, ownership or a 2D/3D acceptance operation.
 */
export function createRotatedNativeCaptionVerifier(
  work: PdfLinework,
  source: PdfPlanSource,
  context: NativeDimensionCaptionContext,
): (label: Label, valueMm: number) => PdfNativePageDimensionChain {
  const fail = (reason: string): PdfNativePageDimensionChain => ({ status: 'unresolved', reason })
  const sourceIssue = pdfNativeDimensionSourceIssue(source, work, 'bounded-clipped-ink')
  if (sourceIssue) return () => fail(sourceIssue)
  const physical = (point: PagePoint) => ({
    x: (point.x * work.pageWidth) / 1000,
    y: (point.y * work.pageHeight) / 1000,
  })
  const baselineRotation = (caption: Caption) => {
    const start = physical(caption.baselineStart)
    const end = physical(caption.baselineEnd)
    return (-Math.atan2(end.y - start.y, end.x - start.x) * 180) / Math.PI
  }
  if (
    context.complete !== true ||
    context.source.sha256 !== source.sha256 ||
    context.source.pdfPage !== source.pdfPage ||
    context.source.pageWidth !== work.pageWidth ||
    context.source.pageHeight !== work.pageHeight ||
    context.items.length > 1000 ||
    new Set(context.items.map((caption) => caption.index)).size !== context.items.length ||
    context.items.some((caption: Caption) => {
      if (
        !Number.isSafeInteger(caption.index) ||
        caption.index < 0 ||
        nativeDimensionCaptionMillimetres(caption.text) === undefined ||
        !Number.isFinite(caption.rotation) ||
        ![caption.origin, caption.baselineStart, caption.baselineEnd].every(pointValid) ||
        Math.abs(caption.origin.x - caption.baselineStart.x) > 1e-6 ||
        Math.abs(caption.origin.y - caption.baselineStart.y) > 1e-6 ||
        (caption.baselineStart.x === caption.baselineEnd.x &&
          caption.baselineStart.y === caption.baselineEnd.y) ||
        angleDistance(baselineRotation(caption), caption.rotation) > ANGLE_ARITHMETIC_EPSILON
      )
        return true
      if (
        caption.inkRefusal !== undefined &&
        (typeof caption.inkRefusal !== 'string' ||
          !caption.inkRefusal ||
          caption.inkRefusal.length > 128)
      )
        return true
      if (caption.inkPolygon === undefined)
        return caption.inkSourceOperation !== undefined || caption.inkSourceOperations !== undefined
      return (
        !Array.isArray(caption.inkPolygon) ||
        caption.inkPolygon.length !== 4 ||
        !caption.inkPolygon.every(pointValid) ||
        new Set(caption.inkPolygon.map((point) => `${point.x}:${point.y}`)).size !== 4 ||
        !Number.isSafeInteger(caption.inkSourceOperation) ||
        (caption.inkSourceOperation ?? -1) < 0 ||
        caption.inkRefusal !== undefined
      )
    })
  )
    return () => fail('rotated-caption-context-invalid')
  if (nativeCaptionInkIssue(context, work)) return () => fail('rotated-caption-context-invalid')

  const byIndex = new Map(context.items.map((caption) => [caption.index, caption]))
  const frames: Frame[] = []
  const frameByIndex = new Map<number, Frame>()
  // A stable original run chooses each frame, not the order of verifier queries.
  for (const caption of [...context.items].sort((left, right) => left.index - right.index)) {
    let rotation = normalAngle(baselineRotation(caption))
    const cardinal = [0, 90, 180, 270].find(
      (angle) => angleDistance(rotation, angle) <= ANGLE_ARITHMETIC_EPSILON,
    )
    if (cardinal !== undefined) rotation = cardinal
    let frame = frames.find(
      (candidate) => angleDistance(candidate.rotation, rotation) <= ANGLE_ARITHMETIC_EPSILON,
    )
    if (!frame) {
      frame = { rotation }
      frames.push(frame)
    }
    frameByIndex.set(caption.index, frame)
  }
  if (frames.length > MAX_FRAMES) return () => fail('rotated-caption-budget-exceeded')

  const projectFrame = (frame: Frame) => {
    const angle = (-frame.rotation * Math.PI) / 180
    const cos = Math.cos(angle)
    const sin = Math.sin(angle)
    const rotate = (point: PagePoint) => ({
      x: point.x * cos + point.y * sin,
      y: -point.x * sin + point.y * cos,
    })
    const corners = [
      { x: 0, y: 0 },
      { x: work.pageWidth, y: 0 },
      { x: work.pageWidth, y: work.pageHeight },
      { x: 0, y: work.pageHeight },
    ].map(rotate)
    const left = Math.min(...corners.map((point) => point.x))
    const top = Math.min(...corners.map((point) => point.y))
    const width = Math.max(...corners.map((point) => point.x)) - left
    const height = Math.max(...corners.map((point) => point.y)) - top
    const project = (point: PagePoint) => {
      const rotated = rotate(physical(point))
      return {
        x: ((rotated.x - left) * 1000) / width,
        y: ((rotated.y - top) * 1000) / height,
      }
    }
    const originals = new Map<PagePoint, PagePoint>()
    const paths = work.paths.map((path) => ({
      ...path,
      points: path.points.map((point) => {
        const projected = project(point)
        originals.set(projected, point)
        return projected
      }),
    }))
    const items = context.items.map((original: Caption): Caption => {
      let rotation = normalAngle(original.rotation - frame.rotation)
      const cardinal = [0, 90, 180, 270].find(
        (angle) => angleDistance(rotation, angle) <= ANGLE_ARITHMETIC_EPSILON,
      )
      if (cardinal !== undefined) rotation = cardinal
      return {
        ...structuredClone(original),
        rotation,
        origin: project(original.origin),
        baselineStart: project(original.baselineStart),
        baselineEnd: project(original.baselineEnd),
        ...(original.inkPolygon ? { inkPolygon: original.inkPolygon.map(project) } : {}),
      }
    })
    return {
      work: { ...work, pageWidth: width, pageHeight: height, paths },
      context: {
        ...context,
        source: { ...context.source, pageWidth: width, pageHeight: height },
        items,
      },
      originals,
    }
  }
  const projectedFrames = new Map<
    Frame,
    ReturnType<typeof projectFrame> & {
      verify: NonNullable<ReturnType<typeof preparePdfNativeWidthCaptionVerifier>['verify']>
    }
  >()
  let reservedWork = 0
  for (const frame of frames) {
    const projected = projectFrame(frame)
    const search = preparePdfNativeWidthCaptionVerifier(
      projected.work,
      source,
      projected.context,
      MAX_WORK - reservedWork,
    )
    if (search.status !== 'checked') return () => fail('rotated-caption-budget-exceeded')
    const spans = search.spanCount
    const queries = context.items.filter(
      (caption) => frameByIndex.get(caption.index) === frame,
    ).length
    const captions = projected.context.items.filter(
      (caption) => caption.rotation === 0 || caption.rotation === 180,
    ).length
    // Prepared spans stay private to this unchanged source-frame verifier.
    // The matcher has its own 200k comparison cap; unused capacity is not work.
    const matcherWork = Math.min(
      200_001,
      (spans * (spans - 1)) / 2 + spans * captions + queries * spans * (spans + 1),
    )
    reservedWork += search.workCount + context.items.length * 8 + spans * 8 + matcherWork
    if (reservedWork > MAX_WORK) return () => fail('rotated-caption-budget-exceeded')
    projectedFrames.set(frame, { ...projected, verify: search.verify })
  }

  const prepared = new Map<
    Frame,
    {
      verify: NonNullable<ReturnType<typeof preparePdfNativeWidthCaptionVerifier>['verify']>
      captions: Map<number, Caption>
      originals: Map<PagePoint, PagePoint>
    }
  >()
  const cache = new Map<number, PdfNativePageDimensionChain>()
  return (label, valueMm) => {
    const caption = byIndex.get(label.index)
    const frame = frameByIndex.get(label.index)
    if (
      !caption ||
      !frame ||
      label.text !== caption.text ||
      label.rotation !== caption.rotation ||
      label.x !== caption.origin.x ||
      label.y !== caption.origin.y ||
      valueMm !== nativeDimensionCaptionMillimetres(caption.text)
    )
      return fail('rotated-caption-context-invalid')
    const prior = cache.get(label.index)
    if (prior) return structuredClone(prior)
    let ready = prepared.get(frame)
    if (!ready) {
      const projected = projectedFrames.get(frame)
      if (!projected) return fail('rotated-caption-context-invalid')
      ready = {
        verify: projected.verify,
        captions: new Map(projected.context.items.map((item) => [item.index, item])),
        originals: projected.originals,
      }
      prepared.set(frame, ready)
    }
    const projected = ready.captions.get(label.index)
    if (!projected) return fail('rotated-caption-context-invalid')
    const result = ready.verify(
      [{ index: label.index, text: label.text, rotation: projected.rotation, ...projected.origin }],
      valueMm,
      'width',
    )
    if (result.status !== 'candidate') {
      cache.set(label.index, result)
      return structuredClone(result)
    }
    const segments = result.segments.flatMap((segment) => {
      const start = ready.originals.get(segment.start)
      const end = ready.originals.get(segment.end)
      return start && end ? [{ ...segment, start, end }] : []
    })
    const start = segments[0]?.start
    const end = segments.at(-1)?.end
    if (segments.length !== result.segments.length || !start || !end)
      return fail('rotated-caption-non-native-endpoint')
    const original: PdfNativePageDimensionChain = {
      ...result,
      axis: nativeCaptionDimensionAxis(label.rotation),
      ends: [start, end],
      segments,
    }
    // Omission bounds belong to the unchanged source frame, not the private
    // rotated matcher. Check complete caption ink and span after mapping back.
    if (!pdfNativeDimensionChainIsUnobscured(work, original, [{ ...label, ...caption }])) {
      const held = fail('omitted-ink-near-source-caption-rail')
      cache.set(label.index, held)
      return structuredClone(held)
    }
    cache.set(label.index, original)
    return structuredClone(original)
  }
}
