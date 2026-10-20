import sharp from 'sharp'
import { preparePlanPage } from './plan-document'
import { nativePageSegments } from './plan-pdf-opening-endpoint'
import { detectPlanRasterEdges } from './plan-raster-edges'
import { detectPlanRasterRegions } from './plan-raster-regions'
import { rasterSourceStrokeGuide } from './plan-raster-source-strokes'

/** Unclassified pixel evidence only. No metric dimensions, room assignment or gap filling. */
export async function rasterPlanCandidates(
  body: Buffer,
  isPdf: boolean,
  pageNumber: number,
  focus?: { x: number; y: number },
) {
  const page = isPdf ? await preparePlanPage(body, true, pageNumber, Boolean(focus)) : undefined
  const image = page?.image.body ?? body
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

  const cropAround = (size: number) => ({
    left: Math.max(0, Math.min(width - Math.min(width, size), (focus?.x ?? 0) - size / 2)),
    top: Math.max(0, Math.min(height - Math.min(height, size), (focus?.y ?? 0) - size / 2)),
    width: Math.min(width, size),
    height: Math.min(height, size),
  })
  const read = async (crop?: ReturnType<typeof cropAround>) => {
    const gray = await (crop ? sharp(image).extract(crop) : decoder)
      .flatten({ background: '#ffffff' })
      .resize({ width: 2000, height: 2000, fit: 'inside', withoutEnlargement: true })
      .greyscale()
      .raw()
      .toBuffer({ resolveWithObject: true })
    const probe =
      crop && focus
        ? {
            id: 'focus',
            point: {
              x: Math.floor(((focus.x - crop.left) * gray.info.width) / crop.width),
              y: Math.floor(((focus.y - crop.top) * gray.info.height) / crop.height),
            },
          }
        : undefined
    const regions = detectPlanRasterRegions({
      grayscale: gray.data,
      width: gray.info.width,
      height: gray.info.height,
      probes: probe ? [probe] : undefined,
    })
    return { gray, regions, probe }
  }
  let crop = focus ? cropAround(500) : undefined
  let scan = await read(crop)
  if (focus && crop && scan.probe) {
    const { gray, probe } = scan
    const center = gray.data[probe.point.y * gray.info.width + probe.point.x] ?? 0
    // A larger room can cross the first crop frame. Expand only when the
    // clicked bright component was excluded; a dark stroke cannot be its seed.
    if (center >= 180 && !scan.regions.pointMembership?.[0]?.regionId) {
      for (const size of [750, 1000]) {
        if (crop.width === width && crop.height === height) break
        const expandedCrop = cropAround(size)
        const expanded = await read(expandedCrop)
        if (expanded.regions.pointMembership?.[0]?.regionId) {
          crop = expandedCrop
          scan = expanded
          break
        }
      }
    }
  }
  const { gray, regions } = scan
  const detected = detectPlanRasterEdges({
    grayscale: gray.data,
    width: gray.info.width,
    height: gray.info.height,
  })
  const point = ({ x, y }: { x: number; y: number }) => ({
    x: (x * (crop?.width ?? width)) / gray.info.width + (crop?.left ?? 0),
    y: (y * (crop?.height ?? height)) / gray.info.height + (crop?.top ?? 0),
  })
  const regionGuides = regions.regions.map((region) => ({
    id: region.id,
    polygon: region.polygon.map(point),
    hasInteriorIslands: region.hasInteriorIslands,
  }))
  const focusedRegionId = scan.probe ? regions.pointMembership?.[0]?.regionId : undefined
  const focusedRegion = regionGuides.find((region) => region.id === focusedRegionId)
  const linework = page?.linework
  const sourceStrokeGuide =
    focusedRegion &&
    linework &&
    !linework.truncated &&
    !linework.unsupportedContexts &&
    !linework.unsupportedPaths
      ? rasterSourceStrokeGuide(
          focusedRegion,
          { width, height },
          { width: linework.pageWidth, height: linework.pageHeight },
          nativePageSegments(linework),
        )
      : undefined
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
    regions: regionGuides,
    regionTruncated: regions.truncated,
    regionUncertain: regions.uncertain || Boolean(focus),
    sourceStrokeGuide,
  }
}
