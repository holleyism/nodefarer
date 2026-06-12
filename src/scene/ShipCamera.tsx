import { useEffect, useRef } from 'react'
import { useFrame, useThree } from '@react-three/fiber'
import * as THREE from 'three'
import type { GraphNode } from '../types'

interface Travel {
  phase: 'turn' | 'fly'
  t: number
  from: THREE.Vector3
  to: THREE.Vector3
  fromQuat: THREE.Quaternion
  faceQuat: THREE.Quaternion
  turnDuration: number
  flyDuration: number
}

function smoothstep(t: number) {
  return t * t * (3 - 2 * t)
}

// The ship hovers above the node rather than sitting at its center —
// otherwise every departing edge is a line through the camera's own eye
// and therefore invisible. Hovering also keeps the travel lane in view
// below the ship during flight.
const EYE = new THREE.Vector3(0, 5, 0)

interface Props {
  currentNode: GraphNode
  targetNode: GraphNode | null
  onArrive: () => void
}

// The "ship": a camera parked at the current node. Free look while parked
// (drag = yaw/pitch, wheel = FOV zoom). When a travel target is set, it first
// turns to face the target, then flies the straight line and hands control back.
export function ShipCamera({ currentNode, targetNode, onArrive }: Props) {
  const camera = useThree((s) => s.camera) as THREE.PerspectiveCamera
  const gl = useThree((s) => s.gl)
  const look = useRef({ yaw: 0, pitch: 0 })
  const travel = useRef<Travel | null>(null)
  const onArriveRef = useRef(onArrive)
  onArriveRef.current = onArrive

  useEffect(() => {
    if (!travel.current) {
      camera.position.set(currentNode.x!, currentNode.y!, currentNode.z!).add(EYE)
    }
  }, [currentNode, camera])

  useEffect(() => {
    if (!targetNode) return
    const from = camera.position.clone()
    const to = new THREE.Vector3(targetNode.x!, targetNode.y!, targetNode.z!).add(EYE)
    const m = new THREE.Matrix4().lookAt(from, to, new THREE.Vector3(0, 1, 0))
    const faceQuat = new THREE.Quaternion().setFromRotationMatrix(m)
    // Scale the turn to the angle so small course corrections at journey
    // waypoints don't stall the flight.
    const angle = camera.quaternion.angleTo(faceQuat)
    travel.current = {
      phase: 'turn',
      t: 0,
      from,
      to,
      fromQuat: camera.quaternion.clone(),
      faceQuat,
      turnDuration: THREE.MathUtils.clamp(angle * 0.45, 0.15, 0.9),
      flyDuration: THREE.MathUtils.clamp(from.distanceTo(to) / 45, 1.2, 4),
    }
  }, [targetNode, camera])

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
      if (!dragging || travel.current) return
      const dx = e.clientX - lastX
      const dy = e.clientY - lastY
      lastX = e.clientX
      lastY = e.clientY
      look.current.yaw -= dx * 0.0032
      look.current.pitch = THREE.MathUtils.clamp(look.current.pitch - dy * 0.0032, -1.45, 1.45)
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
        camera.quaternion.slerpQuaternions(tr.fromQuat, tr.faceQuat, smoothstep(tr.t))
        if (tr.t >= 1) {
          tr.phase = 'fly'
          tr.t = 0
        }
      } else {
        tr.t = Math.min(1, tr.t + delta / tr.flyDuration)
        camera.position.lerpVectors(tr.from, tr.to, smoothstep(tr.t))
        if (tr.t >= 1) {
          // Hand free look back exactly where the flight left the camera pointing.
          const e = new THREE.Euler().setFromQuaternion(tr.faceQuat, 'YXZ')
          look.current.yaw = e.y
          look.current.pitch = e.x
          travel.current = null
          onArriveRef.current()
        }
      }
    } else {
      camera.rotation.set(look.current.pitch, look.current.yaw, 0, 'YXZ')
    }
  })

  return null
}
