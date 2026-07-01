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
// purged instantly on reopen (no ghosts fading over the revealed scene).
//
// `fullKeys` is the item set BEFORE the nebula fold-mask (post-filter) — the scene
// the viewport shows is that set minus the folded members. It separates a genuine
// reveal/removal (expand/add/collapse → dissolve) from a nebula fold/unfold (→
// snap): a key that leaves the visible list but is still in `fullKeys` was folded
// away, and one that reappears having been in `fullKeys` all along is unfolding —
// both snap, because there the reform itself is the motion. Omit it to fade every
// membership change (the pre-fold behaviour).
//
// `rate` is the per-second ease constant (≈ 1/seconds-to-settle): 2.5 ≈ 0.7s,
// 5 ≈ 0.35s. Lower = slower, more luxurious dissolve.
export function useEnterExit<T>(
  items: T[],
  keyOf: (t: T) => string,
  doorsClosed: boolean,
  fullKeys?: Set<string>,
  rate = 2.5,
): FadeEntry<T>[] {
  const entries = useRef(new Map<string, { item: T; opacity: number; target: number }>())
  const [, force] = useState(0)
  const doorsRef = useRef(doorsClosed)
  doorsRef.current = doorsClosed
  const wasClosed = useRef(doorsClosed)
  // Last render's `fullKeys`, to tell an unfold (was in the full set → snap in)
  // from a genuine reveal (newly in the full set → fade in).
  const prevFull = useRef<Set<string>>(new Set())

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
      // Snap in (opacity 1) if this key was already in the full view last render
      // and is only now unfolding; fade in (0) for a genuine reveal.
      const unfolding = fullKeys != null && prevFull.current.has(k)
      entries.current.set(k, { item: it, opacity: unfolding ? 1 : 0, target: 1 })
    }
  }
  for (const [k, e] of entries.current) {
    if (present.has(k)) continue
    // Vanished. Still in the full view → folded away: drop it at once (snap, the
    // reform is the motion). Genuinely gone → fade it out.
    if (fullKeys?.has(k)) entries.current.delete(k)
    else e.target = 0
  }
  prevFull.current = fullKeys ?? new Set()

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
