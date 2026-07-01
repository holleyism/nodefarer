import { useMemo } from 'react'
import { Stars } from '@react-three/drei'
import type { Graph, GraphNode } from '../types'
import { Nodes } from './Nodes'
import { Edges } from './Edges'
import { Nebulae, type NebulaBody } from './Nebulae'
import { NebulaStubEdges, type NebulaStub } from './NebulaStubEdges'
import { LayoutReform } from './LayoutReform'
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
  // Highlight overlays drawn in place over the existing geometry (Plan H3). Each
  // contributes its members at its kind's colour; later entries win on overlap
  // (so a plotted route over a highlighted nebula reads as the route).
  emphases: Emphasis[]
  // Volumetric nebula bodies (Plan H2); empty when nebulae are off.
  nebulae: NebulaBody[]
  // Faint beams into folded nebulae (connection exists, members hidden).
  nebulaStubs: NebulaStub[]
  // Spotlight the highlighted path: dim everything off it (nodes + edges).
  spotlightPath: boolean
  onSelectNebula: (key: string) => void
  onHoverNebula: (key: string | null) => void
  // Layout-reform animation (Plan H "watch reform"): a sim ticked in-loop while
  // `liveLayout` drives node/edge transforms imperatively, kept in phase.
  liveLayout: boolean
  // Blast-door state — gates the node/edge enter/exit fade (see useEnterExit).
  doorsClosed: boolean
  // Node/edge ids present BEFORE the nebula fold-mask, so the fade can snap
  // (not dissolve) whatever the fold hides/reveals. See useEnterExit.
  fullNodeKeys: Set<string>
  fullEdgeKeys: Set<string>
  reformSim: { tick: () => void; stop: () => void } | null
  reformSteps: number
  onReformDone: () => void
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
    instant?: boolean
    altitude?: number
    altitudeOnly?: boolean
  } | null
  overviewSignal: number
  overviewPoints: [number, number, number][] | null
  scrubMode: boolean
  scrubPath: [number, number, number][] | null
  scrubStep: number
  onScrubIndex: (index: number) => void
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
  emphases,
  nebulae,
  nebulaStubs,
  spotlightPath,
  onSelectNebula,
  onHoverNebula,
  liveLayout,
  doorsClosed,
  fullNodeKeys,
  fullEdgeKeys,
  reformSim,
  reformSteps,
  onReformDone,
  following,
  followSignal,
  recenterSignal,
  recenterKeepZoom,
  frameSignal,
  frameTarget,
  overviewSignal,
  overviewPoints,
  scrubMode,
  scrubPath,
  scrubStep,
  onScrubIndex,
  onUnlock,
  onTaggedChange,
  onSelect,
  onTravel,
  onArrive,
}: Props) {
  // Emphases are drawn as an OVERLAY on the existing geometry: Edges/Nodes
  // recolour these members in place, so a highlight can't drift to a different
  // apparent elevation as the view zooms or tilts. Build id→colour maps so
  // multiple kinds (route, nebula) can layer with their own colours.
  const highlightNodes = useMemo(() => {
    const m = new Map<string, string>()
    for (const e of emphases) for (const id of e.nodeIds) m.set(id, EMPHASIS_COLOR[e.kind])
    return m
  }, [emphases])
  const highlightEdges = useMemo(() => {
    const m = new Map<string, string>()
    for (const e of emphases) for (const id of e.edgeIds) m.set(id, EMPHASIS_COLOR[e.kind])
    return m
  }, [emphases])

  return (
    <>
      {/* First child: ticks the reform sim before any reader's useFrame runs. */}
      <LayoutReform sim={reformSim} steps={reformSteps} onDone={onReformDone} />
      <color attach="background" args={['#02030a']} />
      <fog attach="fog" args={['#02030a', 150, 1100]} />
      <ambientLight intensity={0.7} />
      <directionalLight position={[200, 300, 100]} intensity={0.8} />
      <Stars radius={1200} depth={400} count={5000} factor={6} saturation={0.4} fade speed={0.4} />
      <Nebulae bodies={nebulae} onSelect={onSelectNebula} onHover={onHoverNebula} />
      <NebulaStubEdges stubs={nebulaStubs} />
      <Edges
        graph={graph}
        currentId={currentNode.id}
        highlightEdges={highlightEdges}
        live={liveLayout}
        dimOthers={spotlightPath}
        doorsClosed={doorsClosed}
        fullKeys={fullEdgeKeys}
      />
      <EdgeHighlights graph={graph} pinnedEdgeIds={pinnedEdgeIds} hoveredEdgeId={hoveredEdgeId} />
      <Nodes
        graph={graph}
        selectedId={selectedId}
        currentId={currentNode.id}
        highlightNodes={highlightNodes}
        dimOthers={spotlightPath}
        live={liveLayout}
        doorsClosed={doorsClosed}
        fullKeys={fullNodeKeys}
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
        overviewSignal={overviewSignal}
        overviewPoints={overviewPoints}
        scrubMode={scrubMode}
        scrubPath={scrubPath}
        scrubStep={scrubStep}
        onScrubIndex={onScrubIndex}
        onUnlock={onUnlock}
        onArrive={onArrive}
      />
    </>
  )
}
