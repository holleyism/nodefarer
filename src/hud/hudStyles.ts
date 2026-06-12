// The window's design language: every HUD instrument shares these.
export const HUD = '#7fd4ff'
export const HUD_TEXT = '#aadfff'
export const MONO = '11px/1.7 ui-monospace, SFMono-Regular, Menlo, monospace'
export const MONO_SMALL = '10px/1.6 ui-monospace, SFMono-Regular, Menlo, monospace'

// Reticle name bubbles (drei Html) use zIndexRange [40, 0]; HUD panels sit
// above them — instruments paint over what's drawn on the glass.
export const PANEL_Z = 50

// Panel chrome shared by the console, current-node plate, and data panels.
export const PANEL_SX = {
  bgcolor: 'rgba(4, 14, 28, 0.92)',
  border: '1px solid rgba(127, 212, 255, 0.35)',
  borderRadius: '10px',
  backdropFilter: 'blur(6px)',
  zIndex: PANEL_Z,
} as const

// Section labels, console-style ("VIEW MODE", "TARGET LOCKS — 10", ...).
export const SECTION_LABEL_SX = {
  font: MONO_SMALL,
  letterSpacing: 2,
  textTransform: 'uppercase',
  color: 'text.secondary',
} as const
