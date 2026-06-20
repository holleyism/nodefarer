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
// Default parked distance from the node. The scroll wheel dollies this in/out
// (a true dolly zoom — the ship moves, FOV is left alone) between MIN_R and
// MAX_R; the chosen distance persists as you travel between nodes.
const ORBIT_R = EYE.length()
const MIN_R = 3
const MAX_R = 600
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
  // Bumped to snap the ship back to its default stance + gaze (undo any orbit /
  // look-around), so a scripted step (a tour advance) re-frames cleanly.
  recenterSignal?: number
  // When the recenter fires, keep the current dolly zoom (manual travel) instead
  // of resetting it to default (scripted moves / plotted-course travel).
  recenterKeepZoom?: boolean
  // Bumped to auto-frame a freshly plotted course: turn the gaze to look down
  // the route and dolly out so it fits — always keeping the destination in
  // frame, even if divergent waypoints fall out. Parked (no travel).
  frameSignal?: number
  frameTarget?: {
    points: [number, number, number][]
    destination: [number, number, number]
    zoom?: boolean
    instant?: boolean
  } | null
  onUnlock: () => void
  onArrive: () => void
}

// The "ship": a camera parked at the current node. Orientation always lives
// in user-owned yaw/pitch. While the camera is locked to the course, each
// leg starts with an auto-aim turn toward the next hop; dragging mid-flight
// unlocks the camera (the view is then never reset at waypoints) until
// "follow course" re-engages it.
export function ShipCamera({ currentNode, targetNode, following, followSignal, recenterSignal = 0, recenterKeepZoom = false, frameSignal = 0, frameTarget = null, onUnlock, onArrive }: Props) {
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
  // Dolly distance from the node, driven by the scroll wheel (and pinch). Lives
  // in a ref so it persists across node-to-node travel and re-anchors.
  const radius = useRef(ORBIT_R)
  // An in-progress animated dolly (auto-frame). Wheel/pinch cancels it.
  const radiusAnim = useRef<{ from: number; to: number; t: number; dur: number } | null>(null)
  // Off-screen probe camera for the auto-frame fit test (project route points).
  const probe = useMemo(() => new THREE.PerspectiveCamera(), [])
  const travel = useRef<Travel | null>(null)
  const aim = useRef<Aim | null>(null)
  // Set the instant a leg finishes (camera sitting at the arrived node's parked
  // spot) and cleared once the new currentNode prop commits. While set, the
  // parked branch holds position instead of recomputing from currentRef — which
  // still points at the PREVIOUS node until React re-renders, and would
  // otherwise snap the camera back there for a frame (a landing "blink").
  const justArrived = useRef(false)
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
  // Mirror so the recenter effect reads the latest value without a reactive dep.
  const keepZoomRef = useRef(recenterKeepZoom)
  keepZoomRef.current = recenterKeepZoom

  useEffect(() => {
    // currentNode is now in sync — the just-arrived hold can release.
    justArrived.current = false
    if (!travel.current) {
      // Re-anchor at a new node, preserving the current orbit stance + zoom.
      const offset = Y_AXIS.clone().applyQuaternion(stance.current).multiplyScalar(radius.current)
      camera.position.set(currentNode.x!, currentNode.y!, currentNode.z!).add(offset)
    }
  }, [currentNode, camera, stance])

  // Dev-only: expose the live ship pose for the headless camera tests.
  useEffect(() => {
    if (import.meta.env.DEV) (window as unknown as { __ship: typeof shipBus }).__ship = shipBus
  }, [])

  // Recenter: snap the orbit stance + gaze + zoom back to default and re-anchor
  // the camera over the current node. Declared BEFORE the travel-setup effect so
  // that when a traversal starts right after a re-frame (both fire in one commit,
  // e.g. travelling a plotted course), the stance is already normalized — the leg
  // then takes the clean top-down auto-aim path instead of the keepOrbit path,
  // which would otherwise set off in the old orbited direction. Parked, this just
  // re-centers the view on the current node.
  useEffect(() => {
    if (recenterSignal === 0) return
    stance.current.identity()
    look.current.yaw = 0
    look.current.pitch = 0
    aim.current = null
    // Restore the default dolly distance unless this re-frame keeps the zoom
    // (manual travel preserves the user's chosen distance; scripted moves and
    // plotted-course travel reset to the standard viewing zoom).
    if (!keepZoomRef.current) {
      radius.current = ORBIT_R
      radiusAnim.current = null
    }
    // Re-anchor over the node now (don't wait for the next parked frame), so a
    // traversal computed in this same commit starts from the normalized spot.
    const n = currentRef.current
    camera.position.set(n.x!, n.y!, n.z!).addScaledVector(Y_AXIS, radius.current)
  }, [recenterSignal])

  useEffect(() => {
    if (!targetNode) return
    const from = camera.position.clone()
    const targetPos = new THREE.Vector3(targetNode.x!, targetNode.y!, targetNode.z!)
    aim.current = null

    // Orbited: keep the same relative orbit on the next node — translate only,
    // no reorientation, so the view doesn't jump. Stance/gaze persist.
    if (Math.abs(stance.current.w) < 0.9999) {
      const offset = Y_AXIS.clone().applyQuaternion(stance.current).multiplyScalar(radius.current)
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
    // identity here, so look is already the world-frame yaw/pitch. Park at the
    // current dolly distance above the node, not the fixed default.
    const to = targetPos.add(Y_AXIS.clone().multiplyScalar(radius.current))
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

  // Auto-frame a plotted course: stay parked on the current node but turn the
  // gaze down the route and dolly out so the route fits. The destination is
  // guaranteed in frame; if the route diverges too far to fit everything, we
  // look straight at the destination and show as much of the rest as we can.
  useEffect(() => {
    if (frameSignal === 0 || !frameTarget || travel.current) return
    const n = currentRef.current
    const node = new THREE.Vector3(n.x!, n.y!, n.z!)
    const dest = new THREE.Vector3(frameTarget.destination[0], frameTarget.destination[1], frameTarget.destination[2])

    // zoom === false: only turn the gaze to the destination, keeping the current
    // stance + dolly distance (e.g. selecting a node on a plotted route — turn to
    // it without changing the route framing).
    if (frameTarget.zoom === false) {
      const camPos = node.clone().add(
        Y_AXIS.clone().applyQuaternion(stance.current).multiplyScalar(radius.current),
      )
      const face = faceYawPitch(camPos, dest)
      // instant: snap the gaze (e.g. behind the blast doors, so they open already
      // looking at the target). Otherwise animate the turn.
      if (frameTarget.instant) {
        aim.current = null
        look.current.yaw += wrapPi(face.yaw - look.current.yaw)
        look.current.pitch = THREE.MathUtils.clamp(face.pitch, -1.45, 1.45)
        return
      }
      const toYaw = look.current.yaw + wrapPi(face.yaw - look.current.yaw)
      const angle = Math.hypot(toYaw - look.current.yaw, face.pitch - look.current.pitch)
      aim.current = {
        t: 0,
        fromYaw: look.current.yaw,
        fromPitch: look.current.pitch,
        toYaw,
        toPitch: face.pitch,
        duration: THREE.MathUtils.clamp(Math.max(angle * 0.5, 0.4), 0.4, 1.0),
      }
      return
    }

    const pts = frameTarget.points.map((p) => new THREE.Vector3(p[0], p[1], p[2]))
    if (pts.length === 0) pts.push(dest)
    const center = pts.reduce((a, p) => a.add(p), new THREE.Vector3()).multiplyScalar(1 / pts.length)
    // Frame top-down (stance identity → camera sits at node + up·R looking down).
    stance.current.identity()
    probe.fov = camera.fov
    probe.aspect = camera.aspect
    probe.near = camera.near
    probe.far = camera.far
    probe.up.set(0, 1, 0)
    const MARGIN = 0.85
    const place = (R: number, lookAt: THREE.Vector3) => {
      probe.position.copy(node).addScaledVector(Y_AXIS, R)
      probe.lookAt(lookAt)
      probe.updateMatrixWorld()
      probe.matrixWorldInverse.copy(probe.matrixWorld).invert()
      probe.updateProjectionMatrix()
    }
    const within = (p: THREE.Vector3) => {
      const v = p.clone().project(probe)
      return v.z < 1 && Math.abs(v.x) < MARGIN && Math.abs(v.y) < MARGIN
    }
    const STEPS = 28
    const rAt = (i: number) => MIN_R * Math.pow(MAX_R / MIN_R, i / STEPS)
    let chosenR = MAX_R
    let lookAt = dest
    let fitAll = false
    for (let i = 0; i <= STEPS; i++) {
      place(rAt(i), center)
      if (within(dest) && pts.every(within)) {
        chosenR = rAt(i)
        lookAt = center
        fitAll = true
        break
      }
    }
    if (!fitAll) {
      // Destination-guaranteed fallback: look straight at it, pick the zoom that
      // keeps the most waypoints on screen (smallest R on a tie → closer view).
      let best = -1
      for (let i = 0; i <= STEPS; i++) {
        place(rAt(i), dest)
        const count = pts.filter(within).length
        if (count > best) {
          best = count
          chosenR = rAt(i)
        }
      }
      lookAt = dest
    }
    // Animate the dolly out and the turn toward the route.
    radiusAnim.current = { from: radius.current, to: chosenR, t: 0, dur: 0.7 }
    const finalPos = node.clone().addScaledVector(Y_AXIS, chosenR)
    const face = faceYawPitch(finalPos, lookAt)
    const toYaw = look.current.yaw + wrapPi(face.yaw - look.current.yaw)
    const angle = Math.hypot(toYaw - look.current.yaw, face.pitch - look.current.pitch)
    aim.current = {
      t: 0,
      fromYaw: look.current.yaw,
      fromPitch: look.current.pitch,
      toYaw,
      toPitch: face.pitch,
      duration: THREE.MathUtils.clamp(Math.max(angle * 0.5, 0.5), 0.5, 1.2),
    }
  }, [frameSignal, frameTarget]) // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    const el = gl.domElement
    // Active pressed pointers by id → last screen position. One pointer =
    // look; two pointers = pinch-dolly the ship in/out (the touch equivalent
    // of the mouse wheel).
    const pointers = new Map<number, { x: number; y: number }>()
    let pinch: { startDist: number; startRadius: number } | null = null
    // Whether the active mouse drag is an orbit (right-button, or Shift+left).
    // Decided at pointerdown and held for the duration of the drag.
    let orbitMode = false

    // Multiplicative dolly so each notch feels even across the 3–600 range.
    // A manual zoom cancels any in-progress auto-frame animation.
    const dolly = (factor: number) => {
      radiusAnim.current = null
      radius.current = THREE.MathUtils.clamp(radius.current * factor, MIN_R, MAX_R)
    }
    const pinchDist = () => {
      const [a, b] = [...pointers.values()]
      return Math.hypot(a.x - b.x, a.y - b.y)
    }
    const centroid = () => {
      const [a, b] = [...pointers.values()]
      return { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 }
    }
    // Two-finger centroid, tracked between moves so a two-finger *drag* (not
    // pinch) orbits while pinch-distance zooms.
    let lastCentroid: { x: number; y: number } | null = null

    // Orbit (trackball): rotate the stance about the camera's tangent axes —
    // vertical tips over the node's poles, horizontal carries around its sides.
    // Both axes ⟂ the outward normal, so you always move (no pole, no spin in
    // place); the node stays pinned because gaze is stance-relative. Parked-only.
    // Shared by mouse right/Shift-drag and two-finger touch drag.
    const applyOrbit = (dx: number, dy: number) => {
      if (travel.current) return
      qYaw.setFromAxisAngle(Y_AXIS, look.current.yaw)
      axis.copy(X_AXIS).applyQuaternion(qYaw).applyQuaternion(stance.current)
      qDelta.setFromAxisAngle(axis, dy * ORBIT_SENS)
      stance.current.premultiply(qDelta)
      axis.copy(NEG_Z).applyQuaternion(qYaw).applyQuaternion(stance.current)
      qDelta.setFromAxisAngle(axis, -dx * ORBIT_SENS)
      stance.current.premultiply(qDelta)
      stance.current.normalize()
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
      if (pointers.size === 2) {
        pinch = { startDist: pinchDist(), startRadius: radius.current }
        lastCentroid = centroid()
      }
    }
    const onMove = (e: PointerEvent) => {
      const prev = pointers.get(e.pointerId)
      if (!prev) return
      const dx = e.clientX - prev.x
      const dy = e.clientY - prev.y
      prev.x = e.clientX
      prev.y = e.clientY

      // Two fingers: pinch-distance dollies the ship; centroid drag orbits.
      // Fingers apart → smaller radius (closer), matching pinch-to-zoom-in.
      if (pointers.size >= 2) {
        if (pinch) {
          radiusAnim.current = null
          radius.current = THREE.MathUtils.clamp(
            pinch.startRadius * (pinch.startDist / (pinchDist() || 1)),
            MIN_R,
            MAX_R,
          )
        }
        const c = centroid()
        if (lastCentroid) applyOrbit(c.x - lastCentroid.x, c.y - lastCentroid.y)
        lastCentroid = c
        return
      }
      // The brief auto-aim turn owns the view; ignore drags during it.
      if (travel.current?.phase === 'turn') return

      // Mouse right-button / Shift+left drag orbits (parked-only via applyOrbit).
      if (orbitMode && pointers.size === 1) {
        applyOrbit(dx, dy)
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
      if (pointers.size < 2) {
        pinch = null
        lastCentroid = null
      }
      if (pointers.size === 0) orbitMode = false
    }
    const onWheel = (e: WheelEvent) => {
      e.preventDefault()
      // Scroll out (positive deltaY) dollies away to frame the whole graph;
      // scroll in pulls up close to inspect a node. Exponential = even feel.
      dolly(Math.exp(e.deltaY * 0.0015))
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
    // Animated dolly (auto-frame): ease the parked distance toward its target.
    const ra = radiusAnim.current
    if (ra) {
      ra.t = Math.min(1, ra.t + delta / ra.dur)
      radius.current = ra.from + (ra.to - ra.from) * smoothstep(ra.t)
      if (ra.t >= 1) radiusAnim.current = null
    }
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
          // Hold position here until currentNode catches up (see justArrived).
          justArrived.current = true
          onArriveRef.current()
        }
      }
    } else if (!justArrived.current) {
      // Parked: position = node + outward normal · radius (the stance's up axis),
      // so an orbit drag takes effect live. Skipped during the just-arrived gap,
      // when currentRef still points at the previous node.
      const n = currentRef.current
      nodePos.set(n.x!, n.y!, n.z!)
      v1.copy(Y_AXIS).applyQuaternion(stance.current).multiplyScalar(radius.current)
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
