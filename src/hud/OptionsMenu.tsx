import { useState } from 'react'
import { Box, Slider, Typography } from '@mui/material'
import type { ViewMode } from '../types'

const MONO = '11px/1.7 ui-monospace, SFMono-Regular, Menlo, monospace'
const MONO_SMALL = '10px/1.6 ui-monospace, SFMono-Regular, Menlo, monospace'

const MODES: Array<{ id: ViewMode; label: string; disabled?: boolean }> = [
  { id: 'proximity', label: 'prox' },
  { id: 'multi', label: 'multi', disabled: true },
  { id: 'cluster', label: 'clust', disabled: true },
  { id: 'semantic', label: 'sem', disabled: true },
]

interface Props {
  viewMode: ViewMode
  onViewModeChange: (m: ViewMode) => void
  maxTags: number
  onMaxTagsChange: (n: number) => void
}

// Ship console: lives in the dashboard bar; the panel deploys upward from
// the button with a slight overshoot and CRT flicker while a scanline
// sweeps down it once. The view-mode selector decides how the viewport picks
// highlights; each mode owns the controls rendered beneath it.
type PanelState = 'closed' | 'open' | 'closing'

export function OptionsMenu({ viewMode, onViewModeChange, maxTags, onMaxTagsChange }: Props) {
  // 'closing' keeps the panel mounted while the retract animation plays.
  const [panel, setPanel] = useState<PanelState>('closed')
  const open = panel === 'open'
  const toggle = () => setPanel(open ? 'closing' : 'open')
  return (
    <Box sx={{ position: 'relative' }}>
      {panel !== 'closed' && (
        <Box
          onAnimationEnd={(e) => {
            if (e.animationName === 'console-retract') setPanel('closed')
          }}
          sx={{
            position: 'absolute',
            bottom: 'calc(100% + 18px)',
            left: 0,
            width: 280,
            p: 2,
            overflow: 'hidden',
            bgcolor: 'rgba(4, 14, 28, 0.92)',
            border: '1px solid rgba(127, 212, 255, 0.35)',
            borderRadius: '10px',
            backdropFilter: 'blur(6px)',
            transformOrigin: 'bottom left',
            animation:
              panel === 'closing'
                ? 'console-retract 170ms cubic-bezier(0.5, 0, 0.75, 0.35) forwards'
                : 'console-deploy 240ms cubic-bezier(0.2, 0.9, 0.25, 1.15)',
            '@keyframes console-deploy': {
              '0%': { transform: 'scale(0.5, 0.15)', opacity: 0 },
              '55%': { transform: 'scale(1.01, 1.04)', opacity: 0.75 },
              '70%': { opacity: 0.5 },
              '100%': { transform: 'scale(1, 1)', opacity: 1 },
            },
            '@keyframes console-retract': {
              '0%': { transform: 'scale(1, 1)', opacity: 1 },
              '30%': { opacity: 0.55 },
              '45%': { opacity: 0.85 },
              '100%': { transform: 'scale(0.5, 0.12)', opacity: 0 },
            },
            '&::after': {
              content: '""',
              position: 'absolute',
              left: 0,
              right: 0,
              top: 0,
              height: '2px',
              background:
                'linear-gradient(90deg, transparent, rgba(127, 212, 255, 0.8), transparent)',
              animation: 'console-scan 420ms linear 80ms 1 forwards',
              opacity: 0,
            },
            '@keyframes console-scan': {
              '0%': { top: 0, opacity: 1 },
              '100%': { top: '100%', opacity: 0 },
            },
          }}
        >
          <Typography sx={{ font: MONO, letterSpacing: 3, color: '#aadfff', mb: 1.5 }}>
            SHIP CONSOLE
          </Typography>

          <Typography sx={{ font: MONO, letterSpacing: 1.5, color: 'text.secondary' }}>
            VIEW MODE
          </Typography>
          <Box sx={{ display: 'flex', gap: 0.5, mt: 0.5, mb: 1.5 }}>
            {MODES.map((m) => {
              const active = m.id === viewMode
              return (
                <Box
                  key={m.id}
                  component="button"
                  disabled={m.disabled}
                  title={m.disabled ? 'Coming soon' : undefined}
                  onClick={() => onViewModeChange(m.id)}
                  sx={{
                    flex: 1,
                    font: MONO_SMALL,
                    letterSpacing: 1.5,
                    textTransform: 'uppercase',
                    padding: '3px 0',
                    color: active ? '#02030a' : m.disabled ? 'rgba(170, 223, 255, 0.3)' : '#aadfff',
                    background: active ? '#7fd4ff' : 'transparent',
                    border: '1px solid rgba(127, 212, 255, 0.45)',
                    borderRadius: '6px',
                    cursor: m.disabled ? 'default' : 'pointer',
                  }}
                >
                  {m.label}
                </Box>
              )
            })}
          </Box>

          {viewMode === 'proximity' && (
            <>
              <Typography sx={{ font: MONO, letterSpacing: 1.5, color: 'text.secondary' }}>
                TARGET LOCKS — {maxTags}
              </Typography>
              <Slider
                size="small"
                min={1}
                max={50}
                value={maxTags}
                onChange={(_, v) => onMaxTagsChange(v as number)}
                aria-label="Target locks"
                sx={{ mt: -0.5 }}
              />
              <Typography
                variant="caption"
                sx={{ color: 'text.secondary', display: 'block', mt: -0.5 }}
              >
                Reticles lock the closest {maxTags} bodies on the glass.
              </Typography>
            </>
          )}
        </Box>
      )}

      <Box
        component="button"
        onClick={toggle}
        sx={{
          font: MONO,
          letterSpacing: 2,
          textTransform: 'uppercase',
          color: '#aadfff',
          background: 'rgba(4, 14, 28, 0.72)',
          border: '1px solid rgba(127, 212, 255, 0.45)',
          borderRadius: 999,
          padding: '4px 14px',
          cursor: 'pointer',
          backdropFilter: 'blur(2px)',
          '&:hover': { borderColor: '#7fd4ff' },
        }}
      >
        {open ? '▾ console' : '▴ console'}
      </Box>
    </Box>
  )
}
