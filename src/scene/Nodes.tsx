import { memo, useMemo } from 'react'
import * as THREE from 'three'
import type { ThreeEvent } from '@react-three/fiber'
import type { Graph, GraphNode, NodeType } from '../types'

export const NODE_RADIUS: Record<NodeType, number> = {
  star: 2.6,
  gate: 2.0,
  outpost: 1.6,
  relay: 1.4,
}

interface NodeMeshProps {
  node: GraphNode
  geometry: THREE.SphereGeometry
  isSelected: boolean
  onSelect: (id: string) => void
  onTravel: (id: string) => void
}

const NodeMesh = memo(function NodeMesh({ node, geometry, isSelected, onSelect, onTravel }: NodeMeshProps) {
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
    <mesh
      geometry={geometry}
      position={[node.x!, node.y!, node.z!]}
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
        color={node.color}
        emissive={node.color}
        emissiveIntensity={isSelected ? 1.6 : 0.7}
        roughness={0.4}
        metalness={0.1}
      />
    </mesh>
  )
})

interface NodesProps {
  graph: Graph
  selectedId: string | null
  onSelect: (id: string) => void
  onTravel: (id: string) => void
}

// The current node renders too — the ship hovers above it, so you see
// your own "planet" below the viewport rather than sitting inside it.
export function Nodes({ graph, selectedId, onSelect, onTravel }: NodesProps) {
  const geometry = useMemo(() => new THREE.SphereGeometry(1, 24, 24), [])
  return (
    <group>
      {graph.nodes.map((node) => (
        <NodeMesh
          key={node.id}
          node={node}
          geometry={geometry}
          isSelected={node.id === selectedId}
          onSelect={onSelect}
          onTravel={onTravel}
        />
      ))}
    </group>
  )
}
