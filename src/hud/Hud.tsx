import { Box, Chip, LinearProgress, Paper, Stack, Typography } from '@mui/material'
import type { Graph, GraphNode, ViewMode } from '../types'
import { BottomBar } from './BottomBar'
import { NodePanel } from './NodePanel'
import { Radar } from './Radar'
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
  following: boolean
  onFollow: () => void
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
  following,
  onFollow,
  onSelect,
  onTravel,
  onClosePanel,
}: Props) {
  const traveling = destination !== null
  // Radar source: immediate neighbors of the current node. Future sources
  // (search hits, clusters, semantic matches) swap in here.
  const radarTargets = (graph.neighbors.get(currentNode.id) ?? []).map(
    (id) => graph.nodeById.get(id)!,
  )
  const neighborCount = radarTargets.length

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
          <Stack direction="row" spacing={1.5} alignItems="center" sx={{ mb: 0.5 }}>
            <Typography variant="body2">
              Traveling to <strong>{destination.name}</strong>
              {hopsLeft > 1 ? ` · ${hopsLeft} hops remaining` : ''}…
            </Typography>
            {!following && (
              <Box
                component="button"
                onClick={onFollow}
                sx={{
                  font: '10px/1.6 ui-monospace, SFMono-Regular, Menlo, monospace',
                  letterSpacing: 1.5,
                  textTransform: 'uppercase',
                  color: '#aadfff',
                  background: 'transparent',
                  border: '1px solid rgba(127, 212, 255, 0.45)',
                  borderRadius: 999,
                  padding: '2px 10px',
                  cursor: 'pointer',
                  whiteSpace: 'nowrap',
                  '&:hover': { borderColor: '#7fd4ff' },
                }}
              >
                ⌖ follow course
              </Box>
            )}
          </Stack>
          <LinearProgress />
        </Paper>
      )}

      {/* Radar — bottom right, above the dashboard */}
      <Radar label="adjacent" targets={radarTargets} />

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
