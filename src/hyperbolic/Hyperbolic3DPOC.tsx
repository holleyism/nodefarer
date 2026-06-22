import { useEffect, useMemo, useRef, useState } from 'react'
import { Box, Button, Slider, Stack, Switch, Typography } from '@mui/material'
import { Canvas, useFrame, useThree } from '@react-three/fiber'
import { Html, OrbitControls } from '@react-three/drei'
import * as THREE from 'three'
import { StaticBundleSource } from '../data/StaticBundleSource'
import { DEFAULT_LEGEND } from '../data/viewBuilder'
import { syntheticBundle } from '../data/generateGraph'
import type { Bundle } from '../data/bundle'
import type { View } from '../data/GraphSource'
import type { GraphNode } from '../types'
import { layoutBall, type BallLayout } from './ballLayout'
import {
  type V3,
  geodesicSamples,
  gyroScale,
  madd,
  vlen,
  vlen2,
  vneg,
} from './ball'

// ─────────────────────────────────────────────────────────────────────────────
// Hyperbolic3DPOC — the Poincaré-BALL (H3) sibling of the disk POC, mounted
// behind `?poc=hyperbolic3d` (memory hyperbolic-poc-plan). Same recipe, one
// dimension up: reuse StaticBundleSource for a bounded View, lay it out as an
// H3 cone-tree in the ball, render in R3F. Travel = the Möbius slide that brings
// a node to the centre of the ball (the egocentric "you are here"), animated via
// gyrovector translation. Fully isolated from GraphScene. The A/B question vs.
// the 2D disk: does the added ROOM beat the added OCCLUSION?
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
const cloneMap = (m: Map<string, V3>) => new Map([...m].map(([k, v]) => [k, { ...v }]))
const DUMMY = new THREE.Object3D()

