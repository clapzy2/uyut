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

/** Conservative veto for opening claims. Alignment alone never establishes a change. */
export async function hasComparableFraming(original: Buffer, result: Buffer): Promise<boolean> {
  try {
    const { default: sharp } = await import('sharp')
    const images = [sharp(original), sharp(result)]
    const ratios = await Promise.all(
      images.map(async (image) => {
        const { autoOrient } = await image.metadata()
        return autoOrient.width / autoOrient.height
      }),
    )
    const [firstRatio = 0, secondRatio = 0] = ratios
    if (Math.max(firstRatio, secondRatio) > Math.min(firstRatio, secondRatio) * 1.04) return false
    const [first, second] = await Promise.all(
      images.map(async (image) => {
        const pixels = await image
          .autoOrient()
          .resize(side, side, { fit: 'fill' })
          .removeAlpha()
          .greyscale()
          .raw()
          .toBuffer()
        return prominentEdges(pixels)
      }),
    )
    return !!first && !!second && edgesAlign(first, second) && edgesAlign(second, first)
  } catch {
    return false
  }
}
