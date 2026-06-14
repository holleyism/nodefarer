import { Stars } from '@react-three/drei'
import type { Graph, GraphNode } from '../types'
import { Nodes } from './Nodes'
import { Edges } from './Edges'
import { EdgeHighlights } from './EdgeHighlights'
import { Reticles } from './Reticles'
import { ShipCamera } from './ShipCamera'
import { TagSelector } from './TagSelector'

interface Props {
  graph: Graph
  currentNode: GraphNode
  targetNode: GraphNode | null
  selectedId: string | null
  taggedIds: string[]
  pinnedEdgeIds: string[]
  hoveredEdgeId: string | null
  maxTags: number
  selectionPaused: boolean
  following: boolean
  followSignal: number
  onUnlock: () => void
  onTaggedChange: (ids: string[]) => void
  onSelect: (id: string) => void
  onTravel: (id: string) => void
  onArrive: () => void
}

export function GraphScene({
  graph,
  currentNode,
  targetNode,
  selectedId,
  taggedIds,
  pinnedEdgeIds,
  hoveredEdgeId,
  maxTags,
  selectionPaused,
  following,
  followSignal,
  onUnlock,
  onTaggedChange,
  onSelect,
  onTravel,
  onArrive,
}: Props) {

  return (
    <>
      <color attach="background" args={['#02030a']} />
      <fog attach="fog" args={['#02030a', 150, 1100]} />
      <ambientLight intensity={0.7} />
      <directionalLight position={[200, 300, 100]} intensity={0.8} />
      <Stars radius={1200} depth={400} count={5000} factor={6} saturation={0.4} fade speed={0.4} />
      <Edges graph={graph} currentId={currentNode.id} />
      <EdgeHighlights graph={graph} pinnedEdgeIds={pinnedEdgeIds} hoveredEdgeId={hoveredEdgeId} />
      <Nodes
        graph={graph}
        selectedId={selectedId}
        currentId={currentNode.id}
        onSelect={onSelect}
        onTravel={onTravel}
      />
      <Reticles graph={graph} taggedIds={taggedIds} selectedId={selectedId} onSelect={onSelect} />
      <TagSelector
        graph={graph}
        currentId={currentNode.id}
        maxTags={maxTags}
        paused={selectionPaused}
        onChange={onTaggedChange}
      />
      <ShipCamera
        currentNode={currentNode}
        targetNode={targetNode}
        following={following}
        followSignal={followSignal}
        onUnlock={onUnlock}
        onArrive={onArrive}
      />
    </>
  )
}
