import { useEffect, useRef } from 'react'
import { Box, Typography } from '@mui/material'
import { DeployToast } from './DeployToast'

export interface AppMessage {
  id: number
  text: string
  level: 'error' | 'info'
}

// The bottom-left status/error readout: the DeployToast shell (corner-anchored)
// plus this one's content — an icon, the message, and a single dismiss ✕. Info
// messages auto-dismiss; errors stay until the user closes them.
const AUTO_DISMISS_MS = 6000

interface Props {
  message: AppMessage | null
  onDismiss: () => void
}

export function MessageToast({ message, onDismiss }: Props) {
  // Keep the last message so contents persist through the retract.
  const last = useRef(message)
  if (message) last.current = message
  const msg = message ?? last.current

  // Info auto-dismisses; errors persist until the user closes them.
  useEffect(() => {
    if (message?.level === 'info') {
      const t = setTimeout(onDismiss, AUTO_DISMISS_MS)
      return () => clearTimeout(t)
    }
  }, [message, onDismiss])

  const error = msg?.level === 'error'
  const accent = error ? '#ffb38a' : '#7fd4ff'

  return (
    <DeployToast
      open={!!message}
      anchor="bottom-left"
      width={340}
      accent={accent}
      glow={error ? 'rgba(255,140,90,0.25)' : 'rgba(127,212,255,0.25)'}
    >
      {msg && (
        <Box sx={{ display: 'flex', alignItems: 'flex-start', gap: 1, p: 1.5 }}>
          <Box component="span" sx={{ color: accent, font: '14px/1.3 ui-monospace, monospace', flexShrink: 0 }}>
            {error ? '⚠' : 'ⓘ'}
          </Box>
          <Typography
            sx={{
              flex: 1,
              font: '11px/1.5 ui-monospace, SFMono-Regular, Menlo, monospace',
              letterSpacing: 0.3,
              color: '#cdeeff',
              wordBreak: 'break-word',
            }}
          >
            {msg.text}
          </Typography>
          <Box
            component="button"
            onClick={onDismiss}
            aria-label="Dismiss"
            sx={{
              flexShrink: 0,
              font: '12px/1 ui-monospace, monospace',
              color: 'text.secondary',
              background: 'transparent',
              border: 'none',
              cursor: 'pointer',
              p: 0,
              '&:hover': { color: accent },
            }}
          >
            ✕
          </Box>
        </Box>
      )}
    </DeployToast>
  )
}
