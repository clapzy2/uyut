import {
  Box3,
  Color,
  DirectionalLight,
  DoubleSide,
  EdgesGeometry,
  HemisphereLight,
  LineBasicMaterial,
  LineDashedMaterial,
  LineSegments,
  Mesh,
  MeshStandardMaterial,
  PerspectiveCamera,
  Raycaster,
  Scene,
  Vector2,
  Vector3,
  WebGLRenderer,
} from 'three'
import { OrbitControls } from 'three/addons/controls/OrbitControls.js'
import type { VolumeSelection } from '@/components/plan-volume-selection'
import { buildPlanScene } from './plan-scene-geometry'
import type { PlanVolume } from './plan-volume'

export type SceneCameraAction = 'left' | 'right' | 'top' | 'reset' | 'closer' | 'farther'

/** Owns only viewing resources. Never writes to the plan, layout or catalogue. */
export function mountPlanScene(
  canvas: HTMLCanvasElement,
  model: PlanVolume,
  onSelect: (selection: VolumeSelection) => void,
  onFailure: () => void,
) {
  const data = buildPlanScene(model)
  const geometries = new Set([
    ...data.surfaces.map((surface) => surface.geometry),
    ...data.lines.map((line) => line.geometry),
  ])
  const materials = new Set<MeshStandardMaterial | LineBasicMaterial | LineDashedMaterial>()
  const scene = new Scene()
  const camera = new PerspectiveCamera(42, 1, 0.01, 1000)
  const meshes: { surface: (typeof data.surfaces)[number]; mesh: Mesh }[] = []
  const wallObjects: (Mesh | LineSegments)[] = []
  const zoneObjects: (Mesh | LineSegments)[] = []
  let renderer: WebGLRenderer | undefined
  let controls: OrbitControls | undefined
  let observer: ResizeObserver | undefined
  let themeObserver: MutationObserver | undefined
  let frame: number | null = null
  let disposed = false
  let selection: VolumeSelection = null
  const disposers: (() => void)[] = []
  const palette = { paper: new Color(), ink: new Color(), accent: new Color() }

  function dispose() {
    if (disposed) return
    disposed = true
    if (frame !== null) cancelAnimationFrame(frame)
    observer?.disconnect()
    themeObserver?.disconnect()
    for (const remove of disposers) remove()
    controls?.dispose()
    for (const geometry of geometries) geometry.dispose()
    for (const material of materials) material.dispose()
    renderer?.dispose()
    renderer?.forceContextLoss()
    scene.clear()
  }

  function invalidate() {
    if (disposed || frame !== null) return
    frame = requestAnimationFrame(() => {
      frame = null
      if (disposed) return
      try {
        renderer?.render(scene, camera)
      } catch {
        onFailure()
      }
    })
  }

  function updateSelection(next: VolumeSelection) {
    selection = next
    const roomId =
      next?.kind === 'room'
        ? next.id
        : model.furniture?.find((item) => item.id === next?.id)?.roomId
    for (const { surface, mesh } of meshes) {
      const material = mesh.material as MeshStandardMaterial
      const selected =
        surface.kind === 'room'
          ? roomId !== undefined && surface.roomId === roomId
          : surface.kind === 'furniture' &&
            (next?.kind === 'furniture'
              ? surface.furnitureId === next.id
              : roomId !== undefined && surface.roomId === roomId)
      material.color.copy(selected || surface.kind === 'zone' ? palette.accent : palette.paper)
      if (surface.kind === 'room') material.opacity = selected ? 0.6 : 0.05
      if (surface.kind === 'furniture') {
        material.color.lerp(palette.ink, selected ? 0.05 : 0.2)
      }
    }
    invalidate()
  }

  try {
    renderer = new WebGLRenderer({ canvas, antialias: true, alpha: false })
    renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2))
    controls = new OrbitControls(camera, canvas)
    controls.enabled = false
    controls.enableDamping = false
    controls.maxPolarAngle = Math.PI / 2 - 0.02
    controls.minPolarAngle = 0.001
    controls.screenSpacePanning = false
    canvas.style.touchAction = 'pan-y'
    controls.addEventListener('change', invalidate)
    scene.add(new HemisphereLight(0xffffff, 0x766457, 2))
    const sunlight = new DirectionalLight(0xffffff, 2.5)
    sunlight.position.set(-5, 12, 8)
    scene.add(sunlight)

    for (const surface of data.surfaces) {
      const overlay = surface.kind === 'room' || surface.kind === 'zone'
      const material = new MeshStandardMaterial({
        side: DoubleSide,
        roughness: 1,
        metalness: 0,
        transparent: overlay || surface.footprintOnly === true,
        opacity: surface.kind === 'room' ? 0.05 : surface.kind === 'zone' ? 0.22 : 1,
        depthWrite: !overlay,
        polygonOffset: overlay || surface.footprintOnly === true,
        polygonOffsetFactor: -1,
        polygonOffsetUnits: -1,
      })
      materials.add(material)
      const mesh = new Mesh(surface.geometry, material)
      // Millimetre display layers avoid z-fighting; stored metric coordinates stay intact.
      mesh.position.y =
        surface.kind === 'room'
          ? 0.002
          : surface.kind === 'zone'
            ? 0.004
            : surface.footprintOnly
              ? 0.006
              : 0
      mesh.userData.surface = surface
      scene.add(mesh)
      meshes.push({ surface, mesh })
      if (surface.kind === 'wall') wallObjects.push(mesh)
      if (surface.kind === 'zone') zoneObjects.push(mesh)
      if (surface.kind === 'wall' || surface.kind === 'furniture' || surface.kind === 'zone') {
        const edges = new EdgesGeometry(surface.geometry)
        geometries.add(edges)
        const dashed = surface.footprintOnly || surface.preliminary
        const edgeMaterial = dashed
          ? new LineDashedMaterial({ dashSize: 0.06, gapSize: 0.04 })
          : new LineBasicMaterial({ transparent: true, opacity: 0.5 })
        materials.add(edgeMaterial)
        const outline = new LineSegments(edges, edgeMaterial)
        if (surface.footprintOnly || surface.kind === 'zone') {
          outline.position.y = surface.footprintOnly ? 0.007 : 0.005
          outline.computeLineDistances()
        }
        scene.add(outline)
        if (surface.kind === 'wall') wallObjects.push(outline)
        if (surface.kind === 'zone') zoneObjects.push(outline)
      }
    }
    for (const line of data.lines) {
      const material = line.unknown
        ? new LineDashedMaterial({ dashSize: 0.08, gapSize: 0.05 })
        : new LineBasicMaterial()
      materials.add(material)
      const outline = new LineSegments(line.geometry, material)
      outline.position.y = 0.005
      outline.computeLineDistances()
      scene.add(outline)
      if (line.kind === 'wall') wallObjects.push(outline)
    }

    const bounds = new Box3()
    for (const { mesh, surface } of meshes) {
      if (surface.kind !== 'zone') bounds.expandByObject(mesh)
    }
    const center = bounds.getCenter(new Vector3())
    const size = bounds.getSize(new Vector3())
    const radius = Math.max(size.length() / 2, 0.1)
    controls.minDistance = radius * 0.25
    controls.maxDistance = radius * 12
    camera.near = Math.max(radius / 10000, 0.001)
    camera.far = radius * 100
    controls.target.copy(center)

    function fittingDistance() {
      const verticalFov = (camera.fov * Math.PI) / 180
      const horizontalFov = 2 * Math.atan(Math.tan(verticalFov / 2) * camera.aspect)
      return (radius / Math.sin(Math.min(verticalFov, horizontalFov) / 2)) * 1.15
    }

    function reset() {
      if (!controls) return
      const distance = fittingDistance()
      controls.target.copy(center)
      camera.position.copy(center).add(new Vector3(1, 1.1, 1).normalize().multiplyScalar(distance))
      controls.update()
      invalidate()
    }

    let firstResize = true
    function resize() {
      const previousFit = fittingDistance()
      const width = Math.max(canvas.clientWidth, 1)
      const height = Math.max(canvas.clientHeight, 1)
      renderer?.setSize(width, height, false)
      camera.aspect = width / height
      camera.updateProjectionMatrix()
      if (firstResize) {
        firstResize = false
        reset()
      } else if (controls) {
        const offset = camera.position.clone().sub(controls.target)
        offset.multiplyScalar(fittingDistance() / previousFit)
        offset.clampLength(controls.minDistance, controls.maxDistance)
        camera.position.copy(controls.target).add(offset)
        controls.update()
      }
      invalidate()
    }
    observer = new ResizeObserver(resize)
    observer.observe(canvas)
    resize()

    function theme() {
      const css = getComputedStyle(canvas)
      palette.paper.setStyle(css.getPropertyValue('--paper').trim() || '#fcf9f2')
      palette.ink.setStyle(css.getPropertyValue('--ink').trim() || '#262220')
      palette.accent.setStyle(css.getPropertyValue('--accent').trim() || '#7c2f3b')
      scene.background = palette.paper.clone().lerp(palette.ink, 0.04)
      for (const material of materials) {
        if (!(material instanceof MeshStandardMaterial)) material.color.copy(palette.ink)
      }
      updateSelection(selection)
    }
    themeObserver = new MutationObserver(theme)
    themeObserver.observe(document.documentElement, {
      attributes: true,
      attributeFilter: ['class', 'data-theme', 'style'],
    })
    const systemTheme = window.matchMedia('(prefers-color-scheme: dark)')
    systemTheme.addEventListener('change', theme)
    disposers.push(() => systemTheme.removeEventListener('change', theme))
    theme()

    const pointers = new Set<number>()
    let press: { id: number; x: number; y: number; moved: boolean } | null = null
    const down = (event: PointerEvent) => {
      pointers.add(event.pointerId)
      if (pointers.size > 1) {
        if (press) press.moved = true
        return
      }
      if (event.button === 0)
        press = { id: event.pointerId, x: event.clientX, y: event.clientY, moved: false }
    }
    const move = (event: PointerEvent) => {
      if (
        press?.id === event.pointerId &&
        Math.hypot(event.clientX - press.x, event.clientY - press.y) > 4
      )
        press.moved = true
    }
    const up = (event: PointerEvent) => {
      pointers.delete(event.pointerId)
      const started = press
      if (started?.id !== event.pointerId) return
      press = null
      if (started.moved || Math.hypot(event.clientX - started.x, event.clientY - started.y) > 4)
        return
      const rect = canvas.getBoundingClientRect()
      const ray = new Raycaster()
      ray.setFromCamera(
        new Vector2(
          ((event.clientX - rect.left) / rect.width) * 2 - 1,
          1 - ((event.clientY - rect.top) / rect.height) * 2,
        ),
        camera,
      )
      const hit = ray.intersectObjects(
        meshes
          .filter(({ surface, mesh }) => surface.kind !== 'zone' && mesh.visible)
          .map(({ mesh }) => mesh),
        false,
      )[0]
      const surface = hit?.object.userData.surface as (typeof data.surfaces)[number] | undefined
      if (surface?.furnitureId) onSelect({ kind: 'furniture', id: surface.furnitureId })
      else if (surface?.kind === 'room' && surface.roomId)
        onSelect({ kind: 'room', id: surface.roomId })
      else if (!surface || surface.kind === 'floor') onSelect(null)
    }
    const cancel = (event: PointerEvent) => {
      pointers.delete(event.pointerId)
      if (press?.id === event.pointerId) press = null
    }
    const lost = (event: Event) => {
      event.preventDefault()
      onFailure()
    }
    canvas.addEventListener('pointerdown', down)
    canvas.addEventListener('pointermove', move)
    canvas.addEventListener('pointerup', up)
    canvas.addEventListener('pointercancel', cancel)
    canvas.addEventListener('webglcontextlost', lost)
    disposers.push(() => {
      canvas.removeEventListener('pointerdown', down)
      canvas.removeEventListener('pointermove', move)
      canvas.removeEventListener('pointerup', up)
      canvas.removeEventListener('pointercancel', cancel)
      canvas.removeEventListener('webglcontextlost', lost)
    })

    return {
      dispose,
      select: updateSelection,
      setWalls: (visible: boolean) => {
        for (const object of wallObjects) object.visible = visible
        invalidate()
      },
      setZones: (visible: boolean) => {
        for (const object of zoneObjects) object.visible = visible
        invalidate()
      },
      setGestures: (enabled: boolean) => {
        if (controls) controls.enabled = enabled
        canvas.style.touchAction = enabled ? 'none' : 'pan-y'
      },
      camera: (action: SceneCameraAction) => {
        if (!controls) return
        if (action === 'reset') reset()
        else if (action === 'top') {
          const distance = controls.getDistance()
          camera.position.copy(controls.target).add(new Vector3(0, distance, 0.001))
        } else if (action === 'left' || action === 'right') {
          controls.rotateLeft(action === 'left' ? Math.PI / 4 : -Math.PI / 4)
        } else {
          const factor = action === 'closer' ? 0.8 : 1.25
          const distance = Math.min(
            controls.maxDistance,
            Math.max(controls.minDistance, controls.getDistance() * factor),
          )
          camera.position
            .sub(controls.target)
            .normalize()
            .multiplyScalar(distance)
            .add(controls.target)
        }
        controls.update()
        invalidate()
      },
    }
  } catch (error) {
    dispose()
    throw error
  }
}
