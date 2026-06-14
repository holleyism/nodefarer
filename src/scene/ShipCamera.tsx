import { useEffect, useMemo, useRef } from 'react'
import { useFrame, useThree } from '@react-three/fiber'
import * as THREE from 'three'
import type { GraphNode } from '../types'
import { shipBus } from './shipBus'

interface Travel {
  phase: 'turn' | 'fly'
  // keepOrbit: fly to the same relative orbit spot on the next node without
  // reorienting (used when the ship is orbited, so the view doesn't jump).
  keepOrbit: boolean
  t: number
  from: THREE.Vector3
  to: THREE.Vector3
  fromYaw: number
  fromPitch: number
  toYaw: number
  toPitch: number
  turnDuration: number
  flyDuration: number
}

// A camera re-aim that runs alongside the flight (used by "follow course").
interface Aim {
  t: number
  fromYaw: number
  fromPitch: number
  toYaw: number
  toPitch: number
  duration: number
}

function smoothstep(t: number) {
  return t * t * (3 - 2 * t)
}

function wrapPi(a: number) {
  return ((((a + Math.PI) % (2 * Math.PI)) + 2 * Math.PI) % (2 * Math.PI)) - Math.PI
}

// The ship hovers above the node rather than sitting at its center —
// otherwise every departing edge is a line through the camera's own eye
// and therefore invisible. Hovering also keeps the travel lane in view
// below the ship during flight. This is the default (top-down) parking spot;
// orbit moves the ship around the node on a sphere of this same radius.
const EYE = new THREE.Vector3(0, 5, 0)
const ORBIT_R = EYE.length()
const ORBIT_SENS = 0.005

// Reusable basis vectors for the trackball math.
const X_AXIS = new THREE.Vector3(1, 0, 0)
const Y_AXIS = new THREE.Vector3(0, 1, 0)
const NEG_Z = new THREE.Vector3(0, 0, -1)

function faceYawPitch(from: THREE.Vector3, to: THREE.Vector3) {
  const m = new THREE.Matrix4().lookAt(from, to, new THREE.Vector3(0, 1, 0))
  const e = new THREE.Euler().setFromQuaternion(
    new THREE.Quaternion().setFromRotationMatrix(m),
    'YXZ',
  )
  return { yaw: e.y, pitch: e.x }
}

interface Props {
  currentNode: GraphNode
  targetNode: GraphNode | null
  following: boolean
  followSignal: number
  onUnlock: () => void
  onArrive: () => void
}

