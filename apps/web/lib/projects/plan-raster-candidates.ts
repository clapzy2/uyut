import sharp from 'sharp'
import { preparePlanPage } from './plan-document'
import { detectPlanRasterEdges } from './plan-raster-edges'
import { detectPlanRasterRegions } from './plan-raster-regions'

/** Unclassified pixel evidence only. No metric dimensions, room assignment or gap filling. */
export async function rasterPlanCandidates(
  body: Buffer,
  isPdf: boolean,
  pageNumber: number,
  focus?: { x: number; y: number },
) {
  const image = isPdf ? (await preparePlanPage(body, true, pageNumber)).image.body : body
  const decoder = sharp(image, { limitInputPixels: 16_000_000 })
  const metadata = await decoder.metadata()
  const width = metadata.width
  const height = metadata.height
  if (
    !width ||
    !height ||
    width > 20_000 ||
    height > 20_000 ||
    (metadata.orientation && metadata.orientation !== 1)
  )
    throw new Error('Unsupported source image dimensions or orientation')
  if (
    focus &&
    (!Number.isInteger(focus.x) ||
      !Number.isInteger(focus.y) ||
      focus.x < 0 ||
      focus.y < 0 ||
      focus.x >= width ||
      focus.y >= height)
  )
    throw new RangeError('Focus must be inside the source image')

  // Inspect a small source-pixel neighborhood when a dense drawing exhausts
  // the global budget. Crop-frame edges are rejected by detectPlanRasterEdges.
  const crop = focus
    ? {
        left: Math.max(0, Math.min(width - Math.min(width, 500), focus.x - 250)),
        top: Math.max(0, Math.min(height - Math.min(height, 500), focus.y - 250)),
        width: Math.min(width, 500),
        height: Math.min(height, 500),
      }
    : undefined
  const gray = await (crop ? decoder.extract(crop) : decoder)
    .flatten({ background: '#ffffff' })
    .resize({ width: 2000, height: 2000, fit: 'inside', withoutEnlargement: true })
    .greyscale()
    .raw()
    .toBuffer({ resolveWithObject: true })
  const detected = detectPlanRasterEdges({
    grayscale: gray.data,
    width: gray.info.width,
    height: gray.info.height,
  })
  // A local scan can recover fully enclosed bright components lost when the
  // whole drawing hits its region limit. The detector excludes components
  // touching the crop frame, so the crop cannot invent a closing boundary.
  const regions = detectPlanRasterRegions({
    grayscale: gray.data,
    width: gray.info.width,
    height: gray.info.height,
  })
  const point = ({ x, y }: { x: number; y: number }) => ({
    x: (x * (crop?.width ?? width)) / gray.info.width + (crop?.left ?? 0),
    y: (y * (crop?.height ?? height)) / gray.info.height + (crop?.top ?? 0),
  })
  return {
    ...detected,
    width,
    height,
    focused: Boolean(focus),
    // A focused scan cannot claim a complete inventory for the whole page.
    uncertain: detected.uncertain || Boolean(focus),
    points: detected.points.map(point),
    segments: detected.segments.map((segment) => ({
      start: point(segment.start),
      end: point(segment.end),
    })),
    regions: regions.regions.map((region) => ({
      id: region.id,
      polygon: region.polygon.map(point),
      hasInteriorIslands: region.hasInteriorIslands,
    })),
    regionTruncated: regions.truncated,
    regionUncertain: regions.uncertain || Boolean(focus),
  }
}
