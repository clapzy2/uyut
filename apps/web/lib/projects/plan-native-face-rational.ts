// Private graph predicates. Keys originate only from validated source decimals
// or exact bounded crossings; rounded display points never drive topology.
type Fraction = { n: bigint; d: bigint }
type Point = { x: Fraction; y: Fraction }
function fraction(n: bigint, d = 1n): Fraction {
  if (d < 0n) return fraction(-n, -d)
  let a = n < 0n ? -n : n
  let b = d
  while (b) [a, b] = [b, a % b]
  const divisor = a || 1n
  return { n: n / divisor, d: d / divisor }
}
const add = (a: Fraction, b: Fraction) => fraction(a.n * b.d + b.n * a.d, a.d * b.d)
const subtract = (a: Fraction, b: Fraction) => fraction(a.n * b.d - b.n * a.d, a.d * b.d)
const multiply = (a: Fraction, b: Fraction) => fraction(a.n * b.n, a.d * b.d)
const compare = (a: Fraction, b: Fraction) => {
  const value = a.n * b.d - b.n * a.d
  return value < 0n ? -1 : value > 0n ? 1 : 0
}
function pointFromKey(key: string): Point {
  const coordinates = key.split(':').map((coordinate) => {
    const [n, d] = coordinate.split('/').map(BigInt)
    return fraction(n as bigint, d as bigint)
  })
  return { x: coordinates[0] as Fraction, y: coordinates[1] as Fraction }
}
function orientation(a: Point, b: Point, p: Point) {
  return subtract(
    multiply(subtract(b.x, a.x), subtract(p.y, a.y)),
    multiply(subtract(b.y, a.y), subtract(p.x, a.x)),
  ).n
}
const bounded = (a: Point, b: Point, point: Point) =>
  compare(point.x, a.x) * compare(point.x, b.x) <= 0 &&
  compare(point.y, a.y) * compare(point.y, b.y) <= 0
function touch(a: Point, b: Point, c: Point, d: Point) {
  const turns = [
    orientation(a, b, c),
    orientation(a, b, d),
    orientation(c, d, a),
    orientation(c, d, b),
  ]
  const sign = (value: bigint) => (value < 0n ? -1 : value > 0n ? 1 : 0)
  if (
    sign(turns[0] as bigint) * sign(turns[1] as bigint) < 0 &&
    sign(turns[2] as bigint) * sign(turns[3] as bigint) < 0
  )
    return true
  return (
    (turns[0] === 0n && bounded(a, b, c)) ||
    (turns[1] === 0n && bounded(a, b, d)) ||
    (turns[2] === 0n && bounded(c, d, a)) ||
    (turns[3] === 0n && bounded(c, d, b))
  )
}