// The "ship": a camera parked at the current node. Orientation always lives
// in user-owned yaw/pitch. While the camera is locked to the course, each
// leg starts with an auto-aim turn toward the next hop; dragging mid-flight
// unlocks the camera (the view is then never reset at waypoints) until
// "follow course" re-engages it.
export function ShipCamera({ currentNode, targetNode, following, followSignal, onUnlock, onArrive }: Props) {
  const camera = useThree((s) => s.camera) as THREE.PerspectiveCamera
  const gl = useThree((s) => s.gl)
  // Gaze: yaw/pitch *relative to the stance frame* (up = outward normal), so
  // pitch-up always tilts toward open space, never toward the node.
  const look = useRef({ yaw: 0, pitch: 0 })
  // Stance: a quaternion whose local up (Y) axis is the outward normal from the
  // node to the camera. Position = node + ORBIT_R · (stance · up). Orbit rotates
  // this about the camera's tangent axes (a trackball) — no pole, no gimbal, so
  // it's continuous in every direction. Identity = up is world-up = old EYE.
  const stance = useRef(new THREE.Quaternion())
  const travel = useRef<Travel | null>(null)
  const aim = useRef<Aim | null>(null)
  const currentRef = useRef(currentNode)
  currentRef.current = currentNode
  // Per-frame scratch — no allocation in the loop.
  const v1 = useMemo(() => new THREE.Vector3(), [])
  const axis = useMemo(() => new THREE.Vector3(), [])
  const nodePos = useMemo(() => new THREE.Vector3(), [])
  const qYaw = useMemo(() => new THREE.Quaternion(), [])
  const qPitch = useMemo(() => new THREE.Quaternion(), [])
  const qGaze = useMemo(() => new THREE.Quaternion(), [])
  const qDelta = useMemo(() => new THREE.Quaternion(), [])
  const onArriveRef = useRef(onArrive)
  onArriveRef.current = onArrive
  const onUnlockRef = useRef(onUnlock)
  onUnlockRef.current = onUnlock
  const followingRef = useRef(following)
  followingRef.current = following

  useEffect(() => {
    if (!travel.current) {
      // Re-anchor at a new node, preserving the current orbit stance.
      const offset = Y_AXIS.clone().applyQuaternion(stance.current).multiplyScalar(ORBIT_R)
      camera.position.set(currentNode.x!, currentNode.y!, currentNode.z!).add(offset)
    }
  }, [currentNode, camera, stance])

  // Dev-only: expose the live ship pose for the headless camera tests.
  useEffect(() => {
    if (import.meta.env.DEV) (window as unknown as { __ship: typeof shipBus }).__ship = shipBus
  }, [])

  useEffect(() => {
    if (!targetNode) return
    const from = camera.position.clone()
    const targetPos = new THREE.Vector3(targetNode.x!, targetNode.y!, targetNode.z!)
    aim.current = null

    // Orbited: keep the same relative orbit on the next node — translate only,
    // no reorientation, so the view doesn't jump. Stance/gaze persist.
    if (Math.abs(stance.current.w) < 0.9999) {
      const offset = Y_AXIS.clone().applyQuaternion(stance.current).multiplyScalar(ORBIT_R)
      const to = targetPos.add(offset)
      travel.current = {
        phase: 'fly',
        keepOrbit: true,
        t: 0,
        from,
        to,
        fromYaw: look.current.yaw,
        fromPitch: look.current.pitch,
        toYaw: look.current.yaw,
        toPitch: look.current.pitch,
        turnDuration: 0,
        flyDuration: THREE.MathUtils.clamp(from.distanceTo(to) / 45, 1.2, 4),
      }
      return
    }

    // Default top-down: auto-aim turn toward the hop, then fly. The stance is
    // identity here, so look is already the world-frame yaw/pitch.
    const to = targetPos.add(EYE)
    const face = faceYawPitch(from, to)
    // Aim via the shortest yaw arc from wherever the user left the view.
    const toYaw = look.current.yaw + wrapPi(face.yaw - look.current.yaw)
    const angle = Math.hypot(toYaw - look.current.yaw, face.pitch - look.current.pitch)
    travel.current = {
      // An unlocked camera keeps the user's view: skip the auto-aim turn.
      phase: followingRef.current ? 'turn' : 'fly',
      keepOrbit: false,
      t: 0,
      from,
      to,
      fromYaw: look.current.yaw,
      fromPitch: look.current.pitch,
      toYaw,
      toPitch: face.pitch,
      // Scale the turn to the angle so small course corrections at journey
      // waypoints don't stall the flight.
      turnDuration: THREE.MathUtils.clamp(angle * 0.45, 0.15, 0.9),
      flyDuration: THREE.MathUtils.clamp(from.distanceTo(to) / 45, 1.2, 4),
    }
  }, [targetNode, camera, stance])

  // "Follow course" pressed: swing back toward the current hop while flying.
  useEffect(() => {
    if (followSignal === 0) return
    const tr = travel.current
    if (!tr || tr.keepOrbit) return
    const face = faceYawPitch(camera.position, tr.to)
    const toYaw = look.current.yaw + wrapPi(face.yaw - look.current.yaw)
    const angle = Math.hypot(toYaw - look.current.yaw, face.pitch - look.current.pitch)
    aim.current = {
      t: 0,
      fromYaw: look.current.yaw,
      fromPitch: look.current.pitch,
      toYaw,
      toPitch: face.pitch,
      duration: THREE.MathUtils.clamp(angle * 0.45, 0.2, 0.9),
    }
  }, [followSignal, camera])

  useEffect(() => {
    const el = gl.domElement
    // Active pressed pointers by id → last screen position. One pointer =
    // look; two pointers = pinch-zoom the FOV (the touch equivalent of the
    // mouse wheel).
    const pointers = new Map<number, { x: number; y: number }>()
    let pinch: { startDist: number; startFov: number } | null = null
    // Whether the active mouse drag is an orbit (right-button, or Shift+left).
    // Decided at pointerdown and held for the duration of the drag.
    let orbitMode = false

    const setFov = (fov: number) => {
      camera.fov = THREE.MathUtils.clamp(fov, 25, 80)
      camera.updateProjectionMatrix()
    }
    const pinchDist = () => {
      const [a, b] = [...pointers.values()]
      return Math.hypot(a.x - b.x, a.y - b.y)
    }

    const onDown = (e: PointerEvent) => {
      if (e.pointerType === 'mouse') {
        // Left = look, right or Shift+left = orbit; ignore middle/back/forward.
        if (e.button === 2 || (e.button === 0 && e.shiftKey)) orbitMode = true
        else if (e.button === 0) orbitMode = false
        else return
      } else {
        orbitMode = false
      }
      pointers.set(e.pointerId, { x: e.clientX, y: e.clientY })
      if (pointers.size === 2) pinch = { startDist: pinchDist(), startFov: camera.fov }
    }
    const onMove = (e: PointerEvent) => {
      const prev = pointers.get(e.pointerId)
      if (!prev) return
      const dx = e.clientX - prev.x
      const dy = e.clientY - prev.y
      prev.x = e.clientX
      prev.y = e.clientY

      if (pinch && pointers.size >= 2) {
        // Spread fingers → larger distance → narrower FOV → zoom in.
        setFov(pinch.startFov * (pinch.startDist / (pinchDist() || 1)))
        return
      }
      // The brief auto-aim turn owns the view; ignore drags during it.
      if (travel.current?.phase === 'turn') return

      // Orbit (trackball): rotate the stance about the camera's tangent axes.
      // Vertical drag tips you over the node's top/bottom; horizontal drag
      // carries you around its sides. Both axes are perpendicular to the
      // outward normal, so you always *move* (never spin in place) and there's
      // no pole. The node stays pinned because the gaze is stance-relative.
      // Parked-only.
      if (orbitMode && pointers.size === 1 && !travel.current) {
        qYaw.setFromAxisAngle(Y_AXIS, look.current.yaw)
        // Vertical drag → rotate about the screen-right tangent.
        axis.copy(X_AXIS).applyQuaternion(qYaw).applyQuaternion(stance.current)
        qDelta.setFromAxisAngle(axis, dy * ORBIT_SENS)
        stance.current.premultiply(qDelta)
        // Horizontal drag → rotate about the screen-forward tangent.
        axis.copy(NEG_Z).applyQuaternion(qYaw).applyQuaternion(stance.current)
        qDelta.setFromAxisAngle(axis, -dx * ORBIT_SENS)
        stance.current.premultiply(qDelta)
        stance.current.normalize()
        return
      }

      // Single-finger / mouse look.
      look.current.yaw -= dx * 0.0032
      look.current.pitch = THREE.MathUtils.clamp(look.current.pitch - dy * 0.0032, -1.45, 1.45)
      if (travel.current) {
        // Taking the stick mid-flight unlocks the camera from the course.
        aim.current = null
        if (followingRef.current) onUnlockRef.current()
      }
    }
    const onUp = (e: PointerEvent) => {
      pointers.delete(e.pointerId)
      if (pointers.size < 2) pinch = null
      if (pointers.size === 0) orbitMode = false
    }
    const onWheel = (e: WheelEvent) => {
      e.preventDefault()
      setFov(camera.fov + e.deltaY * 0.03)
    }
    // Right-drag orbits, so the right-click menu must not pop on release.
    const onContextMenu = (e: Event) => e.preventDefault()

    el.addEventListener('pointerdown', onDown)
    window.addEventListener('pointermove', onMove)
    window.addEventListener('pointerup', onUp)
    window.addEventListener('pointercancel', onUp)
    el.addEventListener('wheel', onWheel, { passive: false })
    el.addEventListener('contextmenu', onContextMenu)
    return () => {
      el.removeEventListener('pointerdown', onDown)
      window.removeEventListener('pointermove', onMove)
      window.removeEventListener('pointerup', onUp)
      window.removeEventListener('pointercancel', onUp)
      el.removeEventListener('wheel', onWheel)
      el.removeEventListener('contextmenu', onContextMenu)
    }
  }, [gl, camera])

  useFrame((_, delta) => {
    const tr = travel.current
    if (tr) {
      if (tr.phase === 'turn') {
        tr.t = Math.min(1, tr.t + delta / tr.turnDuration)
        const s = smoothstep(tr.t)
        look.current.yaw = tr.fromYaw + (tr.toYaw - tr.fromYaw) * s
        look.current.pitch = tr.fromPitch + (tr.toPitch - tr.fromPitch) * s
        if (tr.t >= 1) {
          tr.phase = 'fly'
          tr.t = 0
        }
      } else {
        tr.t = Math.min(1, tr.t + delta / tr.flyDuration)
        camera.position.lerpVectors(tr.from, tr.to, smoothstep(tr.t))
        if (tr.t >= 1) {
          travel.current = null
          onArriveRef.current()
        }
      }
    } else {
      // Parked: position = node + outward normal · radius (the stance's up axis),
      // so an orbit drag takes effect live.
      const n = currentRef.current
      nodePos.set(n.x!, n.y!, n.z!)
      v1.copy(Y_AXIS).applyQuaternion(stance.current).multiplyScalar(ORBIT_R)
      camera.position.copy(nodePos).add(v1)
    }
    const am = aim.current
    if (am) {
      am.t = Math.min(1, am.t + delta / am.duration)
      const s = smoothstep(am.t)
      look.current.yaw = am.fromYaw + (am.toYaw - am.fromYaw) * s
      look.current.pitch = am.fromPitch + (am.toPitch - am.fromPitch) * s
      if (am.t >= 1) aim.current = null
    }
    // Final orientation: stance (where you stand on the sphere) composed with
    // the stance-relative gaze (yaw about local up, then pitch about local
    // right). During travel the stance is identity, so this is exactly the old
    // world-frame yaw/pitch and the flight aiming is unchanged.
    qYaw.setFromAxisAngle(Y_AXIS, look.current.yaw)
    qPitch.setFromAxisAngle(X_AXIS, look.current.pitch)
    qGaze.copy(qYaw).multiply(qPitch)
    camera.quaternion.copy(stance.current).multiply(qGaze)
    shipBus.position.copy(camera.position)
    shipBus.quaternion.copy(camera.quaternion)
  })

  return null
}
