import type { PlanPoint } from '@uyut/db'

export const DEFAULT_VOLUME_TILT = (Math.asin(1 / Math.sqrt(3)) * 180) / Math.PI
export type VolumeScreenPoint = { x: number; y: number; depth: number }

export function volumeProjector(angle: number, tilt: number) {
  const yaw = (angle * Math.PI) / 180
  const pitch = (tilt * Math.PI) / 180
  const cosYaw = Math.cos(yaw)
  const sinYaw = Math.sin(yaw)
  const cosPitch = Math.cos(pitch)
  const sinPitch = Math.sin(pitch)
  return (point: PlanPoint, rise = 0): VolumeScreenPoint => {
    const rotatedX = point.xCm * cosYaw - point.yCm * sinYaw
    const rotatedY = point.xCm * sinYaw + point.yCm * cosYaw
    const planarDepth = (rotatedX + rotatedY) / Math.sqrt(2)
    return {
      x: (rotatedX - rotatedY) / Math.sqrt(2),
      y: planarDepth * sinPitch - rise * cosPitch,
      depth: planarDepth * cosPitch + rise * sinPitch,
    }
  }
}

export function volumeViewBox(points: readonly VolumeScreenPoint[], zoom: number): string {
  const xs = points.map((point) => point.x)
  const ys = points.map((point) => point.y)
  const minX = Math.min(...xs)
  const maxX = Math.max(...xs)
  const minY = Math.min(...ys)
  const maxY = Math.max(...ys)
  const padding = Math.max(maxX - minX, maxY - minY) * 0.08
  const width = (maxX - minX + padding * 2) / zoom
  const height = (maxY - minY + padding * 2) / zoom
  return `${(minX + maxX - width) / 2} ${(minY + maxY - height) / 2} ${width} ${height}`
}

export function volumeOrbit(angle: number, tilt: number, dx: number, dy: number) {
  return {
    angle: (((angle + dx * 0.4) % 360) + 360) % 360,
    tilt: Math.min(80, Math.max(15, tilt - dy * 0.2)),
  }
}
