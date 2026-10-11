import {
  signedPlanFloors,
  verticalReferenceReviewKey,
} from '@uyut/catalog/plan-vertical-floor-geometry'
import type { PlanGeometry, PlanPoint } from '@uyut/db'
import type { FurnitureDeliveryResult } from './plan-furniture-delivery'
import type { FurnitureDeliveryReportRequest } from './plan-furniture-delivery-report'
import { inspectFurnitureDoorLeaves } from './plan-furniture-door-leaves'
import { furnitureExteriorIngressSchema } from './plan-furniture-exterior'
import {
  furnitureStairGeometryKey,
  furnitureStairSurveySchema,
} from './plan-furniture-stair-transfer'
import { volumeProjector, volumeViewBox } from './plan-volume-camera'

type Point = PlanPoint & { zCm: number }
type Surface = { id: string; title: string; rings: Point[][]; kind: 'floor' | 'stair' | 'exterior' }
type Box = FurnitureDeliveryResult['stairs']['stages'][number]['bounds']
export type DeliveryVolumeScene = {
  datum: string
  surfaces: Surface[]
  routes: { id: string; points: Point[] }[]
  stages: FurnitureDeliveryResult['stairs']['stages']
  leaves: { id: string; bounds: Box }[]
  ceilingPoints: Point[]
}

const finitePoint = (point: Point) => [point.xCm, point.yCm, point.zCm].every(Number.isFinite)
const finiteBounds = (bounds: Box) =>
  Object.values(bounds).every(Number.isFinite) &&
  bounds.leftCm < bounds.rightCm &&
  bounds.topCm < bounds.bottomCm &&
  bounds.bottomElevationCm < bounds.topElevationCm
const elevate = (points: PlanPoint[], zCm: number) => points.map((point) => ({ ...point, zCm }))

/** Rendering only: the caller must supply a freshly checked complete route, never an imported report. */
export function deliveryVolumeScene(
  geometry: PlanGeometry,
  request: FurnitureDeliveryReportRequest,
  result: FurnitureDeliveryResult,
): DeliveryVolumeScene | null {
  try {
    const signed = signedPlanFloors(geometry)
    const survey = furnitureStairSurveySchema.safeParse(request.survey)
    if (
      !signed?.ok ||
      !survey.success ||
      survey.data.geometryKey !== furnitureStairGeometryKey(geometry) ||
      survey.data.referenceKey !== verticalReferenceReviewKey(signed.reference) ||
      result.targetRoomId !== request.targetRoomId ||
      result.stairs.referenceId !== signed.reference.id ||
      !result.stairs.stages.length
    )
      return null
    const surfaces: Surface[] = signed.surfaces.map((surface) => ({
      id: surface.id,
      title: surface.title,
      kind: 'floor',
      rings: [surface.floor, ...surface.voids].map((ring) => elevate(ring, surface.elevationCm)),
    }))
    const ceilingPoints = signed.surfaces.flatMap((surface) => {
      const ceiling = signed.reference.ceilings?.find((item) => item.floorId === surface.floorId)
      return ceiling ? elevate(surface.floor, ceiling.elevationCm) : []
    })
    for (const region of result.stairs.regions) {
      surfaces.push({
        id: `stair-${region.index}`,
        title: region.kind === 'landing' ? 'Площадка' : 'Ступень',
        kind: 'stair',
        rings: [elevate(region.polygon, region.elevationCm)],
      })
      ceilingPoints.push(...elevate(region.polygon, region.ceilingElevationCm))
    }
    if (result.exteriorChecked) {
      const exterior = furnitureExteriorIngressSchema.safeParse(request.accessInput?.exterior)
      if (
        !exterior.success ||
        !result.segments.exterior?.length ||
        exterior.data.geometryKey !== survey.data.geometryKey ||
        exterior.data.referenceKey !== survey.data.referenceKey
      )
        return null
      surfaces.push({
        id: 'exterior',
        title: 'Обмеренная наружная площадка',
        kind: 'exterior',
        rings: [elevate(exterior.data.outside.polygon, exterior.data.outside.elevationCm)],
      })
      ceilingPoints.push(
        ...elevate(exterior.data.outside.polygon, exterior.data.outside.ceilingElevationCm),
      )
    }
    const routes = Object.entries(result.segments)
      .filter(([id]) => id !== 'exterior' || result.exteriorChecked === true)
      .map(([id, points]) => ({ id, points }))
    const leaves: DeliveryVolumeScene['leaves'] = []
    if (result.leavesChecked) {
      const checked = inspectFurnitureDoorLeaves(geometry, request.accessInput?.doorLeaves)
      if (checked.error) return null
      for (const leaf of checked.volumes) {
        const [leftCm, topCm, rightCm, bottomCm] = leaf.bounds
        leaves.push({
          id: leaf.openingId,
          bounds: {
            leftCm,
            topCm,
            rightCm,
            bottomCm,
            bottomElevationCm: leaf.bottomElevationCm,
            topElevationCm: leaf.topElevationCm,
          },
        })
      }
    }
    if (
      surfaces.some((surface) =>
        surface.rings.some((ring) => ring.length < 3 || !ring.every(finitePoint)),
      ) ||
      routes.some((route) => !route.points.length || !route.points.every(finitePoint)) ||
      !result.points.length ||
      !result.points.every(finitePoint) ||
      !ceilingPoints.every(finitePoint) ||
      result.stairs.stages.some(
        (stage) =>
          !finiteBounds(stage.bounds) || !finitePoint(stage.from) || !finitePoint(stage.to),
      ) ||
      leaves.some((leaf) => !finiteBounds(leaf.bounds))
    )
      return null
    return {
      datum: signed.reference.zeroFloorId,
      surfaces,
      routes,
      stages: result.stairs.stages,
      leaves,
      ceilingPoints,
    }
  } catch {
    return null
  }
}

