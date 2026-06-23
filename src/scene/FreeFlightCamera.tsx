import { useEffect, useMemo, useRef } from 'react'
import { useFrame, useThree } from '@react-three/fiber'
import * as THREE from 'three'
import { shipBus } from './shipBus'

interface Props {
  // When true, this controller owns the camera: it free-flies through space
  // (WASD / arrows to move, drag to look, wheel for cruise speed). ShipCamera
  // stands down (its `enabled` is the inverse) so the two never fight. When
  // false this component is inert — its listeners stay attached but bail early.
  active: boolean
  // Bumped each time the user re-enters free flight, so we can re-seed the gaze
  // from the live camera even if `active` was already true on a prior mount.
  enterSignal: number
}

const WORLD_UP = new THREE.Vector3(0, 1, 0)
const X_AXIS = new THREE.Vector3(1, 0, 0)
const Y_AXIS = new THREE.Vector3(0, 1, 0)
// Keys that would otherwise scroll the page while flying.
const SWALLOW = new Set(['Space', 'ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight'])

// A no-clip flying camera. Movement is along the gaze (fly where you look),
// with world-up/down on a separate axis and a wheel-tunable cruise speed.
// Orientation is plain yaw/pitch (no roll), so the horizon stays level.
export function FreeFlightCamera({ active, enterSignal }: Props) {
  const camera = useThree((s) => s.camera) as THREE.PerspectiveCamera
  const gl = useThree((s) => s.gl)

  const keys = useRef(new Set<string>())
  const look = useRef({ yaw: 0, pitch: 0 })
  const speed = useRef(45) // world units / second at cruise
  const dragging = useRef(false)
  const last = useRef({ x: 0, y: 0 })
  const activeRef = useRef(active)
  activeRef.current = active

  // Per-frame scratch — no allocation in the loop.
  const fwd = useMemo(() => new THREE.Vector3(), [])
  const right = useMemo(() => new THREE.Vector3(), [])
  const move = useMemo(() => new THREE.Vector3(), [])
  const qYaw = useMemo(() => new THREE.Quaternion(), [])
  const qPitch = useMemo(() => new THREE.Quaternion(), [])

  // Seed yaw/pitch from the current camera each time free flight is (re)entered,
  // so control passes over from the ship with no visual jump.
  useEffect(() => {
    if (!active) return
    const e = new THREE.Euler().setFromQuaternion(camera.quaternion, 'YXZ')
    look.current.yaw = e.y
    look.current.pitch = THREE.MathUtils.clamp(e.x, -1.5, 1.5)
    keys.current.clear()
    dragging.current = false
  }, [active, enterSignal, camera])

  useEffect(() => {
    const el = gl.domElement
    const onKeyDown = (e: KeyboardEvent) => {
      if (!activeRef.current) return
      const t = e.target as HTMLElement | null
      // Don't steal keys while the user is typing in a console field.
      if (t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA')) return
      keys.current.add(e.code)
      if (SWALLOW.has(e.code)) e.preventDefault()
    }
    const onKeyUp = (e: KeyboardEvent) => keys.current.delete(e.code)
    const onDown = (e: PointerEvent) => {
      if (!activeRef.current || e.button !== 0) return
      dragging.current = true
      last.current = { x: e.clientX, y: e.clientY }
    }
    const onMove = (e: PointerEvent) => {
      if (!activeRef.current || !dragging.current) return
      const dx = e.clientX - last.current.x
      const dy = e.clientY - last.current.y
      last.current = { x: e.clientX, y: e.clientY }
      look.current.yaw -= dx * 0.0032
      look.current.pitch = THREE.MathUtils.clamp(look.current.pitch - dy * 0.0032, -1.5, 1.5)
    }
    const onUp = () => {
      dragging.current = false
    }
    const onWheel = (e: WheelEvent) => {
      if (!activeRef.current) return
      e.preventDefault()
      // Scroll up = faster cruise, scroll down = slower (exponential, even feel).
      speed.current = THREE.MathUtils.clamp(speed.current * Math.exp(-e.deltaY * 0.001), 3, 800)
    }
    // Releasing focus (alt-tab, etc.) must not leave keys stuck "held".
    const onBlur = () => keys.current.clear()

    window.addEventListener('keydown', onKeyDown)
    window.addEventListener('keyup', onKeyUp)
    el.addEventListener('pointerdown', onDown)
    window.addEventListener('pointermove', onMove)
    window.addEventListener('pointerup', onUp)
    window.addEventListener('pointercancel', onUp)
    el.addEventListener('wheel', onWheel, { passive: false })
    window.addEventListener('blur', onBlur)
    return () => {
      window.removeEventListener('keydown', onKeyDown)
      window.removeEventListener('keyup', onKeyUp)
      el.removeEventListener('pointerdown', onDown)
      window.removeEventListener('pointermove', onMove)
      window.removeEventListener('pointerup', onUp)
      window.removeEventListener('pointercancel', onUp)
      el.removeEventListener('wheel', onWheel)
      window.removeEventListener('blur', onBlur)
    }
  }, [gl, camera])

  useFrame((_, delta) => {
    if (!activeRef.current) return
    // Orientation: yaw about world-up, then pitch about local right. No roll.
    qYaw.setFromAxisAngle(Y_AXIS, look.current.yaw)
    qPitch.setFromAxisAngle(X_AXIS, look.current.pitch)
    camera.quaternion.copy(qYaw).multiply(qPitch)

    // Movement basis from the (just-updated) gaze.
    camera.getWorldDirection(fwd)
    right.crossVectors(fwd, WORLD_UP).normalize()
    move.set(0, 0, 0)
    const k = keys.current
    if (k.has('KeyW') || k.has('ArrowUp')) move.add(fwd)
    if (k.has('KeyS') || k.has('ArrowDown')) move.sub(fwd)
    if (k.has('KeyD') || k.has('ArrowRight')) move.add(right)
    if (k.has('KeyA') || k.has('ArrowLeft')) move.sub(right)
    if (k.has('Space') || k.has('KeyE')) move.add(WORLD_UP)
    if (k.has('KeyC') || k.has('KeyQ')) move.sub(WORLD_UP)
    if (move.lengthSq() > 0) {
      const boost = k.has('ShiftLeft') || k.has('ShiftRight') ? 3.5 : 1
      move.normalize().multiplyScalar(speed.current * boost * delta)
      camera.position.add(move)
    }

    // Keep the HUD instruments (radar, reticles) in sync with the live pose.
    shipBus.position.copy(camera.position)
    shipBus.quaternion.copy(camera.quaternion)
  })

  return null
}
