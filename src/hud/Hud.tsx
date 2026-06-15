import { Box, Chip, LinearProgress, Paper, Stack, Typography } from '@mui/material'
import type { Graph, GraphNode, ViewMode } from '../types'
import { BlastDoors } from './BlastDoors'
import { BottomBar } from './BottomBar'
import { HUD_TEXT, MONO_SMALL, PANEL_SX, SECTION_LABEL_SX } from './hudStyles'
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
  edgeBudget: number
  onEdgeBudgetChange: (n: number) => void
  following: boolean
  onFollow: () => void
  doorsClosed: boolean
  onToggleDoors: () => void
  pinnedEdgeIds: string[]
  visibleEdgeIds: Set<string>
  onTogglePin: (id: string) => void
  onHoverEdge: (id: string | null) => void
  onSetEdgeVisible: (id: string, visible: boolean) => void
  onSelect: (id: string) => void
  onTravel: (id: string) => void
  onExpand: (id: string) => void
  onCollapse: (id: string) => void
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
  edgeBudget,
  onEdgeBudgetChange,
  following,
  onFollow,
  doorsClosed,
  onToggleDoors,
  pinnedEdgeIds,
  visibleEdgeIds,
  onTogglePin,
  onHoverEdge,
  onSetEdgeVisible,
  onSelect,
  onTravel,
  onExpand,
  onCollapse,
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
      <BlastDoors closed={doorsClosed} label="standby — layout hold" />
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
          ...PANEL_SX,
          '&:hover': { borderColor: 'primary.main' },
        }}
      >
        <Typography sx={SECTION_LABEL_SX}>Current node</Typography>
        <Stack direction="row" spacing={1} alignItems="center">
          <Box sx={{ width: 10, height: 10, borderRadius: '50%', bgcolor: currentNode.color }} />
          <Typography variant="h6" sx={{ color: HUD_TEXT }}>
            {currentNode.name}
          </Typography>
          <Chip
            label={`${neighborCount} links`}
            size="small"
            variant="outlined"
            sx={{ font: MONO_SMALL, letterSpacing: 1 }}
          />
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
            ...PANEL_SX,
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
        edgeBudget={edgeBudget}
        onEdgeBudgetChange={onEdgeBudgetChange}
        doorsClosed={doorsClosed}
        onToggleDoors={onToggleDoors}
      />

      {selectedNode && (
        <NodePanel
          node={selectedNode}
          graph={graph}
          currentId={currentNode.id}
          isCurrent={selectedNode.id === currentNode.id}
          distance={dist(currentNode, selectedNode)}
          traveling={traveling}
          pinnedEdgeIds={pinnedEdgeIds}
          visibleEdgeIds={visibleEdgeIds}
          onTogglePin={onTogglePin}
          onHoverEdge={onHoverEdge}
          onSetEdgeVisible={onSetEdgeVisible}
          onTravel={onTravel}
          onExpand={onExpand}
          onCollapse={onCollapse}
          onClose={onClosePanel}
        />
      )}
    </>
  )
}
