import { useEffect, useMemo } from 'react'
import * as THREE from 'three'
import type { NodeType } from '../types'
import { makeBeamMaterial } from './beamMaterial'
import { NODE_RADIUS } from './Nodes'

// ─────────────────────────────────────────────────────────────────────────────
// Stub edges into a FOLDED nebula. When a field is folded its member nodes are
// hidden, so the real edges into them are masked out — but we still want to show
// that the connection EXISTS without revealing what's inside. Each stub is a
// faint beam from the visible endpoint reaching toward the cloud and dissolving
// into its surface (a big fade at the target end), tinted the field's colour:
// "something connects here, but you can't see that far yet."
// ─────────────────────────────────────────────────────────────────────────────

export interface NebulaStub {
  id: string
  from: [number, number, number]
  fromType: NodeType
  center: [number, number, number]
  radius: number
  color: string
}

const UP = new THREE.Vector3(0, 1, 0)
const RADIUS = 0.3
const FADE_GAP = 3 // matches Edges: stop short of the source node surface
const STUB_OP = 0.22

export function NebulaStubEdges({ stubs }: { stubs: NebulaStub[] }) {
  const cylGeo = useMemo(() => new THREE.CylinderGeometry(1, 1, 1, 12, 24, true), [])
  useEffect(() => () => cylGeo.dispose(), [cylGeo])

  const items = useMemo(() => {
    const out: {
      id: string
      mat: ReturnType<typeof makeBeamMaterial>
      mid: THREE.Vector3
      quat: THREE.Quaternion
      scale: [number, number, number]
    }[] = []
    for (const s of stubs) {
      const a = new THREE.Vector3(...s.from)
      const c = new THREE.Vector3(...s.center)
      const dir = c.clone().sub(a)
      if (dir.length() < 1e-3) continue
      dir.normalize()
      // Target = the cloud-surface point facing the node, so the beam stops at
      // the rim rather than driving into the (hidden) centre.
      const b = c.clone().addScaledVector(dir, -s.radius)
      const length = a.distanceTo(b)
      if (length < 1) continue
      const nodeR = NODE_RADIUS[s.fromType] ?? 2
      const fadeA = THREE.MathUtils.clamp((nodeR + FADE_GAP) / length, 0.04, 0.4)
      // Big target-end fade so the beam dissolves into the cloud edge.
      const fadeB = THREE.MathUtils.clamp((s.radius * 0.7) / length, 0.15, 0.55)
      out.push({
        id: s.id,
        mat: makeBeamMaterial(s.color, STUB_OP, 0, fadeA, fadeB),
        mid: a.clone().add(b).multiplyScalar(0.5),
        quat: new THREE.Quaternion().setFromUnitVectors(UP, dir),
        scale: [RADIUS, length, RADIUS],
      })
    }
    return out
  }, [stubs])

  useEffect(
    () => () => {
      for (const it of items) it.mat.dispose()
    },
    [items],
  )

  return (
    <group>
      {items.map((it) => (
        <mesh
          key={it.id}
          geometry={cylGeo}
          material={it.mat}
          position={it.mid}
          quaternion={it.quat}
          scale={it.scale}
          raycast={() => null}
        />
      ))}
    </group>
  )
}
