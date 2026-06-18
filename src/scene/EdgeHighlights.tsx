import { useEffect, useMemo, useRef } from 'react'
import { useFrame } from '@react-three/fiber'
import { Html, Line } from '@react-three/drei'
import * as THREE from 'three'
import type { Line2 } from 'three-stdlib'
import type { Graph, GraphEdge } from '../types'

// HUD instrument colors — like the reticles, these are the window's own
// graphics, so structural brackets are HUD blue; wormholes echo their violet.
const HUD = '#7fd4ff'
const WORM = '#c6a3ff'

// The highlight is two straight rails flanking the edge ( | edge | ), spanning
// T_A..T_B at a fixed offset on each side — held a little off the edge so they
// read as a frame, not a doubled line.
const T_A = 0.14
const T_B = 0.86
const ARC_N = 2
const DUMMY = Array.from({ length: ARC_N }, () => [0, 0, 0] as [number, number, number])

interface BracketProps {
  edge: GraphEdge
  graph: Graph
  pinned: boolean
}

// One highlight = two rounded corner-bracket "rails" flanking the edge ( [ ] ),
// billboarded around the edge axis so the flat frame always faces the camera.
// Each rail is a single thick line with rounded corners and inward hooks.
function EdgeBracket({ edge, graph, pinned }: BracketProps) {
  const a = graph.nodeById.get(edge.source)!
  const b = graph.nodeById.get(edge.target)!
  const worm = edge.kind === 'semantic'
  const color = worm ? WORM : HUD

  const av = useMemo(() => new THREE.Vector3(a.x!, a.y!, a.z!), [a])
  const bv = useMemo(() => new THREE.Vector3(b.x!, b.y!, b.z!), [b])
  const mid = useMemo(() => av.clone().add(bv).multiplyScalar(0.5), [av, bv])

  const topRef = useRef<Line2>(null)
  const botRef = useRef<Line2>(null)
  const top = useMemo(() => new Float32Array(ARC_N * 3), [])
  const bot = useMemo(() => new Float32Array(ARC_N * 3), [])
  // Acquisition flash: 1 the instant this highlight appears (pin/hover), decaying
  // to 0 — the arcs start oversized, white-hot and over-bright, then settle.
  const flash = useRef(1)
  // The line stays fully opaque — that's what keeps the thick line's segment
  // caps from stacking into a "dotted" look. Hover reads dimmer via a darker
  // color, not lower alpha.
  const baseColor = useMemo(() => {
    const c = new THREE.Color(color)
    if (!pinned) c.multiplyScalar(0.55)
    return c
  }, [color, pinned])
  const white = useMemo(() => new THREE.Color('#ffffff'), [])

  const s = useMemo(
    () => ({
      dir: new THREE.Vector3(),
      toCam: new THREE.Vector3(),
      side: new THREE.Vector3(),
      p: new THREE.Vector3(),
    }),
    [],
  )

  // Configure static line-material flags once. Normal (not additive) blending;
  // each arc is a single non-self-crossing curve so nothing piles up brightness.
  // Opacity, color and width are animated per-frame for the flash.
  useEffect(() => {
    for (const ref of [topRef, botRef]) {
      const line = ref.current
      if (!line) continue
      const m = line.material as THREE.Material
      m.transparent = true
      m.depthTest = false
      m.depthWrite = false
      m.blending = THREE.NormalBlending
      m.toneMapped = false
      line.renderOrder = 1001
      line.frustumCulled = false
    }
  }, [])

  useFrame(({ camera }, delta) => {
    if (!topRef.current || !botRef.current) return
    const f = (flash.current = Math.max(0, flash.current - delta / 0.5))
    // Read endpoints live — the layout mutates node x/y/z in place on the same
    // instance, so a memoized vector would leave the bracket at the node's old
    // position after a dynamic relayout (floating where the edge no longer is).
    av.set(a.x!, a.y!, a.z!)
    bv.set(b.x!, b.y!, b.z!)
    mid.copy(av).add(bv).multiplyScalar(0.5)
    s.dir.subVectors(bv, av)
    const len = s.dir.length()
    s.dir.divideScalar(len || 1)
    s.toCam.subVectors(camera.position, mid).normalize()
    s.side.crossVectors(s.dir, s.toCam)
    if (s.side.lengthSq() < 1e-6) s.side.set(0, 1, 0)
    s.side.normalize()

    // Rail offset from the edge (held close); flash widens it briefly.
    const hw = THREE.MathUtils.clamp(len * 0.0275, 0.7, 1.3) * (1 + 0.6 * f)

    const writeArc = (out: Float32Array, sign: number) => {
      for (let i = 0; i < ARC_N; i++) {
        const u = i / (ARC_N - 1)
        const t = T_A + (T_B - T_A) * u
        // Straight rail: constant offset from the edge (flash widens it briefly).
        s.p
          .copy(av)
          .addScaledVector(s.dir, len * t)
          .addScaledVector(s.side, hw * sign)
        out[i * 3] = s.p.x
        out[i * 3 + 1] = s.p.y
        out[i * 3 + 2] = s.p.z
      }
    }

    writeArc(top, 1)
    writeArc(bot, -1)
    topRef.current.geometry.setPositions(top)
    botRef.current.geometry.setPositions(bot)

    for (const ref of [topRef, botRef]) {
      const m = ref.current!.material as THREE.Material & {
        opacity: number
        color: THREE.Color
        linewidth: number
      }
      m.opacity = 1
      m.color.copy(baseColor).lerp(white, Math.min(1, f))
      m.linewidth = 0.3 * (1 + 1.6 * f)
    }
  })

  return (
    <>
      <Line ref={topRef} points={DUMMY} color={color} lineWidth={0.3} worldUnits />
      <Line ref={botRef} points={DUMMY} color={color} lineWidth={0.3} worldUnits />
      {/* Only wormholes carry a viewport label — "jump/trunk" on a structural
          edge adds nothing. The panel still shows every edge's kind. */}
      {pinned && worm && (
        <group position={mid}>
          <Html center zIndexRange={[40, 0]} style={{ pointerEvents: 'none' }}>
            <div
              style={{
                transform: 'translateY(-2px)',
                whiteSpace: 'nowrap',
                font: '10px/1.5 ui-monospace, SFMono-Regular, Menlo, monospace',
                letterSpacing: 1.4,
                textTransform: 'uppercase',
                color: worm ? '#e3d2ff' : '#aadfff',
                background: 'rgba(4, 14, 28, 0.72)',
                border: `1px solid ${worm ? 'rgba(198,163,255,0.55)' : 'rgba(127,212,255,0.45)'}`,
                borderRadius: 999,
                padding: '1px 9px',
                backdropFilter: 'blur(2px)',
              }}
            >
              {edge.label}
            </div>
          </Html>
        </group>
      )}
    </>
  )
}

interface EdgeHighlightsProps {
  graph: Graph
  pinnedEdgeIds: string[]
  hoveredEdgeId: string | null
}

// Multiple edges can be pinned (bracketed solid); hovering a link row in the
// panel shows a lighter preview bracket for the not-yet-pinned edge.
export function EdgeHighlights({ graph, pinnedEdgeIds, hoveredEdgeId }: EdgeHighlightsProps) {
  const pinned = pinnedEdgeIds.map((id) => graph.edgeById.get(id)).filter(Boolean) as GraphEdge[]
  const hover =
    hoveredEdgeId && !pinnedEdgeIds.includes(hoveredEdgeId)
      ? graph.edgeById.get(hoveredEdgeId) ?? null
      : null

  return (
    <>
      {pinned.map((e) => (
        <EdgeBracket key={e.id} edge={e} graph={graph} pinned />
      ))}
      {hover && <EdgeBracket key={`hover-${hover.id}`} edge={hover} graph={graph} pinned={false} />}
    </>
  )
}
