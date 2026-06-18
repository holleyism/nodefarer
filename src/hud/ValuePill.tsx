import { Box } from '@mui/material'
import { MONO_SMALL } from './hudStyles'

// A lit readout chip for a changing value — keeps panel labels as plain text
// while the live numbers read as control-panel gauges rather than prose.
export function ValuePill({ children }: { children: React.ReactNode }) {
  return (
    <Box
      component="span"
      sx={{
        display: 'inline-block',
        font: MONO_SMALL,
        letterSpacing: 0.5,
        color: '#cdeeff',
        bgcolor: 'rgba(127, 212, 255, 0.12)',
        border: '1px solid rgba(127, 212, 255, 0.5)',
        borderRadius: 999,
        px: 0.85,
        py: '1px',
        lineHeight: 1.4,
        whiteSpace: 'nowrap',
      }}
    >
      {children}
    </Box>
  )
}

// Two readouts joined by a short conduit — a range gauge (lo ⟶ hi).
export function RangePills({ lo, hi }: { lo: React.ReactNode; hi: React.ReactNode }) {
  return (
    <Box component="span" sx={{ display: 'inline-flex', alignItems: 'center', verticalAlign: 'middle' }}>
      <ValuePill>{lo}</ValuePill>
      <Box
        component="span"
        sx={{
          width: 12,
          height: '2px',
          mx: 0.25,
          background:
            'linear-gradient(90deg, rgba(127,212,255,0.7), rgba(127,212,255,0.35), rgba(127,212,255,0.7))',
          flexShrink: 0,
        }}
      />
      <ValuePill>{hi}</ValuePill>
    </Box>
  )
}
