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
// the current node are brighter — they're the travel lanes out of here.
export function Edges({ graph, currentId }: EdgesProps) {
  const geometry = useMemo(() => new THREE.CylinderGeometry(1, 1, 1, 6, 1, true), [])

  const items = useMemo(
    () =>
      graph.edges.map((e) => {
        const a = graph.nodeById.get(e.source)!
        const b = graph.nodeById.get(e.target)!
        const av = new THREE.Vector3(a.x!, a.y!, a.z!)
        const bv = new THREE.Vector3(b.x!, b.y!, b.z!)
        const dir = bv.clone().sub(av)
        const length = dir.length()
        return {
          key: `${e.source}|${e.target}`,
          source: e.source,
          target: e.target,
          mid: av.clone().add(bv).multiplyScalar(0.5),
          quat: new THREE.Quaternion().setFromUnitVectors(UP, dir.normalize()),
          length,
        }
      }),
    [graph],
  )

  return (
    <group>
      {items.map((it) => {
        const active = it.source === currentId || it.target === currentId
        return (
          <mesh
            key={it.key}
            geometry={geometry}
            position={it.mid}
            quaternion={it.quat}
            scale={[active ? 0.3 : 0.2, it.length, active ? 0.3 : 0.2]}
            raycast={() => null}
          >
            <meshBasicMaterial
              color={active ? '#9fdcff' : '#7d9fd4'}
              transparent
              opacity={active ? 0.6 : 0.25}
              blending={THREE.AdditiveBlending}
              depthWrite={false}
            />
          </mesh>
        )
      })}
    </group>
  )
}
