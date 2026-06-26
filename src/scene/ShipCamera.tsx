import { useEffect, useMemo, useRef } from 'react'
import { useFrame, useThree } from '@react-three/fiber'
import * as THREE from 'three'
import type { GraphNode } from '../types'
import { shipBus } from './shipBus'

interface Travel {
  // 'turn' orbits the stance into the edge-relative frame; 'fly' slides straight.
  phase: 'turn' | 'fly'
  t: number
  nodePos: THREE.Vector3 // node we depart from (orbit pivot + slide start)
  destPos: THREE.Vector3 // node we fly to
  up: THREE.Vector3 // edge-relative hover direction (perpendicular to the edge)
  fromStance: THREE.Quaternion
  toStance: THREE.Quaternion
  fromLookYaw: number
  fromLookPitch: number
  turnDuration: number
  flyDuration: number
  // translate = unlocked: keep the user's current frame, just slide (no reorient).
  translate: boolean
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

// Edge-relative frame for course-scrub: given a (normalized) travel direction
// `fwd` and the current outward `curUp`, return a stance whose local Y = the
// hover `up` (perpendicular to fwd, closest to curUp) and local −Z = fwd, so the
// 0° gaze looks straight down the lane. Standalone (not shared with travel) so
// the existing travel/tour camera math is left exactly as it was.
function edgeStance(fwd: THREE.Vector3, curUp: THREE.Vector3) {
  let up = curUp.clone().addScaledVector(fwd, -curUp.dot(fwd))
  if (up.lengthSq() < 1e-5) {
    const alt = Math.abs(fwd.y) < 0.9 ? Y_AXIS : X_AXIS
    up = alt.clone().addScaledVector(fwd, -alt.dot(fwd))
  }
  up.normalize()
  const zAxis = fwd.clone().negate()
  const xAxis = new THREE.Vector3().crossVectors(up, zAxis).normalize()
  return new THREE.Quaternion().setFromRotationMatrix(
    new THREE.Matrix4().makeBasis(xAxis, up, zAxis),
  )
}

// Scroll-wheel arc-length per wheel delta when scrubbing a course.
const SCRUB_SENS = 0.25

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
  // Bumped to pull WAY back to an overview that frames every supplied point (the
  // whole journey corridor) — slerps the orientation + dollies out to a 3/4-from-
  // above vantage. Not parked on a node; held until the next navigation.
  overviewSignal?: number
  overviewPoints?: [number, number, number][] | null
  // Course-scrub: when on, the scroll wheel slides the ship ALONG the plotted
  // course (instead of dollying) — a manual, user-paced version of travel that
  // stays on the rails. `scrubPath` is the ordered world positions of the
  // plotted route (current node first). Shift+wheel still dollies. Inert unless
  // a course is supplied; never engaged during travel or a tour.
  scrubMode?: boolean
  scrubPath?: [number, number, number][] | null
  // Reports the route node the ship is currently nearest as it scrubs, so the
  // HUD can show "approaching X" and Dock knows where to commit.
  onScrubIndex?: (index: number) => void
  onUnlock: () => void
  onArrive: () => void
}

