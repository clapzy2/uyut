import type { PlanImageCalibration, PlanRoomShape } from '@uyut/db'
import { describe, expect, it } from 'vitest'
import { verifiedRoomImageTrace } from './plan-room-image-trace'

const calibration: PlanImageCalibration = {
  sourceSha256: 'a'.repeat(64),
  pdfPage: 2,
  imageWidthPx: 800,
  imageHeightPx: 800,
  pixelStart: { x: 100, y: 100 },
  pixelEnd: { x: 700, y: 100 },
  worldStart: { xCm: 0, yCm: 0 },
  lengthCm: 600,
  direction: 'right',
  verificationLines: [
    { pixelStart: { x: 100, y: 100 }, pixelEnd: { x: 100, y: 700 }, lengthCm: 600 },
  ],
}
const pointsPx = [
  { x: 100, y: 100 },
  { x: 300, y: 100 },
  { x: 300, y: 300 },
  { x: 100, y: 300 },
]
const room: PlanRoomShape = {
  name: 'Кухня',
  polygon: [
    { xCm: 0, yCm: 0 },
    { xCm: 200, yCm: 0 },
    { xCm: 200, yCm: 200 },
    { xCm: 0, yCm: 200 },
  ],
}
const frame = { sha256: 'a'.repeat(64), page: 2, widthPx: 800, heightPx: 800 }
const canvas = { widthCm: 700, heightCm: 700 }

describe('room trace provenance', () => {
  it('keeps the exact source points and authenticated frame', () => {
    expect(
      verifiedRoomImageTrace({ imageTrace: { pointsPx } }, room, calibration, frame, canvas),
    ).toEqual({
      pointsPx,
      sourceSha256: frame.sha256,
      page: frame.page,
      imageWidthPx: frame.widthPx,
      imageHeightPx: frame.heightPx,
    })
  })

  it('rejects stale image, page, dimensions and edited metric vertices', () => {
    const submitted = { imageTrace: { pointsPx } }
    expect(
      verifiedRoomImageTrace(
        { imageTrace: { pointsPx, sourceSha256: 'b'.repeat(64) } },
        room,
        calibration,
        frame,
        canvas,
      ),
    ).toBeUndefined()
    expect(
      verifiedRoomImageTrace(
        submitted,
        room,
        calibration,
        { ...frame, sha256: 'b'.repeat(64) },
        canvas,
      ),
    ).toBeUndefined()
    expect(
      verifiedRoomImageTrace(submitted, room, calibration, { ...frame, page: 1 }, canvas),
    ).toBeUndefined()
    expect(
      verifiedRoomImageTrace(submitted, room, calibration, { ...frame, widthPx: 801 }, canvas),
    ).toBeUndefined()
    expect(
      verifiedRoomImageTrace(
        submitted,
        {
          ...room,
          polygon: room.polygon.map((point, index) => (index === 0 ? { ...point, xCm: 1 } : point)),
        },
        calibration,
        frame,
        canvas,
      ),
    ).toBeUndefined()
  })

  it('rejects missing, malformed and out-of-frame points', () => {
    expect(verifiedRoomImageTrace({}, room, calibration, frame, canvas)).toBeUndefined()
    expect(
      verifiedRoomImageTrace(
        { imageTrace: { pointsPx: [null, ...pointsPx.slice(1)] } },
        room,
        calibration,
        frame,
        canvas,
      ),
    ).toBeUndefined()
    expect(
      verifiedRoomImageTrace(
        { imageTrace: { pointsPx: [{ x: -1, y: 100 }, ...pointsPx.slice(1)] } },
        room,
        calibration,
        frame,
        canvas,
      ),
    ).toBeUndefined()
  })
})