export function nativeFaceRationalPredicates() {
  const points = new Map<string, Point>()
  const point = (key: string) => {
    let result = points.get(key)
    if (!result) {
      result = pointFromKey(key)
      points.set(key, result)
    }
    return result
  }
  const sharedSpan = (a: string, b: string, c: string, d: string) => {
    const first = point(a)
    const second = point(b)
    const third = point(c)
    const fourth = point(d)
    const axis = compare(first.x, second.x) === 0 ? 'y' : 'x'
    if (
      compare(first[axis], second[axis]) === 0 ||
      orientation(first, second, third) !== 0n ||
      orientation(first, second, fourth) !== 0n
    )
      return null
    const ordered = (start: string, end: string) =>
      compare(point(start)[axis], point(end)[axis]) <= 0 ? [start, end] : [end, start]
    const [firstStart, firstEnd] = ordered(a, b) as [string, string]
    const [secondStart, secondEnd] = ordered(c, d) as [string, string]
    const startKey =
      compare(point(firstStart)[axis], point(secondStart)[axis]) >= 0 ? firstStart : secondStart
    const endKey =
      compare(point(firstEnd)[axis], point(secondEnd)[axis]) <= 0 ? firstEnd : secondEnd
    return compare(point(startKey)[axis], point(endKey)[axis]) < 0 ? { startKey, endKey } : null
  }
  return {
    orientation(a: string, b: string, probe: string) {
      const turn = orientation(point(a), point(b), point(probe))
      return turn < 0n ? -1 : turn > 0n ? 1 : 0
    },
    winding(keys: string[]) {
      const polygon = keys.map(point)
      const area = polygon.reduce((sum, vertex, index) => {
        const next = polygon[(index + 1) % polygon.length] as Point
        return add(sum, subtract(multiply(vertex.x, next.y), multiply(next.x, vertex.y)))
      }, fraction(0n))
      return area.n < 0n ? -1 : area.n > 0n ? 1 : 0
    },
    sharedSpan,
    coversSpan(a: string, b: string, spans: { startKey: string; endKey: string }[]) {
      const target = sharedSpan(a, b, a, b)
      if (!target) return false
      const axis = compare(point(a).x, point(b).x) === 0 ? 'y' : 'x'
      const compareKeys = (first: string, second: string) =>
        compare(point(first)[axis], point(second)[axis])
      const contacts = spans
        .map((span) => sharedSpan(a, b, span.startKey, span.endKey))
        .filter((span) => span !== null)
        .sort((first, second) => compareKeys(first.startKey, second.startKey))
      let covered = target.startKey
      for (const contact of contacts) {
        if (compareKeys(contact.startKey, covered) > 0) return false
        if (compareKeys(contact.endKey, covered) > 0) covered = contact.endKey
        if (compareKeys(covered, target.endKey) === 0) return true
      }
      return false
    },
    equalSpanVectors(a: string, b: string, c: string, d: string) {
      const firstStart = point(a)
      const firstEnd = point(b)
      const secondStart = point(c)
      const secondEnd = point(d)
      return (
        compare(subtract(firstEnd.x, firstStart.x), subtract(secondEnd.x, secondStart.x)) === 0 &&
        compare(subtract(firstEnd.y, firstStart.y), subtract(secondEnd.y, secondStart.y)) === 0
      )
    },
    segmentsTouch(a: string, b: string, c: string, d: string) {
      return touch(point(a), point(b), point(c), point(d))
    },
    compareAxis(a: string, b: string, axis: 'x' | 'y') {
      return compare(point(a)[axis], point(b)[axis])
    },
    compareDirections(origin: string, a: string, b: string) {
      const center = point(origin)
      const left = { x: subtract(point(a).x, center.x), y: subtract(point(a).y, center.y) }
      const right = { x: subtract(point(b).x, center.x), y: subtract(point(b).y, center.y) }
      // Circular order from +X. Any consistent rotation gives the same faces.
      const half = (direction: Point) =>
        direction.y.n < 0n || (direction.y.n === 0n && direction.x.n < 0n) ? 1 : 0
      if (half(left) !== half(right)) return half(left) - half(right)
      const determinant = subtract(multiply(left.x, right.y), multiply(left.y, right.x)).n
      return determinant < 0n ? 1 : determinant > 0n ? -1 : 0
    },
    positiveAreaAtLeast(keys: string[], minimumArea: number) {
      const polygon = keys.map(point)
      const area = polygon.reduce((sum, vertex, index) => {
        const next = polygon[(index + 1) % polygon.length] as Point
        return add(sum, subtract(multiply(vertex.x, next.y), multiply(next.x, vertex.y)))
      }, fraction(0n))
      const [mantissa = '', exponent = '0'] = minimumArea.toString().split('e')
      const [whole = '', decimals = ''] = mantissa.split('.')
      const places = decimals.length - Number(exponent)
      const threshold =
        places < 0
          ? fraction(BigInt(whole + decimals) * 10n ** BigInt(-places) * 2n)
          : fraction(BigInt(whole + decimals) * 2n, 10n ** BigInt(places))
      return area.n > 0n && compare(area, threshold) >= 0
    },
    simple(keys: string[]) {
      if (keys.length < 3 || keys.length > 100 || new Set(keys).size !== keys.length) return false
      const polygon = keys.map(point)
      for (const [index, a] of polygon.entries()) {
        const b = polygon[(index + 1) % polygon.length] as Point
        const previous = polygon[(index + polygon.length - 1) % polygon.length] as Point
        if (
          orientation(previous, a, b) === 0n &&
          (bounded(a, b, previous) || bounded(previous, a, b))
        )
          return false
        for (let other = index + 2; other < polygon.length; other++) {
          if (index === 0 && other === polygon.length - 1) continue
          const c = polygon[other] as Point
          const d = polygon[(other + 1) % polygon.length] as Point
          if (touch(a, b, c, d)) return false
        }
      }
      return true
    },
    location(keys: string[], probe: string) {
      const polygon = keys.map(point)
      const candidate = point(probe)
      let winding = 0
      for (const [index, a] of polygon.entries()) {
        const b = polygon[(index + 1) % polygon.length] as Point
        const turn = orientation(a, b, candidate)
        if (turn === 0n && bounded(a, b, candidate)) return 'boundary'
        if (compare(a.y, candidate.y) <= 0 && compare(b.y, candidate.y) > 0 && turn > 0n) winding++
        if (compare(a.y, candidate.y) > 0 && compare(b.y, candidate.y) <= 0 && turn < 0n) winding--
      }
      return winding ? 'inside' : 'outside'
    },
  }
}
