import { Box, Stack, Typography } from '@mui/material'

// Metadata for the focused/current nebula, computed in App over the full view.
export interface NebulaInfo {
  key: string
  count: number
  byType: Record<string, number>
  yearRange: [number, number] | null
  top: { id: string; name: string }[]
}

const MONO = '11px/1.7 ui-monospace, SFMono-Regular, Menlo, monospace'
const MONO_SMALL = '10px/1.6 ui-monospace, SFMono-Regular, Menlo, monospace'

interface Props {
  info: NebulaInfo | null
  color: string
  folded: boolean
  isCurrent: boolean
  highlight: boolean
  onToggleFold: (key: string, folded: boolean) => void
  onToggleHighlight: () => void
  onSelectMember: (id: string) => void
}

// Rail inspector for a nebula (Plan H2b): name, metadata, a fold/unfold control,
// an in-place highlight toggle (H3), plus its brightest members. Mirrors the
// node inspector's feel.
export function NebulaPanel({ info, color, folded, isCurrent, highlight, onToggleFold, onToggleHighlight, onSelectMember }: Props) {
  if (!info) {
    return (
      <Typography variant="caption" sx={{ color: 'text.secondary' }}>
        Turn on nebulae, then click a cloud to inspect it.
      </Typography>
    )
  }
  const types = Object.entries(info.byType).sort((a, b) => b[1] - a[1])
  return (
    <Stack spacing={1.25}>
      <Box>
        <Typography sx={{ font: '13px/1.4 ui-monospace, Menlo, monospace', color, letterSpacing: 1, textTransform: 'uppercase' }}>
          {info.key}
        </Typography>
        <Typography variant="caption" sx={{ color: 'text.secondary' }}>
          {isCurrent ? 'current nebula · ' : ''}
          {info.count} members
          {info.yearRange ? ` · ${info.yearRange[0]}–${info.yearRange[1]}` : ''}
        </Typography>
      </Box>

      <Box sx={{ display: 'flex', gap: 0.5 }}>
        <Box
          component="button"
          onClick={() => onToggleFold(info.key, !folded)}
          sx={{
            flex: 1,
            font: MONO_SMALL,
            letterSpacing: 1.5,
            textTransform: 'uppercase',
            padding: '4px 0',
            color: folded ? '#02030a' : '#aadfff',
            background: folded ? '#7fd4ff' : 'transparent',
            border: '1px solid rgba(127, 212, 255, 0.45)',
            borderRadius: '6px',
            cursor: 'pointer',
          }}
        >
          {folded ? '▸ unfold' : '▾ fold'}
        </Box>
        <Box
          component="button"
          onClick={onToggleHighlight}
          sx={{
            flex: 1,
            font: MONO_SMALL,
            letterSpacing: 1.5,
            textTransform: 'uppercase',
            padding: '4px 0',
            color: highlight ? '#02030a' : '#aadfff',
            background: highlight ? '#7fd4ff' : 'transparent',
            border: '1px solid rgba(127, 212, 255, 0.45)',
            borderRadius: '6px',
            cursor: 'pointer',
          }}
        >
          {highlight ? '◉' : '○'} highlight
        </Box>
      </Box>

      <Box>
        <Typography sx={{ font: MONO, letterSpacing: 1.5, color: 'text.secondary' }}>COMPOSITION</Typography>
        <Box sx={{ display: 'flex', flexWrap: 'wrap', gap: 0.5, mt: 0.5 }}>
          {types.map(([t, n]) => (
            <Typography key={t} sx={{ font: MONO_SMALL, color: '#cde8ff', opacity: 0.85 }}>
              {t}&nbsp;{n}
            </Typography>
          ))}
        </Box>
      </Box>

      {info.top.length > 0 && (
        <Box>
          <Typography sx={{ font: MONO, letterSpacing: 1.5, color: 'text.secondary' }}>BRIGHTEST</Typography>
          <Stack spacing={0.25} sx={{ mt: 0.5 }}>
            {info.top.map((m) => (
              <Box
                key={m.id}
                component="button"
                onClick={() => onSelectMember(m.id)}
                sx={{
                  font: MONO_SMALL,
                  color: '#cde8ff',
                  textAlign: 'left',
                  background: 'transparent',
                  border: 'none',
                  padding: 0,
                  cursor: 'pointer',
                  overflow: 'hidden',
                  textOverflow: 'ellipsis',
                  whiteSpace: 'nowrap',
                  '&:hover': { color: '#fff' },
                }}
              >
                {m.name}
              </Box>
            ))}
          </Stack>
        </Box>
      )}
    </Stack>
  )
}
