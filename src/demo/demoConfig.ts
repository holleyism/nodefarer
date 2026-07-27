// Demo mode (promotional screen-capture) configuration. INERT unless `?demo=1` is
// present in the URL, so normal app behaviour is byte-for-byte unchanged when the
// param is absent.
//
// Demo mode plays an auto-advancing, looping "tour": it drives the app's REAL
// handlers (blast doors, travel, nebula clustering/folding, the node inspector) on
// a fixed timeline, with the full HUD + viewport frame on screen — because the UI
// itself is the thing being shown off. See the demo-loop effect in App.tsx.

// The hero / starting node: "Attention Is All You Need" in the bundled
// Hopfield→attention universe — iconic, medium density. Overridable with
// `?demo=1&node=<id>`.
export const HERO_DEFAULT = 'W2626778328'

// How many nodes the hero's landing neighbourhood is bounded to (readable, not a
// hairball).
export const ENTRY_MAX_NODES = 44

// Beat dwell times (ms) — how long each scripted step lingers before the next.
// Travel flights and the nebula reform take their own time ON TOP of these, so the
// full loop runs ~30s. Tune here to taste.
export const DEMO = {
  DOORS_SHUT: 1400, // hold on the closed doors (the loop seam)
  AFTER_LAND: 1600, // settle after the doors open on the fresh graph
  INSPECT: 2200, // dwell with the node inspector open
  AFTER_TRAVEL: 1500, // dwell after arriving at a node
  AFTER_CLUSTER: 1800, // dwell after the nebulae resolve
  FRAME_FIELDS: 2400, // pull-back to frame several nebulae before folding
  AFTER_FOLD: 1600, // dwell after distant fields fold away
  AFTER_FOCUS: 1500, // dwell after locking onto one nebula
  AFTER_UNFOLD: 2000, // dwell after a single field blooms open
  LOOK_BACK: 2200, // dwell on the closing "look back" beat
} as const

export interface DemoConfig {
  enabled: boolean
  heroId: string
  debug: boolean
}

// Read once at page load. `?demo=1` activates; `?node=<id>` overrides the hero;
// `?debug=1` logs what each camera-driven beat saw (which clouds were in frame,
// which one it locked onto) — for diagnosing a beat that framed the wrong thing.
export function readDemoConfig(): DemoConfig {
  const p = new URLSearchParams(window.location.search)
  return {
    enabled: p.get('demo') === '1',
    heroId: p.get('node') || HERO_DEFAULT,
    debug: p.get('debug') === '1',
  }
}

// The force layout seeds node positions with Math.random jitter, so absolute
// coordinates otherwise vary between page loads. In demo mode we replace Math.random
// with a fixed-seed xorshift32 PRNG so every loop iteration — and every take — lays
// out identically. Demo mode is a throwaway recording context with no free
// interaction, so a global override is fine.
let seeded = false
export function seedDeterministicRandom(seed = 0x9e3779b9): void {
  if (seeded) return
  seeded = true
  let s = seed >>> 0
  Math.random = () => {
    s ^= s << 13
    s ^= s >>> 17
    s ^= s << 5
    return ((s >>> 0) % 0xffffff) / 0xffffff
  }
}
