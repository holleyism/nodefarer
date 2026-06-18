import { Box, Chip, Stack, Typography } from '@mui/material'
import type { GraphNode } from '../types'
import { HUD_TEXT, MONO, MONO_SMALL } from './hudStyles'
import { ValuePill } from './ValuePill'

interface Props {
  node: GraphNode
  neighborCount: number
  onInspect: () => void
}

// Contents of the current-node DeployPanel: where the ship is parked, plus a
// jump to the full inspector (NodePanel).
export function CurrentNodeContent({ node, neighborCount, onInspect }: Props) {
  return (
    <>
      <Typography sx={{ font: MONO, letterSpacing: 3, color: '#aadfff', mb: 1.5 }}>
        CURRENT NODE
      </Typography>

      <Stack direction="row" spacing={1} alignItems="center" sx={{ mb: 1 }}>
        <Box sx={{ width: 10, height: 10, borderRadius: '50%', bgcolor: node.color, flexShrink: 0 }} />
        <Typography variant="h6" sx={{ color: HUD_TEXT, lineHeight: 1.2 }}>
          {node.name}
        </Typography>
      </Stack>

      <Stack direction="row" spacing={1} alignItems="center" sx={{ mb: 1.5 }}>
        <Typography sx={{ font: MONO_SMALL, letterSpacing: 1, color: 'text.secondary', textTransform: 'uppercase' }}>
          Links
        </Typography>
        <ValuePill>{neighborCount}</ValuePill>
        <Chip
          label={node.type}
          size="small"
          variant="outlined"
          sx={{ font: MONO_SMALL, letterSpacing: 1, textTransform: 'uppercase' }}
        />
      </Stack>

      <Box
        component="button"
        onClick={onInspect}
        sx={{
          width: '100%',
          font: MONO_SMALL,
          letterSpacing: 1.5,
          textTransform: 'uppercase',
          padding: '5px 0',
          color: '#aadfff',
          background: 'transparent',
          border: '1px solid rgba(127, 212, 255, 0.45)',
          borderRadius: '6px',
          cursor: 'pointer',
          '&:hover': { borderColor: '#7fd4ff' },
        }}
      >
        inspect ▸
      </Box>
    </>
  )
}
