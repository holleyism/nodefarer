import {
  Box,
  Button,
  Chip,
  Divider,
  IconButton,
  Paper,
  Stack,
  Table,
  TableBody,
  TableCell,
  TableRow,
  Typography,
} from '@mui/material'
import type { Graph, GraphEdge, GraphNode } from '../types'
import { HUD_TEXT, MONO, MONO_SMALL, PANEL_SX, SECTION_LABEL_SX } from './hudStyles'

const KEY_CELL_SX = { ...SECTION_LABEL_SX, border: 0, py: 0.4 }
const WORM = '#c6a3ff'
const HUD = '#7fd4ff'

function dist(a: GraphNode, b: GraphNode) {
  return Math.hypot(a.x! - b.x!, a.y! - b.y!, a.z! - b.z!)
}

interface LinkRowProps {
  edge: GraphEdge
  other: GraphNode
  distance: number
  pinned: boolean
  traveling: boolean
  canTravel: boolean
  onTogglePin: (id: string) => void
  onHoverEdge: (id: string | null) => void
  onTravel: (id: string) => void
}

// One incident edge. Clicking the row pins it (bracket in the viewport +
// expands this sub-panel); hovering previews the bracket.
function LinkRow({
  edge,
  other,
  distance,
  pinned,
  traveling,
  canTravel,
  onTogglePin,
  onHoverEdge,
  onTravel,
}: LinkRowProps) {
  const worm = edge.kind === 'semantic'
  const accent = worm ? WORM : HUD
  return (
    <Box
      data-testid="edge-link"
      onClick={() => onTogglePin(edge.id)}
      onMouseEnter={() => onHoverEdge(edge.id)}
      onMouseLeave={() => onHoverEdge(null)}
      sx={{
        cursor: 'pointer',
        borderRadius: '6px',
        px: 1,
        py: 0.6,
        mb: 0.5,
        border: '1px solid',
        borderColor: pinned ? accent : 'rgba(127, 212, 255, 0.18)',
        bgcolor: pinned ? 'rgba(127, 212, 255, 0.08)' : 'transparent',
        '&:hover': { borderColor: accent },
      }}
    >
      <Stack direction="row" spacing={1} alignItems="center" justifyContent="space-between">
        <Stack direction="row" spacing={1} alignItems="center" sx={{ minWidth: 0 }}>
          <Box component="span" sx={{ color: accent, fontSize: 13, lineHeight: 1 }}>
            {worm ? '✷' : '◇'}
          </Box>
          <Typography
            noWrap
            sx={{ font: MONO, color: HUD_TEXT, textTransform: 'none', letterSpacing: 0.3 }}
          >
            {other.name}
          </Typography>
        </Stack>
        {worm ? (
          <Chip
            label={`≈ ${edge.props.Similarity}`}
            size="small"
            sx={{
              font: MONO_SMALL,
              letterSpacing: 0.5,
              height: 18,
              color: WORM,
              borderColor: 'rgba(198,163,255,0.5)',
              border: '1px solid',
              bgcolor: 'transparent',
            }}
          />
        ) : (
          <Typography sx={{ ...SECTION_LABEL_SX, letterSpacing: 1 }}>{edge.label}</Typography>
        )}
      </Stack>

      {pinned && (
        <Box sx={{ mt: 0.75, pl: 1, borderLeft: `2px solid ${accent}` }}>
          <Table size="small">
            <TableBody>
              <TableRow>
                <TableCell sx={KEY_CELL_SX}>Kind</TableCell>
                <TableCell sx={{ border: 0, py: 0.3 }}>{edge.kind}</TableCell>
              </TableRow>
              <TableRow>
                <TableCell sx={KEY_CELL_SX}>Span</TableCell>
                <TableCell sx={{ border: 0, py: 0.3 }}>{distance.toFixed(1)} u</TableCell>
              </TableRow>
              {Object.entries(edge.props).map(([k, v]) => (
                <TableRow key={k}>
                  <TableCell sx={KEY_CELL_SX}>{k}</TableCell>
                  <TableCell sx={{ border: 0, py: 0.3 }}>{v}</TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
          {worm && (
            <Typography
              sx={{ font: MONO_SMALL, color: 'text.secondary', fontStyle: 'italic', px: 1, pb: 0.5 }}
            >
              Inferred from embedding similarity — no citation path between these.
            </Typography>
          )}
          <Button
            fullWidth
            size="small"
            variant="outlined"
            disabled={traveling || !canTravel}
            onClick={(e) => {
              e.stopPropagation()
              onTravel(other.id)
            }}
            sx={{ font: MONO_SMALL, letterSpacing: 1.5, mt: 0.25 }}
          >
            {worm ? 'Jump to' : 'Travel to'} {other.name}
          </Button>
        </Box>
      )}
    </Box>
  )
}

interface Props {
  node: GraphNode
  graph: Graph
  currentId: string
  isCurrent: boolean
  distance: number
  traveling: boolean
  pinnedEdgeIds: string[]
  onTogglePin: (id: string) => void
  onHoverEdge: (id: string | null) => void
  onTravel: (id: string) => void
  onClose: () => void
}

export function NodePanel({
  node,
  graph,
  currentId,
  isCurrent,
  distance,
  traveling,
  pinnedEdgeIds,
  onTogglePin,
  onHoverEdge,
  onTravel,
  onClose,
}: Props) {
  // Relationship to the current node: a structural edge is "adjacent"; a
  // semantic edge is a wormhole link — NOT adjacent (it has no graph path).
  const linksToCurrent = (graph.incident.get(currentId) ?? []).filter(
    (e) => e.source === node.id || e.target === node.id,
  )
  const structuralAdjacent = !isCurrent && linksToCurrent.some((e) => e.kind === 'structural')
  const wormholeLinked = !isCurrent && linksToCurrent.some((e) => e.kind === 'semantic')

  // Incident edges, wormholes surfaced first, then by neighbor name.
  const links = (graph.incident.get(node.id) ?? [])
    .map((edge) => {
      const otherId = edge.source === node.id ? edge.target : edge.source
      return { edge, other: graph.nodeById.get(otherId)! }
    })
    .sort((a, b) => {
      const wa = a.edge.kind === 'semantic' ? 0 : 1
      const wb = b.edge.kind === 'semantic' ? 0 : 1
      return wa - wb || a.other.name.localeCompare(b.other.name)
    })

  return (
    <Paper
      elevation={8}
      sx={{
        position: 'absolute',
        top: 28,
        right: 28,
        width: 300,
        maxHeight: 'calc(100vh - 56px)',
        overflowY: 'auto',
        p: 2,
        ...PANEL_SX,
      }}
    >
      <Stack direction="row" alignItems="center" justifyContent="space-between">
        <Stack direction="row" spacing={1} alignItems="center">
          <Box sx={{ width: 10, height: 10, borderRadius: '50%', bgcolor: node.color }} />
          <Typography variant="h6" sx={{ color: HUD_TEXT }}>
            {node.name}
          </Typography>
        </Stack>
        <IconButton size="small" onClick={onClose} aria-label="close">
          ✕
        </IconButton>
      </Stack>
      <Stack direction="row" spacing={1} sx={{ mb: 1.5 }}>
        <Chip label={node.type} size="small" variant="outlined" sx={{ font: MONO_SMALL, letterSpacing: 1 }} />
        {isCurrent && (
          <Chip label="you are here" size="small" color="primary" sx={{ font: MONO_SMALL, letterSpacing: 1 }} />
        )}
        {structuralAdjacent && (
          <Chip label="adjacent" size="small" variant="outlined" sx={{ font: MONO_SMALL, letterSpacing: 1 }} />
        )}
        {wormholeLinked && (
          <Chip
            label="wormhole"
            size="small"
            variant="outlined"
            sx={{ font: MONO_SMALL, letterSpacing: 1, color: WORM, borderColor: 'rgba(198,163,255,0.5)' }}
          />
        )}
      </Stack>
      <Divider sx={{ mb: 1 }} />
      <Table size="small">
        <TableBody>
          {!isCurrent && (
            <TableRow>
              <TableCell sx={KEY_CELL_SX}>Distance</TableCell>
              <TableCell sx={{ border: 0, py: 0.4 }}>{distance.toFixed(1)} u</TableCell>
            </TableRow>
          )}
          {Object.entries(node.properties).map(([k, v]) => (
            <TableRow key={k}>
              <TableCell sx={KEY_CELL_SX}>{k}</TableCell>
              <TableCell sx={{ border: 0, py: 0.4 }}>{v}</TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>

      {links.length > 0 && (
        <>
          <Divider sx={{ my: 1 }} />
          <Typography sx={{ ...SECTION_LABEL_SX, mb: 0.75 }}>Links — {links.length}</Typography>
          {links.map(({ edge, other }) => (
            <LinkRow
              key={edge.id}
              edge={edge}
              other={other}
              distance={dist(node, other)}
              pinned={pinnedEdgeIds.includes(edge.id)}
              traveling={traveling}
              canTravel={other.id !== currentId}
              onTogglePin={onTogglePin}
              onHoverEdge={onHoverEdge}
              onTravel={onTravel}
            />
          ))}
        </>
      )}

      {!isCurrent && (
        <Box sx={{ mt: 1.5 }}>
          <Button
            fullWidth
            variant="contained"
            disabled={traveling}
            onClick={() => onTravel(node.id)}
            sx={{ font: MONO, letterSpacing: 2 }}
          >
            Travel to {node.name}
          </Button>
        </Box>
      )}
    </Paper>
  )
}
