import { Box, Stack, Typography } from '@mui/material'
import type { TourStep } from '../data/tour'
import { DeployToast } from './DeployToast'
import { MONO_SMALL } from './hudStyles'

const ACCENT = '#c9a6ff' // tour violet — distinct from the cyan HUD / amber errors

// The bottom-center narration panel. Reuses the DeployToast shell; its controls
// are DERIVED from the step's position so an author can't make a broken set:
//   • first step  → Quit · Next
//   • middle step → Back · Quit · Next
//   • last step   → End tour (alone)
// There is deliberately no ✕ — a tour is exited only by an explicitly-labelled
// button, never an ambiguous corner control.
interface Props {
  step: TourStep | null
  index: number
  total: number
  busy: boolean
  onNext: () => void
  onBack: () => void
  onQuit: () => void
}

function TourButton({
  label,
  onClick,
  disabled,
  primary,
  grow,
  testId,
}: {
  label: string
  onClick: () => void
  disabled?: boolean
  primary?: boolean
  grow?: boolean
  testId?: string
}) {
  return (
    <Box
      component="button"
      data-testid={testId}
      onClick={onClick}
      disabled={disabled}
      sx={{
        flex: grow ? 1 : 'none',
        font: MONO_SMALL,
        letterSpacing: 1.5,
        textTransform: 'uppercase',
        padding: '5px 14px',
        color: disabled ? 'rgba(201, 166, 255, 0.3)' : primary ? '#160b28' : ACCENT,
        background: primary ? (disabled ? 'rgba(201,166,255,0.25)' : ACCENT) : 'transparent',
        border: `1px solid ${disabled ? 'rgba(201,166,255,0.2)' : 'rgba(201, 166, 255, 0.5)'}`,
        borderRadius: '6px',
        cursor: disabled ? 'default' : 'pointer',
        whiteSpace: 'nowrap',
        '&:hover': disabled ? {} : { borderColor: ACCENT },
      }}
    >
      {label}
    </Box>
  )
}

export function TourPanel({ step, index, total, busy, onNext, onBack, onQuit }: Props) {
  const isLast = index >= total - 1
  const nextLabel = step?.nextLabel ?? (isLast ? 'End tour' : 'Next →')

  return (
    <DeployToast
      open={!!step}
      anchor="bottom-center"
      width={560}
      accent={ACCENT}
      glow="rgba(201, 166, 255, 0.28)"
      maxHeightVh={46}
      zIndex={210}
    >
      {step && (
        <Box sx={{ p: 2 }}>
          <Stack direction="row" alignItems="baseline" spacing={1.5} sx={{ mb: 0.75 }}>
            <Typography sx={{ font: MONO_SMALL, letterSpacing: 2, color: ACCENT, flexShrink: 0 }}>
              {String(index + 1).padStart(2, '0')} / {String(total).padStart(2, '0')}
            </Typography>
            <Typography data-testid="tour-title" sx={{ font: '13px/1.4 ui-monospace, Menlo, monospace', letterSpacing: 0.5, color: '#efe6ff', fontWeight: 600 }}>
              {step.title}
            </Typography>
          </Stack>

          <Typography
            sx={{
              font: '12px/1.65 ui-monospace, SFMono-Regular, Menlo, monospace',
              letterSpacing: 0.2,
              color: '#d8ccf0',
              mb: 1.75,
            }}
          >
            {step.body}
          </Typography>

          <Stack direction="row" spacing={1} alignItems="center">
            {isLast ? (
              <TourButton label={nextLabel} onClick={onNext} disabled={busy} primary grow testId="tour-next" />
            ) : (
              <>
                {index > 0 && <TourButton label="← Back" onClick={onBack} disabled={busy} testId="tour-back" />}
                <Box sx={{ flex: 1 }} />
                <TourButton label="Quit tour" onClick={onQuit} disabled={busy} testId="tour-quit" />
                <TourButton label={busy ? '…' : nextLabel} onClick={onNext} disabled={busy} primary testId="tour-next" />
              </>
            )}
          </Stack>
        </Box>
      )}
    </DeployToast>
  )
}
