import { memo, useCallback, useMemo, useRef } from 'react'
import { useFrame } from '@react-three/fiber'
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
  // On a highlighted route: glow in the highlight colour, in place (an overlay
  // on the real sphere — no separate floating ring to parallax off the node).
  isHighlighted: boolean
  highlightColor: string
  // Spotlight: this node is NOT on the highlighted path, so fade it right back.
  dimmed: boolean
  // Registers this node's group so the parent can drive its position imperatively
  // during a live reform (kept in phase with the camera + beams).
  register: (id: string, g: THREE.Group | null) => void
  onSelect: (id: string) => void
  onTravel: (id: string) => void
}

const NodeMesh = memo(function NodeMesh({ node, x, y, z, color, geometry, isSelected, isCurrent, isHighlighted, highlightColor, dimmed, register, onSelect, onTravel }: NodeMeshProps) {
  const radius = NODE_RADIUS[node.type]
  const setGroup = useCallback((g: THREE.Group | null) => register(node.id, g), [register, node.id])
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
    <group ref={setGroup} position={[x, y, z]}>
      {/* Halo: billboarded additive glow so the node reads as a star, and so
          beams have something soft to dissolve into. Doesn't take clicks.
          Skipped on the current node — the camera sits right on top of it, so
          its halo would just wash the whole lower view. */}
      {!isCurrent && (
        <sprite scale={radius * (isHighlighted ? 6 : isSelected ? 6 : 5)} raycast={() => null}>
          <spriteMaterial
            map={glowTexture}
            color={isHighlighted ? highlightColor : color}
            transparent
            opacity={isHighlighted ? 0.75 : isSelected ? 0.7 : dimmed ? 0.08 : 0.5}
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
          emissive={isHighlighted ? highlightColor : color}
          emissiveIntensity={isHighlighted ? 1.7 : isSelected ? 1.6 : dimmed ? 0.12 : 0.7}
          roughness={0.4}
          metalness={0.1}
          transparent={dimmed}
          opacity={dimmed ? 0.28 : 1}
        />
      </mesh>
    </group>
  )
})

interface NodesProps {
  graph: Graph
  selectedId: string | null
  currentId: string
  // Highlighted nodes → their highlight colour (route / nebula overlays may
  // layer, each with its own colour; Plan H3).
  highlightNodes?: Map<string, string>
  // Spotlight a highlighted path: nodes off it (and not the current node) fade back.
  dimOthers?: boolean
  // While true, node positions are driven imperatively each frame from the live
  // node coords (a layout reform in progress) instead of from React props.
  live?: boolean
  onSelect: (id: string) => void
  onTravel: (id: string) => void
}

// The current node renders too — the ship hovers above it, so you see
// your own "planet" below the viewport rather than sitting inside it.
export function Nodes({ graph, selectedId, currentId, highlightNodes, dimOthers = false, live = false, onSelect, onTravel }: NodesProps) {
  const geometry = useMemo(() => new THREE.SphereGeometry(1, 24, 24), [])

  // Imperative per-frame position sync during a reform: keeps the node meshes in
  // the SAME frame as the camera (which also reads live coords), so the anchored
  // node doesn't bounce. Off when not reforming — positions come from props.
  const groups = useRef(new Map<string, THREE.Group>())
  const register = useCallback((id: string, g: THREE.Group | null) => {
    if (g) groups.current.set(id, g)
    else groups.current.delete(id)
  }, [])
  const liveRef = useRef(live)
  liveRef.current = live
  const graphRef = useRef(graph)
  graphRef.current = graph
  useFrame(() => {
    if (!liveRef.current) return
    for (const n of graphRef.current.nodes) {
      if (n.x == null || n.y == null || n.z == null) continue
      groups.current.get(n.id)?.position.set(n.x, n.y, n.z)
    }
  })

  return (
    <group>
      {graph.nodes.map((node) => {
        const hl = highlightNodes?.get(node.id)
        return (
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
            isHighlighted={hl != null}
            highlightColor={hl ?? '#ffce7a'}
            dimmed={dimOthers && hl == null && node.id !== currentId}
            register={register}
            onSelect={onSelect}
            onTravel={onTravel}
          />
        )
      })}
    </group>
  )
}
