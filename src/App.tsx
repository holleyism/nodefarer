import { useEffect, useMemo, useState } from 'react'
import { Box } from '@mui/material'
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

  const currentNode = graph.nodeById.get(currentId)!
  const selectedNode = selectedId ? graph.nodeById.get(selectedId)! : null
  const nextHopNode = traveling ? graph.nodeById.get(route[0])! : null
  const destinationNode = traveling ? graph.nodeById.get(route[route.length - 1])! : null

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
        onSelect={handleSelect}
        onTravel={handleTravel}
        onClosePanel={() => setSelectedId(null)}
      />
    </Box>
  )
}
