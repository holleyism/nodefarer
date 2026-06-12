import { useRef } from 'react'
import { useFrame } from '@react-three/fiber'
import * as THREE from 'three'
import type { Graph } from '../types'
import { screenEdgeFactor } from './screenFade'

const nodePos = new THREE.Vector3()

interface Props {
  graph: Graph
  currentId: string
  maxTags: number
  paused: boolean
  onChange: (ids: string[]) => void
}

// Decides which nodes deserve a reticle: the maxTags closest nodes whose
// screen position is on the glass (in front of the camera and clear of the
// border fade zone). When a closer node swings into view, the furthest
// tagged node loses its lock. Runs a few times a second, not per frame —
// churning the tag set at 60fps would thrash the DOM and strobe the
// acquisition flash — and only pushes state when membership changes.
export function TagSelector({ graph, currentId, maxTags, paused, onChange }: Props) {
  const lastRun = useRef(0)
  const lastKey = useRef('')

  useFrame(({ camera, size, clock }) => {
    if (paused) return
    if (clock.elapsedTime - lastRun.current < 0.2) return
    lastRun.current = clock.elapsedTime

    const candidates: Array<{ id: string; dist: number }> = []
    for (const node of graph.nodes) {
      if (node.id === currentId) continue
      nodePos.set(node.x!, node.y!, node.z!)
      if (screenEdgeFactor(nodePos, camera, size) <= 0) continue
      candidates.push({ id: node.id, dist: camera.position.distanceTo(nodePos) })
    }
    candidates.sort((a, b) => a.dist - b.dist)
    const ids = candidates.slice(0, maxTags).map((c) => c.id)

    const key = ids.slice().sort().join('|')
    if (key !== lastKey.current) {
      lastKey.current = key
      onChange(ids)
    }
  })

  return null
}
