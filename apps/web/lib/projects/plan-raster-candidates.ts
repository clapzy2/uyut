import sharp from 'sharp'
import { preparePlanPage } from './plan-document'
import { detectPlanRasterEdges } from './plan-raster-edges'

/** Unclassified pixel evidence only. No metric dimensions, room assignment or gap filling. */
export async function rasterPlanCandidates(body: Buffer, isPdf: boolean, pageNumber: number) {
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
  const gray = await decoder
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
  const point = ({ x, y }: { x: number; y: number }) => ({
    x: (x * width) / gray.info.width,
    y: (y * height) / gray.info.height,
  })
  return {
    ...detected,
    width,
    height,
    points: detected.points.map(point),
    segments: detected.segments.map((segment) => ({
      start: point(segment.start),
      end: point(segment.end),
    })),
  }
}
