import { useEffect, useRef, useState } from 'react'
import { Box, LinearProgress, Paper, Stack, Typography } from '@mui/material'
import type { Graph, GraphNode, ViewMode } from '../types'
import type { EdgeSortKey } from '../data/edgeSort'
import { BlastDoors } from './BlastDoors'
import { BottomBar } from './BottomBar'
import { ConsoleRail, type RailItem } from './ConsoleRail'
import { CurrentNodeContent } from './CurrentNodeContent'
import { FilterPanel } from './FilterPanel'
import { PANEL_SX } from './hudStyles'
import { NodePanel } from './NodePanel'
import { OptionsMenu } from './OptionsMenu'
import { Radar } from './Radar'
import { SearchBar } from './SearchBar'
import type { Candidate, Predicate } from '../data/GraphSource'
import type { GraphSchema } from '../data/graphSchema'
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
  edgeSort: EdgeSortKey
  onEdgeSortChange: (k: EdgeSortKey) => void
  showEdges: boolean
  onToggleEdges: () => void
  showWormholes: boolean
  onToggleWormholes: () => void
  schema: GraphSchema | null
  predicate: Predicate
  onPredicateChange: (p: Predicate) => void
  following: boolean
  onFollow: () => void
  doorsClosed: boolean
  onToggleDoors: () => void
  onDoorsClosed: () => void
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
  onSearch: (query: string) => Promise<Candidate[]>
  onJump: (id: string) => void
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
  edgeSort,
  onEdgeSortChange,
  showEdges,
  onToggleEdges,
  showWormholes,
  onToggleWormholes,
  schema,
  predicate,
  onPredicateChange,
  following,
  onFollow,
  doorsClosed,
  onToggleDoors,
  onDoorsClosed,
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
  onSearch,
  onJump,
}: Props) {
  const traveling = destination !== null
  // Radar source: immediate neighbors of the current node. Future sources
  // (search hits, clusters, semantic matches) swap in here.
  const radarTargets = (graph.neighbors.get(currentNode.id) ?? []).map(
    (id) => graph.nodeById.get(id)!,
  )
  const neighborCount = radarTargets.length

  // Which rail panel is open (one at a time). Selection drives the inspector:
  // selecting a node deploys it; deselecting retracts it. Keep the last node so
  // the inspector keeps its contents through the retract animation.
  const [openId, setOpenId] = useState<string | null>(null)
  const lastSelected = useRef<GraphNode | null>(null)
  if (selectedNode) lastSelected.current = selectedNode
  const inspectNode = selectedNode ?? lastSelected.current

  useEffect(() => {
    if (selectedNode) setOpenId('inspector')
    else setOpenId((cur) => (cur === 'inspector' ? null : cur))
  }, [selectedNode])

  const handleOpenChange = (id: string | null) => {
    // Leaving the inspector clears the selection; opening it with nothing
    // selected inspects the current node.
    if (openId === 'inspector' && id !== 'inspector') onClosePanel()
    if (id === 'inspector' && !selectedNode) onSelect(currentNode.id)
    setOpenId(id)
  }

  // Left activation rail — current node, inspector, scanner, ship console.
  const railItems: RailItem[] = [
    {
      id: 'current',
      icon: '⬡',
      title: 'Current node',
      width: 240,
      content: (
        <CurrentNodeContent
          node={currentNode}
          neighborCount={neighborCount}
          onInspect={() => onSelect(currentNode.id)}
        />
      ),
    },
    {
      id: 'inspector',
      icon: '⊙',
      title: 'Inspector — selected node',
      width: 320,
      contentKey: inspectNode?.id ?? 'inspector',
      content: inspectNode ? (
        <NodePanel
          node={inspectNode}
          graph={graph}
          currentId={currentNode.id}
          isCurrent={inspectNode.id === currentNode.id}
          distance={dist(currentNode, inspectNode)}
          traveling={traveling}
          pinnedEdgeIds={pinnedEdgeIds}
          visibleEdgeIds={visibleEdgeIds}
          edgeSort={edgeSort}
          onTogglePin={onTogglePin}
          onHoverEdge={onHoverEdge}
          onSetEdgeVisible={onSetEdgeVisible}
          onTravel={onTravel}
          onExpand={onExpand}
          onCollapse={onCollapse}
          onClose={onClosePanel}
        />
      ) : null,
    },
    {
      id: 'scanner',
      icon: '⌕',
      title: 'Scanner — search',
      width: 300,
      content: ({ close }: { close: () => void }) => (
        <SearchBar
          onSearch={onSearch}
          onPick={(id) => {
            close()
            onJump(id)
          }}
        />
      ),
    },
    {
      id: 'filter',
      icon: '▽',
      title: 'Filter — bound the view',
      width: 280,
      content: schema ? (
        <FilterPanel schema={schema} predicate={predicate} onChange={onPredicateChange} />
      ) : null,
    },
    {
      id: 'console',
      icon: '▤',
      title: 'Ship console',
      width: 280,
      content: (
        <OptionsMenu
          viewMode={viewMode}
          onViewModeChange={onViewModeChange}
          maxTags={maxTags}
          onMaxTagsChange={onMaxTagsChange}
          edgeBudget={edgeBudget}
          onEdgeBudgetChange={onEdgeBudgetChange}
          edgeSort={edgeSort}
          onEdgeSortChange={onEdgeSortChange}
          showEdges={showEdges}
          onToggleEdges={onToggleEdges}
          showWormholes={showWormholes}
          onToggleWormholes={onToggleWormholes}
          doorsClosed={doorsClosed}
          onToggleDoors={onToggleDoors}
        />
      ),
    },
  ]

  return (
    <>
      <BlastDoors closed={doorsClosed} label="standby — layout hold" onClosed={onDoorsClosed} />
      <ViewportFrame />

      {/* Left activation rail */}
      <ConsoleRail items={railItems} openId={openId} onOpenChange={handleOpenChange} />

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

      {/* Dashboard — controls legend + wordmark */}
      <BottomBar />
    </>
  )
}
