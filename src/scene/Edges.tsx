import { useEffect, useMemo, useRef } from 'react'
import { useFrame } from '@react-three/fiber'
import * as THREE from 'three'
import type { Graph } from '../types'
import { makeBeamMaterial } from './beamMaterial'
import { NODE_RADIUS } from './Nodes'
import { useEnterExit } from './useEnterExit'

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
  // Blast-door state — gates the enter/exit fade (see useEnterExit).
  doorsClosed?: boolean
}

// How far a non-highlighted beam falls back while the path is spotlit (fraction
// of its normal opacity that remains).
const DIM_KEEP = 0.16

// Per-edge render record: a beam mesh + its own material (and, for wormholes, a
// funnel geometry), kept in a persistent cache keyed by edge id so an edge
// leaving the scene can stay rendered while it fades out (and is disposed only
// once the fade has truly dropped it).
interface EdgeItem {
  id: string
  source: string
  target: string
  worm: boolean
  mat: ReturnType<typeof makeBeamMaterial>
  geo: THREE.LatheGeometry | null // null → shared cylinder
  scale: [number, number, number]
  len0: number
  activeF: number
  hlF: number
  dimF: number
  hlColor: THREE.Color
  mid: THREE.Vector3
  quat: THREE.Quaternion
}

export function Edges({ graph, currentId, highlightEdges, live = false, dimOthers = false, doorsClosed = false }: EdgesProps) {
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

  // Persistent per-edge cache. Built lazily for new edges and updated in place as
  // endpoints move; an entry survives the edge leaving `graph` (it's still being
  // faded out) and is disposed only when the enter/exit fade finally drops it.
  const cache = useRef(new Map<string, EdgeItem>())

  const buildOrUpdate = (id: string, source: string, target: string) => {
    const a = graph.nodeById.get(source)
    const b = graph.nodeById.get(target)
    if (!a || !b || a.x == null || b.x == null) return // endpoint gone — keep last transform
    const av = new THREE.Vector3(a.x!, a.y!, a.z!)
    const bv = new THREE.Vector3(b.x!, b.y!, b.z!)
    const dir = bv.clone().sub(av)
    const length = dir.length()
    dir.normalize()
    const mid = av.clone().add(bv).multiplyScalar(0.5)
    const quat = new THREE.Quaternion().setFromUnitVectors(UP, dir)
    let it = cache.current.get(id)
    if (!it) {
      const worm = graph.edges.find((e) => e.id === id)?.kind === 'semantic'
      // Fade each end over (node radius + gap) so the beam stops short of the
      // node surface, scaled per the actual node it meets.
      const fadeA = THREE.MathUtils.clamp((NODE_RADIUS[a.type] + FADE_GAP) / length, 0.04, 0.45)
      const fadeB = THREE.MathUtils.clamp((NODE_RADIUS[b.type] + FADE_GAP) / length, 0.04, 0.45)
      it = {
        id,
        source,
        target,
        worm,
        mat: worm
          ? makeBeamMaterial('#b98bff', ACTIVE_OP, 1, fadeA, fadeB)
          : makeBeamMaterial('#7d9fd4', INACTIVE_OP, 0, fadeA, fadeB),
        geo: worm ? funnelGeometry(length) : null,
        scale: (worm ? [1, 1, 1] : [RADIUS, length, RADIUS]) as [number, number, number],
        len0: length,
        activeF: 0,
        hlF: 0,
        dimF: 0,
        hlColor: new THREE.Color('#ffce7a'),
        mid,
        quat,
      }
      cache.current.set(id, it)
    } else {
      // Keep the static transform current as endpoints shift (non-live renders).
      // Worms keep their fixed-length funnel geometry but rescale to the new span
      // (same as the live-sync loop), so a relayout doesn't leave a stale conduit.
      it.mid.copy(mid)
      it.quat.copy(quat)
      it.scale = it.worm ? [1, length / it.len0, 1] : [RADIUS, length, RADIUS]
    }
  }

  // Refresh/extend the cache for every current edge before we resolve membership.
  for (const e of graph.edges) buildOrUpdate(e.id, e.source, e.target)

  // Enter/exit membership + fade for the edge set.
  const faded = useEnterExit(graph.edges, (e) => e.id, doorsClosed)
  // Mirror the live fade into a ref the easing loop reads, and dispose any cache
  // entry the fade has finally dropped (no longer present and not still exiting).
  const fadeRef = useRef(new Map<string, number>())
  const liveIds = new Set(faded.map((f) => f.key))
  const nextFade = new Map<string, number>()
  for (const f of faded) nextFade.set(f.key, f.opacity)
  fadeRef.current = nextFade
  for (const [id, it] of cache.current) {
    if (!liveIds.has(id)) {
      it.mat.dispose()
      it.geo?.dispose()
      cache.current.delete(id)
    }
  }

  useEffect(
    () => () => {
      for (const it of cache.current.values()) {
        it.mat.dispose()
        it.geo?.dispose()
      }
      cache.current.clear()
    },
    [],
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
  const av = useMemo(() => new THREE.Vector3(), [])
  const bv = useMemo(() => new THREE.Vector3(), [])
  const dir = useMemo(() => new THREE.Vector3(), [])
  useFrame(() => {
    if (!liveRef.current) return
    const g = graphRef.current
    for (const it of cache.current.values()) {
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
    for (const it of cache.current.values()) {
      // Enter/exit dissolve, multiplied into whatever opacity the lane/highlight/
      // dim state lands on (1 when fully present, so settled edges are unaffected).
      const fade = fadeRef.current.get(it.id) ?? 1
      const hc = hlRef.current.get(it.id)
      // A spotlit path dims everything not highlighted (wormholes included).
      const dimTarget = dimOn && !hc ? 1 : 0
      if (it.worm) {
        it.mat.uTime = t
        it.dimF += (dimTarget - it.dimF) * k
        if (Math.abs(dimTarget - it.dimF) < 0.002) it.dimF = dimTarget
        it.mat.uOpacity = ACTIVE_OP * (1 - (1 - DIM_KEEP) * it.dimF) * fade
        continue
      }
      const target = it.source === currentId || it.target === currentId ? 1 : 0
      const hlTarget = hc ? 1 : 0
      if (hc) it.hlColor.copy(colorFor(hc)) // keep last colour during fade-out
      // Skip work only when fully settled across lane, highlight, dim AND fade.
      if (it.activeF === target && it.hlF === hlTarget && it.dimF === dimTarget && hlTarget === 0 && dimTarget === 0 && fade === 1)
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
      it.mat.uOpacity = op * (1 - (1 - DIM_KEEP) * it.dimF) * fade
    }
  })

  return (
    <group>
      {faded.map(({ key }) => {
        const it = cache.current.get(key)
        if (!it) return null
        return (
          <mesh
            key={key}
            ref={(m) => registerMesh(key, m)}
            geometry={it.geo ?? cylGeo}
            material={it.mat}
            position={it.mid}
            quaternion={it.quat}
            scale={it.scale}
            raycast={() => null}
          />
        )
      })}
    </group>
  )
}
