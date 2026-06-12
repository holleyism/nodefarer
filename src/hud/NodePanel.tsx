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
        top: 16,
        right: 16,
        width: 300,
        p: 2,
        bgcolor: 'rgba(8, 14, 28, 0.88)',
        border: '1px solid rgba(127, 212, 255, 0.25)',
        backdropFilter: 'blur(6px)',
      }}
    >
      <Stack direction="row" alignItems="center" justifyContent="space-between">
        <Typography variant="h6" sx={{ color: node.color }}>
          {node.name}
        </Typography>
        <IconButton size="small" onClick={onClose} aria-label="close">
          ✕
        </IconButton>
      </Stack>
      <Stack direction="row" spacing={1} sx={{ mb: 1.5 }}>
        <Chip label={node.type} size="small" sx={{ borderColor: node.color, color: node.color }} variant="outlined" />
        {isCurrent && <Chip label="you are here" size="small" color="primary" />}
        {isNeighbor && !isCurrent && <Chip label="adjacent" size="small" variant="outlined" />}
      </Stack>
      <Divider sx={{ mb: 1 }} />
      <Table size="small">
        <TableBody>
          {!isCurrent && (
            <TableRow>
              <TableCell sx={{ color: 'text.secondary', border: 0, py: 0.4 }}>Distance</TableCell>
              <TableCell sx={{ border: 0, py: 0.4 }}>{distance.toFixed(1)} u</TableCell>
            </TableRow>
          )}
          {Object.entries(node.properties).map(([k, v]) => (
            <TableRow key={k}>
              <TableCell sx={{ color: 'text.secondary', border: 0, py: 0.4 }}>{k}</TableCell>
              <TableCell sx={{ border: 0, py: 0.4 }}>{v}</TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>
      {!isCurrent && (
        <Box sx={{ mt: 1.5 }}>
          <Button fullWidth variant="contained" disabled={traveling} onClick={() => onTravel(node.id)}>
            Travel to {node.name}
          </Button>
        </Box>
      )}
    </Paper>
  )
}
