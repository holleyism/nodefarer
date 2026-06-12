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
import type { GraphNode } from '../types'
import { HUD_TEXT, MONO, MONO_SMALL, PANEL_SX, SECTION_LABEL_SX } from './hudStyles'

const KEY_CELL_SX = { ...SECTION_LABEL_SX, border: 0, py: 0.4 }

interface Props {
  node: GraphNode
  isCurrent: boolean
  isNeighbor: boolean
  distance: number
  traveling: boolean
  onTravel: (id: string) => void
  onClose: () => void
}

export function NodePanel({ node, isCurrent, isNeighbor, distance, traveling, onTravel, onClose }: Props) {
  return (
    <Paper
      elevation={8}
      sx={{
        position: 'absolute',
        top: 28,
        right: 28,
        width: 300,
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
        {isNeighbor && !isCurrent && (
          <Chip label="adjacent" size="small" variant="outlined" sx={{ font: MONO_SMALL, letterSpacing: 1 }} />
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
