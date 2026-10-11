import { describe, expect, it } from 'vitest'
import {
  type NativeRoomNumberFrame,
  nativeRoomFrameFaceCandidates,
} from './plan-native-room-frame-faces'
import { nativePageSegments } from './plan-pdf-opening-endpoint'
import { pdfPointInside } from './plan-pdf-room-binding'
import { connectedNativeRoomFixture } from './test-fixtures/native-numbered-rooms'

function fixture() {
  const input = connectedNativeRoomFixture()
  const segments = nativePageSegments(input.work)
  const frames: NativeRoomNumberFrame[] = [100, 350, 600].map((x, index) => {
    const label = input.native.labels.find(
      (label) => label.name === String(index + 1) && label.pagePoint?.y === 150,
    )
    if (!label) throw new Error('Missing source number')
    return {
      labelId: label.id,
      bounds: { left: x - 10, right: x + 10, top: 138, bottom: 158 },
      sides: segments.filter(
        (side) =>
          side.operationIndex >= 100 + index * 10 && side.operationIndex <= 103 + index * 10,
      ),
    }
  })
  return { ...input, frames }
}
describe('source-bound isolated number-frame graph view, not floor approval', () => {
  it('preserves source frames/refs and obtains exact shared-wall candidates without modifying ink', () => {
    const input = fixture()
    const before = structuredClone(input)
    const result = nativeRoomFrameFaceCandidates(input)
    expect(result.status).toBe('draft')
    expect(result.exclusions).toHaveLength(3)
    expect(result.geometry?.semanticStatus).toBe('unclassified')
    expect(result.geometry?.candidates).toHaveLength(3)
    expect(result.geometry?.candidates[0]?.polygon).toEqual([
      { x: 50, y: 50 },
      { x: 275, y: 50 },
      { x: 275, y: 300 },
      { x: 50, y: 300 },
    ])
    expect(
      result.geometry?.candidates
        .flatMap((candidate) => candidate.sourceRefs)
        .every((ref) => ref.operationIndex < 100),
    ).toBe(true)
    expect(input).toEqual(before)
  })
  it.each(['corner-touch', 'side-crossing', 'side-overlap', 'inside-frame'])(
    'does not exclude a frame with a foreign stroke: %s',
    (caseName) => {
      const input = fixture()
      const points =
        caseName === 'corner-touch'
          ? [
              { x: 90, y: 138 },
              { x: 80, y: 128 },
            ]
          : caseName === 'side-crossing'
            ? [
                { x: 80, y: 148 },
                { x: 120, y: 148 },
              ]
            : caseName === 'side-overlap'
              ? [
                  { x: 94, y: 138 },
                  { x: 106, y: 138 },
                ]
              : [
                  { x: 95, y: 145 },
                  { x: 105, y: 145 },
                ]
      input.work.paths.push({
        operationIndex: 500,
        subpathIndex: 0,
        closed: false,
        paint: 'stroke',
        points,
      })
      const result = nativeRoomFrameFaceCandidates(input)
      expect(result.exclusions.map((frame) => frame.labelId)).not.toContain(
        input.frames[0]?.labelId,
      )
      expect(
        result.geometry?.candidates.some((candidate) =>
          pdfPointInside({ x: 100, y: 150 }, candidate.polygon),
        ),
      ).toBe(false)
    },
  )
  it('never excludes a compound source path containing another segment', () => {
    const input = fixture()
    const side = input.work.paths.find((path) => path.operationIndex === 100)
    if (!side) throw new Error('Missing frame side')
    side.points.push({ x: 160, y: 200 })
    const result = nativeRoomFrameFaceCandidates(input)
    expect(result.exclusions.map((frame) => frame.labelId)).not.toContain(input.frames[0]?.labelId)
  })
  it('retains an unknown subpath of the same paint operation instead of dropping that operation', () => {
    const input = fixture()
    input.work.paths.push({
      operationIndex: 100,
      subpathIndex: 1,
      closed: false,
      paint: 'stroke',
      points: [
        { x: 160, y: 200 },
        { x: 180, y: 220 },
      ],
    })
    const before = structuredClone(input)
    const result = nativeRoomFrameFaceCandidates(input)
    expect(result.exclusions).toHaveLength(3)
    expect(
      result.geometry?.candidates.some((candidate) =>
        pdfPointInside({ x: 100, y: 150 }, candidate.polygon),
      ),
    ).toBe(false)
    expect(result.geometry?.candidates).toHaveLength(2)
    expect(input).toEqual(before)
  })
  it.each(['snapshot', 'duplicate-ref', 'foreign-label'])(
    'rejects stale or malformed witness %s without partial exclusions',
    (change) => {
      const input = fixture()
      const frame = input.frames[0]
      const side = frame?.sides[0]
      if (!frame || !side) throw new Error('Missing frame proof')
      if (change === 'snapshot')
        frame.sides[0] = { ...side, start: { ...side.start, x: side.start.x + 0.001 } }
      else if (change === 'duplicate-ref') frame.sides[1] = structuredClone(side)
      else frame.labelId = 'native-text-99999'
      const result = nativeRoomFrameFaceCandidates(input)
      expect(result.status).toBe('unresolved')
      expect(result.geometry).toBeNull()
      expect(result.exclusions).toEqual([])
    },
  )
  it('does not treat a candidate-sized enclosed zone as a removable number frame', () => {
    const input = fixture()
    const frame = input.frames[0]
    if (!frame) throw new Error('Missing frame')
    frame.bounds = { left: 75, right: 125, top: 125, bottom: 175 }
    const corners = [
      { x: 75, y: 125 },
      { x: 125, y: 125 },
      { x: 125, y: 175 },
      { x: 75, y: 175 },
    ]
    for (let index = 0; index < 4; index++) {
      const path = input.work.paths.find((path) => path.operationIndex === 100 + index)
      if (!path) throw new Error('Missing frame side')
      path.points = [
        corners[index] as { x: number; y: number },
        corners[(index + 1) % 4] as { x: number; y: number },
      ]
    }
    frame.sides = nativePageSegments(input.work).filter(
      (side) => side.operationIndex >= 100 && side.operationIndex <= 103,
    )
    const result = nativeRoomFrameFaceCandidates(input)
    expect(result.exclusions.map((entry) => entry.labelId)).not.toContain(frame.labelId)
  })
  it.each(['curve', 'clip'])(
    'keeps the new expansion inapplicable for a %s omission, not a guessed chord',
    (kind) => {
      const input = fixture()
      if (kind === 'curve') input.work.skippedCurves = 1
      else input.work.clippedPaths = 1
      expect(nativeRoomFrameFaceCandidates(input)).toMatchObject({
        status: 'not-applicable',
        geometry: null,
        exclusions: [],
      })
    },
  )
  it('rejects a truncated zero-count source instead of keeping partial new faces', () => {
    const input = fixture()
    input.work.skippedCurveBoundsTruncated = true
    expect(nativeRoomFrameFaceCandidates(input)).toMatchObject({
      status: 'unresolved',
      geometry: null,
      exclusions: [],
    })
  })
  it('does not ignore a second caption inside the same numeric frame', () => {
    const input = fixture()
    input.native.labels.push({
      id: 'native-text-9999',
      nativeIndex: 9999,
      name: '2',
      rotation: 0,
      pagePoint: { x: 100, y: 148 },
      point: { x: 100, y: 148 },
    })
    const result = nativeRoomFrameFaceCandidates(input)
    expect(result.exclusions.map((frame) => frame.labelId)).not.toContain(input.frames[0]?.labelId)
  })
  it('refuses a face-budget overflow without keeping the first source regions or exclusions', () => {
    const input = fixture()
    for (let column = 0; column <= 6; column++)
      input.work.paths.push({
        operationIndex: 600 + column,
        subpathIndex: 0,
        paint: 'stroke',
        closed: false,
        points: [
          { x: 600 + column * 40, y: 400 },
          { x: 600 + column * 40, y: 940 },
        ],
      })
    for (let row = 0; row <= 9; row++)
      input.work.paths.push({
        operationIndex: 700 + row,
        subpathIndex: 0,
        paint: 'stroke',
        closed: false,
        points: [
          { x: 600, y: 400 + row * 60 },
          { x: 840, y: 400 + row * 60 },
        ],
      })
    expect(nativeRoomFrameFaceCandidates(input)).toMatchObject({
      status: 'unresolved',
      reason: 'candidate-limit',
      geometry: null,
      exclusions: [],
    })
  })
})
