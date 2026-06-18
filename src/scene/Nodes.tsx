import { memo, useMemo } from 'react'
import * as THREE from 'three'
import type { ThreeEvent } from '@react-three/fiber'
import type { Graph, GraphNode, NodeType } from '../types'
import { glowTexture } from './glow'

export const NODE_RADIUS: Record<NodeType, number> = {
  work: 2.0,
  concept: 1.6,
  venue: 1.5,
  institution: 1.4,
  author: 1.2,
}

interface NodeMeshProps {
  node: GraphNode
  // Position is passed as primitives (not read from the node instance) so memo's
  // shallow compare actually re-renders when the layout MUTATES x/y/z in place on
  // the same cached instance — otherwise nodes paint at stale positions after a
  // dynamic relayout (expand / search-land) while the camera uses live positions.
  x: number
  y: number
  z: number
  // Passed as a prop (not read off the node instance) for the same reason as
  // position: if a node is ever recoloured in place, memo would otherwise miss it.
  color: string
  geometry: THREE.SphereGeometry
  isSelected: boolean
  isCurrent: boolean
  onSelect: (id: string) => void
  onTravel: (id: string) => void
}

const NodeMesh = memo(function NodeMesh({ node, x, y, z, color, geometry, isSelected, isCurrent, onSelect, onTravel }: NodeMeshProps) {
  const radius = NODE_RADIUS[node.type]
  const handleClick = (e: ThreeEvent<MouseEvent>) => {
    e.stopPropagation()
    if (e.delta > 4) return // it was a look-around drag, not a click
    onSelect(node.id)
  }
  const handleDouble = (e: ThreeEvent<MouseEvent>) => {
    e.stopPropagation()
    onTravel(node.id)
  }
  return (
    <group position={[x, y, z]}>
      {/* Halo: billboarded additive glow so the node reads as a star, and so
          beams have something soft to dissolve into. Doesn't take clicks.
          Skipped on the current node — the camera sits right on top of it, so
          its halo would just wash the whole lower view. */}
      {!isCurrent && (
        <sprite scale={radius * (isSelected ? 6 : 5)} raycast={() => null}>
          <spriteMaterial
            map={glowTexture}
            color={color}
            transparent
            opacity={isSelected ? 0.7 : 0.5}
            blending={THREE.AdditiveBlending}
            depthWrite={false}
            toneMapped={false}
          />
        </sprite>
      )}
      <mesh
        geometry={geometry}
        scale={radius * (isSelected ? 1.35 : 1)}
        onClick={handleClick}
        onDoubleClick={handleDouble}
        onPointerOver={(e) => {
          e.stopPropagation()
          document.body.style.cursor = 'pointer'
        }}
        onPointerOut={() => {
          document.body.style.cursor = 'default'
        }}
      >
        <meshStandardMaterial
          color={color}
          emissive={color}
          emissiveIntensity={isSelected ? 1.6 : 0.7}
          roughness={0.4}
          metalness={0.1}
        />
      </mesh>
    </group>
  )
})

interface NodesProps {
  graph: Graph
  selectedId: string | null
  currentId: string
  onSelect: (id: string) => void
  onTravel: (id: string) => void
}

// The current node renders too — the ship hovers above it, so you see
// your own "planet" below the viewport rather than sitting inside it.
export function Nodes({ graph, selectedId, currentId, onSelect, onTravel }: NodesProps) {
  const geometry = useMemo(() => new THREE.SphereGeometry(1, 24, 24), [])
  return (
    <group>
      {graph.nodes.map((node) => (
        <NodeMesh
          key={node.id}
          node={node}
          x={node.x!}
          y={node.y!}
          z={node.z!}
          color={node.color}
          geometry={geometry}
          isSelected={node.id === selectedId}
          isCurrent={node.id === currentId}
          onSelect={onSelect}
          onTravel={onTravel}
        />
      ))}
    </group>
  )
}