/** Six faces of the already checked enclosure. No furniture pose or easing is invented. */
export function deliveryBoxFaces(bounds: Box): Point[][] {
  const ring = [
    { xCm: bounds.leftCm, yCm: bounds.topCm },
    { xCm: bounds.rightCm, yCm: bounds.topCm },
    { xCm: bounds.rightCm, yCm: bounds.bottomCm },
    { xCm: bounds.leftCm, yCm: bounds.bottomCm },
  ]
  const bottom = elevate(ring, bounds.bottomElevationCm)
  const top = elevate(ring, bounds.topElevationCm)
  return [
    bottom,
    top,
    ...bottom.flatMap((point, index) => {
      const next = bottom[(index + 1) % 4]
      const upperNext = top[(index + 1) % 4]
      const upper = top[index]
      return next && upperNext && upper ? [[point, next, upperNext, upper]] : []
    }),
  ]
}

export function projectDeliveryVolume(
  scene: DeliveryVolumeScene,
  stageIndex: number,
  angle: number,
  tilt: number,
  zoom: number,
) {
  const project = volumeProjector(angle, tilt)
  const projected = (points: Point[]) => points.map((point) => project(point, point.zCm))
  const surfaces = scene.surfaces.map((surface) => ({
    ...surface,
    rings: surface.rings.map(projected),
  }))
  const routes = scene.routes.map((route) => ({ ...route, points: projected(route.points) }))
  const stage = scene.stages[stageIndex]
  const sweep = stage ? deliveryBoxFaces(stage.bounds).map(projected) : []
  const leaves = scene.leaves.flatMap((leaf) =>
    deliveryBoxFaces(leaf.bounds).map((face, index) => ({
      id: `${leaf.id}-${index}`,
      points: projected(face),
    })),
  )
  // Fit all stages, not just the active one: stepping must not move the camera.
  const extent = [
    ...surfaces.flatMap((surface) => surface.rings.flat()),
    ...routes.flatMap((route) => route.points),
    ...scene.stages.flatMap((item) => deliveryBoxFaces(item.bounds).flatMap(projected)),
    ...leaves.flatMap((leaf) => leaf.points),
    ...projected(scene.ceilingPoints),
  ]
  return { surfaces, routes, sweep, leaves, viewBox: volumeViewBox(extent, zoom) }
}
