import { useRef } from 'react'
import { useFrame } from '@react-three/fiber'

interface Sim {
  tick: () => void
  stop: () => void
}

interface Props {
  sim: Sim | null
  steps: number
  ticksPerFrame?: number
  onDone: () => void
}

// Drives a layout simulation INSIDE the R3F render loop (Plan H "watch reform").
// Ticking here — and FIRST, before Nodes/Edges/ShipCamera read positions in the
// same frame — keeps the moving nodes, their beams, and the camera all in phase,
// so the view doesn't bounce (the old App-rAF + setView loop ran a frame out of
// step with the camera's useFrame). Renders nothing; must be the first child of
// the scene so its useFrame runs before the readers'.
export function LayoutReform({ sim, steps, ticksPerFrame = 6, onDone }: Props) {
  const active = useRef<Sim | null>(null)
  const count = useRef(0)
  const onDoneRef = useRef(onDone)
  onDoneRef.current = onDone

  // A new sim instance means (re)start the run.
  if (sim !== active.current) {
    active.current = sim
    count.current = 0
  }

  useFrame(() => {
    const s = active.current
    if (!s) return
    for (let i = 0; i < ticksPerFrame; i++) s.tick()
    count.current += 1
    if (count.current >= steps) {
      active.current = null
      onDoneRef.current()
    }
  })

  return null
}