// The "ship": a camera parked at the current node. Orientation always lives
// in user-owned yaw/pitch. While the camera is locked to the course, each
// leg starts with an auto-aim turn toward the next hop; dragging mid-flight
// unlocks the camera (the view is then never reset at waypoints) until
// "follow course" re-engages it.
export function ShipCamera({ currentNode, targetNode, following, followSignal, recenterSignal = 0, recenterKeepZoom = false, frameSignal = 0, frameTarget = null, overviewSignal = 0, overviewPoints = null, scrubMode = false, scrubPath = null, onScrubIndex, onUnlock, onArrive }: Props) {
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
  // Animates the orbit STANCE toward a target (used by the recap to swing around
  // to a vantage framing the whole corridor — entirely via the normal parked
  // controls, so the camera stays a valid parked pose with no snap on takeover).
  const stanceAnim = useRef<{ from: THREE.Quaternion; to: THREE.Quaternion; t: number; dur: number } | null>(null)
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

  // --- Course-scrub state ---
  // The polyline being scrubbed: world points, per-segment unit directions, and
  // cumulative arc-length (cum[i] = distance from the start to point i; the last
  // entry is the total length L). Rebuilt whenever the supplied path changes.
  const poly = useMemo(() => {
    const pts = (scrubPath ?? []).map((p) => new THREE.Vector3(p[0], p[1], p[2]))
    const dirs: THREE.Vector3[] = []
    const cum: number[] = [0]
    for (let i = 0; i < pts.length - 1; i++) {
      const d = pts[i + 1].clone().sub(pts[i])
      const len = d.length()
      dirs.push(len > 1e-6 ? d.multiplyScalar(1 / len) : new THREE.Vector3(0, 0, 1))
      cum.push(cum[i] + len)
    }
    return { pts, dirs, cum, L: cum[cum.length - 1] ?? 0 }
  }, [scrubPath])
  // Arc-length position of the ship along the polyline (0 = start/current node).
  const scrubS = useRef(0)
  // The eased orbit stance while scrubbing — temporally smoothed toward the
  // current segment's edge frame so corners round off instead of snapping.
  const scrubStance = useRef(new THREE.Quaternion())
  // Mirror scrubMode for the wheel handler (set up once, reads latest value).
  const scrubModeRef = useRef(scrubMode)
  scrubModeRef.current = scrubMode
  const polyRef = useRef(poly)
  polyRef.current = poly
  const onScrubIndexRef = useRef(onScrubIndex)
  onScrubIndexRef.current = onScrubIndex
  // Last reported nearest-node index, so we only call back on a change.
  const scrubIndexRef = useRef(-1)
  // True for the first scrub frame after engaging, to seed scrubStance from the
  // live stance (no snap on takeover). Reset whenever the mode toggles.
  const scrubFresh = useRef(true)

  // Engage/disengage scrub: reset to the start of the course and re-seed. On
  // disengage (mode off), return to the ship — a clean parked stance + gaze over
  // the current node, undoing the lane frame the scrub left in `stance`.
  useEffect(() => {
    scrubS.current = 0
    scrubIndexRef.current = -1
    scrubFresh.current = true
    if (!scrubMode) {
      stance.current.identity()
      look.current.yaw = 0
      look.current.pitch = 0
      scrubStance.current.identity()
    }
  }, [scrubMode, scrubPath])

  // Map an arc-length s to a pose on the polyline: the point, the segment index
  // it falls on, and the nearest node index (for the HUD/Dock).
  const poseAt = (s: number) => {
    const p = polyRef.current
    const sClamped = THREE.MathUtils.clamp(s, 0, p.L)
    let i = 0
    while (i < p.dirs.length - 1 && p.cum[i + 1] <= sClamped) i++
    const segLen = p.cum[i + 1] - p.cum[i]
    const t = segLen > 1e-6 ? (sClamped - p.cum[i]) / segLen : 0
    nodePos.copy(p.pts[i]).lerp(p.pts[i + 1], t)
    return { point: nodePos, dir: p.dirs[i], nearest: t < 0.5 ? i : i + 1 }
  }

  useEffect(() => {
    // currentNode is now in sync — the just-arrived hold can release.
    justArrived.current = false
    stanceAnim.current = null // a new node ends any scripted recap orbit
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
    stanceAnim.current = null
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
    const destPos = new THREE.Vector3(targetNode.x!, targetNode.y!, targetNode.z!)
    const n = currentRef.current
    const nodePos = new THREE.Vector3(n.x!, n.y!, n.z!)
    aim.current = null
    stanceAnim.current = null

    // Travel uses an EDGE-RELATIVE frame: "up" is perpendicular to the edge, not
    // world-up, so the ship hovers above the lane by `radius` whatever the edge's
    // orientation — and a near-vertical edge is no longer flown straight down its
    // middle. "Up is relative": the frame persists, so the world can roll across
    // a journey (no global up). An unlocked camera keeps the user's own frame.
    const translate = !followingRef.current
    let up: THREE.Vector3
    let toStance: THREE.Quaternion
    if (translate) {
      up = Y_AXIS.clone().applyQuaternion(stance.current)
      toStance = stance.current.clone()
    } else {
      const fwd = destPos.clone().sub(nodePos)
      if (fwd.lengthSq() < 1e-6) fwd.set(0, 0, 1)
      fwd.normalize()
      // Perpendicular CLOSEST to the current up: project current up onto the
      // edge's perpendicular plane. If the edge is parallel to it (projection
      // collapses), fall back to the current right vector (an accepted roll).
      const curUp = Y_AXIS.clone().applyQuaternion(stance.current)
      up = curUp.addScaledVector(fwd, -curUp.dot(fwd))
      if (up.lengthSq() < 1e-5) {
        const curRight = X_AXIS.clone().applyQuaternion(stance.current)
        up = curRight.addScaledVector(fwd, -curRight.dot(fwd))
        if (up.lengthSq() < 1e-5) up = new THREE.Vector3(0, 1, 0).addScaledVector(fwd, -fwd.y)
      }
      up.normalize()
      // Stance whose local Y = up and local −Z = fwd, so the 0° gaze looks down
      // the lane toward the destination.
      const zAxis = fwd.clone().negate() // camera +Z is opposite the view dir
      const xAxis = new THREE.Vector3().crossVectors(up, zAxis).normalize()
      toStance = new THREE.Quaternion().setFromRotationMatrix(
        new THREE.Matrix4().makeBasis(xAxis, up, zAxis),
      )
    }
    const turnAngle = translate ? 0 : stance.current.angleTo(toStance)
    const needTurn = followingRef.current && turnAngle > 0.01
    travel.current = {
      phase: needTurn ? 'turn' : 'fly',
      t: 0,
      nodePos,
      destPos,
      up,
      fromStance: stance.current.clone(),
      toStance,
      fromLookYaw: look.current.yaw,
      fromLookPitch: look.current.pitch,
      turnDuration: THREE.MathUtils.clamp(turnAngle * 0.5, 0.15, 1.1),
      flyDuration: THREE.MathUtils.clamp(nodePos.distanceTo(destPos) / 45, 1.2, 4),
      translate,
    }
    // No turn: snap straight into the edge frame (tiny or skipped orbit).
    if (!needTurn && !translate) {
      stance.current.copy(toStance)
      look.current.yaw = 0
      look.current.pitch = 0
    }
  }, [targetNode, camera, stance])

  // "Follow course" pressed: swing the gaze back down the lane. In the edge frame
  // the lane is the 0° gaze, so this just eases any look-around back to zero
  // (mid-flight unlocking only changes `look`, never the stance — orbit is parked).
  useEffect(() => {
    if (followSignal === 0) return
    if (!travel.current) return
    aim.current = {
      t: 0,
      fromYaw: look.current.yaw,
      fromPitch: look.current.pitch,
      toYaw: 0,
      toPitch: 0,
      duration: 0.5,
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

  // Overview pull-back (recap): frame every supplied point. Pick a 3/4-from-above
  // vantage and the dolly distance that fits the points' bounding sphere, then
  // slerp orientation + lerp position there from wherever we are.
  useEffect(() => {
    if (overviewSignal === 0 || !overviewPoints || overviewPoints.length === 0) return
    const pts = overviewPoints.map((p) => new THREE.Vector3(p[0], p[1], p[2]))
    const center = pts.reduce((a, p) => a.add(p), new THREE.Vector3()).multiplyScalar(1 / pts.length)
    let r = 0
    for (const p of pts) r = Math.max(r, p.distanceTo(center))
    r = Math.max(r, 60)
    // Distance to fit the corridor's bounding sphere, and a vantage point.
    const vHalf = THREE.MathUtils.degToRad(camera.fov) / 2
    const hHalf = Math.atan(Math.tan(vHalf) * camera.aspect)
    const D = (r / Math.sin(Math.min(vHalf, hHalf))) * 1.15
    const dir = new THREE.Vector3(0.3, 0.85, 0.45).normalize() // high, slightly to the side
    const camPos = center.clone().addScaledVector(dir, D)

    // Express that pose purely with the USER controls — orbit height (radius),
    // orbit position (stance), view direction (look) — anchored on the current
    // node, so it's a normal parked pose and taking over from it never snaps.
    const node = currentRef.current
    const nodeVec = new THREE.Vector3(node.x!, node.y!, node.z!)
    const up = camPos.clone().sub(nodeVec)
    const newRadius = THREE.MathUtils.clamp(up.length(), MIN_R, MAX_R)
    up.normalize()
    // Stance with Y = up and a horizontal X (minimal roll).
    let xAxis = new THREE.Vector3().crossVectors(up, Y_AXIS)
    if (xAxis.lengthSq() < 1e-6) xAxis = new THREE.Vector3(1, 0, 0)
    xAxis.normalize()
    const zAxis = new THREE.Vector3().crossVectors(xAxis, up).normalize()
    const toStance = new THREE.Quaternion().setFromRotationMatrix(
      new THREE.Matrix4().makeBasis(xAxis, up, zAxis),
    )
    // Gaze toward the corridor centre, as yaw/pitch in that stance frame.
    const fLocal = center.clone().sub(camPos).normalize().applyQuaternion(toStance.clone().invert())
    const yaw = Math.atan2(-fLocal.x, -fLocal.z)
    const pitch = Math.asin(THREE.MathUtils.clamp(fLocal.y, -1, 1))

    travel.current = null
    stanceAnim.current = { from: stance.current.clone(), to: toStance, t: 0, dur: 1.8 }
    radiusAnim.current = { from: radius.current, to: newRadius, t: 0, dur: 1.8 }
    aim.current = {
      t: 0,
      fromYaw: look.current.yaw,
      fromPitch: look.current.pitch,
      toYaw: look.current.yaw + wrapPi(yaw - look.current.yaw),
      toPitch: pitch,
      duration: 1.8,
    }
  }, [overviewSignal]) // eslint-disable-line react-hooks/exhaustive-deps

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

    // Taking the controls cancels any scripted camera move (recap orbit/dolly/
    // gaze) IN PLACE — the camera is already a valid parked pose, so control
    // continues from exactly where it is, no snap.
    const grabControls = () => {
      stanceAnim.current = null
      radiusAnim.current = null
      aim.current = null
    }

    const onDown = (e: PointerEvent) => {
      grabControls()
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
      grabControls()
      // Course-scrub: with the mode on and a course under us, the wheel slides
      // the ship along the route instead of dollying — Shift forces the dolly so
      // zoom is still reachable. Disabled mid-travel (the rails own the camera).
      if (scrubModeRef.current && !e.shiftKey && polyRef.current.L > 0 && !travel.current) {
        scrubS.current = THREE.MathUtils.clamp(
          scrubS.current + e.deltaY * SCRUB_SENS,
          0,
          polyRef.current.L,
        )
        return
      }
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
    // Animated dolly (auto-frame / recap): ease the parked distance toward target.
    const ra = radiusAnim.current
    if (ra) {
      ra.t = Math.min(1, ra.t + delta / ra.dur)
      radius.current = ra.from + (ra.to - ra.from) * smoothstep(ra.t)
      if (ra.t >= 1) radiusAnim.current = null
    }
    // Animated orbit (recap): ease the stance toward its target. Parked, this
    // swings the ship around the node — a normal orbit, just scripted.
    const sa = stanceAnim.current
    if (sa) {
      sa.t = Math.min(1, sa.t + delta / sa.dur)
      stance.current.slerpQuaternions(sa.from, sa.to, smoothstep(sa.t))
      if (sa.t >= 1) stanceAnim.current = null
    }
    const tr = travel.current
    if (tr) {
      if (tr.phase === 'turn') {
        // Orbit the stance into the edge frame around the departing node, easing
        // any prior look-around back to a 0° (down-the-lane) gaze.
        tr.t = Math.min(1, tr.t + delta / tr.turnDuration)
        const s = smoothstep(tr.t)
        stance.current.slerpQuaternions(tr.fromStance, tr.toStance, s)
        look.current.yaw = tr.fromLookYaw * (1 - s)
        look.current.pitch = tr.fromLookPitch * (1 - s)
        v1.copy(Y_AXIS).applyQuaternion(stance.current).multiplyScalar(radius.current)
        camera.position.copy(tr.nodePos).add(v1)
        if (tr.t >= 1) {
          stance.current.copy(tr.toStance)
          look.current.yaw = 0
          look.current.pitch = 0
          tr.phase = 'fly'
          tr.t = 0
        }
      } else {
        // Straight slide, hovering by up·radius (edge-relative) at both ends.
        tr.t = Math.min(1, tr.t + delta / tr.flyDuration)
        nodePos.copy(tr.nodePos).lerp(tr.destPos, smoothstep(tr.t))
        v1.copy(tr.up).multiplyScalar(radius.current)
        camera.position.copy(nodePos).add(v1)
        if (tr.t >= 1) {
          travel.current = null
          // Hold position here until currentNode catches up (see justArrived).
          justArrived.current = true
          onArriveRef.current()
        }
      }
    } else if (scrubModeRef.current && polyRef.current.L > 0 && !justArrived.current) {
      // Course-scrub: ride the polyline at the wheel-driven arc-length. Position
      // is exact (point + hover·radius); the stance eases toward the segment's
      // edge frame so corners round off instead of snapping. Free-look (the gaze
      // yaw/pitch) and the dolly radius still apply on top, exactly as parked.
      const pose = poseAt(scrubS.current)
      if (scrubFresh.current) {
        scrubStance.current.copy(stance.current)
        scrubFresh.current = false
      }
      v1.copy(Y_AXIS).applyQuaternion(scrubStance.current) // carried up
      const target = edgeStance(pose.dir, v1)
      scrubStance.current.slerp(target, 1 - Math.exp(-6 * delta))
      stance.current.copy(scrubStance.current)
      v1.copy(Y_AXIS).applyQuaternion(stance.current).multiplyScalar(radius.current)
      camera.position.copy(pose.point).add(v1)
      if (pose.nearest !== scrubIndexRef.current) {
        scrubIndexRef.current = pose.nearest
        onScrubIndexRef.current?.(pose.nearest)
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
