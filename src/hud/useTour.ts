import { useCallback, useRef, useState } from 'react'
import type { EntryMode } from '../data/GraphSource'
import type { Tour, TourOp, TourStep } from '../data/tour'

// The host app supplies these — the tour engine drives the real exploration
// engine through them, so playback behaves exactly like manual navigation and a
// tour can't drift from how the app works. Each async method must resolve only
// once its effect has committed (the app resolves on a post-commit frame).
export interface TourExecutor {
  // Re-anchor the universe on the tour's entry (full relayout, behind doors).
  reset: (entry: EntryMode) => Promise<void>
  // Apply one step's action (if any) to the working view, then ease the camera to
  // the step's pose; resolves when it settles.
  runOp: (op?: TourOp, camera?: TourStep['camera']) => Promise<void>
  // Capture / restore the full exploration state at a step boundary (for Back).
  snapshot: () => unknown
  restore: (snap: unknown) => Promise<void>
}

export interface TourController {
  tour: Tour | null
  index: number
  busy: boolean
  start: (tour: Tour) => void
  next: () => void
  back: () => void
  quit: () => void
}

// Guided-tour playback. Sequencing is strictly one op at a time: each advance
// awaits its op before the next is allowed (the panel disables its controls
// while `busy`), so there are no overlapping view swaps. Back restores a
// snapshot taken at each boundary rather than replaying — instant, no re-fly.
export function useTour(exec: TourExecutor): TourController {
  const [tour, setTour] = useState<Tour | null>(null)
  const [index, setIndex] = useState(0)
  const [busy, setBusy] = useState(false)

  // Refs keep the latest values inside the stable callbacks (and let snapshot()
  // read post-commit state without re-creating handlers).
  const execRef = useRef(exec)
  execRef.current = exec
  const tourRef = useRef<Tour | null>(null)
  const indexRef = useRef(0)
  const busyRef = useRef(false)
  const snaps = useRef<unknown[]>([])
  tourRef.current = tour
  indexRef.current = index
  busyRef.current = busy

  const quit = useCallback(() => {
    setTour(null)
    setIndex(0)
    snaps.current = []
  }, [])

  const start = useCallback((t: Tour) => {
    if (busyRef.current) return
    setTour(t)
    setIndex(0)
    snaps.current = []
    setBusy(true)
    ;(async () => {
      await execRef.current.reset(t.entry)
      // The first step's op is usually omitted (entry already landed); apply it
      // (and/or its camera) if present so a tour can open with a baked-in framing.
      const s0 = t.steps[0]
      if (s0?.op || s0?.camera) await execRef.current.runOp(s0.op, s0.camera)
      snaps.current[0] = execRef.current.snapshot()
      setBusy(false)
    })()
  }, [])

  const next = useCallback(() => {
    const t = tourRef.current
    if (!t || busyRef.current) return
    const i = indexRef.current
    if (i >= t.steps.length - 1) {
      quit() // "End tour"
      return
    }
    const target = i + 1
    setBusy(true)
    ;(async () => {
      const step = t.steps[target]
      if (step.op || step.camera) await execRef.current.runOp(step.op, step.camera)
      snaps.current[target] = execRef.current.snapshot()
      setIndex(target)
      setBusy(false)
    })()
  }, [quit])

  const back = useCallback(() => {
    const t = tourRef.current
    if (!t || busyRef.current) return
    const i = indexRef.current
    if (i <= 0) return
    const target = i - 1
    setBusy(true)
    ;(async () => {
      const snap = snaps.current[target]
      if (snap !== undefined) await execRef.current.restore(snap)
      setIndex(target)
      setBusy(false)
    })()
  }, [])

  return { tour, index, busy, start, next, back, quit }
}
