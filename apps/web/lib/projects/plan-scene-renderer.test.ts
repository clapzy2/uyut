import {
  Box3,
  BufferGeometry,
  Mesh,
  type MeshStandardMaterial,
  type PerspectiveCamera,
  type Scene,
  Vector3,
} from 'three'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { mountPlanScene } from './plan-scene-renderer'
import type { PlanVolume } from './plan-volume'

const gpu = vi.hoisted(() => ({
  render: vi.fn(),
  dispose: vi.fn(),
  forceContextLoss: vi.fn(),
  unavailable: false,
}))
vi.mock('three', async (original) => ({
  ...(await original<typeof import('three')>()),
  WebGLRenderer: class {
    constructor() {
      if (gpu.unavailable) throw new Error('No WebGL2')
    }
    setPixelRatio() {}
    setSize() {}
    render = gpu.render
    dispose = gpu.dispose
    forceContextLoss = gpu.forceContextLoss
  },
}))

const floor = [
  { xCm: 0, yCm: 0 },
  { xCm: 400, yCm: 0 },
  { xCm: 400, yCm: 300 },
  { xCm: 0, yCm: 300 },
]
const model: PlanVolume = {
  floor,
  voids: [],
  walls: [],
  solidFaces: [],
  openings: [],
  issues: [],
  wallSource: 'room-layout',
  joinedSolids: false,
  rooms: [{ id: 'room', title: 'Комната', floor }],
  furniture: [
    {
      id: 'chair',
      roomId: 'room',
      title: 'Кресло',
      floor: [
        { xCm: 150, yCm: 100 },
        { xCm: 220, yCm: 100 },
        { xCm: 220, yCm: 170 },
        { xCm: 150, yCm: 170 },
      ],
    },
  ],
}
class Canvas extends EventTarget {
  style = { touchAction: '', cursor: '' }
  clientWidth = 1000
  clientHeight = 520
  ownerDocument = new EventTarget()
  getRootNode() {
    return this.ownerDocument
  }
  getBoundingClientRect() {
    return { left: 0, top: 0, width: this.clientWidth, height: this.clientHeight }
  }
}
let frames: Map<number, FrameRequestCallback>
let frameId: number
let disposeView: (() => void) | undefined
let resizeCanvas: () => void

function flush() {
  const pending = [...frames.values()]
  frames.clear()
  for (const callback of pending) callback(0)
}
function camera(): PerspectiveCamera {
  return gpu.render.mock.lastCall?.[1] as PerspectiveCamera
}
function scene(): Scene {
  return gpu.render.mock.lastCall?.[0] as Scene
}
function pointer(canvas: Canvas, type: string, x: number, y: number, id = 1) {
  const event = new Event(type)
  Object.assign(event, { pointerId: id, clientX: x, clientY: y, button: 0, pointerType: 'touch' })
  canvas.dispatchEvent(event)
}
function start(source = model) {
  const canvas = new Canvas()
  const selected = vi.fn()
  const failure = vi.fn()
  const view = mountPlanScene(canvas as unknown as HTMLCanvasElement, source, selected, failure)
  disposeView = view.dispose
  flush()
  return { canvas, selected, failure, view }
}

beforeEach(() => {
  vi.clearAllMocks()
  gpu.unavailable = false
  frames = new Map()
  frameId = 0
  vi.stubGlobal('window', { devicePixelRatio: 3, matchMedia: () => new EventTarget() })
  vi.stubGlobal('document', { documentElement: {} })
  vi.stubGlobal('getComputedStyle', () => ({ getPropertyValue: () => '' }))
  vi.stubGlobal('requestAnimationFrame', (callback: FrameRequestCallback) => {
    frames.set(++frameId, callback)
    return frameId
  })
  vi.stubGlobal('cancelAnimationFrame', (id: number) => frames.delete(id))
  vi.stubGlobal(
    'ResizeObserver',
    class {
      constructor(callback: () => void) {
        resizeCanvas = callback
      }
      observe() {}
      disconnect() {}
    },
  )
  vi.stubGlobal(
    'MutationObserver',
    class {
      observe() {}
      disconnect() {}
    },
  )
})
afterEach(() => {
  disposeView?.()
  disposeView = undefined
  vi.unstubAllGlobals()
})

