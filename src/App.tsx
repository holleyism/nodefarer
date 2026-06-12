import { useMemo, useState } from 'react'
import { Box } from '@mui/material'
import { Canvas } from '@react-three/fiber'
import { generateGraph } from './data/generateGraph'
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
  const [targetId, setTargetId] = useState<string | null>(null)
  const traveling = targetId !== null

  const currentNode = graph.nodeById.get(currentId)!
  const selectedNode = selectedId ? graph.nodeById.get(selectedId)! : null
  const targetNode = targetId ? graph.nodeById.get(targetId)! : null

  const handleSelect = (id: string) => {
    if (!traveling) setSelectedId(id)
  }
  const handleTravel = (id: string) => {
    if (traveling || id === currentId) return
    setSelectedId(null)
    setTargetId(id)
  }
  const handleArrive = () => {
    if (targetId) {
      setCurrentId(targetId)
      setTargetId(null)
    }
  }

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
          targetNode={targetNode}
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
        targetNode={targetNode}
        onSelect={handleSelect}
        onTravel={handleTravel}
        onClosePanel={() => setSelectedId(null)}
      />
    </Box>
  )
}
