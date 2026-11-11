const side = 64
const offsets = [-side - 1, -side, -side + 1, -1, 0, 1, side - 1, side, side + 1]

// Quantize the direction of the strongest grayscale transitions. Keeping their
// polarity makes an unrelated dark-to-light edge a poor match for its reverse.
function prominentEdges(pixels: Buffer): Uint8Array {
  const strength = new Uint16Array(side * side)
  const direction = new Uint8Array(side * side)
  for (let y = 1; y < side - 1; y++) {
    for (let x = 1; x < side - 1; x++) {
      const i = y * side + x
      const dx = pixels.readUInt8(i + 1) - pixels.readUInt8(i - 1)
      const dy = pixels.readUInt8(i + side) - pixels.readUInt8(i - side)
      strength[i] = Math.abs(dx) + Math.abs(dy)
      direction[i] = 1 + ((Math.round((4 * Math.atan2(dy, dx)) / Math.PI) + 8) % 8)
    }
  }
  // Keep at most the strongest decile (including ties) above the noise floor.
  const ranked = strength.slice().sort()
  const cutoff = Math.max(24, ranked[Math.floor(ranked.length * 0.9)] ?? 0)
  return direction.map((angle, i) => ((strength[i] ?? 0) >= cutoff ? angle : 0))
}

function edgesAlign(from: Uint8Array, to: Uint8Array): boolean {
  let edges = 0
  let matches = 0
  const regionMatches = new Uint16Array(16)
  const axisMatches = new Uint16Array(4)
  for (let i = 0; i < from.length; i++) {
    const angle = from[i]
    if (!angle) continue
    edges++
    if (!offsets.some((offset) => to[i + offset] === angle)) continue
    matches++
    const axis = (angle - 1) % 4
    axisMatches[axis] = (axisMatches[axis] ?? 0) + 1
    const column = Math.floor((i % side) / (side / 4))
    const row = Math.floor(i / (side * (side / 4)))
    const region = row * 4 + column
    regionMatches[region] = (regionMatches[region] ?? 0) + 1
  }
  return (
    matches >= edges * 0.72 &&
    regionMatches.filter((count) => count >= 6).length >= 7 &&
    axisMatches.filter((count) => count >= 8).length >= 2
  )
}

async function framingPixels(
  original: Buffer,
  result: Buffer,
  aspectTolerance: number,
  size = side,
) {
  const { default: sharp } = await import('sharp')
  const images = [sharp(original), sharp(result)]
  const ratios = await Promise.all(
    images.map(async (image) => {
      const { autoOrient } = await image.metadata()
      return autoOrient.width / autoOrient.height
    }),
  )
  const [firstRatio = 0, secondRatio = 0] = ratios
  if (Math.max(firstRatio, secondRatio) > Math.min(firstRatio, secondRatio) * aspectTolerance)
    return null
  const [first, second] = await Promise.all(
    images.map((image) =>
      image
        .autoOrient()
        .resize(size, size, { fit: 'fill' })
        .removeAlpha()
        .greyscale()
        .raw()
        .toBuffer(),
    ),
  )
  if (!first || !second) return null
  return { first, second }
}

/** Conservative veto for opening claims. Alignment alone never establishes a change. */
export async function hasComparableFraming(original: Buffer, result: Buffer): Promise<boolean> {
  try {
    const pixels = await framingPixels(original, result, 1.04)
    if (!pixels) return false
    const { first, second } = pixels
    const firstEdges = prominentEdges(first)
    const secondEdges = prominentEdges(second)
    return edgesAlign(firstEdges, secondEdges) && edgesAlign(secondEdges, firstEdges)
  } catch {
    return false
  }
}

const siteSide = 192

/** Show the observer the same bounded pixels it was asked to classify, with no painted evidence. */
export async function cropOpeningSite(image: Buffer, box: readonly number[]): Promise<Buffer> {
  if (!openingBox(box)) throw new Error('Invalid opening site')
  const { default: sharp } = await import('sharp')
  const { autoOrient } = await sharp(image).metadata()
  const [x = 0, y = 0, width = 0, height = 0] = box
  const left = Math.ceil(x * autoOrient.width)
  const top = Math.ceil(y * autoOrient.height)
  return sharp(image)
    .autoOrient()
    .extract({
      left,
      top,
      width: Math.floor((x + width) * autoOrient.width) - left,
      height: Math.floor((y + height) * autoOrient.height) - top,
    })
    .png()
    .toBuffer()
}

