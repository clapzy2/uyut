import type { PlanPoint } from '@uyut/db'

/** Shared viewing DTOs, independent of browser renderers and PDF workers. */
export type PlanGeometryIssue = {
  id: string
  severity: 'error' | 'warning'
  message: string
  wallIds?: string[]
  openingIds?: string[]
  roomIndexes?: number[]
}

export type PlanVerticalMeasurementReport = {
  surfaceStatus: 'invalid' | 'partial' | 'complete'
  missingWallHeightIds: string[]
  missingWallThicknessIds: string[]
  missingOpeningHeightIds: string[]
  missingOpeningBottomIds: string[]
  raisedThresholdIds: string[]
  unknownThresholdIds: string[]
}

export type WallSpan = {
  id: string
  start: PlanPoint
  end: PlanPoint
  kind: 'outer' | 'inner'
  bottomCm: number
  topCm?: number
  solid?: boolean
  wallId: string
  thicknessCm?: number
}

export type PlanSolidFace = {
  id: string
  kind: 'outer' | 'inner'
  role: 'face' | 'cap' | 'end' | 'reveal'
  points: (PlanPoint & { zCm: number })[]
  holes?: (PlanPoint & { zCm: number })[][]
}

export type OpeningSpan = {
  id: string
  type: 'door' | 'window' | 'balcony'
  start: PlanPoint
  end: PlanPoint
  bottomCm?: number
  heightCm?: number
  cut: boolean
  /** Measured supporting floor in the common datum; bottomCm in this viewing DTO is global. */
  baseCm?: number
}

export type VolumeFloorSurface = {
  id: string
  floorId: string
  title: string
  floor: PlanPoint[]
  voids: PlanPoint[][]
  elevationCm: number
  surface: 'existing-floor' | 'finished-floor'
  roomId?: string
}

export type VolumeThreshold = {
  id: string
  floor: PlanPoint[]
  elevationCm: number
  floorIds: [string, string]
  floorElevationsCm: [number, number]
}

export type PlanVolume = {
  floor: PlanPoint[]
  voids: PlanPoint[][]
  walls: WallSpan[]
  openings: OpeningSpan[]
  wallSource: 'centerline' | 'pdf-faces' | 'room-layout'
  solidFaces: PlanSolidFace[]
  joinedSolids: boolean
  issues: PlanGeometryIssue[]
  furniture?: VolumeFurniture[]
  floorZones?: VolumeFloorZone[]
  rooms?: VolumeRoom[]
  layoutNote?: string
  verticalMeasurements?: PlanVerticalMeasurementReport
  /** Presence replaces the legacy whole-footprint floor at Z=0. */
  floorSurfaces?: VolumeFloorSurface[]
  thresholds?: VolumeThreshold[]
  verticalDatum?: { id: string; kind: 'existing-floor' | 'finished-floor'; zeroFloorId: string }
}

export type VolumeRoom = {
  id: string
  title: string
  floor: PlanPoint[]
  /** A source contour without a linked project-room page. */
  sourceOnly?: boolean
  baseCm?: number
  floorId?: string
}

export type VolumeFloorZone = {
  id: string
  roomId?: string
  title: string
  kind: 'door' | 'balcony' | 'radiator' | 'obstacle' | 'operation'
  floor: PlanPoint[]
  preliminary?: boolean
  baseCm?: number
}

export type VolumeFurniture = {
  id: string
  itemId?: string
  roomId?: string
  title: string
  floor: PlanPoint[]
  heightCm?: number
  baseCm?: number
}
