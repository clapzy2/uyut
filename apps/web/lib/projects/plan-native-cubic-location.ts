import type { PagePoint, PdfCurvePath } from './plan-pdf-linework'

type ExactPoint = { x: bigint; y: bigint }
type Fraction = { numerator: string; denominator: string }
type RayProof = {
  segmentIndex: number
  parameterInterval: { lower: Fraction; upper: Fraction }
  xInterval: { lower: Fraction; upper: Fraction }
  crossesRight: boolean
}
export type ExactCubicLoopLocation = {
  location: 'inside' | 'outside' | 'boundary' | 'unresolved'
  reason?: string
  proof?: {
    method: 'exact-monotone-cubic-loop-ray'
    coordinateScale: string
    crossings: RayProof[]
    boundary?: { segmentIndex: number; parameter: Fraction }
  }
}

const MAX_DECIMAL_PLACES = 18
const MAX_BISECTIONS = 128
const samePoint = (a: ExactPoint, b: ExactPoint) => a.x === b.x && a.y === b.y
const minimum = (a: bigint, b: bigint) => (a < b ? a : b)
const maximum = (a: bigint, b: bigint) => (a > b ? a : b)

function decimal(value: number): { numerator: bigint; places: number } | null {
  if (!Number.isFinite(value) || value < 0 || value > 1000) return null
  const match = /^(\d+)(?:\.(\d+))?(?:e([+-]?\d+))?$/u.exec(String(value))
  if (!match?.[1]) return null
  const digits = `${match[1]}${match[2] ?? ''}`
  const places = (match[2]?.length ?? 0) - Number(match[3] ?? 0)
  if (places > MAX_DECIMAL_PLACES) return null
  if (places < 0) return { numerator: BigInt(digits) * 10n ** BigInt(-places), places: 0 }
  return { numerator: BigInt(digits), places }
}

function fraction(numerator: bigint, denominator: bigint): Fraction {
  let first = numerator < 0n ? -numerator : numerator
  let second = denominator
  while (second !== 0n) [first, second] = [second, first % second]
  const divisor = first || 1n
  return { numerator: String(numerator / divisor), denominator: String(denominator / divisor) }
}

function monotonic(values: bigint[]): boolean {
  const from = values[0] as bigint
  const to = values[3] as bigint
  if (from === to) return false
  return values
    .slice(1)
    .every((value, index) =>
      from < to ? value >= (values[index] as bigint) : value <= (values[index] as bigint),
    )
}

function cross(a: ExactPoint, b: ExactPoint, point: ExactPoint) {
  return (b.x - a.x) * (point.y - a.y) - (b.y - a.y) * (point.x - a.x)
}

/** A four-quarter loop with disjoint open control rectangles is provably simple.
 * This is an exact source-shape restriction, not a circle/ellipse fit.
 */
function loopIssue(quarters: ExactPoint[][]): string | null {
  const anchors = quarters.map((quarter) => quarter[0] as ExactPoint)
  const xs = [...new Set(anchors.map((point) => point.x))].sort((a, b) => (a < b ? -1 : 1))
  const ys = [...new Set(anchors.map((point) => point.y))].sort((a, b) => (a < b ? -1 : 1))
  if (xs.length !== 3 || ys.length !== 3) return 'unsupported-cubic-quarter-layout'
  const cardinal = [
    { x: xs[2] as bigint, y: ys[1] as bigint },
    { x: xs[1] as bigint, y: ys[2] as bigint },
    { x: xs[0] as bigint, y: ys[1] as bigint },
    { x: xs[1] as bigint, y: ys[0] as bigint },
  ]
  const positions = anchors.map((point) => cardinal.findIndex((anchor) => samePoint(point, anchor)))
  if (positions.some((position) => position < 0) || new Set(positions).size !== 4)
    return 'unsupported-cubic-quarter-layout'
  const direction = ((positions[1] as number) - (positions[0] as number) + 4) % 4
  if (
    (direction !== 1 && direction !== 3) ||
    positions.some(
      (position, index) =>
        ((positions[(index + 1) % 4] as number) - position + 4) % 4 !== direction,
    )
  )
    return 'unsupported-cubic-quarter-order'
  for (const quarter of quarters) {
    if (!monotonic(quarter.map((point) => point.x)) || !monotonic(quarter.map((point) => point.y)))
      return 'non-monotone-cubic-quarter'
    const [start, control1, control2, end] = quarter as [
      ExactPoint,
      ExactPoint,
      ExactPoint,
      ExactPoint,
    ]
    if (cross(start, end, control1) === 0n && cross(start, end, control2) === 0n)
      return 'degenerate-cubic-quarter'
  }
  return null
}

