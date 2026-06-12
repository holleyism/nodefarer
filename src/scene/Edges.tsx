import { useMemo } from 'react'
import * as THREE from 'three'
import type { Graph } from '../types'

const UP = new THREE.Vector3(0, 1, 0)

interface EdgesProps {
  graph: Graph
  currentId: string
}

// Edges are open-ended cylinders ("tubes") with additive blending; scene fog
// fades distant ones to black so nearby structure reads clearly. Edges touching
// the current node are brighter — they're the travel lanes out of here — and
// tapered: needle-thin at the ship's end (the camera hovers right above it,
// so a full-width tube there would fill the viewport) widening toward the
// far node.
export function Edges({ graph, currentId }: EdgesProps) {
  const cylGeo = useMemo(() => new THREE.CylinderGeometry(1, 1, 1, 6, 1, true), [])
  // Tapered lane: bottom (-Y, the source end after orientation) is 6% width.
  const laneGeo = useMemo(() => new THREE.CylinderGeometry(1, 0.06, 1, 6, 1, true), [])

  const items = useMemo(
    () =>
      graph.edges.map((e) => {
        const a = graph.nodeById.get(e.source)!
        const b = graph.nodeById.get(e.target)!
        const av = new THREE.Vector3(a.x!, a.y!, a.z!)
        const bv = new THREE.Vector3(b.x!, b.y!, b.z!)
        const dir = bv.clone().sub(av).normalize()
        return {
          key: `${e.source}|${e.target}`,
          source: e.source,
          target: e.target,
          mid: av.clone().add(bv).multiplyScalar(0.5),
          quat: new THREE.Quaternion().setFromUnitVectors(UP, dir),
          quatFlipped: new THREE.Quaternion().setFromUnitVectors(UP, dir.clone().negate()),
          length: av.distanceTo(bv),
        }
      }),
    [graph],
  )

  return (
    <group>
      {items.map((it) => {
        const active = it.source === currentId || it.target === currentId
        // Keep the thin end of the taper at the current node.
        const quat = active && it.target === currentId ? it.quatFlipped : it.quat
        return (
          <mesh
            key={it.key}
            geometry={active ? laneGeo : cylGeo}
            position={it.mid}
            quaternion={quat}
            scale={[active ? 0.35 : 0.2, it.length, active ? 0.35 : 0.2]}
            raycast={() => null}
          >
            <meshBasicMaterial
              color={active ? '#9fdcff' : '#7d9fd4'}
              transparent
              opacity={active ? 0.5 : 0.25}
              blending={THREE.AdditiveBlending}
              depthWrite={false}
            />
          </mesh>
        )
      })}
    </group>
  )
}
