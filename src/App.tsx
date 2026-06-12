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

  const currentNode = graph.nodeById.get(currentId)!
  const selectedNode = selectedId ? graph.nodeById.get(selectedId)! : null
  const nextHopNode = traveling ? graph.nodeById.get(route[0])! : null
  const destinationNode = traveling ? graph.nodeById.get(route[route.length - 1])! : null

  // Proximity locks stay live in flight, with the destination always held;
  // parked, the inspected node keeps its reticle even when it falls outside
  // the closest-N budget.
  const pinnedId = traveling
    ? destinationNode && destinationNode.id !== currentId
      ? destinationNode.id
      : null
    : selectedId && selectedId !== currentId
      ? selectedId
      : null
  const displayTaggedIds =
    pinnedId && !taggedIds.includes(pinnedId) ? [...taggedIds, pinnedId] : taggedIds

  const handleSelect = (id: string) => {
    if (!traveling) setSelectedId(id)
  }
  const handleTravel = (id: string) => {
    if (traveling || id === currentId) return
    setSelectedId(null)
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
      ;(window as any).__nodefarer = { travelTo: handleTravel, currentId }
    }
  })

  return (
    <Box sx={{ position: 'fixed', inset: 0, bgcolor: '#02030a' }}>
      <Canvas
        flat
        camera={{ fov: 60, near: 0.1, far: 4000 }}
        onPointerMissed={() => setSelectedId(null)}
      >
        <GraphScene
          graph={graph}
          currentNode={currentNode}
          targetNode={nextHopNode}
          selectedId={selectedId}
          taggedIds={displayTaggedIds}
          maxTags={maxTags}
          selectionPaused={viewMode !== 'proximity'}
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
        onSelect={handleSelect}
        onTravel={handleTravel}
        onClosePanel={() => setSelectedId(null)}
      />
    </Box>
  )
}
