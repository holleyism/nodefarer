import { useEffect, useRef } from 'react'
import { useFrame, useThree } from '@react-three/fiber'
import * as THREE from 'three'
import type { GraphNode } from '../types'

interface Travel {
  phase: 'turn' | 'fly'
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
// below the ship during flight.
const EYE = new THREE.Vector3(0, 5, 0)

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
  const look = useRef({ yaw: 0, pitch: 0 })
  const travel = useRef<Travel | null>(null)
  const aim = useRef<Aim | null>(null)
  const onArriveRef = useRef(onArrive)
  onArriveRef.current = onArrive
  const onUnlockRef = useRef(onUnlock)
  onUnlockRef.current = onUnlock
  const followingRef = useRef(following)
  followingRef.current = following

  useEffect(() => {
    if (!travel.current) {
      camera.position.set(currentNode.x!, currentNode.y!, currentNode.z!).add(EYE)
    }
  }, [currentNode, camera])

  useEffect(() => {
    if (!targetNode) return
    const from = camera.position.clone()
    const to = new THREE.Vector3(targetNode.x!, targetNode.y!, targetNode.z!).add(EYE)
    const face = faceYawPitch(from, to)
    // Aim via the shortest yaw arc from wherever the user left the view.
    const toYaw = look.current.yaw + wrapPi(face.yaw - look.current.yaw)
    const angle = Math.hypot(toYaw - look.current.yaw, face.pitch - look.current.pitch)
    aim.current = null
    travel.current = {
      // An unlocked camera keeps the user's view: skip the auto-aim turn.
      phase: followingRef.current ? 'turn' : 'fly',
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
  }, [targetNode, camera])

  // "Follow course" pressed: swing back toward the current hop while flying.
  useEffect(() => {
    if (followSignal === 0) return
    const tr = travel.current
    if (!tr) return
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
    let dragging = false
    let lastX = 0
    let lastY = 0

    const onDown = (e: PointerEvent) => {
      if (e.button !== 0) return
      dragging = true
      lastX = e.clientX
      lastY = e.clientY
    }
    const onMove = (e: PointerEvent) => {
      // Free look while parked or flying; only the brief auto-aim turn at
      // each waypoint owns the view.
      if (!dragging || travel.current?.phase === 'turn') return
      const dx = e.clientX - lastX
      const dy = e.clientY - lastY
      lastX = e.clientX
      lastY = e.clientY
      look.current.yaw -= dx * 0.0032
      look.current.pitch = THREE.MathUtils.clamp(look.current.pitch - dy * 0.0032, -1.45, 1.45)
      if (travel.current) {
        // Taking the stick mid-flight unlocks the camera from the course.
        aim.current = null
        if (followingRef.current) onUnlockRef.current()
      }
    }
    const onUp = () => {
      dragging = false
    }
    const onWheel = (e: WheelEvent) => {
      e.preventDefault()
      camera.fov = THREE.MathUtils.clamp(camera.fov + e.deltaY * 0.03, 25, 80)
      camera.updateProjectionMatrix()
    }

    el.addEventListener('pointerdown', onDown)
    window.addEventListener('pointermove', onMove)
    window.addEventListener('pointerup', onUp)
    el.addEventListener('wheel', onWheel, { passive: false })
    return () => {
      el.removeEventListener('pointerdown', onDown)
      window.removeEventListener('pointermove', onMove)
      window.removeEventListener('pointerup', onUp)
      el.removeEventListener('wheel', onWheel)
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
    }
    const am = aim.current
    if (am) {
      am.t = Math.min(1, am.t + delta / am.duration)
      const s = smoothstep(am.t)
      look.current.yaw = am.fromYaw + (am.toYaw - am.fromYaw) * s
      look.current.pitch = am.fromPitch + (am.toPitch - am.fromPitch) * s
      if (am.t >= 1) aim.current = null
    }
    camera.rotation.set(look.current.pitch, look.current.yaw, 0, 'YXZ')
  })

  return null
}
