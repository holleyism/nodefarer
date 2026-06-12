import { Html } from '@react-three/drei'
import { Chip } from '@mui/material'
import type { Graph } from '../types'

interface Props {
  graph: Graph
  currentId: string
  hidden: boolean
  onSelect: (id: string) => void
}

// Floating name tags on the current node's direct neighbors — the places you
// can hop to next. Kept to neighbors only so the DOM overlay stays cheap.
export function NeighborLabels({ graph, currentId, hidden, onSelect }: Props) {
  if (hidden) return null
  const ids = graph.neighbors.get(currentId) ?? []
  return (
    <>
      {ids.map((id) => {
        const n = graph.nodeById.get(id)!
        return (
          <Html
            key={id}
            position={[n.x!, n.y! + 3.5, n.z!]}
            center
            zIndexRange={[40, 0]}
            style={{ pointerEvents: 'auto' }}
          >
            <Chip
              label={n.name}
              size="small"
              onClick={(e) => {
                // Don't let the click bubble to the canvas — R3F's
                // onPointerMissed would immediately clear the selection.
                e.stopPropagation()
                onSelect(id)
              }}
              sx={{
                bgcolor: 'rgba(10, 20, 40, 0.75)',
                border: '1px solid',
                borderColor: n.color,
                color: n.color,
                whiteSpace: 'nowrap',
                backdropFilter: 'blur(2px)',
              }}
            />
          </Html>
        )
      })}
    </>
  )
}