// ── The scene (everything R3F). Remounts on any structural change via `key`, so
// counts/buffers are constant within a mount; only positions move (travel anim).
function BallScene({
  view,
  layout,
  arcs,
  crossLinks,
  reRoot,
  egocentric,
  onReRoot,
  onFocus,
}: {
  view: View
  layout: BallLayout
  arcs: boolean
  crossLinks: boolean
  reRoot: boolean
  egocentric: boolean
  onReRoot: (id: string) => void
  onFocus: (n: GraphNode | null) => void
}) {
  const nodes = view.nodes
  const SAMPLES = arcs ? 10 : 1
  const focusIdRef = useRef<string | null>(null)

  // Live positions (the rendered truth; travel mutates these in place).
  const liveRef = useRef<Map<string, V3> | null>(null)
  if (!liveRef.current) liveRef.current = cloneMap(layout.pos)
  const live = liveRef.current

  // Stable per-instance metadata.
  const idForInstance = useMemo(() => nodes.map((n) => n.id), [nodes])

  // Egocentric (inside-out) camera: the eye sits just behind the focus at the
  // ball centre and looks OUTWARD; drag turns the gaze, wheel dollies from the
  // centre out toward the exocentric overview. yaw/pitch/dolly live in refs so
  // the look loop never triggers React renders.
  const { gl, camera } = useThree()
  const yaw = useRef(0)
  const pitch = useRef(0)
  const dolly = useRef(0.25)
  const lookMoved = useRef(false)
  useEffect(() => {
    if (!egocentric) return
    yaw.current = 0
    pitch.current = 0
    dolly.current = 0.25
    const el = gl.domElement
    let down = false
    let lx = 0
    let ly = 0
    const onDown = (e: PointerEvent) => {
      down = true
      lookMoved.current = false
      lx = e.clientX
      ly = e.clientY
    }
    const onMove = (e: PointerEvent) => {
      if (!down) return
      const dx = e.clientX - lx
      const dy = e.clientY - ly
      lx = e.clientX
      ly = e.clientY
      if (Math.abs(dx) + Math.abs(dy) > 3) lookMoved.current = true
      yaw.current -= dx * 0.005
      pitch.current = Math.max(-1.4, Math.min(1.4, pitch.current - dy * 0.005))
    }
    const onUp = () => {
      down = false
    }
    const onWheel = (e: WheelEvent) => {
      e.preventDefault()
      dolly.current = Math.max(0.08, Math.min(3, dolly.current + e.deltaY * 0.0015))
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
  }, [egocentric, gl])
  useFrame(() => {
    if (!egocentric) return
    const cp = Math.cos(pitch.current)
    const fwd = { x: cp * Math.sin(yaw.current), y: Math.sin(pitch.current), z: cp * Math.cos(yaw.current) }
    const d = dolly.current
    camera.position.set(-fwd.x * d, -fwd.y * d, -fwd.z * d)
    camera.up.set(0, 1, 0)
    camera.lookAt(0, 0, 0) // the focus point is always dead ahead
  })
  // Restore an exocentric pose when leaving egocentric mode so OrbitControls
  // doesn't inherit the eye sitting inside the ball.
  useEffect(() => {
    if (!egocentric) {
      camera.position.set(0, 0, 2.8)
      camera.up.set(0, 1, 0)
      camera.lookAt(0, 0, 0)
    }
  }, [egocentric, camera])

  // Tree vs cross edges (constant within a mount).
  const { treeEdges, crossEdges } = useMemo(() => {
    const tree: [string, string][] = []
    const cross: [string, string][] = []
    for (const e of view.edges) {
      if (!live.has(e.source) || !live.has(e.target)) continue
      if (layout.treeEdgeIds.has(e.id)) tree.push([e.source, e.target])
      else if (crossLinks) cross.push([e.source, e.target])
    }
    return { treeEdges: tree, crossEdges: cross }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [view, layout, crossLinks])

  // Geometry + materials built once per mount.
  const treeGeo = useMemo(() => makeLineGeo(treeEdges.length * SAMPLES), [treeEdges.length, SAMPLES])
  const crossGeo = useMemo(() => makeLineGeo(crossEdges.length * SAMPLES), [crossEdges.length, SAMPLES])
  const treeMat = useMemo(() => new THREE.LineBasicMaterial({ color: '#7fd4ff', transparent: true, opacity: 0.45 }), [])
  const crossMat = useMemo(() => new THREE.LineBasicMaterial({ color: '#b98bff', transparent: true, opacity: 0.18 }), [])

  const meshRef = useRef<THREE.InstancedMesh>(null)

  // Travel animation state (t0 captured on the first animated frame).
  const anim = useRef<{ active: boolean; start: Map<string, V3>; a0: V3; t0: number | null } | null>(null)

  // Paint instance colours once.
  useEffect(() => {
    const m = meshRef.current
    if (!m) return
    const c = new THREE.Color()
    nodes.forEach((n, i) => m.setColorAt(i, c.set(n.color)))
    if (m.instanceColor) m.instanceColor.needsUpdate = true
  }, [nodes])

  // Push the current `live` positions into the instance matrices + edge buffers.
  const sync = () => {
    const m = meshRef.current
    if (m) {
      nodes.forEach((n, i) => {
        const p = live.get(n.id)!
        const shrink = 1 - vlen2(p) // Escher: focus big, rim tiny
        // Gentler near-enlargement in egocentric mode — a wall of huge neighbours
        // around the eye is the worst occluder; perspective already cues depth.
        const grow = egocentric ? 0.028 : 0.05
        let s = (0.014 + grow * Math.max(0, shrink)) * (n.type === 'work' ? 1 : 0.82)
        // Egocentric: the focus IS the eye — don't draw a blob over the camera.
        if (egocentric && n.id === focusIdRef.current) s = 0
        DUMMY.position.set(p.x, p.y, p.z)
        DUMMY.scale.setScalar(s)
        DUMMY.updateMatrix()
        m.setMatrixAt(i, DUMMY.matrix)
      })
      m.instanceMatrix.needsUpdate = true
    }
    writeEdges(treeGeo, treeEdges, live, SAMPLES)
    if (crossEdges.length) writeEdges(crossGeo, crossEdges, live, SAMPLES)
  }

  const reportFocus = () => {
    let best: GraphNode | null = null
    let bd = Infinity
    for (const n of nodes) {
      const d = vlen2(live.get(n.id)!)
      if (d < bd) {
        bd = d
        best = n
      }
    }
    focusIdRef.current = best?.id ?? null
    onFocus(best)
    setLabels(nearestLabels(nodes, live, 12))
  }

  // Labels for the focus neighbourhood (nearest the centre); hidden mid-travel.
  const [labels, setLabels] = useState<{ id: string; name: string; p: V3 }[]>([])

  useEffect(() => {
    sync()
    reportFocus()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [layout])

  useFrame(({ clock }) => {
    const a = anim.current
    if (!a?.active) return
    if (a.t0 == null) a.t0 = clock.getElapsedTime() // anchor to the first frame
    const e = Math.min(1, (clock.getElapsedTime() - a.t0) / 0.52)
    const tvec = gyroScale(easeInOut(e), vneg(a.a0)) // partial recenter toward origin
    for (const n of nodes) live.set(n.id, madd(tvec, a.start.get(n.id)!))
    sync()
    if (e >= 1) {
      a.active = false
      reportFocus()
    }
  })

  const handleClick = (e: any) => {
    e.stopPropagation()
    if (lookMoved.current) return // this was a look-around drag, not a click
    const id = idForInstance[e.instanceId]
    if (id == null) return
    if (reRoot) {
      onReRoot(id)
      return
    }
    const a0 = live.get(id)
    if (!a0 || vlen(a0) < 2e-3) return // already centred
    anim.current = { active: true, start: cloneMap(live), a0: { ...a0 }, t0: null }
    setLabels([]) // hidden during the slide
  }

  return (
    <>
      {!egocentric && <OrbitControls enablePan={false} minDistance={1.45} maxDistance={6} rotateSpeed={0.6} />}
      {/* The sphere at infinity. */}
      <mesh>
        <sphereGeometry args={[1, 48, 32]} />
        <meshBasicMaterial color="#7fd4ff" wireframe transparent opacity={0.06} />
      </mesh>
      <lineSegments geometry={crossGeo} material={crossMat} />
      <lineSegments geometry={treeGeo} material={treeMat} />
      <instancedMesh
        ref={meshRef}
        args={[undefined, undefined, nodes.length]}
        onClick={handleClick}
        onPointerOver={(e) => {
          e.stopPropagation()
          document.body.style.cursor = 'pointer'
        }}
        onPointerOut={() => {
          document.body.style.cursor = 'auto'
        }}
      >
        <sphereGeometry args={[1, 12, 12]} />
        {/* See-through dots + no depth-write so a near shell of neighbours doesn't
            wall off the periphery — the 3D point-cloud occlusion mitigation. */}
        <meshBasicMaterial toneMapped={false} transparent opacity={0.6} depthWrite={false} />
      </instancedMesh>
      {labels.map((l) => (
        <Html key={l.id} position={[l.p.x, l.p.y, l.p.z]} center style={{ pointerEvents: 'none' }} zIndexRange={[10, 0]}>
          <div
            style={{
              transform: 'translateY(-14px)',
              whiteSpace: 'nowrap',
              font: '9px ui-monospace, Menlo, monospace',
              color: 'rgba(220,240,255,0.92)',
              textShadow: '0 0 4px #02030a, 0 0 4px #02030a',
            }}
          >
            {l.name.length > 36 ? l.name.slice(0, 34) + '…' : l.name}
          </div>
        </Html>
      ))}
    </>
  )
}

function makeLineGeo(segments: number): THREE.BufferGeometry {
  const g = new THREE.BufferGeometry()
  g.setAttribute('position', new THREE.BufferAttribute(new Float32Array(Math.max(1, segments) * 2 * 3), 3))
  return g
}

// Fill a line-segments geometry: each edge → `samples` geodesic segments.
function writeEdges(geo: THREE.BufferGeometry, edges: [string, string][], live: Map<string, V3>, samples: number) {
  const arr = geo.attributes.position.array as Float32Array
  let o = 0
  for (const [s, t] of edges) {
    const a = live.get(s)!
    const b = live.get(t)!
    const pts = samples > 1 ? geodesicSamples(a, b, samples) : [a, b]
    for (let i = 0; i < samples; i++) {
      const p0 = pts[i]
      const p1 = pts[i + 1] ?? b
      arr[o++] = p0.x
      arr[o++] = p0.y
      arr[o++] = p0.z
      arr[o++] = p1.x
      arr[o++] = p1.y
      arr[o++] = p1.z
    }
  }
  geo.attributes.position.needsUpdate = true
  geo.computeBoundingSphere()
}

function nearestLabels(nodes: GraphNode[], live: Map<string, V3>, k: number) {
  return [...nodes]
    .map((n) => ({ id: n.id, name: n.name, p: live.get(n.id)!, d: vlen2(live.get(n.id)!) }))
    .sort((a, b) => a.d - b.d)
    .slice(0, k)
    .map(({ id, name, p }) => ({ id, name, p }))
}

export default function Hyperbolic3DPOC() {
  const [view, setView] = useState<View | null>(null)
  const [anchorId, setAnchorId] = useState<string | null>(null)
  const [rootId, setRootId] = useState<string | null>(null)
  const [maxNodes, setMaxNodes] = useState(250)
  const [step, setStep] = useState(1.1)
  const [coneHalf, setConeHalf] = useState(1.05) // radians (~60°)
  const [arcs, setArcs] = useState(true)
  const [crossLinks, setCrossLinks] = useState(true)
  const [reRoot, setReRoot] = useState(false)
  const [egocentric, setEgocentric] = useState(false)
  const [focus, setFocus] = useState<GraphNode | null>(null)

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
    })()
    return () => {
      cancelled = true
    }
  }, [maxNodes])

  const layout = useMemo(() => {
    if (!view || !rootId) return null
    return layoutBall(view, rootId, step, coneHalf)
  }, [view, rootId, step, coneHalf])

  if (!view || !layout || !rootId) {
    return (
      <Box sx={{ position: 'fixed', inset: 0, bgcolor: '#02030a', display: 'grid', placeItems: 'center' }}>
        <Typography sx={{ color: '#7fd4ff', font: '11px ui-monospace, monospace', letterSpacing: 2 }}>
          CHARTING HYPERBOLIC BALL…
        </Typography>
      </Box>
    )
  }

  // Remount the scene on structural change; isometry travel stays internal.
  const sceneKey = `${maxNodes}:${rootId}:${step.toFixed(2)}:${coneHalf.toFixed(2)}:${arcs}:${crossLinks}`

  return (
    <Box sx={{ position: 'fixed', inset: 0, bgcolor: '#02030a' }}>
      <Canvas flat camera={{ position: [0, 0, 2.8], fov: 50, near: 0.01, far: 100 }}>
        <color attach="background" args={['#02030a']} />
        <BallScene
          key={sceneKey}
          view={view}
          layout={layout}
          arcs={arcs}
          crossLinks={crossLinks}
          reRoot={reRoot}
          egocentric={egocentric}
          onReRoot={(id) => setRootId(id)}
          onFocus={setFocus}
        />
      </Canvas>

      {/* Controls. */}
      <Box sx={{ position: 'absolute', top: 16, left: 16, ...PANEL_SX, width: 248 }}>
        <Typography sx={{ font: '12px ui-monospace, monospace', letterSpacing: 1.5, color: '#7fd4ff', mb: 0.5 }}>
          ⬡ HYPERBOLIC POC · 3D BALL
        </Typography>
        <Typography sx={{ color: 'rgba(191,230,255,0.6)', mb: 1.25 }}>
          {egocentric
            ? 'Egocentric: eye at the centre, looking OUT · drag to turn · scroll to dolly out · click a node to travel.'
            : 'Exocentric: orbiting the ball · drag to orbit · scroll to zoom · click a node to travel it to the centre.'}
        </Typography>

        <Toggle label="Egocentric (look out from centre)" checked={egocentric} onChange={setEgocentric} />
        <Toggle label="Geodesic arcs" checked={arcs} onChange={setArcs} />
        <Toggle label="Cross-links" checked={crossLinks} onChange={setCrossLinks} />
        <Toggle label="Re-root on travel" checked={reRoot} onChange={setReRoot} />

        <Typography sx={{ mt: 1, mb: 0.25, color: 'rgba(191,230,255,0.7)' }}>SPACING · {step.toFixed(2)}</Typography>
        <Slider size="small" min={0.7} max={1.8} step={0.05} value={step} onChange={(_, v) => setStep(v as number)} sx={{ color: '#7fd4ff', py: 0.5 }} />

        <Typography sx={{ mb: 0.25, color: 'rgba(191,230,255,0.7)' }}>CONE · {Math.round((coneHalf * 180) / Math.PI)}°</Typography>
        <Slider size="small" min={0.5} max={1.4} step={0.05} value={coneHalf} onChange={(_, v) => setConeHalf(v as number)} sx={{ color: '#7fd4ff', py: 0.5 }} />

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
          onClick={() => anchorId && setRootId(anchorId)}
          sx={{ mt: 1.25, py: 0.4, font: '10px ui-monospace, monospace', letterSpacing: 1 }}
        >
          RESET TO SEED
        </Button>
      </Box>

      {focus && (
        <Box sx={{ position: 'absolute', bottom: 16, left: 16, ...PANEL_SX, maxWidth: 360 }}>
          <Typography sx={{ color: '#7fd4ff', letterSpacing: 1 }}>● FOCUS · {focus.type}</Typography>
          <Typography sx={{ color: '#eaf4ff', font: '12px ui-monospace, monospace', mt: 0.25 }}>{focus.name}</Typography>
          <Typography sx={{ color: 'rgba(191,230,255,0.55)', mt: 0.5 }}>
            {view.nodes.length} nodes · {view.edges.length} links · root “{view.nodeById.get(rootId)?.name.slice(0, 26)}”
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
