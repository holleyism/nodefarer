import { Box, Chip, LinearProgress, Paper, Stack, Typography } from '@mui/material'
import type { Graph, GraphNode, ViewMode } from '../types'
import { BottomBar } from './BottomBar'
import { NodePanel } from './NodePanel'
import { ViewportFrame } from './ViewportFrame'

function dist(a: GraphNode, b: GraphNode) {
  return Math.hypot(a.x! - b.x!, a.y! - b.y!, a.z! - b.z!)
}

interface Props {
  graph: Graph
  currentNode: GraphNode
  selectedNode: GraphNode | null
  destination: GraphNode | null
  hopsLeft: number
  viewMode: ViewMode
  onViewModeChange: (m: ViewMode) => void
  maxTags: number
  onMaxTagsChange: (n: number) => void
  onSelect: (id: string) => void
  onTravel: (id: string) => void
  onClosePanel: () => void
}

export function Hud({
  graph,
  currentNode,
  selectedNode,
  destination,
  hopsLeft,
  viewMode,
  onViewModeChange,
  maxTags,
  onMaxTagsChange,
  onSelect,
  onTravel,
  onClosePanel,
}: Props) {
  const traveling = destination !== null
  const neighborCount = graph.neighbors.get(currentNode.id)?.length ?? 0

  return (
    <>
      <ViewportFrame />

      {/* Current node — top left */}
      <Paper
        elevation={4}
        onClick={() => onSelect(currentNode.id)}
        sx={{
          position: 'absolute',
          top: 28,
          left: 28,
          px: 2,
          py: 1,
          cursor: 'pointer',
          bgcolor: 'rgba(8, 14, 28, 0.88)',
          border: '1px solid rgba(127, 212, 255, 0.25)',
          backdropFilter: 'blur(6px)',
          '&:hover': { borderColor: 'primary.main' },
        }}
      >
        <Typography variant="overline" sx={{ color: 'text.secondary', lineHeight: 1 }}>
          Current node
        </Typography>
        <Stack direction="row" spacing={1} alignItems="center">
          <Box sx={{ width: 10, height: 10, borderRadius: '50%', bgcolor: currentNode.color }} />
          <Typography variant="h6" sx={{ color: '#aadfff' }}>
            {currentNode.name}
          </Typography>
          <Chip label={`${neighborCount} links`} size="small" variant="outlined" />
        </Stack>
      </Paper>

      {/* Travel banner — top center */}
      {traveling && (
        <Paper
          elevation={4}
          sx={{
            position: 'absolute',
            top: 28,
            left: '50%',
            transform: 'translateX(-50%)',
            px: 3,
            py: 1,
            minWidth: 240,
            bgcolor: 'rgba(8, 14, 28, 0.88)',
            border: '1px solid rgba(127, 212, 255, 0.25)',
          }}
        >
          <Typography variant="body2" sx={{ mb: 0.5 }}>
            Traveling to <strong>{destination.name}</strong>
            {hopsLeft > 1 ? ` · ${hopsLeft} hops remaining` : ''}…
          </Typography>
          <LinearProgress />
        </Paper>
      )}

      {/* Dashboard — console, controls legend, wordmark */}
      <BottomBar
        viewMode={viewMode}
        onViewModeChange={onViewModeChange}
        maxTags={maxTags}
        onMaxTagsChange={onMaxTagsChange}
      />

      {selectedNode && (
        <NodePanel
          node={selectedNode}
          isCurrent={selectedNode.id === currentNode.id}
          isNeighbor={(graph.neighbors.get(currentNode.id) ?? []).includes(selectedNode.id)}
          distance={dist(currentNode, selectedNode)}
          traveling={traveling}
          onTravel={onTravel}
          onClose={onClosePanel}
        />
      )}
    </>
  )
}