type PixelBox = { left: number; top: number; right: number; bottom: number }

function openingBox(box: readonly number[]): PixelBox | null {
  if (!Array.isArray(box) || box.length !== 4 || !box.every(Number.isFinite)) return null
  const [x = -1, y = -1, width = 0, height = 0] = box
  if (x < 0 || y < 0 || x + width > 1 || y + height > 1 || width < 0.09 || height < 0.09)
    return null
  if (width * height < 0.035 || width * height > 0.45) return null
  return {
    left: Math.ceil(x * siteSide),
    top: Math.ceil(y * siteSide),
    right: Math.floor((x + width) * siteSide),
    bottom: Math.floor((y + height) * siteSide),
  }
}

function median(values: number[]) {
  return values.sort((a, b) => a - b)[Math.floor(values.length / 2)] ?? 0
}

const patchOffsets = Array.from(
  { length: 49 },
  (_, i) => (Math.floor(i / 7) - 3) * siteSide + (i % 7) - 3,
)

function patchStats(pixels: Buffer, center: number) {
  let sum = 0
  let squares = 0
  let xx = 0
  let yy = 0
  let xy = 0
  for (const offset of patchOffsets) {
    const i = center + offset
    const value = pixels.readUInt8(i)
    const dx = value - pixels.readUInt8(i - 1)
    const dy = value - pixels.readUInt8(i - siteSide)
    sum += value
    squares += value * value
    xx += dx * dx
    yy += dy * dy
    xy += dx * dy
  }
  // Require two-dimensional texture. A straight wall edge can slide along itself.
  const floor = patchOffsets.length * 2 ** 2
  if (xx <= floor || yy <= floor || (xx - floor) * (yy - floor) <= xy * xy) return null
  const mean = sum / patchOffsets.length
  const norm = Math.sqrt(squares - sum * mean)
  return norm > 0 ? { mean, norm } : null
}

type PatchMatch = { x: number; y: number; gain: number }

// Find high-correlation patches strictly at the same pixel coordinates.
function fixedMatches(first: Buffer, second: Buffer): PatchMatch[] {
  const matches = []
  for (let y = 4; y < siteSide; y += 4) {
    for (let x = 4; x < siteSide; x += 4) {
      const center = y * siteSide + x
      const a = patchStats(first, center)
      if (!a) continue
      const b = patchStats(second, center)
      if (!b) continue
      let product = 0
      for (const offset of patchOffsets) {
        const i = center + offset
        product += first.readUInt8(i) * second.readUInt8(i)
      }
      const covariance = product - patchOffsets.length * a.mean * b.mean
      if (covariance >= 0.95 * a.norm * b.norm) matches.push({ x, y, gain: b.norm / a.norm })
    }
  }
  return matches
}

function fixedFrameExposure(first: Buffer, second: Buffer, matches: PatchMatch[], box?: PixelBox) {
  const gains = []
  const matchedTiles = new Set<number>()
  const regions = new Set<number>()
  const quadrants = [0, 0, 0, 0]
  for (const { x, y, gain } of matches) {
    if (box && x + 3 >= box.left && x - 4 < box.right && y + 3 >= box.top && y - 4 < box.bottom)
      continue
    // Sample a second position in each axis to find thin details on blank
    // walls. Each 8x8 tile can supply at most one vote at zero displacement.
    const tile = Math.floor((x - 4) / 8) + (siteSide / 8) * Math.floor((y - 4) / 8)
    if (matchedTiles.has(tile)) continue
    gains.push(gain)
    matchedTiles.add(tile)
    regions.add(Math.floor(x / 32) + 6 * Math.floor(y / 32))
    const quadrant = Number(x >= siteSide / 2) + 2 * Number(y >= siteSide / 2)
    quadrants[quadrant] = (quadrants[quadrant] ?? 0) + 1
  }
  if (gains.length < 24 || regions.size < 10 || quadrants.filter((count) => count >= 2).length < 3)
    return null
  const gain = median(gains)
  if (gain < 0.5 || gain > 2) return null
  const deltas = []
  for (let y = 0; y < siteSide; y += 2) {
    for (let x = 0; x < siteSide; x += 2) {
      if (box && x >= box.left && x < box.right && y >= box.top && y < box.bottom) continue
      const i = siteSide * y + x
      deltas.push(second.readUInt8(i) - gain * first.readUInt8(i))
    }
  }
  // Estimate the global offset over the whole background, including blank walls.
  const offset = median(deltas)
  const stable = deltas.filter((delta) => Math.abs(delta - offset) <= 18).length
  return stable >= deltas.length * (box ? 0.75 : 0.65) ? { gain, offset } : null
}

