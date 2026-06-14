import { useEffect, useMemo, useRef } from 'react'
import { useFrame } from '@react-three/fiber'
import { Billboard, Html } from '@react-three/drei'
import * as THREE from 'three'
import type { Graph, GraphNode } from '../types'
import { NODE_RADIUS } from './Nodes'
import { screenEdgeFactor, screenPoint } from './screenFade'
import { reticleVisibility } from './shipBus'

// Targeting reticles are instrumentation drawn by the ship's window, so they
// use the HUD's color regardless of what they're pointing at.
const HUD = '#7fd4ff'
const HUD_TEXT = '#aadfff'

// Declutter: per-frame target alpha for each tag's name bubble. When two
// bubbles would collide, the closer node keeps its label (selected always
// wins) and the other fades; rings are never decluttered.
const labelTarget = new Map<string, number>()

interface Rect {
  x1: number
  y1: number
  x2: number
  y2: number
}

// Estimated on-screen bubble rect: offset (34, -46) from the node's
// projection; 11px mono + 1.2 letter-spacing ≈ 7.8px per character.
function labelRect(name: string, x: number, y: number): Rect {
  const w = 24 + name.length * 7.8
  return { x1: x + 34, y1: y - 46, x2: x + 34 + w, y2: y - 22 }
}

function intersects(a: Rect, b: Rect) {
  return a.x1 < b.x2 && b.x1 < a.x2 && a.y1 < b.y2 && b.y1 < a.y2
}

interface DeclutterProps {
  graph: Graph
  taggedIds: string[]
  selectedId: string | null
}

function Declutter({ graph, taggedIds, selectedId }: DeclutterProps) {
  const pos = useMemo(() => new THREE.Vector3(), [])

  useFrame(({ camera, size }) => {
    const items: Array<{ id: string; name: string; dist: number; x: number; y: number }> = []
    for (const id of taggedIds) {
      const node = graph.nodeById.get(id)
      if (!node) continue
      pos.set(node.x!, node.y!, node.z!)
      const sp = screenPoint(pos, camera, size)
      if (sp.factor <= 0.01) {
        // Off the glass — the edge fade owns it; don't let it claim space.
        labelTarget.set(id, 1)
        continue
      }
      items.push({ id, name: node.name, dist: camera.position.distanceTo(pos), x: sp.x, y: sp.y })
    }
    items.sort((a, b) =>
      a.id === selectedId ? -1 : b.id === selectedId ? 1 : a.dist - b.dist,
    )
    const accepted: Rect[] = []
    for (const it of items) {
      const r = labelRect(it.name, it.x, it.y)
      if (accepted.some((o) => intersects(o, r))) {
        labelTarget.set(it.id, 0)
      } else {
        accepted.push(r)
        labelTarget.set(it.id, 1)
      }
    }
  })

  return null
}

interface ReticleProps {
  node: GraphNode
  emphasized: boolean
  onSelect: (id: string) => void
}