/** Exact Bernstein evaluation at numerator/denominator; the returned denominator is cubed. */
function evaluate(quarter: ExactPoint[], numerator: bigint, denominator: bigint): ExactPoint {
  const other = denominator - numerator
  const weights = [
    other ** 3n,
    3n * other ** 2n * numerator,
    3n * other * numerator ** 2n,
    numerator ** 3n,
  ]
  return quarter.reduce(
    (sum, point, index) => ({
      x: sum.x + point.x * (weights[index] as bigint),
      y: sum.y + point.y * (weights[index] as bigint),
    }),
    { x: 0n, y: 0n },
  )
}

/** Location in the actual four-cubic source loop, never its fitted ellipse or a snapped point. */
export function exactMonotoneCubicLoopLocation(
  source: PdfCurvePath | PdfCurvePath[],
  point: PagePoint,
): ExactCubicLoopLocation {
  const unresolved = (reason: string): ExactCubicLoopLocation => ({
    location: 'unresolved',
    reason,
  })
  const paths = Array.isArray(source) ? source : [source]
  if (paths.length < 1 || paths.length > 2) return unresolved('unsupported-cubic-loop')
  if (paths.length === 2) {
    const first = paths[0] as PdfCurvePath
    const second = paths[1] as PdfCurvePath
    if (
      paths.some(
        (path) =>
          !path ||
          path.closed ||
          path.paint !== 'stroke' ||
          path.subpathIndex !== 0 ||
          path.operationSubpathCount !== 1 ||
          !Number.isSafeInteger(path.operationIndex) ||
          path.operationIndex < 0 ||
          !Array.isArray(path.segments) ||
          path.segments.length !== 2 ||
          path.segments.some((part) => part.kind !== 'cubic'),
      ) ||
      first.operationIndex === second.operationIndex ||
      first.segments[1]?.end.x !== second.start.x ||
      first.segments[1]?.end.y !== second.start.y ||
      second.segments[1]?.end.x !== first.start.x ||
      second.segments[1]?.end.y !== first.start.y
    )
      return unresolved('unsupported-cubic-loop')
  }
  // Combine commands for evaluation only; callers retain both original source paths.
  const curve =
    paths.length === 1
      ? (paths[0] as PdfCurvePath)
      : {
          ...(paths[0] as PdfCurvePath),
          closed: true,
          segments: paths.flatMap((path) => path.segments),
        }
  if (
    !curve ||
    typeof curve !== 'object' ||
    curve.paint !== 'stroke' ||
    !curve.closed ||
    !Number.isSafeInteger(curve.operationIndex) ||
    curve.operationIndex < 0 ||
    curve.subpathIndex !== 0 ||
    curve.operationSubpathCount !== 1 ||
    !Array.isArray(curve.segments) ||
    curve.segments.length !== 4 ||
    curve.segments.some((segment) => segment?.kind !== 'cubic')
  )
    return unresolved('unsupported-cubic-loop')
  const originals = [
    curve.start,
    ...curve.segments.flatMap((segment) =>
      segment.kind === 'cubic' ? [segment.control1, segment.control2, segment.end] : [],
    ),
    point,
  ]
  if (
    originals.some((value) => !value || typeof value.x !== 'number' || typeof value.y !== 'number')
  )
    return unresolved('invalid-cubic-coordinate')
  const coordinates = originals.flatMap((value) => [decimal(value.x), decimal(value.y)])
  if (coordinates.some((value) => value === null)) return unresolved('unsupported-cubic-coordinate')
  const places = Math.max(...coordinates.map((value) => value?.places ?? 0))
  const scale = 10n ** BigInt(places)
  const exactPoints: ExactPoint[] = originals.map((_, index) => {
    const x = coordinates[index * 2] as NonNullable<ReturnType<typeof decimal>>
    const y = coordinates[index * 2 + 1] as NonNullable<ReturnType<typeof decimal>>
    return {
      x: x.numerator * 10n ** BigInt(places - x.places),
      y: y.numerator * 10n ** BigInt(places - y.places),
    }
  })
  const query = exactPoints.at(-1) as ExactPoint
  const quarters = Array.from({ length: 4 }, (_, index) =>
    exactPoints.slice(index * 3, index * 3 + 4),
  )
  if (!samePoint(quarters[0]?.[0] as ExactPoint, quarters[3]?.[3] as ExactPoint))
    return unresolved('unclosed-cubic-loop')
  const issue = loopIssue(quarters)
  if (issue) return unresolved(issue)
  const proof: NonNullable<ExactCubicLoopLocation['proof']> = {
    method: 'exact-monotone-cubic-loop-ray',
    coordinateScale: String(scale),
    crossings: [],
  }
  for (const [segmentIndex, quarter] of quarters.entries()) {
    if (samePoint(query, quarter[0] as ExactPoint))
      return {
        location: 'boundary',
        proof: { ...proof, boundary: { segmentIndex, parameter: fraction(0n, 1n) } },
      }
  }
  let rightCrossings = 0
  for (const [segmentIndex, quarter] of quarters.entries()) {
    const start = quarter[0] as ExactPoint
    const end = quarter[3] as ExactPoint
    // Half-open ranges count a shared y endpoint once, including local extrema twice.
    // At an extremum those two crossings cancel; exact source vertices were handled above.
    if (query.y < minimum(start.y, end.y) || query.y >= maximum(start.y, end.y)) continue
    let lower = 0n,
      upper = 1n,
      denominator = 1n
    let decided = false
    for (let iteration = 0; iteration <= MAX_BISECTIONS; iteration++) {
      const lowerValue = evaluate(quarter, lower, denominator)
      const upperValue = evaluate(quarter, upper, denominator)
      const cubicDenominator = denominator ** 3n
      const lowX = minimum(lowerValue.x, upperValue.x)
      const highX = maximum(lowerValue.x, upperValue.x)
      const queryX = query.x * cubicDenominator
      const queryY = query.y * cubicDenominator
      const record = (
        crossesRight: boolean,
        from = lower,
        to = upper,
        xFrom = lowX,
        xTo = highX,
      ) => {
        proof.crossings.push({
          segmentIndex,
          parameterInterval: {
            lower: fraction(from, denominator),
            upper: fraction(to, denominator),
          },
          xInterval: {
            lower: fraction(xFrom, cubicDenominator * scale),
            upper: fraction(xTo, cubicDenominator * scale),
          },
          crossesRight,
        })
        if (crossesRight) rightCrossings++
        decided = true
      }
      const endpoint =
        lowerValue.y === queryY
          ? { parameter: lower, value: lowerValue }
          : upperValue.y === queryY
            ? { parameter: upper, value: upperValue }
            : null
      if (endpoint) {
        if (endpoint.value.x === queryX)
          return {
            location: 'boundary',
            proof: {
              ...proof,
              boundary: { segmentIndex, parameter: fraction(endpoint.parameter, denominator) },
            },
          }
        record(
          endpoint.value.x > queryX,
          endpoint.parameter,
          endpoint.parameter,
          endpoint.value.x,
          endpoint.value.x,
        )
        break
      }
      if (highX < queryX || lowX > queryX) {
        record(lowX > queryX)
        break
      }
      if (iteration === MAX_BISECTIONS)
        return { location: 'unresolved', reason: 'cubic-ray-separation-limit', proof }
      // The interval endpoints become even dyadic numerators; the midpoint is odd.
      lower *= 2n
      upper *= 2n
      denominator *= 2n
      const middle = (lower + upper) / 2n
      const value = evaluate(quarter, middle, denominator)
      const targetY = query.y * denominator ** 3n
      if (value.y === targetY) {
        if (value.x === query.x * denominator ** 3n)
          return {
            location: 'boundary',
            proof: {
              ...proof,
              boundary: { segmentIndex, parameter: fraction(middle, denominator) },
            },
          }
        // This exact y root becomes both endpoints, so the next iteration records its x.
        lower = middle
        upper = middle
      } else if (value.y < targetY === start.y < end.y) lower = middle
      else upper = middle
    }
    if (!decided) return { location: 'unresolved', reason: 'cubic-ray-separation-limit', proof }
  }
  return { location: rightCrossings % 2 === 1 ? 'inside' : 'outside', proof }
}
