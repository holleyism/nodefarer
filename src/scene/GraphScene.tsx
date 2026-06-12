import { Stars } from '@react-three/drei'
import type { Graph, GraphNode } from '../types'
import { Nodes } from './Nodes'
import { Edges } from './Edges'
import { NeighborLabels } from './NeighborLabels'
import { ShipCamera } from './ShipCamera'

interface Props {
  graph: Graph
  currentNode: GraphNode
  targetNode: GraphNode | null
  selectedId: string | null
  onSelect: (id: string) => void
  onTravel: (id: string) => void
  onArrive: () => void
}

export function GraphScene({ graph, currentNode, targetNode, selectedId, onSelect, onTravel, onArrive }: Props) {
  return (
    <>
      <color attach="background" args={['#02030a']} />
      <fog attach="fog" args={['#02030a', 150, 1100]} />
      <ambientLight intensity={0.7} />
      <directionalLight position={[200, 300, 100]} intensity={0.8} />
      <Stars radius={1200} depth={400} count={5000} factor={6} saturation={0.4} fade speed={0.4} />
      <Edges graph={graph} currentId={currentNode.id} />
      <Nodes
        graph={graph}
        currentId={currentNode.id}
        selectedId={selectedId}
        onSelect={onSelect}
        onTravel={onTravel}
      />
      <NeighborLabels graph={graph} currentId={currentNode.id} hidden={targetNode !== null} onSelect={onSelect} />
      <ShipCamera currentNode={currentNode} targetNode={targetNode} onArrive={onArrive} />
    </>
  )
}
