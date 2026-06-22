import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { Box, Button, Slider, Stack, Switch, Typography } from '@mui/material'
import { StaticBundleSource } from '../data/StaticBundleSource'
import { DEFAULT_LEGEND } from '../data/viewBuilder'
import { syntheticBundle } from '../data/generateGraph'
import type { Bundle } from '../data/bundle'
import type { View } from '../data/GraphSource'
import type { GraphNode } from '../types'
import { layoutHyperbolic } from './layout'
import {
  type Complex,
  type Mobius,
  C,
  apply,
  cabs,
  cabs2,
  cneg,
  compose,
  distFromOrigin,
  geodesicPath,
  IDENTITY,
  radiusForDist,
  recenter,
  toScreen,
} from './complex'

// ─────────────────────────────────────────────────────────────────────────────
// HyperbolicPOC — an ISOLATED, throwaway 2D Poincaré-disk egocentric experiment
// (memory hyperbolic-poc-plan). It reuses StaticBundleSource to get a bounded
// View, lays it out as a Lamping hyperbolic tree, and renders to SVG. It does
// NOT touch GraphScene or the 3D egocentric scene. Mounted only behind
// `?poc=hyperbolic` in main.tsx.
//
// The question it tests: does a hyperbolic, egocentric layout keep GLOBAL
// context while the focus node stays detailed — better than the Euclidean
// bounded view — and does travel (a Möbius slide) feel coherent, not
// disorienting?
// ─────────────────────────────────────────────────────────────────────────────

let cachedBundle: Bundle | null = null
async function loadBundle(): Promise<Bundle> {
  if (cachedBundle) return cachedBundle
  try {
    const res = await fetch('/bundle.json')
    if (!res.ok) throw new Error(String(res.status))
    cachedBundle = (await res.json()) as Bundle
  } catch {
    cachedBundle = syntheticBundle(7)
  }
  return cachedBundle
}

const PANEL_SX = {
  bgcolor: 'rgba(8,14,28,0.82)',
  border: '1px solid rgba(127,212,255,0.25)',
  borderRadius: 1.5,
  px: 1.75,
  py: 1.5,
  color: '#bfe6ff',
  font: '11px/1.5 ui-monospace, Menlo, monospace',
  letterSpacing: 0.4,
} as const

const easeInOut = (t: number) => (t < 0.5 ? 2 * t * t : 1 - Math.pow(-2 * t + 2, 2) / 2)

