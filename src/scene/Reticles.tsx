import { Billboard, Html } from '@react-three/drei'
import * as THREE from 'three'
import type { Graph, GraphNode } from '../types'
import { NODE_RADIUS } from './Nodes'

// Targeting reticles are instrumentation drawn by the ship's window, so they
// use the HUD's color regardless of what they're pointing at.
const HUD = '#7fd4ff'
const HUD_TEXT = '#aadfff'

interface ReticleProps {
  node: GraphNode
  emphasized: boolean
  onSelect: (id: string) => void
}

function Reticle({ node, emphasized, onSelect }: ReticleProps) {
  const r = NODE_RADIUS[node.type] * 1.7
  return (
    <group position={[node.x!, node.y!, node.z!]}>
      {/* Ring scales with the world (it brackets the node); depthTest off —
          a HUD paints over scene geometry. */}
      <Billboard>
        <mesh raycast={() => null} scale={r} renderOrder={999}>
          <ringGeometry args={[0.9, 1, 48]} />
          <meshBasicMaterial
            color={HUD}
            transparent
            opacity={emphasized ? 0.95 : 0.5}
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
      {/* Leader line + name bubble keep constant screen size, like a real HUD tag. */}
      <Html center zIndexRange={[40, 0]} style={{ pointerEvents: 'none' }}>
        <div style={{ position: 'relative' }}>
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
