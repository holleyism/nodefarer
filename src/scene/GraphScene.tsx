import { useMemo } from 'react'
import { Stars } from '@react-three/drei'
import type { Graph, GraphNode } from '../types'
import { Nodes } from './Nodes'
import { Edges } from './Edges'
import { EdgeHighlights } from './EdgeHighlights'
import { Reticles } from './Reticles'
import { EMPHASIS_COLOR, type Emphasis } from './RouteHighlight'
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
  // A plotted-course (or other) highlight set drawn over the scene, or null.
  emphasis: Emphasis | null
  following: boolean
  followSignal: number
  recenterSignal: number
  recenterKeepZoom: boolean
  // Bumped to auto-frame a set of world points (a freshly plotted course).
  frameSignal: number
  frameTarget: {
    points: [number, number, number][]
    destination: [number, number, number]
    zoom?: boolean
  } | null
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
  emphasis,
  following,
  followSignal,
  recenterSignal,
  recenterKeepZoom,
  frameSignal,
  frameTarget,
  onUnlock,
  onTaggedChange,
  onSelect,
  onTravel,
  onArrive,
}: Props) {
  // The emphasis (plotted route) is drawn as an OVERLAY on the existing geometry:
  // Edges/Nodes recolour these members in place, so the highlight can't drift to
  // a different apparent elevation as the view zooms or tilts.
  const emphasisEdgeIds = useMemo(() => new Set(emphasis?.edgeIds ?? []), [emphasis])
  const emphasisNodeIds = useMemo(() => new Set(emphasis?.nodeIds ?? []), [emphasis])
  const emphasisColor = emphasis ? EMPHASIS_COLOR[emphasis.kind] : undefined

  return (
    <>
      <color attach="background" args={['#02030a']} />
      <fog attach="fog" args={['#02030a', 150, 1100]} />
      <ambientLight intensity={0.7} />
      <directionalLight position={[200, 300, 100]} intensity={0.8} />
      <Stars radius={1200} depth={400} count={5000} factor={6} saturation={0.4} fade speed={0.4} />
      <Edges
        graph={graph}
        currentId={currentNode.id}
        highlightEdgeIds={emphasisEdgeIds}
        highlightColor={emphasisColor}
      />
      <EdgeHighlights graph={graph} pinnedEdgeIds={pinnedEdgeIds} hoveredEdgeId={hoveredEdgeId} />
      <Nodes
        graph={graph}
        selectedId={selectedId}
        currentId={currentNode.id}
        highlightNodeIds={emphasisNodeIds}
        highlightColor={emphasisColor}
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
        recenterSignal={recenterSignal}
        recenterKeepZoom={recenterKeepZoom}
        frameSignal={frameSignal}
        frameTarget={frameTarget}
        onUnlock={onUnlock}
        onArrive={onArrive}
      />
    </>
  )
}