export default function HyperbolicPOC() {
  const [view, setView] = useState<View | null>(null)
  const [anchorId, setAnchorId] = useState<string | null>(null)
  const [rootId, setRootId] = useState<string | null>(null)
  const [maxNodes, setMaxNodes] = useState(250)
  const [step, setStep] = useState(0.95)
  const [V, setV] = useState<Mobius>(IDENTITY)
  const [arcs, setArcs] = useState(true)
  const [crossLinks, setCrossLinks] = useState(true)
  const [reRoot, setReRoot] = useState(false)
  const [hoverId, setHoverId] = useState<string | null>(null)
  const [size, setSize] = useState(() => Math.min(window.innerWidth, window.innerHeight))

  const svgRef = useRef<SVGSVGElement | null>(null)
  const rafRef = useRef<number | null>(null)
  const drag = useRef<{ down: boolean; moved: boolean; last: Complex | null; downId: string | null }>({
    down: false,
    moved: false,
    last: null,
    downId: null,
  })

  // Geometry of the disk in SVG coordinates.
  const cx = size / 2
  const cy = size / 2
  const R = size * 0.47

  // Track the viewport so the disk fills the available square.
  useEffect(() => {
    const onResize = () => setSize(Math.min(window.innerWidth, window.innerHeight))
    window.addEventListener('resize', onResize)
    return () => window.removeEventListener('resize', onResize)
  }, [])

  // Load the bundle and land on its entry view (a bounded multi-hop ego-net).
  useEffect(() => {
    let cancelled = false
    ;(async () => {
      const bundle = await loadBundle()
      const source = new StaticBundleSource(bundle, DEFAULT_LEGEND)
      const v = await source.entry({ mode: 'node', maxNodes })
      if (cancelled) return
      setView(v)
      setAnchorId(v.anchorId)
      setRootId(v.anchorId)
      setV(IDENTITY)
    })()
    return () => {
      cancelled = true
    }
  }, [maxNodes])

  // The hyperbolic tree layout (root-centred disk coords). Recomputed only when
  // the view, the root (re-root navigation), or the spacing changes.
  const layout = useMemo(() => {
    if (!view || !rootId) return null
    return layoutHyperbolic(view, rootId, step)
  }, [view, rootId, step])

  // Cancel any running fly-to animation.
  const stopAnim = () => {
    if (rafRef.current != null) cancelAnimationFrame(rafRef.current)
    rafRef.current = null
  }
  useEffect(() => stopAnim, [])

  // Isometry pan: animate the Möbius slide that brings a node's CURRENT disk
  // position to the origin (the egocentric "travel" — no relayout, the whole
  // hyperbolic plane glides under a fixed tree). Classic hyperbolic-browser feel.
  const flyToCenter = useCallback(
    (id: string) => {
      if (!layout) return
      const p = layout.pos.get(id)
      if (!p) return
      stopAnim()
      const V0 = V
      const a = apply(V0, p) // where the node sits on screen right now
      if (cabs(a) < 1e-3) return // already centred
      const D = distFromOrigin(a)
      const u = { re: a.re / cabs(a), im: a.im / cabs(a) }
      const recA = recenter(a)
      const start = performance.now()
      const dur = 460
      const tick = (now: number) => {
        const t = Math.min(1, (now - start) / dur)
        const e = easeInOut(t)
        // Node should ride from radius D down to 0 along its ray u.
        const se = { re: u.re * radiusForDist((1 - e) * D), im: u.im * radiusForDist((1 - e) * D) }
        // W = move(0→se) ∘ move(a→0) ∘ V0  →  applies a→se for the focus node.
        setV(compose(compose(recenter(cneg(se)), recA), V0))
        if (t < 1) rafRef.current = requestAnimationFrame(tick)
        else rafRef.current = null
      }
      rafRef.current = requestAnimationFrame(tick)
    },
    [layout, V],
  )

  // Travel: re-root (re-run the layout with this node as the tree root — a truer
  // egocentric expand) or isometry-pan, per the toggle.
  const travel = useCallback(
    (id: string) => {
      if (reRoot) {
        stopAnim()
        setRootId(id)
        setV(IDENTITY)
      } else {
        flyToCenter(id)
      }
    },
    [reRoot, flyToCenter],
  )

  // Convert a pointer event to a disk coordinate in the current screen frame.
  const eventToDisk = (clientX: number, clientY: number): Complex => {
    const rect = svgRef.current!.getBoundingClientRect()
    const sx = ((clientX - rect.left) / rect.width) * size
    const sy = ((clientY - rect.top) / rect.height) * size
    return C((sx - cx) / R, (sy - cy) / R)
  }

  const onPointerDown = (ev: React.PointerEvent) => {
    stopAnim()
    const el = ev.target as Element
    const nid = el.getAttribute?.('data-node') ?? null
    drag.current = { down: true, moved: false, last: eventToDisk(ev.clientX, ev.clientY), downId: nid }
    ;(ev.currentTarget as Element).setPointerCapture?.(ev.pointerId)
  }
  const onPointerMove = (ev: React.PointerEvent) => {
    const d = drag.current
    if (!d.down || !d.last) return
    const cur = eventToDisk(ev.clientX, ev.clientY)
    if (cabs2(cur) > 0.998) return // off the disk — ignore
    // Promote to a drag (vs. a click-to-travel) once the cursor actually moves.
    if (!d.moved && cabs({ re: cur.re - d.last.re, im: cur.im - d.last.im }) > 0.008) d.moved = true
    if (!d.moved) return
    // Grab-and-pan: the disk point under the cursor follows the cursor. Compose
    // the translation that maps last→cur onto the view isometry.
    const M = compose(recenter(cneg(cur)), recenter(d.last))
    setV((prev) => compose(M, prev))
    d.last = cur
  }
  const onPointerUp = (ev: React.PointerEvent) => {
    const d = drag.current
    if (d.down && !d.moved && d.downId) travel(d.downId) // a click on a node = travel there
    drag.current = { down: false, moved: false, last: null, downId: null }
    ;(ev.currentTarget as Element).releasePointerCapture?.(ev.pointerId)
  }

  const resetView = () => {
    stopAnim()
    if (anchorId) setRootId(anchorId)
    setV(IDENTITY)
  }

  // Project every node through the live isometry → screen disk coords + sizes.
  const placed = useMemo(() => {
    if (!view || !layout) return []
    const out: { node: GraphNode; z: Complex; sx: number; sy: number; rpx: number }[] = []
    for (const node of view.nodes) {
      const p = layout.pos.get(node.id)
      if (!p) continue
      const z = apply(V, p)
      const m2 = cabs2(z)
      if (m2 > 0.9999) continue
      const s = toScreen(z, cx, cy, R)
      // Escher shrink: dots fade toward the rim by (1−|z|²).
      const rpx = Math.max(1.3, (2 + 10 * (1 - m2)) * (node.type === 'work' ? 1 : 0.82))
      out.push({ node, z, sx: s.x, sy: s.y, rpx })
    }
    // Rim first, centre last → focus nodes paint on top.
    out.sort((p, q) => cabs2(q.z) - cabs2(p.z))
    return out
  }, [view, layout, V, cx, cy, R])

  const screenById = useMemo(() => {
    const m = new Map<string, Complex>()
    for (const p of placed) m.set(p.node.id, p.z)
    return m
  }, [placed])

  // Edge paths: tree links solid, non-tree "cross-links" faint. Drawn as geodesic
  // arcs (the Poincaré signature) or straight chords per the toggle.
  const edgePaths = useMemo(() => {
    if (!view || !layout) return { tree: [] as string[], cross: [] as string[] }
    const tree: string[] = []
    const cross: string[] = []
    for (const e of view.edges) {
      const z1 = screenById.get(e.source)
      const z2 = screenById.get(e.target)
      if (!z1 || !z2) continue
      const isTree = layout.treeEdgeIds.has(e.id)
      if (!isTree && !crossLinks) continue
      const d = arcs ? geodesicPath(z1, z2, cx, cy, R) : `M ${toScreen(z1, cx, cy, R).x} ${toScreen(z1, cx, cy, R).y} L ${toScreen(z2, cx, cy, R).x} ${toScreen(z2, cx, cy, R).y}`
      ;(isTree ? tree : cross).push(d)
    }
    return { tree, cross }
  }, [view, layout, screenById, arcs, crossLinks, cx, cy, R])

  const centerNode = useMemo(() => {
    // Whatever sits nearest the origin is the egocentric "you are here".
    let best: GraphNode | null = null
    let bestD = Infinity
    for (const p of placed) {
      const m = cabs2(p.z)
      if (m < bestD) {
        bestD = m
        best = p.node
      }
    }
    return best
  }, [placed])

  if (!view || !layout) {
    return (
      <Box sx={{ position: 'fixed', inset: 0, bgcolor: '#02030a', display: 'grid', placeItems: 'center' }}>
        <Typography sx={{ color: '#7fd4ff', font: '11px ui-monospace, monospace', letterSpacing: 2 }}>
          CHARTING HYPERBOLIC PLANE…
        </Typography>
      </Box>
    )
  }

  return (
    <Box sx={{ position: 'fixed', inset: 0, bgcolor: '#02030a', display: 'grid', placeItems: 'center', overflow: 'hidden' }}>
      <svg
        ref={svgRef}
        width={size}
        height={size}
        style={{ touchAction: 'none', cursor: drag.current.moved ? 'grabbing' : 'grab', display: 'block' }}
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
        onPointerLeave={onPointerUp}
      >
        {/* The bounding circle = the circle at infinity. */}
        <circle cx={cx} cy={cy} r={R} fill="#04060f" stroke="rgba(127,212,255,0.35)" strokeWidth={1.25} />
        <circle cx={cx} cy={cy} r={R} fill="none" stroke="rgba(127,212,255,0.07)" strokeWidth={14} />

        {/* Cross-links (non-tree edges) under everything. */}
        {crossLinks &&
          edgePaths.cross.map((d, i) => (
            <path key={`x${i}`} d={d} fill="none" stroke="rgba(185,139,255,0.16)" strokeWidth={0.7} />
          ))}
        {/* Spanning-tree edges. */}
        {edgePaths.tree.map((d, i) => (
          <path key={`t${i}`} d={d} fill="none" stroke="rgba(127,212,255,0.4)" strokeWidth={0.9} />
        ))}

        {/* Nodes. */}
        {placed.map(({ node, sx, sy, rpx }) => {
          const isCenter = node.id === centerNode?.id
          const isHover = node.id === hoverId
          return (
            <circle
              key={node.id}
              data-node={node.id}
              cx={sx}
              cy={sy}
              r={isCenter ? rpx + 2 : rpx}
              fill={node.color}
              stroke={isCenter ? '#ffffff' : isHover ? 'rgba(255,255,255,0.8)' : 'rgba(0,0,0,0.45)'}
              strokeWidth={isCenter ? 2 : isHover ? 1.2 : 0.5}
              style={{ cursor: 'pointer' }}
              onPointerEnter={() => setHoverId(node.id)}
              onPointerLeave={() => setHoverId((h) => (h === node.id ? null : h))}
            />
          )
        })}

        {/* Labels for the focus neighbourhood (near the centre) + hover. */}
        {placed
          .filter((p) => cabs2(p.z) < 0.12 || p.node.id === hoverId)
          .slice(0, 28)
          .map(({ node, sx, sy, rpx }) => (
            <text
              key={`l${node.id}`}
              x={sx + rpx + 3}
              y={sy + 3}
              fill="rgba(220,240,255,0.92)"
              style={{ font: '10px ui-monospace, Menlo, monospace', pointerEvents: 'none' }}
            >
              {node.name.length > 42 ? node.name.slice(0, 40) + '…' : node.name}
            </text>
          ))}
      </svg>

      {/* Controls. */}
      <Box sx={{ position: 'absolute', top: 16, left: 16, ...PANEL_SX, width: 244 }}>
        <Typography sx={{ font: '12px ui-monospace, monospace', letterSpacing: 1.5, color: '#7fd4ff', mb: 0.5 }}>
          ⬡ HYPERBOLIC POC
        </Typography>
        <Typography sx={{ color: 'rgba(191,230,255,0.6)', mb: 1.25 }}>
          Poincaré disk · drag to pan · click a node to travel it to the centre.
        </Typography>

        <Toggle label="Geodesic arcs" checked={arcs} onChange={setArcs} />
        <Toggle label="Cross-links" checked={crossLinks} onChange={setCrossLinks} />
        <Toggle label="Re-root on travel" checked={reRoot} onChange={setReRoot} />

        <Typography sx={{ mt: 1, mb: 0.25, color: 'rgba(191,230,255,0.7)' }}>SPACING · {step.toFixed(2)}</Typography>
        <Slider
          size="small"
          min={0.6}
          max={1.7}
          step={0.05}
          value={step}
          onChange={(_, v) => setStep(v as number)}
          sx={{ color: '#7fd4ff', py: 0.5 }}
        />

        <Typography sx={{ mt: 0.5, mb: 0.5, color: 'rgba(191,230,255,0.7)' }}>DENSITY (nodes)</Typography>
        <Stack direction="row" spacing={0.75}>
          {[120, 250, 400].map((n) => (
            <Button
              key={n}
              size="small"
              variant={maxNodes === n ? 'contained' : 'outlined'}
              onClick={() => setMaxNodes(n)}
              sx={{ minWidth: 0, flex: 1, py: 0.25, font: '10px ui-monospace, monospace' }}
            >
              {n}
            </Button>
          ))}
        </Stack>

        <Button
          fullWidth
          size="small"
          variant="outlined"
          onClick={resetView}
          sx={{ mt: 1.25, py: 0.4, font: '10px ui-monospace, monospace', letterSpacing: 1 }}
        >
          RESET TO SEED
        </Button>
      </Box>

      {/* Focus readout. */}
      {centerNode && (
        <Box sx={{ position: 'absolute', bottom: 16, left: 16, ...PANEL_SX, maxWidth: 360 }}>
          <Typography sx={{ color: '#7fd4ff', letterSpacing: 1 }}>● FOCUS · {centerNode.type}</Typography>
          <Typography sx={{ color: '#eaf4ff', font: '12px ui-monospace, monospace', mt: 0.25 }}>
            {centerNode.name}
          </Typography>
          <Typography sx={{ color: 'rgba(191,230,255,0.55)', mt: 0.5 }}>
            {view.nodes.length} nodes in view · {view.edges.length} links · root “{view.nodeById.get(rootId!)?.name.slice(0, 28)}”
          </Typography>
        </Box>
      )}
    </Box>
  )
}

function Toggle({ label, checked, onChange }: { label: string; checked: boolean; onChange: (v: boolean) => void }) {
  return (
    <Stack direction="row" alignItems="center" justifyContent="space-between" sx={{ my: 0.1 }}>
      <Typography sx={{ color: 'rgba(191,230,255,0.85)', font: '11px ui-monospace, monospace' }}>{label}</Typography>
      <Switch size="small" checked={checked} onChange={(e) => onChange(e.target.checked)} />
    </Stack>
  )
}
