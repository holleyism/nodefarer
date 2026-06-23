import { useEffect, useMemo, useRef } from 'react'
import { useFrame } from '@react-three/fiber'
import * as THREE from 'three'
import type { Graph } from '../types'
import { makeBeamMaterial } from './beamMaterial'
import { NODE_RADIUS } from './Nodes'

const UP = new THREE.Vector3(0, 1, 0)
// How far past a node's radius the beam should already be gone. The end fade
// reaches full opacity at distance (radius + gap) from the node center, so the
// beam disappears before touching the surface.
const FADE_GAP = 3

// Edges touching the current node are the travel lanes out of here — they read
// brighter (not wider, so re-anchoring doesn't pop the geometry). Wormholes are
// violet with a flow shimmer.
const INACTIVE = new THREE.Color('#7d9fd4')
const ACTIVE = new THREE.Color('#9fdcff')
// Beams are additive — opacity is the brightness lever. Halved from 0.3/0.6.
const INACTIVE_OP = 0.15
const ACTIVE_OP = 0.3
// A highlighted (e.g. plotted-route) edge: same beam, recoloured + brightened
// in place so the emphasis is an overlay on the real geometry, never floating.
const HIGHLIGHT_OP = 0.75
const RADIUS = 0.3

// Wormhole funnel profile (world units): a thin conduit that flares to a wide
// mouth at each node with a 1/x²-style falloff. Built as one surface of
// revolution so the flare and the conduit are a single seamless mesh — no
// cone/cylinder joins with mismatched shading.
const WORM_CONDUIT = 0.5
const WORM_MOUTH = 1.7
const WORM_FALLOFF = 2.4 // smaller → tighter, sharper mouth

function funnelGeometry(length: number): THREE.LatheGeometry {
  const N = 64
  const pts: THREE.Vector2[] = []
  for (let i = 0; i <= N; i++) {
    // Cluster samples toward both ends (Chebyshev-ish) to resolve the flare.
    const ynorm = 0.5 * (1 - Math.cos(Math.PI * (i / N)))
    const y = (ynorm - 0.5) * length
    const d = Math.min(y + length / 2, length / 2 - y) // distance from nearest end
    const k = d / WORM_FALLOFF
    const r = WORM_CONDUIT + (WORM_MOUTH - WORM_CONDUIT) / (1 + k * k)
    pts.push(new THREE.Vector2(r, y))
  }
  return new THREE.LatheGeometry(pts, 24)
}

interface EdgesProps {
  graph: Graph
  currentId: string
  // Highlighted edges → their highlight colour (route / nebula overlays may
  // layer, each with its own colour; Plan H3).
  highlightEdges?: Map<string, string>
  // While true, beam transforms are recomputed each frame from the live endpoint
  // positions (a layout reform in progress), so beams stay glued to the moving
  // nodes and in phase with the camera instead of lagging React by a frame.
  live?: boolean
  // Spotlight a highlighted path: everything NOT highlighted fades way back so
  // the lit route reads on its own.
  dimOthers?: boolean
}

// How far a non-highlighted beam falls back while the path is spotlit (fraction
// of its normal opacity that remains).
const DIM_KEEP = 0.16