describe('управление сценой без подмены геометрии', () => {
  it('приближает выбранный предмет, сохраняет направление и возвращает всю квартиру', () => {
    const source = structuredClone(model)
    const { view, canvas } = start(source)
    const initial = camera().position.clone()
    const center = new Box3().setFromObject(scene()).getCenter(new Vector3())
    const direction = initial.clone().sub(center).normalize()
    view.select({ kind: 'furniture', id: 'chair' })
    view.camera('focus')
    flush()
    const furnitureCenter = new Vector3(1.85, 0.006, 1.35)
    const focused = camera().position.clone().sub(furnitureCenter)
    expect(focused.length()).toBeLessThan(initial.distanceTo(center))
    expect(focused.clone().normalize().distanceTo(direction)).toBeLessThan(0.001)
    canvas.clientWidth = 390
    resizeCanvas()
    flush()
    expect(
      camera().position.clone().sub(furnitureCenter).normalize().distanceTo(direction),
    ).toBeLessThan(0.001)
    canvas.clientWidth = 1000
    resizeCanvas()
    view.camera('reset')
    flush()
    expect(camera().position.distanceTo(initial)).toBeLessThan(0.001)
    expect(source).toEqual(model)
  })

  it('показывает выбранную комнату, учитывая высоту её мебели, без реакции на неизвестный id', () => {
    const source: PlanVolume = {
      ...model,
      furniture: model.furniture?.map((item) => ({ ...item, heightCm: 180 })),
    }
    const { view } = start(source)
    const initial = camera().position.clone()
    view.select({ kind: 'room', id: 'missing' })
    view.camera('focus')
    flush()
    expect(camera().position).toEqual(initial)
    view.select({ kind: 'room', id: 'room' })
    view.camera('focus')
    flush()
    const projectedCenter = new Vector3(2, 0.9, 1.5).project(camera())
    expect(projectedCenter.x).toBeCloseTo(0)
    expect(projectedCenter.y).toBeCloseTo(0)
  })

  it('срез скрывает только стены и проёмы, не меняет вершины и освобождает выбор за стеной', () => {
    const source: PlanVolume = {
      ...model,
      walls: [
        {
          id: 'wall',
          wallId: 'wall',
          kind: 'inner',
          start: { xCm: 0, yCm: 230 },
          end: { xCm: 400, yCm: 230 },
          bottomCm: 0,
          topCm: 270,
        },
      ],
      openings: [
        {
          id: 'window',
          type: 'window',
          start: { xCm: 0, yCm: 0 },
          end: { xCm: 100, yCm: 0 },
          bottomCm: 90,
          heightCm: 130,
          cut: true,
        },
      ],
    }
    const before = structuredClone(source)
    const { view, canvas, selected } = start(source)
    const objects = scene().children.filter((object) => 'material' in object)
    const snapshots = objects.map((object) =>
      'geometry' in object
        ? Array.from((object.geometry as BufferGeometry).getAttribute('position').array)
        : [],
    )
    view.setSection(true, 90)
    flush()
    const wall = objects.find(
      (object) => object instanceof Mesh && object.userData.surface.kind === 'wall',
    ) as Mesh
    const plane = (wall.material as MeshStandardMaterial).clippingPlanes?.[0]
    expect(plane?.distanceToPoint(new Vector3(0, 0.5, 0))).toBeGreaterThan(0)
    expect(plane?.distanceToPoint(new Vector3(0, 2, 0))).toBeLessThan(0)
    const furniture = objects.find(
      (object) => object instanceof Mesh && object.userData.surface.kind === 'furniture',
    ) as Mesh
    expect((furniture.material as MeshStandardMaterial).clippingPlanes).toBeNull()
    const projected = new Vector3(1.85, 0.006, 1.35).project(camera())
    const x = ((projected.x + 1) / 2) * canvas.clientWidth
    const y = ((1 - projected.y) / 2) * canvas.clientHeight
    pointer(canvas, 'pointerdown', x, y)
    pointer(canvas, 'pointerup', x, y)
    expect(selected).toHaveBeenLastCalledWith({ kind: 'furniture', id: 'chair' })
    view.setSection(true, Number.NaN)
    expect(plane?.constant).toBeCloseTo(0.9)
    view.setSection(true, 150)
    expect(plane?.constant).toBeCloseTo(1.5)
    view.setSection(false, 150)
    expect((wall.material as MeshStandardMaterial).clippingPlanes).toBeNull()
    pointer(canvas, 'pointerdown', x, y)
    pointer(canvas, 'pointerup', x, y)
    expect(selected).toHaveBeenCalledTimes(1)
    expect(source).toEqual(before)
    expect(
      objects.map((object) =>
        'geometry' in object
          ? Array.from((object.geometry as BufferGeometry).getAttribute('position').array)
          : [],
      ),
    ).toEqual(snapshots)
  })

  it('на узком экране сохраняет направление камеры и подгоняет расстояние под ширину', () => {
    const { canvas } = start()
    const center = new Box3().setFromObject(scene()).getCenter(new Vector3())
    const initial = camera().position.clone().sub(center)
    canvas.clientWidth = 390
    canvas.clientHeight = 420
    resizeCanvas()
    flush()
    const narrow = camera().position.clone().sub(center)
    expect(camera().aspect).toBeCloseTo(390 / 420)
    expect(narrow.length()).toBeGreaterThan(initial.length())
    expect(narrow.clone().normalize().distanceTo(initial.clone().normalize())).toBeLessThan(0.001)
  })

  it('вид сверху сохраняет расстояние камеры, затем приближение и сброс работают', () => {
    const { view } = start()
    const center = new Box3().setFromObject(scene()).getCenter(new Vector3())
    const before = camera().position.distanceTo(center)
    view.camera('top')
    flush()
    expect(camera().position.distanceTo(center)).toBeCloseTo(before, 3)
    view.camera('closer')
    flush()
    expect(camera().position.distanceTo(center)).toBeLessThan(before)
    view.camera('reset')
    flush()
    expect(camera().position.distanceTo(center)).toBeCloseTo(before, 3)
  })

  it('выбирает плоскую мебель перед полом комнаты, но не после свайпа или второго касания', () => {
    const { canvas, selected, view } = start()
    view.camera('top')
    flush()
    const projected = new Vector3(1.85, 0.006, 1.35).project(camera())
    const x = ((projected.x + 1) / 2) * canvas.clientWidth
    const y = ((1 - projected.y) / 2) * canvas.clientHeight
    pointer(canvas, 'pointerdown', x, y)
    pointer(canvas, 'pointerup', x, y)
    expect(selected).toHaveBeenLastCalledWith({ kind: 'furniture', id: 'chair' })
    selected.mockClear()
    pointer(canvas, 'pointerdown', x, y)
    pointer(canvas, 'pointermove', x + 40, y)
    pointer(canvas, 'pointerup', x, y)
    expect(selected).not.toHaveBeenCalled()
    pointer(canvas, 'pointerdown', x, y)
    pointer(canvas, 'pointerdown', x, y, 2)
    pointer(canvas, 'pointerup', x, y, 2)
    pointer(canvas, 'pointerup', x, y)
    expect(selected).not.toHaveBeenCalled()
  })

  it('рисует по запросу и освобождает ресурсы и отложенный кадр при закрытии', () => {
    const geometryDispose = vi.spyOn(BufferGeometry.prototype, 'dispose')
    try {
      const { canvas, selected, view } = start()
      expect(frames.size).toBe(0)
      view.select({ kind: 'room', id: 'room' })
      view.setZones(false)
      view.setWalls(false)
      expect(frames.size).toBe(1)
      view.dispose()
      const freed = geometryDispose.mock.calls.length
      expect(freed).toBeGreaterThan(0)
      expect(frames.size).toBe(0)
      view.dispose()
      expect(geometryDispose).toHaveBeenCalledTimes(freed)
      expect(gpu.dispose).toHaveBeenCalledTimes(1)
      expect(gpu.forceContextLoss).toHaveBeenCalledTimes(1)
      pointer(canvas, 'pointerdown', 0, 0)
      pointer(canvas, 'pointerup', 0, 0)
      expect(selected).not.toHaveBeenCalled()
    } finally {
      geometryDispose.mockRestore()
    }
  })

  it('сообщает о потере контекста и освобождает геометрию при недоступном WebGL', () => {
    const { canvas, failure, view } = start()
    canvas.dispatchEvent(new Event('webglcontextlost', { cancelable: true }))
    expect(failure).toHaveBeenCalledTimes(1)
    view.dispose()
    const geometryDispose = vi.spyOn(BufferGeometry.prototype, 'dispose')
    try {
      gpu.unavailable = true
      expect(() => start()).toThrow('No WebGL2')
      expect(geometryDispose.mock.calls.length).toBeGreaterThan(0)
    } finally {
      geometryDispose.mockRestore()
    }
  })
})
