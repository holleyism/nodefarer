import { useMemo, useRef } from 'react'
import { useFrame } from '@react-three/fiber'
import { Billboard, Html } from '@react-three/drei'
import * as THREE from 'three'
import type { Graph, GraphNode } from '../types'
import { NODE_RADIUS } from './Nodes'

// Targeting reticles are instrumentation drawn by the ship's window, so they
// use the HUD's color regardless of what they're pointing at.
const HUD = '#7fd4ff'
const HUD_TEXT = '#aadfff'

// Instrumentation can't paint beyond the glass: reticles fade out as their
// node approaches the viewport border (gone at FADE_GONE px, full at
// FADE_FULL px) and come back when it returns. A fade band instead of a
// hard toggle avoids flicker when a node hovers at the threshold.
const FADE_GONE = 100
const FADE_FULL = 140

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
  const baseOpacity = emphasized ? 0.95 : 0.5
  const pos = useMemo(() => new THREE.Vector3(node.x!, node.y!, node.z!), [node])
  const projected = useMemo(() => new THREE.Vector3(), [])
  const toNode = useMemo(() => new THREE.Vector3(), [])
  const forward = useMemo(() => new THREE.Vector3(), [])

  useFrame(({ camera, size }) => {
    camera.getWorldDirection(forward)
    const behind = forward.dot(toNode.copy(pos).sub(camera.position)) < 0
    let factor = 0
    if (!behind) {
      projected.copy(pos).project(camera)
      const px = (projected.x * 0.5 + 0.5) * size.width
      const py = (-projected.y * 0.5 + 0.5) * size.height
      const edge = Math.min(px, size.width - px, py, size.height - py)
      const t = THREE.MathUtils.clamp((edge - FADE_GONE) / (FADE_FULL - FADE_GONE), 0, 1)
      factor = t * t * (3 - 2 * t)
    }
    if (ringsRef.current) ringsRef.current.visible = factor > 0.01
    if (ringMat.current) ringMat.current.opacity = baseOpacity * factor
    if (outerRingMat.current) outerRingMat.current.opacity = 0.35 * factor
    if (htmlRef.current) {
      htmlRef.current.style.opacity = String(factor)
      // visibility (not display) so layout is stable; also kills clicks while hidden
      htmlRef.current.style.visibility = factor > 0.01 ? 'visible' : 'hidden'
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