export function Edges({ graph, currentId, highlightEdges, live = false, dimOthers = false }: EdgesProps) {
  const cylGeo = useMemo(() => new THREE.CylinderGeometry(1, 1, 1, 12, 24, true), [])
  // Latest per-edge highlight colours, read live inside the frame loop.
  const hlRef = useRef<Map<string, string>>(highlightEdges ?? new Map())
  hlRef.current = highlightEdges ?? hlRef.current
  // Cache a THREE.Color per colour string (avoids per-frame allocation).
  const colorCache = useMemo(() => new Map<string, THREE.Color>(), [])
  const colorFor = (c: string) => {
    let col = colorCache.get(c)
    if (!col) {
      col = new THREE.Color(c)
      colorCache.set(c, col)
    }
    return col
  }
  const scratch = useMemo(() => new THREE.Color(), [])

  // One material (and, for wormholes, one funnel geometry) per edge so each can
  // animate independently. Same shader program → no extra draw calls; meshes
  // were already one-per-edge.
  const items = useMemo(
    () =>
      graph.edges.map((e) => {
        const a = graph.nodeById.get(e.source)!
        const b = graph.nodeById.get(e.target)!
        const av = new THREE.Vector3(a.x!, a.y!, a.z!)
        const bv = new THREE.Vector3(b.x!, b.y!, b.z!)
        const dir = bv.clone().sub(av).normalize()
        const length = av.distanceTo(bv)
        const worm = e.kind === 'semantic'
        // Fade each end over (node radius + gap) so the beam stops short of the
        // node surface, scaled per the actual node it meets.
        const fadeA = THREE.MathUtils.clamp((NODE_RADIUS[a.type] + FADE_GAP) / length, 0.04, 0.45)
        const fadeB = THREE.MathUtils.clamp((NODE_RADIUS[b.type] + FADE_GAP) / length, 0.04, 0.45)
        return {
          id: e.id,
          source: e.source,
          target: e.target,
          worm,
          mat: worm
            ? makeBeamMaterial('#b98bff', ACTIVE_OP, 1, fadeA, fadeB)
            : makeBeamMaterial('#7d9fd4', INACTIVE_OP, 0, fadeA, fadeB),
          geo: worm ? funnelGeometry(length) : null, // null → shared cylGeo
          scale: (worm ? [1, 1, 1] : [RADIUS, length, RADIUS]) as [number, number, number],
          len0: length, // beam length at build — for the worm funnel's live scale ratio
          activeF: 0, // animated 0→1 as this edge becomes/stops being a lane
          hlF: 0, // animated 0→1 as this edge becomes/stops being highlighted
          dimF: 0, // animated 0→1 as this edge fades back under a path spotlight
          hlColor: new THREE.Color('#ffce7a'), // current highlight tint (per-edge)
          mid: av.clone().add(bv).multiplyScalar(0.5),
          quat: new THREE.Quaternion().setFromUnitVectors(UP, dir),
        }
      }),
    [graph],
  )

  useEffect(
    () => () => {
      for (const it of items) {
        it.mat.dispose()
        it.geo?.dispose()
      }
    },
    [items],
  )

  // Imperative per-frame transform sync during a reform: rebuild each beam's
  // position/orientation/length from the live endpoints, so beams stay attached
  // to the moving nodes and in phase with the camera (no React-cadence lag).
  const meshes = useRef(new Map<string, THREE.Mesh>())
  const registerMesh = useRef((id: string, m: THREE.Mesh | null) => {
    if (m) meshes.current.set(id, m)
    else meshes.current.delete(id)
  }).current
  const liveRef = useRef(live)
  liveRef.current = live
  const dimRef = useRef(dimOthers)
  dimRef.current = dimOthers
  const graphRef = useRef(graph)
  graphRef.current = graph
  const itemsRef = useRef(items)
  itemsRef.current = items
  const av = useMemo(() => new THREE.Vector3(), [])
  const bv = useMemo(() => new THREE.Vector3(), [])
  const dir = useMemo(() => new THREE.Vector3(), [])
  useFrame(() => {
    if (!liveRef.current) return
    const g = graphRef.current
    for (const it of itemsRef.current) {
      const a = g.nodeById.get(it.source)
      const b = g.nodeById.get(it.target)
      if (!a || !b || a.x == null || b.x == null) continue
      const m = meshes.current.get(it.id)
      if (!m) continue
      av.set(a.x, a.y!, a.z!)
      bv.set(b.x!, b.y!, b.z!)
      m.position.copy(av).add(bv).multiplyScalar(0.5)
      dir.copy(bv).sub(av)
      const length = dir.length()
      m.quaternion.setFromUnitVectors(UP, dir.normalize())
      if (it.worm) m.scale.set(1, length / it.len0, 1)
      else m.scale.set(RADIUS, length, RADIUS)
    }
  })

  useFrame((state, delta) => {
    const t = state.clock.elapsedTime
    const k = Math.min(1, delta * 6) // ~0.3s ease toward the active/inactive look
    const dimOn = dimRef.current
    for (const it of items) {
      const hc = hlRef.current.get(it.id)
      // A spotlit path dims everything not highlighted (wormholes included).
      const dimTarget = dimOn && !hc ? 1 : 0
      if (it.worm) {
        it.mat.uTime = t
        it.dimF += (dimTarget - it.dimF) * k
        if (Math.abs(dimTarget - it.dimF) < 0.002) it.dimF = dimTarget
        it.mat.uOpacity = ACTIVE_OP * (1 - (1 - DIM_KEEP) * it.dimF)
        continue
      }
      const target = it.source === currentId || it.target === currentId ? 1 : 0
      const hlTarget = hc ? 1 : 0
      if (hc) it.hlColor.copy(colorFor(hc)) // keep last colour during fade-out
      // Skip work only when fully settled across lane, highlight AND dim states.
      if (it.activeF === target && it.hlF === hlTarget && it.dimF === dimTarget && hlTarget === 0 && dimTarget === 0)
        continue
      it.activeF += (target - it.activeF) * k
      if (Math.abs(target - it.activeF) < 0.002) it.activeF = target
      it.hlF += (hlTarget - it.hlF) * k
      if (Math.abs(hlTarget - it.hlF) < 0.002) it.hlF = hlTarget
      it.dimF += (dimTarget - it.dimF) * k
      if (Math.abs(dimTarget - it.dimF) < 0.002) it.dimF = dimTarget
      // Base lane look, then blend toward the highlight colour/brightness, then
      // fade back if this edge is off the spotlit path.
      scratch.lerpColors(INACTIVE, ACTIVE, it.activeF)
      const baseOp = INACTIVE_OP + (ACTIVE_OP - INACTIVE_OP) * it.activeF
      it.mat.uColor.copy(scratch).lerp(it.hlColor, it.hlF)
      const op = baseOp + (HIGHLIGHT_OP - baseOp) * it.hlF
      it.mat.uOpacity = op * (1 - (1 - DIM_KEEP) * it.dimF)
    }
  })

  return (
    <group>
      {items.map((it) => (
        <mesh
          key={it.id}
          ref={(m) => registerMesh(it.id, m)}
          geometry={it.geo ?? cylGeo}
          material={it.mat}
          position={it.mid}
          quaternion={it.quat}
          scale={it.scale}
          raycast={() => null}
        />
      ))}
    </group>
  )
}
