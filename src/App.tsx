import { useEffect, useMemo, useState } from 'react'
import { Box } from '@mui/material'
import type { ViewMode } from './types'
import { Canvas } from '@react-three/fiber'
import { generateGraph } from './data/generateGraph'
import { shortestPath } from './data/shortestPath'
import { runForceLayout } from './layout/runForceLayout'
import { GraphScene } from './scene/GraphScene'
import { Hud } from './hud/Hud'

export default function App() {
  const graph = useMemo(() => {
    const g = generateGraph(7)
    runForceLayout(g)
    return g
  }, [])

  const [currentId, setCurrentId] = useState(() => graph.nodes[0].id)
  const [selectedId, setSelectedId] = useState<string | null>(null)
  // Edges the user pinned from the selected node's link list (bracketed in the
  // viewport) and the one currently hovered (lighter preview bracket). Both are
  // scoped to the open node panel — cleared whenever selection changes.
  const [pinnedEdgeIds, setPinnedEdgeIds] = useState<string[]>([])
  const [hoveredEdgeId, setHoveredEdgeId] = useState<string | null>(null)
  // Remaining hops of the active journey (graph-shortest-path, current node
  // excluded). Empty array = parked.
  const [route, setRoute] = useState<string[]>([])
  const traveling = route.length > 0
  // How the viewport picks highlights, the proximity-mode reticle budget,
  // and the lock set chosen by TagSelector.
  const [viewMode, setViewMode] = useState<ViewMode>('proximity')
  const [maxTags, setMaxTags] = useState(10)
  const [taggedIds, setTaggedIds] = useState<string[]>([])
  // Whether the camera is locked to the course while traveling. Dragging
  // mid-flight unlocks it; "follow course" (or journey's end) re-locks.
  const [following, setFollowing] = useState(true)
  const [followSignal, setFollowSignal] = useState(0)
  // Blast doors: shut the window while the universe is being (re)laid out.
  // Manual control for now; relayout events (queries, expand/collapse,
  // cluster switches) will drive this later.
  const [doorsClosed, setDoorsClosed] = useState(false)

  const currentNode = graph.nodeById.get(currentId)!
  const selectedNode = selectedId ? graph.nodeById.get(selectedId)! : null
  const nextHopNode = traveling ? graph.nodeById.get(route[0])! : null
  const destinationNode = traveling ? graph.nodeById.get(route[route.length - 1])! : null

  // Locks stay live in flight, with the destination always held; parked,
  // the inspected node keeps its reticle even when it falls outside the
  // mode's own pick. Adjacent mode is computed here (it's static per node);
  // proximity comes from TagSelector's per-frame scan.
  const pinnedId = traveling
    ? destinationNode && destinationNode.id !== currentId
      ? destinationNode.id
      : null
    : selectedId && selectedId !== currentId
      ? selectedId
      : null
  const baseTaggedIds = viewMode === 'adjacent' ? (graph.neighbors.get(currentId) ?? []) : taggedIds
  // No reticle locks while the doors are shut — there's nothing on the glass.
  // The current node never gets a reticle: the ship is parked on it, so a
  // lock-on bracket there is meaningless (and it sits right under the camera).
  const displayTaggedIds = (
    doorsClosed
      ? []
      : pinnedId && !baseTaggedIds.includes(pinnedId)
        ? [...baseTaggedIds, pinnedId]
        : baseTaggedIds
  ).filter((id) => id !== currentId)

  // Selecting a different node retires the previous node's pinned/hovered edges.
  const clearEdges = () => {
    setPinnedEdgeIds([])
    setHoveredEdgeId(null)
  }
  const handleSelect = (id: string) => {
    if (traveling) return
    setSelectedId(id)
    clearEdges()
  }
  const handleTogglePin = (id: string) =>
    setPinnedEdgeIds((p) => (p.includes(id) ? p.filter((x) => x !== id) : [...p, id]))
  const handleTravel = (id: string) => {
    if (traveling || id === currentId) return
    setSelectedId(null)
    clearEdges()
    const path = shortestPath(graph, currentId, id)
    // Unreachable nodes get a direct flight rather than no flight.
    setRoute(path ? path.slice(1) : [id])
  }
  const handleArrive = () => {
    if (route.length === 0) return
    setCurrentId(route[0])
    setRoute(route.slice(1))
    // Journey over: re-lock the camera for the next departure.
    if (route.length === 1) setFollowing(true)
  }
  const handleFollow = () => {
    setFollowing(true)
    setFollowSignal((s) => s + 1)
  }

  // Dev-only handle for the headless smoke test (scripts/smoke.mjs).
  useEffect(() => {
    if (import.meta.env.DEV) {
      ;(window as any).__nodefarer = {
        travelTo: handleTravel,
        currentId,
        doors: { close: () => setDoorsClosed(true), open: () => setDoorsClosed(false) },
      }
    }
  })

  return (
    <Box
      sx={{
        position: 'fixed',
        inset: 0,
        bgcolor: '#02030a',
        // The canvas owns all touch gestures — otherwise Safari hijacks a
        // finger-drag into a page scroll/pinch after a few pixels and our
        // look-around handler stops getting pointer moves. touch-action does
        // not inherit, so it must land on the <canvas> element itself.
        touchAction: 'none',
        '& canvas': { touchAction: 'none' },
      }}
    >
      <Canvas
        flat
        camera={{ fov: 60, near: 0.1, far: 4000 }}
        onPointerMissed={() => {
          setSelectedId(null)
          clearEdges()
        }}
      >
        <GraphScene
          graph={graph}
          currentNode={currentNode}
          targetNode={nextHopNode}
          selectedId={selectedId}
          taggedIds={displayTaggedIds}
          pinnedEdgeIds={doorsClosed ? [] : pinnedEdgeIds}
          hoveredEdgeId={doorsClosed ? null : hoveredEdgeId}
          maxTags={maxTags}
          selectionPaused={viewMode !== 'proximity' || doorsClosed}
          following={following}
          followSignal={followSignal}
          onUnlock={() => setFollowing(false)}
          onTaggedChange={setTaggedIds}
          onSelect={handleSelect}
          onTravel={handleTravel}
          onArrive={handleArrive}
        />
      </Canvas>
      <Hud
        graph={graph}
        currentNode={currentNode}
        selectedNode={selectedNode}
        destination={destinationNode}
        hopsLeft={route.length}
        viewMode={viewMode}
        onViewModeChange={setViewMode}
        maxTags={maxTags}
        onMaxTagsChange={setMaxTags}
        following={following}
        onFollow={handleFollow}
        doorsClosed={doorsClosed}
        onToggleDoors={() => setDoorsClosed(!doorsClosed)}
        pinnedEdgeIds={pinnedEdgeIds}
        onTogglePin={handleTogglePin}
        onHoverEdge={setHoveredEdgeId}
        onSelect={handleSelect}
        onTravel={handleTravel}
        onClosePanel={() => setSelectedId(null)}
      />
    </Box>
  )
}