// Average a 2x2 neighborhood so single-pixel noise cannot supply the changed area.
function blockMean(pixels: Buffer, i: number) {
  return (
    (pixels.readUInt8(i) +
      pixels.readUInt8(i - 1) +
      pixels.readUInt8(i - siteSide) +
      pixels.readUInt8(i - siteSide - 1)) /
    4
  )
}

function changedSite(first: Buffer, second: Buffer, box: PixelBox, gain: number, offset: number) {
  const { left, right, top, bottom } = box
  const cells = Array.from({ length: 9 }, () => ({
    area: 0,
    changed: 0,
    newEdges: 0,
    edgeProduct: 0,
    firstEnergy: 0,
    secondEnergy: 0,
  }))
  let changedPixels = 0
  for (let y = top + 1; y < bottom; y++) {
    for (let x = left + 1; x < right; x++) {
      const row = Math.floor((3 * (y - top - 1)) / (bottom - top - 1))
      const col = Math.floor((3 * (x - left - 1)) / (right - left - 1))
      const cell = cells[3 * row + col]
      if (!cell) continue
      cell.area++
      const i = y * siteSide + x
      const a = first.readUInt8(i)
      const b = second.readUInt8(i)
      const ax = gain * (a - first.readUInt8(i - 1))
      const ay = gain * (a - first.readUInt8(i - siteSide))
      const bx = b - second.readUInt8(i - 1)
      const by = b - second.readUInt8(i - siteSide)
      cell.edgeProduct += ax * bx + ay * by
      cell.firstEnergy += ax * ax + ay * ay
      cell.secondEnergy += bx * bx + by * by
      if (Math.abs(blockMean(second, i) - gain * blockMean(first, i) - offset) < 24) continue
      cell.changed++
      changedPixels++
      if (Math.max(Math.abs(bx - ax), Math.abs(by - ay)) >= 12) cell.newEdges++
    }
  }
  // Changed brightness alone, or the same edges under a local exposure shift,
  // cannot support a cut or infill. Require altered structure across the box.
  const broadChange = cells.filter((cell) => cell.changed >= 0.3 * cell.area)
  const structuralChange = broadChange.filter(
    (cell) =>
      cell.newEdges >= 0.05 * cell.area &&
      (cell.edgeProduct <= 0 ||
        cell.edgeProduct < 0.85 * Math.sqrt(cell.firstEnergy * cell.secondEnergy)),
  )
  return (
    broadChange.length >= 4 &&
    structuralChange.length >= 3 &&
    changedPixels >= Math.max(0.3 * (right - left) * (bottom - top), 0.02 * siteSide ** 2)
  )
}

/** Prepare once per image pair. Site-specific checks always exclude the claimed area from background evidence. */
export async function prepareLocalizedOpeningCheck(
  original: Buffer,
  result: Buffer,
): Promise<((box: readonly number[]) => boolean) | null> {
  try {
    const pixels = await framingPixels(original, result, 1.005, siteSide)
    if (!pixels) return null
    const { first, second } = pixels
    const matches = fixedMatches(first, second)
    if (!fixedFrameExposure(first, second, matches)) return null
    return (box) => {
      const site = openingBox(box)
      if (!site) return false
      const exposure = fixedFrameExposure(first, second, matches, site)
      return !!exposure && changedSite(first, second, site, exposure.gain, exposure.offset)
    }
  } catch {
    return null
  }
}
