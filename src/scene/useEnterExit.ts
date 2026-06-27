import { useRef, useState } from 'react'
import { useFrame } from '@react-three/fiber'

export interface FadeEntry<T> {
  key: string
  item: T
  // 0 (just entered / about to leave) … 1 (fully present). Multiply into the
  // item's render opacity.
  opacity: number
}

// General enter/exit fade for a keyed list of scene items (nodes, edges, …).
//
// New keys fade 0→1; keys that disappear from `items` are RETAINED and fade
// 1→0, then dropped — so a node/edge leaving the scene dissolves instead of
// popping. The returned list is the union of present + still-exiting items, each
// carrying a live `opacity`.
//
// Gated by the blast doors (`doorsClosed`): while the doors are shut a view swap
// is hidden, so we don't animate — entrants are held invisible (they fade in as
// the doors REOPEN, the moment the user can see them) and the swap's removals are
// purged instantly on reopen (no ghosts fading over the revealed scene). With the
// doors open (a live change — nebula fold/unfold, arrival) both directions fade.
//
// `rate` is the per-second ease constant (≈ 1/seconds-to-settle): 2.5 ≈ 0.7s,
// 5 ≈ 0.35s. Lower = slower, more luxurious dissolve.
export function useEnterExit<T>(
  items: T[],
  keyOf: (t: T) => string,
  doorsClosed: boolean,
  rate = 2.5,
): FadeEntry<T>[] {
  const entries = useRef(new Map<string, { item: T; opacity: number; target: number }>())
  const [, force] = useState(0)
  const doorsRef = useRef(doorsClosed)
  doorsRef.current = doorsClosed
  const wasClosed = useRef(doorsClosed)

  // Reconcile membership on every render (cheap map work): refresh present items,
  // mark vanished ones as exiting (target 0) but keep them around to fade out.
  const present = new Set<string>()
  for (const it of items) {
    const k = keyOf(it)
    present.add(k)
    const e = entries.current.get(k)
    if (e) {
      e.item = it
      e.target = 1
    } else {
      entries.current.set(k, { item: it, opacity: 0, target: 1 })
    }
  }
  for (const [k, e] of entries.current) if (!present.has(k)) e.target = 0

  useFrame((_, delta) => {
    const open = !doorsRef.current
    let changed = false
    // On the closed→open edge, drop everything still on its way out: those
    // removals happened behind the doors, so they must not ghost over the scene.
    if (open && wasClosed.current) {
      for (const [k, e] of entries.current) if (e.target === 0) { entries.current.delete(k); changed = true }
    }
    wasClosed.current = !open
    // Frozen while the doors are shut — entrants wait at 0, nothing eases.
    if (!open) {
      if (changed) force((n) => n + 1)
      return
    }
    const k = Math.min(1, delta * rate)
    for (const [key, e] of entries.current) {
      const d = e.target - e.opacity
      if (Math.abs(d) < 0.004) {
        if (e.opacity !== e.target) { e.opacity = e.target; changed = true }
        if (e.target === 0) { entries.current.delete(key); changed = true }
        continue
      }
      e.opacity += d * k
      changed = true
    }
    if (changed) force((n) => n + 1)
  })

  // Render list: present items in their natural order, then any exiting tail.
  const out: FadeEntry<T>[] = items.map((it) => {
    const k = keyOf(it)
    return { key: k, item: it, opacity: entries.current.get(k)!.opacity }
  })
  for (const [k, e] of entries.current) {
    if (!present.has(k)) out.push({ key: k, item: e.item, opacity: e.opacity })
  }
  return out
}