function Reticle({ node, emphasized, onSelect }: ReticleProps) {
  const r = NODE_RADIUS[node.type] * 1.7
  const ringsRef = useRef<THREE.Group>(null)
  const ringMat = useRef<THREE.MeshBasicMaterial>(null)
  const outerRingMat = useRef<THREE.MeshBasicMaterial>(null)
  const htmlRef = useRef<HTMLDivElement>(null)
  const tagRef = useRef<HTMLDivElement>(null)
  const baseOpacity = emphasized ? 0.95 : 0.5
  // Lock-on flash: 1 at the moment a tag (re)enters the glass, decaying to 0.
  const flash = useRef(0)
  const prevFactor = useRef(0)
  const hudColor = useMemo(() => new THREE.Color(HUD), [])
  const flashColor = useMemo(() => new THREE.Color('#ffffff'), [])

  const labelAlpha = useRef(1)

  useEffect(() => {
    return () => {
      reticleVisibility.delete(node.id)
      labelTarget.delete(node.id)
    }
  }, [node.id])
  // Re-fire the acquisition flash when this reticle becomes the selected one,
  // so selecting a node gets the same lock-on pop as one entering the glass.
  useEffect(() => {
    if (emphasized) flash.current = 1
  }, [emphasized])
  const pos = useMemo(() => new THREE.Vector3(node.x!, node.y!, node.z!), [node])

  useFrame(({ camera, size }, delta) => {
    const factor = screenEdgeFactor(pos, camera, size)
    reticleVisibility.set(node.id, factor)

    // Acquisition flash on the hidden -> shown transition: the ring starts
    // oversized, white-hot, and over-bright, then contracts onto the target
    // while the label pops with a glow.
    if (factor > 0.01 && prevFactor.current <= 0.01) flash.current = 1
    else flash.current = Math.max(0, flash.current - delta / 0.6)
    prevFactor.current = factor
    const f = flash.current

    if (ringsRef.current) {
      ringsRef.current.visible = factor > 0.01
      ringsRef.current.scale.setScalar(1 + 0.8 * f)
    }
    if (ringMat.current) {
      ringMat.current.opacity = Math.min(1, baseOpacity * factor * (1 + 3 * f))
      ringMat.current.color.copy(hudColor).lerp(flashColor, f)
    }
    if (outerRingMat.current) {
      outerRingMat.current.opacity = Math.min(1, 0.35 * factor * (1 + 3 * f))
      outerRingMat.current.color.copy(hudColor).lerp(flashColor, f)
    }
    if (htmlRef.current) {
      // Ease toward the declutter verdict so labels swap without popping.
      const target = labelTarget.get(node.id) ?? 1
      labelAlpha.current += (target - labelAlpha.current) * Math.min(1, delta * 12)
      const labelOpacity = factor * labelAlpha.current
      htmlRef.current.style.opacity = String(labelOpacity)
      htmlRef.current.style.filter = f > 0.01 ? `brightness(${1 + 2.5 * f})` : ''
      // visibility (not display) so layout is stable; also kills clicks while hidden
      htmlRef.current.style.visibility = labelOpacity > 0.02 ? 'visible' : 'hidden'
    }
    if (tagRef.current) {
      tagRef.current.style.transform = f > 0.01 ? `scale(${1 + 0.35 * f})` : ''
      tagRef.current.style.boxShadow =
        f > 0.01 ? `0 0 ${16 * f}px rgba(127, 212, 255, ${0.9 * f})` : ''
    }
  })

  return (
    <group position={[node.x!, node.y!, node.z!]}>
      {/* Ring scales with the world (it brackets the node); depthTest off —
          a HUD paints over scene geometry. */}
      <group ref={ringsRef}>
        <Billboard>
        <mesh raycast={() => null} scale={r} renderOrder={999}>
          <ringGeometry args={[0.9, 1, 48]} />
          <meshBasicMaterial
            ref={ringMat}
            color={HUD}
            transparent
            opacity={baseOpacity}
            blending={THREE.AdditiveBlending}
            depthWrite={false}
            depthTest={false}
            side={THREE.DoubleSide}
          />
        </mesh>
        {emphasized && (
          <mesh raycast={() => null} scale={r * 1.3} renderOrder={999}>
            <ringGeometry args={[0.95, 1, 48]} />
            <meshBasicMaterial
              ref={outerRingMat}
              color={HUD}
              transparent
              opacity={0.35}
              blending={THREE.AdditiveBlending}
              depthWrite={false}
              depthTest={false}
              side={THREE.DoubleSide}
            />
          </mesh>
        )}
        </Billboard>
      </group>
      {/* Leader line + name bubble keep constant screen size, like a real HUD tag. */}
      <Html center zIndexRange={[40, 0]} style={{ pointerEvents: 'none' }}>
        <div ref={htmlRef} style={{ position: 'relative' }}>
          <svg width="30" height="26" style={{ position: 'absolute', left: 6, top: -28, overflow: 'visible' }}>
            <line x1="2" y1="24" x2="28" y2="2" stroke={HUD} strokeOpacity={0.55} strokeWidth={1} />
          </svg>
          <div
            data-testid="node-tag"
            ref={tagRef}
            onClick={(e) => {
              // Don't let the click bubble to the canvas — R3F's
              // onPointerMissed would immediately clear the selection.
              e.stopPropagation()
              onSelect(node.id)
            }}
            style={{
              position: 'absolute',
              left: 34,
              top: -46,
              transformOrigin: 'left center',
              pointerEvents: 'auto',
              cursor: 'pointer',
              whiteSpace: 'nowrap',
              font: '11px/1.7 ui-monospace, SFMono-Regular, Menlo, monospace',
              letterSpacing: 1.2,
              textTransform: 'uppercase',
              color: HUD_TEXT,
              background: 'rgba(4, 14, 28, 0.72)',
              border: '1px solid rgba(127, 212, 255, 0.45)',
              borderRadius: 999,
              padding: '1px 10px',
              backdropFilter: 'blur(2px)',
            }}
          >
            {node.name}
          </div>
        </div>
      </Html>
    </group>
  )
}

interface ReticlesProps {
  graph: Graph
  taggedIds: string[]
  selectedId: string | null
  onSelect: (id: string) => void
}

export function Reticles({ graph, taggedIds, selectedId, onSelect }: ReticlesProps) {
  return (
    <>
      <Declutter graph={graph} taggedIds={taggedIds} selectedId={selectedId} />
      {taggedIds.map((id) => (
        <Reticle
          key={id}
          node={graph.nodeById.get(id)!}
          emphasized={id === selectedId}
          onSelect={onSelect}
        />
      ))}
    </>
  )
}
